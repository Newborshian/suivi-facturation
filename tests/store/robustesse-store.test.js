// Robustesse du stockage : échec du `stat` après une écriture réussie, dossiers de sauvegardes illisibles, rotation en échec journalisée,
// droits restreints (0600 / 0700) sur les fichiers de santé. Dossiers sous .tmp/tests/, jamais de donnée réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { horlogeFixe, horlogeReglable } from '../aides/horloge.js';
import { NOM_FICHIER_ACTIF, ouvrirStore } from '../../src/store/store.js';
import { ecrireAtomique } from '../../src/store/fichier-atomique.js';
import { creerSauvegarde } from '../../src/store/sauvegardes.js';
import { creerJournal } from '../../src/journal.js';
import { verifierDossierDonnees } from '../../src/config.js';
import { MODE_DOSSIER, MODE_FICHIER } from '../../src/droits.js';

async function avecDossier(fn) {
  const dossier = await creerDossierTemp('robuste');
  try {
    await fn(dossier, path.join(dossier, NOM_FICHIER_ACTIF));
  } finally {
    await supprimerDossierTemp(dossier);
  }
}
const noms = async (d) => (await fs.readdir(path.join(d, 'sauvegardes')).catch(() => [])).sort();
const lireJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
const erreurFs = (code) => Object.assign(new Error(`simulé ${code}`), { code });
const journalEspion = () => {
  const lignes = [];
  return { lignes, info: (m) => lignes.push(`INFO ${m}`), avert: (m) => lignes.push(`AVERT ${m}`), erreur: (m) => lignes.push(`ERREUR ${m}`) };
};
const reglage = (n) => (copie) => { copie.parametres.sauvegardesConservees = n; };
const SOUS_POSIX = process.platform === 'win32' ? 'droits POSIX : sans objet sous Windows' : false;

// ------------------------------------------------------------------ Échec du stat après une écriture réussie

test('le stat qui suit une écriture réussie échoue : aucune erreur, état en mémoire à jour, pas de faux conflit à l\'écriture suivante', () =>
  avecDossier(async (d, f) => {
    const etat = { echecsStat: 0 };
    const fsSimule = {
      ...fs,
      open: (...a) => fs.open(...a),
      rename: async (source, destination, ...reste) => {
        await fs.rename(source, destination, ...reste);
        if (destination === f) etat.echecsStat = 1; // le fichier est remplacé : le prochain stat du fichier actif échoue (antivirus, synchronisation)
      },
      stat: async (chemin, ...reste) => {
        if (etat.echecsStat > 0 && chemin === f) {
          etat.echecsStat -= 1;
          throw erreurFs('EBUSY');
        }
        return fs.stat(chemin, ...reste);
      },
    };
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe(), fs: fsSimule });
    const r = await store.muter('a', reglage(11));
    assert.equal(r.etat.parametres.sauvegardesConservees, 11, 'la réponse reflète l\'écriture réussie (pas d\'erreur 500)');
    assert.equal(store.lire().parametres.sauvegardesConservees, 11, 'état en mémoire à jour');
    assert.equal((await lireJson(f)).parametres.sauvegardesConservees, 11);

    await store.muter('b', reglage(12)); // l'empreinte « à recalculer » ne déclenche aucun conflit
    assert.equal(store.etat().conflit, null);
    assert.equal(store.lire().parametres.sauvegardesConservees, 12);
    assert.equal((await lireJson(f)).parametres.sauvegardesConservees, 12);
    assert.equal(store.lire().revision, 2);
  }));

test('le stat échoue après la création du premier fichier : le démarrage réussit, la première écriture ne lève pas de conflit', () =>
  avecDossier(async (d, f) => {
    let echecs = 1;
    const fsSimule = {
      ...fs,
      open: (...a) => fs.open(...a),
      stat: async (chemin, ...reste) => {
        // 1er appel : fichier absent (ENOENT réel) ; 2e appel : celui qui suit l'écriture de création
        if (chemin === f && (await fs.stat(chemin).then(() => true, () => false)) && echecs-- > 0) throw erreurFs('EBUSY');
        return fs.stat(chemin, ...reste);
      },
    };
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe(), fs: fsSimule });
    assert.equal(store.etat().modeDegrade, false);
    await store.muter('a', reglage(9));
    assert.equal(store.etat().conflit, null);
    assert.equal((await lireJson(f)).parametres.sauvegardesConservees, 9);
  }));

// ------------------------------------------------------------------ Dossier des sauvegardes illisible

test('fichier absent et dossier des sauvegardes illisible (accès refusé) : mode dégradé « lecture », aucun fichier vide créé', () =>
  avecDossier(async (d, f) => {
    const journal = journalEspion();
    const fsSimule = {
      ...fs,
      open: (...a) => fs.open(...a),
      readdir: async (chemin, ...reste) => {
        if (String(chemin).endsWith('sauvegardes')) throw erreurFs('EACCES');
        return fs.readdir(chemin, ...reste);
      },
    };
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe(), fs: fsSimule, journal });
    assert.equal(store.etat().modeDegrade, true);
    assert.equal(store.etat().erreur.raison, 'lecture');
    assert.match(store.etat().erreur.message, /Rien n'a été créé/);
    await assert.rejects(fs.access(f), 'aucun fichier créé');
    await assert.rejects(store.muter('x', reglage(8)), (e) => e.status === 503 && e.code === 'DONNEES_ILLISIBLES');
    assert.ok(journal.lignes.some((l) => /Mode dégradé/.test(l)));
  }));

test('fichier absent, dossier des sauvegardes réellement absent (ENOENT) : le fichier est créé comme avant', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    assert.equal(store.etat().modeDegrade, false);
    assert.equal((await lireJson(f)).prestations.length, 0);
  }));

test('fichier absent, sauvegardes présentes : mode dégradé « absent » inchangé', () =>
  avecDossier(async (d, f) => {
    await creerSauvegarde({ dossier: d, maintenant: new Date(2026, 9, 1, 9, 0, 0), raison: 'manuelle', contenu: '{}' });
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    assert.equal(store.etat().erreur.raison, 'absent');
    await assert.rejects(fs.access(f));
  }));

// ------------------------------------------------------------------ Rotation en échec

test('rotation en échec (suppression refusée) : sauvegardes conservées, ouverture et écritures normales, AVERT au journal sans nom ni donnée', () =>
  avecDossier(async (d) => {
    const initial = await ouvrirStore({ dossier: d, horloge: horlogeReglable('2026-10-02') });
    await initial.muter('a', reglage(7));
    for (let j = 10; j <= 18; j++) await creerSauvegarde({ dossier: d, maintenant: new Date(2026, 8, j, 8, 0, 0), raison: 'quotidienne', contenu: '{}' });
    const avant = await noms(d);

    const journal = journalEspion();
    const fsSimule = {
      ...fs,
      open: (...a) => fs.open(...a),
      unlink: async (chemin, ...reste) => {
        if (/sauvegarde-.*\.json$/.test(String(chemin)) && !String(chemin).includes('.tmp-')) throw erreurFs('EPERM');
        return fs.unlink(chemin, ...reste);
      },
    };
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe('2026-10-03', '08:00:00'), fs: fsSimule, journal });
    assert.equal(store.etat().modeDegrade, false);
    const rotations = journal.lignes.filter((l) => /Rotation des sauvegardes/.test(l));
    assert.equal(rotations.length, 1, journal.lignes.join('\n'));
    assert.match(rotations[0], /^AVERT .*n'ont pas pu être supprimées \(code : EPERM\)/);
    assert.ok(!/sauvegarde-2026/.test(rotations[0]), 'aucun nom de fichier dans le journal');
    const apres = await noms(d);
    for (const nom of avant) assert.ok(apres.includes(nom), `${nom} conservée : rien n'a pu être supprimé`);
    await store.muter('b', reglage(8)); // l'application continue de fonctionner
    assert.equal(store.lire().parametres.sauvegardesConservees, 8);
  }));

// ------------------------------------------------------------------ Droits restreints

test('droits : fichiers de données, temporaires, sauvegardes en 0600 et dossier des sauvegardes en 0700 (options mode des appels système)', () =>
  avecDossier(async (d) => {
    assert.equal(MODE_FICHIER, 0o600);
    assert.equal(MODE_DOSSIER, 0o700);
    const ouvertures = [];
    const creations = [];
    const fsSimule = {
      ...fs,
      open: (...a) => { ouvertures.push(a); return fs.open(...a); },
      mkdir: (...a) => { creations.push(a); return fs.mkdir(...a); },
    };
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe(), fs: fsSimule });
    await store.muter('a', reglage(10)); // sauvegarde quotidienne, puis écriture du fichier actif
    await store.sauvegarderMaintenant();
    assert.ok(ouvertures.length >= 3, 'création du fichier, sauvegardes, écriture');
    for (const [chemin, drapeau, mode] of ouvertures) {
      assert.equal(drapeau, 'wx', chemin);
      assert.equal(mode, 0o600, `${path.basename(chemin)} doit être créé en 0600`);
    }
    const dossiers = creations.filter(([chemin]) => String(chemin).endsWith('sauvegardes'));
    assert.ok(dossiers.length >= 1);
    for (const [, options] of dossiers) assert.equal(options.mode, 0o700);
  }));

test('droits (POSIX) : fichier actif, sauvegardes, archives écrites par l\'application et journal en 0600 ; dossiers créés en 0700', { skip: SOUS_POSIX }, () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    await store.muter('a', reglage(10));
    await store.sauvegarderMaintenant();
    const mode = async (chemin) => (await fs.stat(chemin)).mode & 0o777;
    assert.equal(await mode(f), 0o600);
    assert.equal(await mode(path.join(d, 'sauvegardes')), 0o700);
    for (const nom of await noms(d)) assert.equal(await mode(path.join(d, 'sauvegardes', nom)), 0o600, nom);
    await ecrireAtomique(path.join(d, 'archive-2025.json'), '{}');
    assert.equal(await mode(path.join(d, 'archive-2025.json')), 0o600);

    const logs = path.join(d, 'journal');
    creerJournal({ dossier: logs }).info('essai');
    assert.equal(await mode(logs), 0o700);
    assert.equal(await mode(path.join(logs, 'suivi-facturation.log')), 0o600);

    const defaut = path.join(d, 'racine', 'data');
    assert.equal(await verifierDossierDonnees({ dossier: defaut, dossierParDefaut: true, racine: path.join(d, 'racine') }).then(() => mode(defaut)), 0o700);
  }));

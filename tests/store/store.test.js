import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { horlogeFixe } from '../aides/horloge.js';
import { fsAvecRenameRefuse } from '../aides/fs-defaillant.js';
import { genererExemple } from '../../src/exemple.js';
import { catalogueTest, etatInitialTest } from '../aides/catalogue-test.js';
import { MIGRATIONS, VERSION_COURANTE } from '../../src/domain/schema.js';
import { NOM_FICHIER_ACTIF, ouvrirStore } from '../../src/store/store.js';

const horloge = horlogeFixe('2026-10-02', '09:14:03');
const sansAttente = { attendre: async () => {} };

async function avecDossier(fn) {
  const dossier = await creerDossierTemp('store');
  try {
    await fn(dossier, path.join(dossier, NOM_FICHIER_ACTIF));
  } finally {
    await supprimerDossierTemp(dossier);
  }
}
// Fichier existant garni du catalogue de test (un fichier créé neuf, lui, a un catalogue vide).
const poserFichierAvecCatalogue = (f) => fs.writeFile(f, `${JSON.stringify(etatInitialTest(), null, 2)}
`);
const lireJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
const sauvegardes = async (d) => fs.readdir(path.join(d, 'sauvegardes')).catch(() => []);

test('premier lancement : crée le fichier avec un catalogue VIDE (aucun tarif livré par défaut)', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    assert.equal(store.etat().modeDegrade, false);
    assert.deepEqual(store.lire().catalogue, []);
    const sur_disque = await lireJson(f);
    assert.equal(sur_disque.schemaVersion, VERSION_COURANTE);
    assert.deepEqual(sur_disque.patients, []);
    assert.deepEqual(sur_disque.catalogue, []);
    assert.deepEqual(sur_disque.prestations, []);
    assert.equal(sur_disque.revision, 0);
  }));

test('fichier existant : son catalogue est conservé tel quel (aucune migration, aucune réécriture), même avec une prestation désactivée', () =>
  avecDossier(async (d, f) => {
    const etat = etatInitialTest();
    etat.catalogue[1].actif = false;
    etat.catalogue[2].tarifCentimes = 1234;
    const texte = `${JSON.stringify(etat, null, 2)}
`;
    await fs.writeFile(f, texte);
    const store = await ouvrirStore({ dossier: d, horloge });
    assert.deepEqual(store.lire().catalogue, etat.catalogue);
    assert.equal(await fs.readFile(f, 'utf8'), texte, 'fichier non réécrit');
    // Un fichier existant au catalogue vide le reste aussi (rien n'est ajouté à sa place).
    const vide = etatInitialTest();
    vide.catalogue = [];
    await fs.writeFile(f, `${JSON.stringify(vide, null, 2)}
`);
    assert.deepEqual((await ouvrirStore({ dossier: d, horloge })).lire().catalogue, []);
  }));

test('lire() renvoie un instantané immuable', () =>
  avecDossier(async (d, f) => {
    await poserFichierAvecCatalogue(f);
    const store = await ouvrirStore({ dossier: d, horloge });
    assert.throws(() => { 'use strict'; store.lire().prestations.push({}); }, TypeError);
    assert.throws(() => { 'use strict'; store.lire().catalogue[0].tarifCentimes = 1; }, TypeError);
  }));

test('réouverture : relit le fichier sans le modifier (même octets, même date)', () =>
  avecDossier(async (d, f) => {
    await ouvrirStore({ dossier: d, horloge });
    const avant = await fs.readFile(f);
    const statAvant = await fs.stat(f);
    const store = await ouvrirStore({ dossier: d, horloge });
    assert.equal(store.etat().modeDegrade, false);
    assert.deepEqual(await fs.readFile(f), avant);
    assert.equal((await fs.stat(f)).mtimeMs, statAvant.mtimeMs);
  }));

test('muter : écrit sur disque, incrémente la révision, remplace la mémoire', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    const avant = store.lire();
    const r = await store.muter('test', (copie) => {
      copie.parametres.dernierModePaiement = 'cheque';
      return { avertissements: [{ code: 'X', message: 'm' }] };
    });
    assert.equal(r.etat.revision, 1);
    assert.deepEqual(r.avertissements, [{ code: 'X', message: 'm' }]);
    assert.equal(avant.parametres.dernierModePaiement, null, 'l\'ancien instantané n\'est pas altéré');
    assert.equal(store.lire().parametres.dernierModePaiement, 'cheque');
    const disque = await lireJson(f);
    assert.equal(disque.revision, 1);
    assert.equal(disque.parametres.dernierModePaiement, 'cheque');
    assert.equal(disque.majLe, horloge.maintenant().toISOString());
  }));

test('100 mutations concurrentes : toutes appliquées, dans l\'ordre, sans perte', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    const ordre = [];
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        store.muter('concurrent', async (copie) => {
          ordre.push(i);
          await new Promise((r) => setImmediate(r)); // laisse la place aux autres si la file n'était pas sérialisée
          copie.parametres.sauvegardesConservees = 100 + i;
        }),
      ),
    );
    assert.deepEqual(ordre, Array.from({ length: 100 }, (_, i) => i));
    const disque = await lireJson(f);
    assert.equal(disque.revision, 100);
    assert.equal(disque.parametres.sauvegardesConservees, 199);
    assert.deepEqual((await fs.readdir(d)).filter((n) => n.includes('.tmp-')), []);
  }));

test('une mutation en échec n\'interrompt pas la file et ne modifie rien', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    const echec = store.muter('echec', () => { throw new Error('boum'); });
    const suite = store.muter('suite', (c) => { c.parametres.sauvegardesConservees = 12; });
    await assert.rejects(echec, /boum/);
    await suite;
    assert.equal(store.lire().parametres.sauvegardesConservees, 12);
    assert.equal((await lireJson(f)).revision, 1);
  }));

test('mutation produisant une structure invalide : refusée (500), rien d\'écrit', () =>
  avecDossier(async (d, f) => {
    await poserFichierAvecCatalogue(f);
    const store = await ouvrirStore({ dossier: d, horloge });
    await assert.rejects(store.muter('x', (c) => { c.catalogue[0].tarifCentimes = 1.5; }), (e) => e.status === 500 && e.code === 'ERREUR_INTERNE');
    assert.equal(store.lire().catalogue[0].tarifCentimes, catalogueTest()[0].tarifCentimes);
    assert.equal((await lireJson(f)).revision, 0);
  }));

test('écriture refusée (fichier verrouillé) : mémoire et disque inchangés, store utilisable ensuite', () =>
  avecDossier(async (d, f) => {
    const { fs: faux } = fsAvecRenameRefuse(0);
    const store = await ouvrirStore({ dossier: d, horloge, fs: faux, optionsAtomique: sansAttente });
    const { fs: verrou, etat } = fsAvecRenameRefuse(1000);
    const storeVerrouille = await ouvrirStore({ dossier: d, horloge, fs: verrou, optionsAtomique: sansAttente });
    await assert.rejects(storeVerrouille.muter('x', (c) => { c.parametres.sauvegardesConservees = 5; }), (e) => e.code === 'FICHIER_VERROUILLE');
    assert.ok(etat.appels >= 6);
    assert.equal(storeVerrouille.lire().parametres.sauvegardesConservees, 30);
    assert.equal((await lireJson(f)).parametres.sauvegardesConservees, 30);
    await store.muter('ok', (c) => { c.parametres.sauvegardesConservees = 5; });
    assert.equal((await lireJson(f)).parametres.sauvegardesConservees, 5);
  }));

test('fichier corrompu : mode dégradé, jamais écrasé, mutation et lecture refusées', () =>
  avecDossier(async (d, f) => {
    await fs.writeFile(f, '{"format": "suivi-facturation", "schemaVer');
    const avant = await fs.readFile(f);
    const store = await ouvrirStore({ dossier: d, horloge });
    const e = store.etat();
    assert.equal(e.modeDegrade, true);
    assert.equal(e.erreur.code, 'DONNEES_ILLISIBLES');
    assert.equal(e.erreur.raison, 'illisible');
    assert.match(e.erreur.message, /illisible/);
    assert.throws(() => store.lire(), (err) => err.status === 503 && err.code === 'DONNEES_ILLISIBLES');
    await assert.rejects(store.muter('x', () => {}), (err) => err.code === 'DONNEES_ILLISIBLES');
    assert.deepEqual(await fs.readFile(f), avant, 'le fichier illisible n\'a pas été touché');
    assert.deepEqual((await fs.readdir(d)).filter((n) => n.includes('.tmp-')), []);
  }));

test('fichier JSON valide mais de mauvais format ou incohérent : mode dégradé, intact', () =>
  avecDossier(async (d, f) => {
    for (const contenu of ['[]', '{"format":"autre","schemaVersion":1}', '{"format":"suivi-facturation","schemaVersion":"1"}', JSON.stringify({ ...genererExemple(), prestations: 'x' })]) {
      await fs.writeFile(f, contenu);
      const store = await ouvrirStore({ dossier: d, horloge });
      assert.equal(store.etat().modeDegrade, true, contenu.slice(0, 40));
      assert.equal(await fs.readFile(f, 'utf8'), contenu);
    }
  }));

test('fichier vide : mode dégradé, pas de recréation', () =>
  avecDossier(async (d, f) => {
    await fs.writeFile(f, '');
    const store = await ouvrirStore({ dossier: d, horloge });
    assert.equal(store.etat().modeDegrade, true);
    assert.equal((await fs.stat(f)).size, 0);
  }));

test('fichier absent mais sauvegardes ou archives présentes : rien n\'est créé, mode dégradé « absent »', () =>
  avecDossier(async (d, f) => {
    await fs.mkdir(path.join(d, 'sauvegardes'));
    await fs.writeFile(path.join(d, 'sauvegardes', 'sauvegarde-2026-10-01_08h00m00s_demarrage.json'), '{}');
    const store = await ouvrirStore({ dossier: d, horloge });
    assert.equal(store.etat().modeDegrade, true);
    assert.equal(store.etat().erreur.raison, 'absent');
    await assert.rejects(fs.stat(f), { code: 'ENOENT' });

    const d2 = await creerDossierTemp('store-archive');
    try {
      await fs.writeFile(path.join(d2, 'archive-2025.json'), '{}');
      const s2 = await ouvrirStore({ dossier: d2, horloge });
      assert.equal(s2.etat().erreur.raison, 'absent');
      await assert.rejects(fs.stat(path.join(d2, NOM_FICHIER_ACTIF)), { code: 'ENOENT' });
    } finally {
      await supprimerDossierTemp(d2);
    }
  }));

test('schéma plus récent : lecture seule, écriture refusée, fichier intact', () =>
  avecDossier(async (d, f) => {
    const futur = JSON.stringify({ ...genererExemple(), schemaVersion: 99, nouveauChamp: true });
    await fs.writeFile(f, futur);
    const store = await ouvrirStore({ dossier: d, horloge });
    assert.equal(store.etat().lectureSeule, true);
    assert.equal(store.etat().modeDegrade, false);
    assert.equal(store.lire().schemaVersion, 99);
    await assert.rejects(store.muter('x', () => {}), (e) => e.status === 503 && e.code === 'SCHEMA_PLUS_RECENT');
    assert.equal(await fs.readFile(f, 'utf8'), futur);
    assert.deepEqual(await sauvegardes(d), []);
  }));

test('schéma plus ancien : sauvegarde « avant-migration » (octets d\'origine) puis migration écrite', () =>
  avecDossier(async (d, f) => {
    // Version 0 fictive + migration injectée 0 -> 1, suivie de la vraie migration 1 -> 2 (registre des patients).
    const ancien = JSON.stringify({ ...genererExemple(), schemaVersion: 0 });
    await fs.writeFile(f, ancien);
    const store = await ouvrirStore({ dossier: d, horloge, migrations: { 0: (e) => ({ ...e, migreDepuisZero: undefined }), ...MIGRATIONS } });
    assert.equal(store.etat().modeDegrade, false);
    assert.equal(store.lire().schemaVersion, VERSION_COURANTE);
    assert.equal((await lireJson(f)).schemaVersion, VERSION_COURANTE);
    const noms = (await sauvegardes(d)).filter((n) => n.includes('avant-migration'));
    assert.equal(noms.length, 1);
    assert.match(noms[0], /_avant-migration\.json$/);
    assert.equal(await fs.readFile(path.join(d, 'sauvegardes', noms[0]), 'utf8'), ancien);
  }));

test('schéma plus ancien sans migration disponible : mode dégradé, fichier intact, aucune sauvegarde', () =>
  avecDossier(async (d, f) => {
    const ancien = JSON.stringify({ ...genererExemple(), schemaVersion: 0 });
    await fs.writeFile(f, ancien);
    const store = await ouvrirStore({ dossier: d, horloge });
    assert.equal(store.etat().modeDegrade, true);
    assert.equal(await fs.readFile(f, 'utf8'), ancien);
    assert.deepEqual(await sauvegardes(d), []);
  }));

test('temporaires orphelins supprimés au démarrage, autres fichiers conservés', () =>
  avecDossier(async (d) => {
    await ouvrirStore({ dossier: d, horloge });
    await fs.writeFile(path.join(d, 'suivi-facturation.json.tmp-1-1'), 'moitié d\'écriture');
    await fs.writeFile(path.join(d, 'notes.txt'), 'x');
    await ouvrirStore({ dossier: d, horloge });
    assert.deepEqual((await fs.readdir(d)).sort(), ['notes.txt', 'sauvegardes', 'suivi-facturation.json']); // « sauvegardes » : sauvegarde de démarrage
  }));

test('interruption simulée avant le rename : l\'ancien fichier reste lisible et complet', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    await store.muter('a', (c) => { c.parametres.sauvegardesConservees = 11; });
    const { fs: coupe } = fsAvecRenameRefuse(1000, 'EIO');
    const s2 = await ouvrirStore({ dossier: d, horloge, fs: coupe });
    await assert.rejects(s2.muter('b', (c) => { c.parametres.sauvegardesConservees = 22; }));
    const disque = await lireJson(f);
    assert.equal(disque.parametres.sauvegardesConservees, 11);
    assert.equal(disque.revision, 1);
  }));

// --- Détection de conflit (empreinte avant écriture, architecture §7.6) ---

test('fichier modifié par un tiers : écriture suspendue, deux sauvegardes de conflit, fichier du tiers intact', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    await store.muter('a', (c) => { c.parametres.sauvegardesConservees = 11; });
    const tiers = { ...genererExemple(), revision: 77 };
    const texteTiers = JSON.stringify(tiers, null, 2);
    await fs.writeFile(f, texteTiers);

    await assert.rejects(store.muter('b', (c) => { c.parametres.sauvegardesConservees = 22; }), (e) => e.status === 409 && e.code === 'CONFLIT_FICHIER');
    assert.equal(await fs.readFile(f, 'utf8'), texteTiers, 'la version du tiers n\'est pas écrasée');
    const noms = (await sauvegardes(d)).filter((n) => n.includes('conflit-')).sort();
    assert.equal(noms.length, 2);
    assert.ok(noms.some((n) => n.endsWith('_conflit-disque.json')));
    assert.ok(noms.some((n) => n.endsWith('_conflit-memoire.json')));
    assert.match(noms[0], /^sauvegarde-2026-10-02_09h14m03s_conflit-(disque|memoire)\.json$/);
    const disque = await lireJson(path.join(d, 'sauvegardes', noms.find((n) => n.includes('conflit-disque'))));
    assert.equal(disque.revision, 77);
    const memoire = await lireJson(path.join(d, 'sauvegardes', noms.find((n) => n.includes('conflit-memoire'))));
    assert.equal(memoire.parametres.sauvegardesConservees, 11);

    const c = store.etat().conflit;
    assert.equal(c.type, 'modifie');
    assert.equal(c.disque.nombrePrestations, tiers.prestations.length);
    assert.equal(c.disque.revision, 77);
    assert.equal(c.application.revision, 1);
    // les écritures restent suspendues
    await assert.rejects(store.muter('c', () => {}), (e) => e.code === 'CONFLIT_FICHIER');
    assert.equal(await fs.readFile(f, 'utf8'), texteTiers);
  }));

test('seule la date de modification change (client de synchro) : pas de conflit', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    const futur = new Date(Date.now() + 60_000);
    await fs.utimes(f, futur, futur);
    await store.muter('a', (c) => { c.parametres.sauvegardesConservees = 9; });
    assert.equal(store.etat().conflit, null);
    assert.deepEqual((await sauvegardes(d)).filter((n) => n.includes('conflit-')), []);
    assert.equal((await lireJson(f)).parametres.sauvegardesConservees, 9);
  }));

test('verifierFichier (appelé par /api/etat) : signale le conflit même sans écriture', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    await store.verifierFichier();
    assert.equal(store.etat().conflit, null);
    await fs.writeFile(f, JSON.stringify({ ...genererExemple() }));
    await store.verifierFichier();
    assert.equal(store.etat().conflit.type, 'modifie');
  }));

test('fichier supprimé pendant l\'usage : conflit « disparu », rien n\'est recréé', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    await fs.unlink(f);
    await assert.rejects(store.muter('x', () => {}), (e) => e.code === 'CONFLIT_FICHIER');
    assert.equal(store.etat().conflit.type, 'disparu');
    await assert.rejects(fs.stat(f), { code: 'ENOENT' });
    assert.equal((await sauvegardes(d)).length, 1); // version de l'application seule
  }));

test('collision de nom de sauvegarde dans la même seconde : suffixe, aucun écrasement', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge });
    await fs.writeFile(f, JSON.stringify({ ...genererExemple() }));
    await store.verifierFichier();
    const { creerSauvegarde } = await import('../../src/store/sauvegardes.js');
    const nom = await creerSauvegarde({ dossier: d, maintenant: horloge.maintenant(), raison: 'conflit-disque', contenu: 'x' });
    assert.match(nom, /conflit-disque-2\.json$/);
  }));

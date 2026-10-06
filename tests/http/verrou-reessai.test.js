// Réessais du verrou d'instance (src/verrou.js) avec un système de fichiers simulé qui lève EPERM / EBUSY / EACCES un nombre limité de fois.
// Dossiers sous .tmp/tests/, aucune donnée réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { ErreurConfig } from '../../src/config.js';
import { REESSAI, acquerirVerrou, cheminVerrou, libererVerrou, lireVerrou, mettreAJourPort } from '../../src/verrou.js';
import { creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';

const COURT = { dureeMs: 150, minMs: 5, maxMs: 15 }; // pour les cas « échec persistant »

async function avecDossiers(fn) {
  const donnees = await creerDossierTemp('reessai-donnees');
  const verrous = await creerDossierTemp('reessai-verrous');
  try {
    return await fn({ donnees, verrous, env: { ERGO_VERROU_DIR: verrous } });
  } finally {
    await supprimerDossierTemp(donnees);
    await supprimerDossierTemp(verrous);
  }
}

/**
 * Système de fichiers réel dont certaines opérations échouent d'abord `fois` fois avec `code` (Infinity = toujours).
 * `pannes` : { nomOperation: { fois, code } }. `compteurs` compte les appels de chaque opération.
 */
function fsFaux(pannes) {
  const compteurs = {};
  const faux = { ...fs };
  for (const [nom, { fois, code, filtre = () => true }] of Object.entries(pannes)) {
    compteurs[nom] = 0;
    faux[nom] = (...args) => {
      if (filtre(...args) && compteurs[nom] < fois) {
        compteurs[nom]++;
        throw Object.assign(new Error(`simulé ${code}`), { code });
      }
      return fs[nom](...args);
    };
  }
  return { fsApi: faux, compteurs };
}

const journalEspion = () => {
  const lignes = [];
  return { lignes, avert: (m) => lignes.push(m), info: (m) => lignes.push(m), erreur: (m) => lignes.push(m) };
};

const ecrire = (chemin, v) => fsp.writeFile(chemin, JSON.stringify({ version: '0', dossier: 'x', demarreLe: '2020-01-01T00:00:00.000Z', ...v }));

function fauxServeur() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => res.end(JSON.stringify({ ok: true, application: 'suivi-facturation' })));
    s.listen(0, '127.0.0.1', () => resolve({ port: s.address().port, fermer: () => new Promise((r) => { s.close(() => r()); s.closeAllConnections(); }) }));
  });
}

test('REESSAI : attente aléatoire 10–60 ms, jusqu\'à 2 s', () => {
  assert.deepEqual(REESSAI, { dureeMs: 2000, minMs: 10, maxMs: 60 });
});

test('création du verrou : EPERM / EBUSY / EACCES transitoires (open wx) -> réessai puis acquis', () =>
  avecDossiers(async ({ donnees, env }) => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      const { fsApi, compteurs } = fsFaux({ openSync: { fois: 4, code, filtre: (_, drapeau) => drapeau === 'wx' } });
      const r = await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env, fsApi });
      assert.equal(r.statut, 'acquis', code);
      assert.equal(compteurs.openSync, 4);
      await fsp.unlink(cheminVerrou(donnees, { env }));
    }
  }));

test('création impossible de façon persistante (EPERM), verrou absent : ErreurConfig (code 2, fail closed), code réel au journal', () =>
  avecDossiers(async ({ donnees, env }) => {
    const journal = journalEspion();
    const { fsApi } = fsFaux({ openSync: { fois: Infinity, code: 'EPERM', filtre: (_, drapeau) => drapeau === 'wx' } });
    await assert.rejects(acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env, fsApi, journal, reessai: COURT }), ErreurConfig);
    assert.ok(journal.lignes.some((l) => /EPERM/.test(l) && /création du verrou/.test(l)), journal.lignes.join(' | '));
  }));

test('création en EPERM persistant alors qu\'une instance vivante répond : conclusion « actif » (code 3), jamais une erreur', () =>
  avecDossiers(async ({ donnees, env }) => {
    const faux = await fauxServeur();
    try {
      await ecrire(cheminVerrou(donnees, { env }), { pid: process.pid, port: faux.port });
      const { fsApi } = fsFaux({ openSync: { fois: Infinity, code: 'EPERM', filtre: (_, drapeau) => drapeau === 'wx' } });
      const r = await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env, fsApi, reessai: COURT });
      assert.equal(r.statut, 'actif');
      assert.equal(r.verrou.port, faux.port);
    } finally {
      await faux.fermer();
    }
  }));

test('lecture du verrou en EPERM persistant : « bloque » (code 4), fichier jamais supprimé, code réel au journal', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    await ecrire(chemin, { pid: process.pid, port: 1 });
    const journal = journalEspion();
    const { fsApi } = fsFaux({ readFileSync: { fois: Infinity, code: 'EPERM' } });
    const r = await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env, fsApi, journal, reessai: COURT, patienceMs: -5000 });
    assert.equal(r.statut, 'bloque');
    assert.ok(journal.lignes.some((l) => /EPERM/.test(l)), journal.lignes.join(' | '));
    await fsp.access(chemin); // toujours là
    const l = await lireVerrou(donnees, { env, fsApi, reessai: COURT });
    assert.equal(l.statut, 'bloque');
  }));

test('contenu JSON incomplet (écriture en cours) : relu jusqu\'à ce qu\'il soit complet', () =>
  avecDossiers(async ({ donnees, env }) => {
    const faux = await fauxServeur();
    try {
      const chemin = cheminVerrou(donnees, { env });
      await ecrire(chemin, { pid: process.pid, port: faux.port });
      const complet = await fsp.readFile(chemin, 'utf8');
      let appels = 0;
      const fsApi = { ...fs, readFileSync: (...a) => (++appels <= 3 ? complet.slice(0, 7) : fs.readFileSync(...a)) };
      assert.equal((await lireVerrou(donnees, { env, fsApi })).statut, 'actif');
      assert.ok(appels > 3);
    } finally {
      await faux.fermer();
    }
  }));

test('mise à jour du port : EPERM transitoire sur le renommage -> réessai, port enregistré, aucun temporaire laissé', () =>
  avecDossiers(async ({ donnees, verrous, env }) => {
    await acquerirVerrou({ dossierDonnees: donnees, port: null, version: 'x', env });
    const { fsApi, compteurs } = fsFaux({ renameSync: { fois: 6, code: 'EPERM' } });
    const journal = journalEspion();
    assert.equal(mettreAJourPort({ dossierDonnees: donnees, port: 5123, env, fsApi, journal }), true);
    assert.equal(compteurs.renameSync, 6);
    assert.equal(JSON.parse(await fsp.readFile(cheminVerrou(donnees, { env }), 'utf8')).port, 5123);
    assert.equal((await fsp.readdir(verrous)).length, 1, 'pas de temporaire');
    assert.deepEqual(journal.lignes, [], 'rien à signaler : le réessai a réussi');
    libererVerrou({ dossierDonnees: donnees, env });
  }));

test('mise à jour du port : EPERM persistant -> false sans lever, code réel au journal, verrou intact, temporaire supprimé', () =>
  avecDossiers(async ({ donnees, verrous, env }) => {
    await acquerirVerrou({ dossierDonnees: donnees, port: null, version: 'x', env });
    const avant = await fsp.readFile(cheminVerrou(donnees, { env }), 'utf8');
    const journal = journalEspion();
    const { fsApi } = fsFaux({ renameSync: { fois: Infinity, code: 'EPERM' } });
    assert.equal(mettreAJourPort({ dossierDonnees: donnees, port: 5123, env, fsApi, journal, reessai: COURT }), false);
    assert.ok(journal.lignes.some((l) => /EPERM/.test(l) && /renommage/.test(l)), journal.lignes.join(' | '));
    assert.equal(await fsp.readFile(cheminVerrou(donnees, { env }), 'utf8'), avant);
    assert.equal((await fsp.readdir(verrous)).length, 1, 'temporaire supprimé');
    libererVerrou({ dossierDonnees: donnees, env });
  }));

test('libération : EBUSY transitoire sur la suppression -> réessai ; persistant -> false sans lever', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env });
    const { fsApi, compteurs } = fsFaux({ unlinkSync: { fois: 3, code: 'EBUSY' } });
    assert.equal(libererVerrou({ dossierDonnees: donnees, env, fsApi }), true);
    assert.equal(compteurs.unlinkSync, 3);
    await assert.rejects(fsp.access(chemin));

    await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env });
    const journal = journalEspion();
    const persistant = fsFaux({ unlinkSync: { fois: Infinity, code: 'EBUSY' } });
    assert.equal(libererVerrou({ dossierDonnees: donnees, env, fsApi: persistant.fsApi, journal, reessai: COURT }), false);
    assert.ok(journal.lignes.some((l) => /EBUSY/.test(l)), journal.lignes.join(' | '));
    assert.equal(libererVerrou({ dossierDonnees: donnees, env }), true, 'puis libération normale');
  }));

test('reprise d\'un verrou périmé : EPERM transitoire sur la suppression et sur le mutex de reprise -> réessai, repris', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    await ecrire(chemin, { pid: 2 ** 22 + 12345, port: 4780 }); // PID inexistant
    const { fsApi, compteurs } = fsFaux({
      unlinkSync: { fois: 3, code: 'EPERM' },
      openSync: { fois: 2, code: 'EBUSY', filtre: (p, drapeau) => drapeau === 'wx' && String(p).endsWith('.reprise') },
    });
    const r = await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env, fsApi, patienceMs: 0 });
    assert.deepEqual({ statut: r.statut, repris: r.repris }, { statut: 'acquis', repris: true });
    assert.equal(compteurs.unlinkSync, 3);
    assert.equal(compteurs.openSync, 2);
    await fsp.unlink(chemin);
  }));

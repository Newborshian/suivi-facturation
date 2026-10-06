import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { ecrireFichierTest } from '../aides/temp.js';
import { genererExemple } from '../../src/exemple.js';
import { catalogueTest } from '../aides/catalogue-test.js';
import { lireCorpsJson } from '../../src/http/reponses.js';

const origine = (s) => ({ Origin: `http://127.0.0.1:${s.port}` });

test('GET /api/sante', async () => {
  const s = await demarrerServeurTest();
  try {
    const r = await s.requete({ chemin: '/api/sante' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, application: 'suivi-facturation', version: '0.0.0-test', pid: process.pid });
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  } finally {
    await s.arreter();
  }
});

test('GET /api/etat : date du jour, dossier, drapeaux ; GET /api/catalogue : le catalogue du dossier, en centimes', async () => {
  const s = await demarrerServeurTest();
  try {
    const e = (await s.requete({ chemin: '/api/etat' })).json;
    assert.equal(e.aujourdHui, '2026-10-02');
    assert.equal(e.dossier, s.dossier);
    assert.equal(e.modeDegrade, false);
    assert.equal(e.lectureSeule, false);
    assert.equal(e.conflit, null);
    assert.ok(e.tailleOctets > 0);

    const c = await s.requete({ chemin: '/api/catalogue' });
    assert.equal(c.status, 200);
    assert.equal(c.json.catalogue.length, catalogueTest().length);
    assert.deepEqual(c.json.catalogue.map((p) => p.tarifCentimes), catalogueTest().map((p) => p.tarifCentimes));
  } finally {
    await s.arreter();
  }
});

test('API : routes inconnues 404 JSON, mauvaise méthode 405 JSON, aucune pile d\'appels', async () => {
  const s = await demarrerServeurTest();
  try {
    const inconnue = await s.requete({ chemin: '/api/nexiste-pas' });
    assert.equal(inconnue.status, 404);
    assert.equal(inconnue.json.erreur.code, 'INTROUVABLE');
    assert.equal((await s.requete({ chemin: '/api' })).status, 404);
    const mauvaise = await s.requete({ methode: 'POST', chemin: '/api/etat', headers: origine(s) });
    assert.equal(mauvaise.status, 405);
    assert.equal(mauvaise.json.erreur.code, 'METHODE_REFUSEE');
    assert.ok(!/\bat\s.+\(.*:\d+:\d+\)/.test(mauvaise.texte));
  } finally {
    await s.arreter();
  }
});

test('mode dégradé : /api/etat répond (503 ailleurs), le fichier illisible est intact', async () => {
  const contenu = '{ pas du json';
  const s = await demarrerServeurTest({ preparer: (d) => ecrireFichierTest(path.join(d, 'suivi-facturation.json'), contenu) });
  try {
    const e = await s.requete({ chemin: '/api/etat' });
    assert.equal(e.status, 200);
    assert.equal(e.json.modeDegrade, true);
    assert.equal(e.json.erreur.code, 'DONNEES_ILLISIBLES');
    assert.match(e.json.erreur.message, /illisible/);
    const c = await s.requete({ chemin: '/api/catalogue' });
    assert.equal(c.status, 503);
    assert.equal(c.json.erreur.code, 'DONNEES_ILLISIBLES');
    assert.equal((await s.requete({ chemin: '/api/sante' })).status, 200);
    assert.equal(await fs.readFile(path.join(s.dossier, 'suivi-facturation.json'), 'utf8'), contenu);
  } finally {
    await s.arreter();
  }
});

test('/api/etat signale un conflit après modification externe du fichier', async () => {
  const s = await demarrerServeurTest();
  try {
    await ecrireFichierTest(path.join(s.dossier, 'suivi-facturation.json'), JSON.stringify(genererExemple()));
    const e = (await s.requete({ chemin: '/api/etat' })).json;
    assert.equal(e.conflit.type, 'modifie');
    assert.equal(e.conflit.disque.nombrePrestations, genererExemple().prestations.length);
  } finally {
    await s.arreter();
  }
});

test('schéma plus récent : /api/etat lectureSeule', async () => {
  const s = await demarrerServeurTest({ preparer: (d) => ecrireFichierTest(path.join(d, 'suivi-facturation.json'), JSON.stringify({ ...genererExemple(), schemaVersion: 42 })) });
  try {
    assert.equal((await s.requete({ chemin: '/api/etat' })).json.lectureSeule, true);
  } finally {
    await s.arreter();
  }
});

test('journal : méthode, chemin sans paramètres, statut ; jamais de corps ni de query', async () => {
  const s = await demarrerServeurTest();
  try {
    await s.requete({ chemin: '/api/etat?nom=Secret&prenom=Patient' });
    await s.requete({ chemin: '/inconnu.html?x=Secret' });
    await s.requete({ chemin: '/api/sante', hote: 'evil.example' });
    await new Promise((resolve) => setImmediate(resolve)); // le journal est écrit sur « finish » côté serveur : on lui laisse le temps
    assert.ok(s.journal.includes('GET /api/etat 200'));
    assert.ok(s.journal.includes('GET /inconnu.html 404 INTROUVABLE'));
    assert.ok(s.journal.includes('GET /api/sante 403 HOTE_REFUSE'));
    assert.ok(!s.journal.join('\n').includes('Secret'));
  } finally {
    await s.arreter();
  }
});

test('erreur interne : 500 générique, message de l\'erreur jamais renvoyé ni journalisé', async () => {
  const s = await demarrerServeurTest({
    ajouterRoutes: (r) => r.ajouter('GET', '/api/test-boum', async () => { throw new Error('Données de Pierre Lapin 45,00'); }),
  });
  try {
    const r = await s.requete({ chemin: '/api/test-boum' });
    assert.equal(r.status, 500);
    assert.equal(r.json.erreur.code, 'ERREUR_INTERNE');
    assert.ok(!r.texte.includes('Lapin'));
    assert.ok(!s.journal.join('\n').includes('Lapin'));
  } finally {
    await s.arreter();
  }
});

// --- Lecture de corps : 415 / 413 / 400 (routes de test, les vraies routes POST sont testées dans prestations.test.js) ---

function routeEcho(r) {
  r.ajouter('POST', '/api/test-echo', async (req) => ({ corps: { recu: await lireCorpsJson(req) } }));
}

test('corps JSON : accepté avec Content-Type application/json (charset toléré)', async () => {
  const s = await demarrerServeurTest({ ajouterRoutes: routeEcho });
  try {
    for (const type of ['application/json', 'application/json; charset=utf-8']) {
      const r = await s.requete({ methode: 'POST', chemin: '/api/test-echo', headers: { ...origine(s), 'Content-Type': type }, corps: '{"a":1}' });
      assert.equal(r.status, 200, type);
      assert.deepEqual(r.json.recu, { a: 1 });
    }
  } finally {
    await s.arreter();
  }
});

test('corps : 415 si Content-Type absent ou différent', async () => {
  const s = await demarrerServeurTest({ ajouterRoutes: routeEcho });
  try {
    for (const headers of [{}, { 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/x-www-form-urlencoded' }]) {
      const r = await s.requete({ methode: 'POST', chemin: '/api/test-echo', headers: { ...origine(s), ...headers }, corps: '{"a":1}' });
      assert.equal(r.status, 415, JSON.stringify(headers));
      assert.equal(r.json.erreur.code, 'TYPE_CONTENU');
    }
  } finally {
    await s.arreter();
  }
});

test('corps : 400 si JSON malformé ou pas un objet', async () => {
  const s = await demarrerServeurTest({ ajouterRoutes: routeEcho });
  try {
    for (const corps of ['{"a":', '', '[1]', '"texte"', 'null', '12']) {
      const r = await s.requete({ methode: 'POST', chemin: '/api/test-echo', headers: { ...origine(s), 'Content-Type': 'application/json' }, corps });
      assert.equal(r.status, 400, corps);
      assert.equal(r.json.erreur.code, 'REQUETE_INVALIDE');
    }
  } finally {
    await s.arreter();
  }
});

test('corps : 413 annoncé par Content-Length au-delà de 1 Mo, refusé avant lecture du corps (branche en-tête)', async () => {
  const s = await demarrerServeurTest({ ajouterRoutes: routeEcho });
  try {
    const entetes = { ...origine(s), 'Content-Type': 'application/json' };
    // Content-Length explicite : la requête n'est pas en chunked, le serveur décide d'après l'en-tête.
    const annonce = String(1024 * 1024 + 1);
    const gros = await s.requete({ methode: 'POST', chemin: '/api/test-echo', headers: { ...entetes, Connection: 'close', 'Content-Length': annonce }, corps: 'x'.repeat(1024 * 1024 + 1), reprises: 5 });
    assert.equal(gros.status, 413);
    assert.equal(gros.json.erreur.code, 'TROP_VOLUMINEUX');
    // En-tête mensonger (annonce énorme, corps minuscule) : refusé aussi, sans attendre la fin du corps.
    // « Connection: close » : la connexion ne doit pas être réutilisée (le serveur croit encore recevoir 50 Mo dessus).
    const menteur = await s.requete({ methode: 'POST', chemin: '/api/test-echo', headers: { ...entetes, Connection: 'close', 'Content-Length': String(50 * 1024 * 1024) }, corps: '{}', reprises: 5 });
    assert.equal(menteur.status, 413);
    // Content-Length exact à la limite : accepté.
    const corps = JSON.stringify({ x: 'a'.repeat(1024 * 1024 - 100) });
    const ok = await s.requete({ methode: 'POST', chemin: '/api/test-echo', headers: { ...entetes, 'Content-Length': String(Buffer.byteLength(corps)) }, corps });
    assert.equal(ok.status, 200);
  } finally {
    await s.arreter();
  }
});

test('corps : 413 au-delà de 1 Mo, accepté juste en dessous', async () => {
  const s = await demarrerServeurTest({ ajouterRoutes: routeEcho });
  try {
    const entetes = { ...origine(s), 'Content-Type': 'application/json' };
    const gros = JSON.stringify({ x: 'a'.repeat(1024 * 1024 + 10) });
    const r = await s.requete({ methode: 'POST', chemin: '/api/test-echo', headers: entetes, corps: gros, reprises: 5 });
    assert.equal(r.status, 413);
    assert.equal(r.json.erreur.code, 'TROP_VOLUMINEUX');
    const ok = JSON.stringify({ x: 'a'.repeat(1024 * 1024 - 100) });
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/test-echo', headers: entetes, corps: ok })).status, 200);
  } finally {
    await s.arreter();
  }
});

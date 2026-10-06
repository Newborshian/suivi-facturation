// POST /api/arreter et arrêt propre du processus (processus enfant de test : `node src/server.js`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DOSSIER_VERROUS_TEST, RACINE, creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { demarrerServeurTest, requeteBrute } from '../aides/serveur-aide.js';
import { CODE_SORTIE_CONFIG } from '../../src/config.js';

const origine = (s) => ({ Origin: `http://127.0.0.1:${s.port}` });

// ------------------------------------------------------------------ Route (serveur en processus)

test('POST /api/arreter : 403 sans Origin, avec Origin étrangère, Host étranger ou Sec-Fetch-Site cross-site ; rien ne s\'arrête', async () => {
  let appels = 0;
  const s = await demarrerServeurTest({ demanderArret: () => appels++ });
  try {
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/arreter' })).status, 403);
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/arreter', headers: { Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/arreter', headers: { ...origine(s), 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const hote = await s.requete({ methode: 'POST', chemin: '/api/arreter', headers: origine(s), hote: 'evil.example' });
    assert.equal(hote.status, 403);
    assert.equal(hote.json.erreur.code, 'HOTE_REFUSE');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(appels, 0, "aucune demande d'arrêt");
  } finally {
    await s.arreter();
  }
});

test('POST /api/arreter : 202 {"arret": true} sans corps requis, l\'arrêt est demandé après l\'envoi de la réponse', async () => {
  const ordre = [];
  const s = await demarrerServeurTest({ demanderArret: () => ordre.push('arret') });
  try {
    const r = await s.requete({ methode: 'POST', chemin: '/api/arreter', headers: origine(s) });
    ordre.push('reponse');
    assert.equal(r.status, 202);
    assert.deepEqual(r.json, { arret: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(ordre.filter((x) => x === 'arret').length, 1, "une seule demande d'arrêt, après l'envoi de la réponse (finish)");
    // Un corps éventuel est ignoré, un deuxième appel reste une réponse 202.
    const r2 = await s.requete({ methode: 'POST', chemin: '/api/arreter', headers: { ...origine(s), 'Content-Type': 'application/json' }, corps: '{"x":1}' });
    assert.equal(r2.status, 202);
  } finally {
    await s.arreter();
  }
});

test('/api/arreter : GET et autres méthodes refusés (405) ; /api/sante inchangé', async () => {
  const s = await demarrerServeurTest({ demanderArret: () => assert.fail("l'arrêt ne doit pas être demandé") });
  try {
    assert.equal((await s.requete({ chemin: '/api/arreter' })).status, 405);
    assert.equal((await s.requete({ methode: 'DELETE', chemin: '/api/arreter', headers: origine(s) })).status, 405);
    assert.equal((await s.requete({ methode: 'PATCH', chemin: '/api/arreter', headers: origine(s), corps: '{}' })).status, 405);
    const sante = await s.requete({ chemin: '/api/sante' });
    assert.equal(sante.status, 200);
    assert.deepEqual(sante.json, { ok: true, application: 'suivi-facturation', version: '0.0.0-test', pid: process.pid });
  } finally {
    await s.arreter();
  }
});

// ------------------------------------------------------------------ Processus enfant réel

const portLibre = () =>
  new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** Lance `node src/server.js` ; attend /api/sante ; renvoie { enfant, port, sortie(), fin: Promise<code> }. */
async function lancer({ env, argsNode = [] }) {
  const port = await portLibre();
  const enfant = spawn(process.execPath, [...argsNode, path.join(RACINE, 'src', 'server.js')], { cwd: RACINE, env: { ...process.env, ERGO_VERROU_DIR: DOSSIER_VERROUS_TEST, ERGO_PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let sortie = '';
  enfant.stdout.on('data', (m) => (sortie += m));
  enfant.stderr.on('data', (m) => (sortie += m));
  const fin = new Promise((resolve) => enfant.on('close', (code) => resolve(code)));
  for (let i = 0; i < 100; i++) {
    try {
      // Le port a été libéré puis repris : seul compte CE processus (même PID), pas le serveur d'un autre fichier de test qui aurait pris le port.
      const sante = await requeteBrute({ port, chemin: '/api/sante' });
      if (sante.status === 200 && sante.json?.pid === enfant.pid) return { enfant, port, fin, sortie: () => sortie };
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  enfant.kill(); // processus lancé par ce test : arrêt par PID
  throw new Error(`Le serveur de test n'a pas démarré. Sortie : ${sortie}`);
}

const attendre = (promesse, ms, message) => Promise.race([promesse, new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms))]);

/**
 * Garantie de l'application : après POST /api/arreter, le processus sort en moins de 5 s (garde-temps) plus les opérations de fichier synchrones
 * (au plus ~1 s de réessais pour le verrou). La suite complète tourne en plusieurs processus sur une machine chargée (antivirus, indexeur) :
 * une lecture de fichier isolée y dure parfois plusieurs secondes (mesuré jusqu'à 2,7 s sous charge CPU extrême). Le délai des tests ordinaires
 * est donc de 20 s (ils vérifient la sortie, pas la rapidité) ; la borne « stricte » est vérifiée par les tests dédiés (garde-temps, connexions ouvertes).
 * En cas d'échec, tout ce qui permet de comprendre est dans le message : sortie, PID encore vivant ou non, état du port, journal.
 */
async function attendreSortie(srv, logs, ms = 20_000) {
  try {
    return await attendre(srv.fin, ms, 'pas de sortie');
  } catch (err) {
    let vivant;
    try { process.kill(srv.enfant.pid, 0); vivant = 'oui'; } catch { vivant = 'non'; }
    const port = await requeteBrute({ port: srv.port, chemin: '/api/sante' }).then((r) => `répond ${r.status}`, (e) => e.code);
    const journal = await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8').catch((e) => `illisible (${e.code})`);
    throw new Error(`${err.message} en ${ms} ms. PID ${srv.enfant.pid} vivant : ${vivant} ; port ${srv.port} : ${port}. Sortie : ${srv.sortie()}\nJournal :\n${journal}`);
  }
}

async function avecEnfant(fn, options = {}) {
  const donnees = await creerDossierTemp('arret-donnees');
  const logs = await creerDossierTemp('arret-logs');
  let srv;
  try {
    srv = await lancer({ env: { ERGO_DATA_DIR: donnees, ERGO_LOG_DIR: logs, ...options.env }, argsNode: options.argsNode });
    await fn({ srv, donnees, logs });
  } finally {
    if (srv && srv.enfant.exitCode === null) srv.enfant.kill();
    if (srv) await attendre(srv.fin, 5000, 'le processus de test ne se termine pas').catch(() => {});
    await supprimerDossierTemp(donnees);
    await supprimerDossierTemp(logs);
  }
}

test("processus réel : POST /api/arreter -> 202, file d'écriture vidée, sortie avec le code 0, port libre, journal démarrage + arrêt propre", () =>
  avecEnfant(async ({ srv, donnees, logs }) => {
    const { port } = srv;
    const entetes = { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' };
    const saisie = (i) => JSON.stringify({ patient: { nom: 'Lapin', prenom: `Pierre${i}` }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500, motif: 'Graphisme' });
    // Des écritures en vol au moment de l'arrêt : toutes celles acquittées (201) doivent être sur le disque après la sortie.
    const envois = Array.from({ length: 8 }, (_, i) => requeteBrute({ port, methode: 'POST', chemin: '/api/prestations', headers: entetes, corps: saisie(i) }).catch(() => null));
    const arret = await requeteBrute({ port, methode: 'POST', chemin: '/api/arreter', headers: { Origin: entetes.Origin } });
    assert.equal(arret.status, 202);
    assert.deepEqual(arret.json, { arret: true });
    const code = await attendreSortie(srv, logs);
    assert.equal(code, 0, srv.sortie());

    const reponses = await Promise.all(envois);
    const acquittees = reponses.filter((r) => r?.status === 201).length;
    const disque = JSON.parse(await fs.readFile(path.join(donnees, 'suivi-facturation.json'), 'utf8'));
    assert.equal(disque.prestations.length, acquittees, 'chaque saisie acquittée est sur le disque');
    await assert.rejects(requeteBrute({ port, chemin: '/api/sante' }), /ECONNREFUSED|ECONNRESET/, 'le port est libre');

    const texte = await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8');
    const l = texte.split('\n').filter(Boolean);
    assert.match(l[0], /^\S+ INFO +Démarrage : version \S+, port \d+, dossier de données /);
    assert.match(l[l.length - 1], /^\S+ INFO +Arrêt propre \(bouton Quitter\)\.$/);
    assert.equal(l.length, 2, `deux événements seulement : ${texte}`);
    for (const interdit of ['Lapin', 'Pierre', 'Graphisme', '4500']) assert.ok(!texte.includes(interdit), interdit);
  }));

test("processus réel : un deuxième appel pendant l'arrêt répond 202 (ou connexion fermée) et ne produit qu'un seul arrêt journalisé", () =>
  avecEnfant(async ({ srv, logs }) => {
    const entetes = { Origin: `http://127.0.0.1:${srv.port}` };
    const appels = await Promise.all([1, 2, 3].map(() => requeteBrute({ port: srv.port, methode: 'POST', chemin: '/api/arreter', headers: entetes }).catch((e) => ({ erreur: e.code }))));
    assert.equal(appels.filter((a) => a.status === 202).length >= 1, true);
    for (const a of appels) assert.ok(a.status === 202 || ['ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(a.erreur), JSON.stringify(a));
    assert.equal(await attendreSortie(srv, logs), 0);
    const texte = await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8');
    assert.equal(texte.split('\n').filter((x) => /Arrêt propre/.test(x)).length, 1);
  }));

const PANNES = ['--import', pathToFileURL(path.join(RACINE, 'tests', 'aides', 'panne-arret.mjs')).href];
// Garde-temps de 5 s + libération du verrou (au plus ~1 s) = 6 s attendues. La borne laisse plus que le double : sur un runner lent (macOS partagé)
// une borne serrée donnerait de faux échecs ; le garde-temps lui-même est contrôlé par la durée minimale et par le journal, pas par une borne haute serrée.
const BORNE_STRICTE_MS = 15_000;

/** Connexion TCP brute gardée ouverte. `complete` : une requête GET complète puis connexion inactive (keep-alive) ; sinon une requête POST dont le corps n'arrive jamais (en cours). */
function garderConnexion(port, complete) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let recu = '';
    const ferme = new Promise((r) => socket.on('close', r));
    let connecte = false;
    socket.on('error', (e) => { if (!connecte) reject(e); }); // après coup : ECONNRESET attendu à la fermeture forcée
    socket.on('data', (m) => { recu += m; if (complete && recu.includes('"ok":true')) resolve({ socket, ferme }); });
    socket.on('connect', () => {
      connecte = true;
      if (complete) socket.write(`GET /api/sante HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n\r\n`);
      else {
        socket.write(`POST /api/prestations HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{`);
        resolve({ socket, ferme });
      }
    });
  });
}

test("processus réel : connexion keep-alive inactive et requête en cours ouvertes pendant l'arrêt -> sortie code 0 dans la borne de temps, connexions fermées, journal propre", () =>
  avecEnfant(async ({ srv, logs }) => {
    const inactive = await garderConnexion(srv.port, true);
    const enCours = await garderConnexion(srv.port, false);
    const entetes = { Origin: `http://127.0.0.1:${srv.port}` };
    const appels = await Promise.all([1, 2, 3].map(() => requeteBrute({ port: srv.port, methode: 'POST', chemin: '/api/arreter', headers: entetes }).catch((e) => ({ erreur: e.code }))));
    assert.ok(appels.some((a) => a.status === 202), JSON.stringify(appels));
    assert.equal(await attendreSortie(srv, logs, BORNE_STRICTE_MS), 0);
    await attendre(Promise.all([inactive.ferme, enCours.ferme]), 1000, 'les connexions gardées ouvertes ne sont pas fermées');
    const texte = await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8');
    assert.match(texte, /INFO +Arrêt propre \(bouton Quitter\)\./);
    assert.ok(!/sortie forcée/.test(texte), "le garde-temps n'a pas eu à intervenir");
  }));

test('processus réel : arrêt coincé (serveur qui ne se ferme pas) ET suppression du verrou refusée (EPERM) -> le garde-temps de 5 s force la sortie code 0 (pas avant 4,5 s, journal « sortie forcée »)', () =>
  avecEnfant(async ({ srv, logs }) => {
    const debut = Date.now();
    assert.equal((await requeteBrute({ port: srv.port, methode: 'POST', chemin: '/api/arreter', headers: { Origin: `http://127.0.0.1:${srv.port}` } })).status, 202);
    assert.equal(await attendreSortie(srv, logs, BORNE_STRICTE_MS), 0);
    const duree = Date.now() - debut;
    assert.ok(duree >= 4500, `le garde-temps ne doit pas se déclencher trop tôt (${duree} ms)`);
    const texte = await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8');
    assert.match(texte, /AVERT +Arrêt \(bouton Quitter\) : délai de 5 s dépassé, sortie forcée\./);
  }, { env: { ERGO_TEST_PANNE: 'serveur-bloque,verrou-eperm' }, argsNode: PANNES }));

test("processus réel : suppression du verrou refusée (EPERM) pendant l'arrêt normal -> sortie code 0 sans garde-temps, avertissement puis arrêt propre dans le journal", () =>
  avecEnfant(async ({ srv, logs }) => {
    assert.equal((await requeteBrute({ port: srv.port, methode: 'POST', chemin: '/api/arreter', headers: { Origin: `http://127.0.0.1:${srv.port}` } })).status, 202);
    assert.equal(await attendreSortie(srv, logs, BORNE_STRICTE_MS), 0);
    const texte = await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8');
    assert.ok(!/sortie forcée/.test(texte), "l'arrêt est normal : le garde-temps n'a pas eu à intervenir");
    assert.match(texte, /AVERT +Verrou : « suppression du verrou » en échec/);
    assert.match(texte, /INFO +Arrêt propre \(bouton Quitter\)\./);
  }, { env: { ERGO_TEST_PANNE: 'verrou-eperm' }, argsNode: PANNES }));

test('processus réel : refus 403 (sans Origin) -> le serveur continue de répondre', () =>
  avecEnfant(async ({ srv }) => {
    assert.equal((await requeteBrute({ port: srv.port, methode: 'POST', chemin: '/api/arreter' })).status, 403);
    assert.equal((await requeteBrute({ port: srv.port, chemin: '/api/sante' })).status, 200);
    assert.equal(srv.enfant.exitCode, null);
  }));

// ------------------------------------------------------------------ Erreurs fatales de configuration

test('erreur de configuration (port invalide) : message écrit dans le journal AVANT la sortie avec le code 2, identique à la console', async () => {
  const logs = await creerDossierTemp('arret-logs');
  try {
    const enfant = spawn(process.execPath, [path.join(RACINE, 'src', 'server.js')], { cwd: RACINE, env: { ...process.env, ERGO_VERROU_DIR: DOSSIER_VERROUS_TEST, ERGO_PORT: 'abc', ERGO_LOG_DIR: logs }, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    enfant.stdout.on('data', (m) => (sortie += m));
    enfant.stderr.on('data', (m) => (sortie += m));
    const code = await attendre(new Promise((r) => enfant.on('close', r)), 15_000, 'pas de sortie');
    assert.equal(code, CODE_SORTIE_CONFIG, sortie);
    const l = (await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8')).split('\n').filter(Boolean);
    assert.equal(l.length, 1);
    assert.match(l[0], /^\S+ ERREUR +Démarrage impossible : ERGO_PORT doit être un numéro de port entre 1 et 65535 \(valeur reçue : « abc »\)\.$/);
    assert.match(sortie, /Démarrage impossible : ERGO_PORT doit être un numéro de port/);
  } finally {
    await supprimerDossierTemp(logs);
  }
});

test('erreur de configuration (dossier de données inexistant, message multi-ligne) : une seule ligne de journal, code 2, aide incluse', async () => {
  const logs = await creerDossierTemp('arret-logs');
  const port = await portLibre();
  try {
    const inexistant = path.join(RACINE, '.tmp', 'tests', `n-existe-pas-${process.pid}`);
    const enfant = spawn(process.execPath, [path.join(RACINE, 'src', 'server.js')], { cwd: RACINE, env: { ...process.env, ERGO_VERROU_DIR: DOSSIER_VERROUS_TEST, ERGO_PORT: String(port), ERGO_DATA_DIR: inexistant, ERGO_LOG_DIR: logs }, stdio: ['ignore', 'pipe', 'pipe'] });
    const code = await attendre(new Promise((r) => enfant.on('close', r)), 15_000, 'pas de sortie');
    assert.equal(code, CODE_SORTIE_CONFIG);
    const l = (await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8')).split('\n').filter(Boolean);
    assert.equal(l.length, 1);
    assert.match(l[0], /ERREUR +Démarrage impossible : Le dossier de données choisi n'existe pas.*Choisir le dossier de donnees\.bat/);
  } finally {
    await supprimerDossierTemp(logs);
  }
});

test('port occupé : message complet dans le journal, code 2', async () => {
  const logs = await creerDossierTemp('arret-logs');
  const donnees = await creerDossierTemp('arret-donnees');
  const occupant = http.createServer();
  await new Promise((r) => occupant.listen(0, '127.0.0.1', r));
  const port = occupant.address().port;
  try {
    const enfant = spawn(process.execPath, [path.join(RACINE, 'src', 'server.js')], { cwd: RACINE, env: { ...process.env, ERGO_VERROU_DIR: DOSSIER_VERROUS_TEST, ERGO_PORT: String(port), ERGO_DATA_DIR: donnees, ERGO_LOG_DIR: logs }, stdio: ['ignore', 'pipe', 'pipe'] });
    const code = await attendre(new Promise((r) => enfant.on('close', r)), 15_000, 'pas de sortie');
    assert.equal(code, CODE_SORTIE_CONFIG);
    const texte = await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8');
    assert.match(texte, new RegExp(`ERREUR +Démarrage impossible : Le port ${port} est déjà utilisé`));
  } finally {
    await new Promise((r) => occupant.close(r));
    await supprimerDossierTemp(logs);
    await supprimerDossierTemp(donnees);
  }
});

test('port refusé par le système (accès refusé) : message en français dans le journal, code 2 et non 1', async () => {
  const logs = await creerDossierTemp('arret-logs');
  const donnees = await creerDossierTemp('arret-donnees');
  const port = await portLibre();
  try {
    const enfant = spawn(process.execPath, [...PANNES, path.join(RACINE, 'src', 'server.js')], { cwd: RACINE, env: { ...process.env, ERGO_TEST_PANNE: 'port-eacces', ERGO_VERROU_DIR: DOSSIER_VERROUS_TEST, ERGO_PORT: String(port), ERGO_DATA_DIR: donnees, ERGO_LOG_DIR: logs }, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    enfant.stdout.on('data', (m) => (sortie += m));
    enfant.stderr.on('data', (m) => (sortie += m));
    const code = await attendre(new Promise((r) => enfant.on('close', r)), 15_000, 'pas de sortie');
    assert.equal(code, CODE_SORTIE_CONFIG, sortie);
    assert.ok(sortie.includes(`Le port ${port} ne peut pas être ouvert sur 127.0.0.1 (accès refusé`), sortie);
    const texte = await fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8');
    assert.match(texte, /ERREUR +Démarrage impossible : Le port \d+ ne peut pas être ouvert/);
    assert.deepEqual(await fs.readdir(donnees), [], 'aucun fichier de données touché');
  } finally {
    await supprimerDossierTemp(logs);
    await supprimerDossierTemp(donnees);
  }
});

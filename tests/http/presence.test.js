// Arrêt automatique à la fermeture de la page : logique (horloge simulée), route POST /api/presence, configuration, processus réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { DOSSIER_VERROUS_TEST, RACINE, creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { demarrerServeurTest, requeteBrute } from '../aides/serveur-aide.js';
import { creerMinuteursSimules } from '../aides/minuteurs-simules.js';
import { CODE_SORTIE_CONFIG, ErreurConfig, lireConfig } from '../../src/config.js';
import { creerPresence, MAX_IDENTIFIANTS } from '../../src/presence.js';

const S = 1000;
const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const DELAIS = { fermetureMs: 10 * S, pulsationMs: 600 * S, premierePageMs: 300 * S };

function installer({ actif = true, delais = DELAIS } = {}) {
  const horloge = creerMinuteursSimules();
  const arrets = [];
  const presence = creerPresence({ actif, delais, surArret: (raison) => arrets.push(raison), maintenant: horloge.maintenant, minuteurs: horloge.minuteurs });
  presence.demarrer();
  return { horloge, arrets, presence };
}

// ------------------------------------------------------------------ Logique (horloge simulée)

test('délai de grâce : la dernière page fermée arrête au bout de 10 s, avec la raison, une seule fois', () => {
  const { horloge, arrets, presence } = installer();
  presence.signaler(A, 'ouverte');
  presence.signaler(A, 'fermee');
  horloge.avancer(9 * S);
  assert.deepEqual(arrets, []);
  horloge.avancer(2 * S);
  assert.deepEqual(arrets, ['la dernière page a été fermée']);
  horloge.avancer(3600 * S);
  assert.equal(arrets.length, 1);
});

test('délai de grâce : une nouvelle « ouverte » dans les 10 s l\'annule (navigation, rechargement), même identifiant ou autre onglet', () => {
  for (const suivant of [A, B]) {
    const { horloge, arrets, presence } = installer();
    presence.signaler(A, 'ouverte');
    presence.signaler(A, 'fermee');
    horloge.avancer(5 * S);
    presence.signaler(suivant, 'ouverte');
    for (let i = 0; i < 40; i++) {
      horloge.avancer(15 * S);
      presence.signaler(suivant, 'ouverte');
    }
    assert.deepEqual(arrets, [], suivant);
  }
});

test('deux onglets dont un se ferme : pas d\'arrêt tant que l\'autre bat, arrêt quand il se ferme à son tour', () => {
  const { horloge, arrets, presence } = installer();
  presence.signaler(A, 'ouverte');
  presence.signaler(B, 'ouverte');
  presence.signaler(A, 'fermee');
  for (let i = 0; i < 80; i++) {
    horloge.avancer(15 * S);
    presence.signaler(B, 'ouverte');
  }
  assert.deepEqual(arrets, []);
  assert.equal(presence.nombre(), 1);
  presence.signaler(B, 'fermee');
  horloge.avancer(11 * S);
  assert.equal(arrets.length, 1);
});

test('jamais d\'arrêt tant qu\'une page bat (toutes les 15 s pendant 2 h)', () => {
  const { horloge, arrets, presence } = installer();
  for (let i = 0; i < 480; i++) {
    presence.signaler(A, 'ouverte');
    horloge.avancer(15 * S);
  }
  assert.deepEqual(arrets, []);
});

test('plus aucun battement pendant 10 min : la page est oubliée puis, après le délai de grâce, arrêt', () => {
  const { horloge, arrets, presence } = installer();
  presence.signaler(A, 'ouverte');
  horloge.avancer(599 * S);
  assert.deepEqual(arrets, []);
  assert.equal(presence.nombre(), 1);
  horloge.avancer(6 * S);
  assert.equal(presence.nombre(), 0);
  assert.deepEqual(arrets, []);
  horloge.avancer(10 * S);
  assert.deepEqual(arrets, ['plus aucun battement depuis 10 minutes']);
});

test('un battement tardif (avant les 10 min) remet le compteur à zéro', () => {
  const { horloge, arrets, presence } = installer();
  presence.signaler(A, 'ouverte');
  horloge.avancer(590 * S);
  presence.signaler(A, 'ouverte');
  horloge.avancer(590 * S);
  assert.deepEqual(arrets, []);
});

test('aucune page connectée depuis le démarrage : arrêt au bout de 5 min, pas avant', () => {
  const { horloge, arrets } = installer();
  horloge.avancer(299 * S);
  assert.deepEqual(arrets, []);
  horloge.avancer(7 * S);
  assert.deepEqual(arrets, ["aucune page ne s'est connectée en 5 minutes"]);
});

test('une « fermee » sans page connectée ne compte pas comme une connexion', () => {
  const { horloge, arrets, presence } = installer();
  presence.signaler(A, 'fermee');
  horloge.avancer(306 * S);
  assert.deepEqual(arrets, ["aucune page ne s'est connectée en 5 minutes"]);
});

test('saut d\'horloge (mise en veille de 2 h) : aucun arrêt, la page n\'est pas oubliée, puis les règles normales reprennent', () => {
  const { horloge, arrets, presence } = installer();
  presence.signaler(A, 'ouverte');
  horloge.saut(2 * 3600 * S);
  assert.deepEqual(arrets, []);
  assert.equal(presence.nombre(), 1);
  horloge.avancer(5 * 60 * S);
  assert.deepEqual(arrets, []);
  horloge.avancer(7 * 60 * S);
  assert.equal(arrets.length, 1);
});

test('saut d\'horloge pendant un délai de grâce ou avant la première page : aucun arrêt ce tour-là, les compteurs repartent', () => {
  const grace = installer();
  grace.presence.signaler(A, 'ouverte');
  grace.presence.signaler(A, 'fermee');
  grace.horloge.saut(3600 * S);
  assert.deepEqual(grace.arrets, []);
  grace.horloge.avancer(11 * S);
  assert.equal(grace.arrets.length, 1);

  const premiere = installer();
  premiere.horloge.saut(3600 * S);
  assert.deepEqual(premiere.arrets, []);
  premiere.horloge.avancer(299 * S);
  assert.deepEqual(premiere.arrets, []);
  premiere.horloge.avancer(10 * S);
  assert.equal(premiere.arrets.length, 1);
});

test('désactivé : jamais d\'arrêt ; les signaux restent validés ; aucun minuteur', () => {
  const { horloge, arrets, presence } = installer({ actif: false });
  assert.equal(presence.actif, false);
  assert.equal(presence.signaler(A, 'ouverte'), true);
  assert.equal(presence.signaler(A, 'fermee'), true);
  assert.equal(presence.signaler('x', 'ouverte'), false);
  assert.equal(horloge.nombreMinuteurs(), 0);
  horloge.avancer(24 * 3600 * S);
  assert.deepEqual(arrets, []);
});

test(`plus de ${MAX_IDENTIFIANTS} identifiants : les plus anciens sont oubliés`, () => {
  const { presence } = installer();
  const ids = Array.from({ length: 60 }, (_, i) => `onglet-${String(i).padStart(3, '0')}`);
  for (const id of ids) presence.signaler(id, 'ouverte');
  assert.equal(presence.nombre(), MAX_IDENTIFIANTS);
  for (const id of ids.slice(0, 10)) presence.signaler(id, 'fermee');
  assert.equal(presence.nombre(), MAX_IDENTIFIANTS);
  presence.signaler(ids[10], 'fermee');
  assert.equal(presence.nombre(), MAX_IDENTIFIANTS - 1);
});

test('identifiant ou état invalide : refusé, rien n\'est retenu ; limites 8 et 64 caractères acceptées', () => {
  const { presence } = installer();
  const invalides = [undefined, null, 42, {}, '', 'abc', 'a'.repeat(7), 'a'.repeat(65), 'avec espace-123', 'accentué-é-12345', 'x/../etc/passwd', 'id;DROP-TABLE', `${'a'.repeat(8)}\n`];
  for (const id of invalides) assert.equal(presence.signaler(id, 'ouverte'), false, String(id));
  for (const etat of [undefined, '', 'OUVERTE', 'autre', 1, null]) assert.equal(presence.signaler(A, etat), false, String(etat));
  assert.equal(presence.nombre(), 0);
  assert.equal(presence.signaler('a'.repeat(8), 'ouverte'), true);
  assert.equal(presence.signaler('a'.repeat(64), 'ouverte'), true);
});

test('délais personnalisés : 1 s de grâce ; arrêt demandé une fois et minuteurs retirés ensuite', () => {
  const { horloge, arrets, presence } = installer({ delais: { fermetureMs: 1 * S, pulsationMs: 600 * S, premierePageMs: 300 * S } });
  presence.signaler(A, 'ouverte');
  presence.signaler(A, 'fermee');
  horloge.avancer(2 * S);
  assert.equal(arrets.length, 1);
  assert.equal(horloge.nombreMinuteurs(), 0);
});

// ------------------------------------------------------------------ Route POST /api/presence

const origine = (s) => ({ Origin: `http://127.0.0.1:${s.port}` });
const json = { 'Content-Type': 'application/json' };

async function avecServeur(fn, options = {}) {
  const horloge = creerMinuteursSimules();
  const arrets = [];
  const presence = creerPresence({ actif: true, delais: DELAIS, surArret: (r) => arrets.push(r), maintenant: horloge.maintenant, minuteurs: horloge.minuteurs, ...options });
  const evenements = [];
  const s = await demarrerServeurTest({ presence, evenements: { chemin: null, info: (m) => evenements.push(m), avert: (m) => evenements.push(m), erreur: (m) => evenements.push(m) } });
  try {
    await fn({ s, presence, horloge, arrets, evenements });
  } finally {
    await s.arreter();
  }
}

test('POST /api/presence : 403 sans Origin, Origin étrangère, Host étranger ou Sec-Fetch-Site cross-site ; rien n\'est enregistré', () =>
  avecServeur(async ({ s, presence }) => {
    const corps = JSON.stringify({ id: A, etat: 'ouverte' });
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/presence', headers: json, corps })).status, 403);
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...json, Origin: 'http://evil.example' }, corps })).status, 403);
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...json, ...origine(s), 'Sec-Fetch-Site': 'cross-site' }, corps })).status, 403);
    const hote = await s.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...json, ...origine(s) }, hote: 'evil.example', corps });
    assert.equal(hote.status, 403);
    assert.equal(hote.json.erreur.code, 'HOTE_REFUSE');
    assert.equal(presence.nombre(), 0);
  }));

test('POST /api/presence : 204 en JSON ou en texte (sendBeacon) ; « ouverte » enregistre, « fermee » retire', () =>
  avecServeur(async ({ s, presence }) => {
    const poster = (headers, corps) => s.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...origine(s), ...headers }, corps });
    const r = await poster(json, JSON.stringify({ id: A, etat: 'ouverte' }));
    assert.equal(r.status, 204);
    assert.equal(r.texte, '');
    assert.equal(presence.nombre(), 1);
    assert.equal((await poster({ 'Content-Type': 'text/plain;charset=UTF-8' }, JSON.stringify({ id: B, etat: 'ouverte' }))).status, 204);
    assert.equal(presence.nombre(), 2);
    assert.equal((await poster({ 'Content-Type': 'text/plain;charset=UTF-8', 'Sec-Fetch-Site': 'same-origin' }, JSON.stringify({ id: A, etat: 'fermee' }))).status, 204);
    assert.equal(presence.nombre(), 1);
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  }));

test('POST /api/presence : 400 pour un corps invalide, 415 pour un autre type, 413 pour un corps trop gros', () =>
  avecServeur(async ({ s, presence }) => {
    const poster = (corps, headers = json) => s.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...origine(s), ...headers }, corps, reprises: 3 });
    const mauvais = ['{pas du json', '[]', '"texte"', '{}', JSON.stringify({ id: A }), JSON.stringify({ etat: 'ouverte' }), JSON.stringify({ id: 'court', etat: 'ouverte' }), JSON.stringify({ id: A, etat: 'dormante' }), JSON.stringify({ id: { a: 1 }, etat: 'ouverte' })];
    for (const corps of mauvais) {
      const r = await poster(corps);
      assert.equal(r.status, 400, corps);
      assert.equal(r.json.erreur.code, 'REQUETE_INVALIDE');
    }
    assert.equal((await poster(JSON.stringify({ id: A, etat: 'ouverte' }), { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await poster(JSON.stringify({ id: A, etat: 'ouverte', bourrage: 'x'.repeat(2000) }))).status, 413);
    assert.equal(presence.nombre(), 0);
  }));

test('/api/presence : GET, HEAD, PATCH, DELETE = 405', () =>
  avecServeur(async ({ s }) => {
    for (const methode of ['GET', 'HEAD', 'PATCH', 'DELETE']) {
      const r = await s.requete({ methode, chemin: '/api/presence', headers: methode === 'GET' || methode === 'HEAD' ? {} : origine(s) });
      assert.equal(r.status, 405, methode);
    }
  }));

test('arretAuto dans /api/etat : false sans présence, true avec présence active, false si inactive ; route acceptée et ignorée quand désactivée', async () => {
  const s = await demarrerServeurTest();
  try {
    const r = await s.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...origine(s), ...json }, corps: JSON.stringify({ id: A, etat: 'ouverte' }) });
    assert.equal(r.status, 204);
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...origine(s), ...json }, corps: '{}' })).status, 400, 'toujours validée');
    assert.equal((await s.requete({ chemin: '/api/etat' })).json.arretAuto, false);
  } finally {
    await s.arreter();
  }
  await avecServeur(async ({ s: s2 }) => {
    assert.equal((await s2.requete({ chemin: '/api/etat' })).json.arretAuto, true);
  });
  await avecServeur(async ({ s: s3, presence }) => {
    assert.equal((await s3.requete({ chemin: '/api/etat' })).json.arretAuto, false);
    await s3.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...origine(s3), ...json }, corps: JSON.stringify({ id: A, etat: 'ouverte' }) });
    assert.equal(presence.nombre(), 0);
  }, { actif: false });
});

test('journal : les battements ne sont pas écrits ; ni champ superflu (nom de patient) ni identifiant dans les journaux', () =>
  avecServeur(async ({ s, evenements }) => {
    for (let i = 0; i < 3; i++) {
      await s.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...origine(s), ...json }, corps: JSON.stringify({ id: A, etat: 'ouverte', patient: 'Lapin Pierre' }) });
    }
    await s.requete({ methode: 'POST', chemin: '/api/presence', headers: { ...origine(s), ...json }, corps: JSON.stringify({ id: 'x', etat: 'ouverte', patient: 'Lapin Pierre' }) });
    const tout = [...s.journal, ...evenements].join('\n');
    assert.doesNotMatch(tout, /presence 204/);
    assert.ok(!tout.includes('Lapin') && !tout.includes('Pierre') && !tout.includes(A), tout);
    assert.match(tout, /POST \/api\/presence 400 REQUETE_INVALIDE/);
  }));

// ------------------------------------------------------------------ Configuration

test('configuration : arrêt automatique désactivé par défaut, délais par défaut 10 / 600 / 300 s', () => {
  for (const env of [{}, { ERGO_ARRET_AUTO: '' }, { ERGO_ARRET_AUTO: '0' }]) {
    const c = lireConfig(env, RACINE).arretAuto;
    assert.equal(c.actif, false);
    assert.deepEqual(c.delais, { fermetureMs: 10_000, pulsationMs: 600_000, premierePageMs: 300_000 });
  }
  const c = lireConfig({ ERGO_ARRET_AUTO: '1', ERGO_ARRET_DELAI_FERMETURE_S: '1', ERGO_ARRET_DELAI_PULSATION_S: '86400', ERGO_ARRET_DELAI_PREMIERE_PAGE_S: ' 7 ' }, RACINE).arretAuto;
  assert.equal(c.actif, true);
  assert.deepEqual(c.delais, { fermetureMs: 1000, pulsationMs: 86_400_000, premierePageMs: 7000 });
});

test('configuration : valeurs invalides = ErreurConfig (code de sortie 2) avec le nom de la variable', () => {
  const cas = [
    ['ERGO_ARRET_AUTO', 'oui'], ['ERGO_ARRET_AUTO', '2'], ['ERGO_ARRET_AUTO', 'true'],
    ...['ERGO_ARRET_DELAI_FERMETURE_S', 'ERGO_ARRET_DELAI_PULSATION_S', 'ERGO_ARRET_DELAI_PREMIERE_PAGE_S'].flatMap((nom) => ['0', '-1', '86401', '1.5', 'abc', '10s', '1e3'].map((v) => [nom, v])),
  ];
  for (const [nom, valeur] of cas) {
    assert.throws(() => lireConfig({ [nom]: valeur }, RACINE), (err) => err instanceof ErreurConfig && err.codeSortie === 2 && err.message.includes(nom), `${nom}=${valeur}`);
  }
});

// ------------------------------------------------------------------ Processus réel

const portLibre = () =>
  new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const attendre = (promesse, ms, message) => Promise.race([promesse, new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms))]);

/** Lance `node src/server.js` avec `env` (jamais de ERGO_ARRET_* hérité) ; attend /api/sante sauf `sansAttendre`. */
async function lancer(env, { sansAttendre = false } = {}) {
  const donnees = await creerDossierTemp('presence-donnees');
  const logs = await creerDossierTemp('presence-logs');
  const port = await portLibre();
  const base = { ...process.env, ERGO_VERROU_DIR: DOSSIER_VERROUS_TEST, ERGO_PORT: String(port), ERGO_DATA_DIR: donnees, ERGO_LOG_DIR: logs };
  for (const nom of Object.keys(base)) if (nom.startsWith('ERGO_ARRET_')) delete base[nom];
  const enfant = spawn(process.execPath, [path.join(RACINE, 'src', 'server.js')], { cwd: RACINE, env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let sortie = '';
  enfant.stdout.on('data', (m) => (sortie += m));
  enfant.stderr.on('data', (m) => (sortie += m));
  const fin = new Promise((resolve) => enfant.on('close', (code) => resolve(code)));
  const srv = { enfant, port, fin, sortie: () => sortie, donnees, logs, journal: () => fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8').catch(() => '') };
  if (sansAttendre) return srv;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await requeteBrute({ port, chemin: '/api/sante' })).status === 200) return srv;
    } catch { /* pas encore prêt */ }
    await pause(100);
  }
  enfant.kill();
  throw new Error(`Le serveur de test n'a pas démarré. Sortie : ${sortie}`);
}

async function nettoyer(srv) {
  if (srv.enfant.exitCode === null) srv.enfant.kill(); // processus lancé par ce test : arrêt par PID
  await attendre(srv.fin, 5000, 'le processus de test ne se termine pas').catch(() => {});
  await supprimerDossierTemp(srv.donnees);
  await supprimerDossierTemp(srv.logs);
}

const signaler = (srv, id, etat) =>
  requeteBrute({ port: srv.port, methode: 'POST', chemin: '/api/presence', headers: { Origin: `http://127.0.0.1:${srv.port}`, 'Content-Type': 'application/json' }, corps: JSON.stringify({ id, etat }) });

test('processus réel (ERGO_ARRET_AUTO=1, grâce 1 s) : page ouverte et navigation gardent le serveur, la fermeture l\'arrête (code 0, port libre, journal)', async () => {
  const srv = await lancer({ ERGO_ARRET_AUTO: '1', ERGO_ARRET_DELAI_FERMETURE_S: '1' });
  try {
    assert.equal((await requeteBrute({ port: srv.port, chemin: '/api/etat' })).json.arretAuto, true);
    assert.equal((await signaler(srv, A, 'ouverte')).status, 204);
    await pause(2500);
    assert.equal(srv.enfant.exitCode, null, 'page ouverte : le serveur reste en vie');
    await signaler(srv, A, 'fermee');
    await pause(300);
    await signaler(srv, A, 'ouverte');
    await pause(2500);
    assert.equal(srv.enfant.exitCode, null, 'navigation : le serveur reste en vie');
    await signaler(srv, A, 'fermee');
    const code = await attendre(srv.fin, 15_000, `pas d'arrêt automatique. Sortie : ${srv.sortie()}`);
    assert.equal(code, 0, srv.sortie());
    await assert.rejects(requeteBrute({ port: srv.port, chemin: '/api/sante' }), /ECONNREFUSED|ECONNRESET/, 'le port est libre');
    const texte = await srv.journal();
    assert.match(texte, /INFO +Arrêt automatique : la dernière page a été fermée\./);
    assert.match(texte, /INFO +Arrêt propre \(arrêt automatique\)\./);
    assert.ok(!texte.includes(A), "l'identifiant d'onglet n'est pas journalisé");
  } finally {
    await nettoyer(srv);
  }
});

test('processus réel : sans ERGO_ARRET_AUTO, ouverte puis fermee n\'arrête rien (route acceptée et ignorée, arretAuto false)', async () => {
  const srv = await lancer({ ERGO_ARRET_DELAI_FERMETURE_S: '1' });
  try {
    assert.equal((await requeteBrute({ port: srv.port, chemin: '/api/etat' })).json.arretAuto, false);
    assert.equal((await signaler(srv, A, 'ouverte')).status, 204);
    assert.equal((await signaler(srv, A, 'fermee')).status, 204);
    await pause(3000);
    assert.equal(srv.enfant.exitCode, null);
    assert.equal((await requeteBrute({ port: srv.port, chemin: '/api/sante' })).status, 200);
    assert.ok(!/Arrêt automatique/.test(await srv.journal()));
  } finally {
    await nettoyer(srv);
  }
});

test('processus réel (ERGO_ARRET_AUTO=1, première page 1 s) : aucune page ne se connecte -> arrêt propre avec la raison, code 0', async () => {
  const srv = await lancer({ ERGO_ARRET_AUTO: '1', ERGO_ARRET_DELAI_PREMIERE_PAGE_S: '1' });
  try {
    const code = await attendre(srv.fin, 20_000, `pas d'arrêt automatique. Sortie : ${srv.sortie()}`);
    assert.equal(code, 0, srv.sortie());
    assert.match(await srv.journal(), /INFO +Arrêt automatique : aucune page ne s'est connectée en 1 seconde\./);
  } finally {
    await nettoyer(srv);
  }
});

test('processus réel : variable d\'arrêt automatique invalide -> code de sortie 2 et message dans le journal', async () => {
  for (const env of [{ ERGO_ARRET_DELAI_FERMETURE_S: '0' }, { ERGO_ARRET_AUTO: 'oui' }]) {
    const srv = await lancer(env, { sansAttendre: true });
    try {
      const code = await attendre(srv.fin, 15_000, `pas de sortie. Sortie : ${srv.sortie()}`);
      assert.equal(code, CODE_SORTIE_CONFIG, srv.sortie());
      assert.match(await srv.journal(), /ERREUR +Démarrage impossible : ERGO_ARRET_(AUTO|DELAI_FERMETURE_S) doit/);
    } finally {
      await nettoyer(srv);
    }
  }
});

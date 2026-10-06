// Verrou d'instance : PID réutilisé (heure de démarrage du processus) et dossier des verrous propre à l'utilisateur (propriétaire, droits).
// Dossiers sous .tmp/tests/, aucune donnée réelle. Les contrôles de propriétaire sont simulés (uid et système de fichiers injectés) et,
// sous POSIX seulement, vérifiés sur de vrais droits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { ErreurConfig } from '../../src/config.js';
import { MARGE_DEMARRAGE_MS, acquerirVerrou, analyserDemarrageLinux, cheminVerrou, libererVerrou, lireDemarrageProcessus, lireVerrou } from '../../src/verrou.js';
import { creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { portLibre } from '../aides/instance-aide.js';

async function avecDossiers(fn) {
  const donnees = await creerDossierTemp('verrou2-donnees');
  const verrous = await creerDossierTemp('verrou2-verrous');
  try {
    return await fn({ donnees, verrous, env: { ERGO_VERROU_DIR: verrous } });
  } finally {
    await supprimerDossierTemp(donnees);
    await supprimerDossierTemp(verrous);
  }
}

function fauxServeur() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => res.end(JSON.stringify({ ok: true, application: 'suivi-facturation' })));
    s.listen(0, '127.0.0.1', () => resolve({ port: s.address().port, fermer: () => new Promise((r) => { s.close(() => r()); s.closeAllConnections(); }) }));
  });
}

const ecrireVerrou = (chemin, v) => fs.writeFile(chemin, JSON.stringify({ version: '0', dossier: 'x', demarreLe: '2020-01-01T00:00:00.000Z', ...v }));
const journalEspion = () => {
  const lignes = [];
  return { lignes, avert: (m) => lignes.push(m), info: (m) => lignes.push(m), erreur: (m) => lignes.push(m) };
};
const dans = (ms) => new Date(Date.now() + ms).toISOString();

// ------------------------------------------------------------------ PID réutilisé

test('PID réutilisé : processus démarré APRÈS l\'heure du verrou -> « perime » ; avant, ou dans la marge -> « bloque »', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    const port = await portLibre();
    const verrou = Date.now() - 3_600_000;
    await ecrireVerrou(chemin, { pid: process.pid, port, demarreLe: new Date(verrou).toISOString() });
    const avec = (demarrage) => lireVerrou(donnees, { env, delaiSondeMs: 300, demarrageProcessus: async () => demarrage });
    assert.equal((await avec(new Date(verrou + 3_600_000))).statut, 'perime', 'après un redémarrage : le processus actuel est bien plus récent que le verrou');
    assert.equal((await avec(new Date(verrou + MARGE_DEMARRAGE_MS + 1000))).statut, 'perime');
    assert.equal((await avec(new Date(verrou + MARGE_DEMARRAGE_MS - 1000))).statut, 'bloque', 'dans la marge : instance bloquée, pas un PID réutilisé');
    assert.equal((await avec(new Date(verrou - 1000))).statut, 'bloque', 'démarré avant le verrou : le même processus');
    assert.equal((await avec(new Date(verrou - 86_400_000))).statut, 'bloque');
  }));

test('PID réutilisé : un serveur qui répond est « actif » sans lire l\'heure de démarrage ; acquérir le verrou d\'un PID réutilisé = reprise', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    const faux = await fauxServeur();
    let lectures = 0;
    const espion = async () => { lectures += 1; return new Date(); };
    try {
      await ecrireVerrou(chemin, { pid: process.pid, port: faux.port });
      assert.equal((await lireVerrou(donnees, { env, demarrageProcessus: espion })).statut, 'actif');
      assert.equal(lectures, 0);
    } finally {
      await faux.fermer();
    }
    await ecrireVerrou(chemin, { pid: process.pid, port: await portLibre() });
    const r = await acquerirVerrou({ dossierDonnees: donnees, port: 4781, version: 'x', env, delaiSondeMs: 300, demarrageProcessus: espion });
    assert.deepEqual({ statut: r.statut, repris: r.repris }, { statut: 'acquis', repris: true });
    assert.equal(r.ancien.pid, process.pid);
    assert.equal(JSON.parse(await fs.readFile(chemin, 'utf8')).pid, process.pid);
    assert.equal(lectures, 1, 'une seule lecture pour toute l\'opération');
    await fs.unlink(chemin);
  }));

test('heure de démarrage inconnue (erreur, permission, valeur absurde) : règle actuelle (« bloque »), verrou conservé, avertissement discret', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    await ecrireVerrou(chemin, { pid: process.pid, port: await portLibre() });
    const pannes = [async () => null, async () => { throw Object.assign(new Error('refusé'), { code: 'EPERM' }); }, async () => new Date('pas une date')];
    const messages = [];
    for (const demarrage of pannes) {
      const journal = journalEspion();
      const v = await lireVerrou(donnees, { env, delaiSondeMs: 300, journal, demarrageProcessus: demarrage });
      assert.equal(v.statut, 'bloque');
      messages.push(...journal.lignes);
    }
    assert.ok(messages.length <= 1, `un seul avertissement par PID : ${JSON.stringify(messages)}`);
    if (messages.length === 1) assert.match(messages[0], /heure de démarrage du processus \d+ inconnue/);
    for (const m of messages) assert.ok(!m.includes(donnees), 'aucun chemin de données dans l\'avertissement');
    const r = await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env, delaiSondeMs: 300, patienceMs: 0, demarrageProcessus: async () => null });
    assert.equal(r.statut, 'bloque');
    assert.equal(JSON.parse(await fs.readFile(chemin, 'utf8')).demarreLe, '2020-01-01T00:00:00.000Z', 'jamais supprimé');
  }));

test('PID réutilisé : lecture réelle de l\'heure de démarrage du processus de test (PowerShell, /proc ou ps selon le système)', () =>
  avecDossiers(async ({ donnees, env }) => {
    const debut = await lireDemarrageProcessus(process.pid);
    assert.ok(debut instanceof Date && !Number.isNaN(debut.getTime()), 'heure lue');
    const ecart = Math.abs(debut.getTime() - (Date.now() - process.uptime() * 1000));
    assert.ok(ecart < 60_000, `heure de démarrage cohérente avec la durée d'exécution du processus (écart ${ecart} ms)`);
    const chemin = cheminVerrou(donnees, { env });
    const port = await portLibre();
    await ecrireVerrou(chemin, { pid: process.pid, port, demarreLe: dans(-86_400_000) }); // verrou d'hier, PID vivant : PID réutilisé
    assert.equal((await lireVerrou(donnees, { env, delaiSondeMs: 300 })).statut, 'perime');
    await ecrireVerrou(chemin, { pid: process.pid, port, demarreLe: dans(3_600_000) }); // verrou postérieur au démarrage du processus : même processus
    assert.equal((await lireVerrou(donnees, { env, delaiSondeMs: 300 })).statut, 'bloque');
  }));

test('lireDemarrageProcessus : commandes par système (PowerShell sans profil, ps), pid invalide refusé, erreur remontée', async () => {
  const appels = [];
  const executer = async (commande, args) => {
    appels.push([commande, args]);
    return commande === 'ps' ? 'Mon Oct  5 21:12:34 2026\n' : '2026-10-05T19:12:34.123Z\r\n';
  };
  assert.equal((await lireDemarrageProcessus(4242, { plateforme: 'win32', executer })).toISOString(), '2026-10-05T19:12:34.123Z');
  const [commandeWin, argsWin] = appels[0];
  assert.match(commandeWin, /powershell\.exe$/i);
  assert.ok(argsWin.includes('-NoProfile') && argsWin.includes('-NonInteractive'));
  assert.match(argsWin.at(-1), /Get-Process -Id 4242 .*StartTime\.ToUniversalTime\(\)/);
  const mac = await lireDemarrageProcessus(4242, { plateforme: 'darwin', executer });
  assert.deepEqual(appels[1], ['ps', ['-o', 'lstart=', '-p', '4242']]);
  assert.equal(mac.getFullYear(), 2026);
  for (const mauvais of [0, -1, 1.5, NaN, '12; calc', null]) assert.equal(await lireDemarrageProcessus(mauvais, { plateforme: 'win32', executer }), null);
  assert.equal(appels.length, 2, 'aucune commande lancée pour un pid invalide');
  await assert.rejects(lireDemarrageProcessus(4242, { plateforme: 'win32', executer: async () => { throw new Error('commande absente'); } }));
  assert.equal(await lireDemarrageProcessus(4242, { plateforme: 'win32', executer: async () => 'sortie inattendue' }), null);
});

test('lireDemarrageProcessus Linux : starttime de /proc/<pid>/stat converti avec btime (nom de processus à espaces et parenthèses) ; repli sur ps', async () => {
  const champs = Array.from({ length: 52 }, (_, i) => String(i + 1));
  champs[0] = '4242';
  champs[1] = '(node (a b))';
  champs[2] = 'S';
  champs[21] = '123456'; // champ 22 : starttime, en centièmes de seconde depuis le démarrage du système
  const stat = champs.join(' ');
  const procStat = 'cpu  1 2 3\nbtime 1790000000\nprocesses 99\n';
  const attendu = (1790000000 + 123456 / 100) * 1000;
  assert.equal(analyserDemarrageLinux(stat, procStat).getTime(), attendu);
  assert.equal(analyserDemarrageLinux('', procStat), null);
  assert.equal(analyserDemarrageLinux(stat, 'sans btime'), null);
  const lireFichier = (c) => (c === '/proc/4242/stat' ? stat : procStat);
  assert.equal((await lireDemarrageProcessus(4242, { plateforme: 'linux', lireFichier, executer: async () => assert.fail('aucune commande attendue') })).getTime(), attendu);
  const repli = await lireDemarrageProcessus(4242, { plateforme: 'linux', lireFichier: () => { throw new Error('pas de /proc'); }, executer: async () => 'Mon Oct  5 21:12:34 2026' });
  assert.equal(repli.getFullYear(), 2026);
});

// ------------------------------------------------------------------ Dossier des verrous propre à l'utilisateur

const statDossier = (surcharge) => ({ isDirectory: () => true, uid: 1000, mode: 0o40700, ...surcharge });
const fsAvecLstat = (stat) => ({ ...fsSync, lstatSync: () => stat });

test('dossier des verrous par défaut : refusé (code 2, échec fermé) s\'il appartient à un autre utilisateur, est modifiable par le groupe ou les autres, ou n\'est pas un dossier ordinaire', () =>
  avecDossiers(async ({ donnees, verrous }) => {
    const maison = path.join(verrous, 'maison');
    const systeme = { plateforme: 'linux', maison };
    const dossier = path.join(maison, '.local', 'state', 'suivi-facturation', 'verrous');
    const essai = (stat) => acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env: {}, systeme, uid: 1000, fsApi: fsAvecLstat(stat) });

    await assert.rejects(essai(statDossier({ uid: 4242 })), (e) => e instanceof ErreurConfig && e.codeSortie === 2 && /n'appartient pas à l'utilisateur courant/.test(e.message));
    await assert.rejects(essai(statDossier({ mode: 0o40770 })), (e) => e instanceof ErreurConfig && /modifiable par d'autres comptes/.test(e.message));
    await assert.rejects(essai(statDossier({ mode: 0o40707 })), (e) => e instanceof ErreurConfig && /modifiable par d'autres comptes/.test(e.message));
    await assert.rejects(essai(statDossier({ isDirectory: () => false })), (e) => e instanceof ErreurConfig && /pas un dossier ordinaire/.test(e.message));
    await assert.rejects(lireVerrou(donnees, { env: {}, systeme, uid: 1000, fsApi: fsAvecLstat(statDossier({ uid: 4242 })) }), ErreurConfig, 'la lecture refuse aussi');
    assert.deepEqual(await fs.readdir(dossier), [], 'aucun fichier verrou posé dans un dossier refusé');

    const r = await essai(statDossier({ mode: 0o40755 })); // groupe et autres sans écriture : accepté
    assert.equal(r.statut, 'acquis');
    assert.equal((await fs.readdir(dossier)).length, 1);
  }));

test('dossier des verrous par défaut : créé en 0700, refusé s\'il est ouvert aux autres (droits réels)', { skip: process.platform === 'win32' ? 'droits POSIX : sans objet sous Windows' : false }, () =>
  avecDossiers(async ({ donnees, verrous }) => {
    const maison = path.join(verrous, 'maison');
    const systeme = { plateforme: 'linux', maison };
    const r = await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env: {}, systeme });
    assert.equal(r.statut, 'acquis');
    const dossier = path.dirname(cheminVerrou(donnees, { env: {}, systeme }));
    assert.equal((await fs.stat(dossier)).mode & 0o777, 0o700);
    assert.equal(libererVerrou({ dossierDonnees: donnees, env: {}, systeme }), true);
    await fs.chmod(dossier, 0o777);
    await assert.rejects(acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env: {}, systeme }), (e) => e instanceof ErreurConfig && /modifiable par d'autres comptes/.test(e.message));
    await fs.chmod(dossier, 0o700);
  }));

test('ERGO_VERROU_DIR défini : comportement inchangé, aucun contrôle de propriétaire ni de droits sur ce dossier', () =>
  avecDossiers(async ({ donnees, env }) => {
    const r = await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env, uid: 1000, fsApi: fsAvecLstat(statDossier({ uid: 4242, mode: 0o40777 })) });
    assert.equal(r.statut, 'acquis');
    assert.equal(libererVerrou({ dossierDonnees: donnees, env }), true);
  }));

test('fichier verrou d\'un autre propriétaire : refusé (ErreurConfig), jamais lu comme un verrou valide ni supprimé', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    const faux = await fauxServeur();
    const proprietaire = (uid) => ({ ...fsSync, statSync: (c, ...a) => ({ ...fsSync.statSync(c, ...a), uid }) });
    try {
      await ecrireVerrou(chemin, { pid: process.pid, port: faux.port, demarreLe: dans(-1000) }); // forgé : pointerait vers un faux serveur « actif »
      await assert.rejects(lireVerrou(donnees, { env, uid: 1000, fsApi: proprietaire(4242) }), (e) => e instanceof ErreurConfig && /n'appartient pas à l'utilisateur courant/.test(e.message));
      await assert.rejects(acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env, uid: 1000, fsApi: proprietaire(4242) }), ErreurConfig);
      await fs.access(chemin);
      assert.equal((await lireVerrou(donnees, { env, uid: 1000, fsApi: proprietaire(1000) })).statut, 'actif', 'même verrou, bon propriétaire');
    } finally {
      await faux.fermer();
      await fs.unlink(chemin);
    }
  }));

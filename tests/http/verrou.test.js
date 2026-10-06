// Verrou d'instance (src/verrou.js) : module seul, sans lancer le serveur. Dossiers sous .tmp/tests/, aucune donnée réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ErreurConfig } from '../../src/config.js';
import { acquerirVerrou, cheminVerrou, libererVerrou, lireVerrou, mettreAJourPort } from '../../src/verrou.js';
import { RACINE, creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { portLibre } from '../aides/instance-aide.js';

async function avecDossiers(fn) {
  const donnees = await creerDossierTemp('verrou-donnees');
  const verrous = await creerDossierTemp('verrou-verrous');
  try {
    return await fn({ donnees, verrous, env: { ERGO_VERROU_DIR: verrous } });
  } finally {
    await supprimerDossierTemp(donnees);
    await supprimerDossierTemp(verrous);
  }
}

/** Faux serveur qui répond comme l'application sur /api/sante. */
function fauxServeur(corps = { ok: true, application: 'suivi-facturation', version: 'x' }) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(corps));
    });
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port, fermer: () => new Promise((r) => { s.close(() => r()); s.closeAllConnections(); }) }));
  });
}

/** PID d'un processus qui vient de se terminer (donc mort). */
async function pidMort() {
  const e = spawn(process.execPath, ['-e', '']);
  await new Promise((r) => e.on('close', r));
  return e.pid;
}

/** Heure de démarrage simulée : le processus de test a démarré bien avant l'heure inscrite dans les verrous écrits par ces tests. */
const DEMARRE_AVANT = async () => new Date('2019-01-01T00:00:00.000Z');
const ecrireVerrou = (chemin, v) => fs.writeFile(chemin, JSON.stringify({ version: '0', dossier: 'x', demarreLe: '2020-01-01T00:00:00.000Z', ...v }));

test('cheminVerrou : nom dérivé du chemin réel, dans ERGO_VERROU_DIR, jamais dans le dossier de données', () =>
  avecDossiers(async ({ donnees, verrous, env }) => {
    const c = cheminVerrou(donnees, { env });
    assert.equal(path.dirname(c), verrous);
    assert.match(path.basename(c), /^suivi-facturation-[0-9a-f]{16}\.verrou$/);
    assert.equal(cheminVerrou(donnees, { env }), c, 'stable');
    assert.equal(cheminVerrou(path.join(donnees, '..', path.basename(donnees)), { env }), c, 'chemin détourné : même verrou');
    if (process.platform === 'win32') assert.equal(cheminVerrou(donnees.toUpperCase(), { env }), c, 'minuscules sous Windows');
    assert.throws(() => cheminVerrou(donnees, { env: { ERGO_VERROU_DIR: donnees } }), ErreurConfig, 'pas dans le dossier de données');
    assert.throws(() => cheminVerrou(donnees, { env: { ERGO_VERROU_DIR: path.join(donnees, 'sous') } }), ErreurConfig);
    assert.throws(() => cheminVerrou(donnees, { env: { ERGO_VERROU_DIR: path.join(RACINE, 'src') } }), ErreurConfig);
    assert.throws(() => cheminVerrou(donnees, { env: { ERGO_VERROU_DIR: path.join(RACINE, 'public') } }), ErreurConfig);
    assert.throws(() => cheminVerrou(donnees, { env: { ERGO_VERROU_DIR: path.join(RACINE, 'config') } }), ErreurConfig, 'dans le projet hors .tmp');
  }));

test("cheminVerrou : sans ERGO_VERROU_DIR, dossier propre à l'utilisateur selon le système", () => {
  const donnees = path.join(RACINE, '.tmp', 'quelconque');
  const tmp = path.resolve('/tmp-utilisateur');
  const maison = path.resolve('/maison/utilisateur');
  const xdg = path.resolve('/run/user/1000');
  for (const plateforme of ['win32', 'darwin']) {
    assert.equal(path.dirname(cheminVerrou(donnees, { env: {}, systeme: { plateforme, tmp, maison } })), path.join(tmp, 'suivi-facturation-verrous'), plateforme);
  }
  assert.equal(path.dirname(cheminVerrou(donnees, { env: { XDG_RUNTIME_DIR: xdg }, systeme: { plateforme: 'linux', tmp, maison } })), path.join(xdg, 'suivi-facturation'));
  assert.equal(path.dirname(cheminVerrou(donnees, { env: {}, systeme: { plateforme: 'linux', tmp, maison } })), path.join(maison, '.local', 'state', 'suivi-facturation', 'verrous'));
  assert.equal(path.dirname(cheminVerrou(donnees, { env: { XDG_RUNTIME_DIR: 'relatif' }, systeme: { plateforme: 'linux', tmp, maison } })), path.join(maison, '.local', 'state', 'suivi-facturation', 'verrous'), 'chemin XDG relatif ignoré');
  const reel = cheminVerrou(donnees, { env: {} });
  assert.ok(path.isAbsolute(reel));
  assert.notEqual(path.dirname(reel), os.tmpdir(), 'jamais directement dans le dossier temporaire partagé');
});

test('acquisition puis libération : contenu minimal (pid, port, demarreLe, version, dossier), droits 0600 hors Windows', () =>
  avecDossiers(async ({ donnees, env }) => {
    const r = await acquerirVerrou({ dossierDonnees: donnees, port: 4999, version: '1.2.3', env });
    assert.deepEqual({ statut: r.statut, repris: r.repris }, { statut: 'acquis', repris: false });
    const chemin = cheminVerrou(donnees, { env });
    const v = JSON.parse(await fs.readFile(chemin, 'utf8'));
    assert.deepEqual(Object.keys(v).sort(), ['demarreLe', 'dossier', 'pid', 'port', 'version']);
    assert.equal(v.pid, process.pid);
    assert.equal(v.port, 4999);
    assert.equal(v.version, '1.2.3');
    assert.ok(!Number.isNaN(Date.parse(v.demarreLe)));
    assert.equal(path.resolve(v.dossier).toLowerCase(), path.resolve(donnees).toLowerCase());
    if (process.platform !== 'win32') assert.equal((await fs.stat(chemin)).mode & 0o777, 0o600);
    assert.deepEqual(await fs.readdir(donnees), [], 'rien dans le dossier de données');

    assert.equal(mettreAJourPort({ dossierDonnees: donnees, port: 5000, env }), true);
    assert.equal(JSON.parse(await fs.readFile(chemin, 'utf8')).port, 5000);
    assert.equal(mettreAJourPort({ dossierDonnees: donnees, port: 5000, env }), false, 'inchangé');
    assert.deepEqual((await fs.readdir(path.dirname(chemin))).sort(), [path.basename(chemin)], 'pas de temporaire laissé');

    assert.equal(libererVerrou({ dossierDonnees: donnees, env, pid: process.pid + 1 }), false, "pas le nôtre : conservé");
    await fs.access(chemin);
    assert.equal(libererVerrou({ dossierDonnees: donnees, env }), true);
    await assert.rejects(fs.access(chemin));
    assert.equal(libererVerrou({ dossierDonnees: donnees, env }), false, 'idempotent');
  }));

test('lireVerrou : les 4 statuts', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    const absent = await lireVerrou(donnees, { env });
    assert.deepEqual(absent, { statut: 'absent', pid: null, port: null, demarreLe: null, version: null, dossier: null });

    const mort = await pidMort();
    await ecrireVerrou(chemin, { pid: mort, port: 4780 });
    const perime = await lireVerrou(donnees, { env });
    assert.equal(perime.statut, 'perime');
    assert.equal(perime.pid, mort);
    assert.equal(perime.port, 4780);

    const faux = await fauxServeur();
    try {
      await ecrireVerrou(chemin, { pid: process.pid, port: faux.port });
      const actif = await lireVerrou(donnees, { env });
      assert.equal(actif.statut, 'actif');
      assert.equal(actif.pid, process.pid);
    } finally {
      await faux.fermer();
    }

    // PID vivant, mais la réponse n'est pas celle de l'application (autre programme) ou il n'y a pas de réponse.
    const autre = await fauxServeur({ ok: true, application: 'autre-chose' });
    try {
      await ecrireVerrou(chemin, { pid: process.pid, port: autre.port });
      assert.equal((await lireVerrou(donnees, { env, demarrageProcessus: DEMARRE_AVANT })).statut, 'bloque', 'autre programme sur ce port');
    } finally {
      await autre.fermer();
    }
    await ecrireVerrou(chemin, { pid: process.pid, port: await portLibre() });
    const bloque = await lireVerrou(donnees, { env, delaiSondeMs: 300, demarrageProcessus: DEMARRE_AVANT });
    assert.equal(bloque.statut, 'bloque');
    assert.equal(bloque.pid, process.pid);
    await fs.unlink(chemin);
  }));

test('acquisition : verrou actif -> « actif » sans rien modifier ; PID vivant muet et ancien -> « bloque », verrou conservé', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    const faux = await fauxServeur();
    try {
      await ecrireVerrou(chemin, { pid: process.pid, port: faux.port });
      const avant = await fs.readFile(chemin, 'utf8');
      const r = await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env });
      assert.equal(r.statut, 'actif');
      assert.equal(r.verrou.port, faux.port);
      assert.equal(await fs.readFile(chemin, 'utf8'), avant);
    } finally {
      await faux.fermer();
    }
    await ecrireVerrou(chemin, { pid: process.pid, port: await portLibre() });
    const avant = await fs.readFile(chemin, 'utf8');
    const r = await acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env, delaiSondeMs: 300, demarrageProcessus: DEMARRE_AVANT });
    assert.equal(r.statut, 'bloque');
    assert.equal(await fs.readFile(chemin, 'utf8'), avant, 'jamais supprimé');
  }));

test('acquisition : verrou périmé (PID mort) repris ; contenu illisible aussi', () =>
  avecDossiers(async ({ donnees, env }) => {
    const chemin = cheminVerrou(donnees, { env });
    const mort = await pidMort();
    await ecrireVerrou(chemin, { pid: mort, port: 4780 });
    const r = await acquerirVerrou({ dossierDonnees: donnees, port: 4781, version: 'x', env });
    assert.equal(r.statut, 'acquis');
    assert.equal(r.repris, true);
    assert.equal(r.ancien.pid, mort);
    assert.equal(JSON.parse(await fs.readFile(chemin, 'utf8')).pid, process.pid);
    await fs.unlink(chemin);
    await fs.writeFile(chemin, '{pas du json');
    const r2 = await acquerirVerrou({ dossierDonnees: donnees, port: 4781, version: 'x', env });
    assert.deepEqual({ statut: r2.statut, repris: r2.repris }, { statut: 'acquis', repris: true });
    await fs.unlink(chemin);
  }));

test('course : 8 acquisitions simultanées sur un verrou périmé -> exactement une gagne', () =>
  avecDossiers(async ({ donnees, env }) => {
    for (let tour = 0; tour < 10; tour++) {
      const chemin = cheminVerrou(donnees, { env });
      await ecrireVerrou(chemin, { pid: await pidMort(), port: 4780 });
      const r = await Promise.all(Array.from({ length: 8 }, () => acquerirVerrou({ dossierDonnees: donnees, port: 4781, version: 'x', env, patienceMs: 0, delaiSondeMs: 200 })));
      assert.equal(r.filter((x) => x.statut === 'acquis').length, 1, `tour ${tour} : ${JSON.stringify(r.map((x) => x.statut))}`);
      assert.deepEqual(r.filter((x) => x.statut !== 'acquis').map((x) => x.statut).filter((s) => s !== 'bloque'), []);
      await fs.unlink(chemin);
    }
  }));

test("fichier verrou impossible à créer (dossier des verrous inaccessible) : ErreurConfig, pas d'exception brute", () =>
  avecDossiers(async ({ donnees, verrous }) => {
    const fichier = path.join(verrous, 'je-suis-un-fichier');
    await fs.writeFile(fichier, '');
    await assert.rejects(acquerirVerrou({ dossierDonnees: donnees, port: 1, version: 'x', env: { ERGO_VERROU_DIR: path.join(fichier, 'sous') } }), ErreurConfig);
    await fs.unlink(fichier);
  }));

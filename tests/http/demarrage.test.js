// Démarrage : une seconde instance (port occupé) s'arrête proprement AVANT de toucher au dossier de données.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { DOSSIER_VERROUS_TEST, RACINE, creerDossierTemp, ecrireFichierTest, supprimerDossierTemp } from '../aides/temp.js';
import { CODE_SORTIE_CONFIG } from '../../src/config.js';
import { portEstLibre } from '../../src/http/serveur.js';

const occuperPort = () =>
  new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
const fermer = (s) => new Promise((resolve) => s.close(() => resolve()));

/** Lance `node src/server.js` (processus enfant qui doit se terminer seul) ; renvoie { code, sortie }. */
async function lancerServeur(env) {
  // Le journal du serveur lancé ici va dans un dossier temporaire : jamais dans le vrai logs/ du projet.
  const dossierLog = await creerDossierTemp('demarrage-logs');
  try {
    return await lancerServeurBrut({ ...env, ERGO_LOG_DIR: dossierLog });
  } finally {
    await supprimerDossierTemp(dossierLog);
  }
}

function lancerServeurBrut(env) {
  return new Promise((resolve, reject) => {
    const enfant = spawn(process.execPath, [path.join(RACINE, 'src', 'server.js')], { cwd: RACINE, env: { ...process.env, ERGO_VERROU_DIR: DOSSIER_VERROUS_TEST, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    enfant.stdout.on('data', (m) => (sortie += m));
    enfant.stderr.on('data', (m) => (sortie += m));
    const garde = setTimeout(() => {
      enfant.kill(); // par PID : c'est le processus lancé par ce test
      reject(new Error(`Le serveur ne s'est pas arrêté seul. Sortie : ${sortie}`));
    }, 15_000);
    enfant.on('error', reject);
    enfant.on('close', (code) => {
      clearTimeout(garde);
      resolve({ code, sortie });
    });
  });
}

test('portEstLibre : vrai pour un port libre, faux pour un port occupé', async () => {
  const { s, port } = await occuperPort();
  try {
    assert.equal(await portEstLibre(port), false);
  } finally {
    await fermer(s);
  }
  assert.equal(await portEstLibre(port), true);
});

test("seconde instance : port occupé -> arrêt avec message clair, dossier de données strictement inchangé (pas de nettoyage, pas de sauvegarde, pas de sonde)", async () => {
  const dossier = await creerDossierTemp('demarrage');
  const { s, port } = await occuperPort();
  try {
    const actif = path.join(dossier, 'suivi-facturation.json');
    const temporaire = path.join(dossier, 'suivi-facturation.json.tmp-1-1'); // écriture en cours d'une autre instance
    await ecrireFichierTest(actif, '{"contenu":"inchange"}');
    await ecrireFichierTest(temporaire, 'ecriture en cours');
    const avant = (await fs.readdir(dossier)).sort();

    const { code, sortie } = await lancerServeur({ ERGO_DATA_DIR: dossier, ERGO_PORT: String(port) });

    assert.equal(code, CODE_SORTIE_CONFIG, `sortie : ${sortie}`);
    assert.match(sortie, /Démarrage impossible/);
    assert.match(sortie, new RegExp(`port ${port} est déjà utilisé`));
    assert.match(sortie, /ERGO_PORT/);
    assert.deepEqual((await fs.readdir(dossier)).sort(), avant, 'aucun fichier créé ni supprimé');
    assert.equal(await fs.readFile(temporaire, 'utf8'), 'ecriture en cours', 'le temporaire de l\'autre instance est intact');
    assert.equal(await fs.readFile(actif, 'utf8'), '{"contenu":"inchange"}');
  } finally {
    await fermer(s);
    await supprimerDossierTemp(dossier);
  }
});

test("dossier de données introuvable -> code 2, message en français qui renvoie à « Choisir le dossier de donnees.bat » AVANT la mention technique ERGO_DATA_DIR", async () => {
  const inexistant = path.join(RACINE, '.tmp', 'tests', `n-existe-pas-${process.pid}`);
  const libre = await occuperPort(); // port libre obtenu puis rendu (le port est vérifié avant le dossier)
  await fermer(libre.s);
  const { code, sortie } = await lancerServeur({ ERGO_DATA_DIR: inexistant, ERGO_PORT: String(libre.port) });
  assert.equal(code, CODE_SORTIE_CONFIG, sortie);
  assert.match(sortie, /^Démarrage impossible : Le dossier de données choisi n'existe pas/);
  const iBat = sortie.indexOf('Choisir le dossier de donnees.bat');
  const iVar = sortie.indexOf('ERGO_DATA_DIR');
  assert.ok(iBat > 0, sortie);
  assert.ok(iVar > iBat, 'la mention technique vient après le fichier .bat');
  assert.doesNotMatch(sortie.slice(0, iBat), /ERGO_DATA_DIR|\.env/, 'aucun jargon avant le conseil');
  await assert.rejects(fs.stat(inexistant), { code: 'ENOENT' });
});

test("les messages de ErreurConfig sur le dossier ne contiennent pas ERGO_DATA_DIR (l'outil « Choisir le dossier » les réutilise) ; le conseil est à part", async () => {
  const { lireConfig, verifierDossierDonnees, AIDE_DOSSIER_DONNEES } = await import('../../src/config.js');
  const erreur = await verifierDossierDonnees(lireConfig({ ERGO_DATA_DIR: path.join(RACINE, '.tmp', 'tests', 'n-existe-pas-2') }, RACINE)).catch((e) => e);
  assert.doesNotMatch(erreur.message, /ERGO_DATA_DIR/);
  assert.equal(erreur.aide, AIDE_DOSSIER_DONNEES);
});

test("`npm start` ne dépend plus de --env-file-if-exists (message anglais « not found ») ; .env est chargé par le serveur s'il existe", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(RACINE, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node src/server.js');
  const source = await fs.readFile(path.join(RACINE, 'src', 'server.js'), 'utf8');
  assert.match(source, /existsSync\(path\.join\(RACINE_PROJET, '\.env'\)\)\) process\.loadEnvFile/);
});

test('ERGO_SANS_ENV=1 : le serveur saute le chargement du .env, et les aides de test la posent (tests hermétiques)', async () => {
  const source = await fs.readFile(path.join(RACINE, 'src', 'server.js'), 'utf8');
  assert.match(source, /process\.env\.ERGO_SANS_ENV !== '1' && fs\.existsSync\(path\.join\(RACINE_PROJET, '\.env'\)\)\) process\.loadEnvFile/);
  assert.equal(process.env.ERGO_SANS_ENV, '1', 'posée par tests/aides/temp.js, héritée par les serveurs lancés');
  const aide = await fs.readFile(path.join(RACINE, 'tests', 'aides', 'instance-aide.js'), 'utf8');
  assert.match(aide, /ERGO_SANS_ENV: '1'/);
});

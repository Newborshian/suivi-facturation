// Fonctions pures ou sans effet de bord de scripts/lib-lanceur.mjs (importer le module ne lance rien).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { RACINE, creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import {
  ADRESSE,
  PORT_DEFAUT,
  cheminVerrouLancement,
  dossierDonnees,
  estProgrammeNode,
  lireMessageLanceur,
  lirePortDemande,
  nomProcessus,
  pidVivant,
  portEstLibre,
  sonderSante,
} from '../../scripts/lib-lanceur.mjs';

test('estProgrammeNode : node, node.exe, nodejs (anciens paquets), sans tenir compte de la casse ; rien d\'autre', () => {
  for (const nom of ['node', 'node.exe', 'NODE.EXE', 'Node', 'nodejs', 'nodejs.exe']) assert.equal(estProgrammeNode(nom), true, nom);
  for (const nom of ['nodemon', 'node.exe.bak', 'xnode', 'node2', 'chrome.exe', 'python', '', ' node', 'node ', 'node.cmd', null, undefined, 42]) assert.equal(estProgrammeNode(nom), false, String(nom));
});

test('lirePortDemande : vide = port par défaut non défini ; entier de 1 à 65535 accepté ; le reste invalide (null)', () => {
  assert.deepEqual(lirePortDemande({}), { defini: false, port: PORT_DEFAUT, brut: '' });
  assert.equal(lirePortDemande({ ERGO_PORT: '   ' }).defini, false);
  assert.deepEqual(lirePortDemande({ ERGO_PORT: ' 4800 ' }), { defini: true, port: 4800, brut: '4800' });
  assert.equal(lirePortDemande({ ERGO_PORT: '1' }).port, 1);
  assert.equal(lirePortDemande({ ERGO_PORT: '65535' }).port, 65535);
  for (const brut of ['0', '65536', '-1', '47.5', '4e3', 'abc', '0x10', '4780a']) assert.deepEqual(lirePortDemande({ ERGO_PORT: brut }), { defini: true, port: null, brut }, brut);
});

test('dossierDonnees : même résultat que le serveur, jamais d\'exception (valeur invalide -> repli sur le dossier demandé)', () => {
  assert.equal(dossierDonnees({}), path.join(RACINE, 'data'));
  assert.equal(dossierDonnees({ ERGO_DATA_DIR: '' }), path.join(RACINE, 'data'));
  assert.doesNotThrow(() => dossierDonnees({ ERGO_DATA_DIR: 'public' }));
  assert.doesNotThrow(() => dossierDonnees({ ERGO_DATA_DIR: '\0' }));
});

test('pidVivant : le processus courant l\'est ; PID invalide, nul ou négatif ne l\'est pas', () => {
  assert.equal(pidVivant(process.pid), true);
  for (const pid of [0, -1, 1.5, NaN, '123', null, undefined, Number.MAX_SAFE_INTEGER + 1]) assert.equal(pidVivant(pid), false, String(pid));
});

test('nomProcessus : le nom du processus courant est un programme node ; un PID invalide donne null', () => {
  assert.equal(estProgrammeNode(nomProcessus(process.pid)), true);
  assert.equal(nomProcessus(0), null);
  assert.equal(nomProcessus(-5), null);
  assert.equal(nomProcessus('abc'), null);
});

test('cheminVerrouLancement : voisin du verrou d\'instance, suffixe .lancement, propre au dossier de données', async () => {
  const verrous = await creerDossierTemp('lib-verrous');
  try {
    const env = { ERGO_VERROU_DIR: verrous };
    const a = cheminVerrouLancement(path.join(RACINE, '.tmp', 'tests', 'a'), env);
    const b = cheminVerrouLancement(path.join(RACINE, '.tmp', 'tests', 'b'), env);
    assert.ok(a.endsWith('.verrou.lancement'));
    assert.notEqual(a, b);
    assert.equal(a, cheminVerrouLancement(path.join(RACINE, '.tmp', 'tests', 'a'), env), 'stable pour un même dossier');
    assert.equal(path.dirname(a), path.dirname(b), 'même dossier pour les verrous de lancement');
  } finally {
    await supprimerDossierTemp(verrous);
  }
});

test('lireMessageLanceur : lit « journal=… » puis le message (fins de ligne Windows comprises) ; fichier absent -> null', async () => {
  const dossier = await creerDossierTemp('lib-message');
  try {
    const fichier = path.join(dossier, 'message.txt');
    assert.equal(lireMessageLanceur({ ERGO_LANCEUR_MESSAGE: fichier }), null);
    fs.writeFileSync(fichier, 'journal=C:\\x\\suivi.log\r\nPremière ligne.\r\nSeconde ligne.\r\n');
    assert.deepEqual(lireMessageLanceur({ ERGO_LANCEUR_MESSAGE: fichier }), { journal: 'C:\\x\\suivi.log', message: 'Première ligne.\nSeconde ligne.' });
    fs.writeFileSync(fichier, 'Message sans journal.\n');
    assert.deepEqual(lireMessageLanceur({ ERGO_LANCEUR_MESSAGE: fichier }), { journal: null, message: 'Message sans journal.' });
  } finally {
    await supprimerDossierTemp(dossier);
  }
});

test('portEstLibre et sonderSante : un port occupé par autre chose n\'est pas « notre application » ; port invalide -> null', async () => {
  const autre = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end('{"application":"autre-chose"}');
  });
  await new Promise((resolve) => autre.listen(0, ADRESSE, resolve));
  const { port } = autre.address();
  try {
    assert.equal(await portEstLibre(port), false);
    assert.equal(await sonderSante(port), null, 'une autre application sur ce port n\'est pas reconnue');
  } finally {
    await new Promise((resolve) => autre.close(resolve));
  }
  assert.equal(await portEstLibre(port), true, 'libre une fois le serveur fermé');
  for (const invalide of [0, -1, 70000, 1.5, 'x', undefined]) assert.equal(await sonderSante(invalide), null, String(invalide));
});

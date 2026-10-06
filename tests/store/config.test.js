import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE, creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { ErreurConfig, PORT_DEFAUT, lireConfig, verifierDossierDonnees } from '../../src/config.js';

test('lireConfig : valeurs par défaut (data/ du projet, port 4780)', () => {
  const c = lireConfig({}, RACINE);
  assert.equal(c.dossier, path.join(RACINE, 'data'));
  assert.equal(c.dossierParDefaut, true);
  assert.equal(c.port, PORT_DEFAUT);
  assert.equal(PORT_DEFAUT, 4780);
});

test('lireConfig : ERGO_DATA_DIR absolu, relatif (à la racine du projet) et vide', () => {
  const abs = path.join(RACINE, '.tmp', 'quelque-part');
  assert.equal(lireConfig({ ERGO_DATA_DIR: abs }, RACINE).dossier, abs);
  assert.equal(lireConfig({ ERGO_DATA_DIR: abs }, RACINE).dossierParDefaut, false);
  assert.equal(lireConfig({ ERGO_DATA_DIR: 'mes-donnees' }, RACINE).dossier, path.join(RACINE, 'mes-donnees'));
  assert.equal(lireConfig({ ERGO_DATA_DIR: '   ' }, RACINE).dossierParDefaut, true);
});

test('lireConfig : ERGO_PORT valide ou refusé', () => {
  assert.equal(lireConfig({ ERGO_PORT: '5000' }, RACINE).port, 5000);
  for (const mauvais of ['0', '65536', '-1', 'abc', '80.5', '1e3', '0x50']) {
    assert.throws(() => lireConfig({ ERGO_PORT: mauvais }, RACINE), ErreurConfig, mauvais);
  }
});

test('verifierDossierDonnees : dossier explicite inexistant = refus, rien n\'est créé', async () => {
  const inexistant = path.join(RACINE, '.tmp', 'tests', 'n-existe-pas-du-tout');
  const config = lireConfig({ ERGO_DATA_DIR: inexistant }, RACINE);
  await assert.rejects(verifierDossierDonnees(config), (e) => e instanceof ErreurConfig && e.codeSortie === 2 && /n'existe pas/.test(e.message));
  await assert.rejects(fs.stat(inexistant), { code: 'ENOENT' });
});

test('verifierDossierDonnees : dossier existant et inscriptible accepté, sonde supprimée', async () => {
  const d = await creerDossierTemp('config');
  try {
    const reel = await verifierDossierDonnees(lireConfig({ ERGO_DATA_DIR: d }, RACINE));
    assert.equal(reel, await fs.realpath(d));
    assert.deepEqual(await fs.readdir(d), []);
  } finally {
    await supprimerDossierTemp(d);
  }
});

test('verifierDossierDonnees : un fichier à la place du dossier est refusé', async () => {
  const d = await creerDossierTemp('config');
  try {
    const fichier = path.join(d, 'fichier.txt');
    await fs.writeFile(fichier, 'x');
    await assert.rejects(verifierDossierDonnees(lireConfig({ ERGO_DATA_DIR: fichier }, RACINE)), /ne désigne pas un dossier/);
  } finally {
    await supprimerDossierTemp(d);
  }
});

test('verifierDossierDonnees : refuse un dossier dans public/ ou src/ (ou ces dossiers eux-mêmes)', async () => {
  for (const interdit of ['public', path.join('public', 'css'), 'src', path.join('src', 'domain')]) {
    const config = lireConfig({ ERGO_DATA_DIR: path.join(RACINE, interdit) }, RACINE);
    await assert.rejects(verifierDossierDonnees(config), (e) => e instanceof ErreurConfig && /ne peut pas se trouver/.test(e.message), interdit);
  }
});

/** Faux projet jetable : public/, src/, data/, .tmp/ et un dossier « donnees » quelconque. Lien de dossier (junction) : null si impossible. */
async function avecFauxProjet(fn) {
  const base = await creerDossierTemp('config-projet');
  try {
    const racine = path.join(base, 'projet');
    for (const d of ['public', 'src', 'data', '.tmp', 'donnees', 'ailleurs-du-projet']) await fs.mkdir(path.join(racine, d), { recursive: true });
    await fs.mkdir(path.join(base, 'dehors'));
    const lien = async (chemin, cible) => {
      try {
        await fs.symlink(cible, chemin, 'junction');
        return true;
      } catch {
        return false; // création de liens impossible sur ce poste : le cas est ignoré
      }
    };
    await fn({ racine, base, lien });
  } finally {
    // Les liens sont retirés avant le nettoyage (rmdir du lien, jamais de suppression de la cible).
    for (const l of [path.join(base, 'projet', 'data', 'lien-interne'), path.join(base, 'projet', 'data', 'lien-sortie'), path.join(base, 'projet', '.tmp', 'lien-vers-donnees')]) {
      await fs.rmdir(l).catch(() => {});
    }
    await supprimerDossierTemp(base);
  }
}

const verifierAvec = (racine, valeur) => verifierDossierDonnees(lireConfig({ ERGO_DATA_DIR: valeur }, racine));
const refuseDansProjet = (e) => e instanceof ErreurConfig && e.codeSortie === 2 && /ne peut pas se trouver dans le projet/.test(e.message);

test('verifierDossierDonnees : un dossier du projet autre que data/ et .tmp/ est refusé avec un message clair', () =>
  avecFauxProjet(async ({ racine }) => {
    for (const valeur of ['donnees', 'ailleurs-du-projet', '.', path.join(racine, 'donnees'), path.join('data', '..', 'donnees'), path.join('.tmp', '..', 'donnees'), path.join('donnees', '.', '..', 'donnees')]) {
      await assert.rejects(verifierAvec(racine, valeur), refuseDansProjet, valeur);
    }
    // Rien n'a été écrit dans le dossier refusé (pas même la sonde d'écriture).
    assert.deepEqual(await fs.readdir(path.join(racine, 'donnees')), []);
    // Le message dit quoi faire.
    await assert.rejects(verifierAvec(racine, 'donnees'), /en dehors du projet/);
  }));

test('verifierDossierDonnees : data/, .tmp/ et leurs sous-dossiers sont admis ; un dossier hors du projet aussi', () =>
  avecFauxProjet(async ({ racine, base }) => {
    await fs.mkdir(path.join(racine, 'data', 'sous'));
    for (const valeur of ['data', 'data/sous', '.tmp', path.join(racine, 'data'), path.join(base, 'dehors')]) {
      assert.equal(await verifierAvec(racine, valeur), await fs.realpath(path.resolve(racine, valeur)), valeur);
    }
  }));

test('verifierDossierDonnees : un lien (junction) ne contourne pas la règle, dans les deux sens', () =>
  avecFauxProjet(async ({ racine, base, lien }) => {
    // data/lien-interne -> donnees (dans le projet) : refusé ; .tmp/lien-vers-donnees -> donnees : refusé.
    if (await lien(path.join(racine, 'data', 'lien-interne'), path.join(racine, 'donnees'))) {
      await assert.rejects(verifierAvec(racine, path.join('data', 'lien-interne')), refuseDansProjet);
    }
    if (await lien(path.join(racine, '.tmp', 'lien-vers-donnees'), path.join(racine, 'donnees'))) {
      await assert.rejects(verifierAvec(racine, path.join('.tmp', 'lien-vers-donnees')), refuseDansProjet);
    }
    // data/lien-sortie -> dossier hors du projet : le dossier réel est hors du projet, donc admis.
    if (await lien(path.join(racine, 'data', 'lien-sortie'), path.join(base, 'dehors'))) {
      assert.equal(await verifierAvec(racine, path.join('data', 'lien-sortie')), await fs.realpath(path.join(base, 'dehors')));
    }
  }));

test('verifierDossierDonnees : dossier non inscriptible refusé (écriture simulée en échec)', async () => {
  const d = await creerDossierTemp('config');
  try {
    const fsRefus = { ...fs, writeFile: async () => { throw Object.assign(new Error('refusé'), { code: 'EACCES' }); } };
    await assert.rejects(verifierDossierDonnees(lireConfig({ ERGO_DATA_DIR: d }, RACINE), { fs: fsRefus }), /pas accessible en écriture/);
  } finally {
    await supprimerDossierTemp(d);
  }
});

test('verifierDossierDonnees : le dossier par défaut est créé s\'il manque (fs simulé, data/ réel jamais touché)', async () => {
  const d = await creerDossierTemp('config');
  try {
    const cible = path.join(d, 'data');
    const config = { dossier: cible, dossierParDefaut: true, port: 1, racine: RACINE };
    await verifierDossierDonnees(config);
    assert.ok((await fs.stat(cible)).isDirectory());
    await fs.rmdir(cible);
  } finally {
    await supprimerDossierTemp(d);
  }
});

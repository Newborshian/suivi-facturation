// ERGO_LOG_DIR et ERGO_VERROU_DIR : un lien symbolique ou une jonction ne doit pas détourner le dossier vers public/, src/ ou le reste du projet
// (même règle que pour ERGO_DATA_DIR : comparaison sur les chemins réels). Les cas qui exigent un lien sont ignorés si le poste ne permet pas d'en créer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ErreurConfig, RACINE_PROJET, resoudreDossierJournal } from '../../src/config.js';
import { cheminVerrou } from '../../src/verrou.js';
import { creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';

/** Crée un lien de dossier ; renvoie false (cas ignoré) si le poste l'interdit. */
async function lier(chemin, cible) {
  try {
    await fs.symlink(cible, chemin, 'junction');
    return true;
  } catch {
    return false;
  }
}

/** Retire un lien sans toucher à sa cible (rmdir pour une jonction, unlink pour un lien symbolique POSIX). */
async function delier(chemin) {
  await fs.rmdir(chemin).catch(() => fs.unlink(chemin).catch(() => {}));
}

/** Faux projet jetable : public/, src/, logs/, .tmp/, docs/ et un dossier « dehors » à côté. */
async function avecFauxProjet(fn) {
  const base = await creerDossierTemp('emplacements-liens');
  const liens = [];
  try {
    const racine = path.join(base, 'projet');
    for (const d of ['public', 'src', 'logs', '.tmp', 'docs']) await fs.mkdir(path.join(racine, d), { recursive: true });
    await fs.mkdir(path.join(base, 'dehors'));
    const lien = async (chemin, cible) => {
      const ok = await lier(chemin, cible);
      if (ok) liens.push(chemin);
      return ok;
    };
    await fn({ racine, base, lien });
  } finally {
    for (const l of liens) await delier(l);
    await supprimerDossierTemp(base);
  }
}

const refus = (e) => e instanceof ErreurConfig && e.codeSortie === 2;
const journal = (racine, valeur) => () => resoudreDossierJournal({ ERGO_LOG_DIR: valeur }, racine);

test('ERGO_LOG_DIR : un lien dans .tmp/ ou logs/ vers public/, src/ ou le reste du projet est refusé (code 2), message explicite', () =>
  avecFauxProjet(async ({ racine, lien }) => {
    for (const [nomLien, cible, attendu] of [
      [path.join('.tmp', 'vers-public'), 'public', /dans « public »/],
      [path.join('.tmp', 'vers-src'), 'src', /dans « src »/],
      [path.join('logs', 'vers-docs'), 'docs', /hors « logs » et « \.tmp »/],
      [path.join('.tmp', 'vers-racine'), '.', /hors « logs » et « \.tmp »/],
    ]) {
      if (!(await lien(path.join(racine, nomLien), path.join(racine, cible)))) continue;
      assert.throws(journal(racine, nomLien), (e) => refus(e) && attendu.test(e.message) && /lien symbolique ou une jonction/.test(e.message), nomLien);
      // Un sous-dossier (même inexistant) derrière le lien est refusé aussi.
      assert.throws(journal(racine, path.join(nomLien, 'sous', 'dossier')), refus, `${nomLien}/sous/dossier`);
    }
  }));

test('ERGO_LOG_DIR : un lien vers un dossier hors du projet, ou un lien interne vers un sous-dossier admis, est accepté', () =>
  avecFauxProjet(async ({ racine, base, lien }) => {
    await fs.mkdir(path.join(racine, 'logs', 'archives'));
    if (await lien(path.join(racine, '.tmp', 'vers-dehors'), path.join(base, 'dehors'))) {
      assert.equal(resoudreDossierJournal({ ERGO_LOG_DIR: path.join('.tmp', 'vers-dehors') }, racine), path.join(racine, '.tmp', 'vers-dehors'));
    }
    if (await lien(path.join(racine, '.tmp', 'vers-logs'), path.join(racine, 'logs', 'archives'))) {
      assert.doesNotThrow(journal(racine, path.join('.tmp', 'vers-logs')));
    }
    // Sans lien : dossiers ordinaires, comportement inchangé.
    assert.doesNotThrow(journal(racine, 'logs'));
    assert.doesNotThrow(journal(racine, path.join('.tmp', 'nouveau', 'dossier')));
    assert.doesNotThrow(journal(racine, path.join(base, 'dehors')));
  }));

test('ERGO_LOG_DIR : un lien situé hors du projet et pointant dans public/ ou dans le projet est refusé', () =>
  avecFauxProjet(async ({ racine, base, lien }) => {
    if (await lien(path.join(base, 'dehors', 'vers-public'), path.join(racine, 'public'))) {
      assert.throws(journal(racine, path.join(base, 'dehors', 'vers-public')), (e) => refus(e) && /dans « public »/.test(e.message));
    }
    if (await lien(path.join(base, 'dehors', 'vers-docs'), path.join(racine, 'docs'))) {
      assert.throws(journal(racine, path.join(base, 'dehors', 'vers-docs')), refus);
    }
  }));

test('ERGO_VERROU_DIR : un lien (placé sous .tmp/) vers public/, src/ ou le reste du projet est refusé (code 2), message explicite', async () => {
  const base = await creerDossierTemp('verrou-liens');
  const liens = [];
  try {
    const donnees = path.join(base, 'donnees');
    await fs.mkdir(donnees);
    for (const [nomLien, cible, attendu] of [
      ['vers-public', 'public', /dans « public »/],
      ['vers-src', 'src', /dans « src »/],
      ['vers-config', 'config', /hors « \.tmp »/],
    ]) {
      const chemin = path.join(base, nomLien);
      if (!(await lier(chemin, path.join(RACINE_PROJET, cible)))) continue;
      liens.push(chemin);
      for (const valeur of [chemin, path.join(chemin, 'sous')]) {
        assert.throws(() => cheminVerrou(donnees, { env: { ERGO_VERROU_DIR: valeur } }), (e) => refus(e) && attendu.test(e.message) && /lien symbolique ou une jonction/.test(e.message), valeur);
      }
    }
  } finally {
    for (const l of liens) await delier(l);
    await supprimerDossierTemp(base);
  }
});

test('ERGO_VERROU_DIR : un dossier ordinaire sous .tmp/ ou un lien vers un autre dossier de .tmp/ est accepté', async () => {
  const base = await creerDossierTemp('verrou-liens-ok');
  const liens = [];
  try {
    const donnees = path.join(base, 'donnees');
    const verrous = path.join(base, 'verrous');
    await fs.mkdir(donnees);
    await fs.mkdir(verrous);
    assert.equal(path.dirname(cheminVerrou(donnees, { env: { ERGO_VERROU_DIR: verrous } })), path.resolve(verrous));
    const chemin = path.join(base, 'lien-verrous');
    if (await lier(chemin, verrous)) {
      liens.push(chemin);
      assert.doesNotThrow(() => cheminVerrou(donnees, { env: { ERGO_VERROU_DIR: chemin } }));
    }
  } finally {
    for (const l of liens) await delier(l);
    await supprimerDossierTemp(base);
  }
});

// Dossiers temporaires des tests : <projet>/.tmp/tests/<nom-unique>/ (jamais data/, jamais hors du projet).
// Nettoyage : unlink fichier par fichier puis rmdir, strictement limité à .tmp/tests/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = path.join(RACINE, '.tmp', 'tests');

// Tests hermétiques : les serveurs lancés par les tests (héritent de cet environnement) ne chargent pas le .env du poste (src/server.js).
process.env.ERGO_SANS_ENV = '1';
let n = 0;

export async function creerDossierTemp(nom = 'test') {
  const dossier = path.join(BASE, `${nom}-${process.pid}-${Date.now()}-${++n}`);
  await fs.mkdir(dossier, { recursive: true });
  return dossier;
}

async function viderEtSupprimer(dossier) {
  for (const entree of await fs.readdir(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory() && !entree.isSymbolicLink()) await viderEtSupprimer(chemin);
    else await fs.unlink(chemin);
  }
  await fs.rmdir(dossier);
}

/**
 * Écrit un fichier de test en réessayant si Windows le tient un instant (antivirus, indexeur : EBUSY/EPERM/EACCES).
 * À utiliser pour tout fichier écrit directement par un test dans un dossier de données.
 */
export async function ecrireFichierTest(chemin, contenu, { essais = 8, pause = 60 } = {}) {
  for (let essai = 1; ; essai++) {
    try {
      await fs.writeFile(chemin, contenu);
      return;
    } catch (err) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code) || essai >= essais) throw err;
      await new Promise((resolve) => setTimeout(resolve, pause * essai));
    }
  }
}

export async function supprimerDossierTemp(dossier) {
  const rel = path.relative(BASE, dossier);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refus de supprimer hors de .tmp/tests : ${dossier}`);
  }
  // Windows tient parfois un fichier un instant (antivirus, indexeur) : on réessaie, puis on le dit (jamais d'échec silencieux).
  let derniere;
  for (let essai = 1; essai <= 6; essai++) {
    try {
      await viderEtSupprimer(dossier);
      return;
    } catch (err) {
      if (err.code === 'ENOENT') return;
      derniere = err;
      await new Promise((resolve) => setTimeout(resolve, 50 * essai));
    }
  }
  process.stderr.write(`Nettoyage impossible de ${dossier} : ${derniere?.code ?? derniere}
`);
}

/** Dossier des fichiers verrou (ERGO_VERROU_DIR) des serveurs lancés par les tests : jamais le dossier temporaire du système. */
export const DOSSIER_VERROUS_TEST = path.join(BASE, 'verrous');

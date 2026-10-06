// Écriture atomique : fichier temporaire (même dossier) -> fsync -> rename de remplacement.
// Sous Windows, rename échoue (EPERM/EBUSY/EACCES) si un autre programme tient le fichier
// (client de synchro, antivirus) : nouvelles tentatives avec attentes croissantes.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { MODE_FICHIER } from '../droits.js';
import { ErreurApp } from '../erreurs.js';

export const DELAIS_DEFAUT = [50, 100, 200, 400, 800]; // une première tentative puis 5 nouvelles
const CODES_VERROU = new Set(['EPERM', 'EBUSY', 'EACCES']);
const attendreVraiment = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let compteur = 0;

const MOTIFS_TEMPORAIRES = [/^suivi-facturation\.json\.tmp-\d+-\d+$/, /^archive-\d{4}\.json\.tmp-\d+-\d+$/];

export async function ecrireAtomique(chemin, contenu, { fs = fsp, delais = DELAIS_DEFAUT, attendre = attendreVraiment } = {}) {
  const tmp = `${chemin}.tmp-${process.pid}-${++compteur}`;
  try {
    const poignee = await fs.open(tmp, 'wx', MODE_FICHIER); // le rename conserve ces droits : fichier final en 0600 (POSIX)
    try {
      await poignee.writeFile(contenu);
      await poignee.sync();
    } finally {
      await poignee.close();
    }
    for (let essai = 0; ; essai++) {
      try {
        await fs.rename(tmp, chemin);
        return;
      } catch (err) {
        if (!CODES_VERROU.has(err.code)) throw err;
        if (essai >= delais.length) {
          throw new ErreurApp(503, 'FICHIER_VERROUILLE', "Le fichier de données est utilisé par un autre programme (synchronisation, antivirus). L'enregistrement n'a pas été fait ; réessayez dans un instant. Rien n'est perdu.");
        }
        await attendre(delais[essai]);
      }
    }
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    if (err instanceof ErreurApp) throw err;
    throw new ErreurApp(503, 'ECRITURE_ECHOUEE', "L'enregistrement a échoué (disque plein ou dossier inaccessible). Les données précédentes sont intactes.");
  }
}

/** Supprime les temporaires orphelins (motifs exacts uniquement). Renvoie les noms supprimés. */
export async function nettoyerTemporaires(dossier, { fs = fsp } = {}) {
  let noms;
  try {
    noms = await fs.readdir(dossier);
  } catch {
    return [];
  }
  const supprimes = [];
  for (const nom of noms) {
    if (!MOTIFS_TEMPORAIRES.some((re) => re.test(nom))) continue;
    try {
      await fs.unlink(path.join(dossier, nom));
      supprimes.push(nom);
    } catch {
      // temporaire occupé : sans conséquence, il sera retenté au prochain démarrage
    }
  }
  return supprimes;
}

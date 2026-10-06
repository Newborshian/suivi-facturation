// Empreinte du fichier actif et résumé d'une version, pour la détection de conflit de synchro
// (niveau minimal, architecture §7.6). Les copies de conflit créées par un client de synchronisation ne sont pas détectées ; l'écran de résolution existe (public/js/conflit.js).
import { createHash } from 'node:crypto';
import path from 'node:path';
import { SOUS_DOSSIER_SAUVEGARDES, instantSauvegarde, listerSauvegardes } from './sauvegardes.js';

export function sha256(octets) {
  return createHash('sha256').update(octets).digest('hex');
}

export function empreinteDe(stat, octets) {
  return { mtimeMs: stat.mtimeMs, taille: stat.size, sha256: sha256(octets) };
}

/** Chiffres comparables d'une version (nombre de prestations, révision, date de dernière modification). */
export function resumerVersion(octets) {
  try {
    const donnees = JSON.parse(octets.toString('utf8').replace(/^﻿/, ''));
    return {
      lisible: true,
      nombrePrestations: Array.isArray(donnees.prestations) ? donnees.prestations.length : null,
      revision: Number.isSafeInteger(donnees.revision) ? donnees.revision : null,
      majLe: typeof donnees.majLe === 'string' ? donnees.majLe : null,
    };
  } catch {
    return { lisible: false, nombrePrestations: null, revision: null, majLe: null };
  }
}

/**
 * Conflit non résolu au démarrage (choix de conception) : le conflit n'est mémorisé qu'en mémoire, mais ses deux copies
 * (`conflit-memoire`, `conflit-disque`) restent dans `sauvegardes/`. Une copie `conflit-memoire` plus récente (date du fichier
 * sur le disque) que le fichier actif signifie qu'aucune restauration ni écriture n'a eu lieu depuis : le conflit n'a pas été résolu.
 * `mtimeActif` : date de modification du fichier actif. -> même forme que `conflit` (`type: 'non-resolu'`) ou null.
 */
export async function chercherConflitNonResolu({ dossier, fs, mtimeActif }) {
  const copies = (await listerSauvegardes({ dossier, fs })).filter((s) => s.raison === 'conflit-memoire');
  const derniere = copies[copies.length - 1];
  if (!derniere) return null;
  const lire = async (nom) => {
    const chemin = path.join(dossier, SOUS_DOSSIER_SAUVEGARDES, nom);
    const stat = await fs.stat(chemin);
    return { stat, octets: await fs.readFile(chemin) };
  };
  try {
    const application = await lire(derniere.nom);
    if (!(application.stat.mtimeMs > mtimeActif)) return null;
    const jumelle = (await listerSauvegardes({ dossier, fs })).find((s) => s.raison === 'conflit-disque' && s.jour === derniere.jour && s.heure === derniere.heure);
    const disque = jumelle ? await lire(jumelle.nom).catch(() => null) : null;
    return {
      type: 'non-resolu',
      detecteLe: instantSauvegarde(derniere).toISOString(),
      disque: disque ? resumerVersion(disque.octets) : null,
      application: resumerVersion(application.octets),
      sauvegardes: { disque: disque ? jumelle.nom : null, application: derniere.nom },
    };
  } catch {
    return null; // un rappel ne doit jamais empêcher le démarrage
  }
}

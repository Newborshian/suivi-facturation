// Lecture et contrôle des sauvegardes avant restauration (architecture §7.4). Pas d'écriture ici.
// Une sauvegarde est restaurable si elle est du bon format, de version <= courante, migrable et de structure valide.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FORMAT, MIGRATIONS, VERSION_COURANTE, controlerStructure, migrer } from '../domain/schema.js';
import { SOUS_DOSSIER_SAUVEGARDES, listerSauvegardes } from './sauvegardes.js';

/**
 * Analyse le contenu d'une sauvegarde. Les messages ne contiennent aucune donnée issue du fichier.
 * -> { ok: true, etat (migré, de version courante), schemaVersion } | { ok: false, code: 'illisible' | 'incompatible', message }
 */
export function analyserContenu(octets, migrations = MIGRATIONS) {
  let donnees;
  try {
    donnees = JSON.parse(octets.toString('utf8').replace(/^﻿/, ''));
  } catch {
    return { ok: false, code: 'illisible', message: "Cette sauvegarde est abîmée (le fichier n'est pas lisible). Elle ne peut pas être restaurée ; vos données actuelles n'ont pas été touchées." };
  }
  if (typeof donnees !== 'object' || donnees === null || donnees.format !== FORMAT || !Number.isSafeInteger(donnees.schemaVersion) || donnees.schemaVersion < 0) {
    return { ok: false, code: 'illisible', message: "Ce fichier n'est pas une sauvegarde de l'application. Il ne peut pas être restauré ; vos données actuelles n'ont pas été touchées." };
  }
  if (donnees.schemaVersion > VERSION_COURANTE) {
    return { ok: false, code: 'incompatible', message: "Cette sauvegarde a été créée par une version plus récente de l'application. Elle ne peut pas être restaurée ici ; vos données actuelles n'ont pas été touchées." };
  }
  let etat = donnees;
  if (donnees.schemaVersion < VERSION_COURANTE) {
    try {
      etat = migrer(donnees, migrations);
    } catch {
      return { ok: false, code: 'incompatible', message: "Cette sauvegarde est trop ancienne pour être convertie. Elle ne peut pas être restaurée ; vos données actuelles n'ont pas été touchées." };
    }
  }
  if (controlerStructure(etat).length > 0) {
    return { ok: false, code: 'illisible', message: "Le contenu de cette sauvegarde est incohérent. Elle ne peut pas être restaurée ; vos données actuelles n'ont pas été touchées." };
  }
  return { ok: true, etat, schemaVersion: donnees.schemaVersion };
}

/** Aperçu minimal d'une sauvegarde pour la liste et la confirmation : nombre de prestations, période couverte, révision. */
export function resumerSauvegarde(octets, migrations = MIGRATIONS) {
  const verdict = analyserContenu(octets, migrations);
  if (!verdict.ok) return { lisible: false, restaurable: false, raisonRefus: verdict.message };
  const { etat } = verdict;
  const dates = etat.prestations.map((l) => l.date).sort();
  return {
    lisible: true,
    restaurable: true,
    raisonRefus: null,
    schemaVersion: verdict.schemaVersion,
    nombrePrestations: etat.prestations.length,
    nombrePatients: etat.patients.length, // registre ; pour une sauvegarde de version 1, registre reconstruit en mémoire par la migration
    premiereDate: dates[0] ?? null,
    derniereDate: dates[dates.length - 1] ?? null,
    revision: etat.revision,
    majLe: etat.majLe,
  };
}

/** Liste détaillée (taille, lisibilité, nombre de prestations…) : chaque fichier est lu et contrôlé ; une sauvegarde abîmée n'empêche pas la liste. */
export async function listerSauvegardesDetaillees({ dossier, fs = fsp, migrations = MIGRATIONS }) {
  const liste = await listerSauvegardes({ dossier, fs, avecTaille: true });
  for (const s of liste) {
    let resume;
    try {
      resume = resumerSauvegarde(await fs.readFile(path.join(dossier, SOUS_DOSSIER_SAUVEGARDES, s.nom)), migrations);
    } catch {
      resume = { lisible: false, restaurable: false, raisonRefus: "Cette sauvegarde n'a pas pu être lue (fichier occupé ou inaccessible)." };
    }
    Object.assign(s, resume);
  }
  return liste;
}

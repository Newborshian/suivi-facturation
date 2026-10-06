// Lecture simple des archives annuelles `archive-AAAA.json` du dossier de données (export, vérification du catalogue).
// Lecture seule. La gestion complète des archives (création, cache, désarchivage) viendra plus tard (futur module archives.js).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FORMAT, VERSION_COURANTE, controlerStructure } from '../domain/schema.js';

const MOTIF_ARCHIVE = /^archive-(\d{4})\.json$/;
export const FORMAT_ARCHIVE = 'suivi-facturation-archive';

const dejaSignalees = new Set(); // une archive abîmée n'est écrite qu'une fois au journal par dossier et par lancement

/** Les lignes d'une archive ont-elles la structure d'une prestation ? (même contrôle que le fichier actif) */
function structureValide(prestations) {
  const etat = { format: FORMAT, schemaVersion: VERSION_COURANTE, revision: 0, majLe: '', parametres: { sauvegardesConservees: 30, dernierModePaiement: null }, catalogue: [], prestations };
  return controlerStructure(etat).length === 0;
}

/**
 * -> { archives: { '2025': objet archive }, illisibles: ['2024', …] }.
 * Une archive illisible, tronquée ou dont les lignes n'ont pas la structure attendue est IGNORÉE (jamais d'erreur côté appelant) :
 * elle est listée dans `illisibles` et signalée une fois au journal (nom du fichier seulement, jamais son contenu).
 */
export async function lireArchives(dossier, { fs = fsp, journal = null } = {}) {
  const archives = {};
  const illisibles = [];
  let noms = [];
  try {
    noms = await fs.readdir(dossier);
  } catch {
    return { archives, illisibles };
  }
  for (const nom of noms.sort()) {
    const m = MOTIF_ARCHIVE.exec(nom);
    if (!m) continue;
    try {
      const donnees = JSON.parse((await fs.readFile(path.join(dossier, nom), 'utf8')).replace(/^﻿/, ''));
      if (donnees?.format !== FORMAT_ARCHIVE || !Array.isArray(donnees.prestations)) throw new Error('format');
      if (!structureValide(donnees.prestations)) throw new Error('structure');
      archives[m[1]] = donnees;
    } catch {
      illisibles.push(m[1]);
      const cle = path.join(dossier, nom);
      if (!dejaSignalees.has(cle)) {
        dejaSignalees.add(cle);
        try { journal?.avert(`Archive ignorée : « ${nom} » est illisible ou sa structure est invalide.`); } catch { /* le journal ne doit jamais gêner */ }
      }
    }
  }
  return { archives, illisibles };
}

/** Prestations du fichier actif + des archives, dédupliquées par `id` (la version active l'emporte, architecture §5.4). */
export function prestationsCombinees(prestationsActives, archives) {
  const vus = new Set(prestationsActives.map((l) => l.id));
  const toutes = [...prestationsActives];
  for (const archive of Object.values(archives)) {
    for (const l of archive.prestations) {
      if (!vus.has(l.id)) {
        vus.add(l.id);
        toutes.push(l);
      }
    }
  }
  return toutes;
}

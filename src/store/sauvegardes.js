// Sauvegardes datées du fichier actif (architecture §7.3) : création, liste, rotation.
// Nom : `sauvegarde-AAAA-MM-JJ_HHhMMmSSs_<raison>[-n].json`, heure locale. Contenu = copie octet pour octet.
// La restauration est dans restauration.js et store.js.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { MODE_DOSSIER } from '../droits.js';
import { ecrireAtomique } from './fichier-atomique.js';

export const SOUS_DOSSIER_SAUVEGARDES = 'sauvegardes';

/**
 * Trois réserves de rotation distinctes, pour que des opérations répétées ne chassent pas l'historique quotidien
 * ni la seule copie d'une version écartée :
 *  - quotidienne : le réglage « sauvegardes à conserver » (7 à 365) compte des JOURS d'historique ;
 *  - operation : 30 dernières ;
 *  - conservee : copies de conflit et « avant restauration » (ou réinitialisation), gardées par âge (90 jours), hors limite de 30.
 */
export const RAISONS_QUOTIDIENNES = ['demarrage', 'quotidienne', 'manuelle'];
export const RAISONS_OPERATION = ['avant-suppression', 'avant-archivage', 'avant-migration'];
export const RAISONS_CONSERVEES = ['avant-restauration', 'avant-reinitialisation', 'conflit-disque', 'conflit-memoire'];
export const LIMITE_OPERATION = 30;
export const AGE_MAX_CONSERVEES_JOURS = 90;

const MOTIF_NOM = /^sauvegarde-(\d{4}-\d{2}-\d{2})_(\d{2})h(\d{2})m(\d{2})s_([a-z]+(?:-[a-z]+)*?)(?:-(\d+))?\.json$/;
// Temporaire laissé par une écriture interrompue : nom d'une sauvegarde de l'application + « .tmp-<pid>-<n> », rien d'autre.
const MOTIF_TEMPORAIRE = /^sauvegarde-\d{4}-\d{2}-\d{2}_\d{2}h\d{2}m\d{2}s_[a-z]+(?:-[a-z]+)*(?:-\d+)?\.json\.tmp-\d+-\d+$/;
const pad = (n) => String(n).padStart(2, '0');

/** `sauvegarde-AAAA-MM-JJ_HHhMMmSSs_<raison>[-n].json`, en heure locale. */
export function nomSauvegarde(date, raison, numero = 1) {
  const jour = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const heure = `${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`;
  return `sauvegarde-${jour}_${heure}_${raison}${numero > 1 ? `-${numero}` : ''}.json`;
}

/** Analyse un nom de fichier ; null si ce n'est pas exactement une sauvegarde de l'application. */
export function analyserNomSauvegarde(nom) {
  const m = MOTIF_NOM.exec(nom);
  if (!m) return null;
  const raison = m[5];
  const reserve = RAISONS_QUOTIDIENNES.includes(raison) ? 'quotidienne' : RAISONS_OPERATION.includes(raison) ? 'operation' : RAISONS_CONSERVEES.includes(raison) ? 'conservee' : null;
  if (!reserve) return null;
  return { nom, jour: m[1], heure: `${m[2]}:${m[3]}:${m[4]}`, raison, reserve };
}

/** Instant (heure locale) d'une sauvegarde analysée, d'après son nom. */
export function instantSauvegarde(s) {
  const [a, mo, j] = s.jour.split('-').map(Number);
  const [h, mi, se] = s.heure.split(':').map(Number);
  return new Date(a, mo - 1, j, h, mi, se);
}

/** Crée la sauvegarde (copie des octets fournis) sans jamais écraser une existante. Renvoie son nom. */
export async function creerSauvegarde({ dossier, maintenant, raison, contenu, fs = fsp, optionsAtomique }) {
  const dir = path.join(dossier, SOUS_DOSSIER_SAUVEGARDES);
  await fs.mkdir(dir, { recursive: true, mode: MODE_DOSSIER });
  for (let numero = 1; numero <= 50; numero++) {
    const nom = nomSauvegarde(maintenant, raison, numero);
    try {
      await fs.stat(path.join(dir, nom));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await ecrireAtomique(path.join(dir, nom), contenu, { fs, ...optionsAtomique });
      return nom;
    }
  }
  throw new Error('Trop de sauvegardes de même nom dans la même seconde.');
}

/** Numéro de suffixe d'un nom de sauvegarde (« …-2.json » -> 2, sans suffixe -> 1), pour classer deux sauvegardes de la même seconde. */
const numeroDe = (nom) => Number(/-(\d+)\.json$/.exec(nom)?.[1] ?? 1);

/**
 * Supprime, fichier par fichier, les temporaires orphelins de `sauvegardes/` (donnée de santé en clair laissée par une écriture interrompue).
 * Motif de nom strict, jamais récursif, jamais une sauvegarde valide. À appeler au démarrage seulement (aucune écriture en cours).
 * Renvoie les noms supprimés.
 */
export async function nettoyerTemporairesSauvegardes(dossier, { fs = fsp } = {}) {
  const dir = path.join(dossier, SOUS_DOSSIER_SAUVEGARDES);
  let noms;
  try {
    noms = await fs.readdir(dir);
  } catch {
    return [];
  }
  const supprimes = [];
  for (const nom of noms) {
    if (!MOTIF_TEMPORAIRE.test(nom)) continue;
    try {
      await fs.unlink(path.join(dir, nom));
      supprimes.push(nom);
    } catch {
      // occupé ou déjà parti : retenté au prochain démarrage
    }
  }
  return supprimes;
}

/** Sauvegardes reconnues du dossier, de la plus ancienne à la plus récente. Les autres fichiers sont ignorés. */
export async function listerSauvegardes({ dossier, fs = fsp, avecTaille = false }) {
  const dir = path.join(dossier, SOUS_DOSSIER_SAUVEGARDES);
  let noms;
  try {
    noms = await fs.readdir(dir);
  } catch {
    return [];
  }
  const liste = noms.map(analyserNomSauvegarde).filter(Boolean);
  liste.sort((a, b) => `${a.jour}_${a.heure}`.localeCompare(`${b.jour}_${b.heure}`) || numeroDe(a.nom) - numeroDe(b.nom) || a.nom.localeCompare(b.nom));
  if (avecTaille) {
    for (const s of liste) {
      try {
        s.tailleOctets = (await fs.stat(path.join(dir, s.nom))).size;
      } catch {
        s.tailleOctets = null;
      }
    }
  }
  return liste;
}

/** Plafond de sécurité : au plus ce nombre de sauvegardes quotidiennes conservées pour un même jour (les plus anciennes du jour partent d'abord). */
export const MAX_PAR_JOUR = 50;

/** Jour civil local `AAAA-MM-JJ` d'une date (même convention que les noms de sauvegarde). */
const jourLocal = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Réserve quotidienne, comptée en JOURS : toutes les sauvegardes du jour courant (plafond MAX_PAR_JOUR), puis la dernière de chacun des
 * `jours - 1` jours distincts précédents. `concernees` : de la plus ancienne à la plus récente. Renvoie celles à supprimer.
 * Jour courant = jour de `maintenant`, à défaut le jour de la sauvegarde la plus récente. Un jour postérieur (horloge reculée) est gardé comme le jour courant.
 */
function rotationParJours(concernees, jours, maintenant) {
  if (concernees.length === 0) return [];
  const parJour = new Map();
  for (const s of concernees) parJour.set(s.jour, [...(parJour.get(s.jour) ?? []), s]);
  const courant = maintenant ? jourLocal(maintenant) : concernees[concernees.length - 1].jour;
  const gardees = new Set();
  const precedents = [];
  for (const [jour, fichiers] of parJour) {
    if (jour >= courant) fichiers.slice(-MAX_PAR_JOUR).forEach((s) => gardees.add(s));
    else precedents.push(fichiers);
  }
  precedents.slice(Math.max(0, precedents.length - Math.max(0, jours - 1))).forEach((fichiers) => gardees.add(fichiers[fichiers.length - 1]));
  return concernees.filter((s) => !gardees.has(s));
}

/**
 * Rotation des sauvegardes :
 * - quotidienne : `joursQuotidiens` JOURS d'historique (voir rotationParJours) ; absent (null) : réserve non touchée (réglage inconnu : on ne supprime rien) ;
 * - opération : au-delà de `limiteOperation` fichiers, les plus anciennes d'abord ;
 * - « conservee » : supprimée seulement au-delà de `ageMaxJours`, et seulement si `maintenant` est fourni.
 * Ne touche qu'aux fichiers de `sauvegardes/` dont le nom correspond exactement au motif : jamais aux archives annuelles
 * ni aux autres fichiers du dossier. Renvoie les noms supprimés.
 */
export async function appliquerRotation({ dossier, joursQuotidiens = null, limiteOperation = LIMITE_OPERATION, maintenant = null, ageMaxJours = AGE_MAX_CONSERVEES_JOURS, fs = fsp, journal = null }) {
  const liste = await listerSauvegardes({ dossier, fs });
  const aSupprimer = [];
  if (Number.isSafeInteger(joursQuotidiens)) aSupprimer.push(...rotationParJours(liste.filter((s) => s.reserve === 'quotidienne'), joursQuotidiens, maintenant));
  if (Number.isSafeInteger(limiteOperation)) {
    const concernees = liste.filter((s) => s.reserve === 'operation');
    aSupprimer.push(...concernees.slice(0, Math.max(0, concernees.length - limiteOperation)));
  }
  if (maintenant) {
    const limiteAge = maintenant.getTime() - ageMaxJours * 24 * 3600 * 1000;
    aSupprimer.push(...liste.filter((s) => s.reserve === 'conservee' && instantSauvegarde(s).getTime() < limiteAge));
  }
  const supprimes = [];
  const echecs = [];
  for (const s of aSupprimer) {
    try {
      await fs.unlink(path.join(dossier, SOUS_DOSSIER_SAUVEGARDES, s.nom));
      supprimes.push(s.nom);
    } catch (err) {
      if (err.code !== 'ENOENT') echecs.push(err.code ?? err.name ?? 'inconnu'); // fichier occupé : retenté à la prochaine rotation
    }
  }
  if (echecs.length > 0) {
    try { journal?.avert(`Rotation des sauvegardes : ${echecs.length} sauvegarde${echecs.length > 1 ? 's' : ''} ancienne${echecs.length > 1 ? 's' : ''} n'${echecs.length > 1 ? 'ont' : 'a'} pas pu être supprimée${echecs.length > 1 ? 's' : ''} (code : ${[...new Set(echecs)].join(', ')}).`); } catch { /* le journal ne doit jamais gêner */ }
  }
  return supprimes;
}

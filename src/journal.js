// Journal d'événements : un fichier texte, une ligne par événement (démarrage, arrêt, erreurs, mode dégradé, conflit...).
// Jamais de ligne par requête normale, jamais de nom de patient, de motif, de montant ni de contenu de prestation :
// les appelants ne passent que des messages fixes, des codes et des noms d'erreur (voir `decrireErreur`).
// L'écriture ne doit JAMAIS faire planter l'application : en cas d'échec (dossier non inscriptible, disque plein), repli sur stderr.
// Écriture synchrone : événements rares, et la ligne doit être sur le disque avant un `process.exit`.
import fs from 'node:fs';
import path from 'node:path';
import { MODE_DOSSIER, MODE_FICHIER } from './droits.js';

export const NOM_JOURNAL = 'suivi-facturation.log';
export const LIMITE_JOURNAL_OCTETS = 1024 * 1024; // 1 Mo

const pad = (n, l = 2) => String(n).padStart(l, '0');

/** Horodatage ISO en heure locale avec décalage : 2026-10-04T14:03:05.123+02:00. */
export function horodatageLocal(date = new Date()) {
  const decalage = -date.getTimezoneOffset();
  const signe = decalage >= 0 ? '+' : '-';
  const d = Math.abs(decalage);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${signe}${pad(Math.floor(d / 60))}:${pad(d % 60)}`
  );
}

/** Une ligne, sans retour à la ligne ni caractère de contrôle. */
const aplatir = (texte) => String(texte).replace(/\r?\n/g, ' | ').replace(/[\x00-\x1f\x7f]/g, ' ');

/**
 * Décrit une erreur SANS son message (il pourrait contenir des données) : nom, code et premières lignes de la pile.
 */
export function decrireErreur(err) {
  if (!err || typeof err !== 'object') return `valeur non-erreur (${typeof err})`;
  const base = `${err.name ?? 'Error'}${err.code ? ` (${err.code})` : ''}`;
  const frames = String(err.stack ?? '')
    .split('\n')
    .filter((l) => /^\s*at /.test(l))
    .slice(0, 3)
    .map((l) => l.trim());
  return frames.length > 0 ? `${base} ${frames.join(' ; ')}` : base;
}

/**
 * @param {object} options
 * @param {string} options.dossier dossier du journal (créé s'il manque)
 * @param {number} [options.limite] taille au-delà de laquelle le fichier devient `.log.1`
 * @param {() => Date} [options.maintenant]
 * @param {(texte: string) => void} [options.secours] repli si l'écriture échoue (stderr par défaut)
 */
export function creerJournal({ dossier, limite = LIMITE_JOURNAL_OCTETS, maintenant = () => new Date(), secours = (t) => process.stderr.write(t) } = {}) {
  const chemin = path.join(dossier, NOM_JOURNAL);
  const precedent = `${chemin}.1`;
  let dossierPret = false;

  function pivoter() {
    try { fs.unlinkSync(precedent); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    fs.renameSync(chemin, precedent);
  }

  function ecrire(niveau, message) {
    const ligne = `${horodatageLocal(maintenant())} ${niveau.padEnd(6)} ${aplatir(message)}\n`;
    try {
      if (!dossierPret) {
        fs.mkdirSync(dossier, { recursive: true, mode: MODE_DOSSIER });
        dossierPret = true;
      }
      let taille = 0;
      try { taille = fs.statSync(chemin).size; } catch (err) { if (err.code !== 'ENOENT') throw err; }
      if (taille > 0 && taille + Buffer.byteLength(ligne) > limite) pivoter();
      fs.appendFileSync(chemin, ligne, { mode: MODE_FICHIER });
    } catch {
      dossierPret = false;
      try { secours(`[journal indisponible] ${ligne}`); } catch { /* rien d'autre à tenter */ }
    }
  }

  return {
    chemin,
    info: (message) => ecrire('INFO', message),
    avert: (message) => ecrire('AVERT', message),
    erreur: (message) => ecrire('ERREUR', message),
  };
}

/** Journal sans effet (tests et usages sans fichier). */
export const journalNul = { chemin: null, info() {}, avert() {}, erreur() {} };

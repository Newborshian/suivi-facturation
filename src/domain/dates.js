// Dates civiles AAAA-MM-JJ (sans heure ni fuseau). Module pur : aucune horloge implicite.

const RE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_MOIS = /^(\d{4})-(\d{2})$/;
const MS_PAR_JOUR = 86_400_000;
export const ANNEE_MIN = 2000;
export const ANNEE_MAX = 2100;

const pad = (n, largeur = 2) => String(n).padStart(largeur, '0');

function bissextile(a) {
  return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
}

export function joursDansMois(annee, mois) {
  return [31, bissextile(annee) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mois - 1];
}

export function estDateCivile(valeur) {
  if (typeof valeur !== 'string') return false;
  const m = RE_DATE.exec(valeur);
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return a >= ANNEE_MIN && a <= ANNEE_MAX && mo >= 1 && mo <= 12 && j >= 1 && j <= joursDansMois(a, mo);
}

export function estMois(valeur) {
  if (typeof valeur !== 'string') return false;
  const m = RE_MOIS.exec(valeur);
  if (!m) return false;
  const [a, mo] = [Number(m[1]), Number(m[2])];
  return a >= ANNEE_MIN && a <= ANNEE_MAX && mo >= 1 && mo <= 12;
}

function decomposer(date) {
  const m = RE_DATE.exec(date);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function formater(annee, mois, jour) {
  return `${pad(annee, 4)}-${pad(mois)}-${pad(jour)}`;
}

const enUtc = (date) => {
  const [a, m, j] = decomposer(date);
  return Date.UTC(a, m - 1, j);
};

/** `JJ/MM/AAAA` d'une date civile (messages destinés à l'utilisatrice). */
export function formaterDateFr(date) {
  const [a, m, j] = decomposer(date);
  return `${pad(j)}/${pad(m)}/${pad(a, 4)}`;
}

/** `AAAA-MM` d'une date civile. */
export function moisDe(date) {
  return date.slice(0, 7);
}

/** Écart en jours `fin - debut`, insensible à l'heure d'été (calcul en UTC). */
export function ecartJours(debut, fin) {
  return Math.round((enUtc(fin) - enUtc(debut)) / MS_PAR_JOUR);
}

export function ajouterJours(date, n) {
  const d = new Date(enUtc(date) + n * MS_PAR_JOUR);
  return formater(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Ajoute n mois ; le jour est borné au dernier jour du mois d'arrivée (31/03 - 1 mois = 28/02). */
export function ajouterMois(date, n) {
  const [a, m, j] = decomposer(date);
  const total = a * 12 + (m - 1) + n;
  const annee = Math.floor(total / 12);
  const mois = (total % 12) + 1;
  return formater(annee, mois, Math.min(j, joursDansMois(annee, mois)));
}

/** Lundi de la semaine ISO qui contient `date` (AAAA-MM-JJ). */
export function lundiDeSemaine(date) {
  return ajouterJours(date, -((new Date(enUtc(date)).getUTCDay() + 6) % 7));
}

/** Semaine ISO 8601 (lundi à dimanche) : `AAAA-Www`. L'année ISO peut différer de l'année civile. */
export function semaineIso(date) {
  const t = enUtc(date);
  const jourSemaine = (new Date(t).getUTCDay() + 6) % 7; // lundi = 0
  const jeudi = new Date(t + (3 - jourSemaine) * MS_PAR_JOUR);
  const anneeIso = jeudi.getUTCFullYear();
  const ordinal = Math.round((jeudi.getTime() - Date.UTC(anneeIso, 0, 1)) / MS_PAR_JOUR) + 1;
  return `${pad(anneeIso, 4)}-W${pad(Math.floor((ordinal - 1) / 7) + 1)}`;
}

/** Date locale (celle du PC) d'un objet Date, au format civil. */
export function aujourdHuiLocal(dateJs) {
  return formater(dateJs.getFullYear(), dateJs.getMonth() + 1, dateJs.getDate());
}

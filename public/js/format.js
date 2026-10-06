// Formats français et conversions de saisie. Module PUR (aucun accès au DOM) : testé avec node --test.
// Les montants sont des centimes entiers ; aucune division flottante n'est utilisée pour l'affichage.

const NBSP = ' ';
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const groupes = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export const LIBELLES_STATUT = { a_facturer: 'À facturer', facture: 'Facturé' };
export const LIBELLES_ETAT = { non_paye: 'Non payé', partiel: 'Partiellement payé', paye: 'Payé' };
export const LIBELLES_MODE = { carte: 'Carte bancaire', cheque: 'Chèque', especes: 'Espèces', virement: 'Virement', autre: 'Autre' };

/** 125050 -> « 1 250,50 € » (séparateur de milliers et espace avant € insécables). */
export function formatEuros(centimes) {
  if (!Number.isSafeInteger(centimes)) return '—';
  const signe = centimes < 0 ? '-' : '';
  const abs = Math.abs(centimes);
  return `${signe}${groupes.format(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, '0')}${NBSP}€`;
}

/** 4500 -> « 45,00 » (valeur d'un champ de saisie, sans symbole ni séparateur de milliers). */
export function formatMontantSaisie(centimes) {
  if (!Number.isSafeInteger(centimes) || centimes < 0) return '';
  return `${Math.trunc(centimes / 100)},${String(centimes % 100).padStart(2, '0')}`;
}

/**
 * Lit un montant saisi : « 1 250,50 », « 45 », « 45.5 », « 45,50 € ».
 * -> { ok: true, centimes } | { ok: false, raison: 'vide' | 'invalide' }. Refuse le négatif, plus de 2 décimales, les lettres.
 */
export function lireMontant(texte) {
  const brut = String(texte ?? '').replace(/[\s  ]/g, '').replace(/€$/, '');
  if (brut === '') return { ok: false, raison: 'vide' };
  const m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(brut);
  if (!m) return { ok: false, raison: 'invalide' };
  const centimes = Number(m[1]) * 100 + (m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0')));
  return Number.isSafeInteger(centimes) ? { ok: true, centimes } : { ok: false, raison: 'invalide' };
}

/** '2026-10-12' -> '12/10/2026' */
export function formatDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** '2026-10-12' -> '12/10' ; avec l'année si elle diffère de `anneeCourante` ('12/10/2025'). */
export function formatDateCourte(date, anneeCourante) {
  const complet = formatDate(date);
  if (!complet) return '';
  return String(anneeCourante) === date.slice(0, 4) ? complet.slice(0, 5) : complet;
}

/** '2026-10' -> 'octobre 2026' */
export function formatMois(mois) {
  const m = /^(\d{4})-(\d{2})$/.exec(mois ?? '');
  return m && MOIS[Number(m[2]) - 1] ? `${MOIS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** Texte de recherche : minuscules, sans accents, espaces réduits. Sert au filtre local sur le patient (jamais envoyé au serveur). */
export function normaliserRecherche(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le texte saisi se trouve-t-il dans le nom, le prénom, « nom prénom » ou « prénom nom » ? Texte vide : tout correspond. */
export function correspondPatient(patient, saisie) {
  const recherche = normaliserRecherche(saisie);
  if (recherche === '') return true;
  const nom = normaliserRecherche(patient.nom);
  const prenom = normaliserRecherche(patient.prenom);
  return [nom, prenom, `${nom} ${prenom}`, `${prenom} ${nom}`].some((cible) => cible.includes(recherche));
}

/** Somme des montants, payés et restes d'une liste de lignes enrichies (centimes entiers). */
export function totaliserLignes(lignes) {
  const t = { nombre: lignes.length, montantCentimes: 0, payeCentimes: 0, resteCentimes: 0 };
  for (const l of lignes) {
    t.montantCentimes += l.montantCentimes;
    t.payeCentimes += l.payeCentimes;
    t.resteCentimes += l.resteCentimes;
  }
  return t;
}

/** « 1 prestation » / « 12 prestations » */
export function pluriel(n, singulier, plurielMot = `${singulier}s`) {
  return `${n} ${n > 1 ? plurielMot : singulier}`;
}

/** « Nom Prénom » (ordre du tri du récapitulatif). */
export function nomPatient(patient) {
  return `${patient.nom} ${patient.prenom}`;
}

/** '2026-12' + 1 -> '2027-01' ; null si le résultat sort de 2000-2100 (mêmes bornes que les dates du serveur). */
export function moisPlusN(mois, n) {
  const m = /^(\d{4})-(\d{2})$/.exec(mois ?? '');
  if (!m) return null;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const annee = Math.floor(total / 12);
  if (annee < 2000 || annee > 2100) return null;
  return `${String(annee).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Texte d'une tranche d'ancienneté des impayés après « depuis » (« moins de 30 jours »), ou null si l'identifiant est inconnu.
 * `tranches` = [{ id, libelle }] renvoyé par GET /api/etat (`tranchesAnciennete`) : le serveur est seul à définir les tranches.
 */
export function libelleTranche(tranches, id) {
  const t = (Array.isArray(tranches) ? tranches : []).find((x) => x?.id === id);
  return t ? t.libelle.charAt(0).toLowerCase() + t.libelle.slice(1) : null;
}

/** Montant du dernier versement d'une prestation renvoyée par le serveur (ce qui vient d'être enregistré), sinon `repli`. */
export function montantDernierVersement(prestation, repli) {
  const m = prestation?.versements?.at(-1)?.montantCentimes;
  return Number.isSafeInteger(m) ? m : repli;
}

// Libellés du tableau de bord (« à facturer » et « reste à payer ») : deux notions distinctes, jamais le même mot pour les deux.
/** Indicateur de tête : montant des factures à émettre (total des lignes, acomptes compris), à ne pas confondre avec le reste à payer. */
export const LIBELLE_A_FACTURER = 'À facturer : montant à mettre sur les factures';
/** Séries du graphique du CA et colonnes de son tableau : ce sont des restes à payer (acomptes déduits). */
export const LIBELLE_SERIE_PREVU = 'Prévu (estimation indicative)';
export const LIBELLES_SERIES_CA = { paye: 'Payé', attente: 'Facturé en attente (reste à payer)', aFacturer: 'À facturer (reste à payer)' };

/** Nom accessible d'un lien de tranche : le groupe est nommé, sinon les tranches des deux groupes se ressemblent au clavier. */
export const nomLienTranche = (groupe, t) => `${groupe}, ${t.libelle.toLowerCase()} : reste à payer ${formatEuros(t.resteCentimes)}, ${pluriel(t.nombre, 'prestation')}. Voir la liste.`;

export const LIBELLES_CATEGORIE = { seance: 'Séance', bilan: 'Bilan', autre: 'Autre' };

/** Raisons de sauvegarde (noms de fichier) -> libellés français sans jargon. */
export const LIBELLES_RAISON = {
  demarrage: 'Démarrage',
  quotidienne: 'Quotidienne',
  manuelle: 'Manuelle',
  'avant-suppression': 'Avant une suppression',
  'avant-archivage': 'Avant un archivage',
  'avant-restauration': 'Avant une restauration',
  'avant-reinitialisation': "Avant un fichier vide",
  'avant-migration': 'Avant une mise à jour du fichier',
  'conflit-disque': 'Version du disque (conflit)',
  'conflit-memoire': "Version de l'application (conflit)",
};

/** 812 -> « 812 octets » ; 12 345 -> « 12,1 Ko » ; 1 234 567 -> « 1,2 Mo » (taille de fichier, affichage seulement). */
export function formatTaille(octets) {
  if (!Number.isFinite(octets) || octets < 0) return '—';
  if (octets < 1024) return `${octets} octet${octets > 1 ? 's' : ''}`;
  const un = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  if (octets < 1024 * 1024) return `${un.format(octets / 1024)}${NBSP}Ko`;
  return `${un.format(octets / (1024 * 1024))}${NBSP}Mo`;
}

/** ('2026-10-01', '09:14:03') -> « 01/10/2026 à 09:14 ». */
export function formatDateHeure(jour, heure) {
  const d = formatDate(jour);
  const h = /^(\d{2}):(\d{2})/.exec(heure ?? '');
  if (!d) return '';
  return h ? `${d} à ${h[1]}:${h[2]}` : d;
}

/** Instant ISO (UTC) -> « 02/10/2026 09:14 » en heure locale du PC. */
export function formatInstant(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
}

/** Détail sous « Reste à encaisser » : part du reste qui n'est pas encore facturée (vide s'il n'y en a pas). */
export const libelleDontNonFactures = (centimes) => (centimes > 0 ? `dont ${formatEuros(centimes)} pas encore facturés` : '');

/**
 * Modes de paiement distincts d'une liste de versements, en libellés français : ordre chronologique du premier versement de chaque mode,
 * sans doublon. Un mode inconnu ou absent devient « Autre » (le versement a bien été reçu). Fonction pure, sans nom de patient.
 */
export function libellesModes(versements) {
  const tries = (Array.isArray(versements) ? versements : [])
    .map((v, i) => ({ date: typeof v?.date === 'string' ? v.date : '', mode: Object.hasOwn(LIBELLES_MODE, v?.mode) ? v.mode : 'autre', i }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i));
  return [...new Set(tries.map((v) => v.mode))].map((m) => LIBELLES_MODE[m]);
}

/** Libellés des modes de paiement à afficher pour une ligne : [] si non payé ou sans versement (même tableau que libellesModes sinon). */
export function listeModesPaiement(ligne) {
  return ligne?.etat === 'non_paye' ? [] : libellesModes(ligne?.versements);
}

/**
 * Affichage du paiement d'une ligne : { modes, aria }.
 *  - modes : « Espèces + Virement » (vide si non payé, ou payé d'office sans versement) ; l'écran utilise plutôt listeModesPaiement ;
 *  - aria : phrase complète, ex. « Payé en totalité par virement », « Partiellement payé par espèces et chèque », « Non payé ».
 */
export function resumePaiement(ligne) {
  const libelles = listeModesPaiement(ligne);
  const liste = libelles.map((m) => (m === LIBELLES_MODE.autre ? 'un autre mode' : m.toLowerCase())); // « par un autre mode »
  const par = liste.length === 0 ? '' : ` par ${liste.length === 1 ? liste[0] : `${liste.slice(0, -1).join(', ')} et ${liste.at(-1)}`}`;
  const base = ligne.etat === 'paye' ? 'Payé en totalité' : ligne.etat === 'partiel' ? 'Partiellement payé' : 'Non payé';
  return { modes: libelles.join(' + '), aria: `${base}${par}` };
}

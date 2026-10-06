// Composition du graphique du CA avec l'estimation. Module PUR (aucun accès au DOM) : testé avec node --test.
// Le serveur calcule l'estimation (src/domain/previsions.js) ; ici on ne fait que poser la série « prévu » sur les barres déjà réalisées
// et fournir les textes. Centimes entiers uniquement.
import { formatMois } from '../format.js';

/** Ligne de CA d'un mois sans aucune prestation saisie (mois suivants sans ligne). */
export const ligneVide = (mois) => ({ mois, nombre: 0, payeCentimes: 0, attenteCentimes: 0, aFacturerCentimes: 0, aVenirCentimes: 0, totalCentimes: 0, tropPercuCentimes: 0 });

/**
 * Un mois du graphique. `m` : ligne de ca-mensuel (vue prestation) ; `estimation` : entrée de la prévision pour ce mois, ou undefined.
 *  - barres = [payé, facturé en attente, à facturer] (inchangées, ce sont des restes à payer) ; empile = leur somme
 *  - prevu = max(0, estimation - empile) : la pile monte jusqu'à l'estimation sans la dépasser ni double comptage ;
 *    si l'estimation est inférieure à ce qui est déjà réalisé, prevu = 0 et la pile garde sa hauteur réelle
 *  - haut = empile + prevu : le montant écrit en haut de la barre (= max(estimation, empile) pour un mois estimé, = empile sinon)
 *  - dontPlanifie : part des séances planifiées non facturées (reste à payer) comprise dans le prévu ; bornée par le prévu
 *    (une séance future facturée d'avance ou payée est dans les barres, pas dans le prévu)
 */
export function composerMois(m, estimation) {
  const barres = [m.payeCentimes, m.attenteCentimes, m.aFacturerCentimes];
  const empile = barres[0] + barres[1] + barres[2];
  const estime = estimation !== undefined && estimation !== null;
  const prevu = estime ? Math.max(0, estimation.estimationCentimes - empile) : 0;
  return {
    mois: m.mois,
    source: m, // ligne de ca-mensuel d'origine (total dû, trop-perçu, reste à venir)
    estime,
    courant: estime && estimation.courant === true,
    barres,
    empile,
    prevu,
    haut: empile + prevu,
    estimationCentimes: estime ? estimation.estimationCentimes : null,
    dontPlanifieCentimes: estime ? Math.min(m.aVenirCentimes, prevu) : 0,
  };
}

/**
 * Tous les mois du graphique : ceux de ca-mensuel puis, si l'estimation est affichée, les mois suivants (lignes de `futurs`, ou vides).
 * `prevision` : { donnees, futurs } (ou null) ; `estimation` n'est utilisée que si `donnees.suffisant` ET si la période inclut le mois en cours.
 * -> null si aucune estimation n'est affichée ; sinon [composerMois, ...]
 */
export function composerPrevision(moisCa, prevision, periodeInclutMoisCourant) {
  if (!prevision?.donnees?.suffisant || !periodeInclutMoisCourant) return null;
  const estimations = new Map(prevision.donnees.mois.map((e) => [e.mois, e]));
  const futurs = prevision.donnees.mois.filter((e) => !e.courant).map((e) => prevision.futurs?.mois.find((m) => m.mois === e.mois) ?? ligneVide(e.mois));
  return [...moisCa, ...futurs].map((m) => composerMois(m, estimations.get(m.mois)));
}

/**
 * La prévision a-t-elle été calculée un autre jour que la réponse de ca-mensuel ? (rare : minuit passé entre les deux lectures,
 * le dernier jour du mois) ; dans ce cas les deux ne parlent pas du même « mois en cours » et il faut relire. Sans prévision : faux.
 */
export const previsionPerimee = (ca, prevision) => typeof prevision?.donnees?.aujourdHui === 'string' && prevision.donnees.aujourdHui !== ca?.aujourdHui;

// ------------------------------------------------------------------ Textes

/** Limites de la méthode, en français simple, sous le graphique. */
export const noteMethode = (fenetre) =>
  `Comment lire cette estimation : elle repose sur la moyenne des ${fenetre} derniers mois complets, et un mois sans aucune prestation compte pour 0 (une période de vacances fait donc baisser l'estimation). Pour le mois en cours, elle suppose que les séances déjà réalisées sont saisies : tant qu'elles ne le sont pas, l'estimation est trop basse.`;

/** Vue « Encaissé par date de versement ». */
export const NOTE_VUE_ENCAISSE = "Pas d'estimation dans cette vue : l'estimation indicative porte sur le chiffre d'affaires dû. Choisissez la vue « Dû par date de prestation » pour la voir.";

/** Mention sur l'axe, sous le nom du mois. */
export const MENTION_ESTIME = '(estimé)';
/** Le mois en cours est déjà en grande partie réalisé : seule sa fin est estimée. */
export const MENTION_PARTIEL = '(en partie)';

/** '2027-03-01' -> « 1er mars 2027 » ; '' si la date est absente ou invalide. */
export function formatJourLong(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!m || !formatMois(`${m[1]}-${m[2]}`)) return '';
  const jour = Number(m[3]) === 1 ? '1er' : String(Number(m[3]));
  return `${jour} ${formatMois(`${m[1]}-${m[2]}`)}`;
}

/** Phrase sur la date de la première estimation ('' si inconnue). */
export const phrasePremiereEstimation = (date) => (formatJourLong(date) ? `La première estimation sera possible à partir du ${formatJourLong(date)}.` : '');

// Libellés du tableau et de l'info-bulle en mode estimation : le reste à payer des séances à venir est DANS la barre « prévu ».
export const LIBELLE_PREVU_TABLEAU = 'Prévu : complément jusqu\'à l\'estimation';
export const LIBELLE_DONT_PLANIFIE = 'Dont séances déjà planifiées, non facturées';
export const LIBELLE_ESTIMATION_MOIS = 'Estimation du mois';
export const LIBELLE_TOTAL_HORS_PREVU = 'Total des barres (hors prévu)';

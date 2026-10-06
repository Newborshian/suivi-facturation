// Prévision du CA. Module pur : centimes entiers, dates civiles sans fuseau, aucune horloge implicite, aucune E/S.
// Formules : architecture §6.7 (historique minimal, pas de double comptage, exemple de contrôle).
//
// Grandeur prévue = CA DÛ : la somme des MONTANTS (`montantCentimes`) des prestations, par date de prestation, tous statuts confondus.
// Jamais un reste à payer (`aVenirCentimes` de caMensuel) : les versements, acomptes compris, ne changent donc rien ici, et une
// prestation à venir déjà facturée n'est comptée qu'une fois (dans le « planifié »).
import { ajouterMois, joursDansMois, moisDe } from './dates.js';
import { listerMois, nombreMois } from './indicateurs.js';

export const FENETRE_MOIS = 3; // mois complets de la moyenne glissante, et historique minimal
export const HORIZON_MOIS = 3; // mois suivants estimés

/** Division entière arrondie à l'entier le plus proche, les moitiés vers le haut (montants positifs). Aucun flottant. */
export function diviserArrondi(numerateur, denominateur) {
  return Math.floor((2 * numerateur + denominateur) / (2 * denominateur));
}

/**
 * Historique disponible : nombre de mois COMPLETS entre la plus ancienne prestation et le mois précédant le mois en cours (le mois en
 * cours n'est jamais compté). Un mois est complet s'il commence à la date de la plus ancienne prestation ou après : une première
 * prestation datée du 5 août rend le mois d'août incomplet, le premier mois complet est septembre. Les prestations à date future ne
 * comptent pas comme historique (si elles sont les seules, 0 mois). Une prestation à 0 € est une prestation : elle compte.
 * -> { plusAncienne: 'AAAA-MM-JJ' | null, moisComplets, moisManquants }
 */
export function historique(prestations, aujourdHui, fenetre = FENETRE_MOIS) {
  const plusAncienne = prestations.reduce((min, p) => (min === null || p.date < min ? p.date : min), null);
  let moisComplets = 0;
  if (plusAncienne !== null) {
    const dernierComplet = moisDe(ajouterMois(`${moisDe(aujourdHui)}-01`, -1));
    const premierComplet = plusAncienne.endsWith('-01') ? moisDe(plusAncienne) : moisDe(ajouterMois(`${moisDe(plusAncienne)}-01`, 1));
    moisComplets = Math.max(0, nombreMois(premierComplet, dernierComplet));
  }
  return { plusAncienne, moisComplets, moisManquants: Math.max(0, fenetre - moisComplets) };
}

/**
 * Premier jour où une estimation sera possible : le 1er du mois qui suit les `fenetre` premiers mois complets, avec la règle stricte
 * de `historique` (le mois de la plus ancienne prestation n'est compté que si elle est datée du 1er ; sinon, le premier mois complet est le suivant).
 * Exemple : première prestation le 2 novembre, fenêtre 3 -> premier mois complet décembre (décembre, janvier, février) -> 1er mars.
 * -> 'AAAA-MM-01' | null (aucune prestation : on ne peut rien dire).
 */
export function premiereEstimation(plusAncienne, fenetre = FENETRE_MOIS) {
  if (plusAncienne === null || plusAncienne === undefined) return null;
  const premierComplet = plusAncienne.endsWith('-01') ? moisDe(plusAncienne) : moisDe(ajouterMois(`${moisDe(plusAncienne)}-01`, 1));
  return ajouterMois(`${premierComplet}-01`, fenetre);
}

/**
 * Prévision du mois en cours (M) et des `horizon` mois suivants.
 *  - Base B = moyenne des `fenetre` derniers mois complets (M-1, M-2, M-3) du CA dû, arrondie au centime (moitié vers le haut) ;
 *    un mois sans activité compte pour 0.
 *  - R = réalisé de M (date <= aujourd'hui) ; P = planifié (date > aujourd'hui), pour M comme pour chaque mois suivant.
 *  - Mois en cours : estimation = R + max(P, Bf), Bf = arrondi(B × joursRestants / joursDuMois), joursRestants = jours APRÈS aujourd'hui
 *    (le jour même est considéré comme déjà vécu : ce qui y a été saisi est dans R). Au dernier jour du mois Bf = 0 ; le 1er, Bf = B × (n-1)/n.
 *  - Mois suivants : estimation = max(P, B) (max et non somme : B représente déjà un mois complet « typique », séances planifiées comprises).
 *  - Historique < `fenetre` mois complets : rien n'est calculé (`suffisant: false`, `mois: []`, `base: null`), avec le nombre de mois manquants.
 * -> { aujourdHui, fenetre, horizon, suffisant, moisComplets, moisManquants, base, premiereEstimationLe (null si suffisant),
 *      mois: [{ mois, courant, realiseCentimes, planifieCentimes, complementEstimeCentimes, estimationCentimes }] }
 *    complementEstime = estimation - R - P (la part purement estimée, jamais négative).
 */
export function previsions(prestations, { aujourdHui, fenetre = FENETRE_MOIS, horizon = HORIZON_MOIS }) {
  const h = historique(prestations, aujourdHui, fenetre);
  const sortie = { aujourdHui, fenetre, horizon, suffisant: h.moisManquants === 0, moisComplets: h.moisComplets, moisManquants: h.moisManquants, base: null, premiereEstimationLe: null, mois: [] };
  if (!sortie.suffisant) {
    sortie.premiereEstimationLe = premiereEstimation(h.plusAncienne, fenetre); // historique trop court : à partir de quand ?
    return sortie;
  }

  const courant = moisDe(aujourdHui);
  const premierComplet = moisDe(ajouterMois(`${courant}-01`, -fenetre));
  const dernierComplet = moisDe(ajouterMois(`${courant}-01`, -1));
  const dernierEstime = moisDe(ajouterMois(`${courant}-01`, horizon));

  const totaux = new Map(); // mois -> { realise, planifie } (montants dus)
  for (const p of prestations) {
    const m = moisDe(p.date);
    if (m < premierComplet || m > dernierEstime) continue;
    const t = totaux.get(m) ?? { realise: 0, planifie: 0 };
    t[p.date > aujourdHui ? 'planifie' : 'realise'] += p.montantCentimes;
    totaux.set(m, t);
  }
  const de = (m) => totaux.get(m) ?? { realise: 0, planifie: 0 };

  const sommeHistorique = listerMois(premierComplet, dernierComplet).reduce((s, m) => s + de(m).realise + de(m).planifie, 0); // un mois complet est déjà passé : planifie = 0
  const base = diviserArrondi(sommeHistorique, fenetre);
  sortie.base = base;

  const [annee, moisNum] = courant.split('-').map(Number);
  const joursMois = joursDansMois(annee, moisNum);
  const joursRestants = joursMois - Number(aujourdHui.slice(8, 10));

  for (const m of listerMois(courant, dernierEstime)) {
    const { realise, planifie } = de(m);
    const estEnCours = m === courant;
    const attendu = estEnCours ? diviserArrondi(base * joursRestants, joursMois) : base;
    const estimation = realise + Math.max(planifie, attendu);
    sortie.mois.push({ mois: m, courant: estEnCours, realiseCentimes: realise, planifieCentimes: planifie, complementEstimeCentimes: estimation - realise - planifie, estimationCentimes: estimation });
  }
  return sortie;
}

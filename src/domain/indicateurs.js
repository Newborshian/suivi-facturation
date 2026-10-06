// Indicateurs du tableau de bord (CA, séances, répartition, impayés). Module pur : centimes entiers, aucune horloge implicite, aucune E/S.
// Formules : architecture §6.6 (CA par mois, vue par date de versement, séances, impayés, répartition).
// Hors de ce module : la prévision (previsions.js) ; les archives et les patients actifs ne sont pas encore calculés.
import { ajouterJours, ajouterMois, ecartJours, joursDansMois, lundiDeSemaine, moisDe, semaineIso } from './dates.js';
import { etatPaiement } from './paiement.js';

export const VUES_CA = ['prestation', 'versement'];
export const GRANULARITES = ['mois', 'semaine'];
export const PERIODE_MAX_MOIS = 60;

/** Tranches d'ancienneté des impayés : 30 jours pile = tranche 30-59. `max` null = sans borne. */
export const TRANCHES = [
  { id: '0-29', min: 0, max: 29, libelle: 'Moins de 30 jours' },
  { id: '30-59', min: 30, max: 59, libelle: '30 à 59 jours' },
  { id: '60-89', min: 60, max: 89, libelle: '60 à 89 jours' },
  { id: '90-plus', min: 90, max: null, libelle: '90 jours et plus' },
];

/** Liste des mois de `de` à `a` inclus (AAAA-MM). */
export function listerMois(de, a) {
  const mois = [];
  for (let m = de; m <= a; m = moisDe(ajouterMois(`${m}-01`, 1))) mois.push(m);
  return mois;
}

/** Nombre de mois (inclus) entre `de` et `a`. */
export function nombreMois(de, a) {
  const [ad, md] = de.split('-').map(Number);
  const [aa, ma] = a.split('-').map(Number);
  return (aa - ad) * 12 + (ma - md) + 1;
}

const dansPeriode = (date, de, a) => {
  const mois = moisDe(date);
  return mois >= de && mois <= a;
};

// ------------------------------------------------------------------ CA par mois

/**
 * CA par mois de `de` à `a` (AAAA-MM).
 *  - vue 'prestation' (défaut) : prestations dont la DATE est dans le mois. payé = part versée (quelle que soit la date du
 *    versement) ; facturé en attente = RESTE À PAYER des prestations facturées, y compris une prestation à venir déjà facturée (le reste
 *    à payer est dû quelle que soit la date de la prestation) ; à facturer = reste à payer des prestations non facturées de date passée ou du jour.
 *    Une prestation À VENIR (date > aujourd'hui) et NON facturée n'est jamais « à facturer » : son reste à payer est compté à part
 *    (`aVenirCentimes`, un reste et non un montant : pas une barre du graphique, la série « prévu » relève de la prévision).
 *    Sa part déjà versée reste « payé ».
 *    Invariant : total = payé + attente + à facturer + à venir = Σ montants du mois. Le trop-perçu est à part (`tropPercuCentimes`).
 *  - vue 'versement' (trésorerie) : encaissé = Σ des versements DATÉS dans le mois, toutes prestations confondues, trop-perçu compris.
 * -> { vue, de, a, mois: [...], total: {...} }
 */
export function caMensuel(prestations, { de, a, vue = 'prestation', aujourdHui }) {
  if (!VUES_CA.includes(vue)) throw new RangeError(`Vue inconnue : ${vue}`);
  const mois = listerMois(de, a);
  const parMois = new Map(mois.map((m) => [m, vue === 'prestation' ? { mois: m, nombre: 0, payeCentimes: 0, attenteCentimes: 0, aFacturerCentimes: 0, aVenirCentimes: 0, totalCentimes: 0, tropPercuCentimes: 0 } : { mois: m, nombre: 0, encaisseCentimes: 0 }]));

  for (const p of prestations) {
    if (vue === 'prestation') {
      const e = parMois.get(moisDe(p.date));
      if (!e) continue;
      const { payeCentimes, resteCentimes, tropPercuCentimes } = etatPaiement(p);
      e.nombre += 1;
      e.payeCentimes += payeCentimes;
      if (p.statut === 'facture') e.attenteCentimes += resteCentimes; // facturée (même à venir) : la facture est émise, la somme est attendue
      else if (p.date > aujourdHui) e.aVenirCentimes += resteCentimes; // à venir ET pas encore facturée
      else e.aFacturerCentimes += resteCentimes;
      e.totalCentimes += p.montantCentimes;
      e.tropPercuCentimes += tropPercuCentimes;
    } else {
      for (const v of p.versements) {
        const e = parMois.get(moisDe(v.date));
        if (!e) continue;
        e.nombre += 1;
        e.encaisseCentimes += v.montantCentimes;
      }
    }
  }

  const lignes = [...parMois.values()];
  const total = {};
  for (const l of lignes) for (const [cle, valeur] of Object.entries(l)) if (cle !== 'mois') total[cle] = (total[cle] ?? 0) + valeur;
  return { vue, de, a, mois: lignes, total };
}

// ------------------------------------------------------------------ Séances

/**
 * Nombre de séances par mois ou par semaine ISO entre les mois `de` et `a`. « Séance » = catégorie `seance` ; les autres prestations sont comptées à part (`autres`). `realisees` : date <= aujourd'hui ; `aVenir` : date postérieure.
 * Par semaine : une semaine à cheval sur deux mois n'est comptée qu'une fois, sous son identifiant AAAA-Www ; les semaines des bords de
 * la période sont tronquées aux jours de la période (`partielle: true`). Les semaines sans séance sont présentes (période creuse).
 * -> { granularite, de, a, periodes: [{ periode, debut, partielle, realisees, aVenir, autres, total }], total }
 */
export function seances(prestations, { de, a, granularite = 'mois', aujourdHui }) {
  if (!GRANULARITES.includes(granularite)) throw new RangeError(`Granularité inconnue : ${granularite}`);
  const premierJour = `${de}-01`;
  const [anneeFin, moisFin] = a.split('-').map(Number);
  const dernierJour = `${a}-${String(joursDansMois(anneeFin, moisFin)).padStart(2, '0')}`;

  const periodes = [];
  if (granularite === 'mois') {
    for (const m of listerMois(de, a)) periodes.push({ periode: m, debut: `${m}-01`, partielle: false });
  } else {
    for (let lundi = lundiDeSemaine(premierJour); lundi <= dernierJour; lundi = ajouterJours(lundi, 7)) {
      periodes.push({ periode: semaineIso(lundi), debut: lundi, partielle: lundi < premierJour || ajouterJours(lundi, 6) > dernierJour });
    }
  }
  const parCle = new Map(periodes.map((p) => [p.periode, Object.assign(p, { realisees: 0, aVenir: 0, autres: 0, total: 0 })]));

  for (const p of prestations) {
    if (!dansPeriode(p.date, de, a)) continue;
    const e = parCle.get(granularite === 'mois' ? moisDe(p.date) : semaineIso(p.date));
    if (!e) continue;
    if (p.categorie !== 'seance') {
      e.autres += 1;
    } else if (p.date > aujourdHui) {
      e.aVenir += 1;
      e.total += 1;
    } else {
      e.realisees += 1;
      e.total += 1;
    }
  }
  const total = { realisees: 0, aVenir: 0, autres: 0, total: 0 };
  for (const e of periodes) for (const cle of Object.keys(total)) total[cle] += e[cle];
  return { granularite, de, a, periodes, total };
}

// ------------------------------------------------------------------ Répartition par type

/** Plus fort reste : parts entières (‰) sommant exactement 1000 ; départage déterministe par rang dans le tri. */
function repartirPourMille(types, totalCentimes) {
  if (totalCentimes === 0) return;
  const restes = types.map((t, rang) => {
    t.partPourMille = Math.floor((t.caCentimes * 1000) / totalCentimes);
    return { t, rang, reste: (t.caCentimes * 1000) % totalCentimes };
  });
  let manque = 1000 - types.reduce((s, t) => s + t.partPourMille, 0);
  restes.sort((x, y) => y.reste - x.reste || x.rang - y.rang);
  for (const { t } of restes) {
    if (manque <= 0) break;
    t.partPourMille += 1;
    manque -= 1;
  }
}

/**
 * Répartition du CA dû (Σ montants, date de prestation) par type de prestation (`prestationId`) entre les mois `de` et `a`.
 * Libellé = libellé actuel du catalogue ; à défaut, celui de la ligne la plus récente (un type renommé reste un seul groupe).
 * `partPourMille` : part en ‰, entier, calculée en entiers par la méthode du plus fort reste : les parts somment exactement 1000
 * (0 si le total est nul) ; à reste égal, le type placé en premier dans le tri l'emporte. Les montants somment exactement au total.
 * Tri : CA décroissant, puis libellé. -> { de, a, totalCentimes, nombre, types: [{ prestationId, libelle, categorie, nombre, caCentimes, partPourMille }] }
 */
export function repartition(prestations, { de, a, catalogue = [] }) {
  const groupes = new Map();
  for (const p of prestations) {
    if (!dansPeriode(p.date, de, a)) continue;
    let g = groupes.get(p.prestationId);
    if (!g) {
      g = { prestationId: p.prestationId, libelle: p.libelle, categorie: p.categorie, nombre: 0, caCentimes: 0, recente: p.date };
      groupes.set(p.prestationId, g);
    }
    if (p.date > g.recente) Object.assign(g, { recente: p.date, libelle: p.libelle, categorie: p.categorie });
    g.nombre += 1;
    g.caCentimes += p.montantCentimes;
  }
  const parId = new Map(catalogue.map((c) => [c.id, c]));
  const totalCentimes = [...groupes.values()].reduce((s, g) => s + g.caCentimes, 0);
  const types = [...groupes.values()]
    .map(({ recente, ...g }) => ({
      ...g,
      libelle: parId.get(g.prestationId)?.libelle ?? g.libelle,
      partPourMille: 0,
    }))
    .sort((x, y) => y.caCentimes - x.caCentimes || x.libelle.localeCompare(y.libelle, 'fr') || x.prestationId.localeCompare(y.prestationId));
  repartirPourMille(types, totalCentimes);
  return { de, a, totalCentimes, nombre: types.reduce((s, g) => s + g.nombre, 0), types };
}

// ------------------------------------------------------------------ Reste à encaisser et ancienneté

/**
 * Ancienneté en jours d'un impayé : depuis la date de facturation, à défaut depuis la date de prestation (prestation non
 * facturée). Jamais négative (une date de facturation future compte 0).
 */
export function ancienneteJours(prestation, aujourdHui) {
  return Math.max(0, ecartJours(prestation.statut === 'facture' && prestation.factureLe ? prestation.factureLe : prestation.date, aujourdHui));
}

export function trancheAnciennete(jours) {
  return TRANCHES.find((t) => jours >= t.min && (t.max === null || jours <= t.max)).id;
}

/**
 * Une ligne entre-t-elle dans le reste à encaisser (avant test du reste > 0) ? Date échue ou du jour, ou prestation à venir DÉJÀ facturée
 * (la facture est émise : la somme est attendue). Règle unique, partagée avec le filtre `anciennete` de la liste des prestations.
 */
export const compteDansImpayes = (prestation, aujourdHui) => prestation.date <= aujourdHui || prestation.statut === 'facture';

/**
 * Reste à encaisser : prestations dont le reste à payer est > 0 et qui comptent dans les impayés (voir `compteDansImpayes` : une
 * prestation à venir NON facturée n'est pas un impayé, une prestation à venir déjà facturée en est un). Séparées en « facturées » (à relancer, ancienneté depuis la facturation) et « non facturées » (à facturer d'abord : pas de
 * relance, ancienneté depuis la date de prestation). Le trop-perçu n'est jamais compensé : une ligne sans reste n'apparaît pas.
 * -> { totalResteCentimes, nombre, resteFactureCentimes, resteNonFactureCentimes, factures: [tranche], nonFactures: [tranche] }
 *    tranche = { tranche, libelle, nombre, resteCentimes }
 */
export function impayes(prestations, aujourdHui) {
  const creer = () => TRANCHES.map((t) => ({ tranche: t.id, libelle: t.libelle, nombre: 0, resteCentimes: 0 }));
  const sortie = { totalResteCentimes: 0, nombre: 0, resteFactureCentimes: 0, resteNonFactureCentimes: 0, factures: creer(), nonFactures: creer() };
  for (const p of prestations) {
    if (!compteDansImpayes(p, aujourdHui)) continue;
    const { resteCentimes } = etatPaiement(p);
    if (resteCentimes <= 0) continue;
    const facture = p.statut === 'facture';
    const t = (facture ? sortie.factures : sortie.nonFactures).find((x) => x.tranche === trancheAnciennete(ancienneteJours(p, aujourdHui)));
    t.nombre += 1;
    t.resteCentimes += resteCentimes;
    sortie[facture ? 'resteFactureCentimes' : 'resteNonFactureCentimes'] += resteCentimes;
    sortie.totalResteCentimes += resteCentimes;
    sortie.nombre += 1;
  }
  return sortie;
}

// Texte copiable du récapitulatif : colonnes séparées par des tabulations (collable dans un tableur ou un éditeur).
// Module PUR (aucun accès au DOM). C'est LE SEUL endroit à ajuster quand l’utilisatrice aura précisé les colonnes attendues par son
// outil de facturation : colonnes par défaut, titres, ordre, séparateur, ligne d'en-tête, ligne de total.
import { formatDate, formatMontantSaisie, nomPatient } from './format.js';

export const SEPARATEUR = '\t';
export const SAUT_DE_LIGNE = '\n';

/**
 * Colonnes disponibles : `titre(vue)` et `valeur(entree, vue)`. Les montants sont écrits « 1250,00 » (virgule décimale, sans
 * séparateur de milliers ni symbole €) pour rester collables comme nombres dans un tableur français.
 * `entree` = une ligne patient de GET /api/recap, ou son objet `total` (sans `patient`).
 */
export const COLONNES = {
  patient: { titre: () => 'Patient', valeur: (e) => (e.patient ? nomPatient(e.patient) : 'Total'), texte: true },
  seances: { titre: () => 'Séances', valeur: (e) => String(e.nbSeances) },
  autres: { titre: () => 'Autres prestations', valeur: (e) => String(e.nbAutres) },
  du: { titre: () => 'Montant dû', valeur: (e) => formatMontantSaisie(e.duCentimes) },
  paye: { titre: (vue) => (vue === 'versement' ? 'Encaissé' : 'Payé'), valeur: (e) => formatMontantSaisie(e.payeCentimes) },
  reste: { titre: () => 'Reste à payer', valeur: (e) => formatMontantSaisie(e.resteCentimes) },
};

/** Colonnes par défaut (format de copie encore provisoire) ; dans la vue par date de versement, « reste à payer » n'a pas de sens et disparaît. */
export const COLONNES_PAR_DEFAUT = {
  prestation: ['patient', 'seances', 'du', 'paye', 'reste'],
  versement: ['patient', 'seances', 'du', 'paye'],
};

/** Aucun retour à la ligne ni tabulation dans une cellule ; une cellule de texte ne doit pas être prise pour une formule (=, +, -, @). */
function cellule(texte, { texteLibre = false } = {}) {
  const propre = String(texte).replace(/[\t\r\n]+/g, ' ').trim();
  return texteLibre && /^[=+\-@]/.test(propre) ? `'${propre}` : propre;
}

/**
 * Récapitulatif -> texte. `recap` = réponse de GET /api/recap. Options : `colonnes` (identifiants de COLONNES),
 * `entete` (ligne de titres, défaut oui), `total` (ligne de total, défaut oui).
 */
export function formaterRecapTexte(recap, { colonnes, entete = true, total = true } = {}) {
  const ids = colonnes ?? COLONNES_PAR_DEFAUT[recap.vue] ?? COLONNES_PAR_DEFAUT.prestation;
  const defs = ids.map((id) => {
    if (!COLONNES[id]) throw new RangeError(`Colonne inconnue : ${id}`);
    return COLONNES[id];
  });
  const ligne = (entree) => defs.map((d) => cellule(d.valeur(entree, recap.vue), { texteLibre: d.texte === true })).join(SEPARATEUR);
  const lignes = [];
  if (entete) lignes.push(defs.map((d) => cellule(d.titre(recap.vue))).join(SEPARATEUR));
  for (const e of recap.patients) lignes.push(ligne(e));
  if (total) lignes.push(ligne(recap.total));
  return lignes.join(SAUT_DE_LIGNE);
}

/** Détail d'un patient (« Copier le détail ») : nom, puis une ligne par prestation du mois (date, libellé, montant) et le total. */
export function formaterDetailTexte(entree) {
  const lignes = [cellule(nomPatient(entree.patient), { texteLibre: true }), ['Date', 'Prestation', 'Montant'].join(SEPARATEUR)];
  let somme = 0;
  for (const l of entree.lignes) {
    lignes.push([formatDate(l.date), cellule(l.libelle, { texteLibre: true }), formatMontantSaisie(l.montantCentimes)].join(SEPARATEUR));
    somme += l.montantCentimes;
  }
  lignes.push(['Total', '', formatMontantSaisie(somme)].join(SEPARATEUR));
  return lignes.join(SAUT_DE_LIGNE);
}

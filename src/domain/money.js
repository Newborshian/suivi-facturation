// Argent en centimes entiers, jamais en flottants. Module pur.

export const MONTANT_PRESTATION_MAX = 10_000_000; // 100 000 EUR : garde-fou contre les fautes de frappe
export const MONTANT_VERSEMENT_MAX = 10_000_000;

function entierDans(valeur, min, max) {
  return Number.isSafeInteger(valeur) && valeur >= min && valeur <= max;
}

/** Prestation : 0 <= m <= 100 000 EUR (0 EUR autorisé). */
export function estMontantPrestation(valeur) {
  return entierDans(valeur, 0, MONTANT_PRESTATION_MAX);
}

/** Versement : 1 centime <= v <= 100 000 EUR. */
export function estMontantVersement(valeur) {
  return entierDans(valeur, 1, MONTANT_VERSEMENT_MAX);
}

/** Tarif de catalogue : mêmes bornes qu'une prestation. */
export const estTarif = estMontantPrestation;

/**
 * Centimes -> texte sans séparateur de milliers, virgule décimale ("1250,50"),
 * pour l'export et le texte copié. Calcul sur entiers uniquement.
 */
export function formaterCentimes(centimes) {
  if (!Number.isSafeInteger(centimes)) throw new TypeError('Montant en centimes entier attendu.');
  const signe = centimes < 0 ? '-' : '';
  const abs = Math.abs(centimes);
  return `${signe}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

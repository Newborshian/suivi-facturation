// Règles pures de l'écran « Facturation du mois » (aucun accès au DOM : testables avec node --test).

/** Lignes de toutes les entrées patient d'un récapitulatif. */
export const toutesLesLignes = (entrees) => entrees.flatMap((e) => e.lignes);

/**
 * Règle commune de tous les boutons « Marquer facturé » (tout le mois, un patient, une sélection) : les prestations à facturer
 * et déjà échues, y compris celles à 0 € (elles figurent sur la facture) ; les prestations à venir restent à facturer.
 * -> { concernees: lignes, aVenir: nombre de lignes à venir laissées de côté }
 */
export function lignesAMarquer(lignes) {
  const aFacturer = lignes.filter((l) => l.statut === 'a_facturer');
  return { concernees: aFacturer.filter((l) => !l.aVenir), aVenir: aFacturer.filter((l) => l.aVenir).length };
}

/** « Marquer tout le mois facturé » : lignes à facturer et déjà échues, y compris à 0 € ; les prestations à venir sont exclues. */
export const lignesAMarquerDuMois = (entrees) => lignesAMarquer(toutesLesLignes(entrees)).concernees;

/** Prestations à venir encore à facturer (non concernées par « tout le mois »). */
export const nbAVenirAFacturer = (entrees) => toutesLesLignes(entrees).filter((l) => l.statut === 'a_facturer' && l.aVenir).length;

/**
 * Récapitulatif à copier : toujours la vue par date de prestation (celle avec le reste à payer), même quand la vue par
 * date de versement est affichée. `chargerPrestation(mois)` charge GET /api/recap?vue=prestation&mois=… au besoin.
 */
export async function recapACopier(recap, chargerPrestation) {
  return recap.vue === 'prestation' ? recap : chargerPrestation(recap.mois);
}

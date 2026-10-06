// État de paiement calculé (jamais stocké) : architecture §6.2. Module pur, centimes entiers.

/**
 * -> { verseCentimes, payeCentimes, resteCentimes, tropPercuCentimes, etat }
 *   paye = min(verse, montant) ; reste = montant - paye ; trop-perçu = max(0, verse - montant)
 *   etat = payé si verse >= montant (un montant de 0 € est payé d'office), sinon non payé (verse = 0) ou partiel.
 */
export function etatPaiement(prestation) {
  const verse = prestation.versements.reduce((somme, v) => somme + v.montantCentimes, 0);
  const montant = prestation.montantCentimes;
  const paye = Math.min(verse, montant);
  return {
    verseCentimes: verse,
    payeCentimes: paye,
    resteCentimes: montant - paye,
    tropPercuCentimes: Math.max(0, verse - montant),
    etat: verse >= montant ? 'paye' : verse === 0 ? 'non_paye' : 'partiel',
  };
}

/** Ligne « enrichie » renvoyée par l'API : la ligne stockée + l'état calculé + `aVenir` (date postérieure à aujourd'hui). */
export function enrichir(prestation, aujourdHui) {
  return { ...prestation, ...etatPaiement(prestation), aVenir: prestation.date > aujourdHui };
}

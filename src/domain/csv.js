// Export CSV « tableur français » (architecture §6.8). Module pur.
// Séparateur `;`, décimale virgule sans séparateur de milliers, dates JJ/MM/AAAA, fins de ligne CRLF, BOM UTF-8
// (pour qu'Excel reconnaisse les accents), guillemets doublés, protection contre l'injection de formule.
import { formaterDateFr } from './dates.js';
import { formaterCentimes } from './money.js';
import { etatPaiement } from './paiement.js';

export const BOM = '﻿';
export const SEPARATEUR = ';';
export const FIN_DE_LIGNE = '\r\n';

const LIBELLES_STATUT = { a_facturer: 'À facturer', facture: 'Facturé' };
const LIBELLES_ETAT = { non_paye: 'Non payé', partiel: 'Partiellement payé', paye: 'Payé' };
const LIBELLES_CATEGORIE = { seance: 'Séance', bilan: 'Bilan', autre: 'Autre' };
const LIBELLES_MODE = { carte: 'Carte bancaire', cheque: 'Chèque', especes: 'Espèces', virement: 'Virement', autre: 'Autre' };

/**
 * Cellule de texte : une valeur qui commence par =, +, -, @, tabulation ou retour chariot serait prise pour une formule
 * par un tableur ; elle est préfixée d'une apostrophe. Puis mise entre guillemets (doublés) si elle contient ; " ou un saut de ligne.
 */
export function cellule(valeur) {
  let texte = valeur === null || valeur === undefined ? '' : String(valeur);
  if (/^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`;
  return /[;"\r\n]/.test(texte) ? `"${texte.replaceAll('"', '""')}"` : texte;
}

/** Montant en centimes -> « 1250,50 » (cellule numérique : jamais préfixée). */
const montant = (centimes) => formaterCentimes(centimes);
const date = (d) => (typeof d === 'string' && d !== '' ? formaterDateFr(d) : '');

/** Lignes (tableaux de cellules déjà formatées) -> texte CSV complet avec BOM. */
export function serialiserCsv(entetes, lignes) {
  const corps = [entetes, ...lignes].map((l) => l.map(cellule).join(SEPARATEUR));
  return `${BOM}${corps.join(FIN_DE_LIGNE)}${FIN_DE_LIGNE}`;
}

// Les cellules numériques et les dates sont fabriquées par ce module (jamais une saisie) : elles ne contiennent ni ; ni =, +, -, @.
// Les montants négatifs n'existent pas (trop-perçu = max(0, …)).

export const ENTETES_PRESTATIONS = ['id', 'date', 'nom', 'prenom', 'prestation', 'categorie', 'motif', 'montant', 'statut', 'facture_le', 'verse', 'reste', 'trop_percu', 'etat', 'nb_versements'];
export const ENTETES_VERSEMENTS = ['prestation_id', 'date_prestation', 'nom', 'prenom', 'date_versement', 'mode', 'montant'];

/** Une ligne par prestation, triée par date puis création. Montants en euros avec virgule. */
export function csvPrestations(prestations) {
  const triees = [...prestations].sort((a, b) => a.date.localeCompare(b.date) || a.creeLe.localeCompare(b.creeLe) || a.id.localeCompare(b.id));
  return serialiserCsv(
    ENTETES_PRESTATIONS,
    triees.map((l) => {
      const e = etatPaiement(l);
      return [
        l.id,
        date(l.date),
        l.patient.nom,
        l.patient.prenom,
        l.libelle,
        LIBELLES_CATEGORIE[l.categorie] ?? l.categorie,
        l.motif,
        montant(l.montantCentimes),
        LIBELLES_STATUT[l.statut] ?? l.statut,
        date(l.factureLe),
        montant(e.verseCentimes),
        montant(e.resteCentimes),
        montant(e.tropPercuCentimes),
        LIBELLES_ETAT[e.etat],
        String(l.versements.length),
      ];
    }),
  );
}

/** Une ligne par versement, triée par date de versement. */
export function csvVersements(prestations) {
  const lignes = [];
  for (const l of prestations) {
    for (const v of l.versements) lignes.push({ l, v });
  }
  lignes.sort((a, b) => a.v.date.localeCompare(b.v.date) || a.l.date.localeCompare(b.l.date) || a.v.id.localeCompare(b.v.id));
  return serialiserCsv(
    ENTETES_VERSEMENTS,
    lignes.map(({ l, v }) => [l.id, date(l.date), l.patient.nom, l.patient.prenom, date(v.date), LIBELLES_MODE[v.mode] ?? v.mode, montant(v.montantCentimes)]),
  );
}

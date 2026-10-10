// Textes du paiement en un clic et du choix du mode (design system §5.14). Module PUR (aucun accès au DOM) : testé avec node --test.
// Chaque bouton annonce le verbe, le montant exact et le nom complet du mode, puis la prestation concernée.
import { LIBELLES_MODE, formatDate, formatEuros } from './format.js';

/** Les cinq modes, dans l'ordre fixe de l'interface (carte bancaire, chèque, espèces, virement, autre). */
export const MODES = Object.keys(LIBELLES_MODE);

/** « par chèque » (même formule que le résumé de la colonne Paiement : « un autre mode »). */
export const PAR_MODE = { carte: 'par carte bancaire', cheque: 'par chèque', especes: 'par espèces', virement: 'par virement', autre: 'par un autre mode' };
/** « en espèces » (changement du mode d'un versement existant). */
export const EN_MODE = { carte: 'en carte bancaire', cheque: 'en chèque', especes: 'en espèces', virement: 'en virement', autre: 'en autre mode' };

export const MENTION_RECENT = 'dernier mode utilisé';

export const modeConnu = (mode) => typeof mode === 'string' && Object.hasOwn(LIBELLES_MODE, mode);

const prestationDe = ({ date, patient }) => `prestation du ${formatDate(date)} de ${patient}`;

/** Nom du groupe : « Payer le reste de la prestation du 07/10/2026 de Lapin Pierre : 58,00 € ». */
export const nomGroupePaiement = (ligne) => `Payer le reste de la ${prestationDe(ligne)} : ${formatEuros(ligne.resteCentimes)}`;

/** Nom accessible d'un bouton de mode : « Payer 58,00 € par chèque : prestation du … de … » (+ « , dernier mode utilisé »). */
export const nomBoutonPaiement = (ligne, mode, recent) => `Payer ${formatEuros(ligne.resteCentimes)} ${PAR_MODE[mode]}${recent ? `, ${MENTION_RECENT}` : ''} : ${prestationDe(ligne)}`;

/** Bulle d'un bouton de mode : « Chèque » ou « Carte bancaire (dernier mode utilisé) ». */
export const titreBoutonPaiement = (mode, recent) => `${LIBELLES_MODE[mode]}${recent ? ` (${MENTION_RECENT})` : ''}`;

/** Déclencheur de la variante compacte : le nom commence par le texte visible « Payer » (WCAG 2.5.3). */
export const nomDeclencheurPaiement = (ligne) => `Payer ${formatEuros(ligne.resteCentimes)} : choisir le mode de paiement (${prestationDe(ligne)})`;

/** Changement direct du mode d'un versement : « Passer le versement du 07/10/2026 en espèces ». */
export const nomChangementMode = (date, mode) => `Passer le versement du ${formatDate(date)} ${EN_MODE[mode]}`;
export const nomGroupeChangementMode = (date) => `Mode du versement du ${formatDate(date)}`;
export const nomDeclencheurChangementMode = (date, mode) => `${LIBELLES_MODE[mode]} : changer le mode du versement du ${formatDate(date)}`;

/**
 * Message après un paiement en un clic, d'après la prestation RENVOYÉE par le serveur (son dernier versement est celui qui vient d'être créé) :
 * le montant annoncé est le reste réel au moment de l'enregistrement, pas celui affiché avant le clic. `repli` : montant affiché, si la réponse est incomplète.
 * -> { texte: « 58,00 € enregistrés par chèque. », mode }
 */
export function messagePaiement(prestation, repli) {
  const dernier = prestation?.versements?.at(-1);
  const montant = Number.isSafeInteger(dernier?.montantCentimes) ? dernier.montantCentimes : repli;
  const mode = modeConnu(dernier?.mode) ? dernier.mode : null;
  return { texte: `${formatEuros(montant)} enregistrés${mode ? ` ${PAR_MODE[mode]}` : ''}.`, mode };
}

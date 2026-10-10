// Choix du mode de paiement dans un dialogue (design system §5.14) : cinq boutons à choix unique, de vrais <input type="radio">
// enveloppés dans des <label> (un seul arrêt de tabulation, flèches pour changer, « 2 sur 5 » annoncé par les lecteurs d'écran).
import { el } from './dom.js';
import { LIBELLES_MODE } from './format.js';
import { iconeMode } from './icones-paiement.js';
import { MODES } from './paiement-libelles.js';

let compteur = 0;

/**
 * `selectionne` : mode présélectionné (ou null) ; `recent` : dernier mode utilisé, signalé par la mention « Dernier mode utilisé »
 * (à l'ajout seulement ; à la modification d'un versement, aucune mention).
 * -> { racine, entree (première option, pour le focus), valeur(), erreur(message), effacerErreur() } : même interface qu'un champ de `creerChamp`.
 */
export function creerChoixMode({ selectionne = null, recent = null } = {}) {
  const n = ++compteur;
  const idErreur = `choix-mode-${n}-erreur`;
  const paraErreur = el('p', { classe: 'champ__erreur', attributs: { id: idErreur, hidden: true } });
  const options = MODES.map((mode) => ({
    mode,
    radio: el('input', { classe: 'choix-mode__entree', attributs: { type: 'radio', name: `mode-${n}`, value: mode }, proprietes: { checked: mode === selectionne } }),
  }));
  const liste = el(
    'div',
    { classe: 'choix-mode__liste' },
    ...options.map(({ mode, radio }) =>
      el(
        'label',
        { classe: 'choix-mode__option', attributs: { 'data-recent': mode === recent ? 'oui' : null } },
        radio,
        iconeMode(mode),
        el('span', { classe: 'choix-mode__texte', texte: LIBELLES_MODE[mode] }),
        mode === recent ? el('span', { classe: 'choix-mode__note', texte: 'Dernier mode utilisé' }) : null,
      ),
    ),
  );
  const racine = el('fieldset', { classe: 'groupe choix-mode', attributs: { 'aria-describedby': idErreur } }, el('legend', {}, 'Mode de paiement', el('span', { classe: 'champ__requis', texte: ' (obligatoire)' })), liste, paraErreur);

  const effacerErreur = () => {
    racine.classList.remove('choix-mode--erreur');
    paraErreur.textContent = '';
    paraErreur.hidden = true;
  };
  for (const { radio } of options) radio.addEventListener('change', effacerErreur);

  return {
    racine,
    entree: options[0].radio,
    valeur: () => options.find((o) => o.radio.checked)?.mode ?? null,
    erreur(message) {
      racine.classList.add('choix-mode--erreur');
      paraErreur.textContent = message; // le « ! » est ajouté par le CSS
      paraErreur.hidden = false;
    },
    effacerErreur,
  };
}

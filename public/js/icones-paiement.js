// Icônes des modes de paiement (design system §5.13) : tracés au trait sur une grille 24 × 24, couleur et épaisseur posées par le CSS.
// Construites par createElementNS (via svg.js) : jamais de HTML construit, aucun attribut style, aucune ressource externe.
import { svg } from './graphiques/svg.js';
import { LIBELLES_MODE } from './format.js';

/** Clé de mode -> formes [balise, attributs] (géométrie du design system §5.13, recopiée telle quelle). */
export const ICONES_MODES = {
  carte: [
    ['rect', { x: 2.5, y: 5, width: 19, height: 14, rx: 2.5 }],
    ['line', { x1: 2.5, y1: 10, x2: 21.5, y2: 10 }],
    ['line', { x1: 6, y1: 15, x2: 10, y2: 15 }],
  ],
  cheque: [
    ['rect', { x: 2.5, y: 5, width: 19, height: 14, rx: 2 }],
    ['line', { x1: 6, y1: 9, x2: 13, y2: 9 }],
    ['line', { x1: 6, y1: 12.5, x2: 10, y2: 12.5 }],
    ['path', { d: 'M12.5 16.5c1.2-2.7 2.2-2.7 2.8-.7.5 1.5 1.6 1.5 2.7-1' }],
  ],
  especes: [
    ['rect', { x: 2.5, y: 6, width: 19, height: 12, rx: 2 }],
    ['circle', { cx: 12, cy: 12, r: 2.75 }],
  ],
  virement: [
    ['path', { d: 'M4 8h16' }],
    ['path', { d: 'M16 4l4 4-4 4' }],
    ['path', { d: 'M20 16H4' }],
    ['path', { d: 'M8 12l-4 4 4 4' }],
  ],
  autre: [
    ['circle', { cx: 5, cy: 12, r: 0.75 }],
    ['circle', { cx: 12, cy: 12, r: 0.75 }],
    ['circle', { cx: 19, cy: 12, r: 0.75 }],
  ],
};

/** Libellé affiché (« Chèque ») -> clé (« cheque ») ; libellé inconnu -> « autre ». */
export function cleModeDepuisLibelle(libelle) {
  return Object.entries(LIBELLES_MODE).find(([, l]) => l === libelle)?.[0] ?? 'autre';
}

/** <svg class="icone-mode icone-mode--virement" viewBox="0 0 24 24" aria-hidden="true" focusable="false">…</svg> */
export function iconeMode(cle) {
  const k = Object.hasOwn(ICONES_MODES, cle) ? cle : 'autre';
  return svg(
    'svg',
    { class: `icone-mode icone-mode--${k}`, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    ...ICONES_MODES[k].map(([balise, attributs]) => svg(balise, attributs)),
  );
}

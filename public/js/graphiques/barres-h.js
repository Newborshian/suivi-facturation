// Barres horizontales HTML/CSS (répartition par type, impayés par ancienneté : design-system §6.5).
// Le texte (libellé, montant, pourcentage) porte l'information ; la barre n'est qu'un renfort. La largeur passe par la variable CSS
// --part posée en CSSOM (setProperty) : aucun attribut style, compatible avec style-src 'self'.
import { el } from '/js/dom.js';

/**
 * `items` : [{ libelle, valeur (texte), detail? (texte), part (0 à 100), serie?: 'attente'|'a-facturer', href?, aria? }]
 * Un item avec `href` est un lien (<a class="barre-h">), sinon un <div class="barre-h">.
 */
export function listeBarresH(items) {
  return el(
    'ul',
    { classe: 'barres-h' },
    ...items.map((item) => {
      const rempli = el('span', { classe: 'barre-h__rempli', attributs: { 'data-serie': item.serie } });
      rempli.style.setProperty('--part', `${Math.round(Math.min(Math.max(item.part, 0), 100) * 10) / 10}%`);
      const contenu = [
        el('span', { classe: 'barre-h__libelle', texte: item.libelle }),
        el('span', { classe: 'barre-h__piste', attributs: { 'aria-hidden': 'true' } }, rempli),
        el('span', { classe: 'barre-h__valeur' }, item.valeur, item.detail ? el('small', { texte: item.detail }) : null),
      ];
      return el('li', {}, item.href ? el('a', { classe: 'barre-h', attributs: { href: item.href, 'aria-label': item.aria } }, ...contenu) : el('div', { classe: 'barre-h' }, ...contenu));
    }),
  );
}

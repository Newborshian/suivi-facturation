// Sélection multiple de la liste des prestations (logique pure, sans DOM : testée sous node).
// Cocher une case ne redessine que la ligne et la barre de sélection : ces fonctions disent quoi afficher.
import { pluriel } from './format.js';

/** Ajoute (`coche` vrai) ou retire l'identifiant de la sélection (un Set) ; renvoie la même sélection. */
export function appliquerSelection(selection, id, coche) {
  if (coche) selection.add(id);
  else selection.delete(id);
  return selection;
}

/** « Tout sélectionner » est coché quand toutes les lignes affichées (au moins une) sont sélectionnées. */
export const toutSelectionne = (idsVisibles, selection) => idsVisibles.length > 0 && idsVisibles.every((id) => selection.has(id));

/** Barre de sélection : { visible, texte } (texte vide quand rien n'est sélectionné). */
export function etatBarreSelection(nombre) {
  return { visible: nombre > 0, texte: nombre === 0 ? '' : pluriel(nombre, 'prestation sélectionnée', 'prestations sélectionnées') };
}

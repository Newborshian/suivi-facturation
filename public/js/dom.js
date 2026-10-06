// Création d'éléments par textContent uniquement : jamais de HTML construit à partir de données.
import { cleModeDepuisLibelle, iconeMode } from './icones-paiement.js';

// `attributs` : valeur true = attribut booléen présent ; false / null / undefined = absent.
// `evenements` : { click: fn, ... } ; `proprietes` : { value: '…', checked: true, ... } (propriétés DOM).
export function el(balise, { classe, texte, attributs, evenements, proprietes } = {}, ...enfants) {
  const noeud = document.createElement(balise);
  if (classe) noeud.className = classe;
  if (texte !== undefined) noeud.textContent = texte;
  for (const [nom, valeur] of Object.entries(attributs ?? {})) {
    if (valeur === false || valeur === null || valeur === undefined) continue;
    noeud.setAttribute(nom, valeur === true ? '' : valeur);
  }
  for (const [nom, valeur] of Object.entries(proprietes ?? {})) noeud[nom] = valeur;
  for (const [nom, gestionnaire] of Object.entries(evenements ?? {})) noeud.addEventListener(nom, gestionnaire);
  noeud.append(...enfants.filter((e) => e !== null && e !== undefined && e !== false));
  return noeud;
}

/** Remplace le contenu d'un conteneur. */
export function remplacer(conteneur, ...enfants) {
  conteneur.replaceChildren(...enfants.filter((e) => e !== null && e !== undefined && e !== false));
}

/**
 * Modes de paiement (design system §5.13) : <span class="cellule-double__secondaire modes-paiement"> contenant, par libellé,
 * <span class="mode-paiement" title="Virement"><svg class="icone-mode icone-mode--virement" …/></span>, séparés par un simple espace
 * (retour à la ligne possible entre les icônes seulement). Libellé inconnu -> icône « Autre ». Aucun « + » ni « · » dans le DOM : ils viennent du CSS.
 */
export function elementModesPaiement(libelles) {
  const conteneur = el('span', { classe: 'cellule-double__secondaire modes-paiement' });
  libelles.forEach((libelle, i) => {
    if (i > 0) conteneur.append(' ');
    conteneur.append(el('span', { classe: 'mode-paiement', attributs: { title: libelle } }, iconeMode(cleModeDepuisLibelle(libelle))));
  });
  return conteneur;
}

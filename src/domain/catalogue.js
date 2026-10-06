// Catalogue de tarifs. Fonctions pures appliquées à la copie de travail de l'état (celle que fournit store.muter).
// Une modification n'a JAMAIS d'effet rétroactif : les prestations déjà saisies gardent leur libellé, leur catégorie et leur montant
// (figés dans la ligne). Un type de prestation référencé n'est jamais supprimé : il se désactive.
import { ErreurApp } from '../erreurs.js';
import { validerCatalogueCreation, validerCatalogueModification } from './validation.js';

const introuvable = () => new ErreurApp(404, 'INTROUVABLE', "Cette prestation du catalogue est introuvable.");

function trouver(etat, id) {
  const entree = etat.catalogue.find((c) => c.id === id);
  if (!entree) throw introuvable();
  return entree;
}

/** Ajoute une prestation (active, placée en dernier). -> { resultat: entrée, avertissements } */
export function ajouterAuCatalogue(etat, corps, { nouvelId }) {
  const v = validerCatalogueCreation(corps);
  const ordre = etat.catalogue.reduce((max, c) => Math.max(max, c.ordre), 0) + 1;
  const entree = { id: nouvelId(), libelle: v.libelle, tarifCentimes: v.tarifCentimes, categorie: v.categorie, actif: true, ordre };
  etat.catalogue.push(entree);
  return { resultat: entree, avertissements: [] };
}

/** Modifie libellé, tarif, catégorie, activation ou ordre. Aucune ligne de prestation n'est touchée. */
export function modifierDansCatalogue(etat, id, corps) {
  const entree = trouver(etat, id);
  Object.assign(entree, validerCatalogueModification(corps));
  return { resultat: entree, avertissements: [] };
}

/**
 * Supprime une prestation du catalogue seulement si aucune ligne (active ou archivée) ne la référence ;
 * `idsUtilises` = ensemble des `prestationId` présents dans le fichier actif et dans les archives lisibles.
 * Sinon 409 CATALOGUE_UTILISE (il faut la désactiver).
 */
export function supprimerDuCatalogue(etat, id, idsUtilises) {
  const entree = trouver(etat, id);
  if (idsUtilises.has(id) || etat.prestations.some((l) => l.prestationId === id)) {
    throw new ErreurApp(409, 'CATALOGUE_UTILISE', 'Cette prestation a déjà été utilisée : elle ne peut pas être supprimée, seulement désactivée. Elle ne sera plus proposée à la saisie et l\'historique reste intact.');
  }
  etat.catalogue.splice(etat.catalogue.indexOf(entree), 1);
  return { resultat: { id }, avertissements: [] };
}

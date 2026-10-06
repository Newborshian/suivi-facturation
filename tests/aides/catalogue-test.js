// Catalogue fictif des tests. L'application démarre avec un catalogue VIDE ; les tests qui saisissent des prestations partent donc
// d'un fichier déjà garni de ce catalogue (le même que le jeu d'exemple : prix inventés, sans lien avec un cabinet réel).
// Les montants attendus se calculent avec `tarifTest(id)` plutôt qu'en dur.
import { creerEtatInitial } from '../../src/domain/schema.js';
import { catalogueExemple } from '../../src/exemple.js';

export const catalogueTest = catalogueExemple;
export const ID_SEANCE_30 = 'seance-30';
export const ID_SEANCE_45 = 'seance-45';
export const ID_SEANCE_DOMICILE = 'seance-domicile-45';
export const ID_BILAN = 'bilan-initial';
export const ID_COMPTE_RENDU = 'compte-rendu';
export const ID_REUNION = 'reunion-synthese';

const entree = (id) => {
  const e = catalogueExemple().find((c) => c.id === id);
  if (!e) throw new Error(`Prestation de test inconnue : ${id}`);
  return e;
};
/** Tarif (centimes) d'une prestation du catalogue de test. */
export const tarifTest = (id) => entree(id).tarifCentimes;
export const libelleTest = (id) => entree(id).libelle;

/** État initial valide (version courante) avec le catalogue de test, sans prestation. */
export function etatInitialTest(maintenant = new Date('2026-10-01T08:00:00.000Z')) {
  const etat = creerEtatInitial(maintenant);
  etat.catalogue = catalogueExemple();
  return etat;
}

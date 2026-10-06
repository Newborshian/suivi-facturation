// Premier démarrage (fichier de données vide, aucune prestation) : un accueil explicite à la place du message « aucune prestation
// ce mois-ci », sans jeu d'exemple. Le nombre total de prestations vient de GET /api/etat (aucun nom, aucun montant).
// Tant que le catalogue est vide (ou entièrement désactivé), l'accueil guide en deux étapes : définir les prestations, puis les saisir.
import { lireEtat } from '/js/api.js';
import { LIEN_TARIFS, guideCatalogue } from '/js/catalogue-etat.js';
import { el } from '/js/dom.js';

/**
 * Contenu de l'accueil. `ajouter` = lien vers la saisie (absent sur l'écran Prestations, où le formulaire est juste au-dessus).
 * `catalogue` : catalogue courant ; s'il n'est pas utilisable, l'accueil devient le guide « définir vos prestations ».
 */
export function accueilFichierVide({ ajouter, catalogue }) {
  const guide = guideCatalogue(catalogue);
  if (guide) {
    return el(
      'div',
      { classe: 'etat-vide', attributs: { 'data-accueil-vide': 'oui', 'data-catalogue': guide.etat } },
      el('p', { classe: 'etat-vide__titre', texte: guide.titre }),
      ...guide.etapes.map((texte) => el('p', { classe: 'etat-vide__texte', texte })),
      el('div', { classe: 'etat-vide__actions' }, el('a', { classe: 'btn btn--primaire', texte: guide.lien, attributs: { href: LIEN_TARIFS } })),
    );
  }
  return el(
    'div',
    { classe: 'etat-vide', attributs: { 'data-accueil-vide': 'oui' } },
    el('p', { classe: 'etat-vide__titre', texte: "Bienvenue : aucune prestation n'est encore enregistrée" }),
    el('p', { classe: 'etat-vide__texte', texte: ajouter ? 'Ajoutez votre première prestation : le récapitulatif du mois apparaîtra ici.' : 'Ajoutez votre première prestation avec le formulaire ci-dessus.' }),
    el('div', { classe: 'etat-vide__actions' }, ajouter ? el('a', { classe: 'btn btn--primaire', texte: 'Ajouter une prestation', attributs: { href: '/prestations.html' } }) : null, el('a', { classe: 'btn btn--secondaire', texte: 'Voir les tarifs', attributs: { href: LIEN_TARIFS } })),
  );
}

/**
 * Remplace `noeud` (message « aucune prestation » affiché sans attendre) par l'accueil si le fichier ne contient vraiment aucune
 * prestation, tous mois confondus. Une erreur de lecture laisse le message d'origine.
 */
export function remplacerSiFichierVide(noeud, options) {
  lireEtat()
    .then((etat) => {
      if (etat.nombrePrestations === 0 && noeud.isConnected) noeud.replaceWith(accueilFichierVide(options));
    })
    .catch(() => {});
}

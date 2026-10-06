// État du catalogue de prestations et textes du guide qui en découle (logique pure, sans DOM : testée sous node).
// Un fichier de données neuf a un catalogue VIDE : rien ne peut être saisi tant qu'aucune prestation active n'est définie.

export const LIEN_TARIFS = '/parametres.html#tarifs';

// Catégorie présélectionnée à l'ajout d'une prestation (choix d'ergonomie) : la plus courante, pour qu'une séance ne soit jamais comptée « Autre » par oubli.
export const CATEGORIE_PAR_DEFAUT = 'seance';

/** 'vide' (aucune prestation définie), 'inactif' (définies mais toutes désactivées) ou 'utilisable' (au moins une active). */
export function etatCatalogue(catalogue) {
  if (!Array.isArray(catalogue) || catalogue.length === 0) return 'vide';
  return catalogue.some((c) => c.actif) ? 'utilisable' : 'inactif';
}

/** Vrai tant qu'on ne peut pas saisir de prestation (formulaire d'ajout désactivé). */
export const saisieImpossible = (catalogue) => etatCatalogue(catalogue) !== 'utilisable';

/**
 * Textes du guide affiché à la place de la saisie quand le catalogue n'est pas utilisable ; null si tout va bien.
 * -> { titre, etapes: [texte, ...], lien } (`etapes` = paragraphes déjà numérotés), ou { titre, etapes: [texte], lien } pour 'inactif'.
 */
export function guideCatalogue(catalogue) {
  const etat = etatCatalogue(catalogue);
  if (etat === 'vide') {
    return {
      etat,
      titre: "Bienvenue : commencez par définir vos prestations",
      etapes: ['1. Définissez vos prestations et leurs tarifs (Paramètres → Tarifs).', '2. Saisissez ensuite vos prestations.'],
      lien: 'Définir mes prestations et tarifs',
    };
  }
  if (etat === 'inactif') {
    return {
      etat,
      titre: "Aucune prestation n'est active dans votre catalogue",
      etapes: ["Toutes les prestations du catalogue sont désactivées : aucune ne peut être saisie. Réactivez-en une ou ajoutez-en une nouvelle (Paramètres → Tarifs), puis saisissez vos prestations."],
      lien: 'Ouvrir Paramètres → Tarifs',
    };
  }
  return null;
}

/** Message affiché au-dessus du formulaire d'ajout désactivé (écran Prestations) ; null si la saisie est possible. */
export function explicationFormulaireDesactive(catalogue) {
  const etat = etatCatalogue(catalogue);
  if (etat === 'vide') return { titre: 'Saisie impossible pour le moment', texte: "Votre catalogue de prestations est vide : définissez d'abord vos prestations et leurs tarifs (Paramètres → Tarifs), puis revenez saisir vos prestations.", lien: 'Définir mes prestations et tarifs' };
  if (etat === 'inactif') return { titre: 'Saisie impossible pour le moment', texte: 'Toutes les prestations de votre catalogue sont désactivées : réactivez-en une ou ajoutez-en une dans Paramètres → Tarifs, puis revenez saisir vos prestations.', lien: 'Ouvrir Paramètres → Tarifs' };
  return null;
}

/** Texte de l'état vide de Paramètres → Tarifs ; null si le catalogue contient au moins une prestation active. */
export function messageTarifsVide(catalogue) {
  const etat = etatCatalogue(catalogue);
  if (etat === 'vide') return { titre: 'Aucune prestation définie', texte: "Ajoutez votre première prestation avec le formulaire ci-dessous : nom, catégorie et tarif. Elle sera ensuite proposée à la saisie des prestations." };
  if (etat === 'inactif') return { titre: "Aucune prestation active", texte: "Toutes vos prestations sont désactivées, donc aucune ne peut être saisie. Cochez « Active » sur l'une d'elles, ou ajoutez-en une nouvelle avec le formulaire ci-dessous." };
  return null;
}

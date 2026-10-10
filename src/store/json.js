// Lecture et écriture du texte JSON des fichiers de l'application (fichier actif, sauvegardes, archives). Module sans E/S.
// À ne pas casser : `serialiser` fixe le format exact du fichier sur le disque (indentation de 2 espaces + saut de ligne final) ;
// le changer modifierait chaque fichier à la prochaine écriture (et les empreintes de conflit, les comparaisons de sauvegardes).

/** Octets (Buffer) -> valeur JSON. Un BOM UTF-8 de tête (ajouté par certains éditeurs Windows) est toléré. Lève une SyntaxError si illisible. */
export function lireJson(octets) {
  return JSON.parse(octets.toString('utf8').replace(/^﻿/, ''));
}

/** État -> texte écrit sur le disque : JSON indenté de 2 espaces, suivi d'un saut de ligne. */
export const serialiser = (etat) => `${JSON.stringify(etat, null, 2)}\n`;

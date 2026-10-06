// Aides à l'accessibilité (logique pure, sans DOM : testée sous node).

/**
 * Valeur de `aria-describedby` d'un champ : le texte d'aide (s'il existe), puis le message d'erreur quand le champ est en erreur.
 * -> chaîne d'identifiants séparés par un espace, ou null s'il n'y a rien à relier (l'attribut est alors retiré).
 */
export function descriptionChamp({ idAide = null, idErreur = null, enErreur = false } = {}) {
  const ids = [idAide, enErreur ? idErreur : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : null;
}

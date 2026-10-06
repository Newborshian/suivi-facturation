// Possibilité d'écrire selon l'état de l'application (logique pure, sans DOM : testée sous node).
// Fichier créé par une version plus récente (lecture seule), conflit de synchronisation non résolu ou mode dégradé : le serveur refuse
// toute écriture. L'interface désactive donc les boutons et champs d'écriture et dit pourquoi, au lieu de laisser un clic échouer.

/** Vrai si l'application accepte des modifications (même règle que l'écran Facturation du mois). */
export const ecritureAutorisee = (etat) => !(etat?.lectureSeule || etat?.conflit || etat?.modeDegrade);

/** Explication courte (infobulle et texte lié aux contrôles désactivés) ; chaîne vide quand l'écriture est possible. */
export function explicationEcritureImpossible(etat) {
  if (ecritureAutorisee(etat)) return '';
  if (etat.modeDegrade) return "Modification impossible : le fichier de données n'est pas utilisable pour l'instant (voir le message en haut de page).";
  if (etat.lectureSeule) return "Modification impossible : ce fichier a été créé par une version plus récente de l'application, il reste consultable en lecture seule.";
  return "Modification impossible tant que vous n'avez pas choisi la version des données à garder (voir le bandeau en haut de page).";
}

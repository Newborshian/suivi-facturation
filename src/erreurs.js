// Erreur applicative : porte le statut HTTP, un code stable et un message français
// destiné à l'utilisatrice. Jamais de donnée de patient dans le message.
// Levée par le domaine, le store et les routes ; convertie en réponse JSON par http/reponses.js (enErreurHttp). Le front lit `code`,
// `message`, `champs` (erreurs par champ de formulaire) et `details` (choix à proposer). Ne jamais changer un `code` existant : le front s'en sert.
export class ErreurApp extends Error {
  constructor(status, code, message, champs, details) {
    super(message);
    this.name = 'ErreurApp';
    this.status = status;
    this.code = code;
    this.champs = champs;
    this.details = details; // données utiles au front pour un choix (ex. identifiants et dates des homonymes), sans nom ni motif
  }
}

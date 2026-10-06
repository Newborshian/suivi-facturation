// Erreur applicative : porte le statut HTTP, un code stable et un message français
// destiné à l'utilisatrice. Jamais de donnée de patient dans le message.
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

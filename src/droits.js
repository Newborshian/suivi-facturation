// Droits des fichiers et dossiers créés par l'application (données de santé en clair) : lecture et écriture réservées au propriétaire.
// Sans effet sous Windows, où les droits viennent du profil de l'utilisateur ; effectif sous Linux et macOS (sous réserve du masque umask).
export const MODE_FICHIER = 0o600;
export const MODE_DOSSIER = 0o700;

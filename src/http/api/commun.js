// Petites aides partagées par les routes qui écrivent (prestations, patients).
// Entrée : l'horloge du serveur et le résultat de store.muter. Sortie : le contexte passé au domaine, la réponse JSON de la route.
// À ne pas casser : la forme { donnees, avertissements, annulation } est lue par toutes les pages du front (architecture §9.1).
import { randomUUID } from 'node:crypto';

/**
 * Contexte d'une écriture, donné aux fonctions du domaine (qui n'ont ni horloge ni générateur d'identifiants à elles) :
 * `aujourdHui` (AAAA-MM-JJ, date locale du PC), `maintenant` (instant ISO, posé dans creeLe / modifieLe), `nouvelId` (UUID).
 * Appelé à CHAQUE requête : la date du jour change à minuit.
 */
export const contexteEcriture = (horloge) => ({ aujourdHui: horloge.aujourdHui(), maintenant: horloge.maintenant().toISOString(), nouvelId: randomUUID });

/** Réponse d'une mutation : { donnees, avertissements (non bloquants), annulation (jeton pour le bouton « Annuler », ou null) }. */
export const reponseMutation = (r, donnees, status = 200) => ({ status, corps: { donnees, avertissements: r.avertissements, annulation: r.annulation } });

// GET /api/etat : date du jour (horloge du serveur), dossier actif, drapeaux de mode et de conflit, sauvegardes,
// tranches d'ancienneté des impayés (définies une seule fois, côté serveur).
// Vérifie l'empreinte du fichier à chaque appel pour afficher un bandeau de conflit même en simple consultation.
// Lu par TOUTES les pages au chargement (bandeaux, écriture possible ou non, date du jour, dernier mode de paiement).
// Ajouter un champ : seulement s'il est lu par le front ; un champ jamais lu est retiré (règle du projet : aucune donnée qui circule sans raison).
import { TRANCHES } from '../../domain/indicateurs.js';

export function routesEtat(routeur, { store, config, horloge, presence }) {
  routeur.ajouter('GET', '/api/etat', async () => {
    await store.verifierFichier();
    const s = store.etat();
    let dernierModePaiement = null; // mode proposé par défaut au prochain versement
    if (!s.modeDegrade && !s.structureInconnue) dernierModePaiement = store.lire().parametres?.dernierModePaiement ?? null;
    return {
      corps: {
        aujourdHui: horloge.aujourdHui(),
        dossier: config.dossier,
        tailleOctets: s.tailleOctets,
        nombrePrestations: s.nombrePrestations,
        sauvegardesConservees: s.sauvegardesConservees,
        modeDegrade: s.modeDegrade,
        erreur: s.erreur,
        lectureSeule: s.lectureSeule,
        structureInconnue: s.structureInconnue,
        conflit: s.conflit,
        conflitNonResolu: s.conflitNonResolu,
        avertissements: s.avertissements,
        dernierModePaiement,
        arretAuto: presence?.actif === true, // seul moyen d'observer que le lanceur ou la démonstration ont activé l'arrêt automatique (tests de processus réels, diagnostic)
        demonstration: config.demonstration === true,
        tranchesAnciennete: TRANCHES.map(({ id, libelle }) => ({ id, libelle })),
      },
    };
  });
}

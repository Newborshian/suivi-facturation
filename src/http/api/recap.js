// GET /api/recap?mois=AAAA-MM&vue=prestation|versement : Facturation du mois.
// Le serveur calcule tout (centimes entiers) ; le navigateur affiche. Le mois est un paramètre de requête : aucun nom de patient dans l'URL.
import { aFacturerGlobal, moisProposes, recapMensuel } from '../../domain/recap.js';
import { validerParametresRecap } from '../../domain/validation.js';

export function routesRecap(routeur, { store, horloge }) {
  routeur.ajouter('GET', '/api/recap', async (req, res, { requete }) => {
    const aujourdHui = horloge.aujourdHui();
    const { mois, vue } = validerParametresRecap(requete.query, aujourdHui);
    const { prestations } = store.lire(); // 503 DONNEES_ILLISIBLES en mode dégradé
    const recap = recapMensuel(prestations, { mois, vue, aujourdHui });
    return {
      corps: {
        ...recap,
        aujourdHui,
        moisDisponibles: moisProposes(prestations, aujourdHui, mois, vue),
        aFacturer: aFacturerGlobal(prestations, aujourdHui),
        fichierVide: prestations.length === 0, // le bandeau « Tout est facturé » n'a pas de sens sans aucune prestation
      },
    };
  });
}

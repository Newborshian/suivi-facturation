// POST /api/arreter : arrêt propre de l'application (bouton « Quitter l'application », script de secours).
// Les contrôles Host / Origin / Sec-Fetch-Site sont faits en amont par controlerRequete (comme pour toute route d'écriture).
// La réponse 202 est envoyée AVANT l'arrêt : `demanderArret` n'est appelée qu'une fois la réponse écrite.
import { ignorerCorps } from '../reponses.js';

export function routesArret(routeur, { demanderArret }) {
  routeur.ajouter('POST', '/api/arreter', async (req, res) => {
    ignorerCorps(req); // aucun corps requis : on ignore (borné) celui qui serait envoyé
    if (demanderArret) res.once('finish', () => demanderArret());
    return { status: 202, corps: { arret: true } };
  });
}

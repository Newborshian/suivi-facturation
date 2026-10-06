// POST /api/presence : battement ou fermeture d'une page ouverte (arrêt automatique, voir src/presence.js).
// Corps minuscule : {"id": "<identifiant d'onglet>", "etat": "ouverte" | "fermee"}, en JSON ou en texte (sendBeacon envoie du text/plain).
// Réponse 204. Aucune donnée de patient. Contrôles Host / Origin / Sec-Fetch-Site faits en amont (controlerRequete). Sans arrêt automatique : acceptée et ignorée.
import { ErreurApp } from '../../erreurs.js';
import { creerPresence } from '../../presence.js';
import { lireCorpsJson } from '../reponses.js';

const LIMITE_CORPS_PRESENCE = 512;

export function routesPresence(routeur, { presence = creerPresence({ actif: false }) }) {
  routeur.ajouter('POST', '/api/presence', async (req, res) => {
    const corps = await lireCorpsJson(req, { limite: LIMITE_CORPS_PRESENCE, types: ['application/json', 'text/plain'] });
    if (!presence.signaler(corps.id, corps.etat)) {
      throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Identifiant ou état de présence invalide.');
    }
    res.statusCode = 204;
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  });
}

// Liste des ressources de l'API. Appelé une fois par http/serveur.js.
import { routesCatalogue } from './catalogue.js';
import { routesEtat } from './etat.js';
import { routesExport } from './export.js';
import { routesIndicateurs } from './indicateurs.js';
import { routesArret } from './arret.js';
import { routesPresence } from './presence.js';
import { routesParametres } from './parametres.js';
import { routesPatients } from './patients.js';
import { routesPrestations } from './prestations.js';
import { routesRecap } from './recap.js';
import { routesSante } from './sante.js';
import { routesSauvegardes } from './sauvegardes.js';

/**
 * Enregistre toutes les routes de l'API. `ctx` = { store, config, horloge, presence, demanderArret, evenements } (voir creerServeur).
 * Ajouter une ressource : créer `src/http/api/<ressource>.js` qui exporte `routes<Ressource>(routeur, ctx)`, puis l'appeler ici.
 */
export function enregistrerRoutesApi(routeur, ctx) {
  routesSante(routeur, ctx);
  routesEtat(routeur, ctx);
  routesCatalogue(routeur, ctx);
  routesPatients(routeur, ctx);
  routesPrestations(routeur, ctx);
  routesRecap(routeur, ctx);
  routesIndicateurs(routeur, ctx);
  routesSauvegardes(routeur, ctx);
  routesExport(routeur, ctx);
  routesParametres(routeur, ctx);
  routesArret(routeur, ctx);
  routesPresence(routeur, ctx);
}

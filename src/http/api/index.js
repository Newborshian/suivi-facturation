import { routesCatalogue } from './catalogue.js';
import { routesEtat } from './etat.js';
import { routesExport } from './export.js';
import { routesIndicateurs } from './indicateurs.js';
import { routesArret } from './arret.js';
import { routesPresence } from './presence.js';
import { routesParametres } from './parametres.js';
import { routesPrestations } from './prestations.js';
import { routesRecap } from './recap.js';
import { routesSante } from './sante.js';
import { routesSauvegardes } from './sauvegardes.js';

/** Enregistre toutes les routes de l'API. `ctx` = { store, config, horloge, version, presence }. */
export function enregistrerRoutesApi(routeur, ctx) {
  routesSante(routeur, ctx);
  routesEtat(routeur, ctx);
  routesCatalogue(routeur, ctx);
  routesPrestations(routeur, ctx);
  routesRecap(routeur, ctx);
  routesIndicateurs(routeur, ctx);
  routesSauvegardes(routeur, ctx);
  routesExport(routeur, ctx);
  routesParametres(routeur, ctx);
  routesArret(routeur, ctx);
  routesPresence(routeur, ctx);
}

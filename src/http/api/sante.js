// GET /api/sante : sert aux lanceurs (scripts/lib-lanceur.mjs) et au verrou d'instance (src/verrou.js) à reconnaître l'application.
// Réponse : { ok, application: 'suivi-facturation', pid }. À ne pas casser : `application` (reconnaissance) et `pid` (le lanceur vérifie
// que c'est bien le processus qu'il vient de démarrer). Aucune donnée de patient, aucun chemin.
export function routesSante(routeur) {
  routeur.ajouter('GET', '/api/sante', async () => ({
    corps: { ok: true, application: 'suivi-facturation', pid: process.pid },
  }));
}

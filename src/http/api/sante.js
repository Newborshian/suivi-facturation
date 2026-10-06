// GET /api/sante : sert au lanceur à reconnaître l'application.
export function routesSante(routeur, { version }) {
  routeur.ajouter('GET', '/api/sante', async () => ({
    corps: { ok: true, application: 'suivi-facturation', version, pid: process.pid },
  }));
}

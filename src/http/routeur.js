// Table de routes minimale : méthode + motif ("/api/prestations/{id}"). HEAD utilise la route GET.

export function creerRouteur() {
  const routes = [];

  function compiler(motif) {
    const noms = [];
    const source = motif
      .split('/')
      .map((segment) => {
        const m = /^\{(\w+)\}$/.exec(segment);
        if (m) {
          noms.push(m[1]);
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return { re: new RegExp(`^${source}$`), noms };
  }

  return {
    ajouter(methode, motif, gestionnaire) {
      routes.push({ methode, ...compiler(motif), gestionnaire });
    },
    /** -> { gestionnaire, params } | { methodesAutorisees } (chemin connu, autre méthode) | null */
    resoudre(methode, chemin) {
      const methodeCherchee = methode === 'HEAD' ? 'GET' : methode;
      const autorisees = [];
      for (const route of routes) {
        const m = route.re.exec(chemin);
        if (!m) continue;
        if (route.methode === methodeCherchee) {
          const params = {};
          for (let i = 0; i < route.noms.length; i++) {
            try {
              params[route.noms[i]] = decodeURIComponent(m[i + 1]);
            } catch {
              return null;
            }
          }
          return { gestionnaire: route.gestionnaire, params };
        }
        autorisees.push(route.methode);
      }
      return autorisees.length > 0 ? { methodesAutorisees: autorisees } : null;
    },
  };
}

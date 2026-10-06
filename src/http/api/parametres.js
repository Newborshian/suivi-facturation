// PATCH /api/parametres : nombre de sauvegardes conservées. La rotation s'applique à la prochaine sauvegarde.
import { validerParametres } from '../../domain/validation.js';
import { lireCorpsJson } from '../reponses.js';

export function routesParametres(routeur, { store }) {
  routeur.ajouter('PATCH', '/api/parametres', async (req) => {
    const corps = await lireCorpsJson(req);
    const modifs = validerParametres(corps);
    const r = await store.muter(
      'parametres',
      (copie) => {
        Object.assign(copie.parametres, modifs);
      },
      { suivreAnnulation: false },
    );
    return { corps: { donnees: { sauvegardesConservees: r.etat.parametres.sauvegardesConservees }, avertissements: r.avertissements } };
  });
}

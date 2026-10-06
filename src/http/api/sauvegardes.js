// Sauvegardes : liste, sauvegarde manuelle, restauration. Disponibles aussi en mode dégradé
// (fichier illisible, absent, en conflit) : c'est la sortie de ces situations.
import { ErreurApp } from '../../erreurs.js';
import { ignorerCorps, lireCorpsJson } from '../reponses.js';

/** Corps `{ confirmer: true, ...champsAutorises }` : champs inconnus refusés, confirmation obligatoire. */
async function lireConfirmation(req, message, autorises = []) {
  const corps = await lireCorpsJson(req);
  for (const cle of Object.keys(corps)) {
    if (cle !== 'confirmer' && !autorises.includes(cle)) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'La requête contient un champ inconnu.');
  }
  if (corps.confirmer !== true) throw new ErreurApp(422, 'VALIDATION', message, { confirmer: message });
  return corps;
}

export function routesSauvegardes(routeur, { store }) {
  routeur.ajouter('GET', '/api/sauvegardes', async () => ({ corps: { sauvegardes: await store.sauvegardes() } }));

  routeur.ajouter('POST', '/api/sauvegardes', async (req) => {
    ignorerCorps(req);
    const r = await store.sauvegarderMaintenant();
    return { status: 201, corps: { donnees: r } };
  });

  // `nom` est contrôlé par le motif strict des sauvegardes (jamais un chemin) dans le store.
  // `depuisModeDegrade` : la décision a été prise sur l'écran « fichier absent / illisible » ; si le fichier est revenu lisible
  // entre-temps, la restauration est refusée (409 FICHIER_REVENU) au lieu de l'écraser.
  routeur.ajouter('POST', '/api/sauvegardes/{nom}/restaurer', async (req, res, { params }) => {
    const corps = await lireConfirmation(req, 'La restauration doit être confirmée.', ['depuisModeDegrade']);
    if (corps.depuisModeDegrade !== undefined && typeof corps.depuisModeDegrade !== 'boolean') {
      throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Le champ « depuisModeDegrade » doit être vrai ou faux.');
    }
    const r = await store.restaurer(params.nom, { depuisModeDegrade: corps.depuisModeDegrade === true });
    return { corps: { donnees: r } };
  });

  // Repartir d'un fichier vide : refusé par le store tant qu'une sauvegarde est restaurable ou que le fichier est lisible.
  routeur.ajouter('POST', '/api/fichier-vide', async (req) => {
    await lireConfirmation(req, "Repartir d'un fichier vide doit être confirmé.");
    const r = await store.repartirDeZero();
    return { status: 201, corps: { donnees: r } };
  });
}

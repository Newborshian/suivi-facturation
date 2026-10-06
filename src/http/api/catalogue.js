// Catalogue de tarifs. Une modification n'a aucun effet sur les prestations déjà saisies (libellé, catégorie et
// montant figés dans la ligne). Un type de prestation utilisé n'est jamais supprimé : il se désactive.
import { randomUUID } from 'node:crypto';
import { ajouterAuCatalogue, modifierDansCatalogue, supprimerDuCatalogue } from '../../domain/catalogue.js';
import { ErreurApp } from '../../erreurs.js';
import { lireArchives } from '../../store/archives-lecture.js';
import { ignorerCorps, lireCorpsJson } from '../reponses.js';

export function routesCatalogue(routeur, { store, config, evenements }) {
  routeur.ajouter('GET', '/api/catalogue', async () => {
    const etat = store.lire(); // 503 DONNEES_ILLISIBLES en mode dégradé
    // `utilisations` : nombre de prestations (fichier actif et archives lisibles) par type, pour avertir avant un renommage.
    const { archives } = await lireArchives(config.dossier, { journal: evenements });
    const utilisations = {};
    for (const l of [...etat.prestations, ...Object.values(archives).flatMap((x) => x.prestations)]) utilisations[l.prestationId] = (utilisations[l.prestationId] ?? 0) + 1;
    return { corps: { catalogue: Array.isArray(etat.catalogue) ? etat.catalogue : [], utilisations } };
  });

  routeur.ajouter('POST', '/api/catalogue', async (req) => {
    const corps = await lireCorpsJson(req);
    const r = await store.muter('catalogue-ajouter', (copie) => ajouterAuCatalogue(copie, corps, { nouvelId: randomUUID }), { suivreAnnulation: false });
    return { status: 201, corps: { donnees: r.resultat, avertissements: r.avertissements } };
  });

  routeur.ajouter('PATCH', '/api/catalogue/{id}', async (req, res, { params }) => {
    const corps = await lireCorpsJson(req);
    const r = await store.muter('catalogue-modifier', (copie) => modifierDansCatalogue(copie, params.id, corps), { suivreAnnulation: false });
    return { corps: { donnees: r.resultat, avertissements: r.avertissements } };
  });

  routeur.ajouter('DELETE', '/api/catalogue/{id}', async (req, res, { params }) => {
    ignorerCorps(req);
    // On ne peut garantir qu'un type n'est pas référencé que si toutes les archives sont lisibles.
    const { archives, illisibles } = await lireArchives(config.dossier, { journal: evenements });
    if (illisibles.length > 0) {
      throw new ErreurApp(409, 'CATALOGUE_UTILISE', "Impossible de vérifier que cette prestation n'a jamais été utilisée (une archive est illisible). Désactivez-la plutôt que de la supprimer.");
    }
    const utilises = new Set(Object.values(archives).flatMap((a) => a.prestations.map((l) => l.prestationId)));
    const r = await store.muter('catalogue-supprimer', (copie) => supprimerDuCatalogue(copie, params.id, utilises), { sauvegardeAvant: 'avant-suppression', suivreAnnulation: false });
    return { corps: { donnees: r.resultat, avertissements: r.avertissements } };
  });
}

// Export : GET /api/export?format=json|csv&contenu=prestations|versements. Téléchargement daté, jamais mis en cache.
// Les fichiers contiennent des données de santé en clair : l'interface le rappelle avant le téléchargement.
import { ErreurApp } from '../../erreurs.js';
import { csvPrestations, csvVersements } from '../../domain/csv.js';
import { lireArchives, prestationsCombinees } from '../../store/archives-lecture.js';

export const FORMAT_EXPORT = 'suivi-facturation-export';

function lireParametres(query) {
  for (const nom of query.keys()) {
    if (nom !== 'format' && nom !== 'contenu') throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre de requête inconnu.');
  }
  const format = query.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre « format » invalide (json ou csv).');
  const contenu = query.get('contenu') ?? 'prestations';
  if (contenu !== 'prestations' && contenu !== 'versements') throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre « contenu » invalide (prestations ou versements).');
  if (format === 'json' && query.has('contenu')) throw new ErreurApp(400, 'REQUETE_INVALIDE', "Le paramètre « contenu » ne s'applique qu'à l'export CSV.");
  return { format, contenu };
}

function envoyerFichier(res, { nom, type, texte, sansCorps }) {
  const octets = Buffer.from(texte, 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', octets.length);
  res.end(sansCorps ? undefined : octets);
}

export function routesExport(routeur, { store, config, horloge, evenements }) {
  routeur.ajouter('GET', '/api/export', async (req, res, { requete }) => {
    const { format, contenu } = lireParametres(requete.query);
    const etat = store.lire({ brut: true }); // 503 en mode dégradé : il n'y a rien de lisible à exporter
    const jour = horloge.aujourdHui();
    const { archives, illisibles } = await lireArchives(config.dossier, { journal: evenements });
    const sansCorps = req.method === 'HEAD';

    if (format === 'json') {
      const corps = { format: FORMAT_EXPORT, exporteLe: horloge.maintenant().toISOString(), actif: etat, archives, ...(illisibles.length > 0 ? { archivesIllisibles: illisibles } : {}) };
      return envoyerFichier(res, { nom: `suivi-facturation-export-${jour}.json`, type: 'application/json; charset=utf-8', texte: `${JSON.stringify(corps, null, 2)}\n`, sansCorps });
    }
    if (store.etat().lectureSeule) {
      throw new ErreurApp(503, 'SCHEMA_PLUS_RECENT', "Ce fichier vient d'une version plus récente de l'application : l'export CSV n'est pas possible. Utilisez l'export complet.");
    }
    const lignes = prestationsCombinees(etat.prestations, archives);
    const texte = contenu === 'versements' ? csvVersements(lignes) : csvPrestations(lignes);
    return envoyerFichier(res, { nom: `suivi-facturation-${contenu}-${jour}.csv`, type: 'text/csv; charset=utf-8', texte, sansCorps });
  });
}

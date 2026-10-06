// Indicateurs du tableau de bord : GET /api/indicateurs/{synthese|ca-mensuel|seances|repartition|impayes|prevision}.
// Endpoints séparés (architecture §9.2) pour qu'une section en erreur n'empêche pas l'affichage des autres. Le serveur calcule
// (centimes entiers) ; le navigateur dessine. Paramètres : mois AAAA-MM (de, a), vue, granularite : aucun nom de patient dans l'URL.
import { aFacturerGlobal } from '../../domain/recap.js';
import { caMensuel, impayes, repartition, seances } from '../../domain/indicateurs.js';
import { previsions } from '../../domain/previsions.js';
import { validerParametresIndicateurs } from '../../domain/validation.js';
import { ErreurApp } from '../../erreurs.js';

export function routesIndicateurs(routeur, { store, horloge }) {
  const route = (chemin, extras, calculer) =>
    routeur.ajouter('GET', `/api/indicateurs/${chemin}`, async (req, res, { requete }) => {
      const aujourdHui = horloge.aujourdHui();
      const parametres = validerParametresIndicateurs(requete.query, aujourdHui, extras);
      const etat = store.lire(); // 503 DONNEES_ILLISIBLES en mode dégradé
      return { corps: { aujourdHui, ...calculer(etat, parametres, aujourdHui) } };
    });

  route('ca-mensuel', ['vue'], ({ prestations }, { de, a, vue }, aujourdHui) => caMensuel(prestations, { de, a, vue, aujourdHui }));
  route('seances', ['granularite'], ({ prestations }, { de, a, granularite }, aujourdHui) => seances(prestations, { de, a, granularite, aujourdHui }));
  route('repartition', [], ({ prestations, catalogue }, { de, a }) => repartition(prestations, { de, a, catalogue }));
  route('impayes', [], ({ prestations }, _parametres, aujourdHui) => impayes(prestations, aujourdHui));

  // Prévision (architecture §6.7) : aucun paramètre (mois en cours = jour du serveur), aucun nom de patient. Historique insuffisant :
  // 200 avec `suffisant: false` et `moisManquants` (ce n'est pas une erreur : l'écran l'explique).
  routeur.ajouter('GET', '/api/indicateurs/prevision', async (req, res, { requete }) => {
    for (const _ of requete.query.keys()) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre de requête inconnu.');
    const aujourdHui = horloge.aujourdHui();
    const { prestations } = store.lire();
    return { corps: previsions(prestations, { aujourdHui }) };
  });

  // Les quatre indicateurs de tête : tous sur le MOIS EN COURS (de et a ignorés), pour ne pas dépendre de la période choisie.
  routeur.ajouter('GET', '/api/indicateurs/synthese', async (req, res, { requete }) => {
    const aujourdHui = horloge.aujourdHui();
    validerParametresIndicateurs(requete.query, aujourdHui, []);
    const { prestations } = store.lire();
    const mois = aujourdHui.slice(0, 7);
    const [ca] = caMensuel(prestations, { de: mois, a: mois, vue: 'prestation', aujourdHui }).mois;
    const impayesTotal = impayes(prestations, aujourdHui);
    return {
      corps: {
        aujourdHui,
        mois,
        resteAEncaisser: { montantCentimes: impayesTotal.totalResteCentimes, nombre: impayesTotal.nombre, resteNonFactureCentimes: impayesTotal.resteNonFactureCentimes },
        aFacturer: aFacturerGlobal(prestations, aujourdHui),
        caMois: ca,
        seancesMois: seances(prestations, { de: mois, a: mois, granularite: 'mois', aujourdHui }).total,
      },
    };
  });
}

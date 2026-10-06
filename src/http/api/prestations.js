// Prestations et versements. Le serveur calcule (état de paiement, totaux) ;
// le navigateur affiche. Aucune donnée nominative dans les URL : le filtre sur le patient se fait dans le navigateur.
import { randomUUID } from 'node:crypto';
import { ErreurApp } from '../../erreurs.js';
import { enrichir, etatPaiement } from '../../domain/paiement.js';
import { listerPatients } from '../../domain/patients.js';
import {
  ajouterVersement,
  creerPrestation,
  definirStatut,
  filtrerPrestations,
  modifierPrestation,
  modifierVersement,
  payerEnTotalite,
  supprimerPrestation,
  supprimerVersement,
  totaliser,
} from '../../domain/prestations.js';
import { validerFiltres } from '../../domain/validation.js';
import { ignorerCorps, lireCorpsJson, lireCorpsOptionnel } from '../reponses.js';

export function routesPrestations(routeur, { store, horloge }) {
  const contexte = () => ({ aujourdHui: horloge.aujourdHui(), maintenant: horloge.maintenant().toISOString(), nouvelId: randomUUID });

  /** Réponse d'une mutation : { donnees, avertissements, annulation }. `versLigne` met en forme la ligne renvoyée. */
  const reponseMutation = (r, donnees, status = 200) => ({ status, corps: { donnees, avertissements: r.avertissements, annulation: r.annulation } });
  const ligneEnrichie = (r) => enrichir(r.resultat, horloge.aujourdHui());

  routeur.ajouter('GET', '/api/patients', async () => ({ corps: { patients: listerPatients(store.lire().prestations) } }));

  routeur.ajouter('GET', '/api/prestations', async (req, res, { requete }) => {
    const filtres = validerFiltres(requete.query);
    const { prestations } = store.lire();
    const aujourdHui = horloge.aujourdHui();
    const lignes = filtrerPrestations(prestations, filtres, aujourdHui, etatPaiement).map((l) => enrichir(l, aujourdHui));
    const moisDisponibles = [...new Set(prestations.map((l) => l.date.slice(0, 7)))].sort();
    return { corps: { lignes, total: totaliser(lignes), moisDisponibles } };
  });

  routeur.ajouter('GET', '/api/prestations/{id}', async (req, res, { params }) => {
    const ligne = store.lire().prestations.find((l) => l.id === params.id);
    if (!ligne) throw new ErreurApp(404, 'INTROUVABLE', 'Cette prestation est introuvable (elle a peut-être été supprimée).');
    return { corps: { donnees: enrichir(ligne, horloge.aujourdHui()) } };
  });

  routeur.ajouter('POST', '/api/prestations', async (req) => {
    const corps = await lireCorpsJson(req);
    const r = await store.muter('creer-prestation', (copie) => creerPrestation(copie, corps, contexte()));
    return reponseMutation(r, ligneEnrichie(r), 201);
  });

  // Chemin fixe déclaré avant les routes à identifiant : « statut » n'est jamais pris pour un id.
  routeur.ajouter('POST', '/api/prestations/statut', async (req) => {
    const corps = await lireCorpsJson(req);
    const r = await store.muter('statut-prestations', (copie) => definirStatut(copie, corps, contexte()));
    return reponseMutation(r, r.resultat);
  });

  routeur.ajouter('PATCH', '/api/prestations/{id}', async (req, res, { params }) => {
    const corps = await lireCorpsJson(req);
    const r = await store.muter('modifier-prestation', (copie) => modifierPrestation(copie, params.id, corps, contexte()));
    return reponseMutation(r, ligneEnrichie(r));
  });

  routeur.ajouter('DELETE', '/api/prestations/{id}', async (req, res, { params }) => {
    ignorerCorps(req);
    const r = await store.muter('supprimer-prestation', (copie) => supprimerPrestation(copie, params.id), { sauvegardeAvant: 'avant-suppression' });
    return reponseMutation(r, r.resultat);
  });

  routeur.ajouter('POST', '/api/prestations/{id}/versements', async (req, res, { params }) => {
    const corps = await lireCorpsJson(req);
    const r = await store.muter('ajouter-versement', (copie) => ajouterVersement(copie, params.id, corps, contexte()));
    return reponseMutation(r, ligneEnrichie(r), 201);
  });

  routeur.ajouter('PATCH', '/api/prestations/{id}/versements/{vid}', async (req, res, { params }) => {
    const corps = await lireCorpsJson(req);
    const r = await store.muter('modifier-versement', (copie) => modifierVersement(copie, params.id, params.vid, corps, contexte()));
    return reponseMutation(r, ligneEnrichie(r));
  });

  routeur.ajouter('DELETE', '/api/prestations/{id}/versements/{vid}', async (req, res, { params }) => {
    ignorerCorps(req);
    const r = await store.muter('supprimer-versement', (copie) => supprimerVersement(copie, params.id, params.vid, contexte()), { sauvegardeAvant: 'avant-suppression' });
    return reponseMutation(r, ligneEnrichie(r));
  });

  routeur.ajouter('POST', '/api/prestations/{id}/payer-totalite', async (req, res, { params }) => {
    const corps = await lireCorpsOptionnel(req);
    const r = await store.muter('payer-totalite', (copie) => payerEnTotalite(copie, params.id, corps, contexte()));
    return reponseMutation(r, ligneEnrichie(r), 201);
  });

  routeur.ajouter('POST', '/api/annulations/{jeton}', async (req, res, { params }) => {
    ignorerCorps(req);
    const r = await store.annuler(params.jeton);
    return { corps: { donnees: { annulee: true }, avertissements: r.avertissements } };
  });
}

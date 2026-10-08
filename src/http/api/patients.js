// Registre des patients : liste, création, modification (renommage, archivage / réactivation) et suppression d'un patient sans prestation.
// Aucun nom dans les URL (identifiant opaque) ni dans le journal. Toutes les écritures passent par store.muter (conflit, mode dégradé,
// lecture seule : mêmes refus que les prestations). La réparation des incohérences (lot P8) n'est pas encore exposée.
import { randomUUID } from 'node:crypto';
import { ErreurApp } from '../../erreurs.js';
import { creerPatient, listerPatients, modifierPatient, supprimerPatient } from '../../domain/patients.js';
import { lireArchives } from '../../store/archives-lecture.js';
import { ignorerCorps, lireCorpsJson } from '../reponses.js';

export function routesPatients(routeur, { store, config, horloge, evenements }) {
  const contexte = () => ({ aujourdHui: horloge.aujourdHui(), maintenant: horloge.maintenant().toISOString(), nouvelId: randomUUID });
  const reponse = (r, donnees, status = 200) => ({ status, corps: { donnees, avertissements: r.avertissements, annulation: r.annulation } });

  /** Identifiants de patients présents dans les archives lisibles + indicateur « une archive est illisible » (suppression impossible à garantir). */
  async function utilisesArchives() {
    const { archives, illisibles } = await lireArchives(config.dossier, { journal: evenements });
    const ids = new Set();
    for (const a of Object.values(archives)) for (const l of a.prestations) if (typeof l?.patient?.id === 'string') ids.add(l.patient.id);
    return { ids, illisibles: illisibles.length > 0 };
  }

  routeur.ajouter('GET', '/api/patients', async (req, res, { requete }) => {
    for (const _ of requete.query.keys()) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre de requête inconnu.');
    const etat = store.lire(); // 503 DONNEES_ILLISIBLES en mode dégradé
    return { corps: { patients: listerPatients(etat, { utilisesArchives: await utilisesArchives() }) } };
  });

  routeur.ajouter('POST', '/api/patients', async (req) => {
    const corps = await lireCorpsJson(req);
    const r = await store.muter('creer-patient', (copie) => creerPatient(copie, corps, contexte()));
    return reponse(r, r.resultat, 201);
  });

  routeur.ajouter('PATCH', '/api/patients/{id}', async (req, res, { params }) => {
    const corps = await lireCorpsJson(req);
    const r = await store.muter('modifier-patient', (copie) => modifierPatient(copie, params.id, corps, contexte()));
    return reponse(r, r.resultat);
  });

  routeur.ajouter('DELETE', '/api/patients/{id}', async (req, res, { params }) => {
    ignorerCorps(req);
    const utilises = await utilisesArchives();
    const r = await store.muter('supprimer-patient', (copie) => supprimerPatient(copie, params.id, utilises), { sauvegardeAvant: 'avant-suppression' });
    return reponse(r, r.resultat);
  });
}


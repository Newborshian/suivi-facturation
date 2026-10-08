import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { fsSauvegardesBloquees } from '../aides/fs-defaillant.js';
import { horlogeReglable } from '../aides/horloge.js';
import { ecrireFichierTest } from '../aides/temp.js';

const NOM_FICHIER = 'suivi-facturation.json';

/** Appel JSON de l'API avec l'Origin attendue sur les méthodes d'écriture. */
function api(s) {
  const appeler = (methode, chemin, corps) =>
    s.requete({
      methode,
      chemin,
      headers: { Origin: `http://127.0.0.1:${s.port}`, ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      corps: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
  return {
    get: (chemin) => s.requete({ chemin }),
    post: (chemin, corps) => appeler('POST', chemin, corps),
    patch: (chemin, corps) => appeler('PATCH', chemin, corps),
    del: (chemin) => appeler('DELETE', chemin),
    /** POST sans corps ni Content-Type (« Payé en totalité » d'un clic). */
    postVide: (chemin) => appeler('POST', chemin),
  };
}
const saisie = (extra = {}) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500, motif: 'Graphisme', ...extra });
const disque = async (s) => JSON.parse(await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8'));

async function avecServeur(fn, options) {
  const s = await demarrerServeurTest(options);
  try {
    await fn(s, api(s));
  } finally {
    await s.arreter();
  }
}

test('POST /api/prestations : 201, ligne enrichie, statut à facturer, état non payé, jeton d\'annulation', () =>
  avecServeur(async (s, a) => {
    const r = await a.post('/api/prestations', saisie());
    assert.equal(r.status, 201);
    const l = r.json.donnees;
    assert.equal(l.statut, 'a_facturer');
    assert.equal(l.etat, 'non_paye');
    assert.equal(l.resteCentimes, 4500);
    assert.equal(l.aVenir, false);
    assert.equal(l.libelle, 'Séance individuelle 45 min');
    assert.deepEqual(l.versements, []);
    assert.deepEqual(r.json.avertissements, []);
    assert.ok(r.json.annulation);
    assert.equal(r.headers['cache-control'], 'no-store');
    const sur_disque = await disque(s);
    assert.equal(sur_disque.prestations.length, 1);
    assert.equal('etat' in sur_disque.prestations[0], false, "l'état de paiement n'est pas stocké");
    assert.equal('resteCentimes' in sur_disque.prestations[0], false);
    assert.equal('aVenir' in sur_disque.prestations[0], false);
  }));

test('POST /api/prestations : 422 avec un message par champ, rien n\'est enregistré', () =>
  avecServeur(async (s, a) => {
    const r = await a.post('/api/prestations', { motif: 'x' });
    assert.equal(r.status, 422);
    assert.equal(r.json.erreur.code, 'VALIDATION');
    assert.deepEqual(Object.keys(r.json.erreur.champs).sort(), ['date', 'montantCentimes', 'nom', 'prenom', 'prestationId']);
    assert.equal((await disque(s)).prestations.length, 0);
    for (const m of [-100, 45.5, '45', null]) {
      const e = await a.post('/api/prestations', saisie({ montantCentimes: m }));
      assert.equal(e.status, 422, String(m));
    }
    assert.equal((await a.post('/api/prestations', saisie({ montantCentimes: 0 }))).status, 201, 'montant de 0 € autorisé');
  }));

test('POST /api/prestations : champ inconnu 400, pas de Content-Type 415, JSON invalide 400', () =>
  avecServeur(async (s, a) => {
    assert.equal((await a.post('/api/prestations', saisie({ role: 'admin' }))).status, 400);
    const sansType = await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: { Origin: `http://127.0.0.1:${s.port}` }, corps: JSON.stringify(saisie()) });
    assert.equal(sansType.status, 415);
    const casse = await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json' }, corps: '{' });
    assert.equal(casse.status, 400);
    assert.equal((await disque(s)).prestations.length, 0);
  }));

test('sécurité : les routes d\'écriture refusent une Origin étrangère ou absente, tout refuse un Host étranger', () =>
  avecServeur(async (s, a) => {
    const entetes = { 'Content-Type': 'application/json' };
    const corps = JSON.stringify(saisie());
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: entetes, corps })).status, 403);
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: { ...entetes, Origin: 'http://evil.example' }, corps })).status, 403);
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: { ...entetes, Origin: `http://127.0.0.1:${s.port}`, 'Sec-Fetch-Site': 'cross-site' }, corps })).status, 403);
    assert.equal((await s.requete({ methode: 'DELETE', chemin: '/api/prestations/x' })).status, 403);
    assert.equal((await s.requete({ methode: 'PATCH', chemin: '/api/prestations/x', headers: entetes, corps: '{}' })).status, 403);
    assert.equal((await s.requete({ chemin: '/api/prestations', hote: 'evil.example' })).json.erreur.code, 'HOTE_REFUSE');
    assert.equal((await s.requete({ methode: 'PUT', chemin: '/api/prestations', headers: { Origin: `http://127.0.0.1:${s.port}` } })).status, 405);
    assert.equal((await disque(s)).prestations.length, 0);
    assert.equal((await a.get('/api/prestations')).status, 200);
  }));

test('GET /api/prestations : filtres mois, statut, état ; total exact en centimes ; mois disponibles', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie({ date: '2026-09-14' }))).json.donnees;
    const l2 = (await a.post('/api/prestations', saisie({ date: '2026-10-05', patient: { nom: 'Ours', prenom: 'Baloo' }, prestationId: 'seance-30', montantCentimes: 3500 }))).json.donnees;
    await a.post('/api/prestations', saisie({ date: '2026-10-20', patient: { nom: 'Renard', prenom: 'Goupil' } }));
    await a.post(`/api/prestations/${l2.id}/versements`, { montantCentimes: 1000, date: '2026-10-05', mode: 'cheque' });
    await a.post('/api/prestations/statut', { ids: [l1.id], statut: 'facture' });

    const tout = (await a.get('/api/prestations')).json;
    assert.deepEqual(tout.lignes.map((l) => l.date), ['2026-09-14', '2026-10-05', '2026-10-20'], 'tri par date');
    assert.deepEqual(tout.moisDisponibles, ['2026-09', '2026-10']);
    assert.deepEqual(tout.total, { nombre: 3, montantCentimes: 12500, payeCentimes: 1000, resteCentimes: 11500, tropPercuCentimes: 0 });

    const octobre = (await a.get('/api/prestations?mois=2026-10')).json;
    assert.equal(octobre.lignes.length, 2);
    assert.equal(octobre.total.montantCentimes, 8000);
    assert.equal(octobre.lignes[1].aVenir, true);
    assert.equal((await a.get('/api/prestations?statut=facture')).json.lignes[0].id, l1.id);
    assert.deepEqual((await a.get('/api/prestations?etat=partiel')).json.lignes.map((l) => l.id), [l2.id]);
    assert.equal((await a.get('/api/prestations?mois=2026-10&statut=a_facturer&etat=non_paye')).json.lignes.length, 1);
    assert.equal((await a.get('/api/prestations?mois=2026-12')).json.lignes.length, 0);
    assert.equal((await a.get(`/api/prestations?patientId=${l2.patient.id}`)).json.lignes.length, 1);
  }));

test('GET /api/prestations : aucune donnée nominative dans l\'URL (paramètre nom refusé) ni dans le journal', () =>
  avecServeur(async (s, a) => {
    await a.post('/api/prestations', saisie({ patient: { nom: 'Secretnom', prenom: 'Secretprenom' }, motif: 'Secretmotif' }));
    const r = await a.get('/api/prestations?patient=Secretnom');
    assert.equal(r.status, 400);
    assert.ok(!r.texte.includes('Secretnom'));
    await a.patch('/api/prestations/inconnue', { modifieLe: 'x' });
    await a.get('/api/prestations');
    await a.get('/api/patients');
    assert.ok(!s.journal.join('\n').match(/Secret/), 'ni nom, ni prénom, ni motif dans le journal');
  }));

test('GET /api/prestations/{id} : une ligne enrichie ; inconnue 404 ; « statut » n\'est pas un identifiant', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    assert.equal((await a.get(`/api/prestations/${l.id}`)).json.donnees.etat, 'non_paye');
    assert.equal((await a.get('/api/prestations/inconnue')).status, 404);
    assert.equal((await a.get('/api/prestations/statut')).status, 404);
  }));

test('PATCH : modification avec modifieLe ; version périmée -> 409 MODIFIEE_AILLEURS ; sans modifieLe 422', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    const ok = await a.patch(`/api/prestations/${l.id}`, { modifieLe: l.modifieLe, montantCentimes: 4000, motif: 'Tarif réduit' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.donnees.montantCentimes, 4000);
    assert.equal(ok.json.donnees.resteCentimes, 4000);
    const retard = await a.patch(`/api/prestations/${l.id}`, { modifieLe: '2020-01-01T00:00:00.000Z', montantCentimes: 1 });
    assert.equal(retard.status, 409);
    assert.equal(retard.json.erreur.code, 'MODIFIEE_AILLEURS');
    assert.equal((await a.patch(`/api/prestations/${l.id}`, { montantCentimes: 1 })).status, 422);
    assert.equal((await a.patch('/api/prestations/inconnue', { modifieLe: 'x' })).status, 404);
    assert.equal((await disque(s)).prestations[0].montantCentimes, 4000);
  }));

test('DELETE : sauvegarde « avant-suppression » puis suppression ; 404 si absente ; annulation possible', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 1000, date: '2026-10-02', mode: 'cheque' });
    const r = await a.del(`/api/prestations/${l.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.donnees, { id: l.id, versementsSupprimes: 1 });
    assert.equal((await disque(s)).prestations.length, 0);
    const sauvegardes = (await a.get('/api/sauvegardes')).json.sauvegardes;
    const avant = sauvegardes.find((x) => x.raison === 'avant-suppression');
    assert.ok(avant);
    const contenu = JSON.parse(await fs.readFile(path.join(s.dossier, 'sauvegardes', avant.nom), 'utf8'));
    assert.equal(contenu.prestations.length, 1);
    assert.equal(contenu.prestations[0].versements.length, 1);
    assert.equal((await a.del(`/api/prestations/${l.id}`)).status, 404);

    const undo = await a.post(`/api/annulations/${r.json.annulation}`);
    assert.equal(undo.status, 200);
    assert.equal((await disque(s)).prestations[0].versements.length, 1, 'ligne et versement restaurés');
  }));

test('versements : ajout, état partiel puis payé, modification, suppression', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    const v1 = await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 2000, date: '2026-10-02', mode: 'virement' });
    assert.equal(v1.status, 201);
    assert.equal(v1.json.donnees.etat, 'partiel');
    assert.equal(v1.json.donnees.resteCentimes, 2500);
    const vid = v1.json.donnees.versements[0].id;

    const modif = await a.patch(`/api/prestations/${l.id}/versements/${vid}`, { montantCentimes: 4500 });
    assert.equal(modif.json.donnees.etat, 'paye');
    assert.equal(modif.json.donnees.resteCentimes, 0);

    const sup = await a.del(`/api/prestations/${l.id}/versements/${vid}`);
    assert.equal(sup.json.donnees.etat, 'non_paye');
    assert.equal((await a.del(`/api/prestations/${l.id}/versements/${vid}`)).status, 404);
    assert.equal((await a.post('/api/prestations/inconnue/versements', { montantCentimes: 1, date: '2026-10-02', mode: 'cheque' })).status, 404);
  }));

test('versement : refus de 0, négatif, flottant, date vide, mode inconnu ; trop-perçu et date antérieure acceptés avec avertissement', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie({ date: '2026-10-10' }))).json.donnees;
    for (const corps of [
      { montantCentimes: 0, date: '2026-10-02', mode: 'cheque' },
      { montantCentimes: -1, date: '2026-10-02', mode: 'cheque' },
      { montantCentimes: 1.5, date: '2026-10-02', mode: 'cheque' },
      { montantCentimes: 100, date: '', mode: 'cheque' },
      { montantCentimes: 100, date: '2026-10-02', mode: 'bitcoin' },
    ]) {
      const r = await a.post(`/api/prestations/${l.id}/versements`, corps);
      assert.equal(r.status, 422, JSON.stringify(corps));
    }
    const r = await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 5000, date: '2026-10-02', mode: 'especes' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.avertissements.map((x) => x.code).sort(), ['TROP_PERCU', 'VERSEMENT_AVANT_PRESTATION']);
    assert.equal(r.json.donnees.etat, 'paye');
    assert.equal(r.json.donnees.tropPercuCentimes, 500);
    assert.equal(r.json.donnees.resteCentimes, 0);
  }));

test('« Payé en totalité » : sans corps, dernier mode utilisé, annulable ; MODE_REQUIS la 1re fois ; DEJA_PAYEE ensuite', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie())).json.donnees;
    const l2 = (await a.post('/api/prestations', saisie({ patient: { nom: 'Ours', prenom: 'Baloo' } }))).json.donnees;

    const sansMode = await a.postVide(`/api/prestations/${l1.id}/payer-totalite`);
    assert.equal(sansMode.status, 422);
    assert.equal(sansMode.json.erreur.code, 'MODE_REQUIS');
    assert.equal((await disque(s)).prestations[0].versements.length, 0);

    const r1 = await a.post(`/api/prestations/${l1.id}/payer-totalite`, { mode: 'cheque' });
    assert.equal(r1.status, 201);
    assert.equal(r1.json.donnees.etat, 'paye');
    assert.deepEqual([r1.json.donnees.versements[0].montantCentimes, r1.json.donnees.versements[0].mode, r1.json.donnees.versements[0].date], [4500, 'cheque', '2026-10-02']);
    assert.equal((await a.get('/api/etat')).json.dernierModePaiement, 'cheque');

    const r2 = await a.postVide(`/api/prestations/${l2.id}/payer-totalite`);
    assert.equal(r2.status, 201);
    assert.equal(r2.json.donnees.versements[0].mode, 'cheque', 'dernier mode utilisé');

    const deja = await a.postVide(`/api/prestations/${l2.id}/payer-totalite`);
    assert.equal(deja.status, 409);
    assert.equal(deja.json.erreur.code, 'DEJA_PAYEE');

    const undo = await a.post(`/api/annulations/${r2.json.annulation}`);
    assert.equal(undo.status, 200);
    assert.equal((await a.get(`/api/prestations/${l2.id}`)).json.donnees.etat, 'non_paye');
    assert.equal((await a.post(`/api/annulations/${r2.json.annulation}`)).json.erreur.code, 'ANNULATION_IMPOSSIBLE');
  }));

test('statut groupé : facturé avec date, retour à facturer, lignes déjà dans l\'état ignorées ; annulation', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie())).json.donnees;
    const l2 = (await a.post('/api/prestations', saisie({ patient: { nom: 'Ours', prenom: 'Baloo' } }))).json.donnees;
    const r = await a.post('/api/prestations/statut', { ids: [l1.id, l2.id], statut: 'facture' });
    assert.equal(r.status, 200);
    assert.equal(r.json.donnees.modifiees, 2);
    assert.deepEqual((await disque(s)).prestations.map((l) => [l.statut, l.factureLe]), [['facture', '2026-10-02'], ['facture', '2026-10-02']]);
    assert.equal((await a.post('/api/prestations/statut', { ids: [l1.id], statut: 'facture' })).json.donnees.modifiees, 0);
    assert.equal((await a.post(`/api/annulations/${r.json.annulation}`)).status, 409, 'une autre action a eu lieu depuis');

    const retour = await a.post('/api/prestations/statut', { ids: [l1.id], statut: 'a_facturer' });
    assert.equal(retour.json.donnees.modifiees, 1);
    assert.equal((await a.get(`/api/prestations/${l1.id}`)).json.donnees.factureLe, null);
    assert.equal((await a.post(`/api/annulations/${retour.json.annulation}`)).status, 200);
    assert.equal((await a.get(`/api/prestations/${l1.id}`)).json.donnees.statut, 'facture');

    assert.equal((await a.post('/api/prestations/statut', { ids: [], statut: 'facture' })).status, 400);
    assert.equal((await a.post('/api/prestations/statut', { ids: [l1.id, 'inconnue'], statut: 'facture' })).status, 404);
    assert.equal((await a.post('/api/prestations/statut', { ids: [l1.id], statut: 'zzz' })).status, 422);
  }));

test('statut facturé sans versement : état de paiement indépendant (reste non payé)', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    await a.post('/api/prestations/statut', { ids: [l.id], statut: 'facture' });
    const relu = (await a.get(`/api/prestations/${l.id}`)).json.donnees;
    assert.equal(relu.statut, 'facture');
    assert.equal(relu.etat, 'non_paye');
  }));

test('patients et homonymes : rattachement automatique, 409 avec candidats sans nom, nouveauPatient, patientId', () =>
  avecServeur(async (s, a) => {
    const a1 = (await a.post('/api/prestations', saisie())).json.donnees;
    const a2 = await a.post('/api/prestations', saisie({ patient: { nom: ' lapin', prenom: 'PIERRE' } }));
    assert.equal(a2.json.donnees.patient.id, a1.patient.id);
    assert.deepEqual(a2.json.avertissements.map((x) => x.code), ['PATIENT_RATTACHE']);
    assert.equal(a2.json.donnees.patient.nom, 'Lapin', "la ligne porte l'écriture du registre, pas celle tapée");
    const exact = await a.post('/api/prestations', saisie({ patient: { nom: 'Lapin', prenom: 'Pierre' } }));
    assert.deepEqual(exact.json.avertissements, [], "même écriture que le registre : pas de bruit à chaque saisie");

    const homonyme = await a.post('/api/prestations', saisie({ nouveauPatient: true }));
    assert.equal(homonyme.status, 201);
    assert.notEqual(homonyme.json.donnees.patient.id, a1.patient.id);

    const ambigu = await a.post('/api/prestations', saisie());
    assert.equal(ambigu.status, 409);
    assert.equal(ambigu.json.erreur.code, 'PATIENTS_HOMONYMES');
    assert.equal(ambigu.json.erreur.details.candidats.length, 2);
    assert.ok(!JSON.stringify(ambigu.json.erreur.details).includes('Lapin'));

    const choisi = await a.post('/api/prestations', { patientId: a1.patient.id, date: '2026-10-02', prestationId: 'reunion-synthese', montantCentimes: 6000 });
    assert.equal(choisi.status, 201);
    assert.equal(choisi.json.donnees.patient.id, a1.patient.id);

    const patients = (await a.get('/api/patients')).json.patients;
    assert.equal(patients.length, 2);
    assert.deepEqual(Object.keys(patients[0]).sort(), ['actif', 'dernierePrestation', 'homonyme', 'id', 'nom', 'nombrePrestations', 'prenom', 'supprimable']);
  }));

test('libellé figé à la saisie : renommer le catalogue ne change pas la ligne existante, la suivante prend le nouveau libellé', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    assert.equal(l.libelle, 'Séance individuelle 45 min');
    assert.equal(l.categorie, 'seance');
    // Vrai renommage du catalogue, passé par le stockage (PATCH /api/catalogue n'était pas encore disponible quand ce test a été écrit), écrit sur disque.
    await s.store.muter('test-renommer-catalogue', (copie) => {
      copie.catalogue.find((c) => c.id === 'seance-45').libelle = 'Renommée plus tard';
    });
    assert.equal((await disque(s)).catalogue.find((c) => c.id === 'seance-45').libelle, 'Renommée plus tard', 'le renommage est bien sur disque');
    const relue = (await a.get(`/api/prestations/${l.id}`)).json.donnees;
    assert.equal(relue.libelle, 'Séance individuelle 45 min', 'la ligne existante garde son libellé');
    assert.equal(relue.categorie, 'seance');
    const neuve = (await a.post('/api/prestations', saisie({ date: '2026-10-03' }))).json.donnees;
    assert.equal(neuve.libelle, 'Renommée plus tard', 'une nouvelle ligne reprend le libellé en vigueur');
    assert.equal((await disque(s)).prestations[0].libelle, 'Séance individuelle 45 min');
  }));

test('PATCH : le contrôle « modifiée ailleurs » compare le vrai modifieLe (horloge réglable : une version périmée est refusée)', () => {
  const horloge = horlogeReglable();
  return avecServeur(
    async (s, a) => {
      const l = (await a.post('/api/prestations', saisie())).json.donnees;
      horloge.regler('2026-10-02', '09:15:00');
      const ok = await a.patch(`/api/prestations/${l.id}`, { modifieLe: l.modifieLe, motif: 'Première modification' });
      assert.equal(ok.status, 200);
      assert.notEqual(ok.json.donnees.modifieLe, l.modifieLe, 'modifieLe a changé');
      // On rejoue la requête avec l'ancien modifieLe réel (pas une date fictive de 2020) : refusée.
      const rejoue = await a.patch(`/api/prestations/${l.id}`, { modifieLe: l.modifieLe, motif: 'Écrasement' });
      assert.equal(rejoue.status, 409);
      assert.equal(rejoue.json.erreur.code, 'MODIFIEE_AILLEURS');
      assert.equal((await disque(s)).prestations[0].motif, 'Première modification');
    },
    { horloge },
  );
});

test('GET /api/etat : date du jour, dernière sauvegarde, dernier mode ; GET /api/sauvegardes : liste sans contenu', () =>
  avecServeur(async (s, a) => {
    await a.post('/api/prestations', saisie());
    const e = (await a.get('/api/etat')).json;
    assert.equal(e.aujourdHui, '2026-10-02');
    assert.match(e.derniereSauvegarde, /^sauvegarde-2026-10-02_09h14m03s_quotidienne\.json$/);
    assert.equal(e.dernierModePaiement, null);
    assert.deepEqual(e.avertissements, []);
    const l = (await a.get('/api/sauvegardes')).json.sauvegardes;
    assert.equal(l.length, 1);
    // Résumé de chaque sauvegarde (nombre de prestations, période…) mais jamais le contenu ni un nom de patient.
    assert.deepEqual(Object.keys(l[0]).sort(), ['derniereDate', 'heure', 'jour', 'lisible', 'majLe', 'nom', 'nombrePatients', 'nombrePrestations', 'premiereDate', 'raison', 'raisonRefus', 'reserve', 'restaurable', 'revision', 'schemaVersion', 'tailleOctets']);
    assert.ok(l[0].tailleOctets > 0);
    assert.equal(l[0].nombrePrestations, 0, 'la sauvegarde quotidienne est faite avant la 1re saisie');
    assert.ok(!JSON.stringify(l).includes('Lapin'));
  }));

test('mode dégradé : les routes de données répondent 503 sans toucher au fichier illisible', () =>
  avecServeur(
    async (s, a) => {
      const avant = await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8');
      for (const r of [await a.get('/api/prestations'), await a.get('/api/patients'), await a.post('/api/prestations', saisie()), await a.postVide('/api/prestations/x/payer-totalite')]) {
        assert.equal(r.status, 503);
        assert.equal(r.json.erreur.code, 'DONNEES_ILLISIBLES');
      }
      assert.equal(await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8'), avant);
      assert.equal((await a.get('/api/etat')).status, 200);
    },
    { preparer: (d) => ecrireFichierTest(path.join(d, NOM_FICHIER), '{ pas du json') },
  ));

test('mode lecture seule : modification refusée (schéma plus récent)', () =>
  avecServeur(
    async (s, a) => {
      const r = await a.post('/api/prestations', saisie());
      assert.equal(r.status, 503);
      assert.equal(r.json.erreur.code, 'SCHEMA_PLUS_RECENT');
    },
    { preparer: async (d) => {
      const { genererExemple } = await import('../../src/exemple.js');
      await ecrireFichierTest(path.join(d, NOM_FICHIER), JSON.stringify({ ...genererExemple(), schemaVersion: 42 }));
    } },
  ));

test('30 saisies concurrentes via HTTP : toutes enregistrées, une seule sauvegarde quotidienne', () =>
  avecServeur(async (s, a) => {
    const reponses = await Promise.all(Array.from({ length: 30 }, (_, i) => a.post('/api/prestations', saisie({ patient: { nom: `Nom${i}`, prenom: 'X' } }))));
    assert.ok(reponses.every((r) => r.status === 201));
    assert.equal((await disque(s)).prestations.length, 30);
    assert.equal((await fs.readdir(path.join(s.dossier, 'sauvegardes'))).length, 1);
  }));

// --- Sauvegardes préalables et renommage de patient ---

test('sauvegarde automatique du jour en échec : alerte renvoyée tout de suite dans la réponse et dans /api/etat, puis levée au succès', () => {
  const { fs: fsSimule, etat } = fsSauvegardesBloquees();
  return avecServeur(
    async (s, a) => {
      etat.bloque = true; // le dossier sauvegardes/ devient inaccessible après le démarrage
      const r = await a.post('/api/prestations', saisie());
      assert.equal(r.status, 201, 'la saisie réussit malgré tout');
      assert.deepEqual(r.json.avertissements.map((x) => x.code), ['SAUVEGARDE_ECHOUEE']);
      assert.match(r.json.avertissements[0].message, /sauvegarde automatique/);
      assert.equal((await disque(s)).prestations.length, 1);
      const e = (await a.get('/api/etat')).json;
      assert.deepEqual(e.avertissements.map((x) => x.code), ['SAUVEGARDE_ECHOUEE']);

      // L'alerte est renvoyée à chaque mutation tant que la sauvegarde du jour manque, y compris avec d'autres avertissements.
      const futur = await a.post('/api/prestations', saisie({ date: '2026-12-01' }));
      assert.deepEqual(futur.json.avertissements.map((x) => x.code).sort(), ['DATE_FUTURE', 'SAUVEGARDE_ECHOUEE']);

      etat.bloque = false; // le dossier redevient accessible : la sauvegarde du jour est créée, plus d'alerte
      const apres = await a.post('/api/prestations', saisie({ date: '2026-10-01' }));
      assert.deepEqual(apres.json.avertissements, []);
      assert.deepEqual((await a.get('/api/etat')).json.avertissements, []);
      assert.equal((await a.get('/api/sauvegardes')).json.sauvegardes.filter((x) => x.raison === 'quotidienne').length, 1);
    },
    { fs: fsSimule },
  );
});

test("DELETE versement : sauvegarde « avant-suppression » préalable, contenu = état d'avant", () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    const v = (await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 2000, date: '2026-10-02', mode: 'cheque' })).json.donnees.versements[0];
    const r = await a.del(`/api/prestations/${l.id}/versements/${v.id}`);
    assert.equal(r.status, 200);
    assert.equal((await disque(s)).prestations[0].versements.length, 0);
    const avant = (await a.get('/api/sauvegardes')).json.sauvegardes.find((x) => x.raison === 'avant-suppression');
    assert.ok(avant, 'sauvegarde avant-suppression créée');
    const contenu = JSON.parse(await fs.readFile(path.join(s.dossier, 'sauvegardes', avant.nom), 'utf8'));
    assert.equal(contenu.prestations[0].versements.length, 1, 'la sauvegarde contient encore le versement');
  }));

test('DELETE versement : sauvegarde impossible = suppression annulée, 503 SAUVEGARDE_ECHOUEE, versement conservé', () => {
  const { fs: fsSimule, etat } = fsSauvegardesBloquees();
  return avecServeur(
    async (s, a) => {
      const l = (await a.post('/api/prestations', saisie())).json.donnees;
      const v = (await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 2000, date: '2026-10-02', mode: 'cheque' })).json.donnees.versements[0];
      etat.bloque = true;
      const r = await a.del(`/api/prestations/${l.id}/versements/${v.id}`);
      assert.equal(r.status, 503);
      assert.equal(r.json.erreur.code, 'SAUVEGARDE_ECHOUEE');
      assert.equal((await disque(s)).prestations[0].versements.length, 1, "rien n'a été supprimé");
      etat.bloque = false;
      assert.equal((await a.del(`/api/prestations/${l.id}/versements/${v.id}`)).status, 200, 'une fois le dossier accessible, la suppression passe');
    },
    { fs: fsSimule },
  );
});

test('renommer un patient : 409 RENOMMAGE_PATIENT sans rien modifier, puis « toutes les lignes » ou « cette ligne »', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie({ date: '2026-09-01' }))).json.donnees;
    const l2 = (await a.post('/api/prestations', saisie({ date: '2026-09-08' }))).json.donnees;
    const l3 = (await a.post('/api/prestations', saisie({ date: '2026-09-15' }))).json.donnees;
    const autre = (await a.post('/api/prestations', saisie({ patient: { nom: 'Ours', prenom: 'Baloo' } }))).json.donnees;
    const nouveau = { nom: 'Lapine', prenom: 'Pierre' };

    // Sans choix : refus clair, rien n'est modifié (pas de détachement silencieux).
    const refus = await a.patch(`/api/prestations/${l1.id}`, { modifieLe: l1.modifieLe, patient: nouveau });
    assert.equal(refus.status, 409);
    assert.equal(refus.json.erreur.code, 'RENOMMAGE_PATIENT');
    assert.equal(refus.json.erreur.details.autresLignes, 2);
    assert.ok(!JSON.stringify(refus.json).includes('Lapin'), "aucun nom dans l'erreur");
    assert.deepEqual((await disque(s)).prestations.map((l) => l.patient.nom).sort(), ['Lapin', 'Lapin', 'Lapin', 'Ours']);

    // Une simple correction de casse ne demande aucun choix et ne détache rien.
    const casse = await a.patch(`/api/prestations/${l1.id}`, { modifieLe: l1.modifieLe, patient: { nom: 'LAPIN', prenom: 'Pierre' } });
    assert.equal(casse.status, 200);
    assert.equal(casse.json.donnees.patient.id, l1.patient.id);

    // Toutes les lignes : même identifiant de patient, nom changé partout.
    const tous = await a.patch(`/api/prestations/${l1.id}`, { modifieLe: casse.json.donnees.modifieLe, patient: nouveau, renommerPatient: true });
    assert.equal(tous.status, 200);
    const apres = (await disque(s)).prestations;
    assert.deepEqual(apres.filter((l) => l.patient.id === l1.patient.id).map((l) => l.patient.nom), ['Lapine', 'Lapine', 'Lapine']);
    assert.equal(apres.find((l) => l.id === autre.id).patient.nom, 'Ours', 'les autres patients ne bougent pas');
    assert.equal(new Set(apres.map((l) => l.patient.id)).size, 2);
    assert.equal((await a.get('/api/patients')).json.patients.length, 2);

    // Cette ligne seulement, choisi explicitement : détachée (nouveau patient), les autres gardent le nom.
    const l2b = (await a.get(`/api/prestations/${l2.id}`)).json.donnees;
    const seule = await a.patch(`/api/prestations/${l2.id}`, { modifieLe: l2b.modifieLe, patient: { nom: 'Lapereau', prenom: 'Pierre' }, detacherLigne: true });
    assert.equal(seule.status, 200);
    assert.notEqual(seule.json.donnees.patient.id, l1.patient.id);
    assert.equal(seule.json.donnees.patient.nom, 'Lapereau');
    const l3b = (await a.get(`/api/prestations/${l3.id}`)).json.donnees;
    assert.equal(l3b.patient.nom, 'Lapine');
    assert.equal(l3b.patient.id, l1.patient.id);
  }));

test('renommer un patient : options invalides (non booléennes, contradictoires) refusées en 400', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    for (const extra of [{ renommerPatient: 'oui' }, { detacherLigne: 1 }, { renommerPatient: true, detacherLigne: true }]) {
      const r = await a.patch(`/api/prestations/${l.id}`, { modifieLe: l.modifieLe, motif: 'x', ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
    }
    assert.equal((await a.post('/api/prestations', saisie({ renommerPatient: true }))).status, 400, 'option réservée à la modification');
  }));

test('renommage sur toutes les lignes : avertissement si un autre patient porte déjà ce nom', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie())).json.donnees;
    await a.post('/api/prestations', saisie({ date: '2026-09-01' }));
    await a.post('/api/prestations', saisie({ patient: { nom: 'Ours', prenom: 'Baloo' } }));
    const r = await a.patch(`/api/prestations/${l1.id}`, { modifieLe: l1.modifieLe, patient: { nom: 'ours', prenom: 'baloo' }, renommerPatient: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.avertissements.map((x) => x.code), ['PATIENT_HOMONYME']);
  }));

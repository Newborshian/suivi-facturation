// Recette QA : parcours métier de bout en bout par l'API (acompte + solde par deux modes, annulation, renommage de patient,
// homonymes, versements antérieurs à la prestation, trop-perçu, suppression avec sauvegarde, cohérence recap / tableau de bord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { client, lireDisque, saisie } from './aides-qa.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';

async function avec(fn, options) {
  const s = await demarrerServeurTest(options);
  try {
    await fn(s, client(s));
  } finally {
    await s.arreter();
  }
}
const sauvegardes = async (s) => (await fs.readdir(path.join(s.dossier, 'sauvegardes')).catch(() => [])).sort();

test('acompte par un mode puis solde par un autre : états non payé -> partiel -> payé, modes conservés dans l\'ordre, montants exacts', () =>
  avec(async (s, a) => {
    const c = (await a.post('/api/prestations', saisie({ montantCentimes: 12345 }))).json.donnees;
    const acompte = await a.post(`/api/prestations/${c.id}/versements`, { montantCentimes: 5000, date: '2026-10-02', mode: 'especes' });
    assert.equal(acompte.status, 201);
    assert.equal(acompte.json.donnees.etat, 'partiel');
    assert.equal(acompte.json.donnees.resteCentimes, 7345);
    const solde = await a.post(`/api/prestations/${c.id}/payer-totalite`, { mode: 'virement' });
    assert.equal(solde.status, 201);
    const l = solde.json.donnees;
    assert.equal(l.etat, 'paye');
    assert.equal(l.resteCentimes, 0);
    assert.equal(l.verseCentimes, 12345);
    assert.deepEqual(l.versements.map((v) => [v.mode, v.montantCentimes]), [['especes', 5000], ['virement', 7345]]);
    assert.equal((await a.post(`/api/prestations/${c.id}/payer-totalite`, {})).json.erreur.code, 'DEJA_PAYEE');
    assert.equal((await lireDisque(s.dossier)).parametres.dernierModePaiement, 'virement', 'dernier mode mémorisé');
  }));

test('« Payé en totalité » par chacun des cinq modes (carte, chèque, espèces, virement, autre) ; mode inconnu refusé', () =>
  avec(async (s, a) => {
    for (const mode of ['carte', 'cheque', 'especes', 'virement', 'autre']) {
      const c = (await a.post('/api/prestations', saisie({ patient: { nom: 'Mode', prenom: mode } }))).json.donnees;
      const r = await a.post(`/api/prestations/${c.id}/payer-totalite`, { mode });
      assert.equal(r.status, 201, mode);
      assert.equal(r.json.donnees.versements[0].mode, mode);
    }
    const c = (await a.post('/api/prestations', saisie({ patient: { nom: 'Mode', prenom: 'x' } }))).json.donnees;
    const refus = await a.post(`/api/prestations/${c.id}/payer-totalite`, { mode: 'bitcoin' });
    assert.equal(refus.status, 422);
    assert.equal((await a.get(`/api/prestations/${c.id}`)).json.donnees.versements.length, 0, 'rien n\'est enregistré');
  }));

test('« Payé en totalité » sans mode : MODE_REQUIS tant qu\'aucun mode n\'a été utilisé, puis dernier mode utilisé', () =>
  avec(async (s, a) => {
    const c1 = (await a.post('/api/prestations', saisie())).json.donnees;
    assert.equal((await a.post(`/api/prestations/${c1.id}/payer-totalite`, {})).json.erreur.code, 'MODE_REQUIS');
    await a.post(`/api/prestations/${c1.id}/payer-totalite`, { mode: 'cheque' });
    const c2 = (await a.post('/api/prestations', saisie({ date: '2026-10-01' }))).json.donnees;
    const r = await a.post(`/api/prestations/${c2.id}/payer-totalite`, {});
    assert.equal(r.status, 201);
    assert.equal(r.json.donnees.versements[0].mode, 'cheque');
  }));

test('annulation : « Payé en totalité » annulé -> non payé ; seconde annulation et annulation après autre modification refusées (409)', () =>
  avec(async (s, a) => {
    const c = (await a.post('/api/prestations', saisie())).json.donnees;
    const paye = await a.post(`/api/prestations/${c.id}/payer-totalite`, { mode: 'carte' });
    const ann = await a.post(`/api/annulations/${paye.json.annulation}`);
    assert.equal(ann.status, 200);
    const apres = (await a.get(`/api/prestations/${c.id}`)).json.donnees;
    assert.equal(apres.etat, 'non_paye');
    assert.deepEqual(apres.versements, []);
    assert.equal((await a.post(`/api/annulations/${paye.json.annulation}`)).status, 409);
    const p2 = await a.post(`/api/prestations/${c.id}/payer-totalite`, { mode: 'carte' });
    await a.post('/api/prestations', saisie({ date: '2026-10-01' })); // autre modification entre-temps
    const refus = await a.post(`/api/annulations/${p2.json.annulation}`);
    assert.equal(refus.status, 409);
    assert.equal(refus.json.erreur.code, 'ANNULATION_IMPOSSIBLE');
    assert.equal((await a.get(`/api/prestations/${c.id}`)).json.donnees.etat, 'paye', 'l\'état n\'a pas bougé');
  }));

test('annulation d\'une création : la ligne disparaît ; jeton inconnu : 409, rien ne change', () =>
  avec(async (s, a) => {
    const r = await a.post('/api/prestations', saisie());
    assert.equal((await a.post(`/api/annulations/${r.json.annulation}`)).status, 200);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 0);
    assert.equal((await a.post('/api/annulations/jeton-bidon')).status, 409);
  }));

test('versement antérieur à la prestation : accepté avec avertissement ; trop-perçu : accepté, signalé, hors du reste', () =>
  avec(async (s, a) => {
    const c = (await a.post('/api/prestations', saisie({ date: '2026-10-02', montantCentimes: 4500 }))).json.donnees;
    const v1 = await a.post(`/api/prestations/${c.id}/versements`, { montantCentimes: 1000, date: '2026-09-01', mode: 'cheque' });
    assert.equal(v1.status, 201);
    assert.ok(v1.json.avertissements.some((w) => w.code === 'VERSEMENT_AVANT_PRESTATION'));
    const v2 = await a.post(`/api/prestations/${c.id}/versements`, { montantCentimes: 4000, date: '2026-10-02', mode: 'cheque' });
    assert.ok(v2.json.avertissements.some((w) => w.code === 'TROP_PERCU'));
    assert.equal(v2.json.donnees.etat, 'paye');
    assert.equal(v2.json.donnees.tropPercuCentimes, 500);
    assert.equal(v2.json.donnees.resteCentimes, 0);
  }));

test('modification du montant sous le total versé : état recalculé, trop-perçu signalé ; montant 0 € accepté ; suppression d\'un versement recalcule', () =>
  avec(async (s, a) => {
    const c = (await a.post('/api/prestations', saisie({ montantCentimes: 4500 }))).json.donnees;
    const v = (await a.post(`/api/prestations/${c.id}/versements`, { montantCentimes: 4500, date: '2026-10-02', mode: 'especes' })).json.donnees;
    const m = await a.patch(`/api/prestations/${c.id}`, { montantCentimes: 3000, modifieLe: v.modifieLe });
    assert.equal(m.status, 200);
    assert.ok(m.json.avertissements.some((w) => w.code === 'TROP_PERCU'));
    assert.equal(m.json.donnees.tropPercuCentimes, 1500);
    const zero = await a.patch(`/api/prestations/${c.id}`, { montantCentimes: 0, modifieLe: m.json.donnees.modifieLe });
    assert.equal(zero.json.donnees.etat, 'paye');
    const sup = await a.del(`/api/prestations/${c.id}/versements/${v.versements[0].id}`);
    assert.equal(sup.status, 200);
    assert.equal(sup.json.donnees.etat, 'paye', 'montant 0 : toujours payé d\'office');
    assert.ok((await sauvegardes(s)).some((n) => n.includes('avant-suppression')), 'sauvegarde avant suppression d\'un versement');
  }));

test('modification concurrente : un second onglet avec l\'ancien modifieLe reçoit 409 MODIFIEE_AILLEURS et rien n\'est écrasé', () =>
  avec(async (s, a) => {
    const c = (await a.post('/api/prestations', saisie())).json.donnees;
    const v = await a.post(`/api/prestations/${c.id}/versements`, { montantCentimes: 100, date: '2026-10-02', mode: 'carte' });
    // l'horloge de test est fixe : modifieLe ne change pas entre deux modifications. On modifie le motif avec la bonne version...
    const bon = await a.patch(`/api/prestations/${c.id}`, { motif: 'Premier onglet', modifieLe: v.json.donnees.modifieLe });
    assert.equal(bon.status, 200);
    // ... puis un onglet qui a une version vraiment périmée
    const perime = await a.patch(`/api/prestations/${c.id}`, { motif: 'Second onglet', modifieLe: '2020-01-01T00:00:00.000Z' });
    assert.equal(perime.status, 409);
    assert.equal(perime.json.erreur.code, 'MODIFIEE_AILLEURS');
    assert.equal((await a.get(`/api/prestations/${c.id}`)).json.donnees.motif, 'Premier onglet');
  }));

test('renommage d\'un patient : refusé en silence interdit (409 RENOMMAGE_PATIENT), puis appliqué à toutes ses lignes ou à une seule', () =>
  avec(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie({ date: '2026-09-01' }))).json.donnees;
    const l2 = (await a.post('/api/prestations', saisie({ date: '2026-09-08' }))).json.donnees;
    const l3 = (await a.post('/api/prestations', saisie({ date: '2026-09-15' }))).json.donnees;
    assert.equal(l1.patient.id, l2.patient.id, 'même nom + prénom = même patient');
    const nouveau = { patient: { nom: 'Lapin', prenom: 'Pierrot' } };
    const refus = await a.patch(`/api/prestations/${l1.id}`, { ...nouveau, modifieLe: l1.modifieLe });
    assert.equal(refus.status, 409);
    assert.equal(refus.json.erreur.code, 'RENOMMAGE_PATIENT');
    assert.equal(refus.json.erreur.details.autresLignes, 2);
    // renommer partout
    const tout = await a.patch(`/api/prestations/${l1.id}`, { ...nouveau, renommerPatient: true, modifieLe: l1.modifieLe });
    assert.equal(tout.status, 200);
    const apres = (await a.get('/api/prestations')).json.lignes;
    assert.ok(apres.every((l) => l.patient.prenom === 'Pierrot' && l.patient.id === l1.patient.id), 'toutes les lignes renommées, même identifiant');
    // détacher une seule ligne
    const detache = await a.patch(`/api/prestations/${l3.id}`, { patient: { nom: 'Lapin', prenom: 'Roger' }, detacherLigne: true, modifieLe: apres.find((l) => l.id === l3.id).modifieLe });
    assert.equal(detache.status, 200);
    assert.notEqual(detache.json.donnees.patient.id, l1.patient.id);
    const patients = (await a.get('/api/patients')).json.patients;
    assert.equal(patients.length, 2);
  }));

test('homonymes : même nom, casse et espaces différents -> même patient ; accents différents -> patients distincts ; deux homonymes -> 409 PATIENTS_HOMONYMES', () =>
  avec(async (s, a) => {
    const a1 = (await a.post('/api/prestations', saisie({ patient: { nom: 'Dupont', prenom: 'Léa' } }))).json.donnees;
    const a2 = await a.post('/api/prestations', saisie({ date: '2026-10-01', patient: { nom: '  dupont ', prenom: 'LÉA' } }));
    assert.equal(a2.json.donnees.patient.id, a1.patient.id, 'casse et espaces ignorés');
    const a3 = await a.post('/api/prestations', saisie({ date: '2026-09-30', patient: { nom: 'Dupont', prenom: 'Lea' } }));
    assert.notEqual(a3.json.donnees.patient.id, a1.patient.id, 'les accents distinguent (décision d\'architecture : à valider)');
    // créer volontairement un homonyme exact
    const h = await a.post('/api/prestations', saisie({ date: '2026-09-29', patient: { nom: 'Dupont', prenom: 'Léa' }, nouveauPatient: true }));
    assert.equal(h.status, 201);
    assert.notEqual(h.json.donnees.patient.id, a1.patient.id);
    const ambigu = await a.post('/api/prestations', saisie({ date: '2026-09-28', patient: { nom: 'Dupont', prenom: 'Léa' } }));
    assert.equal(ambigu.status, 409);
    assert.equal(ambigu.json.erreur.code, 'PATIENTS_HOMONYMES');
    assert.equal(ambigu.json.erreur.details.candidats.length, 2);
    assert.ok(!JSON.stringify(ambigu.json).includes('Dupont'), 'aucun nom dans l\'erreur');
  }));

test('suppression d\'une prestation : sauvegarde « avant-suppression » créée, versements supprimés avec la ligne, annulable', () =>
  avec(async (s, a) => {
    const c = (await a.post('/api/prestations', saisie())).json.donnees;
    await a.post(`/api/prestations/${c.id}/payer-totalite`, { mode: 'carte' });
    const sup = await a.del(`/api/prestations/${c.id}`);
    assert.equal(sup.status, 200);
    assert.equal(sup.json.donnees.versementsSupprimes, 1);
    assert.ok((await sauvegardes(s)).some((n) => n.includes('avant-suppression')));
    const sauvegarde = (await sauvegardes(s)).find((n) => n.includes('avant-suppression'));
    const contenu = JSON.parse(await fs.readFile(path.join(s.dossier, 'sauvegardes', sauvegarde), 'utf8'));
    assert.equal(contenu.prestations.length, 1, 'la sauvegarde contient la ligne supprimée');
    assert.equal((await a.post(`/api/annulations/${sup.json.annulation}`)).status, 200);
    assert.equal((await a.get(`/api/prestations/${c.id}`)).json.donnees.etat, 'paye', 'ligne et versement restaurés');
  }));

test('statut groupé : prestations à venir, doublon d\'ids, id inconnu (rien n\'est modifié), retour à « à facturer » efface la date de facturation', () =>
  avec(async (s, a) => {
    const passee = (await a.post('/api/prestations', saisie({ date: '2026-10-01' }))).json.donnees;
    const futur = (await a.post('/api/prestations', saisie({ date: '2026-12-24' }))).json.donnees;
    assert.ok(futur.aVenir);
    const inconnu = await a.post('/api/prestations/statut', { ids: [passee.id, 'inconnu'], statut: 'facture' });
    assert.equal(inconnu.status, 404);
    assert.equal((await a.get(`/api/prestations/${passee.id}`)).json.donnees.statut, 'a_facturer', 'aucune modification partielle');
    const ok = await a.post('/api/prestations/statut', { ids: [passee.id, passee.id, futur.id], statut: 'facture' });
    assert.equal(ok.json.donnees.modifiees, 2);
    assert.ok(ok.json.avertissements.some((w) => w.code === 'FACTURATION_DATE_FUTURE'));
    const retour = await a.post('/api/prestations/statut', { ids: [passee.id], statut: 'a_facturer' });
    assert.equal(retour.json.donnees.modifiees, 1);
    const l = (await a.get(`/api/prestations/${passee.id}`)).json.donnees;
    assert.equal(l.statut, 'a_facturer');
    assert.equal(l.factureLe, null);
    assert.equal((await a.post('/api/prestations/statut', { ids: [], statut: 'facture' })).status, 400);
    assert.equal((await a.post('/api/prestations/statut', { ids: Array.from({ length: 1001 }, (_, i) => `x${i}`), statut: 'facture' })).status, 400);
  }));

test('cohérence HTTP : le « dû » de /api/recap = le total du mois de /api/indicateurs/ca-mensuel = Σ des lignes de /api/prestations, après un parcours complet', () =>
  avec(async (s, a) => {
    const ids = [];
    for (const [jour, montant] of [['2026-10-01', 4500], ['2026-10-02', 3500], ['2026-10-02', 25000], ['2026-09-30', 4500], ['2026-11-05', 4500]]) {
      ids.push((await a.post('/api/prestations', saisie({ date: jour, montantCentimes: montant, patient: { nom: 'Lapin', prenom: jour === '2026-09-30' ? 'Autre' : 'Pierre' } }))).json.donnees.id);
    }
    await a.post(`/api/prestations/${ids[0]}/versements`, { montantCentimes: 2000, date: '2026-10-02', mode: 'cheque' });
    await a.post(`/api/prestations/${ids[2]}/payer-totalite`, { mode: 'virement' });
    await a.post('/api/prestations/statut', { ids: [ids[0], ids[1]], statut: 'facture' });
    const recap = (await a.get('/api/recap?mois=2026-10')).json;
    const ca = (await a.get('/api/indicateurs/ca-mensuel?de=2026-09&a=2026-11')).json;
    const liste = (await a.get('/api/prestations?mois=2026-10')).json;
    const oct = ca.mois.find((m) => m.mois === '2026-10');
    assert.equal(recap.total.duCentimes, 33000);
    assert.equal(recap.total.duCentimes, oct.totalCentimes);
    assert.equal(recap.total.duCentimes, liste.total.montantCentimes);
    assert.equal(recap.total.payeCentimes, 27000);
    assert.equal(oct.payeCentimes + oct.attenteCentimes + oct.aFacturerCentimes + oct.aVenirCentimes, oct.totalCentimes);
    const synthese = (await a.get('/api/indicateurs/synthese')).json;
    assert.equal(synthese.caMois.totalCentimes, recap.total.duCentimes);
  }));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerServeurTest } from '../aides/serveur-aide.js';

function api(s) {
  const origine = `http://127.0.0.1:${s.port}`;
  return {
    get: (chemin) => s.requete({ chemin }),
    post: (chemin, corps) => s.requete({ methode: 'POST', chemin, headers: { Origin: origine, 'Content-Type': 'application/json' }, corps: JSON.stringify(corps) }),
  };
}
const saisie = (date, montantCentimes) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date, prestationId: 'seance-45', montantCentimes, motif: '' });

async function avecServeur(fn) {
  const s = await demarrerServeurTest(); // horloge fixe : 2026-10-02
  try {
    await fn(s, api(s));
  } finally {
    await s.arreter();
  }
}

test('prévision : fichier vide -> 200 « historique insuffisant », 3 mois manquants, aucun chiffre', () =>
  avecServeur(async (s, a) => {
    const r = await a.get('/api/indicateurs/prevision');
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.json.aujourdHui, '2026-10-02');
    assert.equal(r.json.suffisant, false);
    assert.equal(r.json.moisComplets, 0);
    assert.equal(r.json.moisManquants, 3);
    assert.equal(r.json.base, null);
    assert.equal(r.json.premiereEstimationLe, null);
    assert.deepEqual(r.json.mois, []);
  }));

test('prévision : un seul mois d\'historique -> toujours insuffisant, avec le nombre de mois manquants', () =>
  avecServeur(async (s, a) => {
    await a.post('/api/prestations', saisie('2026-09-01', 4500));
    await a.post('/api/prestations', saisie('2026-10-01', 4500));
    const r = (await a.get('/api/indicateurs/prevision')).json;
    assert.equal(r.suffisant, false);
    assert.equal(r.moisComplets, 1);
    assert.equal(r.moisManquants, 2);
    assert.equal(r.premiereEstimationLe, '2026-12-01'); // septembre, octobre, novembre complets -> 1er décembre
    assert.deepEqual(r.mois, []);
  }));

test('prévision : historique suffisant -> base, mois en cours et 3 suivants ; aucun nom de patient dans la réponse', () =>
  avecServeur(async (s, a) => {
    await a.post('/api/prestations', saisie('2026-07-01', 12000));
    await a.post('/api/prestations', saisie('2026-08-10', 6000));
    await a.post('/api/prestations', saisie('2026-09-20', 15000));
    await a.post('/api/prestations', saisie('2026-10-01', 4000));
    const futur = (await a.post('/api/prestations', saisie('2026-10-20', 3000))).json.donnees;
    await a.post('/api/prestations', saisie('2026-11-05', 2000));
    await a.post(`/api/prestations/${futur.id}/versements`, { montantCentimes: 1000, date: '2026-10-02', mode: 'cheque' }); // acompte : le montant reste 3000

    const reponse = await a.get('/api/indicateurs/prevision');
    assert.equal(reponse.status, 200);
    const r = reponse.json;
    assert.equal(r.suffisant, true);
    assert.equal(r.base, 11000);
    assert.deepEqual(r.mois.map((m) => m.mois), ['2026-10', '2026-11', '2026-12', '2027-01']);
    // 2 octobre : 29 jours restants sur 31 -> 11000 x 29 / 31 = 10290,32 -> 10290
    assert.deepEqual(r.mois[0], { mois: '2026-10', courant: true, realiseCentimes: 4000, planifieCentimes: 3000, complementEstimeCentimes: 7290, estimationCentimes: 14290 });
    assert.equal(r.mois[1].estimationCentimes, 11000);
    assert.equal(r.mois[1].planifieCentimes, 2000);
    assert.equal(r.mois[3].estimationCentimes, 11000);
    assert.doesNotMatch(reponse.texte, /Lapin|Pierre/);

    // La prévision ne touche pas aux autres indicateurs : le CA d'octobre reste égal au « dû » de la page Facturation du mois.
    const ca = (await a.get('/api/indicateurs/ca-mensuel?de=2026-10&a=2026-10')).json.mois[0];
    const recap = (await a.get('/api/recap?mois=2026-10')).json.total;
    assert.equal(ca.totalCentimes, recap.duCentimes);
    assert.equal(ca.totalCentimes, 7000);
  }));

test('prévision : paramètre inconnu refusé (400), méthode autre que GET refusée, pas de donnée dans l\'URL', () =>
  avecServeur(async (s, a) => {
    for (const requete of ['?de=2026-01', '?mois=2026-10', '?patient=Lapin', '?x']) {
      const r = await a.get(`/api/indicateurs/prevision${requete}`);
      assert.equal(r.status, 400, requete);
      assert.equal(r.json.erreur?.code ?? r.json.code, 'REQUETE_INVALIDE', requete);
    }
    const post = await a.post('/api/indicateurs/prevision', {});
    assert.ok([404, 405].includes(post.status), `statut ${post.status}`);
  }));

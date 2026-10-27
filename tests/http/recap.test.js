import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerServeurTest } from '../aides/serveur-aide.js';

function api(s) {
  const appeler = (methode, chemin, corps) =>
    s.requete({
      methode,
      chemin,
      headers: { Origin: `http://127.0.0.1:${s.port}`, ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      corps: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
  return { get: (chemin) => s.requete({ chemin }), post: (chemin, corps) => appeler('POST', chemin, corps) };
}
const saisie = (extra = {}) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-01', prestationId: 'seance-45', montantCentimes: 4500, motif: '', ...extra });

async function avecServeur(fn) {
  const s = await demarrerServeurTest(); // horloge fixe : 2026-10-02
  try {
    await fn(s, api(s));
  } finally {
    await s.arreter();
  }
}

test('GET /api/recap : sans paramètre = mois en cours, vue prestation ; fichier vide -> mois vide, rien à facturer', () =>
  avecServeur(async (s, a) => {
    const r = await a.get('/api/recap');
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.json.mois, '2026-10');
    assert.equal(r.json.vue, 'prestation');
    assert.equal(r.json.aujourdHui, '2026-10-02');
    assert.deepEqual(r.json.patients, []);
    assert.equal(r.json.total.duCentimes, 0);
    assert.deepEqual(r.json.aFacturer, { nombre: 0, montantCentimes: 0, aVenirNombre: 0, aVenirMontantCentimes: 0, zeroNombre: 0 });
    assert.deepEqual(r.json.moisDisponibles, ['2026-10']);
    assert.deepEqual(r.json.paiementsParMode.total, { nombre: 0, montantCentimes: 0 });
  }));

test('GET /api/recap : paiementsParMode compte les versements datés du mois par mode, dans les deux vues', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie())).json.donnees;
    const l2 = (await a.post('/api/prestations', saisie({ date: '2026-09-20' }))).json.donnees;
    await a.post(`/api/prestations/${l1.id}/versements`, { montantCentimes: 2000, date: '2026-10-01', mode: 'especes' });
    await a.post(`/api/prestations/${l1.id}/versements`, { montantCentimes: 2500, date: '2026-10-02', mode: 'carte' });
    await a.post(`/api/prestations/${l2.id}/versements`, { montantCentimes: 4500, date: '2026-10-01', mode: 'carte' });
    for (const vue of ['prestation', 'versement']) {
      const { paiementsParMode } = (await a.get(`/api/recap?mois=2026-10&vue=${vue}`)).json;
      const parMode = Object.fromEntries(paiementsParMode.modes.map((m) => [m.mode, [m.nombre, m.montantCentimes]]));
      assert.deepEqual(parMode, { carte: [2, 7000], cheque: [0, 0], especes: [1, 2000], virement: [0, 0], autre: [0, 0] }, vue);
      assert.deepEqual(paiementsParMode.total, { nombre: 3, montantCentimes: 9000 }, vue);
    }
    assert.equal((await a.get('/api/recap?mois=2026-09')).json.paiementsParMode.total.nombre, 0);
  }));

test('GET /api/recap : vecteur 1 de bout en bout (3 prestations, un versement) ; le statut se reflète', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie())).json.donnees;
    await a.post('/api/prestations', saisie({ date: '2026-10-08' }));
    await a.post('/api/prestations', saisie({ date: '2026-10-15', prestationId: 'seance-30', montantCentimes: 3500 }));
    await a.post(`/api/prestations/${l1.id}/versements`, { montantCentimes: 4500, date: '2026-10-01', mode: 'cheque' });
    const r = (await a.get('/api/recap?mois=2026-10')).json;
    const [e] = r.patients;
    assert.equal(r.patients.length, 1);
    assert.deepEqual([e.nbSeances, e.duCentimes, e.payeCentimes, e.resteCentimes, e.etat], [3, 12500, 4500, 8000, 'partiel']);
    assert.equal(e.lignes.length, 3);
    assert.equal(e.lignes[0].etat, 'paye');
    assert.equal(e.lignes[2].aVenir, true);
    assert.deepEqual(r.aFacturer, { nombre: 1, montantCentimes: 4500, aVenirNombre: 2, aVenirMontantCentimes: 8000, zeroNombre: 0 });
    await a.post('/api/prestations/statut', { ids: e.lignes.map((l) => l.id), statut: 'facture' });
    const apres = (await a.get('/api/recap?mois=2026-10')).json;
    assert.equal(apres.aFacturer.nombre, 0);
    assert.equal(apres.patients[0].lignes.filter((l) => l.statut === 'a_facturer').length, 0);
  }));

test('GET /api/recap : double vue, mois précédent, mois d\'une autre année vide, mois proposés', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie({ date: '2026-09-20' }))).json.donnees;
    await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 4500, date: '2026-10-01', mode: 'virement' });
    const sept = (await a.get('/api/recap?mois=2026-09')).json;
    assert.equal(sept.total.payeCentimes, 4500);
    const octVersement = (await a.get('/api/recap?mois=2026-10&vue=versement')).json;
    assert.equal(octVersement.total.payeCentimes, 4500);
    assert.equal(octVersement.total.duCentimes, 0);
    assert.equal(octVersement.patients[0].versements[0].mode, 'virement');
    assert.equal(octVersement.total.resteCentimes, null);
    assert.equal((await a.get('/api/recap?mois=2026-10')).json.patients.length, 0);
    assert.equal((await a.get('/api/recap?mois=2025-10')).json.patients.length, 0);
    assert.deepEqual((await a.get('/api/recap?mois=2025-10')).json.moisDisponibles, ['2025-10', '2026-09', '2026-10']);
    // vue « versement » : un mois qui n'a que des versements est proposé
    await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 100, date: '2026-11-02', mode: 'virement' });
    assert.deepEqual((await a.get('/api/recap?mois=2026-10&vue=versement')).json.moisDisponibles, ['2026-09', '2026-10', '2026-11']);
    assert.deepEqual((await a.get('/api/recap?mois=2026-10&vue=prestation')).json.moisDisponibles, ['2026-09', '2026-10']);
  }));

test('GET /api/recap : paramètres invalides ou inconnus -> 400 ; aucun nom de patient dans l\'URL ni dans le journal', () =>
  avecServeur(async (s, a) => {
    await a.post('/api/prestations', saisie({ patient: { nom: 'Secretnom', prenom: 'Secretprenom' } }));
    for (const q of ['mois=2026-13', 'mois=abc', 'vue=x', 'patient=Secretnom', 'mois=2026-10&nom=Secretnom']) {
      const r = await a.get(`/api/recap?${q}`);
      assert.equal(r.status, 400, q);
      assert.equal(r.json.erreur.code, 'REQUETE_INVALIDE');
      assert.ok(!r.texte.includes('Secretnom'));
    }
    const ok = await a.get('/api/recap');
    assert.equal(ok.status, 200);
    assert.ok(!s.journal.join('\n').match(/Secret/), 'ni nom ni prénom dans le journal');
  }));

test('GET /api/recap : Host étranger refusé, méthode d\'écriture refusée', () =>
  avecServeur(async (s) => {
    assert.equal((await s.requete({ chemin: '/api/recap', hote: 'evil.example' })).json.erreur.code, 'HOTE_REFUSE');
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/recap', headers: { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json' }, corps: '{}' })).status, 405);
  }));

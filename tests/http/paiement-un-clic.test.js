// Choix du mode de paiement en un clic (épic E13) côté API : paiement avec chacun des cinq modes, 409 DEJA_PAYEE, correction du mode
// d'un versement (décision D3 : ne change PAS le « dernier mode utilisé »), annulation (restaure le dernier mode et le mode d'origine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, lireDisque, saisie } from '../qa/aides-qa.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { listeModesPaiement } from '../../public/js/format.js';

async function avec(fn) {
  const s = await demarrerServeurTest();
  try {
    await fn(s, client(s));
  } finally {
    await s.arreter();
  }
}
const creer = async (a, extra) => (await a.post('/api/prestations', saisie(extra))).json.donnees;
const dernierMode = async (a) => (await a.get('/api/etat')).json.dernierModePaiement;
const lire = async (a, id) => (await a.get(`/api/prestations/${id}`)).json.donnees;
const versement = (a, id, montantCentimes, mode, date = '2026-10-02') => a.post(`/api/prestations/${id}/versements`, { montantCentimes, date, mode });

test('payer en un clic avec chacun des cinq modes : versement = reste, daté du jour, mode du bouton, mode mémorisé ; état payé', () =>
  avec(async (s, a) => {
    for (const mode of ['carte', 'cheque', 'especes', 'virement', 'autre']) {
      const l = await creer(a, { patient: { nom: 'Mode', prenom: mode } });
      const r = await a.post(`/api/prestations/${l.id}/payer-totalite`, { mode });
      assert.equal(r.status, 201, mode);
      const v = r.json.donnees.versements.at(-1);
      assert.deepEqual([v.montantCentimes, v.date, v.mode], [4500, '2026-10-02', mode]);
      assert.deepEqual([r.json.donnees.etat, r.json.donnees.resteCentimes], ['paye', 0]);
      assert.equal(await dernierMode(a), mode, 'le dernier mode utilisé suit le bouton cliqué');
      assert.ok(r.json.annulation);
    }
  }));

test('payer en un clic une prestation déjà partiellement payée : le versement est le RESTE, pas le montant total', () =>
  avec(async (s, a) => {
    const l = await creer(a);
    await versement(a, l.id, 2700, 'carte');
    const r = await a.post(`/api/prestations/${l.id}/payer-totalite`, { mode: 'especes' });
    assert.equal(r.json.donnees.versements.at(-1).montantCentimes, 1800);
    assert.deepEqual(r.json.donnees.versements.map((v) => v.mode), ['carte', 'especes']);
  }));

test('deuxième paiement immédiat : 409 DEJA_PAYEE, aucun versement ajouté, mode mémorisé inchangé', () =>
  avec(async (s, a) => {
    const l = await creer(a);
    assert.equal((await a.post(`/api/prestations/${l.id}/payer-totalite`, { mode: 'cheque' })).status, 201);
    const deja = await a.post(`/api/prestations/${l.id}/payer-totalite`, { mode: 'virement' });
    assert.equal(deja.status, 409);
    assert.equal(deja.json.erreur.code, 'DEJA_PAYEE');
    assert.equal((await lire(a, l.id)).versements.length, 1);
    assert.equal(await dernierMode(a), 'cheque');
  }));

test('mode invalide ou absent du corps JSON : 422 avec message sur le champ « mode », rien d\'enregistré, mode mémorisé inchangé', () =>
  avec(async (s, a) => {
    const l = await creer(a);
    for (const corps of [{ mode: 'bitcoin' }, { mode: '' }, { mode: null }, { mode: 42 }]) {
      const r = await a.post(`/api/prestations/${l.id}/payer-totalite`, corps);
      assert.equal(r.status, 422, JSON.stringify(corps));
      assert.ok(r.json.erreur.champs.mode, JSON.stringify(corps));
    }
    assert.equal((await lire(a, l.id)).versements.length, 0);
    assert.equal(await dernierMode(a), null);
  }));

test('annulation d\'un paiement en un clic : le versement disparaît et le dernier mode mémorisé est restauré (ancien mode, puis « aucun »)', () =>
  avec(async (s, a) => {
    const l1 = await creer(a, { patient: { nom: 'Lapin', prenom: 'Pierre' } });
    const l2 = await creer(a, { patient: { nom: 'Ours', prenom: 'Baloo' } });
    assert.equal(await dernierMode(a), null);

    const p1 = await a.post(`/api/prestations/${l1.id}/payer-totalite`, { mode: 'virement' });
    assert.equal(await dernierMode(a), 'virement');
    const p2 = await a.post(`/api/prestations/${l2.id}/payer-totalite`, { mode: 'especes' });
    assert.equal(await dernierMode(a), 'especes');

    assert.equal((await a.post(`/api/annulations/${p2.json.annulation}`)).status, 200);
    assert.equal(await dernierMode(a), 'virement', 'le mode en évidence redevient l\'ancien');
    assert.equal((await lire(a, l2.id)).etat, 'non_paye');
    assert.equal((await lireDisque(s.dossier)).parametres.dernierModePaiement, 'virement', 'restauré aussi sur le disque');

    assert.equal((await a.post(`/api/annulations/${p1.json.annulation}`)).status, 409, 'une seule action annulable : la dernière');
    assert.equal(await dernierMode(a), 'virement');
  }));

test('annulation du tout premier paiement : plus aucun mode mémorisé (aucun bouton en évidence)', () =>
  avec(async (s, a) => {
    const l = await creer(a);
    const p = await a.post(`/api/prestations/${l.id}/payer-totalite`, { mode: 'cheque' });
    assert.equal((await a.post(`/api/annulations/${p.json.annulation}`)).status, 200);
    assert.equal(await dernierMode(a), null);
    assert.equal((await lireDisque(s.dossier)).parametres.dernierModePaiement, null);
  }));

test('D3 : corriger le mode d\'un versement existant (PATCH { mode } seul) ne change ni le montant, ni la date, ni l\'état, ni le dernier mode utilisé', () =>
  avec(async (s, a) => {
    const l = await creer(a);
    const v1 = (await versement(a, l.id, 4000, 'carte', '2026-09-30')).json.donnees.versements[0];
    const paye = await a.post(`/api/prestations/${l.id}/payer-totalite`, { mode: 'virement' });
    assert.equal(await dernierMode(a), 'virement');
    const avant = paye.json.donnees;

    const r = await a.patch(`/api/prestations/${l.id}/versements/${v1.id}`, { mode: 'cheque' });
    assert.equal(r.status, 200);
    const modifie = r.json.donnees.versements.find((v) => v.id === v1.id);
    assert.deepEqual([modifie.id, modifie.montantCentimes, modifie.date, modifie.mode], [v1.id, 4000, '2026-09-30', 'cheque']);
    assert.deepEqual([r.json.donnees.etat, r.json.donnees.resteCentimes, r.json.donnees.verseCentimes], [avant.etat, avant.resteCentimes, avant.verseCentimes]);
    assert.equal(await dernierMode(a), 'virement', 'corriger n\'est pas payer : le mode en évidence ne bouge pas');
    assert.equal((await lireDisque(s.dossier)).parametres.dernierModePaiement, 'virement');
    assert.ok(r.json.annulation);
  }));

test('D3 : même une correction complète du versement (montant, date, mode) laisse le dernier mode utilisé tel quel ; seul un NOUVEAU versement le change', () =>
  avec(async (s, a) => {
    const l = await creer(a);
    const v = (await versement(a, l.id, 1000, 'carte')).json.donnees.versements[0];
    assert.equal(await dernierMode(a), 'carte');
    await a.patch(`/api/prestations/${l.id}/versements/${v.id}`, { montantCentimes: 1200, date: '2026-10-01', mode: 'autre' });
    assert.equal(await dernierMode(a), 'carte');
    await versement(a, l.id, 100, 'especes');
    assert.equal(await dernierMode(a), 'especes');
  }));

test('changement de mode : annulation = mode d\'origine restauré ; les icônes de la colonne Paiement suivent l\'ordre chronologique, sans doublon', () =>
  avec(async (s, a) => {
    const l = await creer(a);
    const v1 = (await versement(a, l.id, 1500, 'carte', '2026-09-28')).json.donnees.versements[0];
    const v2 = (await versement(a, l.id, 3000, 'cheque', '2026-10-01')).json.donnees.versements[1];
    assert.deepEqual(listeModesPaiement(await lire(a, l.id)), ['Carte bancaire', 'Chèque']);

    const r = await a.patch(`/api/prestations/${l.id}/versements/${v1.id}`, { mode: 'cheque' });
    assert.deepEqual(listeModesPaiement(r.json.donnees), ['Chèque'], 'deux versements par chèque : une seule icône');

    assert.equal((await a.post(`/api/annulations/${r.json.annulation}`)).status, 200);
    const apres = await lire(a, l.id);
    assert.deepEqual(apres.versements.map((v) => [v.id, v.mode]), [[v1.id, 'carte'], [v2.id, 'cheque']]);
    assert.deepEqual(listeModesPaiement(apres), ['Carte bancaire', 'Chèque']);
    assert.equal(await dernierMode(a), 'cheque', 'le dernier mode utilisé est celui du dernier versement ajouté, avant comme après');
  }));

test('changement de mode : mode inconnu -> 422, versement inchangé ; versement introuvable -> 404', () =>
  avec(async (s, a) => {
    const l = await creer(a);
    const v = (await versement(a, l.id, 1000, 'carte')).json.donnees.versements[0];
    const refus = await a.patch(`/api/prestations/${l.id}/versements/${v.id}`, { mode: 'bitcoin' });
    assert.equal(refus.status, 422);
    assert.ok(refus.json.erreur.champs.mode);
    assert.equal((await lire(a, l.id)).versements[0].mode, 'carte');
    assert.equal((await a.patch(`/api/prestations/${l.id}/versements/inconnu`, { mode: 'cheque' })).status, 404);
  }));

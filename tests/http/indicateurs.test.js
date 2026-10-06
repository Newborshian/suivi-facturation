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

test('indicateurs : fichier vide -> 12 mois à zéro, aucune séance, aucun impayé, synthèse vide ; en-têtes no-store', () =>
  avecServeur(async (s, a) => {
    const ca = await a.get('/api/indicateurs/ca-mensuel');
    assert.equal(ca.status, 200);
    assert.equal(ca.headers['cache-control'], 'no-store');
    assert.equal(ca.json.mois.length, 12);
    assert.equal(ca.json.de, '2025-11');
    assert.equal(ca.json.a, '2026-10');
    assert.equal(ca.json.total.totalCentimes, 0);
    assert.equal((await a.get('/api/indicateurs/seances')).json.total.total, 0);
    assert.equal((await a.get('/api/indicateurs/repartition')).json.types.length, 0);
    assert.equal((await a.get('/api/indicateurs/impayes')).json.totalResteCentimes, 0);
    const syn = (await a.get('/api/indicateurs/synthese')).json;
    assert.equal(syn.mois, '2026-10');
    assert.deepEqual(syn.resteAEncaisser, { montantCentimes: 0, nombre: 0, resteNonFactureCentimes: 0 });
    assert.equal(syn.caMois.totalCentimes, 0);
    assert.deepEqual(syn.seancesMois, { realisees: 0, aVenir: 0, autres: 0, total: 0 });
  }));

test('indicateurs de bout en bout : CA = récapitulatif du même mois, séances, répartition, impayés, synthèse', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie())).json.donnees;
    const l2 = (await a.post('/api/prestations', saisie({ date: '2026-09-15', montantCentimes: 3500, prestationId: 'seance-30' }))).json.donnees;
    await a.post('/api/prestations', saisie({ date: '2026-10-01', prestationId: 'bilan-initial', montantCentimes: 25000 }));
    await a.post('/api/prestations', saisie({ date: '2026-10-20' })); // à venir
    await a.post(`/api/prestations/${l1.id}/versements`, { montantCentimes: 2000, date: '2026-10-01', mode: 'cheque' });
    await a.post('/api/prestations/statut', { ids: [l2.id], statut: 'facture', date: '2026-09-30' });

    const ca = (await a.get('/api/indicateurs/ca-mensuel?de=2026-09&a=2026-10')).json;
    for (const m of ca.mois) {
      const recap = (await a.get(`/api/recap?mois=${m.mois}`)).json.total;
      assert.equal(m.totalCentimes, recap.duCentimes, m.mois);
      assert.equal(m.payeCentimes, recap.payeCentimes, m.mois);
      assert.equal(m.payeCentimes + m.attenteCentimes + m.aFacturerCentimes + m.aVenirCentimes, m.totalCentimes, m.mois);
    }
    const oct = ca.mois[1];
    assert.deepEqual([oct.payeCentimes, oct.aFacturerCentimes, oct.aVenirCentimes, oct.totalCentimes], [2000, 2500 + 25000, 4500, 34000]);
    assert.equal(ca.mois[0].attenteCentimes, 3500);

    const versement = (await a.get('/api/indicateurs/ca-mensuel?de=2026-09&a=2026-10&vue=versement')).json;
    assert.deepEqual(versement.mois.map((m) => m.encaisseCentimes), [0, 2000]);

    const seances = (await a.get('/api/indicateurs/seances?de=2026-09&a=2026-10&granularite=mois')).json;
    assert.deepEqual(seances.periodes.map((p) => [p.periode, p.realisees, p.aVenir, p.autres]), [['2026-09', 1, 0, 0], ['2026-10', 1, 1, 1]]);
    assert.ok((await a.get('/api/indicateurs/seances?de=2026-10&a=2026-10&granularite=semaine')).json.periodes.length >= 4);

    const rep = (await a.get('/api/indicateurs/repartition?de=2026-09&a=2026-10')).json;
    assert.equal(rep.totalCentimes, ca.total.totalCentimes);
    assert.equal(rep.types[0].prestationId, 'bilan-initial');
    assert.equal(rep.types.reduce((t, x) => t + x.caCentimes, 0), rep.totalCentimes);

    const imp = (await a.get('/api/indicateurs/impayes')).json;
    assert.equal(imp.resteFactureCentimes, 3500);
    assert.equal(imp.resteNonFactureCentimes, 2500 + 25000); // la prestation à venir n'est pas un impayé
    assert.equal(imp.factures[0].nombre, 1); // facturée le 30/09 : 2 jours

    const syn = (await a.get('/api/indicateurs/synthese')).json;
    assert.equal(syn.resteAEncaisser.montantCentimes, imp.totalResteCentimes);
    assert.equal(syn.caMois.totalCentimes, oct.totalCentimes);
    assert.equal(syn.aFacturer.aVenirNombre, 1);
    assert.deepEqual(syn.seancesMois, { realisees: 1, aVenir: 1, autres: 1, total: 2 });
  }));

test('indicateurs : le clic sur une tranche (GET /api/prestations?anciennete=…) renvoie les lignes de la tranche', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie({ date: '2026-08-01' }))).json.donnees;
    await a.post('/api/prestations/statut', { ids: [l.id], statut: 'facture', date: '2026-09-02' });
    await a.post('/api/prestations', saisie({ date: '2026-09-30' }));
    const liste = (await a.get('/api/prestations?statut=facture&anciennete=30-59')).json;
    assert.deepEqual(liste.lignes.map((x) => x.id), [l.id]);
    assert.equal((await a.get('/api/prestations?statut=a_facturer&anciennete=0-29')).json.lignes.length, 1);
    assert.equal((await a.get('/api/prestations?anciennete=31')).status, 400);
  }));

test('indicateurs : paramètres invalides -> 400 ; aucun nom de patient dans l\'URL ni dans le journal ; POST refusé', () =>
  avecServeur(async (s, a) => {
    await a.post('/api/prestations', saisie({ patient: { nom: 'Secretnom', prenom: 'Secretprenom' } }));
    for (const q of ['ca-mensuel?de=2026-13', 'ca-mensuel?vue=x', 'ca-mensuel?patient=Secretnom', 'seances?granularite=jour', 'seances?de=2026-05&a=2026-01', 'seances?de=2020-01&a=2026-04', 'repartition?vue=prestation', 'impayes?x=1', 'synthese?mois=2026-10']) {
      const r = await a.get(`/api/indicateurs/${q}`);
      assert.equal(r.status, 400, q);
      assert.equal(r.json.erreur.code, 'REQUETE_INVALIDE');
    }
    for (const chemin of ['ca-mensuel', 'seances', 'repartition', 'impayes', 'synthese']) await a.get(`/api/indicateurs/${chemin}`);
    assert.doesNotMatch(s.journal.join('\n'), /Secret/);
    const post = await a.post('/api/indicateurs/impayes', {});
    assert.equal(post.status, 405);
  }));

test('libellés : « À facturer » (montant de facture, acomptes compris) diffère du reste à payer du graphique et des impayés ; relation figée par un acompte', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie({ date: '2026-09-15' }))).json.donnees; // 45 €, non facturée
    await a.post('/api/prestations', saisie({ date: '2026-09-20', montantCentimes: 3500, prestationId: 'seance-30' })); // 35 €, non facturée, sans acompte
    await a.post(`/api/prestations/${l1.id}/versements`, { montantCentimes: 2000, date: '2026-09-16', mode: 'cheque' });
    const syn = (await a.get('/api/indicateurs/synthese')).json;
    const imp = (await a.get('/api/indicateurs/impayes')).json;
    const ca = (await a.get('/api/indicateurs/ca-mensuel?de=2026-09&a=2026-09')).json.mois[0];
    assert.equal(syn.aFacturer.montantCentimes, 4500 + 3500, 'indicateur de tête : montant à mettre sur les factures, acompte compris');
    assert.equal(imp.resteNonFactureCentimes, 2500 + 3500, 'impayés « à facturer » : reste à payer, acompte déduit');
    assert.equal(ca.aFacturerCentimes, imp.resteNonFactureCentimes, 'graphique = impayés (même notion : reste à payer)');
    assert.equal(syn.resteAEncaisser.montantCentimes, imp.totalResteCentimes);
    assert.equal(syn.resteAEncaisser.resteNonFactureCentimes, 2500 + 3500, 'détail « dont … pas encore facturés » = reste à payer des lignes non facturées');
    assert.equal(syn.aFacturer.montantCentimes - imp.resteNonFactureCentimes, 2000, 'l\'écart entre les deux notions est exactement l\'acompte déjà versé');
  }));

test('prestation à venir déjà facturée (avec acompte) : « facturé en attente » et reste à encaisser, égalité avec le dû de Facturation du mois sur plusieurs mois', () =>
  avecServeur(async (s, a) => {
    const futur = (await a.post('/api/prestations', saisie({ date: '2026-10-20' }))).json.donnees; // à venir
    const futur2 = (await a.post('/api/prestations', saisie({ date: '2026-11-10', montantCentimes: 3500, prestationId: 'seance-30' }))).json.donnees;
    await a.post('/api/prestations', saisie({ date: '2026-11-12' })); // à venir, non facturée : reste hors du reste à encaisser
    await a.post('/api/prestations/statut', { ids: [futur.id, futur2.id], statut: 'facture', date: '2026-10-02' });
    await a.post(`/api/prestations/${futur.id}/versements`, { montantCentimes: 1500, date: '2026-10-02', mode: 'cheque' });

    const ca = (await a.get('/api/indicateurs/ca-mensuel?de=2026-10&a=2026-12')).json;
    const par = Object.fromEntries(ca.mois.map((m) => [m.mois, m]));
    assert.deepEqual([par['2026-10'].attenteCentimes, par['2026-10'].aVenirCentimes, par['2026-10'].payeCentimes], [3000, 0, 1500]);
    assert.deepEqual([par['2026-11'].attenteCentimes, par['2026-11'].aVenirCentimes], [3500, 4500]);
    for (const m of ca.mois) {
      const recap = (await a.get(`/api/recap?mois=${m.mois}`)).json.total;
      assert.equal(m.totalCentimes, recap.duCentimes, m.mois);
      assert.equal(m.attenteCentimes + m.aFacturerCentimes + m.aVenirCentimes, recap.resteCentimes, m.mois);
    }
    const imp = (await a.get('/api/indicateurs/impayes')).json;
    assert.deepEqual([imp.resteFactureCentimes, imp.resteNonFactureCentimes, imp.nombre], [3000 + 3500, 0, 2]);
    assert.equal((await a.get('/api/indicateurs/synthese')).json.resteAEncaisser.montantCentimes, 6500);
    assert.equal((await a.get('/api/prestations?statut=facture&anciennete=0-29')).json.lignes.length, 2, 'le clic sur la tranche liste les mêmes lignes');
  }));

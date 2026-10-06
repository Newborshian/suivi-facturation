import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichir, etatPaiement } from '../../src/domain/paiement.js';

const ligne = (montantCentimes, versements = [], date = '2026-10-02') => ({
  montantCentimes,
  date,
  versements: versements.map((m, i) => ({ id: `v${i}`, montantCentimes: m, date, mode: 'cheque' })),
});

test('non payé : aucun versement (45 € -> reste 45 €)', () => {
  assert.deepEqual(etatPaiement(ligne(4500)), { verseCentimes: 0, payeCentimes: 0, resteCentimes: 4500, tropPercuCentimes: 0, etat: 'non_paye' });
});

test('partiellement payé : 20 € versés sur 45 € -> reste 25 €', () => {
  assert.deepEqual(etatPaiement(ligne(4500, [2000])), { verseCentimes: 2000, payeCentimes: 2000, resteCentimes: 2500, tropPercuCentimes: 0, etat: 'partiel' });
});

test('payé : versements cumulés égaux au montant, reste 0', () => {
  const e = etatPaiement(ligne(4500, [2000, 2500]));
  assert.equal(e.etat, 'paye');
  assert.equal(e.resteCentimes, 0);
  assert.equal(e.tropPercuCentimes, 0);
});

test('trop-perçu : payé, reste 0, surplus signalé ; la part utile au CA est plafonnée au montant', () => {
  assert.deepEqual(etatPaiement(ligne(25000, [30000])), { verseCentimes: 30000, payeCentimes: 25000, resteCentimes: 0, tropPercuCentimes: 5000, etat: 'paye' });
});

test('montant de 0 € : payé d\'office (vecteur de test 8)', () => {
  const e = etatPaiement(ligne(0));
  assert.equal(e.etat, 'paye');
  assert.equal(e.resteCentimes, 0);
});

test('exact au centime : 0,10 + 0,20 + 0,30 ne dérive pas (entiers)', () => {
  const e = etatPaiement(ligne(60, [10, 20, 30]));
  assert.equal(e.verseCentimes, 60);
  assert.equal(e.etat, 'paye');
  assert.equal(etatPaiement(ligne(61, [10, 20, 30])).resteCentimes, 1);
});

test('enrichir : aVenir seulement si la date est postérieure à aujourd\'hui ; la ligne d\'origine n\'est pas modifiée', () => {
  const l = ligne(4500, [], '2026-10-20');
  assert.equal(enrichir(l, '2026-10-02').aVenir, true);
  assert.equal(enrichir(l, '2026-10-20').aVenir, false);
  assert.equal(enrichir(l, '2026-10-21').aVenir, false);
  assert.equal('etat' in l, false);
  assert.equal(enrichir(l, '2026-10-02').etat, 'non_paye');
});

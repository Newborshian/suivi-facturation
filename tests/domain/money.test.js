import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONTANT_PRESTATION_MAX, estMontantPrestation, estMontantVersement, formaterCentimes } from '../../src/domain/money.js';

test('estMontantPrestation : entiers 0 à 100 000 EUR', () => {
  for (const ok of [0, 1, 4500, MONTANT_PRESTATION_MAX]) assert.equal(estMontantPrestation(ok), true, String(ok));
  for (const ko of [-1, MONTANT_PRESTATION_MAX + 1, 45.5, 0.1 + 0.2, NaN, Infinity, '4500', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(estMontantPrestation(ko), false, String(ko));
  }
});

test('estMontantVersement : 1 centime minimum', () => {
  assert.equal(estMontantVersement(1), true);
  assert.equal(estMontantVersement(0), false);
  assert.equal(estMontantVersement(-5), false);
  assert.equal(estMontantVersement(MONTANT_PRESTATION_MAX), true);
  assert.equal(estMontantVersement(MONTANT_PRESTATION_MAX + 1), false);
  assert.equal(estMontantVersement(12.5), false);
});

test('formaterCentimes : virgule, sans séparateur de milliers, calcul sur entiers', () => {
  assert.equal(formaterCentimes(0), '0,00');
  assert.equal(formaterCentimes(5), '0,05');
  assert.equal(formaterCentimes(4500), '45,00');
  assert.equal(formaterCentimes(125050), '1250,50');
  assert.equal(formaterCentimes(10_000_000), '100000,00');
  assert.equal(formaterCentimes(-250), '-2,50');
  assert.throws(() => formaterCentimes(45.5), TypeError);
  assert.throws(() => formaterCentimes('45'), TypeError);
});

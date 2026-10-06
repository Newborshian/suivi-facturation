import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajouterJours, ajouterMois, aujourdHuiLocal, ecartJours, estDateCivile, formaterDateFr, estMois, joursDansMois, moisDe, semaineIso } from '../../src/domain/dates.js';

test('estDateCivile : dates réelles seulement, années 2000-2100', () => {
  for (const ok of ['2026-10-02', '2028-02-29', '2000-01-01', '2100-12-31']) assert.equal(estDateCivile(ok), true, ok);
  for (const ko of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '1999-12-31', '2101-01-01', '2026-1-2', '2026-10-02T00:00', '', null, 20261002, undefined]) {
    assert.equal(estDateCivile(ko), false, String(ko));
  }
  assert.equal(estDateCivile('2100-02-29'), false); // 2100 n'est pas bissextile
  assert.equal(estDateCivile('2000-02-29'), true);
});

test('estMois et moisDe', () => {
  assert.equal(estMois('2026-10'), true);
  assert.equal(estMois('2026-13'), false);
  assert.equal(estMois('2026-10-01'), false);
  assert.equal(moisDe('2026-10-02'), '2026-10');
});

test('joursDansMois : fin de mois et années bissextiles', () => {
  assert.equal(joursDansMois(2026, 2), 28);
  assert.equal(joursDansMois(2028, 2), 29);
  assert.equal(joursDansMois(2026, 10), 31);
  assert.equal(joursDansMois(2026, 11), 30);
});

test('ecartJours : signé, et insensible au changement d\'heure', () => {
  assert.equal(ecartJours('2026-10-02', '2026-10-02'), 0);
  assert.equal(ecartJours('2026-09-02', '2026-10-02'), 30);
  assert.equal(ecartJours('2026-10-02', '2026-09-02'), -30);
  // passages à l'heure d'été / d'hiver (France) : toujours un nombre entier de jours
  assert.equal(ecartJours('2026-03-28', '2026-03-30'), 2);
  assert.equal(ecartJours('2026-10-24', '2026-10-26'), 2);
  assert.equal(ecartJours('2025-12-31', '2026-12-31'), 365);
  assert.equal(ecartJours('2027-12-31', '2028-12-31'), 366);
});

test('ajouterJours', () => {
  assert.equal(ajouterJours('2026-10-02', 0), '2026-10-02');
  assert.equal(ajouterJours('2026-10-31', 1), '2026-11-01');
  assert.equal(ajouterJours('2026-01-01', -1), '2025-12-31');
  assert.equal(ajouterJours('2028-02-28', 1), '2028-02-29');
});

test('ajouterMois : jour borné au dernier jour du mois d\'arrivée', () => {
  assert.equal(ajouterMois('2026-03-31', -1), '2026-02-28');
  assert.equal(ajouterMois('2028-03-31', -1), '2028-02-29');
  assert.equal(ajouterMois('2026-01-31', 1), '2026-02-28');
  assert.equal(ajouterMois('2026-10-02', -3), '2026-07-02');
  assert.equal(ajouterMois('2026-11-15', 3), '2027-02-15');
  assert.equal(ajouterMois('2026-01-15', -1), '2025-12-15');
  assert.equal(ajouterMois('2026-10-02', -11), '2025-11-02');
  assert.equal(ajouterMois('2026-10-02', 12), '2027-10-02');
});

test('semaineIso : vecteur d\'architecture et cas limites', () => {
  assert.equal(semaineIso('2026-12-31'), '2026-W53');
  assert.equal(semaineIso('2027-01-01'), '2026-W53');
  assert.equal(semaineIso('2026-10-02'), '2026-W40');
  assert.equal(semaineIso('2024-12-30'), '2025-W01'); // lundi : l'année ISO diffère de l'année civile
  assert.equal(semaineIso('2026-01-01'), '2026-W01');
  assert.equal(semaineIso('2026-01-04'), '2026-W01'); // dimanche
  assert.equal(semaineIso('2026-01-05'), '2026-W02'); // lundi
  assert.equal(semaineIso('2021-01-03'), '2020-W53');
});

test('aujourdHuiLocal : date locale du Date fourni', () => {
  assert.equal(aujourdHuiLocal(new Date(2026, 9, 2, 23, 59, 59)), '2026-10-02');
  assert.equal(aujourdHuiLocal(new Date(2026, 0, 5, 0, 0, 0)), '2026-01-05');
});

test('formaterDateFr : JJ/MM/AAAA', () => {
  assert.equal(formaterDateFr('2026-10-02'), '02/10/2026');
  assert.equal(formaterDateFr('2028-02-29'), '29/02/2028');
});

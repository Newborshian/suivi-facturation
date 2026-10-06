// Recette QA : montants en centimes (arrondis, 0 €, très grands montants, trop-perçu), validation des montants saisis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONTANT_PRESTATION_MAX, estMontantPrestation, estMontantVersement, formaterCentimes } from '../../src/domain/money.js';
import { enrichir, etatPaiement } from '../../src/domain/paiement.js';
import { validerCreation, validerVersement } from '../../src/domain/validation.js';
import { catalogueTest } from '../aides/catalogue-test.js';
import { diviserArrondi } from '../../src/domain/previsions.js';
import { alea, ligne } from './aides-qa.js';

const v = (montantCentimes, i = 0) => ({ id: `v${i}`, montantCentimes, date: '2026-10-02', mode: 'cheque' });

test('formaterCentimes : 0, 1 centime, 99 centimes, 100, très grand montant, jamais de séparateur de milliers', () => {
  assert.equal(formaterCentimes(0), '0,00');
  assert.equal(formaterCentimes(1), '0,01');
  assert.equal(formaterCentimes(9), '0,09');
  assert.equal(formaterCentimes(99), '0,99');
  assert.equal(formaterCentimes(100), '1,00');
  assert.equal(formaterCentimes(10_000_000), '100000,00');
  assert.equal(formaterCentimes(Number.MAX_SAFE_INTEGER), '90071992547409,91');
  assert.equal(formaterCentimes(-5), '-0,05');
  for (const mauvais of [0.5, 1.1, NaN, Infinity, '12', null, undefined]) assert.throws(() => formaterCentimes(mauvais), TypeError, String(mauvais));
});

test('somme de versements : 0,1 + 0,2 euro (10 + 20 centimes) vaut exactement 30 centimes, aucune dérive de virgule flottante', () => {
  const l = ligne(1, { montantCentimes: 30, versements: [v(10, 1), v(20, 2)] });
  const e = etatPaiement(l);
  assert.equal(e.verseCentimes, 30);
  assert.equal(e.resteCentimes, 0);
  assert.equal(e.etat, 'paye');
  // 1000 versements de 1 centime pour 10 euros : exactement payé, pas « partiel » à cause d'un arrondi
  const mille = ligne(2, { montantCentimes: 1000, versements: Array.from({ length: 1000 }, (_, i) => v(1, i)) });
  assert.equal(etatPaiement(mille).etat, 'paye');
  assert.equal(etatPaiement(mille).resteCentimes, 0);
  const neufCentNeufNeuf = ligne(3, { montantCentimes: 1000, versements: Array.from({ length: 999 }, (_, i) => v(1, i)) });
  assert.equal(etatPaiement(neufCentNeufNeuf).etat, 'partiel');
  assert.equal(etatPaiement(neufCentNeufNeuf).resteCentimes, 1);
});

test('prestation à 0 € : payée d\'office, reste 0, pas de trop-perçu ; un versement de 1 centime sur 0 € est un trop-perçu de 1 centime', () => {
  const zero = etatPaiement(ligne(1, { montantCentimes: 0 }));
  assert.deepEqual(zero, { verseCentimes: 0, payeCentimes: 0, resteCentimes: 0, tropPercuCentimes: 0, etat: 'paye' });
  const un = etatPaiement(ligne(2, { montantCentimes: 0, versements: [v(1)] }));
  assert.equal(un.tropPercuCentimes, 1);
  assert.equal(un.payeCentimes, 0);
  assert.equal(un.etat, 'paye');
});

test('très grands montants : 100 000 € accepté, 100 000,01 € refusé ; 10 000 lignes au plafond restent des entiers exacts', () => {
  assert.equal(estMontantPrestation(MONTANT_PRESTATION_MAX), true);
  assert.equal(estMontantPrestation(MONTANT_PRESTATION_MAX + 1), false);
  assert.equal(estMontantVersement(MONTANT_PRESTATION_MAX), true);
  assert.equal(estMontantVersement(MONTANT_PRESTATION_MAX + 1), false);
  assert.equal(estMontantVersement(0), false);
  assert.equal(estMontantPrestation(0), true);
  const lignes = Array.from({ length: 10_000 }, (_, i) => ligne(i, { montantCentimes: MONTANT_PRESTATION_MAX, versements: [v(MONTANT_PRESTATION_MAX, i)] }));
  const total = lignes.reduce((s, l) => s + etatPaiement(l).payeCentimes, 0);
  assert.equal(total, 10_000 * MONTANT_PRESTATION_MAX);
  assert.ok(Number.isSafeInteger(total));
});

test('trop-perçu : plafonné à la ligne, ne compense jamais une autre ligne, payé <= montant', () => {
  const a = etatPaiement(ligne(1, { montantCentimes: 4500, versements: [v(5000)] }));
  assert.equal(a.payeCentimes, 4500);
  assert.equal(a.tropPercuCentimes, 500);
  assert.equal(a.resteCentimes, 0);
  const b = etatPaiement(ligne(2, { montantCentimes: 4500, versements: [] }));
  assert.equal(b.resteCentimes, 4500, 'le trop-perçu de la ligne a ne réduit pas le reste de la ligne b');
});

test('propriété (5 000 lignes aléatoires) : payé + reste = montant, 0 <= payé <= montant, reste >= 0, trop-perçu >= 0, état cohérent', () => {
  const r = alea(42);
  for (let i = 0; i < 5000; i++) {
    const montant = Math.floor(r() * 3) === 0 ? 0 : Math.floor(r() * 20000);
    const nb = Math.floor(r() * 4);
    const l = ligne(i, { montantCentimes: montant, versements: Array.from({ length: nb }, (_, k) => v(1 + Math.floor(r() * 15000), k)) });
    const e = etatPaiement(l);
    assert.equal(e.payeCentimes + e.resteCentimes, montant);
    assert.ok(e.payeCentimes >= 0 && e.payeCentimes <= montant);
    assert.ok(e.resteCentimes >= 0 && e.tropPercuCentimes >= 0);
    assert.equal(e.payeCentimes + e.tropPercuCentimes, e.verseCentimes);
    if (e.etat === 'paye') assert.equal(e.resteCentimes, 0);
    if (e.etat === 'non_paye') assert.equal(e.verseCentimes, 0);
    if (e.etat === 'partiel') assert.ok(e.verseCentimes > 0 && e.resteCentimes > 0);
    assert.equal(enrichir(l, '2026-10-02').aVenir, l.date > '2026-10-02');
  }
});

test('diviserArrondi : moitiés vers le haut, résultats exacts sur les cas qui trompent un calcul flottant', () => {
  assert.equal(diviserArrondi(1, 2), 1); // 0,5 -> 1
  assert.equal(diviserArrondi(5, 10), 1);
  assert.equal(diviserArrondi(4, 10), 0);
  assert.equal(diviserArrondi(330_000, 3), 110_000);
  assert.equal(diviserArrondi(110_000 * 21, 31), 74_516);
  assert.equal(diviserArrondi(10_000_000 * 3, 3), 10_000_000);
  assert.equal(diviserArrondi(0, 31), 0);
});

// ------------------------------------------------------------------ validation des montants saisis (corps d'API)

const cat = catalogueTest();
const creation = (montantCentimes) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes });
const refuse = (montantCentimes) => assert.throws(() => validerCreation(creation(montantCentimes), cat), (e) => e.status === 422 && 'montantCentimes' in e.champs, `montant ${String(montantCentimes)} (${typeof montantCentimes})`);

test('validation du montant de prestation : entiers de 0 à 10 000 000 acceptés ; tout le reste refusé en 422 avec le champ désigné', () => {
  for (const ok of [0, 1, 4500, MONTANT_PRESTATION_MAX]) assert.equal(validerCreation(creation(ok), cat).montantCentimes, ok);
  for (const mauvais of [-1, -0, 0.5, 45.5, 4500.0001, MONTANT_PRESTATION_MAX + 1, 2 ** 53, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, '4500', '45,50', '', null, undefined, true, [], {}, [4500]]) {
    if (Object.is(mauvais, -0)) continue; // -0 === 0 : accepté comme 0 (sans effet)
    refuse(mauvais);
  }
});

test('validation du versement : montant >= 1 centime et <= 100 000 € ; date réelle ; mode de la liste', () => {
  const ok = { montantCentimes: 1, date: '2026-10-02', mode: 'carte' };
  assert.deepEqual(validerVersement(ok), ok);
  for (const m of [0, -1, 1.5, '10', NaN, null, MONTANT_PRESTATION_MAX + 1]) assert.throws(() => validerVersement({ ...ok, montantCentimes: m }), (e) => e.status === 422 && 'montantCentimes' in e.champs, String(m));
  for (const d of ['2026-02-29', '2026-13-01', '2026-00-10', '10/02/2026', '2026-10-2', '', null, 20261002, '1999-12-31', '2101-01-01']) {
    assert.throws(() => validerVersement({ ...ok, date: d }), (e) => e.status === 422 && 'date' in e.champs, String(d));
  }
  for (const mo of ['Carte', 'cb', 'bitcoin', '', null, 3, 'cheque ']) assert.throws(() => validerVersement({ ...ok, mode: mo }), (e) => e.status === 422 && 'mode' in e.champs, String(mo));
});

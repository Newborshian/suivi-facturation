// Affichage du mode de paiement dans la liste des prestations (fonctions pures) : fonctions pures de public/js/format.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libellesModes, listeModesPaiement, resumePaiement } from '../../public/js/format.js';

const v = (mode, date) => ({ id: `v-${mode}-${date}`, montantCentimes: 1000, date, mode });
const ligne = (etat, versements) => ({ etat, versements });

test('aucun versement : aucun mode', () => {
  assert.deepEqual(libellesModes([]), []);
  assert.deepEqual(libellesModes(undefined), []);
  assert.deepEqual(resumePaiement(ligne('non_paye', [])), { modes: '', aria: 'Non payé' });
});

test('un versement : payé par virement', () => {
  assert.deepEqual(resumePaiement(ligne('paye', [v('virement', '2026-10-01')])), { modes: 'Virement', aria: 'Payé en totalité par virement' });
});

test('partiellement payé : mode du versement', () => {
  assert.deepEqual(resumePaiement(ligne('partiel', [v('especes', '2026-10-01')])), { modes: 'Espèces', aria: 'Partiellement payé par espèces' });
});

test('deux versements de modes différents : ordre chronologique, séparés par « + »', () => {
  const r = resumePaiement(ligne('paye', [v('virement', '2026-10-05'), v('especes', '2026-10-01')]));
  assert.equal(r.modes, 'Espèces + Virement');
  assert.equal(r.aria, 'Payé en totalité par espèces et virement');
});

test('ordre chronologique et non alphabétique ; trois modes', () => {
  const r = resumePaiement(ligne('paye', [v('virement', '2026-10-01'), v('cheque', '2026-10-02'), v('carte', '2026-10-03')]));
  assert.equal(r.modes, 'Virement + Chèque + Carte bancaire');
  assert.equal(r.aria, 'Payé en totalité par virement, chèque et carte bancaire');
});

test('même jour : ordre de saisie conservé', () => {
  assert.deepEqual(libellesModes([v('cheque', '2026-10-01'), v('especes', '2026-10-01')]), ['Chèque', 'Espèces']);
});

test('modes répétés : sans doublon, rang du premier versement de chaque mode', () => {
  const r = resumePaiement(ligne('paye', [v('virement', '2026-10-01'), v('especes', '2026-10-02'), v('virement', '2026-10-03'), v('especes', '2026-10-04')]));
  assert.equal(r.modes, 'Virement + Espèces');
});

test('le tableau reçu n\'est pas modifié (tri sur une copie)', () => {
  const entree = [v('virement', '2026-10-05'), v('especes', '2026-10-01')];
  libellesModes(entree);
  assert.deepEqual(entree.map((x) => x.mode), ['virement', 'especes']);
});

test('trop-perçu : l\'état reste « payé » et les modes s\'affichent', () => {
  const r = resumePaiement({ etat: 'paye', tropPercuCentimes: 500, versements: [v('cheque', '2026-10-01'), v('cheque', '2026-10-02')] });
  assert.deepEqual(r, { modes: 'Chèque', aria: 'Payé en totalité par chèque' });
});

test('prestation à 0 € payée d\'office, sans versement : pas de mode', () => {
  assert.deepEqual(resumePaiement(ligne('paye', [])), { modes: '', aria: 'Payé en totalité' });
});

test('mode inconnu ou absent : « Autre », sans doublon avec un « autre » réel', () => {
  assert.deepEqual(libellesModes([v('bitcoin', '2026-10-01')]), ['Autre']);
  assert.deepEqual(libellesModes([{ date: '2026-10-01' }, v('autre', '2026-10-02')]), ['Autre']);
  assert.deepEqual(libellesModes([v('__proto__', '2026-10-01'), v('toString', '2026-10-02')]), ['Autre']);
  assert.deepEqual(libellesModes([null, undefined]), ['Autre']);
});

test('non payé : aucun mode, même si des données incohérentes sont présentes', () => {
  assert.deepEqual(resumePaiement(ligne('non_paye', [v('cheque', '2026-10-01')])), { modes: '', aria: 'Non payé' });
});

test('aucun nom de patient dans le résultat', () => {
  const r = resumePaiement({ etat: 'paye', patient: { nom: 'Dupont', prenom: 'Léa' }, versements: [v('virement', '2026-10-01')] });
  assert.ok(!JSON.stringify(r).includes('Dupont') && !JSON.stringify(r).includes('Léa'));
});

test('listeModesPaiement : liste de libellés (0, 1, 2, 3 modes), vide si non payé', () => {
  assert.deepEqual(listeModesPaiement(ligne('paye', [])), []);
  assert.deepEqual(listeModesPaiement(ligne('non_paye', [v('cheque', '2026-10-01')])), []);
  assert.deepEqual(listeModesPaiement(ligne('paye', [v('virement', '2026-10-01')])), ['Virement']);
  assert.deepEqual(listeModesPaiement(ligne('paye', [v('virement', '2026-10-01'), v('cheque', '2026-10-02')])), ['Virement', 'Chèque']);
  assert.deepEqual(listeModesPaiement(ligne('partiel', [v('especes', '2026-10-03'), v('carte', '2026-10-01'), v('cheque', '2026-10-02')])), ['Carte bancaire', 'Chèque', 'Espèces']);
  assert.deepEqual(listeModesPaiement(ligne('paye', [v('cheque', '2026-10-01'), v('cheque', '2026-10-02'), v('bitcoin', '2026-10-03')])), ['Chèque', 'Autre']);
  assert.deepEqual(listeModesPaiement(undefined), []);
});

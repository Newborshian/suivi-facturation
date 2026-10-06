import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lignesAMarquer, lignesAMarquerDuMois } from '../../public/js/recap-regles.js';

const ligne = (id, o = {}) => ({ id, statut: 'a_facturer', aVenir: false, montantCentimes: 4500, ...o });

test('« Marquer facturé » (règle commune) : à facturer et échues, y compris à 0 € ; les prestations à venir et déjà facturées sont écartées', () => {
  const lignes = [ligne('a'), ligne('zero', { montantCentimes: 0 }), ligne('futur', { aVenir: true }), ligne('futur-zero', { aVenir: true, montantCentimes: 0 }), ligne('fait', { statut: 'facture' })];
  const r = lignesAMarquer(lignes);
  assert.deepEqual(r.concernees.map((l) => l.id), ['a', 'zero'], 'la prestation échue à 0 € est incluse');
  assert.equal(r.aVenir, 2, 'nombre de lignes à venir laissées de côté, pour le message');
  assert.deepEqual(lignesAMarquer([ligne('f', { statut: 'facture', aVenir: true })]), { concernees: [], aVenir: 0 });
});

test('« tout le mois » et « un patient » appliquent la même règle', () => {
  const entree = { lignes: [ligne('a'), ligne('futur', { aVenir: true }), ligne('zero', { montantCentimes: 0 })] };
  const autre = { lignes: [ligne('b')] };
  assert.deepEqual(lignesAMarquerDuMois([entree, autre]).map((l) => l.id), ['a', 'zero', 'b']);
  assert.deepEqual(lignesAMarquer(entree.lignes).concernees.map((l) => l.id), ['a', 'zero']);
});

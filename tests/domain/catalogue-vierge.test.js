// Catalogue vierge par défaut : un fichier créé neuf n'a aucune prestation ; le catalogue fictif ne sert qu'au jeu d'exemple et aux tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlerStructure, creerEtatInitial } from '../../src/domain/schema.js';
import { catalogueExemple, genererExemple } from '../../src/exemple.js';
import { catalogueTest } from '../aides/catalogue-test.js';

test('état initial : catalogue vide (aucun tarif livré par défaut), structure valide', () => {
  const e = creerEtatInitial(new Date('2026-10-04T08:00:00.000Z'));
  assert.deepEqual(e.catalogue, []);
  assert.deepEqual(e.prestations, []);
  assert.deepEqual(controlerStructure(e), []);
});

test('états initiaux successifs : catalogues indépendants (aucun tableau partagé)', () => {
  const a = creerEtatInitial(new Date('2026-10-04T08:00:00.000Z'));
  a.catalogue.push({ id: 'x', libelle: 'X', tarifCentimes: 1, categorie: 'autre', actif: true, ordre: 1 });
  assert.deepEqual(creerEtatInitial(new Date('2026-10-04T08:00:00.000Z')).catalogue, []);
});

test('catalogue fictif de l\'exemple : 6 prestations génériques aux tarifs inventés (centimes)', () => {
  const c = catalogueExemple();
  assert.deepEqual(c.map((p) => [p.libelle, p.tarifCentimes]), [
    ['Séance individuelle 30 min', 4200],
    ['Séance individuelle 45 min', 5800],
    ['Séance à domicile 45 min', 6800],
    ['Bilan initial', 17000],
    ['Compte rendu', 2800],
    ['Réunion de synthèse', 5200],
  ]);
  assert.equal(new Set(c.map((p) => p.id)).size, 6);
  assert.ok(c.every((p) => p.actif === true && Number.isSafeInteger(p.tarifCentimes)));
});

test('catalogue fictif : catégories existantes (séance / bilan / autre) et ordre', () => {
  const c = catalogueExemple();
  assert.deepEqual(c.map((p) => p.categorie), ['seance', 'seance', 'seance', 'bilan', 'autre', 'autre']);
  assert.deepEqual(c.map((p) => p.ordre), [1, 2, 3, 4, 5, 6]);
});

test('catalogue fictif : chaque appel renvoie une copie indépendante ; le jeu d\'exemple et les tests utilisent le même', () => {
  const a = catalogueExemple();
  a[0].tarifCentimes = 1;
  assert.equal(catalogueExemple()[0].tarifCentimes, 4200);
  assert.deepEqual(catalogueTest(), catalogueExemple());
  assert.deepEqual(genererExemple().catalogue, catalogueExemple());
});

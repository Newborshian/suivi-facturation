import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION_COURANTE, controlerStructure, creerEtatInitial, migrer } from '../../src/domain/schema.js';
import { genererExemple } from '../../src/exemple.js';

const maintenant = new Date('2026-10-02T07:14:03.120Z');

test('état initial : valide, version courante, catalogue vide, aucune prestation', () => {
  const e = creerEtatInitial(maintenant);
  assert.deepEqual(controlerStructure(e), []);
  assert.equal(e.schemaVersion, VERSION_COURANTE);
  assert.equal(e.revision, 0);
  assert.deepEqual(e.catalogue, []);
  assert.deepEqual(e.prestations, []);
  assert.equal(e.parametres.sauvegardesConservees, 30);
});

test('controlerStructure : refuse les structures invalides (sans valeur de donnée dans le message)', () => {
  const base = () => genererExemple();
  const cas = [
    ['format', (e) => { e.format = 'autre'; }],
    ['montant non entier', (e) => { e.prestations[0].montantCentimes = 45.5; }],
    ['montant négatif', (e) => { e.prestations[0].montantCentimes = -1; }],
    ['date invalide', (e) => { e.prestations[0].date = '2026-02-30'; }],
    ['statut inconnu', (e) => { e.prestations[0].statut = 'paye'; }],
    ['catégorie inconnue', (e) => { e.prestations[0].categorie = 'x'; }],
    ['id en double', (e) => { e.prestations[1].id = e.prestations[0].id; }],
    ['versement à 0', (e) => { e.prestations.find((p) => p.versements.length).versements[0].montantCentimes = 0; }],
    ['mode inconnu', (e) => { e.prestations.find((p) => p.versements.length).versements[0].mode = 'bitcoin'; }],
    ['catalogue en double', (e) => { e.catalogue[1].id = e.catalogue[0].id; }],
    ['tarif flottant', (e) => { e.catalogue[0].tarifCentimes = 10.5; }],
    ['prestations absentes', (e) => { delete e.prestations; }],
    ['paramètres invalides', (e) => { e.parametres.sauvegardesConservees = 0; }],
    ['mode de paiement mémorisé invalide', (e) => { e.parametres.dernierModePaiement = 'x'; }],
    ['patient sans nom', (e) => { e.prestations[0].patient.nom = ''; }],
  ];
  for (const [nom, alterer] of cas) {
    const e = base();
    alterer(e);
    const pb = controlerStructure(e);
    assert.ok(pb.length > 0, `${nom} aurait dû être refusé`);
    assert.ok(pb.every((m) => !m.includes('Lapin') && !m.includes('Pierre')), 'aucune donnée nominative dans les messages');
  }
  assert.ok(controlerStructure(null).length > 0);
  assert.ok(controlerStructure([]).length > 0);
});

test('migrer : applique les étapes successives sur une copie, ne modifie pas l\'original', () => {
  const migrations = {
    1: (e) => ({ ...e, ajoutV2: true }),
    2: (e) => ({ ...e, ajoutV3: true }),
  };
  const v1 = { schemaVersion: 1, donnees: [1] };
  const v3 = migrer(v1, migrations, 3);
  assert.equal(v3.schemaVersion, 3);
  assert.equal(v3.ajoutV2, true);
  assert.equal(v3.ajoutV3, true);
  assert.equal(v1.schemaVersion, 1);
  assert.equal('ajoutV2' in v1, false);
});

test('migrer : version courante inchangée, version plus récente ou étape manquante = erreur', () => {
  assert.equal(migrer({ schemaVersion: 1 }, {}, 1).schemaVersion, 1);
  assert.throws(() => migrer({ schemaVersion: 5 }, {}, 1), /plus récente/);
  assert.throws(() => migrer({ schemaVersion: 1 }, {}, 2), /Aucune migration/);
});

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

test('état initial : registre des patients vide, version 2', () => {
  assert.deepEqual(creerEtatInitial(maintenant).patients, []);
  assert.equal(VERSION_COURANTE, 2);
});

test('structure version 2 : registre absent, id vide ou en double, nom ou prénom vide, actif non booléen -> refusés', () => {
  const cas = [
    ['registre absent', (e) => { delete e.patients; }, /patients invalide/],
    ['registre pas un tableau', (e) => { e.patients = {}; }, /patients invalide/],
    ['entrée pas un objet', (e) => { e.patients[0] = 'x'; }, /patients\[0\] invalide/],
    ['id vide', (e) => { e.patients[0].id = ' '; }, /patients\[0\]\.id/],
    ['id en double', (e) => { e.patients[1].id = e.patients[0].id; }, /patients\[1\]\.id/],
    ['nom vide', (e) => { e.patients[0].nom = ''; }, /patients\[0\]\.nom/],
    ['prénom vide', (e) => { e.patients[0].prenom = '   '; }, /patients\[0\]\.prenom/],
    ['prénom absent', (e) => { delete e.patients[0].prenom; }, /patients\[0\]\.prenom/],
    ['actif texte', (e) => { e.patients[0].actif = 'true'; }, /patients\[0\]\.actif/],
    ['actif absent', (e) => { delete e.patients[0].actif; }, /patients\[0\]\.actif/],
  ];
  for (const [nom, alterer, attendu] of cas) {
    const e = genererExemple();
    alterer(e);
    const pb = controlerStructure(e);
    assert.ok(pb.some((m) => attendu.test(m)), `${nom} : ${pb.join(' / ')}`);
    assert.ok(pb.every((m) => !m.includes('Lapin') && !m.includes('Cygne')), 'aucune donnée nominative dans les messages');
  }
});

test("structure version 2 : registre vide accepté, champ inconnu d'un patient toléré, ligne orpheline ou copie divergente = structure valide", () => {
  const e = genererExemple();
  assert.deepEqual(controlerStructure({ ...e, patients: [] }), [], 'registre vide');
  e.patients[0].couleur = 'bleu';
  assert.deepEqual(controlerStructure(e), []);
  e.prestations[0].patient = { id: 'inconnu', nom: 'Renard', prenom: 'Goupil' };
  e.prestations[1].patient = { ...e.prestations[1].patient, nom: 'AUTRE' };
  assert.deepEqual(controlerStructure(e), [], 'tolérées : signalées par compterIncoherencesPatients, jamais refusées');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE, creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { horlogeFixe } from '../aides/horloge.js';
import { controlerStructure } from '../../src/domain/schema.js';
import { ecartJours, moisDe } from '../../src/domain/dates.js';
import { genererExemple } from '../../src/exemple.js';
import { ouvrirStore } from '../../src/store/store.js';

const REF = '2026-10-02';
const chemin = path.join(RACINE, 'config', 'exemple.json');

function etatPaiement(p) {
  const verse = p.versements.reduce((s, v) => s + v.montantCentimes, 0);
  return verse >= p.montantCentimes ? 'paye' : verse === 0 ? 'non_paye' : 'partiel';
}

test('config/exemple.json : identique à la sortie du générateur (régénérer avec la commande de src/exemple.js)', async () => {
  const fichier = JSON.parse(await fs.readFile(chemin, 'utf8'));
  assert.deepEqual(fichier, genererExemple());
});

test('génération déterministe : même graine, même résultat ; autre graine, autre résultat', () => {
  assert.deepEqual(genererExemple({ graine: 7 }), genererExemple({ graine: 7 }));
  assert.notDeepEqual(genererExemple({ graine: 7 }), genererExemple({ graine: 8 }));
});

test('jeu d\'exemple : structure valide, ids uniques (contrôlé par controlerStructure)', () => {
  assert.deepEqual(controlerStructure(genererExemple()), []);
});

test('jeu d\'exemple : couvre les cas attendus du jeu d\'exemple', () => {
  const e = genererExemple();
  const p = e.prestations;
  assert.ok(new Set(p.map((x) => x.patient.id)).size >= 3, 'plusieurs patients');
  assert.deepEqual([...new Set(p.map((x) => x.prestationId))].sort(), e.catalogue.map((c) => c.id).sort(), 'tous les types de prestation');
  assert.deepEqual([...new Set(p.map(etatPaiement))].sort(), ['non_paye', 'partiel', 'paye']);
  assert.ok(p.some((x) => etatPaiement(x) === 'partiel' && x.versements.length >= 2), 'un partiel à versements multiples');
  assert.deepEqual([...new Set(p.map((x) => x.statut))].sort(), ['a_facturer', 'facture']);
  assert.ok(new Set(p.map((x) => moisDe(x.date))).size >= 12, 'au moins 12 mois');
  assert.ok(p.some((x) => x.date > REF), 'une prestation à date future');
  const cles = p.map((x) => `${x.patient.id}|${x.date}|${x.prestationId}`);
  assert.ok(cles.some((c, i) => cles.indexOf(c) !== i), 'un doublon potentiel');
  assert.ok(p.some((x) => x.statut === 'facture' && x.versements.length === 0 && ecartJours(x.factureLe, REF) >= 90), 'un impayé de plus de 90 jours');
});

test('jeu d\'exemple : aucun montant de versement au-delà du dû, factureLe cohérent avec le statut', () => {
  for (const x of genererExemple().prestations) {
    assert.ok(x.versements.reduce((s, v) => s + v.montantCentimes, 0) <= x.montantCentimes);
    assert.equal(x.statut === 'facture', x.factureLe !== null);
  }
});

test('jeu d\'exemple : se charge dans un dossier temporaire et s\'ouvre dans le store (jamais data/)', async () => {
  const dossier = await creerDossierTemp('exemple');
  try {
    await fs.copyFile(chemin, path.join(dossier, 'suivi-facturation.json'));
    const store = await ouvrirStore({ dossier, horloge: horlogeFixe(REF) });
    assert.equal(store.etat().modeDegrade, false);
    assert.equal(store.lire().prestations.length, genererExemple().prestations.length);
    assert.ok(!dossier.startsWith(path.join(RACINE, 'data') + path.sep), 'hors de data/');
  } finally {
    await supprimerDossierTemp(dossier);
  }
});

test('jeu d\'exemple : aucun nom ne ressemble à une donnée réelle (liste fermée de personnages)', () => {
  const noms = new Set(genererExemple().prestations.map((x) => `${x.patient.nom} ${x.patient.prenom}`));
  assert.deepEqual([...noms].sort(), ['Hérisson Sonic', 'Lapin Pierre', 'Ours Baloo', 'Renard Goupil', 'Souris Stuart', 'Tortue Franklin']);
});

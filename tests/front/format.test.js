import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correspondPatient,
  formatDate,
  formatDateCourte,
  formatDateHeure,
  formatInstant,
  formatTaille,
  LIBELLES_CATEGORIE,
  libelleTranche,
  montantDernierVersement,
  LIBELLES_RAISON,
  formatEuros,
  formatMois,
  formatMontantSaisie,
  lireMontant,
  normaliserRecherche,
  pluriel,
  totaliserLignes,
} from '../../public/js/format.js';

const NBSP = ' ';

test('formatEuros : virgule, deux décimales, espace insécable avant €, séparateur de milliers', () => {
  assert.equal(formatEuros(4500), `45,00${NBSP}€`);
  assert.equal(formatEuros(5), `0,05${NBSP}€`);
  assert.equal(formatEuros(0), `0,00${NBSP}€`);
  assert.equal(formatEuros(125050).replace(/[  ]/g, ' '), '1 250,50 €');
  assert.equal(formatEuros(10_000_000).replace(/[  ]/g, ' '), '100 000,00 €');
  assert.equal(formatEuros(-250), `-2,50${NBSP}€`);
  assert.equal(formatEuros(45.5), '—', 'un flottant n\'est pas un montant en centimes');
  assert.equal(formatEuros(undefined), '—');
});

test('formatEuros : exact au centime, sans passer par des flottants (99 999 999 centimes)', () => {
  assert.equal(formatEuros(99_999_999).replace(/[  ]/g, ' '), '999 999,99 €');
  assert.equal(formatEuros(1).replace(/[  ]/g, ' '), '0,01 €');
});

test('formatMontantSaisie : valeur d\'un champ de saisie', () => {
  assert.equal(formatMontantSaisie(4500), '45,00');
  assert.equal(formatMontantSaisie(3505), '35,05');
  assert.equal(formatMontantSaisie(0), '0,00');
  assert.equal(formatMontantSaisie(null), '');
});

test('lireMontant : « 1 250,50 », « 45 », « 45.5 », espaces insécables, symbole €', () => {
  assert.deepEqual(lireMontant('1 250,50'), { ok: true, centimes: 125050 });
  assert.deepEqual(lireMontant('1 250,50'), { ok: true, centimes: 125050 });
  assert.deepEqual(lireMontant('1 250,50 €'), { ok: true, centimes: 125050 });
  assert.deepEqual(lireMontant('45'), { ok: true, centimes: 4500 });
  assert.deepEqual(lireMontant('45.5'), { ok: true, centimes: 4550 });
  assert.deepEqual(lireMontant('45,5'), { ok: true, centimes: 4550 });
  assert.deepEqual(lireMontant('45,05'), { ok: true, centimes: 4505 });
  assert.deepEqual(lireMontant('0'), { ok: true, centimes: 0 });
  assert.deepEqual(lireMontant('0,01'), { ok: true, centimes: 1 });
  assert.deepEqual(lireMontant(' 12 '), { ok: true, centimes: 1200 });
});

test('lireMontant : pas de dérive flottante (19,99 -> 1999, 0,29 -> 29, 1,15 -> 115)', () => {
  assert.equal(lireMontant('19,99').centimes, 1999);
  assert.equal(lireMontant('0,29').centimes, 29);
  assert.equal(lireMontant('1,15').centimes, 115);
  assert.equal(lireMontant('4.35').centimes, 435);
});

test('lireMontant : vide, texte, négatif, plus de 2 décimales, séparateurs multiples refusés', () => {
  assert.deepEqual(lireMontant(''), { ok: false, raison: 'vide' });
  assert.deepEqual(lireMontant('   '), { ok: false, raison: 'vide' });
  assert.deepEqual(lireMontant(undefined), { ok: false, raison: 'vide' });
  for (const ko of ['abc', '-3', '-0,5', '45,555', '1,2,3', '4 5a', '1.250,50', '12e3', '--', ',5', '5,', '1234567890', '+5']) {
    assert.deepEqual(lireMontant(ko), { ok: false, raison: 'invalide' }, ko);
  }
});

test('formatDate, formatDateCourte, formatMois', () => {
  assert.equal(formatDate('2026-10-12'), '12/10/2026');
  assert.equal(formatDate('n\'importe quoi'), '');
  assert.equal(formatDateCourte('2026-10-12', 2026), '12/10');
  assert.equal(formatDateCourte('2025-12-31', 2026), '31/12/2025');
  assert.equal(formatMois('2026-10'), 'octobre 2026');
  assert.equal(formatMois('2026-02'), 'février 2026');
  assert.equal(formatMois('2026-12'), 'décembre 2026');
  assert.equal(formatMois('2026-13'), '');
});

test('recherche patient : partielle, insensible à la casse et aux accents, nom ou prénom', () => {
  const p = { nom: 'Dupont', prenom: 'Léa' };
  assert.equal(correspondPatient(p, 'dup'), true);
  assert.equal(correspondPatient(p, 'DUP'), true);
  assert.equal(correspondPatient(p, 'lea'), true);
  assert.equal(correspondPatient(p, 'léa'), true);
  assert.equal(correspondPatient(p, 'dupont lea'), true);
  assert.equal(correspondPatient(p, 'léa dupont'), true);
  assert.equal(correspondPatient(p, '  '), true);
  assert.equal(correspondPatient(p, ''), true);
  assert.equal(correspondPatient(p, 'martin'), false);
  assert.equal(correspondPatient(p, 'lea pont'), false, 'les morceaux ne se recollent pas dans le désordre');
  assert.equal(normaliserRecherche('  ÉLISE   Martin '), 'elise martin');
});

test('totaliserLignes : somme exacte en centimes ; pluriel', () => {
  const t = totaliserLignes([
    { montantCentimes: 4500, payeCentimes: 2000, resteCentimes: 2500 },
    { montantCentimes: 3500, payeCentimes: 0, resteCentimes: 3500 },
  ]);
  assert.deepEqual(t, { nombre: 2, montantCentimes: 8000, payeCentimes: 2000, resteCentimes: 6000 });
  assert.deepEqual(totaliserLignes([]), { nombre: 0, montantCentimes: 0, payeCentimes: 0, resteCentimes: 0 });
  assert.equal(pluriel(0, 'prestation'), '0 prestation');
  assert.equal(pluriel(1, 'prestation'), '1 prestation');
  assert.equal(pluriel(12, 'prestation'), '12 prestations');
});

// --- Sauvegardes et paramètres ---

test('formatTaille : octets, Ko, Mo (affichage seulement)', () => {
  const nbsp = '\u00a0';
  assert.equal(formatTaille(0), '0 octet');
  assert.equal(formatTaille(1), '1 octet');
  assert.equal(formatTaille(812), '812 octets');
  assert.equal(formatTaille(1024), `1${nbsp}Ko`);
  assert.equal(formatTaille(12_345), `12,1${nbsp}Ko`);
  assert.equal(formatTaille(1024 * 1024), `1${nbsp}Mo`);
  assert.equal(formatTaille(1_234_567), `1,2${nbsp}Mo`);
  for (const invalide of [-1, NaN, null, undefined, 'x']) assert.equal(formatTaille(invalide), '—');
});

test('formatDateHeure : « 01/10/2026 à 09:14 », sans les secondes', () => {
  assert.equal(formatDateHeure('2026-10-01', '09:14:03'), '01/10/2026 à 09:14');
  assert.equal(formatDateHeure('2026-10-01', '23:59:59'), '01/10/2026 à 23:59');
  assert.equal(formatDateHeure('2026-10-01', undefined), '01/10/2026');
  assert.equal(formatDateHeure('n importe quoi', '09:14:03'), '');
});

test('formatInstant : instant ISO -> JJ/MM/AAAA HH:MM (heure locale) ; invalide -> vide', () => {
  assert.match(formatInstant('2026-10-02T09:14:03.120Z'), /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  assert.equal(formatInstant('pas une date'), '');
  assert.equal(formatInstant(undefined), '');
});

test('libellés des raisons de sauvegarde et des catégories : toutes les raisons connues du serveur sont traduites, sans jargon', async () => {
  const { RAISONS_OPERATION, RAISONS_QUOTIDIENNES } = await import('../../src/store/sauvegardes.js');
  for (const raison of [...RAISONS_QUOTIDIENNES, ...RAISONS_OPERATION]) {
    assert.ok(LIBELLES_RAISON[raison], `libellé manquant pour « ${raison} »`);
    assert.doesNotMatch(LIBELLES_RAISON[raison], /json|migration|schema/i);
  }
  assert.deepEqual(Object.keys(LIBELLES_CATEGORIE), ['seance', 'bilan', 'autre']);
});

test('LIBELLES_RAISON ne contient que des raisons que le serveur peut produire', async () => {
  const { RAISONS_CONSERVEES, RAISONS_OPERATION, RAISONS_QUOTIDIENNES } = await import('../../src/store/sauvegardes.js');
  const connues = new Set([...RAISONS_QUOTIDIENNES, ...RAISONS_OPERATION, ...RAISONS_CONSERVEES]);
  for (const raison of Object.keys(LIBELLES_RAISON)) assert.ok(connues.has(raison), `raison inconnue du serveur : ${raison}`);
});

test('montantDernierVersement : le montant réellement enregistré (dernier versement renvoyé), sinon le repli', () => {
  const prestation = { versements: [{ montantCentimes: 1000 }, { montantCentimes: 3200 }] };
  assert.equal(montantDernierVersement(prestation, 4500), 3200, 'le reste connu de la page (4500) ne doit pas être annoncé');
  assert.equal(formatEuros(montantDernierVersement(prestation, 4500)), formatEuros(3200));
  assert.equal(montantDernierVersement({ versements: [] }, 4500), 4500);
  assert.equal(montantDernierVersement(undefined, 4500), 4500);
  assert.equal(montantDernierVersement({ versements: [{ montantCentimes: 'x' }] }, 4500), 4500);
});

test('libelleTranche : texte après « depuis » tiré de la liste du serveur ; identifiant inconnu -> null', () => {
  const tranches = [{ id: '0-29', libelle: 'Moins de 30 jours' }, { id: '90-plus', libelle: '90 jours et plus' }];
  assert.equal(libelleTranche(tranches, '0-29'), 'moins de 30 jours');
  assert.equal(libelleTranche(tranches, '90-plus'), '90 jours et plus');
  assert.equal(libelleTranche(tranches, '15-20'), null);
  assert.equal(libelleTranche(undefined, '0-29'), null);
  assert.equal(libelleTranche([], '0-29'), null);
});

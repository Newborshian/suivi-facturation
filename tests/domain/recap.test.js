import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aFacturerGlobal, etatDepuisTotaux, moisProposes, recapMensuel } from '../../src/domain/recap.js';
import { validerParametresRecap } from '../../src/domain/validation.js';

let n = 0;
const P = (id, nom, prenom) => ({ id, nom, prenom });
const lapin = P('p-lapin', 'Lapin', 'Pierre');
const ours = P('p-ours', 'Ours', 'Baloo');
const tortue = P('p-tortue', 'Tortue', 'Franklin');

/** Prestation factice ; `versements` = [[centimes, date], ...]. */
function ligne(patient, date, montantCentimes, { categorie = 'seance', statut = 'a_facturer', versements = [], libelle = 'Séance individuelle 45 min' } = {}) {
  n += 1;
  return {
    id: `l${n}`,
    patient,
    date,
    prestationId: 'x',
    libelle,
    categorie,
    motif: '',
    montantCentimes,
    statut,
    factureLe: statut === 'facture' ? date : null,
    versements: versements.map(([m, d], i) => ({ id: `v${n}-${i}`, montantCentimes: m, date: d, mode: 'cheque' })),
    creeLe: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
    modifieLe: '2026-01-01T00:00:00.000Z',
  };
}
const A = '2026-10-02';
const recap = (prestations, options = {}) => recapMensuel(prestations, { mois: '2026-10', aujourdHui: A, ...options });

test('vecteur 1 : 45 + 45 + 35 € dont 45 € versés -> 3 séances, dû 125 €, payé 45 €, reste 80 €', () => {
  const r = recap([
    ligne(lapin, '2026-10-01', 4500, { versements: [[4500, '2026-10-01']] }),
    ligne(lapin, '2026-10-08', 4500),
    ligne(lapin, '2026-10-15', 3500),
  ]);
  const [e] = r.patients;
  assert.equal(e.nbPrestations, 3);
  assert.equal(e.nbSeances, 3);
  assert.equal(e.duCentimes, 12500);
  assert.equal(e.payeCentimes, 4500);
  assert.equal(e.resteCentimes, 8000);
  assert.equal(e.etat, 'partiel');
  assert.deepEqual(r.total, { nbPatients: 1, nbPrestations: 3, nbSeances: 3, nbAutres: 0, nbAFacturer: 3, nbAVenir: 2, duCentimes: 12500, payeCentimes: 4500, resteCentimes: 8000, tropPercuCentimes: 0, etat: 'partiel' });
});

test('séances = catégorie « séance » seulement ; bilan et autres prestations comptés à part', () => {
  const r = recap([
    ligne(lapin, '2026-10-01', 4500),
    ligne(lapin, '2026-10-02', 25000, { categorie: 'bilan', libelle: 'Bilan initial' }),
    ligne(lapin, '2026-10-03', 6000, { categorie: 'autre', libelle: 'Réunion de synthèse' }),
  ]);
  const [e] = r.patients;
  assert.equal(e.nbSeances, 1);
  assert.equal(e.nbAutres, 2);
  assert.equal(e.nbPrestations, 3);
  assert.equal(e.duCentimes, 35500);
});

test('une ligne par patient, triée par nom puis prénom (accents compris), total général = somme des lignes', () => {
  const zoe = P('p-z', 'Étienne', 'Zoé');
  const r = recap([
    ligne(tortue, '2026-10-01', 3500),
    ligne(zoe, '2026-10-01', 4500),
    ligne(ours, '2026-10-01', 4500),
    ligne(lapin, '2026-10-01', 4500),
  ]);
  assert.deepEqual(r.patients.map((e) => e.patient.nom), ['Étienne', 'Lapin', 'Ours', 'Tortue']);
  assert.equal(r.total.nbPatients, 4);
  assert.equal(r.total.duCentimes, 17000);
  assert.equal(r.total.duCentimes, r.patients.reduce((s, e) => s + e.duCentimes, 0));
});

test('invariant : dû = payé + reste pour chaque patient et pour le total (vue prestation)', () => {
  const r = recap([
    ligne(lapin, '2026-10-01', 4500, { versements: [[2000, '2026-10-01']] }),
    ligne(lapin, '2026-10-02', 3500, { versements: [[3500, '2026-10-02']] }),
    ligne(ours, '2026-10-02', 25000, { statut: 'facture', versements: [[30000, '2026-10-05']] }),
    ligne(tortue, '2026-10-02', 0),
  ]);
  for (const e of [...r.patients, r.total]) assert.equal(e.duCentimes, e.payeCentimes + e.resteCentimes);
});

test('trop-perçu : payé plafonné au montant, surplus signalé à part, jamais compensé avec une autre ligne', () => {
  const r = recap([
    ligne(ours, '2026-10-01', 25000, { versements: [[30000, '2026-10-01']] }),
    ligne(ours, '2026-10-02', 4500),
  ]);
  const [e] = r.patients;
  assert.equal(e.payeCentimes, 25000);
  assert.equal(e.tropPercuCentimes, 5000);
  assert.equal(e.resteCentimes, 4500, 'le trop-perçu ne réduit pas le reste de l\'autre prestation');
  assert.equal(e.etat, 'partiel');
});

test('acompte : 20 € versés sur 45 € -> payé 20 €, reste 25 €, état partiel', () => {
  const [e] = recap([ligne(lapin, '2026-10-01', 4500, { versements: [[2000, '2026-10-01']] })]).patients;
  assert.equal(e.payeCentimes, 2000);
  assert.equal(e.resteCentimes, 2500);
  assert.equal(e.etat, 'partiel');
});

test('état du patient dérivé des totaux : payé / non payé / partiel ; montant 0 € payé d\'office', () => {
  assert.equal(etatDepuisTotaux({ duCentimes: 4500, payeCentimes: 4500, resteCentimes: 0 }), 'paye');
  assert.equal(etatDepuisTotaux({ duCentimes: 4500, payeCentimes: 0, resteCentimes: 4500 }), 'non_paye');
  assert.equal(etatDepuisTotaux({ duCentimes: 4500, payeCentimes: 1, resteCentimes: 4499 }), 'partiel');
  assert.equal(etatDepuisTotaux({ duCentimes: 0, payeCentimes: 0, resteCentimes: 0 }), 'paye');
  const [e] = recap([ligne(lapin, '2026-10-01', 0)]).patients;
  assert.equal(e.etat, 'paye');
  assert.equal(e.duCentimes, 0);
  assert.equal(e.nbSeances, 1, 'une séance à 0 € reste une séance');
});

test('mois vide : aucun patient, totaux à zéro ; les autres mois sont exclus', () => {
  const r = recap([ligne(lapin, '2026-09-30', 4500), ligne(lapin, '2026-11-01', 4500)]);
  assert.deepEqual(r.patients, []);
  assert.equal(r.total.nbPatients, 0);
  assert.equal(r.total.duCentimes, 0);
  assert.equal(recap([]).patients.length, 0);
});

test('changement de mois et d\'année : 31/12 et 01/01 ne se mélangent pas ; 29/02 d\'une année bissextile appartient à février', () => {
  const lignes = [ligne(lapin, '2026-12-31', 4500), ligne(lapin, '2027-01-01', 3500), ligne(lapin, '2028-02-29', 4500), ligne(lapin, '2028-03-01', 1000)];
  assert.equal(recapMensuel(lignes, { mois: '2026-12', aujourdHui: A }).total.duCentimes, 4500);
  assert.equal(recapMensuel(lignes, { mois: '2027-01', aujourdHui: A }).total.duCentimes, 3500);
  assert.equal(recapMensuel(lignes, { mois: '2028-02', aujourdHui: A }).total.duCentimes, 4500);
  assert.equal(recapMensuel(lignes, { mois: '2026-01', aujourdHui: A }).patients.length, 0);
});

test('prestation à date future : comptée dans le mois, marquée à venir ; le calcul ne dépend que de « aujourd\'hui » fourni', () => {
  const lignes = [ligne(lapin, '2026-10-02', 4500), ligne(lapin, '2026-10-03', 4500)];
  assert.equal(recap(lignes).total.nbAVenir, 1);
  assert.equal(recapMensuel(lignes, { mois: '2026-10', aujourdHui: '2026-10-31' }).total.nbAVenir, 0);
  assert.equal(recap(lignes).patients[0].lignes[1].aVenir, true);
  assert.equal(recap(lignes).total.duCentimes, 9000);
});

test('patient sans séance (bilan seul) : 0 séance, 1 autre ; deux homonymes (ids différents) restent deux lignes', () => {
  const a = P('id-a', 'Lapin', 'Pierre');
  const b = P('id-b', 'Lapin', 'Pierre');
  const r = recap([ligne(a, '2026-10-01', 25000, { categorie: 'bilan' }), ligne(b, '2026-10-02', 4500)]);
  assert.equal(r.patients.length, 2);
  assert.equal(r.patients[0].nbSeances + r.patients[1].nbSeances, 1);
  assert.equal(r.patients.find((e) => e.patient.id === 'id-a').nbSeances, 0);
  assert.equal(r.patients.find((e) => e.patient.id === 'id-a').nbAutres, 1);
});

test('nom affiché = celui de la ligne la plus récente du patient (le renommage ne crée pas de doublon)', () => {
  const ancien = { id: 'p-r', nom: 'Dupond', prenom: 'Léa' };
  const nouveau = { id: 'p-r', nom: 'Dupont', prenom: 'Léa' };
  const r = recap([ligne(ancien, '2026-10-01', 4500), ligne(nouveau, '2026-10-05', 4500)]);
  assert.equal(r.patients.length, 1);
  assert.equal(r.patients[0].patient.nom, 'Dupont');
});

test('à facturer : compte les lignes du mois non facturées ; les facturées n\'y sont pas', () => {
  const r = recap([ligne(lapin, '2026-10-01', 4500, { statut: 'facture' }), ligne(lapin, '2026-10-02', 4500)]);
  assert.equal(r.patients[0].nbAFacturer, 1);
});

test('centimes entiers : sommes exactes sur de nombreuses petites lignes', () => {
  const lignes = [];
  for (let i = 0; i < 1000; i++) lignes.push(ligne(lapin, '2026-10-01', 10, { versements: [[10, '2026-10-01']] }));
  const r = recap(lignes);
  assert.equal(r.total.duCentimes, 10000);
  assert.equal(r.total.payeCentimes, 10000);
  assert.equal(r.total.resteCentimes, 0);
});

// ----------------------------------------------------------------- double vue

test('double vue : un règlement d\'octobre sur une prestation de septembre compte en versement d\'octobre', () => {
  const lignes = [ligne(lapin, '2026-09-20', 4500, { versements: [[4500, '2026-10-03']] }), ligne(lapin, '2026-10-01', 3500)];
  const parPrestation = recap(lignes);
  assert.equal(parPrestation.total.duCentimes, 3500);
  assert.equal(parPrestation.total.payeCentimes, 0);
  const parVersement = recap(lignes, { vue: 'versement' });
  assert.equal(parVersement.total.duCentimes, 3500, 'le dû reste celui des prestations du mois');
  assert.equal(parVersement.total.payeCentimes, 4500, 'encaissé : le versement du mois, sur la prestation de septembre');
  assert.equal(parVersement.patients[0].versements.length, 1);
  assert.equal(parVersement.patients[0].versements[0].datePrestation, '2026-09-20');
  assert.equal(parVersement.total.resteCentimes, null);
  assert.equal(parVersement.total.tropPercuCentimes, null);
  assert.equal(parVersement.patients[0].etat, null);
});

test('double vue : un versement de novembre sur une prestation d\'octobre est payé en vue prestation, absent de la trésorerie d\'octobre', () => {
  const lignes = [ligne(lapin, '2026-10-01', 4500, { versements: [[4500, '2026-11-02']] })];
  assert.equal(recap(lignes).total.payeCentimes, 4500);
  const v = recap(lignes, { vue: 'versement' });
  assert.equal(v.total.payeCentimes, 0);
  assert.equal(v.patients.length, 1, 'le patient reste listé (prestation du mois)');
  assert.equal(recapMensuel(lignes, { mois: '2026-11', vue: 'versement', aujourdHui: A }).total.payeCentimes, 4500);
});

test('double vue : patient présent seulement par un versement ; trop-perçu inclus dans l\'encaissé', () => {
  const lignes = [ligne(ours, '2026-08-10', 4500, { versements: [[2000, '2026-10-01'], [3000, '2026-10-20']] })];
  const v = recap(lignes, { vue: 'versement' });
  assert.equal(v.patients.length, 1);
  assert.equal(v.patients[0].nbPrestations, 0);
  assert.equal(v.patients[0].lignes.length, 0);
  assert.equal(v.patients[0].payeCentimes, 5000, 'argent réellement reçu, trop-perçu compris');
  assert.deepEqual(v.patients[0].versements.map((x) => x.date), ['2026-10-01', '2026-10-20']);
});

test('double vue : changement d\'année (versement du 02/01 sur une prestation du 31/12) ; acompte réparti sur deux mois', () => {
  const lignes = [ligne(lapin, '2026-12-31', 4500, { versements: [[1500, '2026-12-31'], [3000, '2027-01-02']] })];
  const dec = recapMensuel(lignes, { mois: '2026-12', vue: 'versement', aujourdHui: '2027-01-05' });
  const jan = recapMensuel(lignes, { mois: '2027-01', vue: 'versement', aujourdHui: '2027-01-05' });
  assert.equal(dec.total.payeCentimes, 1500);
  assert.equal(jan.total.payeCentimes, 3000);
  assert.equal(jan.total.duCentimes, 0);
  assert.equal(recapMensuel(lignes, { mois: '2026-12', aujourdHui: '2027-01-05' }).total.payeCentimes, 4500, 'vue prestation : tout ce qui a été versé');
});

test('double vue : mois vide dans la vue versement ; vue inconnue refusée', () => {
  assert.equal(recap([], { vue: 'versement' }).patients.length, 0);
  assert.throws(() => recap([], { vue: 'autre' }), RangeError);
});

test('la vue prestation ne remplit pas la liste des versements', () => {
  const r = recap([ligne(lapin, '2026-10-01', 4500, { versements: [[4500, '2026-10-01']] })]);
  assert.deepEqual(r.patients[0].versements, []);
});

// -------------------------------------------------------------- À facturer

test('À facturer tous mois confondus ; à venir compté à part ; facturées ignorées ; 0 -> tout est facturé', () => {
  const lignes = [
    ligne(lapin, '2026-08-01', 4500),
    ligne(lapin, '2026-09-01', 3500),
    ligne(ours, '2026-10-02', 4500),
    ligne(ours, '2026-10-03', 4500), // à venir
    ligne(ours, '2026-10-01', 4500, { statut: 'facture' }),
  ];
  assert.deepEqual(aFacturerGlobal(lignes, A), { nombre: 3, montantCentimes: 12500, aVenirNombre: 1, aVenirMontantCentimes: 4500, zeroNombre: 0 });
  assert.deepEqual(aFacturerGlobal([ligne(lapin, '2026-10-01', 4500, { statut: 'facture' })], A), { nombre: 0, montantCentimes: 0, aVenirNombre: 0, aVenirMontantCentimes: 0, zeroNombre: 0 });
  assert.deepEqual(aFacturerGlobal([], A), { nombre: 0, montantCentimes: 0, aVenirNombre: 0, aVenirMontantCentimes: 0, zeroNombre: 0 });
});

test('à facturer : une prestation à 0 € non facturée ne compte pas (ni à venir) et n\'empêche pas « Tout est facturé »', () => {
  const zeroPasse = ligne(lapin, '2026-10-01', 0);
  const zeroAVenir = ligne(lapin, '2026-10-20', 0);
  assert.deepEqual(aFacturerGlobal([zeroPasse, zeroAVenir], A), { nombre: 0, montantCentimes: 0, aVenirNombre: 0, aVenirMontantCentimes: 0, zeroNombre: 2 });
  assert.deepEqual(aFacturerGlobal([zeroPasse, ligne(lapin, '2026-10-01', 4500)], A), { nombre: 1, montantCentimes: 4500, aVenirNombre: 0, aVenirMontantCentimes: 0, zeroNombre: 1 });
  assert.equal(aFacturerGlobal([ligne(lapin, '2026-10-01', 0, { statut: 'facture' })], A).zeroNombre, 0, 'une ligne à 0 € déjà facturée n\'est pas dénombrée');
});

test('mois proposés : mois avec prestations + mois en cours + mois demandé, triés, sans doublon', () => {
  const lignes = [ligne(lapin, '2026-09-01', 1), ligne(lapin, '2026-09-15', 1)];
  assert.deepEqual(moisProposes(lignes, A, '2026-07'), ['2026-07', '2026-09', '2026-10']);
});

test('mois proposés en vue « versement » : les mois qui n\'ont que des versements sont aussi proposés (pas en vue « prestation »)', () => {
  const lignes = [ligne(lapin, '2026-08-20', 9000, { versements: [[4500, '2026-09-05'], [4500, '2026-11-02']] })];
  assert.deepEqual(moisProposes(lignes, A, '2026-10', 'versement'), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(moisProposes(lignes, A, '2026-10', 'prestation'), ['2026-08', '2026-10']);
  assert.deepEqual(moisProposes(lignes, A, '2026-10'), ['2026-08', '2026-10'], 'vue par défaut : prestation');
});

// ------------------------------------------------------------------ validation

test('paramètres du récapitulatif : mois par défaut = mois en cours, vue par défaut = prestation ; valeurs invalides refusées', () => {
  assert.deepEqual(validerParametresRecap(new URLSearchParams(''), A), { mois: '2026-10', vue: 'prestation' });
  assert.deepEqual(validerParametresRecap(new URLSearchParams('mois=2027-01&vue=versement'), A), { mois: '2027-01', vue: 'versement' });
  for (const q of ['mois=2026-13', 'mois=2026-1', 'mois=1999-12', 'mois=2026-10-01', 'mois=', 'vue=autre', 'vue=', 'patient=Lapin']) {
    assert.throws(() => validerParametresRecap(new URLSearchParams(q), A), (e) => e.status === 400, q);
  }
});

// Reconstruction du registre (migration 1 -> 2 et réparation) et invariants I1/I2 du registre face aux opérations du domaine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogueTest } from '../aides/catalogue-test.js';
import { clePatient, modifierPatient, reconstruireRegistre, supprimerPatient } from '../../src/domain/patients.js';
import { creerPrestation, modifierPrestation, supprimerPrestation } from '../../src/domain/prestations.js';
import { compterIncoherencesPatients, controlerStructure, creerEtatInitial } from '../../src/domain/schema.js';

const l = (id, patientId, nom, prenom, date, extra = {}) => ({
  id,
  patient: { id: patientId, nom, prenom },
  date,
  creeLe: `${date}T10:00:00.000Z`,
  modifieLe: `${date}T11:00:00.000Z`,
  ...extra,
});

test('reconstruction : aucune prestation -> registre vide', () => {
  const r = reconstruireRegistre([]);
  assert.deepEqual(r, { patients: [], prestations: [], patientsAjoutes: 0, copiesAlignees: 0 });
});

test('reconstruction : un patient actif par identifiant, trié nom, prénom ; lignes identiques quand les copies concordent', () => {
  const lignes = [l('a', 'p2', 'Ours', 'Baloo', '2026-09-01'), l('b', 'p1', 'Lapin', 'Pierre', '2026-09-02'), l('c', 'p1', 'Lapin', 'Pierre', '2026-09-03')];
  const r = reconstruireRegistre(lignes);
  assert.deepEqual(r.patients, [
    { id: 'p1', nom: 'Lapin', prenom: 'Pierre', actif: true },
    { id: 'p2', nom: 'Ours', prenom: 'Baloo', actif: true },
  ]);
  assert.equal(r.patientsAjoutes, 2);
  assert.equal(r.copiesAlignees, 0);
  assert.ok(r.prestations.every((x, i) => x === lignes[i]), 'lignes non copiées quand rien ne change');
});

test('reconstruction : homonymes (deux identifiants, même clé) -> deux patients distincts', () => {
  const r = reconstruireRegistre([l('a', 'p1', 'Lapin', 'Pierre', '2026-09-01'), l('b', 'p2', 'Lapin', 'Pierre', '2026-09-02')]);
  assert.deepEqual(r.patients.map((p) => p.id), ['p1', 'p2']);
  assert.equal(clePatient(r.patients[0].nom, r.patients[0].prenom), clePatient(r.patients[1].nom, r.patients[1].prenom));
});

test('reconstruction : même identifiant écrit « dupont » puis « Dupont » -> écriture de la ligne la plus récente, copies alignées, modifieLe intact', () => {
  const lignes = [l('a', 'p1', 'dupont', 'jean', '2026-08-01'), l('b', 'p1', 'Dupont', 'Jean', '2026-09-14'), l('c', 'p1', 'DUPONT', ' jean ', '2026-07-01')];
  const r = reconstruireRegistre(lignes);
  assert.deepEqual(r.patients, [{ id: 'p1', nom: 'Dupont', prenom: 'Jean', actif: true }]);
  assert.equal(r.copiesAlignees, 2);
  assert.ok(r.prestations.every((x) => x.patient.nom === 'Dupont' && x.patient.prenom === 'Jean'));
  assert.deepEqual(r.prestations.map((x) => x.modifieLe), lignes.map((x) => x.modifieLe));
  assert.equal(lignes[0].patient.nom, 'dupont', 'entrée non modifiée (fonction pure)');
});

test('reconstruction : à date égale, la ligne créée en dernier fait référence', () => {
  const r = reconstruireRegistre([
    l('a', 'p1', 'lapin', 'pierre', '2026-09-01', { creeLe: '2026-09-01T08:00:00.000Z' }),
    l('b', 'p1', 'Lapin', 'Pierre', '2026-09-01', { creeLe: '2026-09-01T09:00:00.000Z' }),
  ]);
  assert.equal(r.patients[0].nom, 'Lapin');
});

test('reconstruction : même identifiant, clés différentes (retouche manuelle) -> un patient, ligne la plus récente, autres copies non alignées et signalées', () => {
  const lignes = [l('a', 'p1', 'Lapin', 'Pierre', '2026-09-14'), l('b', 'p1', 'Ours', 'Baloo', '2026-08-01')];
  const r = reconstruireRegistre(lignes);
  assert.equal(r.patients.length, 1);
  assert.equal(r.patients[0].nom, 'Lapin');
  assert.equal(r.copiesAlignees, 0);
  assert.equal(r.prestations[1].patient.nom, 'Ours');
  const etat = { patients: r.patients, prestations: r.prestations };
  assert.deepEqual(compterIncoherencesPatients(etat), { orphelines: 0, copiesDivergentes: 1 });
});

test('reconstruction : idempotente, ne touche pas un patient déjà au registre (même archivé), complète seulement les manquants', () => {
  const lignes = [l('a', 'p1', 'lapin', 'pierre', '2026-09-01'), l('b', 'p2', 'Ours', 'Baloo', '2026-09-02')];
  const registre = [{ id: 'p1', nom: 'Lapin', prenom: 'Pierre', actif: false }];
  const r1 = reconstruireRegistre(lignes, registre);
  assert.deepEqual(r1.patients, [
    { id: 'p1', nom: 'Lapin', prenom: 'Pierre', actif: false },
    { id: 'p2', nom: 'Ours', prenom: 'Baloo', actif: true },
  ]);
  assert.equal(r1.patientsAjoutes, 1);
  assert.equal(r1.copiesAlignees, 1);
  assert.equal(registre.length, 1, 'registre reçu non modifié');
  const r2 = reconstruireRegistre(r1.prestations, r1.patients);
  assert.deepEqual(r2.patients, r1.patients);
  assert.equal(r2.patientsAjoutes + r2.copiesAlignees, 0);
});

test('reconstruction : lignes sans patient exploitable ignorées sans planter (le contrôle de structure les refuse ensuite)', () => {
  const r = reconstruireRegistre([{ id: 'a', date: '2026-09-01' }, l('b', '', 'X', 'Y', '2026-09-01'), l('c', 'p1', 'Lapin', 'Pierre', '2026-09-01')]);
  assert.deepEqual(r.patients.map((p) => p.id), ['p1']);
});

test('incohérences : ligne orpheline et copie divergente comptées, structure valide', () => {
  const etat = creerEtatInitial(new Date('2026-10-02T09:00:00Z'));
  etat.patients = [{ id: 'p1', nom: 'Lapin', prenom: 'Pierre', actif: true }];
  etat.prestations = [
    { ...ligneMinimale('a', 'p1', 'Lapin', 'Pierre') },
    { ...ligneMinimale('b', 'p9', 'Renard', 'Goupil') },
    { ...ligneMinimale('c', 'p1', 'lapin', 'Pierre') },
  ];
  assert.deepEqual(controlerStructure(etat), []);
  assert.deepEqual(compterIncoherencesPatients(etat), { orphelines: 1, copiesDivergentes: 1 });
  assert.deepEqual(compterIncoherencesPatients({}), { orphelines: 0, copiesDivergentes: 0 });
});

function ligneMinimale(id, patientId, nom, prenom) {
  return {
    id,
    patient: { id: patientId, nom, prenom },
    date: '2026-09-01',
    prestationId: 'seance-45',
    libelle: 'x',
    categorie: 'seance',
    motif: '',
    montantCentimes: 4500,
    statut: 'a_facturer',
    factureLe: null,
    versements: [],
    creeLe: '2026-09-01T08:00:00.000Z',
    modifieLe: '2026-09-01T08:00:00.000Z',
  };
}

// ---- invariants I1 / I2 / I3 après une suite d'opérations tirées d'une graine fixe ----

function aleatoire(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function verifierInvariants(etat, contexte) {
  assert.deepEqual(controlerStructure(etat), [], `${contexte} : structure`);
  assert.deepEqual(compterIncoherencesPatients(etat), { orphelines: 0, copiesDivergentes: 0 }, `${contexte} : I1 et I2`);
  assert.equal(new Set(etat.patients.map((p) => p.id)).size, etat.patients.length, `${contexte} : I3`);
  const tri = [...etat.patients].sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr') || a.id.localeCompare(b.id));
  assert.deepEqual(etat.patients, tri, `${contexte} : registre trié`);
}

test('invariant : après des centaines d\'opérations aléatoires (graine fixe), chaque ligne reste conforme au registre', () => {
  const alea = aleatoire(20261008);
  const choisir = (tab) => tab[Math.floor(alea() * tab.length)];
  const NOMS = [['Lapin', 'Pierre'], ['lapin', 'PIERRE'], ['Ours', 'Baloo'], ['Cygne', 'Léa'], ['Renard', 'Goupil'], ['Souris', 'Stuart']];
  const etat = creerEtatInitial(new Date('2026-10-02T09:00:00Z'));
  etat.catalogue = catalogueTest();
  let compteur = 0;
  const ctx = () => ({ aujourdHui: '2026-10-02', maintenant: `2026-10-02T09:${String(compteur % 60).padStart(2, '0')}:00.000Z`, nouvelId: () => `id-${++compteur}` });
  const essayer = (fn) => {
    const copie = structuredClone(etat);
    try {
      fn();
    } catch (e) {
      assert.ok(e.status >= 400 && e.status < 500, `erreur applicative attendue, reçu ${e.message}`);
      Object.assign(etat, copie); // une opération refusée ne laisse aucune trace partielle
    }
  };
  for (let i = 0; i < 400; i += 1) {
    const [nom, prenom] = choisir(NOMS);
    const action = Math.floor(alea() * 8);
    const ligne = etat.prestations.length ? choisir(etat.prestations) : null;
    essayer(() => {
      if (action <= 1 || !ligne) {
        creerPrestation(etat, { patient: { nom, prenom }, nouveauPatient: alea() < 0.15, date: '2026-09-15', prestationId: 'seance-45', montantCentimes: 4500 }, ctx());
      } else if (action === 2) {
        modifierPrestation(etat, ligne.id, { modifieLe: ligne.modifieLe, patient: { nom, prenom }, renommerPatient: alea() < 0.5, detacherLigne: false }, ctx());
      } else if (action === 3) {
        modifierPrestation(etat, ligne.id, { modifieLe: ligne.modifieLe, patient: { nom, prenom }, detacherLigne: true }, ctx());
      } else if (action === 4) {
        modifierPatient(etat, choisir(etat.patients).id, { nom, prenom, homonyme: alea() < 0.5 }, ctx());
      } else if (action === 5) {
        modifierPatient(etat, choisir(etat.patients).id, { actif: alea() < 0.5 }, ctx());
      } else if (action === 6) {
        supprimerPrestation(etat, ligne.id);
      } else {
        supprimerPatient(etat, choisir(etat.patients).id);
      }
    });
    verifierInvariants(etat, `opération ${i}`);
  }
  assert.ok(etat.patients.length > 1 && etat.prestations.length > 1, 'la suite a bien produit des données');
});

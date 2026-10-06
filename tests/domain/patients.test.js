import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clePatient, listerPatients, normaliserTexte, resoudrePatient } from '../../src/domain/patients.js';

let n = 0;
const nouvelId = () => `nouveau-${++n}`;
const ligne = (idPatient, nom, prenom, date, creeLe = `${date}T10:00:00.000Z`) => ({ patient: { id: idPatient, nom, prenom }, date, creeLe });

test('clé : insensible à la casse et aux espaces, sensible aux accents', () => {
  assert.equal(clePatient('dupont', 'jean'), clePatient('  DUPONT ', 'Jean'));
  assert.equal(clePatient('Le   Roux', 'Anne Marie'), clePatient('le roux', 'anne  marie'));
  assert.notEqual(clePatient('Lapin', 'Léa'), clePatient('Lapin', 'Lea'));
  assert.equal(normaliserTexte('  a   b '), 'a b');
  assert.equal(clePatient('E\u0301lise', 'x'), clePatient('\u00c9lise', 'x'), 'NFC : é composé ou décomposé');
});

test('listerPatients : un patient par id, nom de la ligne la plus récente, tri nom puis prénom', () => {
  const l = listerPatients([
    ligne('p2', 'Ours', 'Baloo', '2026-09-01'),
    ligne('p1', 'Lapin', 'pierre', '2026-08-01'),
    ligne('p1', 'Lapin', 'Pierre', '2026-09-14'),
    ligne('p1', 'Lapin', 'P.', '2026-07-01'),
  ]);
  assert.deepEqual(l, [
    { id: 'p1', nom: 'Lapin', prenom: 'Pierre', dernierePrestation: '2026-09-14' },
    { id: 'p2', nom: 'Ours', prenom: 'Baloo', dernierePrestation: '2026-09-01' },
  ]);
});

test('résolution : nouveau patient si aucune clé identique', () => {
  const r = resoudrePatient([ligne('p1', 'Lapin', 'Pierre', '2026-09-14')], { nom: ' Ours ', prenom: 'Baloo' }, nouvelId);
  assert.match(r.patient.id, /^nouveau-/);
  assert.deepEqual([r.patient.nom, r.patient.prenom], ['Ours', 'Baloo']);
  assert.deepEqual(r.avertissements, []);
});

test('résolution : rattachement automatique à l\'existant ; avertissement seulement si l\'écriture diffère', () => {
  const lignes = [ligne('p1', 'Lapin', 'Pierre', '2026-09-14')];
  const identique = resoudrePatient(lignes, { nom: 'Lapin', prenom: 'Pierre' }, nouvelId);
  assert.equal(identique.patient.id, 'p1');
  assert.deepEqual(identique.avertissements, []);
  const autreCasse = resoudrePatient(lignes, { nom: 'lapin ', prenom: 'PIERRE' }, nouvelId);
  assert.equal(autreCasse.patient.id, 'p1');
  assert.equal(autreCasse.avertissements[0].code, 'PATIENT_RATTACHE');
});

test('résolution : homonymes déjà distingués -> 409 avec les candidats (id et date, sans nom)', () => {
  const lignes = [ligne('p1', 'Lapin', 'Pierre', '2026-09-14'), ligne('p2', 'Lapin', 'Pierre', '2026-10-01')];
  assert.throws(
    () => resoudrePatient(lignes, { nom: 'Lapin', prenom: 'Pierre' }, nouvelId),
    (e) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, 'PATIENTS_HOMONYMES');
      assert.deepEqual(e.details.candidats, [{ id: 'p1', dernierePrestation: '2026-09-14' }, { id: 'p2', dernierePrestation: '2026-10-01' }]);
      assert.ok(!JSON.stringify(e.details).includes('Lapin'));
      return true;
    },
  );
});

test('résolution : nouveauPatient crée un homonyme assumé ; patientId choisit un candidat', () => {
  const lignes = [ligne('p1', 'Lapin', 'Pierre', '2026-09-14')];
  const homonyme = resoudrePatient(lignes, { nom: 'Lapin', prenom: 'Pierre', nouveau: true }, nouvelId);
  assert.notEqual(homonyme.patient.id, 'p1');
  assert.equal(resoudrePatient(lignes, { patientId: 'p1' }, nouvelId).patient.nom, 'Lapin');
  assert.throws(() => resoudrePatient(lignes, { patientId: 'inconnu' }, nouvelId), (e) => e.status === 422 && Boolean(e.champs.patientId));
});

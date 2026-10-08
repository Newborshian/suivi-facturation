// Registre des patients (schéma version 2) : clé de comparaison, liste, résolution, opérations pures du domaine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assurerAuRegistre,
  clePatient,
  creerPatient,
  listerPatients,
  modifierPatient,
  normaliserTexte,
  renommerPatient,
  reparerPatients,
  resoudrePatient,
  supprimerPatient,
} from '../../src/domain/patients.js';

let n = 0;
const ctx = (extra = {}) => ({ aujourdHui: '2026-10-02', maintenant: '2026-10-02T09:00:00.000Z', nouvelId: () => `nouveau-${++n}`, ...extra });
const ligne = (idPatient, nom, prenom, date, extra = {}) => ({
  id: `l-${++n}`,
  patient: { id: idPatient, nom, prenom },
  date,
  creeLe: `${date}T10:00:00.000Z`,
  modifieLe: `${date}T10:00:00.000Z`,
  montantCentimes: 4500,
  versements: [{ id: `v-${++n}`, montantCentimes: 4500, date, mode: 'cheque' }],
  ...extra,
});
const patient = (id, nom, prenom, actif = true) => ({ id, nom, prenom, actif });
const etat = (patients, prestations = []) => ({ patients, prestations });
const erreur = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return assert.fail('aucune erreur levée');
};

test('clé : insensible à la casse et aux espaces, sensible aux accents', () => {
  assert.equal(clePatient('dupont', 'jean'), clePatient('  DUPONT ', 'Jean'));
  assert.equal(clePatient('Le   Roux', 'Anne Marie'), clePatient('le roux', 'anne  marie'));
  assert.notEqual(clePatient('Lapin', 'Léa'), clePatient('Lapin', 'Lea'));
  assert.equal(normaliserTexte('  a   b '), 'a b');
  assert.equal(clePatient('Élise', 'x'), clePatient('Élise', 'x'), 'NFC : é composé ou décomposé');
});

test('listerPatients : depuis le registre, patients sans prestation compris, tri nom puis prénom', () => {
  const e = etat(
    [patient('p2', 'Ours', 'Baloo'), patient('p1', 'Lapin', 'Pierre'), patient('p3', 'Cygne', 'Léa', false)],
    [ligne('p2', 'Ours', 'Baloo', '2026-09-01'), ligne('p1', 'Lapin', 'Pierre', '2026-08-01'), ligne('p1', 'Lapin', 'Pierre', '2026-09-14')],
  );
  assert.deepEqual(listerPatients(e), [
    { id: 'p3', nom: 'Cygne', prenom: 'Léa', actif: false, nombrePrestations: 0, dernierePrestation: null, homonyme: false, supprimable: true },
    { id: 'p1', nom: 'Lapin', prenom: 'Pierre', actif: true, nombrePrestations: 2, dernierePrestation: '2026-09-14', homonyme: false, supprimable: false },
    { id: 'p2', nom: 'Ours', prenom: 'Baloo', actif: true, nombrePrestations: 1, dernierePrestation: '2026-09-01', homonyme: false, supprimable: false },
  ]);
});

test('listerPatients : homonymes signalés (calculé), suppression refusée si utilisé dans une archive ou si une archive est illisible', () => {
  const e = etat([patient('p1', 'Lapin', 'Pierre'), patient('p2', ' lapin', 'PIERRE'), patient('p3', 'Ours', 'Baloo')]);
  const l = listerPatients(e, { utilisesArchives: { ids: new Set(['p3']), illisibles: false } });
  assert.deepEqual(l.map((p) => [p.id, p.homonyme, p.supprimable]).sort(), [['p1', true, true], ['p2', true, true], ['p3', false, false]]);
  assert.ok(listerPatients(e, { utilisesArchives: { ids: new Set(), illisibles: true } }).every((p) => !p.supprimable));
  assert.ok(!('homonyme' in e.patients[0]), 'la mention homonyme n\'est jamais stockée');
});

test('résolution : nouveau patient ajouté au registre si aucune clé identique', () => {
  const e = etat([patient('p1', 'Lapin', 'Pierre')]);
  const r = resoudrePatient(e, { nom: ' Ours ', prenom: 'Baloo' }, ctx());
  assert.match(r.patient.id, /^nouveau-/);
  assert.deepEqual([r.patient.nom, r.patient.prenom], ['Ours', 'Baloo']);
  assert.deepEqual(Object.keys(r.patient).sort(), ['id', 'nom', 'prenom'], 'la copie de la ligne n\'a pas de champ actif');
  assert.deepEqual(r.avertissements, []);
  assert.deepEqual(e.patients.map((p) => p.nom), ['Lapin', 'Ours'], 'registre trié');
  assert.deepEqual(e.patients.find((p) => p.id === r.patient.id), { id: r.patient.id, nom: 'Ours', prenom: 'Baloo', actif: true });
});

test('résolution : rattachement automatique ; la copie est l\'écriture du REGISTRE ; avertissement seulement si le texte diffère', () => {
  const e = etat([patient('p1', 'Lapin', 'Pierre')]);
  const identique = resoudrePatient(e, { nom: 'Lapin', prenom: 'Pierre' }, ctx());
  assert.equal(identique.patient.id, 'p1');
  assert.deepEqual(identique.avertissements, []);
  const autreCasse = resoudrePatient(e, { nom: 'lapin ', prenom: 'PIERRE' }, ctx());
  assert.equal(autreCasse.patient.id, 'p1');
  assert.deepEqual(autreCasse.patient, { id: 'p1', nom: 'Lapin', prenom: 'Pierre' }, 'pas l\'écriture tapée');
  assert.equal(autreCasse.avertissements[0].code, 'PATIENT_RATTACHE');
  assert.equal(e.patients.length, 1);
});

test('résolution : patient sans prestation et patient archivé rattachables ; l\'archivé est réactivé avec avertissement', () => {
  const e = etat([patient('p1', 'Lapin', 'Pierre'), patient('p2', 'Ours', 'Baloo', false)]);
  assert.equal(resoudrePatient(e, { nom: 'Lapin', prenom: 'Pierre' }, ctx()).patient.id, 'p1');
  const r = resoudrePatient(e, { nom: 'ours', prenom: 'baloo' }, ctx());
  assert.equal(r.patient.id, 'p2');
  assert.deepEqual(r.avertissements.map((a) => a.code), ['PATIENT_RATTACHE', 'PATIENT_REACTIVE']);
  assert.equal(e.patients.find((p) => p.id === 'p2').actif, true);
});

test('résolution : homonymes (y compris sans prestation ou archivés) -> 409 avec id et date, sans nom ; rien n\'est modifié', () => {
  const e = etat(
    [patient('p1', 'Lapin', 'Pierre'), patient('p2', 'Lapin', 'Pierre', false), patient('p3', 'Lapin', 'Pierre')],
    [ligne('p1', 'Lapin', 'Pierre', '2026-09-14'), ligne('p3', 'Lapin', 'Pierre', '2026-10-01')],
  );
  const e409 = erreur(() => resoudrePatient(e, { nom: 'Lapin', prenom: 'Pierre' }, ctx()));
  assert.equal(e409.status, 409);
  assert.equal(e409.code, 'PATIENTS_HOMONYMES');
  assert.deepEqual(e409.details.candidats, [
    { id: 'p1', dernierePrestation: '2026-09-14' },
    { id: 'p2', dernierePrestation: null },
    { id: 'p3', dernierePrestation: '2026-10-01' },
  ]);
  assert.ok(!JSON.stringify(e409.details).includes('Lapin'));
  assert.equal(e.patients.find((p) => p.id === 'p2').actif, false, 'aucune réactivation avant le choix');
});

test('résolution : nouveau crée un homonyme assumé ; patientId choisit un candidat (archivé réactivé) ; inconnu -> 422', () => {
  const e = etat([patient('p1', 'Lapin', 'Pierre'), patient('p2', 'Cygne', 'Léa', false)]);
  const homonyme = resoudrePatient(e, { nom: 'Lapin', prenom: 'Pierre', nouveau: true }, ctx());
  assert.notEqual(homonyme.patient.id, 'p1');
  assert.equal(e.patients.length, 3);
  assert.equal(resoudrePatient(e, { patientId: 'p1' }, ctx()).patient.nom, 'Lapin');
  const r = resoudrePatient(e, { patientId: 'p2' }, ctx());
  assert.deepEqual(r.avertissements.map((a) => a.code), ['PATIENT_REACTIVE']);
  assert.equal(e.patients.find((p) => p.id === 'p2').actif, true);
  assert.ok(erreur(() => resoudrePatient(e, { patientId: 'inconnu' }, ctx())).champs.patientId);
});

test('création d\'un patient : actif, sans prestation, ajouté au registre trié ; mêmes règles de saisie que les prestations', () => {
  const e = etat([patient('p1', 'Lapin', 'Pierre')]);
  const r = creerPatient(e, { nom: '  Cygne ', prenom: 'Léa' }, ctx());
  assert.deepEqual(r.resultat, { id: r.resultat.id, nom: 'Cygne', prenom: 'Léa', actif: true });
  assert.deepEqual(e.patients.map((p) => p.nom), ['Cygne', 'Lapin']);
  for (const corps of [{ nom: '', prenom: 'x' }, { nom: 'x' }, { nom: 'x'.repeat(101), prenom: 'y' }, { nom: 'a​b', prenom: 'y' }, { nom: 'x', prenom: 'a‮b' }, { nom: 'a\nb', prenom: 'y' }]) {
    const err = erreur(() => creerPatient(e, corps, ctx()));
    assert.equal(err.status, 422, JSON.stringify(corps));
    assert.equal(err.code, 'VALIDATION');
  }
  assert.equal(erreur(() => creerPatient(e, { nom: 'a', prenom: 'b', inconnu: 1 }, ctx())).status, 400);
  assert.equal(erreur(() => creerPatient(e, { nom: 'a', prenom: 'b', homonyme: 'oui' }, ctx())).status, 400);
  assert.equal(e.patients.length, 2, 'les refus n\'ont rien créé');
});

test('création : même clé (actif ou archivé) -> 409 PATIENT_EXISTANT sans nom ; homonyme: true la crée', () => {
  const e = etat([patient('p1', 'Lapin', 'Pierre', false)], [ligne('p1', 'Lapin', 'Pierre', '2026-09-14')]);
  const err = erreur(() => creerPatient(e, { nom: 'LAPIN ', prenom: ' pierre' }, ctx()));
  assert.equal(err.status, 409);
  assert.equal(err.code, 'PATIENT_EXISTANT');
  assert.deepEqual(err.details.candidats, [{ id: 'p1', dernierePrestation: '2026-09-14' }]);
  assert.ok(!JSON.stringify(err.details).includes('Lapin'));
  assert.equal(e.patients.length, 1);
  creerPatient(e, { nom: 'Lapin', prenom: 'Pierre', homonyme: true }, ctx());
  assert.equal(e.patients.length, 2);
});

test('renommage : registre et toutes les lignes du patient, identifiant conservé, nombre de lignes modifiées, autres patients intacts', () => {
  const e = etat(
    [patient('p1', 'Lapen', 'Pierre'), patient('p2', 'Ours', 'Baloo')],
    [ligne('p1', 'Lapen', 'Pierre', '2026-09-01'), ligne('p1', 'Lapen', 'Pierre', '2026-09-02'), ligne('p2', 'Ours', 'Baloo', '2026-09-03')],
  );
  const r = modifierPatient(e, 'p1', { nom: 'Lapin' }, ctx());
  assert.equal(r.resultat.lignesModifiees, 2);
  assert.deepEqual(r.resultat.patient, { id: 'p1', nom: 'Lapin', prenom: 'Pierre', actif: true });
  assert.deepEqual(e.prestations.map((l) => l.patient.nom), ['Lapin', 'Lapin', 'Ours']);
  assert.deepEqual(e.prestations.map((l) => l.modifieLe === '2026-10-02T09:00:00.000Z'), [true, true, false]);
  assert.deepEqual(e.prestations[0].patient, { id: 'p1', nom: 'Lapin', prenom: 'Pierre' });
});

test('renommage : changement de casse ou d\'espaces appliqué sans confirmation, même face à un homonyme déjà présent', () => {
  const e = etat([patient('p1', 'lapin', 'Pierre'), patient('p2', 'Lapin', 'Pierre')], [ligne('p1', 'lapin', 'Pierre', '2026-09-01')]);
  const r = modifierPatient(e, 'p1', { nom: 'LAPIN' }, ctx());
  assert.equal(r.resultat.lignesModifiees, 1);
  assert.deepEqual(r.avertissements, []);
  assert.equal(e.patients.find((p) => p.id === 'p1').nom, 'LAPIN');
});

test('renommage vers le nom d\'un autre patient : 409 PATIENT_EXISTANT, rien de modifié ; avec homonyme: true, avertissement et aucune fusion', () => {
  const e = etat([patient('p1', 'Lapen', 'Pierre'), patient('p2', 'Lapin', 'Pierre')], [ligne('p1', 'Lapen', 'Pierre', '2026-09-01')]);
  const avant = structuredClone(e);
  const err = erreur(() => modifierPatient(e, 'p1', { nom: 'Lapin' }, ctx()));
  assert.equal(err.code, 'PATIENT_EXISTANT');
  assert.deepEqual(err.details.candidats.map((c) => c.id), ['p2']);
  assert.deepEqual(e, avant);
  const r = modifierPatient(e, 'p1', { nom: 'Lapin', homonyme: true }, ctx());
  assert.deepEqual(r.avertissements.map((a) => a.code), ['PATIENT_HOMONYME']);
  assert.equal(e.patients.length, 2, 'pas de fusion');
});

test('renommage : texte invalide -> 422 ; patient inconnu -> 404 ; aucun champ -> 400 ; actif non booléen -> 400', () => {
  const e = etat([patient('p1', 'Lapin', 'Pierre')]);
  assert.equal(erreur(() => modifierPatient(e, 'p1', { nom: '' }, ctx())).status, 422);
  assert.equal(erreur(() => modifierPatient(e, 'p1', { prenom: 'a‍b' }, ctx())).status, 422);
  assert.equal(erreur(() => modifierPatient(e, 'inconnu', { nom: 'x' }, ctx())).status, 404);
  assert.equal(erreur(() => modifierPatient(e, 'p1', {}, ctx())).status, 400);
  assert.equal(erreur(() => modifierPatient(e, 'p1', { homonyme: true }, ctx())).status, 400);
  assert.equal(erreur(() => modifierPatient(e, 'p1', { actif: 'non' }, ctx())).status, 400);
  assert.equal(erreur(() => modifierPatient(e, 'p1', { nom: 'x', autre: 1 }, ctx())).status, 400);
});

test('archiver / réactiver : idempotent, prestations intactes ; avertissement avec les nombres si des prestations sont à venir ou impayées', () => {
  const e = etat(
    [patient('p1', 'Lapin', 'Pierre'), patient('p2', 'Ours', 'Baloo')],
    [
      ligne('p1', 'Lapin', 'Pierre', '2026-09-01'),
      ligne('p1', 'Lapin', 'Pierre', '2026-10-20', { versements: [] }),
      ligne('p1', 'Lapin', 'Pierre', '2026-09-05', { versements: [] }),
      ligne('p2', 'Ours', 'Baloo', '2026-09-03'),
    ],
  );
  const lignesAvant = structuredClone(e.prestations);
  const r = modifierPatient(e, 'p1', { actif: false }, ctx());
  assert.equal(e.patients[0].actif, false);
  assert.equal(r.avertissements[0].code, 'PATIENT_ARCHIVE_EN_COURS');
  assert.deepEqual(r.avertissements[0].details, { aVenir: 1, impayees: 2 });
  assert.deepEqual(e.prestations, lignesAvant, 'les prestations ne bougent pas');
  assert.deepEqual(modifierPatient(e, 'p1', { actif: false }, ctx()).avertissements, [], 'déjà archivé : rien');
  assert.equal(modifierPatient(e, 'p1', { actif: true }, ctx()).resultat.patient.actif, true);
  assert.deepEqual(modifierPatient(e, 'p2', { actif: false }, ctx()).avertissements, [], 'rien à venir ni à payer : aucun avertissement');
});

test('suppression : seulement sans prestation (actif ou archive lisible) et sans archive illisible', () => {
  const e = etat([patient('p1', 'Lapin', 'Pierre'), patient('p2', 'Ours', 'Baloo'), patient('p3', 'Cygne', 'Léa')], [ligne('p1', 'Lapin', 'Pierre', '2026-09-01')]);
  assert.equal(erreur(() => supprimerPatient(e, 'p1')).code, 'PATIENT_UTILISE');
  assert.equal(erreur(() => supprimerPatient(e, 'p2', { ids: new Set(['p2']), illisibles: false })).code, 'PATIENT_UTILISE');
  assert.equal(erreur(() => supprimerPatient(e, 'p2', { ids: new Set(), illisibles: true })).status, 409);
  assert.equal(erreur(() => supprimerPatient(e, 'inconnu')).status, 404);
  assert.equal(e.patients.length, 3);
  assert.deepEqual(supprimerPatient(e, 'p3').resultat, { id: 'p3' });
  assert.deepEqual(e.patients.map((p) => p.id), ['p1', 'p2']);
});

test('réparation : ajoute les patients manquants, aligne les copies de même clé, ne touche pas modifieLe ; rien à faire = état inchangé', () => {
  const e = etat(
    [patient('p1', 'Lapin', 'Pierre')],
    [ligne('p1', 'lapin', 'pierre', '2026-09-01'), ligne('p9', 'Renard', 'Goupil', '2026-09-02'), ligne('p1', 'Autre', 'Nom', '2026-09-03')],
  );
  const lignes = structuredClone(e.prestations);
  const r = reparerPatients(e);
  assert.deepEqual(r.resultat, { patientsAjoutes: 1, copiesAlignees: 1 });
  assert.deepEqual(e.patients.map((p) => p.id), ['p1', 'p9']);
  assert.deepEqual(e.prestations[0].patient, { id: 'p1', nom: 'Lapin', prenom: 'Pierre' });
  assert.deepEqual(e.prestations[2].patient, lignes[2].patient, 'clé différente : laissée, toujours signalée');
  assert.deepEqual(e.prestations.map((l) => l.modifieLe), lignes.map((l) => l.modifieLe));
  const apres = structuredClone(e);
  assert.deepEqual(reparerPatients(e).resultat, { patientsAjoutes: 0, copiesAlignees: 0 });
  assert.deepEqual(e, apres, 'idempotent');
});

test('assurerAuRegistre / renommerPatient : un patient absent du registre (ligne orpheline) est ajouté puis renommé ; patient inconnu -> 404', () => {
  const e = etat([], [ligne('p1', 'Lapen', 'Pierre', '2026-09-01')]);
  assert.equal(erreur(() => renommerPatient(e, 'p1', { nom: 'Lapin', prenom: 'Pierre' }, ctx())).status, 404);
  assurerAuRegistre(e, e.prestations[0].patient);
  assurerAuRegistre(e, e.prestations[0].patient);
  assert.equal(e.patients.length, 1);
  assert.equal(renommerPatient(e, 'p1', { nom: 'Lapin', prenom: 'Pierre' }, ctx()).lignesModifiees, 1);
  assert.equal(e.prestations[0].patient.nom, 'Lapin');
});

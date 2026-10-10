// Modification du nom du patient depuis une prestation : confirmation d'homonyme, renommage en place de l'unique prestation,
// comparaison avec le REGISTRE (et non avec la copie de la ligne). Domaine pur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogueTest } from '../aides/catalogue-test.js';
import { creerPrestation, modifierPrestation, modifierVersement, ajouterVersement } from '../../src/domain/prestations.js';
import { compterAnomaliesRegistre, compterIncoherencesPatients, creerEtatInitial } from '../../src/domain/schema.js';

let compteur = 0;
const ctx = (maintenant = '2026-10-02T09:14:03.000Z') => ({ aujourdHui: '2026-10-02', maintenant, nouvelId: () => `id-${++compteur}` });
const etatVide = () => {
  const etat = creerEtatInitial(new Date('2026-10-02T09:00:00Z'));
  etat.catalogue = catalogueTest();
  return etat;
};
const saisie = (nom, prenom, extra = {}) => ({ patient: { nom, prenom }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500, motif: '', ...extra });
const creer = (etat, nom, prenom, extra) => creerPrestation(etat, saisie(nom, prenom, extra), ctx()).resultat;
const modifier = (etat, ligne, corps, c = ctx('2026-10-03T08:00:00.000Z')) => modifierPrestation(etat, ligne.id, { modifieLe: ligne.modifieLe, ...corps }, c);
const erreur = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return assert.fail('aucune erreur levée');
};

test('renommer sur toutes les lignes vers le nom d\'un AUTRE patient -> 409 PATIENT_EXISTANT (sans nom), rien de modifié ; homonyme: true -> avertissement, aucune fusion', () => {
  const etat = etatVide();
  const l1 = creer(etat, 'Lapin', 'Pierre');
  creer(etat, 'Lapin', 'Pierre', { date: '2026-09-01' });
  creer(etat, 'Ours', 'Baloo');
  const avant = JSON.stringify(etat);
  const e = erreur(() => modifier(etat, l1, { patient: { nom: 'ours', prenom: 'baloo' }, renommerPatient: true }));
  assert.equal(e.status, 409);
  assert.equal(e.code, 'PATIENT_EXISTANT');
  assert.equal(e.details.candidats.length, 1);
  assert.doesNotMatch(JSON.stringify(e.details), /Ours|Baloo/i);
  assert.equal(JSON.stringify(etat), avant, 'rien n\'est modifié avant confirmation');

  const r = modifier(etat, l1, { patient: { nom: 'ours', prenom: 'baloo' }, renommerPatient: true, homonyme: true });
  assert.deepEqual(r.avertissements.map((a) => a.code), ['PATIENT_HOMONYME']);
  assert.equal(etat.patients.length, 2, 'aucune fusion : deux patients de même nom');
  assert.deepEqual(compterIncoherencesPatients(etat), { orphelines: 0, copiesDivergentes: 0 });
});

test('l\'unique prestation d\'un patient renomme ce patient en place (identifiant conservé, pas de patient fantôme)', () => {
  const etat = etatVide();
  const l = creer(etat, 'Fautif', 'Zorro');
  const idPatient = l.patient.id;
  const r = modifier(etat, l, { patient: { nom: 'Fautive', prenom: 'Zorro' } });
  assert.deepEqual(r.avertissements, []);
  assert.equal(etat.patients.length, 1, 'l\'ancienne écriture ne reste pas au registre');
  assert.deepEqual(etat.patients[0], { id: idPatient, nom: 'Fautive', prenom: 'Zorro', actif: true });
  assert.deepEqual(r.resultat.patient, { id: idPatient, nom: 'Fautive', prenom: 'Zorro' });
  assert.deepEqual(compterIncoherencesPatients(etat), { orphelines: 0, copiesDivergentes: 0 });
});

test('si un autre patient porte déjà la nouvelle clé, comportement inchangé (rattachement à ce patient, l\'ancien reste au registre)', () => {
  const etat = etatVide();
  const l1 = creer(etat, 'Lapin', 'Pierre');
  const autre = creer(etat, 'Ours', 'Baloo');
  const r = modifier(etat, l1, { patient: { nom: 'ours', prenom: 'baloo' } });
  assert.deepEqual(r.avertissements.map((a) => a.code), ['PATIENT_RATTACHE']);
  assert.equal(r.resultat.patient.id, autre.patient.id);
  assert.equal(etat.patients.length, 2, 'l\'ancien patient reste (sans prestation) : rien n\'est supprimé en silence');
});

test('avec d\'autres prestations, le choix « toutes les lignes » ou « cette ligne » reste exigé (409 RENOMMAGE_PATIENT)', () => {
  const etat = etatVide();
  const l1 = creer(etat, 'Lapin', 'Pierre');
  creer(etat, 'Lapin', 'Pierre', { date: '2026-09-01' });
  const e = erreur(() => modifier(etat, l1, { patient: { nom: 'Lapinou', prenom: 'Pierre' } }));
  assert.equal(e.code, 'RENOMMAGE_PATIENT');
  assert.equal(etat.patients.length, 1);
});

test('copie divergente + correction de casse : le registre n\'est pas renommé vers le texte de la copie', () => {
  const etat = etatVide();
  const l1 = creer(etat, 'Lapin', 'Pierre');
  creer(etat, 'Lapin', 'Pierre', { date: '2026-09-01' });
  // Fichier retouché ou fusionné : la copie de la ligne diverge du registre.
  etat.prestations.find((l) => l.id === l1.id).patient = { id: l1.patient.id, nom: 'Divergent', prenom: 'Xavier' };
  const e = erreur(() => modifier(etat, etat.prestations.find((l) => l.id === l1.id), { patient: { nom: 'DIVERGENT', prenom: 'Xavier' } }));
  // La saisie n'est pas la clé du registre : c'est un vrai changement de nom, qui exige le choix habituel (jamais un renommage silencieux).
  assert.equal(e.code, 'RENOMMAGE_PATIENT');
  assert.deepEqual(etat.patients.map((p) => p.nom), ['Lapin'], 'le registre garde son écriture');
});

test('la saisie égale au texte du registre réaligne la ligne sans toucher aux autres', () => {
  const etat = etatVide();
  const l1 = creer(etat, 'Lapin', 'Pierre');
  const l2 = creer(etat, 'Lapin', 'Pierre', { date: '2026-09-01' });
  etat.prestations.find((l) => l.id === l1.id).patient = { id: l1.patient.id, nom: 'Divergent', prenom: 'Xavier' };
  const r = modifier(etat, etat.prestations.find((l) => l.id === l1.id), { patient: { nom: 'Lapin', prenom: 'Pierre' } });
  assert.equal(etat.patients[0].nom, 'Lapin', 'le registre garde son écriture');
  assert.deepEqual(r.resultat.patient, { id: l1.patient.id, nom: 'Lapin', prenom: 'Pierre' });
  assert.deepEqual(compterIncoherencesPatients(etat), { orphelines: 0, copiesDivergentes: 0 });
  assert.equal(etat.prestations.find((l) => l.id === l2.id).patient.nom, 'Lapin');
});

test('modifier un versement avec un corps vide -> 400 REQUETE_INVALIDE ; un champ valide reste accepté', () => {
  const etat = etatVide();
  const l = creer(etat, 'Lapin', 'Pierre');
  const { resultat } = ajouterVersement(etat, l.id, { montantCentimes: 1000, date: '2026-10-02', mode: 'cheque' }, ctx());
  const vid = resultat.versements[0].id;
  const e = erreur(() => modifierVersement(etat, l.id, vid, {}, ctx()));
  assert.equal(e.status, 400);
  assert.equal(e.code, 'REQUETE_INVALIDE');
  assert.equal(modifierVersement(etat, l.id, vid, { mode: 'especes' }, ctx()).resultat.versements[0].mode, 'especes');
});

test('champs inconnus et noms hors bornes comptés (avertissement), jamais refusés ; un registre propre ne signale rien', () => {
  const propre = etatVide();
  creer(propre, 'Lapin', 'Pierre');
  assert.deepEqual(compterAnomaliesRegistre(propre), { champsInconnus: 0, nomsHorsBornes: 0 });
  assert.deepEqual(compterAnomaliesRegistre({}), { champsInconnus: 0, nomsHorsBornes: 0 });

  const etat = etatVide();
  const l = creer(etat, 'Lapin', 'Pierre');
  const du = (nom) => etat.patients.find((p) => p.nom === nom);
  du('Lapin').notes = 'texte libre';
  etat.prestations[0].patient.telephone = '0000';
  creer(etat, 'Ours', 'Baloo');
  du('Ours').nom = 'x'.repeat(101);
  creer(etat, 'Cygne', 'Léa');
  du('Cygne').prenom = 'Lé‮a';
  assert.deepEqual(compterAnomaliesRegistre(etat), { champsInconnus: 2, nomsHorsBornes: 2 });
  assert.equal(l.patient.id, du('Lapin').id);
});

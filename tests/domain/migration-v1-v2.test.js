// Migration du schéma 1 vers 2 (registre des patients) : domaine pur, sur des états version 1 fictifs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvPrestations, csvVersements } from '../../src/domain/csv.js';
import { aFacturerGlobal, moisProposes, recapMensuel } from '../../src/domain/recap.js';
import { caMensuel, impayes, repartition, seances } from '../../src/domain/indicateurs.js';
import { listerPatients } from '../../src/domain/patients.js';
import { MIGRATIONS, VERSION_COURANTE, compterIncoherencesPatients, controlerStructure, migrer, migrerV1VersV2 } from '../../src/domain/schema.js';
import { genererExemple } from '../../src/exemple.js';
import { enV1, etatV1 } from '../aides/donnees.js';

const REF = '2026-10-02';
const v1Exemple = () => enV1(genererExemple());

test("migration : la table des migrations contient l'étape 1 -> 2, pure, sans effet sur l'original", () => {
  assert.equal(MIGRATIONS[1], migrerV1VersV2);
  const v1 = v1Exemple();
  const copie = structuredClone(v1);
  const v2 = migrer(v1, MIGRATIONS);
  assert.deepEqual(v1, copie, 'original intact');
  assert.equal(v2.schemaVersion, VERSION_COURANTE);
  assert.deepEqual(controlerStructure(v2), []);
  assert.deepEqual(compterIncoherencesPatients(v2), { orphelines: 0, copiesDivergentes: 0 });
});

test("migration du jeu d'exemple v1 : mêmes lignes (montants, versements, statuts, dates, identifiants), un patient actif par identifiant", () => {
  const v1 = v1Exemple();
  const v2 = migrer(v1);
  assert.deepEqual(v2.prestations, v1.prestations, 'aucune ligne modifiée, modifieLe compris');
  assert.deepEqual(v2.catalogue, v1.catalogue);
  assert.deepEqual(v2.parametres, v1.parametres);
  assert.equal(v2.revision, v1.revision);
  assert.equal(v2.majLe, v1.majLe);
  assert.equal(v2.patients.length, new Set(v1.prestations.map((l) => l.patient.id)).size);
  assert.ok(v2.patients.every((p) => p.actif === true && Object.keys(p).sort().join() === 'actif,id,nom,prenom'));
  assert.deepEqual(v2.patients, genererExemple().patients.filter((p) => p.actif), "même registre que le jeu d'exemple (sans l'archivé)");
  assert.deepEqual(Object.keys(v2).slice(-2), ['patients', 'prestations'], 'ordre des clés lisible dans le fichier');
});

test('migration : récapitulatif, indicateurs et exports CSV donnent les mêmes résultats avant et après', () => {
  const v1 = v1Exemple();
  const v2 = migrer(v1);
  const pour = (etat) => ({
    recaps: ['2026-08', '2026-09', '2026-10'].flatMap((mois) => ['prestation', 'versement'].map((vue) => recapMensuel(etat.prestations, { mois, vue, aujourdHui: REF }))),
    aFacturer: aFacturerGlobal(etat.prestations, REF),
    mois: moisProposes(etat.prestations, REF, '2026-10'),
    ca: ['prestation', 'versement'].map((vue) => caMensuel(etat.prestations, { de: '2025-10', a: '2026-10', vue, aujourdHui: REF })),
    seances: seances(etat.prestations, { de: '2025-10', a: '2026-10', aujourdHui: REF }),
    repartition: repartition(etat.prestations, { de: '2025-10', a: '2026-10', catalogue: etat.catalogue }),
    impayes: impayes(etat.prestations, REF),
    csv: [csvPrestations(etat.prestations), csvVersements(etat.prestations)],
  });
  assert.deepEqual(pour(v2), pour(v1));
  assert.ok(pour(v2).csv[0].length > 1000, 'les exports ne sont pas vides');
});

test('migration : fichier sans prestation -> registre vide', () => {
  const v2 = migrer(etatV1(0));
  assert.deepEqual(v2.patients, []);
  assert.deepEqual(v2.prestations, []);
  assert.deepEqual(controlerStructure(v2), []);
});

test("migration : homonymes (deux identifiants, même nom) -> deux patients distincts, signalés « homonyme » à l'affichage", () => {
  const v1 = etatV1(0);
  const base = etatV1(2).prestations;
  v1.prestations = [
    { ...base[0], patient: { id: 'p-a', nom: 'Lapin', prenom: 'Pierre' } },
    { ...base[1], patient: { id: 'p-b', nom: 'lapin', prenom: 'pierre' } },
  ];
  const v2 = migrer(v1);
  assert.deepEqual(v2.patients.map((p) => p.id).sort(), ['p-a', 'p-b']);
  assert.ok(listerPatients(v2).every((p) => p.homonyme));
  assert.ok(!v2.patients.some((p) => 'homonyme' in p), 'non stocké');
  assert.equal(v2.prestations[1].patient.nom, 'lapin', 'chaque patient garde sa propre écriture');
});

test('migration : patient « renommé » (même identifiant, casse ou espaces différents) -> un patient, écriture de la ligne la plus récente, copies alignées', () => {
  const v1 = etatV1(0);
  const base = etatV1(3).prestations;
  v1.prestations = [
    { ...base[0], date: '2026-07-01', patient: { id: 'p-a', nom: 'dupont', prenom: 'jean' } },
    { ...base[1], date: '2026-09-14', patient: { id: 'p-a', nom: 'Dupont', prenom: 'Jean' } },
    { ...base[2], date: '2026-08-01', patient: { id: 'p-a', nom: '  DUPONT', prenom: 'jean  ' } },
  ];
  const v2 = migrer(v1);
  assert.deepEqual(v2.patients, [{ id: 'p-a', nom: 'Dupont', prenom: 'Jean', actif: true }]);
  assert.ok(v2.prestations.every((l) => l.patient.nom === 'Dupont' && l.patient.prenom === 'Jean'));
  assert.deepEqual(v2.prestations.map((l) => l.modifieLe), v1.prestations.map((l) => l.modifieLe));
});

test('migration : patient sans prénom -> migration possible mais structure refusée (le fichier ne serait pas écrit)', () => {
  const v1 = etatV1(2);
  v1.prestations[0].patient = { ...v1.prestations[0].patient, prenom: '' };
  const v2 = migrer(v1);
  assert.ok(controlerStructure(v2).length > 0);
});

test("migration : ligne sans patient exploitable -> pas d'exception, structure refusée ; prestations absentes -> exception", () => {
  const v1 = etatV1(2);
  delete v1.prestations[1].patient;
  const v2 = migrer(v1);
  assert.equal(v2.patients.length, 1);
  assert.ok(controlerStructure(v2).some((m) => /prestations\[1\]\.patient/.test(m)));
  const sansLignes = etatV1(2);
  delete sansLignes.prestations;
  assert.throws(() => migrer(sansLignes), /prestations absentes/);
});

test('migration : champs inconnus du niveau supérieur conservés ; un champ patients présent dans un fichier v1 est reconstruit', () => {
  const v1 = etatV1(2);
  v1.champSupplementaire = { a: 1 };
  v1.patients = 'sans valeur';
  const v2 = migrer(v1);
  assert.deepEqual(v2.champSupplementaire, { a: 1 });
  assert.ok(Array.isArray(v2.patients));
  assert.deepEqual(controlerStructure(v2), []);
});

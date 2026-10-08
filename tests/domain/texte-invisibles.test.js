// Motif d'une prestation et libellé de tarif : mêmes caractères invisibles, de contrôle et bidirectionnels refusés que pour les noms de patients.
// Les caractères sont construits avec String.fromCodePoint : rien d'invisible dans le source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validerCatalogueCreation, validerCatalogueModification, validerCreation, validerModification, validerPatientCreation, validerPatientModification } from '../../src/domain/validation.js';
import { catalogueTest } from '../aides/catalogue-test.js';

const car = (...codes) => String.fromCodePoint(...codes);
const catalogue = catalogueTest();
const ligne = { prestationId: catalogue[0].id };

const INVISIBLES = [
  ['espace de largeur nulle', car(0x200b)],
  ['liant de largeur nulle', car(0x200d)],
  ['marque gauche-droite', car(0x200e)],
  ['override droite-gauche', car(0x202e)],
  ['isolat gauche-droite', car(0x2066)],
  ['joint de mots', car(0x2060)],
  ['BOM', car(0xfeff)],
  ["trait d'union conditionnel", car(0x00ad)],
  ['séparateur de ligne', car(0x2028)],
  ['sélecteur de variante (émoji)', car(0xfe0f)],
  ['caractère de balisage', car(0xe0041)],
  ['nul', car(0x00)],
  ['retour à la ligne', car(0x0a)],
  ['tabulation', car(0x09)],
  ['contrôle C1', car(0x85)],
];
const ACCEPTES = ["Bilan d'évaluation", 'Séance à domicile - Œdème', `Rendez-vous de l${car(0x2019)}été`, 'Aménagement du poste (suite) n°2'];

const creationAvecMotif = (motif) => validerCreation({ patient: { nom: 'Dupont', prenom: 'Léa' }, date: '2026-10-02', prestationId: catalogue[0].id, montantCentimes: 4500, motif }, catalogue);
const modificationAvecMotif = (motif) => validerModification({ modifieLe: 'v1', motif }, catalogue, ligne);
const catalogueAvecLibelle = (libelle) => validerCatalogueCreation({ libelle, tarifCentimes: 4500, categorie: 'seance' });
const catalogueModifie = (libelle) => validerCatalogueModification({ libelle });

function erreur(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

function attendreRefus(fn, champ, libelle) {
  const e = erreur(fn);
  assert.ok(e, `${libelle} accepté`);
  assert.equal(e.status, 422, libelle);
  assert.equal(e.code, 'VALIDATION', libelle);
  assert.ok(e.champs[champ], `${libelle} : champ ${champ}`);
  assert.match(e.champs[champ], /non autorisé/, libelle);
}

test('motif : caractères invisibles, bidirectionnels et de contrôle refusés (création et modification), au début, au milieu et à la fin', () => {
  for (const [libelle, c] of INVISIBLES) {
    for (const motif of [`Gra${c}phisme`, `${c}Graphisme`, `Graphisme${c}`]) {
      attendreRefus(() => creationAvecMotif(motif), 'motif', `création, ${libelle}`);
      attendreRefus(() => modificationAvecMotif(motif), 'motif', `modification, ${libelle}`);
    }
  }
});

test('motif : le refus des invisibles reprend le message des noms (retaper à la main)', () => {
  const e = erreur(() => creationAvecMotif(`Bilan${car(0x202e)}`));
  assert.equal(e.champs.motif, 'Le motif contient un caractère invisible ou de contrôle, non autorisé. Retapez-le à la main plutôt que de le copier-coller.');
});

test("motif : accents, traits d'union, apostrophes, ponctuation et motif vide acceptés", () => {
  for (const motif of ACCEPTES) assert.equal(creationAvecMotif(motif).motif, motif);
  assert.equal(creationAvecMotif('').motif, '');
  assert.equal(creationAvecMotif(undefined).motif, '');
  assert.equal(modificationAvecMotif("Prise en charge - suivi d'été").motif, "Prise en charge - suivi d'été");
  assert.equal(modificationAvecMotif('  espaces   multiples ').motif, 'espaces multiples');
});

test('libellé de tarif : caractères invisibles, bidirectionnels et de contrôle refusés (ajout et modification du catalogue)', () => {
  for (const [libelle, c] of INVISIBLES) {
    for (const nom of [`Sé${c}ance`, `${c}Séance`, `Séance${c}`]) {
      attendreRefus(() => catalogueAvecLibelle(nom), 'libelle', `ajout, ${libelle}`);
      attendreRefus(() => catalogueModifie(nom), 'libelle', `modification, ${libelle}`);
    }
  }
  const e = erreur(() => catalogueAvecLibelle(`Séance${car(0x200b)}`));
  assert.equal(e.champs.libelle, 'Le nom de la prestation contient un caractère invisible ou de contrôle, non autorisé. Retapez-le à la main plutôt que de le copier-coller.');
});

test("libellé de tarif : accents, traits d'union, apostrophes acceptés ; un libellé fait seulement d'un invisible reste refusé", () => {
  for (const nom of ACCEPTES) {
    assert.equal(catalogueAvecLibelle(nom).libelle, nom);
    assert.equal(catalogueModifie(nom).libelle, nom);
  }
  attendreRefus(() => catalogueAvecLibelle(car(0x200b)), 'libelle', 'ajout, invisible seul');
});

// ---- Patients du registre : POST et PATCH /api/patients (mêmes caractères refusés que pour la saisie d'une prestation) ----

test('registre : nom et prénom d\'un patient — caractères invisibles, bidirectionnels et de contrôle refusés (création et modification)', () => {
  for (const [libelle, c] of INVISIBLES) {
    for (const champ of ['nom', 'prenom']) {
      for (const valeur of [`Ma${c}rie`, `${c}Marie`, `Marie${c}`]) {
        const creation = erreur(() => validerPatientCreation({ nom: 'Lapin', prenom: 'Pierre', [champ]: valeur }));
        assert.equal(creation.status, 422, `création, ${champ}, ${libelle}`);
        assert.ok(creation.champs[champ], `création, ${champ}, ${libelle}`);
        const modification = erreur(() => validerPatientModification({ [champ]: valeur }));
        assert.equal(modification.status, 422, `modification, ${champ}, ${libelle}`);
        assert.ok(modification.champs[champ], `modification, ${champ}, ${libelle}`);
      }
    }
  }
  const e = erreur(() => validerPatientCreation({ nom: `Du${car(0x200b)}pont`, prenom: 'Jean' }));
  assert.equal(e.champs.nom, 'Le nom du patient contient un caractère invisible ou de contrôle, non autorisé. Retapez-le à la main plutôt que de le copier-coller.');
});

test('registre : noms accentués, avec trait d\'union ou apostrophe acceptés ; espaces normalisés', () => {
  assert.deepEqual(validerPatientCreation({ nom: '  Le   Roux-D’Hérisson ', prenom: 'Anne-Marie' }), { nom: 'Le Roux-D’Hérisson', prenom: 'Anne-Marie', homonyme: false });
  assert.deepEqual(validerPatientModification({ prenom: ' Léa ', actif: false, homonyme: true }), { homonyme: true, prenom: 'Léa', actif: false });
});

test('registre : champs obligatoires, longueur 100, champs inconnus (400) et types (400)', () => {
  const vide = erreur(() => validerPatientCreation({}));
  assert.deepEqual(Object.keys(vide.champs).sort(), ['nom', 'prenom']);
  assert.equal(erreur(() => validerPatientCreation({ nom: 'x'.repeat(101), prenom: 'y' })).status, 422);
  assert.equal(validerPatientCreation({ nom: 'x'.repeat(100), prenom: 'y' }).nom.length, 100);
  assert.equal(erreur(() => validerPatientCreation({ nom: 'a', prenom: 'b', actif: true })).status, 400);
  assert.equal(erreur(() => validerPatientCreation({ nom: 'a', prenom: 'b', homonyme: 1 })).status, 400);
  assert.equal(erreur(() => validerPatientModification({ actif: 1 })).status, 400);
  assert.equal(erreur(() => validerPatientModification({ homonyme: true })).status, 400, 'au moins un de nom, prénom, actif');
  assert.equal(erreur(() => validerPatientModification({ nom: 'a', id: 'x' })).status, 400);
});

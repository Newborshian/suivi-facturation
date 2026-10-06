import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajouterAuCatalogue, modifierDansCatalogue, supprimerDuCatalogue } from '../../src/domain/catalogue.js';
import { creerPrestation } from '../../src/domain/prestations.js';
import { controlerStructure } from '../../src/domain/schema.js';
import { validerCatalogueCreation, validerCatalogueModification, validerParametres } from '../../src/domain/validation.js';
import { catalogueTest, tarifTest } from '../aides/catalogue-test.js';
import { etatTest } from '../aides/donnees.js';

let n = 0;
const ctx = { nouvelId: () => `nouveau-${++n}`, aujourdHui: '2026-10-02', maintenant: '2026-10-02T09:00:00.000Z' };
const erreur = (fn, code, status) =>
  assert.throws(fn, (e) => {
    assert.equal(e.code, code);
    if (status) assert.equal(e.status, status);
    return true;
  });
const champs = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.champs ?? {};
  }
  return assert.fail("une erreur de validation était attendue");
};

test('ajout : active, placée en dernier, id fourni, structure valide', () => {
  const etat = etatTest(0);
  const maxAvant = Math.max(...etat.catalogue.map((c) => c.ordre));
  const { resultat } = ajouterAuCatalogue(etat, { libelle: '  Atelier   parents ', tarifCentimes: 7500, categorie: 'autre' }, ctx);
  assert.deepEqual(resultat, { id: resultat.id, libelle: 'Atelier parents', tarifCentimes: 7500, categorie: 'autre', actif: true, ordre: maxAvant + 1 });
  assert.equal(etat.catalogue.length, catalogueTest().length + 1);
  assert.deepEqual(controlerStructure(etat), []);
});

test('ajout : tarif de 0 € autorisé ; libellé vide, tarif invalide, catégorie inconnue, champ inconnu refusés avec un message par champ', () => {
  assert.equal(validerCatalogueCreation({ libelle: 'Gratuit', tarifCentimes: 0, categorie: 'autre' }).tarifCentimes, 0);
  assert.ok(champs(() => validerCatalogueCreation({ libelle: '   ', tarifCentimes: 100, categorie: 'autre' })).libelle);
  assert.ok(champs(() => validerCatalogueCreation({ libelle: 'x'.repeat(121), tarifCentimes: 100, categorie: 'autre' })).libelle);
  assert.ok(champs(() => validerCatalogueCreation({ libelle: 'a\u0007b', tarifCentimes: 100, categorie: 'autre' })).libelle, 'caractère de contrôle');
  for (const tarif of [-1, 45.5, '45', null, undefined, NaN, 10_000_001, Number.MAX_SAFE_INTEGER + 2]) {
    assert.ok(champs(() => validerCatalogueCreation({ libelle: 'a', tarifCentimes: tarif, categorie: 'autre' })).tarifCentimes, `tarif ${String(tarif)}`);
  }
  assert.ok(champs(() => validerCatalogueCreation({ libelle: 'a', tarifCentimes: 1, categorie: 'inconnue' })).categorie);
  assert.deepEqual(Object.keys(champs(() => validerCatalogueCreation({}))).sort(), ['categorie', 'libelle', 'tarifCentimes']);
  erreur(() => validerCatalogueCreation({ libelle: 'a', tarifCentimes: 1, categorie: 'autre', actif: true }), 'REQUETE_INVALIDE', 400);
  assert.match(champs(() => validerCatalogueCreation({ libelle: 'a', tarifCentimes: -5, categorie: 'autre' })).tarifCentimes, /positif ou nul/);
});

test('modification partielle : seuls les champs fournis changent ; activation / désactivation', () => {
  const etat = etatTest(0);
  const avant = structuredClone(etat.catalogue.find((c) => c.id === 'seance-45'));
  modifierDansCatalogue(etat, 'seance-45', { tarifCentimes: 5000 });
  const apres = etat.catalogue.find((c) => c.id === 'seance-45');
  assert.deepEqual({ ...apres, tarifCentimes: tarifTest('seance-45') }, avant);
  assert.equal(apres.tarifCentimes, 5000);
  modifierDansCatalogue(etat, 'seance-45', { actif: false });
  assert.equal(etat.catalogue.find((c) => c.id === 'seance-45').actif, false);
  modifierDansCatalogue(etat, 'seance-45', { actif: true, libelle: 'Séance 45 min', categorie: 'autre', ordre: 12 });
  assert.deepEqual(etat.catalogue.find((c) => c.id === 'seance-45'), { id: 'seance-45', libelle: 'Séance 45 min', tarifCentimes: 5000, categorie: 'autre', actif: true, ordre: 12 });
  assert.deepEqual(controlerStructure(etat), []);
});

test('modification : id inconnu 404 ; champs invalides refusés sans rien modifier ; l\'identifiant ne peut pas changer', () => {
  const etat = etatTest(0);
  const copie = structuredClone(etat);
  erreur(() => modifierDansCatalogue(etat, 'nexiste-pas', { actif: false }), 'INTROUVABLE', 404);
  erreur(() => modifierDansCatalogue(etat, 'reunion-synthese', { id: 'autre' }), 'REQUETE_INVALIDE', 400);
  erreur(() => modifierDansCatalogue(etat, 'reunion-synthese', { actif: 'oui' }), 'REQUETE_INVALIDE', 400);
  erreur(() => modifierDansCatalogue(etat, 'reunion-synthese', { ordre: -1 }), 'REQUETE_INVALIDE', 400);
  assert.ok(champs(() => validerCatalogueModification({ tarifCentimes: -10 })).tarifCentimes);
  assert.ok(champs(() => validerCatalogueModification({ libelle: '' })).libelle);
  assert.deepEqual(etat, copie);
});

test('sans effet rétroactif : libellé, catégorie et montant des prestations déjà saisies restent figés ; les nouvelles prennent les nouvelles valeurs', () => {
  const etat = etatTest(0);
  creerPrestation(etat, { patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-01', prestationId: 'seance-45', montantCentimes: 4000, motif: '' }, { ...ctx, nouvelId: () => `l-${++n}` });
  const ligneAvant = structuredClone(etat.prestations[0]);
  modifierDansCatalogue(etat, 'seance-45', { libelle: 'Nouveau nom', tarifCentimes: 6000, categorie: 'bilan' });
  assert.deepEqual(etat.prestations[0], ligneAvant, 'la ligne existante est strictement identique (montant ajusté à la main conservé)');
  assert.equal(etat.prestations[0].libelle, 'Séance individuelle 45 min');
  assert.equal(etat.prestations[0].categorie, 'seance');
  const { resultat } = creerPrestation(etat, { patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 6000, motif: '' }, { ...ctx, nouvelId: () => `l-${++n}` });
  assert.equal(resultat.libelle, 'Nouveau nom');
  assert.equal(resultat.categorie, 'bilan');
});

test('désactivation : le type n\'est plus proposé à la saisie mais les lignes existantes le gardent', () => {
  const etat = etatTest(0);
  creerPrestation(etat, { patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-01', prestationId: 'reunion-synthese', montantCentimes: 6000, motif: '' }, { ...ctx, nouvelId: () => `l-${++n}` });
  modifierDansCatalogue(etat, 'reunion-synthese', { actif: false });
  erreur(() => creerPrestation(etat, { patient: { nom: 'Ours', prenom: 'Baloo' }, date: '2026-10-02', prestationId: 'reunion-synthese', montantCentimes: 6000, motif: '' }, { ...ctx, nouvelId: () => `l-${++n}` }), 'VALIDATION', 422);
  assert.equal(etat.prestations[0].prestationId, 'reunion-synthese');
  assert.deepEqual(controlerStructure(etat), []);
});

test('suppression : refusée si une ligne active la référence (409 CATALOGUE_UTILISE), refusée si une archive la référence, acceptée sinon', () => {
  const etat = etatTest(0);
  creerPrestation(etat, { patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-01', prestationId: 'reunion-synthese', montantCentimes: 6000, motif: '' }, { ...ctx, nouvelId: () => `l-${++n}` });
  const copie = structuredClone(etat);
  erreur(() => supprimerDuCatalogue(etat, 'reunion-synthese', new Set()), 'CATALOGUE_UTILISE', 409);
  erreur(() => supprimerDuCatalogue(etat, 'compte-rendu', new Set(['compte-rendu'])), 'CATALOGUE_UTILISE', 409);
  erreur(() => supprimerDuCatalogue(etat, 'nexiste-pas', new Set()), 'INTROUVABLE', 404);
  assert.deepEqual(etat, copie, 'rien n\'a été supprimé');
  const { resultat } = supprimerDuCatalogue(etat, 'compte-rendu', new Set(['seance-domicile-45']));
  assert.deepEqual(resultat, { id: 'compte-rendu' });
  assert.equal(etat.catalogue.some((c) => c.id === 'compte-rendu'), false);
  assert.equal(etat.catalogue.length, catalogueTest().length - 1);
  assert.deepEqual(controlerStructure(etat), []);
});

test('paramètres : nombre de sauvegardes entier de 7 à 365 ; le reste est refusé', () => {
  assert.deepEqual(validerParametres({ sauvegardesConservees: 30 }), { sauvegardesConservees: 30 });
  assert.deepEqual(validerParametres({ sauvegardesConservees: 7 }), { sauvegardesConservees: 7 });
  assert.deepEqual(validerParametres({ sauvegardesConservees: 365 }), { sauvegardesConservees: 365 });
  for (const v of [0, 1, 6, -3, 366, 12.5, '30', null, undefined, NaN, Infinity]) {
    assert.ok(champs(() => validerParametres({ sauvegardesConservees: v })).sauvegardesConservees, String(v));
  }
  erreur(() => validerParametres({ sauvegardesConservees: 5, dernierModePaiement: 'cheque' }), 'REQUETE_INVALIDE', 400);
  erreur(() => validerParametres({}), 'REQUETE_INVALIDE', 400);
});

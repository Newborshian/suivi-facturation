// Catalogue vide ou entièrement désactivé : logique pure du guide d'accueil, du formulaire désactivé et de l'état vide de Paramètres → Tarifs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LIEN_TARIFS, etatCatalogue, explicationFormulaireDesactive, guideCatalogue, messageTarifsVide, saisieImpossible } from '../../public/js/catalogue-etat.js';
import { catalogueTest } from '../aides/catalogue-test.js';
import { RACINE } from '../aides/temp.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';

const toutDesactive = () => catalogueTest().map((c) => ({ ...c, actif: false }));
const uneSeuleActive = () => catalogueTest().map((c, i) => ({ ...c, actif: i === 3 }));

test('état du catalogue : vide, entièrement désactivé, utilisable (une seule prestation active suffit)', () => {
  assert.equal(etatCatalogue([]), 'vide');
  assert.equal(etatCatalogue(undefined), 'vide');
  assert.equal(etatCatalogue(null), 'vide');
  assert.equal(etatCatalogue(toutDesactive()), 'inactif');
  assert.equal(etatCatalogue(uneSeuleActive()), 'utilisable');
  assert.equal(etatCatalogue(catalogueTest()), 'utilisable');
});

test('saisie impossible tant que le catalogue est vide ou entièrement désactivé', () => {
  assert.equal(saisieImpossible([]), true);
  assert.equal(saisieImpossible(toutDesactive()), true);
  assert.equal(saisieImpossible(uneSeuleActive()), false);
  assert.equal(saisieImpossible(catalogueTest()), false);
});

test('guide d\'accueil, catalogue vide : les deux étapes (définir ses prestations et tarifs, puis les saisir) et le lien vers Paramètres → Tarifs', () => {
  const g = guideCatalogue([]);
  assert.equal(g.etat, 'vide');
  assert.deepEqual(g.etapes, ['1. Définissez vos prestations et leurs tarifs (Paramètres → Tarifs).', '2. Saisissez ensuite vos prestations.']);
  assert.match(g.lien, /prestations et tarifs/);
  assert.equal(LIEN_TARIFS, '/parametres.html#tarifs');
});

test('guide d\'accueil, catalogue entièrement désactivé : message adapté (réactiver ou ajouter), pas le message du catalogue vide', () => {
  const g = guideCatalogue(toutDesactive());
  assert.equal(g.etat, 'inactif');
  assert.notEqual(g.titre, guideCatalogue([]).titre);
  assert.equal(g.etapes.length, 1);
  assert.match(g.etapes[0], /désactivées/);
  assert.match(g.etapes[0], /Réactivez|ajoutez/i);
});

test('pas de guide quand le catalogue est utilisable', () => {
  assert.equal(guideCatalogue(catalogueTest()), null);
  assert.equal(guideCatalogue(uneSeuleActive()), null);
  assert.equal(explicationFormulaireDesactive(catalogueTest()), null);
  assert.equal(messageTarifsVide(catalogueTest()), null);
});

test('formulaire d\'ajout désactivé : une explication visible et un lien, jamais un simple champ vide', () => {
  for (const [catalogue, motif] of [[[], /catalogue de prestations est vide/], [toutDesactive(), /désactivées/]]) {
    const e = explicationFormulaireDesactive(catalogue);
    assert.ok(e.titre.length > 0);
    assert.match(e.texte, motif);
    assert.match(e.texte, /Paramètres → Tarifs/);
    assert.ok(e.lien.length > 0);
  }
});

test('Paramètres → Tarifs : état vide explicite (« Aucune prestation définie »), message distinct si tout est désactivé', () => {
  const vide = messageTarifsVide([]);
  assert.equal(vide.titre, 'Aucune prestation définie');
  assert.match(vide.texte, /première prestation/);
  const inactif = messageTarifsVide(toutDesactive());
  assert.match(inactif.titre, /Aucune prestation active/);
  assert.match(inactif.texte, /Active/);
});

test('les pages câblent le guide : accueil, formulaire désactivé, état vide des tarifs ; aucune donnée via innerHTML, pas de style en ligne', async () => {
  const lire = (f) => fs.readFile(path.join(RACINE, 'public', 'js', f), 'utf8');
  const [accueil, prestations, facturation, tarifs] = await Promise.all(['accueil-vide.js', 'pages/prestations.js', 'pages/facturation.js', 'pages/parametres-tarifs.js'].map(lire));
  assert.match(accueil, /guideCatalogue\(catalogue\)/);
  assert.match(prestations, /explicationFormulaireDesactive\(page\.catalogue\)/);
  assert.match(prestations, /champ\.disabled = true/);
  assert.match(prestations, /remplacerSiFichierVide\(message, \{ ajouter: false, catalogue: page\.catalogue \}\)/);
  assert.match(facturation, /remplacerSiFichierVide\(corps, \{ ajouter: true, catalogue: page\.catalogue \}\)/);
  assert.match(tarifs, /messageTarifsVide\(catalogue\)/);
  for (const texte of [accueil, prestations, facturation, tarifs]) assert.doesNotMatch(texte, /innerHTML|insertAdjacentHTML|setAttribute\(\s*['"]style['"]|style=/);
});

test('Prestations, catalogue inutilisable : la consigne n\'est affichée qu\'une fois (alerte du formulaire), l\'accueil guidé reste sur Facturation', async () => {
  const lire = (f) => fs.readFile(path.join(RACINE, 'public', 'js', f), 'utf8');
  const [prestations, facturation] = await Promise.all(['pages/prestations.js', 'pages/facturation.js'].map(lire));
  assert.match(prestations, /const bloque = vide && saisieImpossible\(page\.catalogue\)/);
  assert.match(prestations, /bloque \? null : el\('p', \{ classe: 'etat-vide__texte'/);
  assert.match(prestations, /if \(vide && !bloque\) remplacerSiFichierVide/);
  assert.match(facturation, /remplacerSiFichierVide\(corps, \{ ajouter: true, catalogue: page\.catalogue \}\)/);
});

test('textes génériques : le comptage des séances est décrit par la catégorie, plus par une durée ni un métier ; aide de catégorie dans Paramètres → Tarifs', async () => {
  const lire = (f) => fs.readFile(path.join(RACINE, 'public', 'js', f), 'utf8');
  const fichiers = await Promise.all(['pages/facturation.js', 'pages/tdb-sections.js', 'pages/parametres-tarifs.js'].map(lire));
  const [facturation, tdb, tarifs] = fichiers;
  for (const texte of fichiers) assert.doesNotMatch(texte, /\bESS\b|MDPH|30 ou 45|30\/45|courriers/);
  assert.match(facturation, /Séances = prestations de catégorie « Séance » ; les autres catégories \(bilan, autre\) sont dans « Autres »\./);
  assert.match(facturation, /sont comptées dans « Autres »\./);
  assert.match(tdb, /Prestations de catégorie « Séance » uniquement/);
  assert.match(tdb, /Les autres catégories \(bilan, autre\) ne sont pas comptées\./);
  assert.match(tarifs, /les séances sont comptées dans le nombre de séances/);
});

test('dossier vide : catalogue vide, aucune saisie possible ; une fois une prestation définie (Paramètres → Tarifs), la saisie fonctionne', async () => {
  const s = await demarrerServeurTest({ catalogueVide: true });
  const entetes = { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json' };
  const post = (chemin, corps) => s.requete({ methode: 'POST', chemin, headers: entetes, corps: JSON.stringify(corps) });
  const saisie = (prestationId) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId, montantCentimes: 4000, motif: '' });
  try {
    assert.deepEqual((await s.requete({ chemin: '/api/catalogue' })).json.catalogue, []);
    assert.equal((await s.requete({ chemin: '/api/etat' })).json.nombrePrestations, 0);
    assert.equal((await post('/api/prestations', saisie('seance-30'))).status, 422, 'rien à saisir sans prestation définie');
    const ajout = await post('/api/catalogue', { libelle: 'Séance individuelle 30 min', tarifCentimes: 4000, categorie: 'seance' });
    assert.equal(ajout.status, 201);
    const creee = await post('/api/prestations', saisie(ajout.json.donnees.id));
    assert.equal(creee.status, 201);
    assert.equal(creee.json.donnees.libelle, 'Séance individuelle 30 min');
    assert.equal((await s.requete({ chemin: '/js/catalogue-etat.js' })).status, 200);
  } finally {
    await s.arreter();
  }
});

test('catégorie par défaut à l\'ajout : « Séance », première du sélecteur ; codes et libellés inchangés ; modification d\'une prestation existante non concernée', async () => {
  const { LIBELLES_CATEGORIE } = await import('../../public/js/format.js');
  const { CATEGORIE_PAR_DEFAUT } = await import('../../public/js/catalogue-etat.js');
  assert.equal(CATEGORIE_PAR_DEFAUT, 'seance');
  assert.deepEqual(LIBELLES_CATEGORIE, { seance: 'Séance', bilan: 'Bilan', autre: 'Autre' });
  assert.equal(Object.keys(LIBELLES_CATEGORIE)[0], CATEGORIE_PAR_DEFAUT, 'la valeur par défaut est aussi la première option affichée');
  const tarifs = await fs.readFile(path.join(RACINE, 'public', 'js', 'pages', 'parametres-tarifs.js'), 'utf8');
  assert.match(tarifs, /selectCategorie\(CATEGORIE_PAR_DEFAUT, id, 'categorie'\)/, 'formulaire d\'ajout');
  assert.match(tarifs, /selectCategorie\(c\.categorie, `tarif-\$\{n\}-categorie`/, 'modification : garde la catégorie actuelle');
  assert.doesNotMatch(tarifs, /selectCategorie\('autre'/);
});

test('ajout au catalogue sans toucher au sélecteur : catégorie « seance », comptée comme séance (Facturation du mois, Tableau de bord) ; une prestation « autre » existante reste inchangée', async () => {
  const { CATEGORIE_PAR_DEFAUT } = await import('../../public/js/catalogue-etat.js');
  const s = await demarrerServeurTest({ catalogueVide: true });
  const entetes = { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json' };
  const post = (chemin, corps) => s.requete({ methode: 'POST', chemin, headers: entetes, corps: JSON.stringify(corps) });
  const saisie = (prestationId) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId, montantCentimes: 5000, motif: '' });
  try {
    const autre = await post('/api/catalogue', { libelle: 'Prestation diverse', tarifCentimes: 1000, categorie: 'autre' });
    assert.equal(autre.status, 201);
    const avant = (await s.requete({ chemin: '/api/catalogue' })).json.catalogue.find((c) => c.id === autre.json.donnees.id);
    // Ce que le formulaire envoie quand on n'a pas touché au sélecteur : sa valeur initiale.
    const ajout = await post('/api/catalogue', { libelle: 'Nouvelle séance', tarifCentimes: 5000, categorie: CATEGORIE_PAR_DEFAUT });
    assert.equal(ajout.status, 201);
    assert.equal(ajout.json.donnees.categorie, 'seance');
    assert.equal((await post('/api/prestations', saisie(ajout.json.donnees.id))).status, 201);

    const recap = (await s.requete({ chemin: '/api/recap?mois=2026-10' })).json;
    assert.equal(recap.total.nbSeances, 1);
    assert.equal(recap.total.nbAutres, 0);
    const seances = (await s.requete({ chemin: '/api/indicateurs/seances?de=2026-10&a=2026-10' })).json;
    assert.equal(seances.total.realisees, 1);
    assert.equal(seances.total.autres, 0);

    const apres = (await s.requete({ chemin: '/api/catalogue' })).json.catalogue.find((c) => c.id === autre.json.donnees.id);
    assert.deepEqual(apres, avant, 'la prestation « autre » existante n\'est pas modifiée');
    assert.equal(apres.categorie, 'autre');
  } finally {
    await s.arreter();
  }
});

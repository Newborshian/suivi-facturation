// Possibilité d'écrire (public/js/ecriture.js) : logique pure, plus contrôle du source de l'écran Prestations
// (pas de DOM sous node --test) pour vérifier que chaque contrôle d'écriture tient compte de cette règle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { ecritureAutorisee, explicationEcritureImpossible } from '../../public/js/ecriture.js';

test('état normal : écriture autorisée, aucune explication', () => {
  assert.equal(ecritureAutorisee({}), true);
  assert.equal(ecritureAutorisee({ lectureSeule: false, conflit: null, modeDegrade: false }), true);
  assert.equal(explicationEcritureImpossible({}), '');
});

test('lecture seule, conflit ou mode dégradé : écriture refusée, avec une explication propre à chaque cause', () => {
  const cas = [
    [{ lectureSeule: true }, /version plus récente/],
    [{ conflit: { type: 'remplace' } }, /version des données à garder/],
    [{ modeDegrade: true }, /pas utilisable/],
  ];
  for (const [etat, motif] of cas) {
    assert.equal(ecritureAutorisee(etat), false, JSON.stringify(etat));
    assert.match(explicationEcritureImpossible(etat), motif);
  }
  const textes = new Set(cas.map(([etat]) => explicationEcritureImpossible(etat)));
  assert.equal(textes.size, 3);
});

test('cumul de causes : le mode dégradé prime, puis la lecture seule, puis le conflit', () => {
  assert.match(explicationEcritureImpossible({ modeDegrade: true, lectureSeule: true, conflit: {} }), /pas utilisable/);
  assert.match(explicationEcritureImpossible({ lectureSeule: true, conflit: {} }), /version plus récente/);
});

test('un état absent (réponse inattendue) ne bloque pas l\'écriture : le serveur reste juge', () => {
  assert.equal(ecritureAutorisee(undefined), true);
  assert.equal(ecritureAutorisee(null), true);
});

test('écran Prestations (lecture du code) : les contrôles d\'écriture passent par accesEcriture(), le formulaire d\'ajout est désactivé', async () => {
  const src = await fs.readFile(path.join(RACINE, 'public', 'js', 'pages', 'prestations.js'), 'utf8');
  assert.match(src, /from '\/js\/ecriture\.js'/);
  const lignes = src.split('\n');
  // Case de sélection, « Tout sélectionner », statut, « Payé en totalité », « Versement », « Modifier » : chacun reçoit les attributs désactivés.
  for (const motif of ["'aria-label': `Sélectionner la prestation", "'aria-label': 'Tout sélectionner'", "'aria-label': `Statut de facturation", "'aria-label': `Payé en totalité", "'aria-label': `Ajouter un versement", "'aria-label': `Modifier la prestation"]) {
    const ligne = lignes.find((l) => l.includes(motif));
    assert.ok(ligne, motif);
    assert.match(ligne, /\.\.\.accesEcriture\(\)/, `${motif} : désactivé quand l'écriture est impossible`);
  }
  assert.match(src, /if \(explication \|\| !page\.ecriture\)/, 'formulaire d\'ajout désactivé');
  assert.match(src, /accesEcriture = \(\) => \(page\.ecriture \? \{\} : \{ disabled: true, title: page\.explication, 'aria-describedby': ID_RAISON \}\)/);
  assert.match(src, /id: ID_RAISON/, 'texte lié par aria-describedby présent dans la page');
});

test('Facturation du mois, Prestations et Paramètres (lecture du code) : une seule règle « écriture possible », celle de ecriture.js', async () => {
  for (const page of ['facturation.js', 'prestations.js', 'parametres.js']) {
    const src = await fs.readFile(path.join(RACINE, 'public', 'js', 'pages', page), 'utf8');
    assert.match(src, /import \{[^}]*ecritureAutorisee[^}]*\} from '\/js\/ecriture\.js'/, `${page} : importe ecritureAutorisee`);
    assert.doesNotMatch(src, /lectureSeule \|\|/, `${page} : la règle n'est plus recopiée`);
    assert.doesNotMatch(src, /!\([^)]*\.lectureSeule/, `${page} : la règle n'est plus recopiée`);
  }
});

test('Paramètres : le mode dégradé coupe aussi l\'écriture (même règle que les autres écrans)', () => {
  assert.equal(ecritureAutorisee({ modeDegrade: true }), false);
});

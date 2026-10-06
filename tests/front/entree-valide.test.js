// Touche Entrée dans Paramètres (règle du design system), contrôles d'écriture en lecture seule, bandeau « Données d'exemple ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { entreeValide, validerParEntree } from '../../public/js/entree.js';

const lire = (...p) => fs.readFile(path.join(RACINE, ...p), 'utf8');

test('entreeValide : Entrée dans un champ texte ou nombre valide ; pas dans une liste, une case, un bouton, ni pendant une composition', () => {
  const evt = (key, tagName, type, isComposing = false) => ({ key, isComposing, target: { tagName, type } });
  assert.equal(entreeValide(evt('Enter', 'INPUT', 'text')), true);
  assert.equal(entreeValide(evt('Enter', 'input', 'number')), true);
  assert.equal(entreeValide(evt('Enter', 'INPUT', 'checkbox')), false);
  assert.equal(entreeValide(evt('Enter', 'INPUT', 'radio')), false);
  assert.equal(entreeValide(evt('Enter', 'SELECT', undefined)), false);
  assert.equal(entreeValide(evt('Enter', 'BUTTON', 'button')), false);
  assert.equal(entreeValide(evt('Enter', 'INPUT', 'text', true)), false);
  assert.equal(entreeValide(evt('a', 'INPUT', 'text')), false);
  assert.equal(entreeValide(null), false);
});

test('validerParEntree : clique sur le bouton, sauf s\'il est désactivé ou occupé', () => {
  let ecoute;
  const zone = { addEventListener: (nom, f) => { assert.equal(nom, 'keydown'); ecoute = f; } };
  let clics = 0;
  const attributs = {};
  const bouton = { disabled: false, getAttribute: (n) => attributs[n] ?? null, click: () => { clics++; } };
  validerParEntree(zone, bouton);
  let evite = 0;
  const entree = { key: 'Enter', isComposing: false, target: { tagName: 'INPUT', type: 'text' }, preventDefault: () => { evite++; } };
  ecoute(entree);
  assert.equal(clics, 1);
  assert.equal(evite, 1);
  bouton.disabled = true;
  ecoute(entree);
  assert.equal(clics, 1, 'bouton désactivé : rien');
  bouton.disabled = false;
  attributs['aria-busy'] = 'true';
  ecoute(entree);
  assert.equal(clics, 1, 'en cours de traitement : pas de double envoi');
  attributs['aria-busy'] = null;
  ecoute({ ...entree, key: 'Tab' });
  assert.equal(clics, 1);
});

test('Paramètres : Entrée branchée sur l\'ajout, sur chaque ligne de tarif et sur le nombre de jours', async () => {
  const tarifs = await lire('public', 'js', 'pages', 'parametres-tarifs.js');
  assert.match(tarifs, /validerParEntree\(groupeAjout, ajouter\)/);
  assert.match(tarifs, /validerParEntree\(rangee, enregistrer\)/);
  const param = await lire('public', 'js', 'pages', 'parametres.js');
  assert.match(param, /validerParEntree\(champNombre\.racine, enregistrer\)/);
});

test('Paramètres : « Enregistrer » (nombre de jours) et son champ suivent la règle d\'écriture (lecture seule, conflit, mode dégradé)', async () => {
  const param = await lire('public', 'js', 'pages', 'parametres.js');
  assert.match(param, /const ecriture = ecritureAutorisee\(etat\);/);
  assert.match(param, /name: 'sauvegardesConservees', disabled: !ecriture/);
  assert.match(param, /texte: 'Enregistrer', attributs: \{ type: 'button', disabled: !ecriture \}/);
});

test('bandeau « Données d\'exemple » : affiché seulement si /api/etat annonce la démonstration', async () => {
  const b = await lire('public', 'js', 'bandeaux.js');
  assert.match(b, /if \(etat\.demonstration === true\) liste\.push\(alerte\('exemple', "Données d'exemple"/);
});

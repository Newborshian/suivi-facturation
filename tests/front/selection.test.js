// Sélection multiple des prestations (public/js/selection.js) : logique pure, plus lecture du code de l'écran (pas de DOM sous node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { appliquerSelection, etatBarreSelection, toutSelectionne } from '../../public/js/selection.js';

test('appliquerSelection : coche ajoute, décoche retire, sans doublon ; renvoie la même sélection', () => {
  const s = new Set();
  assert.equal(appliquerSelection(s, 'a', true), s);
  appliquerSelection(s, 'a', true);
  appliquerSelection(s, 'b', true);
  assert.deepEqual([...s], ['a', 'b']);
  appliquerSelection(s, 'a', false);
  appliquerSelection(s, 'inconnu', false);
  assert.deepEqual([...s], ['b']);
});

test('toutSelectionne : vrai seulement si toutes les lignes affichées (au moins une) sont sélectionnées', () => {
  assert.equal(toutSelectionne(['a', 'b'], new Set(['a', 'b', 'c'])), true);
  assert.equal(toutSelectionne(['a', 'b'], new Set(['a'])), false);
  assert.equal(toutSelectionne([], new Set(['a'])), false);
});

test('etatBarreSelection : masquée sans sélection, sinon le nombre au singulier ou au pluriel', () => {
  assert.deepEqual(etatBarreSelection(0), { visible: false, texte: '' });
  assert.deepEqual(etatBarreSelection(1), { visible: true, texte: '1 prestation sélectionnée' });
  assert.deepEqual(etatBarreSelection(3), { visible: true, texte: '3 prestations sélectionnées' });
});

test('écran Prestations (lecture du code) : cocher une case ne reconstruit pas la liste', async () => {
  const src = await fs.readFile(path.join(RACINE, 'public', 'js', 'pages', 'prestations.js'), 'utf8');
  const corps = /change: \(evenement\) => \{\n\s*\/\/ Seules[\s\S]*?\n\s*\},/.exec(src)?.[0];
  assert.ok(corps, 'gestionnaire de la case de ligne introuvable');
  assert.match(corps, /appliquerSelection\(page\.selection, l\.id/);
  assert.match(corps, /majSelection\(\)/);
  assert.doesNotMatch(corps, /rendreListe\(\)/);
});

// Aides à l'accessibilité (public/js/accessibilite.js) et liaison de l'aide d'un champ (lecture du code de ui.js : pas de DOM sous node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { descriptionChamp } from '../../public/js/accessibilite.js';

test('descriptionChamp : l\'aide d\'abord, l\'erreur ensuite seulement si le champ est en erreur ; rien à relier -> null', () => {
  assert.equal(descriptionChamp({ idAide: 'c-1-aide', idErreur: 'c-1-erreur', enErreur: false }), 'c-1-aide');
  assert.equal(descriptionChamp({ idAide: 'c-1-aide', idErreur: 'c-1-erreur', enErreur: true }), 'c-1-aide c-1-erreur');
  assert.equal(descriptionChamp({ idAide: null, idErreur: 'c-1-erreur', enErreur: true }), 'c-1-erreur');
  assert.equal(descriptionChamp({ idAide: null, idErreur: 'c-1-erreur', enErreur: false }), null);
  assert.equal(descriptionChamp(), null);
});

test('creerChamp (lecture du code) : le paragraphe d\'aide porte un identifiant et la saisie est reliée par aria-describedby', async () => {
  const src = await fs.readFile(path.join(RACINE, 'public', 'js', 'ui.js'), 'utf8');
  assert.match(src, /classe: 'champ__aide', texte: aide, attributs: \{ id: idAide \}/);
  assert.match(src, /descriptionChamp\(\{ idAide, idErreur, enErreur \}\)/);
  assert.doesNotMatch(src, /setAttribute\('aria-describedby', idErreur\)/, 'l\'erreur ne remplace plus l\'aide');
});

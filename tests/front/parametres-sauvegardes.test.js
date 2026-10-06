// Paramètres : le réglage des sauvegardes automatiques est présenté (et validé) en JOURS d'historique, pas en nombre de fichiers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { validerParametres } from '../../src/domain/validation.js';

test('texte du champ, aide, confirmation et message de validation parlent de jours d\'historique (nom technique du champ inchangé)', async () => {
  const s = await fs.readFile(path.join(RACINE, 'public', 'js', 'pages', 'parametres.js'), 'utf8');
  assert.ok(s.includes("label: \"Nombre de jours d'historique à conserver\""));
  assert.match(s, /aide: "[^"]*dernière de chacun des jours précédents[^"]*Entre 7 et 365\./);
  assert.match(s, /name: 'sauvegardesConservees'/);
  assert.match(s, /new Set\(sauvegardes\.filter\(\(s\) => s\.reserve === 'quotidienne'\)\.map\(\(s\) => s\.jour\)\)\.size/, 'la confirmation compte des jours distincts');
  assert.ok(!s.includes('Nombre de sauvegardes à conserver'));
  assert.ok(s.includes("Indiquez un nombre entier de jours d'historique à conserver, entre 7 et 365."));
});

test('serveur : borne 7 à 365 inchangée, message de validation en jours', () => {
  assert.deepEqual(validerParametres({ sauvegardesConservees: 7 }), { sauvegardesConservees: 7 });
  assert.deepEqual(validerParametres({ sauvegardesConservees: 365 }), { sauvegardesConservees: 365 });
  for (const mauvais of [6, 366, 3.5, '10', null]) {
    try {
      validerParametres({ sauvegardesConservees: mauvais });
      assert.fail(`${mauvais} aurait dû être refusé`);
    } catch (e) {
      assert.match(e.champs.sauvegardesConservees, /jours d'historique à conserver, entre 7 et 365/);
    }
  }
});

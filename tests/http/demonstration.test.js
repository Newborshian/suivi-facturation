// Mode démonstration : /api/etat annonce `demonstration` seulement si ERGO_MODE_DEMO=1 (posée par scripts/demo.mjs), jamais autrement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { lireConfig } from '../../src/config.js';
import { routesEtat } from '../../src/http/api/etat.js';

test('lireConfig : demonstration vaut vrai seulement avec ERGO_MODE_DEMO=1', () => {
  assert.equal(lireConfig({}, RACINE).demonstration, false);
  assert.equal(lireConfig({ ERGO_MODE_DEMO: '0' }, RACINE).demonstration, false);
  assert.equal(lireConfig({ ERGO_MODE_DEMO: 'oui' }, RACINE).demonstration, false);
  assert.equal(lireConfig({ ERGO_MODE_DEMO: ' 1 ' }, RACINE).demonstration, true);
});

async function etatAvec(config) {
  let gestionnaire;
  const routeur = { ajouter: (m, c, f) => { if (c === '/api/etat') gestionnaire = f; } };
  const store = { verifierFichier: async () => {}, etat: () => ({ modeDegrade: false, structureInconnue: false }), lire: () => ({ parametres: {} }) };
  routesEtat(routeur, { store, config, horloge: { aujourdHui: () => '2026-10-02' }, version: 't', presence: null });
  return (await gestionnaire()).corps;
}

test('/api/etat : demonstration absente en usage normal, vraie en démonstration', async () => {
  assert.equal((await etatAvec(lireConfig({}, RACINE))).demonstration, false);
  assert.equal((await etatAvec({ dossier: 'x', port: 0 })).demonstration, false);
  assert.equal((await etatAvec(lireConfig({ ERGO_MODE_DEMO: '1' }, RACINE))).demonstration, true);
});

test('scripts/demo.mjs impose ERGO_MODE_DEMO ; aucun autre fichier de lancement ne la pose', async () => {
  assert.match(await fs.readFile(path.join(RACINE, 'scripts', 'demo.mjs'), 'utf8'), /ERGO_MODE_DEMO: '1'/);
  for (const f of ['src/server.js', 'scripts/suivi.mjs']) assert.ok(!(await fs.readFile(path.join(RACINE, f), 'utf8')).includes('ERGO_MODE_DEMO'), f);
});

// Corps non attendu : les routes sans corps le vident, mais en refusant d'en recevoir plus que la limite (ignorerCorps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { LIMITE_CORPS, ignorerCorps } from '../../src/http/reponses.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { RACINE } from '../aides/temp.js';

test('ignorerCorps : un petit corps est vidé sans fermer la requête ; un corps au-delà de la limite détruit la requête', async () => {
  const petit = new PassThrough();
  ignorerCorps(petit, 100);
  petit.write(Buffer.alloc(100));
  petit.end();
  await new Promise((resolve) => petit.once('end', resolve));
  assert.equal(petit.readableEnded, true, 'corps entièrement vidé');
  assert.equal(petit.errored, null);

  const gros = new PassThrough();
  ignorerCorps(gros, 100);
  gros.write(Buffer.alloc(60));
  assert.equal(gros.destroyed, false);
  gros.write(Buffer.alloc(60));
  assert.equal(gros.destroyed, true, 'au-delà de 100 octets, la lecture s\'arrête et la requête est fermée');
  assert.equal(LIMITE_CORPS, 1024 * 1024);
});

test('routes sans corps (POST /api/sauvegardes, DELETE, arrêt) : plus aucun req.resume() non borné dans src/http/api', async () => {
  const dossier = path.join(RACINE, 'src', 'http', 'api');
  for (const nom of await fs.readdir(dossier)) {
    const source = await fs.readFile(path.join(dossier, nom), 'utf8');
    assert.doesNotMatch(source, /req\.resume\(\)/, `${nom} : utiliser ignorerCorps(req)`);
  }
});

test('POST /api/sauvegardes avec un petit corps inattendu : 201 comme avant', async () => {
  const s = await demarrerServeurTest();
  try {
    const r = await s.requete({ methode: 'POST', chemin: '/api/sauvegardes', headers: { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json', 'Content-Length': '2' }, corps: '{}' });
    assert.equal(r.status, 201);
  } finally {
    await s.arreter();
  }
});

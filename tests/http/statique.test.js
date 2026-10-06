import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE, creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { segmentsSurs } from '../../src/http/statique.js';

let s;
before(async () => { s = await demarrerServeurTest(); });
after(async () => { await s.arreter(); });

test('/ sert index.html ; types MIME et Cache-Control', async () => {
  const r = await s.requete({ chemin: '/' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.match(r.texte, /<h1>Facturation du mois<\/h1>/);
  assert.equal(r.texte, await fs.readFile(path.join(RACINE, 'public', 'index.html'), 'utf8'));

  assert.equal((await s.requete({ chemin: '/index.html' })).status, 200);
  assert.equal((await s.requete({ chemin: '/css/base.css' })).headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await s.requete({ chemin: '/js/pages/facturation.js' })).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await s.requete({ chemin: '/?x=1' })).status, 200, 'la query est ignorée');
  const head = await s.requete({ methode: 'HEAD', chemin: '/' });
  assert.equal(head.status, 200);
  assert.equal(head.texte, '');
});

test('path traversal : tous les chemins suspects reçoivent 404 sans contenu de fichier', async () => {
  const chemins = [
    '/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json', '/css/../../package.json',
    '/css/..%5c..%5cpackage.json', '/..\\package.json', '/css\\..\\..\\package.json', '/%5c..%5cpackage.json',
    '/index.html%00.png', '/%00', '/.gitignore', '/.env', '/css/.hidden.css', '/%2e%2e', '/..', '/./index.html',
    '/%c0%ae%c0%ae/package.json', '/%ZZ', '/%', '//package.json', '/css//base.css', '/css/', '/css',
    '/index.html::$DATA', '/index.html.', '/index.html%20', '/nul.html', '/CON.js', '/aux.css',
    '/../src/server.js', '/../data/suivi-facturation.json', '/package.json', '/src/server.js', '/config/exemple.json', '/tests/aides/temp.js',
  ];
  for (const chemin of chemins) {
    const r = await s.requete({ chemin });
    assert.equal(r.status, 404, chemin);
    assert.ok(!r.texte.includes('"name": "suivi-facturation"') && !r.texte.includes('import '), `${chemin} : contenu fuité`);
  }
});

test('extensions hors liste blanche : 404 même si le fichier existe (racine publique temporaire)', async () => {
  const pub = await creerDossierTemp('public');
  let t;
  try {
    await fs.writeFile(path.join(pub, 'ok.html'), '<p>ok</p>');
    await fs.writeFile(path.join(pub, 'temoin.json'), '{}');
    await fs.writeFile(path.join(pub, 'script.exe'), 'x');
    t = await demarrerServeurTest({ racinePublic: pub });
    assert.equal((await t.requete({ chemin: '/ok.html' })).status, 200);
    assert.equal((await t.requete({ chemin: '/temoin.json' })).status, 404);
    assert.equal((await t.requete({ chemin: '/script.exe' })).status, 404);
  } finally {
    if (t) await t.arreter();
    await supprimerDossierTemp(pub);
  }
});

test('un dossier n\'est pas listé', async () => {
  for (const chemin of ['/css', '/js', '/js/pages']) assert.equal((await s.requete({ chemin })).status, 404, chemin);
});

test('méthode POST sur un fichier statique : 405 (avec Origin valide)', async () => {
  const r = await s.requete({ methode: 'POST', chemin: '/index.html', headers: { Origin: `http://127.0.0.1:${s.port}` } });
  assert.equal(r.status, 405);
});

test('segmentsSurs : unité', () => {
  assert.deepEqual(segmentsSurs('/'), ['index.html']);
  assert.deepEqual(segmentsSurs('/css/base.css'), ['css', 'base.css']);
  assert.deepEqual(segmentsSurs('/js/pages/facturation.js'), ['js', 'pages', 'facturation.js']);
  assert.throws(() => segmentsSurs('css/base.css'), { status: 404 });
  assert.throws(() => segmentsSurs('http://evil/x'), { status: 404 });
});

test('la requête ne peut pas sortir de la racine publique via un lien symbolique', async (t) => {
  const pub = await creerDossierTemp('public');
  const dehors = await creerDossierTemp('dehors');
  let serveur;
  try {
    await fs.writeFile(path.join(dehors, 'secret.html'), '<p>secret</p>');
    try {
      await fs.symlink(path.join(dehors, 'secret.html'), path.join(pub, 'lien.html'), 'file');
    } catch (e) {
      t.skip(`création de lien symbolique impossible (${e.code}) : droits Windows ; non vérifié`);
      return;
    }
    serveur = await demarrerServeurTest({ racinePublic: pub });
    const r = await serveur.requete({ chemin: '/lien.html' });
    assert.equal(r.status, 404);
    assert.ok(!r.texte.includes('secret'));
  } finally {
    if (serveur) await serveur.arreter();
    await supprimerDossierTemp(pub);
    await supprimerDossierTemp(dehors);
  }
});

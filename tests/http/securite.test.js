import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { EN_TETES_SECURITE } from '../../src/http/securite.js';

let s;
before(async () => { s = await demarrerServeurTest(); });
after(async () => { await s.arreter(); });

test('le serveur écoute sur 127.0.0.1 uniquement (IPv4 loopback)', () => {
  const adresse = s.app.server.address();
  assert.equal(adresse.address, '127.0.0.1');
  assert.equal(adresse.family, 'IPv4');
  assert.equal(adresse.port, s.port);
});

test('Host : 127.0.0.1:port et localhost:port acceptés', async () => {
  assert.equal((await s.requete({ chemin: '/api/sante' })).status, 200);
  assert.equal((await s.requete({ chemin: '/api/sante', hote: `localhost:${s.port}` })).status, 200);
  assert.equal((await s.requete({ chemin: '/api/sante', hote: `LOCALHOST:${s.port}` })).status, 200);
});

test('Host : nom étranger, port différent, absence de port, vide = 403 HOTE_REFUSE (DNS rebinding)', async () => {
  for (const hote of ['evil.example', `evil.example:${s.port}`, '127.0.0.1', `127.0.0.1:${s.port + 1}`, 'localhost', `127.0.0.1.evil.example:${s.port}`, `0.0.0.0:${s.port}`, `[::1]:${s.port}`]) {
    const r = await s.requete({ chemin: '/api/sante', hote });
    assert.equal(r.status, 403, hote);
    assert.equal(r.json.erreur.code, 'HOTE_REFUSE', hote);
  }
  // le refus vaut aussi pour les fichiers statiques
  assert.equal((await s.requete({ chemin: '/', hote: 'evil.example' })).status, 403);
});

test('Sec-Fetch-Site : cross-site et same-site refusés, same-origin et none acceptés', async () => {
  for (const v of ['cross-site', 'same-site']) {
    const r = await s.requete({ chemin: '/api/sante', headers: { 'Sec-Fetch-Site': v } });
    assert.equal(r.status, 403, v);
    assert.equal(r.json.erreur.code, 'ORIGINE_REFUSEE');
  }
  for (const v of ['same-origin', 'none']) {
    assert.equal((await s.requete({ chemin: '/api/sante', headers: { 'Sec-Fetch-Site': v } })).status, 200, v);
  }
});

test('Origin : obligatoire et locale pour POST/PATCH/DELETE ; absente ou étrangère = 403', async () => {
  const origineOk = `http://127.0.0.1:${s.port}`;
  for (const methode of ['POST', 'PATCH', 'DELETE']) {
    const sans = await s.requete({ methode, chemin: '/api/sante' });
    assert.equal(sans.status, 403, `${methode} sans Origin`);
    assert.equal(sans.json.erreur.code, 'ORIGINE_REFUSEE');
    for (const origine of ['http://evil.example', `http://127.0.0.1:${s.port + 1}`, 'null', `https://127.0.0.1:${s.port}`]) {
      const r = await s.requete({ methode, chemin: '/api/sante', headers: { Origin: origine } });
      assert.equal(r.status, 403, `${methode} ${origine}`);
    }
    // Origin correcte : on passe le contrôle de sécurité (la route n'accepte pas cette méthode : 405)
    assert.equal((await s.requete({ methode, chemin: '/api/sante', headers: { Origin: origineOk } })).status, 405);
  }
  assert.equal((await s.requete({ methode: 'POST', chemin: '/api/sante', headers: { Origin: `http://localhost:${s.port}` } })).status, 405);
});

test('méthodes : GET/HEAD/POST/PATCH/DELETE seulement ; PUT, OPTIONS, TRACE refusés (CONNECT : géré par Node, non routé)', async () => {
  const origine = { Origin: `http://127.0.0.1:${s.port}` };
  for (const methode of ['PUT', 'OPTIONS', 'TRACE']) {
    const r = await s.requete({ methode, chemin: '/api/sante', headers: origine });
    assert.equal(r.status, 405, methode);
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'aucun en-tête CORS');
  }
  const head = await s.requete({ methode: 'HEAD', chemin: '/api/sante' });
  assert.equal(head.status, 200);
  assert.equal(head.texte, '');
});

test('CSP et en-têtes de sécurité présents sur API, statique, 404 et refus', async () => {
  const reponses = [
    await s.requete({ chemin: '/api/sante' }),
    await s.requete({ chemin: '/' }),
    await s.requete({ chemin: '/css/base.css' }),
    await s.requete({ chemin: '/introuvable.html' }),
    await s.requete({ chemin: '/api/inconnu' }),
    await s.requete({ chemin: '/api/sante', hote: 'evil.example' }),
  ];
  for (const r of reponses) {
    for (const [nom, valeur] of Object.entries(EN_TETES_SECURITE)) {
      assert.equal(r.headers[nom.toLowerCase()], valeur, nom);
    }
  }
  const csp = reponses[0].headers['content-security-policy'];
  for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'self'"]) {
    assert.ok(csp.includes(d), d);
  }
  assert.ok(!/unsafe-inline|unsafe-eval|\*|https?:/.test(csp), 'CSP stricte : pas d\'unsafe-*, pas de joker, pas d\'hôte externe');
});

test('aucun en-tête CORS n\'est jamais renvoyé', async () => {
  const r = await s.requete({ chemin: '/api/etat', headers: { Origin: 'http://evil.example' } });
  assert.equal(Object.keys(r.headers).filter((h) => h.startsWith('access-control-')).length, 0);
});

test('pages HTML et feuilles : aucune ressource externe, aucun script ou style en ligne, aucun attribut style', async () => {
  const pages = await fs.readdir(path.join(RACINE, 'public'));
  for (const nom of pages.filter((n) => n.endsWith('.html'))) {
    const html = await fs.readFile(path.join(RACINE, 'public', nom), 'utf8');
    assert.ok(!/https?:\/\//i.test(html), `${nom} : URL externe`);
    assert.ok(!/<style[\s>]/i.test(html), `${nom} : <style> en ligne`);
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), `${nom} : script en ligne`);
    assert.ok(!/\sstyle\s*=/i.test(html), `${nom} : attribut style`);
    assert.ok(!/\son\w+\s*=/i.test(html), `${nom} : gestionnaire en ligne`);
    assert.ok(!/innerHTML/.test(html));
  }
  for (const nom of await fs.readdir(path.join(RACINE, 'public', 'js', 'pages'))) {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(await fs.readFile(path.join(RACINE, 'public', 'js', 'pages', nom), 'utf8')), nom);
  }
});

// Seule exception : la sonde de src/verrou.js vers http://127.0.0.1:<port>/api/sante (instance unique), adresse en dur.
const SONDE_VERROU = "http.get({ host: '127.0.0.1', port, path: '/api/sante'";
test('src/ ne contient aucun appel réseau sortant ni écoute hors 127.0.0.1', async () => {
  const fichiers = [];
  async function parcourir(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await parcourir(p);
      else if (p.endsWith('.js')) fichiers.push(p);
    }
  }
  await parcourir(path.join(RACINE, 'src'));
  assert.ok(fichiers.length > 10);
  for (const f of fichiers) {
    let code = await fs.readFile(f, 'utf8');
    if (path.basename(f) === 'verrou.js') code = code.replace(SONDE_VERROU, '');
    assert.ok(!/\bfetch\s*\(|http\.request|http\.get|https\.|node:https|node:net|node:dgram|node:dns|XMLHttpRequest|WebSocket|0\.0\.0\.0/.test(code), `${path.relative(RACINE, f)} : appel réseau suspect`);
  }
});

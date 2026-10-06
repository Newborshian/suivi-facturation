// Recette QA : robustesse du serveur face à des requêtes malformées ou hostiles (octets aléatoires, en-têtes énormes, Content-Length faux,
// connexions abandonnées). Le serveur doit rester disponible et ne jamais écrire de données.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { client, lireDisque, octetsDisque, saisie } from './aides-qa.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { alea } from './aides-qa.js';

function brut(port, octets, { attente = 300 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const morceaux = [];
    socket.on('data', (m) => morceaux.push(m));
    socket.on('error', () => {});
    socket.on('close', () => resolve(Buffer.concat(morceaux).toString('latin1')));
    socket.on('connect', () => {
      socket.write(octets);
      setTimeout(() => socket.destroy(), attente);
    });
  });
}

test('octets aléatoires, requêtes tronquées et méthodes inconnues : le serveur répond encore ensuite, aucune écriture', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    await a.post('/api/prestations', saisie());
    const avant = await octetsDisque(s.dossier);
    const r = alea(7);
    for (let i = 0; i < 30; i++) await brut(s.port, Buffer.from(Array.from({ length: 200 }, () => Math.floor(r() * 256))));
    for (const requete of [
      'GET', 'GET /', 'GET / HTTP/1.1', 'GET / HTTP/1.1\r\nHost', 'POST /api/prestations HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 99999\r\n\r\n{',
      'BREW /api/prestations HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n', 'GET /api/prestations HTTP/9.9\r\n\r\n', 'GET http://evil.example/ HTTP/1.1\r\nHost: evil.example\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nHost: evil.example\r\n\r\n', 'POST /api/prestations HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: -1\r\n\r\n',
      'POST /api/prestations HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n0\r\n\r\n',
    ]) {
      const reponse = await brut(s.port, requete);
      assert.ok(!reponse.includes('201 Created'), `aucune création : ${JSON.stringify(requete.slice(0, 40))}`);
    }
    assert.equal((await a.get('/api/sante')).status, 200, 'le serveur répond toujours');
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 1);
    assert.ok((await octetsDisque(s.dossier)).equals(avant));
  } finally {
    await s.arreter();
  }
});

test('en-têtes énormes (> 16 Ko), URL très longue, 200 en-têtes : refusés par Node (431/414/400) sans planter ; la requête suivante fonctionne', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    const enormeEnTete = await brut(s.port, `GET /api/sante HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nX-Gros: ${'a'.repeat(40_000)}\r\n\r\n`);
    assert.match(enormeEnTete, /^HTTP\/1\.1 (431|400)/);
    const urlLongue = await brut(s.port, `GET /api/prestations?mois=${'9'.repeat(40_000)} HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\n\r\n`);
    assert.match(urlLongue, /^HTTP\/1\.1 (414|431|400)/);
    const beaucoup = Array.from({ length: 200 }, (_, i) => `X-${i}: v`).join('\r\n');
    await brut(s.port, `GET /api/sante HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\n${beaucoup}\r\n\r\n`);
    const long = await a.get(`/api/prestations?mois=${'9'.repeat(3000)}`);
    assert.equal(long.status, 400);
    assert.equal((await a.get('/api/sante')).status, 200);
  } finally {
    await s.arreter();
  }
});

test('connexions abandonnées en plein envoi de corps : aucune écriture partielle, le serveur reste disponible', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    const avant = JSON.stringify(await lireDisque(s.dossier));
    const corps = JSON.stringify(saisie());
    for (let i = 0; i < 20; i++) {
      await brut(s.port, `POST /api/prestations HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nOrigin: http://127.0.0.1:${s.port}\r\nContent-Type: application/json\r\nContent-Length: ${corps.length}\r\n\r\n${corps.slice(0, 20)}`, { attente: 50 });
    }
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 0);
    assert.equal(JSON.stringify(await lireDisque(s.dossier)), avant);
    assert.equal((await a.post('/api/prestations', saisie())).status, 201);
  } finally {
    await s.arreter();
  }
});

test('50 connexions simultanées de lecture + 20 écritures : toutes les écritures sont appliquées, aucune réponse 5xx', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    const lectures = Array.from({ length: 50 }, () => a.get('/api/indicateurs/synthese'));
    const ecritures = Array.from({ length: 20 }, (_, i) => a.post('/api/prestations', saisie({ motif: `c${i}` })));
    const toutes = await Promise.all([...lectures, ...ecritures]);
    assert.ok(toutes.every((r) => r.status < 500), toutes.map((r) => r.status).join(','));
    assert.equal(ecritures.length, toutes.filter((r) => r.status === 201).length);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 20);
  } finally {
    await s.arreter();
  }
});

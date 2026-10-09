// Présence de la page (arrêt automatique) : chargée par toutes les pages, conforme à la CSP, textes et comportements convenus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { RACINE } from '../aides/temp.js';
import { creerPresence } from '../../src/presence.js';
import { creerMinuteursSimules } from '../aides/minuteurs-simules.js';

const PUBLIC = path.join(RACINE, 'public');
const lire = (...p) => fs.readFile(path.join(PUBLIC, ...p), 'utf8');

test('les 5 pages HTML chargent /js/presence.js en module, sans script en ligne', async () => {
  const pages = (await fs.readdir(PUBLIC)).filter((n) => n.endsWith('.html'));
  assert.equal(pages.length, 5);
  for (const page of pages) {
    const html = await lire(page);
    assert.equal(html.match(/<script type="module" src="\/js\/presence\.js"><\/script>/g)?.length, 1, page);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, page);
  }
});

test('presence.js : identifiant par chargement de page (sans stockage), battement 15 s keepalive, sendBeacon sur pagehide, pageshow persisted', async () => {
  const s = await lire('js', 'presence.js');
  assert.match(s, /crypto\.randomUUID\(\)/);
  assert.ok(!/sessionStorage|localStorage/.test(s), 'aucun stockage : un onglet dupliqué ne partage pas l\'identifiant');
  assert.match(s, /PERIODE_MS = 15_000/);
  assert.match(s, /keepalive: true/);
  assert.match(s, /method: 'POST'/);
  assert.match(s, /navigator\.sendBeacon\(CHEMIN, corps\('fermee'\)\)/);
  assert.match(s, /addEventListener\('pagehide'/);
  assert.match(s, /addEventListener\('pageshow'[\s\S]*evenement\.persisted/);
  assert.equal(s.match(/\/api\/presence/g).length, 1, 'un seul chemin');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|https?:\/\/|\.style|setAttribute\(\s*['"]style/.test(s));
});

test('presence.js : plus aucune requête après l\'arrêt manuel ; message unique après deux échecs de suite', async () => {
  const s = await lire('js', 'presence.js');
  assert.match(s, /export function arreterPresence\(\)/);
  assert.match(s, /if \(arretee\) return;[\s\S]*await fetch/, 'le battement ne part plus une fois arrêté');
  assert.match(s, /pagehide[\s\S]{0,80}if \(arretee\) return;/, 'pas de « fermee » après l\'arrêt');
  assert.match(s, /ECHECS_MAX = 2/);
  assert.match(s, /if \(echecs >= ECHECS_MAX\) signalerArret\(\)/);
  assert.match(s, /echecs = 0;/, 'un succès remet le compteur à zéro');
  assert.ok(s.includes("L'application est arrêtée."));
  assert.ok(s.includes('Pour la relancer, utilisez le raccourci Suivi Facturation du Bureau, puis rechargez cette page.'));
  const signal = s.slice(s.indexOf('function signalerArret'), s.indexOf('/** Plus aucune requête'));
  assert.match(signal, /arreterPresence\(\)/, 'le message n\'apparaît qu\'une fois : les battements s\'arrêtent avec lui');
  assert.ok(!/fetch\(|setInterval|setTimeout/.test(signal), 'aucune autre action automatique');
});

/** Exécute presence.js comme une page : globaux simulés, battements envoyés à `envoyer`. Chaque appel = un chargement de page. */
async function chargerPage(envoyer, stockageSession) {
  const source = (await lire('js', 'presence.js')).replace(/^import .*$/gm, '').replace(/^export function/gm, 'function');
  const page = { battements: null, pagehide: null };
  const contexte = {
    crypto: globalThis.crypto,
    sessionStorage: stockageSession, // copié d'un onglet à l'autre lors d'un « Dupliquer l'onglet »
    fetch: async (_url, options) => { envoyer(JSON.parse(options.body)); return {}; },
    navigator: { sendBeacon: (_url, corps) => { envoyer(JSON.parse(corps)); return true; } },
    addEventListener: (nom, fn) => { if (nom === 'pagehide') page.pagehide = fn; },
    setInterval: (fn) => { page.battements = fn; return 1; },
    clearInterval: () => {},
    document: { querySelector: () => null },
    alerte: () => null,
    el: () => null,
    JSON,
  };
  vm.runInNewContext(source, contexte);
  await new Promise((r) => setImmediate(r)); // le premier battement part tout de suite
  return page;
}

test('deux pages (dont un onglet dupliqué) ont des identifiants distincts ; fermer l\'une n\'arrête pas le serveur tant que l\'autre bat', async () => {
  const horloge = creerMinuteursSimules();
  const arrets = [];
  const presence = creerPresence({ actif: true, surArret: (r) => arrets.push(r), maintenant: horloge.maintenant, minuteurs: horloge.minuteurs });
  const vus = [];
  const envoyer = (signal) => { vus.push(signal.id); presence.signaler(signal.id, signal.etat); };
  presence.demarrer();

  const session = new Map(); // « Dupliquer l'onglet » copie le stockage de session : le même objet pour les deux pages
  const stockage = { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) };
  const a = await chargerPage(envoyer, stockage);
  const b = await chargerPage(envoyer, stockage);
  assert.equal(new Set(vus).size, 2, 'un identifiant différent par chargement');
  assert.equal(presence.nombre(), 2);

  a.pagehide(); // l'onglet d'origine se ferme
  assert.equal(presence.nombre(), 1);
  for (let i = 0; i < 6; i++) { // 90 s : l'autre page bat toutes les 15 s
    horloge.avancer(15_000);
    b.battements();
  }
  assert.deepEqual(arrets, [], 'le serveur reste lancé');
  assert.equal(presence.nombre(), 1);

  b.pagehide(); // dernière page fermée : le délai de grâce s'écoule
  horloge.avancer(12_000);
  assert.equal(arrets.length, 1);
  assert.match(arrets[0], /dernière page/);
});

test('un rechargement (nouvel identifiant) est couvert par le délai de grâce', async () => {
  const horloge = creerMinuteursSimules();
  const arrets = [];
  const presence = creerPresence({ actif: true, surArret: (r) => arrets.push(r), maintenant: horloge.maintenant, minuteurs: horloge.minuteurs });
  const envoyer = (s) => presence.signaler(s.id, s.etat);
  presence.demarrer();
  const avant = await chargerPage(envoyer, null);
  avant.pagehide();
  horloge.avancer(3000);
  await chargerPage(envoyer, null);
  horloge.avancer(30_000);
  assert.deepEqual(arrets, []);
});

test('Paramètres : le bouton « Quitter l\'application » arrête les battements', async () => {
  const s = await lire('js', 'pages', 'parametres.js');
  assert.match(s, /import \{ arreterPresence \} from '\/js\/presence\.js';/);
  const bloc = s.slice(s.indexOf('function afficherArretee'), s.indexOf('async function quitter'));
  assert.match(bloc, /arreterPresence\(\)/);
});

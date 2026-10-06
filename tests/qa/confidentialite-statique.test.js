// Recette QA : analyse statique du code livré — aucun appel réseau sortant, aucun CDN, aucune écriture de HTML à partir de données,
// serveur lié à 127.0.0.1, aucun secret ni jeton. Complète tests/front/conformite-csp.test.js par une recherche plus large.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';

async function fichiers(dossier, extensions) {
  const sortie = [];
  for (const e of await fs.readdir(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, e.name);
    if (e.isDirectory()) sortie.push(...(await fichiers(chemin, extensions)));
    else if (extensions.includes(path.extname(e.name))) sortie.push(chemin);
  }
  return sortie;
}
const lire = async (chemins) => Promise.all(chemins.map(async (c) => ({ c: path.relative(RACINE, c), t: await fs.readFile(c, 'utf8') })));
const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');

test('public/ : aucune URL absolue (http, https, //, ws) hors espaces de noms XML ; aucune ressource externe dans les pages HTML et CSS', async () => {
  const sources = await lire(await fichiers(path.join(RACINE, 'public'), ['.js', '.html', '.css']));
  assert.ok(sources.length >= 30);
  for (const { c, t } of sources) {
    const code = c.endsWith('.js') ? sansCommentaires(t) : t;
    for (const m of code.matchAll(/(?:https?:|wss?:)\/\/[^\s"'`)<>]+/g)) {
      assert.ok(m[0] === 'http://www.w3.org/2000/svg', `${c} : URL absolue « ${m[0]} »`);
    }
    assert.ok(!/(?:src|href|action)\s*=\s*["']\/\//.test(code), `${c} : URL relative au protocole`);
    assert.ok(!/@import\s+url\(\s*["']?(?:https?:)?\/\//.test(code), `${c} : @import externe`);
    assert.ok(!/url\(\s*["']?(?:https?:)?\/\//.test(code), `${c} : url() externe`);
  }
});

test('public/js : les seuls appels réseau sont des fetch vers /api/ (chemin relatif) ; aucun XMLHttpRequest, WebSocket, EventSource, sendBeacon, import() dynamique, Worker', async () => {
  const sources = await lire(await fichiers(path.join(RACINE, 'public', 'js'), ['.js']));
  for (const { c, t } of sources) {
    const code = sansCommentaires(t);
    for (const interdit of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'new Worker', 'SharedWorker', 'serviceWorker', 'importScripts']) {
      // Seule exception (arrêt automatique) : sendBeacon vers /api/presence, dans presence.js uniquement.
      if (interdit === 'sendBeacon' && c.endsWith(path.join('js', 'presence.js'))) {
        assert.deepEqual([...code.matchAll(/sendBeacon\s*\(\s*CHEMIN/g)].length, code.split('sendBeacon').length - 1, `${c} : sendBeacon hors de CHEMIN`);
        assert.match(code, /const CHEMIN = '\/api\/presence'/);
        continue;
      }
      assert.ok(!code.includes(interdit), `${c} : ${interdit}`);
    }
    assert.ok(!/\bimport\s*\(/.test(code), `${c} : import() dynamique`);
    for (const m of code.matchAll(/\bfetch\s*\(([^)]*)/g)) {
      assert.match(m[1].trim(), /^(?:`\/api\/|'\/api\/|"\/api\/|chemin|url|input|resource|[a-zA-Z_.]+\s*$|[a-zA-Z_.]+\s*,)/, `${c} : fetch inattendu « ${m[0]} »`);
    }
  }
  const api = sources.find((s) => s.c.endsWith(path.join('js', 'api.js')));
  assert.ok(api, 'public/js/api.js existe');
  assert.match(api.t, /\/api\//);
});

test('public/js : aucune écriture de HTML ni exécution de texte (innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new Function, setTimeout(texte), srcdoc)', async () => {
  const sources = await lire(await fichiers(path.join(RACINE, 'public', 'js'), ['.js']));
  for (const { c, t } of sources) {
    const code = sansCommentaires(t);
    for (const interdit of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\b/, /\bsetTimeout\s*\(\s*['"`]/, /\bsetInterval\s*\(\s*['"`]/, /srcdoc/, /createContextualFragment/, /DOMParser/, /\.setAttribute\(\s*['"]on/i, /\.setAttribute\(\s*['"]style['"]/, /location\s*=\s*[^=]/, /window\.open/]) {
      assert.ok(!interdit.test(code), `${c} : ${interdit}`);
    }
  }
});

test('pages HTML : aucun script ni style en ligne, aucun gestionnaire d\'événement (onclick…), aucun attribut style, aucun formulaire à envoi, liens internes uniquement', async () => {
  for (const { c, t } of await lire(await fichiers(path.join(RACINE, 'public'), ['.html']))) {
    const scripts = [...t.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attrs, corps] of scripts) {
      assert.match(attrs, /\bsrc="\/js\/[\w.\-/]+\.js"/, `${c} : script sans src local`);
      assert.equal(corps.trim(), '', `${c} : script en ligne`);
    }
    assert.ok(!/<style\b/i.test(t), `${c} : <style> en ligne`);
    assert.ok(!/\sstyle\s*=/i.test(t), `${c} : attribut style`);
    assert.ok(!/\son[a-z]+\s*=/i.test(t), `${c} : gestionnaire d'événement en ligne`);
    assert.ok(!/<form\b[^>]*\baction\s*=\s*["'](?!\/)/i.test(t), `${c} : formulaire vers l'extérieur`);
    for (const m of t.matchAll(/\bhref="([^"]*)"/g)) assert.match(m[1], /^(?:\/|#|[\w-]+\.html)/, `${c} : lien « ${m[1]} »`);
    assert.ok(!/<(?:iframe|object|embed|base|meta\s+http-equiv)/i.test(t), `${c} : élément à risque`);
    assert.match(t, /<html[^>]*\blang="fr"/, `${c} : langue française déclarée`);
  }
});

// Seule exception : la sonde de src/verrou.js vers http://127.0.0.1:<port>/api/sante (instance unique), adresse en dur.
const SONDE_VERROU = "http.get({ host: '127.0.0.1', port, path: '/api/sante'";
// Autre exception : src/verrou.js lit l'heure de démarrage d'un processus (PowerShell sous Windows, ps ailleurs) par execFile, commandes fixes, sans shell.
const IMPORT_EXECFILE = "import { execFile } from 'node:child_process';";
test('src/ : aucun appel réseau sortant (http.request, fetch, net.connect, dns, https, WebSocket) ; écoute en dur sur 127.0.0.1 ; aucun jeton ni mot de passe', async () => {
  const sources = await lire(await fichiers(path.join(RACINE, 'src'), ['.js']));
  for (const { c, t } of sources) {
    let code = sansCommentaires(t);
    if (c.endsWith('verrou.js')) {
      code = code.replace(SONDE_VERROU, '').replace(IMPORT_EXECFILE, '');
      assert.ok(!/(?<![.\w])(?:exec|execSync|spawn|spawnSync|fork)\s*\(|\bshell\s*:/.test(code), 'verrou.js : seul execFile (sans shell) est autorisé');
      assert.equal(code.match(/\bexecFile\(/g)?.length, 1, 'verrou.js : un seul appel de commande');
    }
    for (const interdit of [/http\.request\b/, /http\.get\b/, /https\.(?:request|get)/, /\bfetch\s*\(/, /net\.connect/, /net\.createConnection/, /from\s+['"]node:(?:https|dns|net|tls|dgram|child_process|worker_threads|cluster)['"]/, /require\(\s*['"](?:https|dns|net|tls)/, /WebSocket/, /\bXMLHttpRequest/, /child_process/]) {
      assert.ok(!interdit.test(code), `${c} : ${interdit}`);
    }
    assert.ok(!/0\.0\.0\.0|'::'|"::"|listen\([^)]*['"]localhost['"]/.test(code), `${c} : écoute non locale`);
    assert.ok(!/(?:password|passwd|token|secret|api[_-]?key|bearer)\s*[:=]\s*['"][^'"]{6,}/i.test(code), `${c} : secret en dur`);
  }
  const serveur = sources.find((s) => s.c.endsWith(path.join('http', 'serveur.js')));
  assert.match(serveur.t, /ADRESSE_ECOUTE = '127\.0\.0\.1'/);
  assert.match(serveur.t, /server\.listen\(port, ADRESSE_ECOUTE/);
});

test('package.json : aucune dépendance (ni dependencies, ni devDependencies, ni scripts d\'installation) ; Node 24 ; ESM ; licence MIT ; aucun dossier node_modules ni public/vendor rempli', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(RACINE, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.optionalDependencies, undefined);
  for (const crochet of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) assert.equal(pkg.scripts?.[crochet], undefined, crochet);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.match(pkg.engines.node, /24/);
  await assert.rejects(fs.stat(path.join(RACINE, 'node_modules')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(RACINE, 'public', 'vendor')), { code: 'ENOENT' });
});

test('jeu d\'exemple config/exemple.json : valide, factice (aucun nom réel connu), couvre tous les types, les trois états, deux statuts, ≥ 12 mois, une date future et un doublon potentiel', async () => {
  const { controlerStructure } = await import('../../src/domain/schema.js');
  const { etatPaiement } = await import('../../src/domain/paiement.js');
  const etat = JSON.parse(await fs.readFile(path.join(RACINE, 'config', 'exemple.json'), 'utf8'));
  assert.deepEqual(controlerStructure(etat), []);
  const types = new Set(etat.prestations.map((l) => l.prestationId));
  assert.equal(types.size, etat.catalogue.length, `tous les types du catalogue utilisés (${types.size})`);
  assert.deepEqual([...new Set(etat.prestations.map((l) => etatPaiement(l).etat))].sort(), ['non_paye', 'partiel', 'paye']);
  assert.deepEqual([...new Set(etat.prestations.map((l) => l.statut))].sort(), ['a_facturer', 'facture']);
  assert.ok(new Set(etat.prestations.map((l) => l.date.slice(0, 7))).size >= 12, 'au moins 12 mois');
  assert.ok(etat.prestations.some((l) => etatPaiement(l).etat === 'partiel' && l.versements.length >= 2), 'un partiel à versements multiples');
  const cles = etat.prestations.map((l) => `${l.patient.id}|${l.date}|${l.prestationId}`);
  assert.ok(new Set(cles).size < cles.length, 'au moins un doublon potentiel');
  const noms = etat.prestations.map((l) => `${l.patient.prenom} ${l.patient.nom}`);
  assert.ok(new Set(noms).size >= 5, 'plusieurs patients');
  // noms manifestement inventés : pas de grande série de noms de famille courants
  const COURANTS = ['martin', 'bernard', 'dubois', 'thomas', 'robert', 'richard', 'petit', 'durand', 'leroy', 'moreau', 'simon', 'laurent', 'lefebvre', 'michel', 'garcia', 'david', 'bertrand', 'roux', 'vincent', 'fournier', 'morel', 'girard', 'andre', 'mercier', 'dupont', 'dupond', 'lambert', 'bonnet', 'francois', 'martinez'];
  for (const l of etat.prestations) assert.ok(!COURANTS.includes(l.patient.nom.toLowerCase()), `nom de famille courant dans l'exemple : ${l.patient.nom}`);
});

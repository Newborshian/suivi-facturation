// Bouton « Quitter l'application » (écran Paramètres) : textes imposés, appel unique à /api/arreter, aucun réseau après l'arrêt, conformité CSP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';

const source = () => fs.readFile(path.join(RACINE, 'public', 'js', 'pages', 'parametres.js'), 'utf8');

test('Paramètres : section « Application », confirmation et message final aux textes convenus', async () => {
  const s = await source();
  assert.match(s, /sectionApplication\(\)/);
  assert.match(s, /\['application', 'Application'\]/, 'entrée du sommaire');
  assert.ok(s.includes('titre: "Quitter l\'application ?"'));
  assert.ok(s.includes("'Vos données sont enregistrées.'"));
  assert.ok(s.includes("'Pour la rouvrir, utilisez le raccourci Suivi Facturation.'"));
  assert.ok(s.includes('texte: "L\'application est arrêtée."'));
  assert.ok(s.includes("texte: 'Vous pouvez fermer cet onglet.'"));
});

test('Paramètres : un seul appel à /api/arreter, en POST, après confirmation ; aucun appel réseau après l\'arrêt', async () => {
  const s = await source();
  assert.equal(s.match(/\/api\/arreter/g).length, 1);
  assert.match(s, /appeler\('POST', '\/api\/arreter'\)/);
  assert.ok(s.indexOf('await confirmer(') < s.indexOf("'/api/arreter'"), "la confirmation précède l'appel");
  assert.match(s, /if \(!ok\) return;/);
  assert.match(s, /if \(page\.arretee\) return;/);
  assert.ok(!/setInterval|setTimeout\([^)]*appeler|visibilitychange/.test(s), 'aucune relecture périodique dans cet écran');
  // Après l'arrêt, l'écran est remplacé : plus de bouton ni de section qui rappellerait le serveur.
  const apres = s.slice(s.indexOf('function afficherArretee'), s.indexOf('async function quitter'));
  assert.match(apres, /remplacer\(\s*zone\.contenu/);
  assert.ok(!/appeler\(|fetch\(|lireEtat|charger\(/.test(apres));
});

test('Paramètres : le bouton ne passe ni par innerHTML ni par un style en ligne (CSP)', async () => {
  const s = await source();
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(s));
  const bloc = s.slice(s.indexOf('function sectionApplication'), s.indexOf('// -------------------------------------------------------------'));
  assert.ok(!/style/.test(bloc.replace(/stylesheet/g, '')));
});

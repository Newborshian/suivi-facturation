// Garde-fous du front : aucune donnée injectée par innerHTML, aucun script ni style en ligne, aucune ressource externe (CSP stricte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';

const PUBLIC = path.join(RACINE, 'public');

async function lister(dossier, extensions) {
  const sortie = [];
  for (const entree of await fs.readdir(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) sortie.push(...(await lister(chemin, extensions)));
    else if (extensions.includes(path.extname(entree.name))) sortie.push(chemin);
  }
  return sortie;
}

const relatif = (chemin) => path.relative(RACINE, chemin).replaceAll('\\', '/');

test('JS du front : ni innerHTML, ni outerHTML, ni insertAdjacentHTML, ni document.write, ni eval, ni style en ligne, ni réseau externe', async () => {
  const fichiers = await lister(path.join(PUBLIC, 'js'), ['.js']);
  assert.ok(fichiers.length >= 8);
  const interdits = [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function\s*\(/, /setAttribute\(\s*['"]style['"]/, /https?:\/\//, /localStorage/, /createContextualFragment/];
  // Seuls ces deux fichiers (thème clair/sombre) ont le droit d'utiliser localStorage, toujours sous try/catch.
  const THEME = ['public/js/theme.js', 'public/js/theme-init.js'];
  for (const fichier of fichiers) {
    let texte = await fs.readFile(fichier, 'utf8');
    // Seule exception : l'identifiant d'espace de noms SVG (createElementNS), qui n'est pas une adresse réseau et ne charge rien.
    if (relatif(fichier) === 'public/js/graphiques/svg.js') texte = texte.replaceAll('http://www.w3.org/2000/svg', '');
    for (const motif of interdits) {
      if (motif.source === 'localStorage' && THEME.includes(relatif(fichier))) continue;
      assert.doesNotMatch(texte, motif, `${relatif(fichier)} : ${motif}`);
    }
  }
});

test('localStorage : réservé au thème, jamais dans le front nominatif ; chaque accès est dans un try/catch ; clé non nominative', async () => {
  for (const nom of ['theme.js', 'theme-init.js']) {
    const texte = await fs.readFile(path.join(PUBLIC, 'js', nom), 'utf8');
    const acces = texte.split('\n').filter((l) => l.includes('localStorage.'));
    assert.ok(acces.length >= 1, nom);
    assert.match(texte, /try\s*\{/, `${nom} : try/catch`);
    assert.match(texte, /catch/, `${nom} : try/catch`);
    assert.match(texte, /suivi-facturation\.theme/, nom);
  }
});

test('pages HTML : pas de script en ligne, pas d\'attribut style ni on*, pas de ressource externe, un seul h1, lang fr', async () => {
  const pages = await lister(PUBLIC, ['.html']);
  assert.ok(pages.length >= 2);
  for (const page of pages) {
    const html = await fs.readFile(page, 'utf8');
    const nom = relatif(page);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `${nom} : script en ligne`);
    assert.doesNotMatch(html, /<style[\s>]/i, `${nom} : balise style`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${nom} : attribut style`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${nom} : gestionnaire d'événement en ligne`);
    assert.doesNotMatch(html, /(src|href)\s*=\s*["']https?:/i, `${nom} : ressource externe`);
    assert.match(html, /<html lang="fr">/, nom);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${nom} : un seul h1`);
    assert.doesNotMatch(html.match(/<title>(.*?)<\/title>/s)?.[1] ?? '', /Lapin|Ours|patient :/i, `${nom} : pas de nom de patient dans le titre`);
  }
});

test('les imports des modules du front pointent vers des fichiers qui existent et servis par le serveur statique', async () => {
  const s = await demarrerServeurTest();
  try {
    const fichiers = await lister(path.join(PUBLIC, 'js'), ['.js']);
    for (const fichier of fichiers) {
      const texte = await fs.readFile(fichier, 'utf8');
      for (const [, cible] of texte.matchAll(/from\s+'(\/js\/[^']+)'/g)) {
        const r = await s.requete({ chemin: cible });
        assert.equal(r.status, 200, `${relatif(fichier)} importe ${cible}`);
        assert.match(r.headers['content-type'], /text\/javascript/);
        assert.match(r.headers['content-security-policy'], /script-src 'self'/);
      }
    }
    for (const page of ['/', '/prestations.html', '/parametres.html', '/tableau-de-bord.html']) {
      const r = await s.requete({ chemin: page });
      assert.equal(r.status, 200, page);
      assert.match(r.headers['content-type'], /text\/html/);
      for (const [, cible] of r.texte.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) {
        if (cible === '/' || cible.endsWith('.html')) continue;
        assert.equal((await s.requete({ chemin: cible })).status, 200, `${page} référence ${cible}`);
      }
    }
  } finally {
    await s.arreter();
  }
});

test('chaque page prévient quand JavaScript est désactivé : bloc <noscript> identique sur les quatre pages', async () => {
  const blocs = new Set();
  for (const page of await lister(PUBLIC, ['.html'])) {
    const html = await fs.readFile(page, 'utf8');
    const bloc = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
    assert.ok(bloc, `${relatif(page)} : bloc <noscript> présent`);
    assert.match(bloc, /role="alert"/);
    assert.match(bloc, /Cette application nécessite JavaScript\./);
    blocs.add(bloc.replace(/\s+/g, ' ').trim());
  }
  assert.equal(blocs.size, 1, 'même texte et même structure sur toutes les pages');
});

test("navigation : l'entrée Paramètres et le script de thème sont présents sur toutes les pages", async () => {
  for (const page of await lister(PUBLIC, ['.html'])) {
    const html = await fs.readFile(page, 'utf8');
    const nom = relatif(page);
    assert.match(html, /<li><a href="\/parametres\.html"/, `${nom} : entrée de navigation Paramètres`);
    assert.match(html, /<li><a href="\/tableau-de-bord\.html"[^>]*>Tableau de bord<\/a><\/li>/, `${nom} : entrée de navigation Tableau de bord`);
    assert.match(html, /<script src="\/js\/theme-init\.js"><\/script>/, `${nom} : thème appliqué avant l'affichage`);
    assert.ok(html.indexOf('theme-init.js') < html.indexOf('<body'), `${nom} : script de thème dans le head`);
  }
});

test('tableau de bord : feuilles dans l\'ordre du design system, SVG créé par createElementNS, aucun style en ligne ; seul le CSSOM (variable, left, top) pose des dimensions', async () => {
  const html = await fs.readFile(path.join(PUBLIC, 'tableau-de-bord.html'), 'utf8');
  const feuilles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(feuilles, ['/css/tokens.css', '/css/base.css', '/css/composants.css', '/css/ecrans.css', '/css/impression.css']);
  assert.match(html, /<main id="contenu" class="page ecran-tdb"/);
  assert.match(html, /<li><a href="\/tableau-de-bord\.html" aria-current="page">/);
  const fichiers = [
    ...(await lister(path.join(PUBLIC, 'js', 'graphiques'), ['.js'])),
    path.join(PUBLIC, 'js', 'pages', 'tdb-sections.js'),
    path.join(PUBLIC, 'js', 'pages', 'tableau-de-bord.js'),
  ];
  assert.ok(fichiers.length >= 6);
  for (const fichier of fichiers) {
    const texte = await fs.readFile(fichier, 'utf8');
    const nom = relatif(fichier);
    assert.doesNotMatch(texte, /\.cssText|['"]style['"]\s*[:,)]|\sstyle\s*=\s*["'`]/i, `${nom} : style en ligne`);
    assert.doesNotMatch(texte, /createElement\(\s*['"](svg|rect|g|path|text|line|circle|pattern|defs|title|desc|tspan)['"]/, `${nom} : un élément SVG doit être créé avec createElementNS`);
    for (const [, propriete] of texte.matchAll(/\.style\.([A-Za-z]+)/g)) assert.ok(['setProperty', 'left', 'top'].includes(propriete), `${nom} : .style.${propriete}`);
  }
  assert.match(await fs.readFile(path.join(PUBLIC, 'js', 'graphiques', 'svg.js'), 'utf8'), /createElementNS/);
});

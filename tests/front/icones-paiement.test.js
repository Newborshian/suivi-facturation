// Icônes des modes de paiement (design system §5.13) : table des formes et structure produite par elementModesPaiement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICONES_MODES, cleModeDepuisLibelle } from '../../public/js/icones-paiement.js';
import { LIBELLES_MODE } from '../../public/js/format.js';

// Faux document minimal : seulement ce que dom.js, svg.js et icones-paiement.js utilisent.
class Noeud {
  constructor(balise, ns = null) { this.balise = balise; this.ns = ns; this.enfants = []; this.attrs = {}; this.className = ''; }
  set textContent(t) { this.enfants = [String(t)]; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  addEventListener() {}
  append(...n) { this.enfants.push(...n); }
}
const faux = { createElement: (b) => new Noeud(b), createElementNS: (ns, b) => new Noeud(b, ns), createTextNode: (t) => String(t) };

async function avecDocument(fn) {
  globalThis.document = faux;
  try {
    const { elementModesPaiement } = await import('../../public/js/dom.js');
    return await fn(elementModesPaiement);
  } finally {
    delete globalThis.document;
  }
}
const modes = (conteneur) => conteneur.enfants.filter((e) => typeof e !== 'string');
const toutes = (n) => [n, ...n.enfants.filter((e) => typeof e !== 'string').flatMap(toutes)];

test('table des icônes : les 5 clés, formes avec attributs, rien de dangereux', () => {
  assert.deepEqual(Object.keys(ICONES_MODES).sort(), ['autre', 'carte', 'cheque', 'especes', 'virement']);
  assert.deepEqual(Object.keys(LIBELLES_MODE).sort(), Object.keys(ICONES_MODES).sort());
  const attendus = { rect: ['x', 'y', 'width', 'height', 'rx'], line: ['x1', 'y1', 'x2', 'y2'], circle: ['cx', 'cy', 'r'], path: ['d'] };
  for (const [cle, formes] of Object.entries(ICONES_MODES)) {
    assert.ok(formes.length >= 2, cle);
    for (const [balise, attrs] of formes) {
      assert.ok(Object.hasOwn(attendus, balise), `${cle} : forme ${balise}`);
      for (const a of attendus[balise]) {
        if (a === 'rx' && balise === 'rect' && cle === 'especes') continue;
        assert.ok(Object.hasOwn(attrs, a), `${cle} ${balise} : ${a}`);
      }
      for (const nom of Object.keys(attrs)) assert.ok(!['style', 'href', 'xlink:href', 'src'].includes(nom), `${cle} : ${nom}`);
    }
  }
  const json = JSON.stringify(ICONES_MODES);
  assert.ok(!/style|href|https?:|url\(|<script|on[a-z]+=/i.test(json));
  assert.ok(!json.includes('currentColor'), 'couleur posée par le CSS, pas dans la table');
});

test('géométrie du virement et de la carte conforme au §5.13', () => {
  assert.deepEqual(ICONES_MODES.virement.map(([, a]) => a.d), ['M4 8h16', 'M16 4l4 4-4 4', 'M20 16H4', 'M8 12l-4 4 4 4']);
  assert.deepEqual(ICONES_MODES.carte[0], ['rect', { x: 2.5, y: 5, width: 19, height: 14, rx: 2.5 }]);
  assert.equal(ICONES_MODES.autre.length, 3);
});

test('cleModeDepuisLibelle : libellé connu -> clé, inconnu -> autre', () => {
  assert.equal(cleModeDepuisLibelle('Chèque'), 'cheque');
  assert.equal(cleModeDepuisLibelle('Carte bancaire'), 'carte');
  assert.equal(cleModeDepuisLibelle('Bitcoin'), 'autre');
  assert.equal(cleModeDepuisLibelle(undefined), 'autre');
});

test('structure : conteneur, un span.mode-paiement par mode avec title, svg aria-hidden, espace entre les modes', async () => {
  await avecDocument((elementModesPaiement) => {
    assert.deepEqual(elementModesPaiement([]).enfants, []);
    const un = elementModesPaiement(['Virement']);
    assert.equal(un.balise, 'span');
    assert.equal(un.className, 'cellule-double__secondaire modes-paiement');
    assert.equal(un.enfants.length, 1);
    const [m] = modes(un);
    assert.equal(m.balise, 'span');
    assert.equal(m.className, 'mode-paiement');
    assert.equal(m.attrs.title, 'Virement');
    assert.equal(m.enfants.length, 1);
    const s = m.enfants[0];
    assert.equal(s.balise, 'svg');
    assert.equal(s.ns, 'http://www.w3.org/2000/svg');
    assert.equal(s.attrs.class, 'icone-mode icone-mode--virement');
    assert.equal(s.attrs.viewBox, '0 0 24 24');
    assert.equal(s.attrs['aria-hidden'], 'true');
    assert.equal(s.attrs.focusable, 'false');
    assert.ok(!s.enfants.some((e) => e.balise === 'title'), 'pas de <title>');
    assert.equal(s.enfants.length, 4);
    assert.ok(s.enfants.every((f) => f.ns === 'http://www.w3.org/2000/svg'));

    const trois = elementModesPaiement(['Carte bancaire', 'Chèque', 'Espèces']);
    assert.deepEqual(trois.enfants.map((e) => (typeof e === 'string' ? e : `${e.attrs.title}:${e.enfants[0].attrs.class}`)), [
      'Carte bancaire:icone-mode icone-mode--carte', ' ', 'Chèque:icone-mode icone-mode--cheque', ' ', 'Espèces:icone-mode icone-mode--especes',
    ]);
  });
});

test('aucun « + » ni « · » dans le DOM produit, aucun attribut style', async () => {
  await avecDocument((elementModesPaiement) => {
    const c = elementModesPaiement(['Carte bancaire', 'Chèque', 'Espèces', 'Virement', 'Autre']);
    assert.equal(modes(c).length, 5);
    const chaines = c.enfants.filter((e) => typeof e === 'string');
    assert.deepEqual(chaines, [' ', ' ', ' ', ' ']);
    for (const n of toutes(c)) {
      assert.ok(!Object.hasOwn(n.attrs, 'style'), n.balise);
      for (const e of n.enfants) if (typeof e === 'string') assert.ok(!e.includes('+') && !e.includes('·'));
    }
    assert.deepEqual(modes(c).map((m) => m.enfants[0].attrs.class.split('--')[1]), ['carte', 'cheque', 'especes', 'virement', 'autre']);
  });
});

test('mode inconnu -> icône « Autre », title conservé', async () => {
  await avecDocument((elementModesPaiement) => {
    const [m] = modes(elementModesPaiement(['Bitcoin']));
    assert.equal(m.enfants[0].attrs.class, 'icone-mode icone-mode--autre');
    assert.equal(m.attrs.title, 'Bitcoin');
    assert.equal(m.enfants[0].enfants.length, 3);
  });
});

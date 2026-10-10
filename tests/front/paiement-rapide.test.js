// Groupe « Payer » (public/js/paiement-rapide.js) et choix du mode des dialogues (public/js/choix-mode.js) :
// comportement vérifié sur un faux document minimal (pas de navigateur sous node --test), plus contrôles du code des écrans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';

// Faux document : arbre, attributs, écouteurs avec remontée (bulle), focus. Seulement ce que dom.js, svg.js et les deux modules utilisent.
class Noeud {
  constructor(balise) {
    this.balise = balise;
    this.enfants = [];
    this.attrs = {};
    this.className = '';
    this.ecouteurs = {};
    this.parent = null;
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.classes = new Set();
    this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), contains: (c) => this.classes.has(c) };
  }
  set textContent(t) { this.enfants = [String(t)]; }
  get textContent() { return this.enfants.map((e) => (typeof e === 'string' ? e : e.textContent)).join(''); }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  removeAttribute(n) { delete this.attrs[n]; }
  addEventListener(type, f) { (this.ecouteurs[type] ??= []).push(f); }
  append(...n) { for (const x of n) { if (typeof x !== 'string') x.parent = this; this.enfants.push(x); } }
  get isConnected() { return true; }
  contains(x) { return x === this || this.enfants.some((e) => typeof e !== 'string' && e.contains(x)); }
  tous(balise) { return this.enfants.filter((e) => typeof e !== 'string').flatMap((e) => [...(e.balise === balise ? [e] : []), ...e.tous(balise)]); }
  querySelectorAll(balise) { return this.tous(balise); }
  focus() { globalThis.document.activeElement = this; }
}
const faux = { activeElement: null, body: new Noeud('body'), createElement: (b) => new Noeud(b), createElementNS: (ns, b) => new Noeud(b) };

/** Déclenche un événement avec remontée jusqu'à la racine. */
async function declencher(cible, type, extra = {}) {
  for (let n = cible; n; n = n.parent) {
    for (const f of n.ecouteurs[type] ?? []) await f({ currentTarget: n, target: cible, key: extra.key, relatedTarget: extra.relatedTarget ?? null, preventDefault() {}, stopPropagation() {}, ...extra });
  }
}

async function avecDocument(fn) {
  globalThis.document = faux;
  faux.activeElement = faux.body;
  try {
    const [rapide, choix] = await Promise.all([import('../../public/js/paiement-rapide.js'), import('../../public/js/choix-mode.js')]);
    return await fn({ ...rapide, ...choix });
  } finally {
    delete globalThis.document;
  }
}

const ligne = { id: 'abc', date: '2026-10-07', patient: 'Lapin Pierre', resteCentimes: 5800 };
const options = (extra = {}) => ({ ligne, dernierMode: null, desactive: false, explication: '', raisonId: 'raison', auChoix: async () => {}, ...extra });
const boutons = (groupe) => groupe.tous('button');
const modes = (groupe) => boutons(groupe).filter((b) => 'data-mode' in b.attrs);
const declencheur = (groupe) => boutons(groupe).find((b) => b.className.includes('paiement-rapide__declencheur'));

test('structure : groupe nommé, titre « Payer » masqué aux lecteurs d\'écran, déclencheur fermé, cinq modes dans l\'ordre fixe', () =>
  avecDocument(({ paiementRapide }) => {
    const g = paiementRapide(options());
    assert.equal(g.className, 'paiement-rapide');
    assert.equal(g.attrs.role, 'group');
    assert.match(g.attrs['aria-label'], /^Payer le reste de la prestation du 07\/10\/2026 de Lapin Pierre : 58,00/);
    const [titre] = g.enfants;
    assert.deepEqual([titre.className, titre.textContent, titre.attrs['aria-hidden']], ['paiement-rapide__titre', 'Payer', 'true']);
    const d = declencheur(g);
    assert.deepEqual([d.attrs['aria-expanded'], d.attrs['aria-controls'], d.textContent], ['false', 'paiement-rapide-abc', 'Payer']);
    assert.ok(d.attrs['aria-label'].startsWith('Payer'));
    assert.deepEqual(modes(g).map((b) => b.attrs['data-mode']), ['carte', 'cheque', 'especes', 'virement', 'autre']);
    assert.equal(g.enfants.at(-1).attrs.id, 'paiement-rapide-abc', 'le déclencheur contrôle le conteneur des modes');
    for (const b of modes(g)) {
      assert.equal(b.attrs.type, 'button');
      assert.ok(b.attrs['aria-label'].startsWith('Payer 58,00'));
      assert.match(b.attrs['aria-label'], /: prestation du 07\/10\/2026 de Lapin Pierre$/);
      assert.equal(b.attrs['aria-pressed'], undefined, 'pas de aria-pressed sur les lignes de prestations');
      assert.equal(b.enfants.length, 1, 'une seule icône (SVG), aucun texte visible');
    }
  }));

test('mode récent : un seul bouton en évidence, « dernier mode utilisé » dans son nom et sa bulle ; aucun si pas de mode mémorisé', () =>
  avecDocument(({ paiementRapide }) => {
    const avec = modes(paiementRapide(options({ dernierMode: 'virement' })));
    assert.deepEqual(avec.filter((b) => b.attrs['data-recent'] === 'oui').map((b) => b.attrs['data-mode']), ['virement']);
    const recent = avec.find((b) => b.attrs['data-mode'] === 'virement');
    assert.match(recent.attrs['aria-label'], /par virement, dernier mode utilisé : prestation/);
    assert.equal(recent.attrs.title, 'Virement (dernier mode utilisé)');
    assert.equal(avec.filter((b) => /dernier mode utilisé/.test(b.attrs['aria-label'])).length, 1);
    assert.equal(modes(paiementRapide(options())).filter((b) => 'data-recent' in b.attrs).length, 0);
  }));

test('un clic sur un mode appelle auChoix avec ce mode ; pendant l\'enregistrement : aria-busy et boutons désactivés ; ensuite, rétabli', () =>
  avecDocument(async ({ paiementRapide }) => {
    const appels = [];
    let finir;
    const g = paiementRapide(options({ auChoix: (mode) => { appels.push(mode); return new Promise((r) => { finir = r; }); } }));
    const cheque = modes(g)[1];
    const fin = declencher(cheque, 'click', { currentTarget: cheque });
    await Promise.resolve();
    assert.deepEqual(appels, ['cheque']);
    assert.equal(g.attrs['aria-busy'], 'true');
    assert.ok(boutons(g).every((b) => b.disabled === true), 'cinq modes et déclencheur désactivés : un seul versement par clic');
    finir();
    await fin;
    assert.equal(g.attrs['aria-busy'], undefined);
    assert.ok(boutons(g).every((b) => b.disabled === false));
    assert.equal(faux.activeElement, cheque, 'le focus n\'est pas perdu après une erreur (le groupe est resté dans la page)');
  }));

test('variante compacte : le déclencheur bascule aria-expanded ; Échap referme et rend le focus au déclencheur ; un mode cliqué referme', () =>
  avecDocument(async ({ paiementRapide }) => {
    const g = paiementRapide(options());
    const d = declencheur(g);
    await declencher(d, 'click');
    assert.equal(d.attrs['aria-expanded'], 'true');
    await declencher(d, 'click');
    assert.equal(d.attrs['aria-expanded'], 'false');
    await declencher(d, 'click');
    await declencher(modes(g)[2], 'keydown', { key: 'Enter' });
    assert.equal(d.attrs['aria-expanded'], 'true', 'une autre touche ne referme pas');
    await declencher(modes(g)[2], 'keydown', { key: 'Escape' });
    assert.equal(d.attrs['aria-expanded'], 'false');
    assert.equal(faux.activeElement, d);
    await declencher(d, 'click');
    await declencher(modes(g)[0], 'click', { currentTarget: modes(g)[0] });
    assert.equal(d.attrs['aria-expanded'], 'false');
  }));

test('variante compacte : le focus qui quitte le groupe le referme, le focus qui reste dedans non', () =>
  avecDocument(async ({ paiementRapide }) => {
    const g = paiementRapide(options());
    const d = declencheur(g);
    await declencher(d, 'click');
    await declencher(d, 'focusout', { relatedTarget: modes(g)[0] });
    assert.equal(d.attrs['aria-expanded'], 'true');
    await declencher(modes(g)[4], 'focusout', { relatedTarget: new Noeud('a') });
    assert.equal(d.attrs['aria-expanded'], 'false');
  }));

test('écriture impossible : cinq modes et déclencheur désactivés, avec la raison (infobulle et aria-describedby)', () =>
  avecDocument(({ paiementRapide }) => {
    const g = paiementRapide(options({ desactive: true, explication: 'Modification impossible : lecture seule.' }));
    for (const b of boutons(g)) {
      assert.equal(b.attrs.disabled, '');
      assert.equal(b.attrs.title, 'Modification impossible : lecture seule.');
      assert.equal(b.attrs['aria-describedby'], 'raison');
    }
    assert.equal(boutons(g).length, 6);
  }));

test('changement du mode d\'un versement : aria-pressed sur le mode actuel seul, pas de titre « Payer », rien ne se passe sur le mode actif', () =>
  avecDocument(async ({ changerModeVersement }) => {
    const appels = [];
    const g = changerModeVersement({ versement: { id: 'v1', date: '2026-10-07', mode: 'cheque' }, desactive: false, explication: '', auChoix: async (m) => appels.push(m) });
    assert.equal(g.attrs['aria-label'], 'Mode du versement du 07/10/2026');
    assert.ok(!g.enfants.some((e) => e.className === 'paiement-rapide__titre'));
    assert.deepEqual(modes(g).map((b) => [b.attrs['data-mode'], b.attrs['aria-pressed']]), [['carte', 'false'], ['cheque', 'true'], ['especes', 'false'], ['virement', 'false'], ['autre', 'false']]);
    assert.equal(modes(g)[2].attrs['aria-label'], 'Passer le versement du 07/10/2026 en espèces');
    assert.equal(declencheur(g).textContent, 'Chèque', 'déclencheur compact : le mode actuel en toutes lettres');
    assert.match(declencheur(g).attrs['aria-label'], /^Chèque : changer le mode du versement du 07\/10\/2026$/);
    await declencher(modes(g)[1], 'click', { currentTarget: modes(g)[1] });
    assert.deepEqual(appels, [], 'cliquer sur le mode déjà actif ne fait rien');
    await declencher(modes(g)[2], 'click', { currentTarget: modes(g)[2] });
    assert.deepEqual(appels, ['especes']);
  }));

test('choix du mode d\'un dialogue : fieldset + légende, cinq radios de même nom dans l\'ordre, rien de présélectionné sans mode récent', () =>
  avecDocument(({ creerChoixMode }) => {
    const c = creerChoixMode();
    assert.equal(c.racine.balise, 'fieldset');
    assert.match(c.racine.tous('legend')[0].textContent, /^Mode de paiement \(obligatoire\)$/);
    const radios = c.racine.tous('input');
    assert.deepEqual(radios.map((r) => r.attrs.value), ['carte', 'cheque', 'especes', 'virement', 'autre']);
    assert.equal(new Set(radios.map((r) => r.attrs.name)).size, 1);
    assert.ok(radios.every((r) => r.attrs.type === 'radio'));
    assert.equal(c.valeur(), null);
    assert.equal(c.entree, radios[0]);
    assert.equal(c.racine.tous('span').filter((s) => s.className === 'choix-mode__note').length, 0);
    assert.notEqual(creerChoixMode().entree.attrs.name, radios[0].attrs.name, 'deux dialogues : deux groupes distincts');
  }));

test('choix du mode : mode récent présélectionné avec la mention texte « Dernier mode utilisé » ; modification : mode du versement sans mention', () =>
  avecDocument(({ creerChoixMode }) => {
    const ajout = creerChoixMode({ selectionne: 'virement', recent: 'virement' });
    assert.equal(ajout.valeur(), 'virement');
    const notes = ajout.racine.tous('span').filter((s) => s.className === 'choix-mode__note');
    assert.deepEqual(notes.map((n) => n.textContent), ['Dernier mode utilisé']);
    assert.equal(ajout.racine.tous('label').filter((l) => l.attrs['data-recent'] === 'oui').length, 1);
    const modif = creerChoixMode({ selectionne: 'carte', recent: null });
    assert.equal(modif.valeur(), 'carte');
    assert.equal(modif.racine.tous('span').filter((s) => s.className === 'choix-mode__note').length, 0);
    assert.equal(modif.racine.tous('label').filter((l) => 'data-recent' in l.attrs).length, 0);
  }));

test('choix du mode : erreur (texte + classe de bordure épaisse), effacée dès qu\'on choisit', () =>
  avecDocument(async ({ creerChoixMode }) => {
    const c = creerChoixMode();
    const para = c.racine.tous('p')[0];
    assert.equal(c.racine.attrs['aria-describedby'], para.attrs.id);
    c.erreur('Choisissez le mode de paiement.');
    assert.ok(c.racine.classList.contains('choix-mode--erreur'));
    assert.deepEqual([para.textContent, para.hidden], ['Choisissez le mode de paiement.', false]);
    await declencher(c.racine.tous('input')[3], 'change');
    assert.ok(!c.racine.classList.contains('choix-mode--erreur'));
    assert.deepEqual([para.textContent, para.hidden], ['', true]);
  }));

// ------------------------------------------------------------ Code des écrans

const lire = (...chemin) => fs.readFile(path.join(RACINE, 'public', ...chemin), 'utf8');

test('Prestations et Facturation du mois : le groupe « Payer » remplace « Payé en totalité » ; même appel { mode } et même message sur les deux écrans', async () => {
  for (const [page, tableau] of [['prestations.js', 'prestations.js'], ['facturation.js', 'facturation-tableau.js']]) {
    const src = await lire('js', 'pages', page);
    const ui = await lire('js', 'pages', tableau);
    assert.doesNotMatch(src + ui, /btn-payer|texte: 'Payé en totalité'|bouton\('Payé en totalité'/, `${page} : plus de bouton « Payé en totalité »`);
    assert.match(ui, /paiementRapide\(/, page);
    assert.match(src, /appeler\('POST', `\/api\/prestations\/\$\{ligne\.id\}\/payer-totalite`, \{ mode \}\)/, `${page} : le mode du bouton est envoyé`);
    assert.match(src, /messagePaiement\(r\.donnees, ligne\.resteCentimes\)/, `${page} : message D5 construit sur le versement renvoyé`);
    assert.match(src, /focaliserVersement\(/, `${page} : le focus reste sur un élément existant de la ligne`);
    assert.match(src, /dernierModePaiement \?\? null/, `${page} : l'annulation restaure le dernier mode affiché`);
  }
});

test('dialogues : plus de menu déroulant pour le mode (cinq boutons à choix unique) ; D3 : corriger un versement n\'écrit pas le dernier mode', async () => {
  const src = await lire('js', 'pages', 'prestations-dialogues.js');
  assert.doesNotMatch(src, /optionsMode|el\('select'/);
  assert.match(src, /creerChoixMode\(/);
  assert.ok((src.match(/creerChoixMode\(/g) ?? []).length >= 2, 'dialogue de versement ET dialogue de repli MODE_REQUIS');
  assert.match(src, /if \(!versement && corps\.mode\) ctx\.dernierMode\.valeur = corps\.mode;/);
  assert.equal((src.match(/dernierMode\.valeur =/g) ?? []).length, 1, 'une seule écriture du dernier mode, réservée à l\'ajout');
  assert.match(src, /changerModeVersement\(/);
  assert.match(src, /PATCH', `\/api\/prestations\/\$\{ligne\.id\}\/versements\/\$\{v\.id\}`, \{ mode \}/);
});

test('nouveaux modules du front : ni couleur ni style en dur, ni innerHTML, ni taille de texte ; imports servis', async () => {
  for (const f of ['paiement-libelles.js', 'paiement-rapide.js', 'choix-mode.js']) {
    const src = await lire('js', f);
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|\.style\b|setAttribute\(\s*['"]style|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|font-size|https?:\/\//, f);
  }
});

test('page Patients : l\'aide « archives annuelles » ne renvoie plus à Paramètres (l\'archivage n\'est pas livré), texte aligné sur le guide', async () => {
  const src = await lire('js', 'pages', 'patients.js');
  assert.doesNotMatch(src, /en lecture seule \(Paramètres\)/);
  assert.match(src, /en lecture seule\. Cette fonction n'est pas encore disponible\./);
  const guide = await fs.readFile(path.join(RACINE, 'docs', 'guide-utilisateur.md'), 'utf8');
  assert.match(guide, /Cette fonction n'est pas encore disponible/);
});

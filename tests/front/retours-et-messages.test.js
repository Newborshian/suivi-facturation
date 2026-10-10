// Retours d'information du front : clic ignoré pendant une autre action, focus rendu après un échec qui reconstruit la page,
// confirmation d'homonyme depuis le dialogue d'une prestation, écran d'échec de migration. Pas de navigateur sous node --test :
// le comportement pur est testé directement, le câblage des écrans par lecture du code (comme les autres tests du front).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { MESSAGE_ACTION_EN_COURS } from '../../public/js/ecriture.js';

const lire = (...morceaux) => fs.readFile(path.join(RACINE, 'public', ...morceaux), 'utf8');

test('un clic ignoré pendant une autre action le dit (message court, ton « attention »), sur les trois écrans', async () => {
  assert.match(MESSAGE_ACTION_EN_COURS, /action est déjà en cours/);
  assert.ok(MESSAGE_ACTION_EN_COURS.length < 80, 'message court');
  for (const page of ['prestations', 'facturation', 'patients']) {
    const src = await lire('js', 'pages', `${page}.js`);
    const proteger = /async function proteger\(action\) \{[\s\S]*?page\.occupe = true;/.exec(src)?.[0];
    assert.ok(proteger, `${page} : proteger introuvable`);
    assert.match(proteger, /if \(page\.occupe\) \{\s*afficherToast\(\{ texte: MESSAGE_ACTION_EN_COURS, variante: 'attention' \}\);[^\n]*\n\s*return;\s*\}/, `${page} : le clic ignoré affiche le message`);
    assert.match(src, /import \{[^}]*MESSAGE_ACTION_EN_COURS[^}]*\} from '\/js\/ecriture\.js'/, `${page} : import du message`);
  }
});

test('plus de repli « mode requis » côté écran, plus de dialogue de repli ni de style .btn-payer', async () => {
  for (const page of ['prestations', 'facturation']) {
    const src = await lire('js', 'pages', `${page}.js`);
    assert.doesNotMatch(src, /MODE_REQUIS|choisirMode/, `${page} : branche retirée`);
  }
  assert.doesNotMatch(await lire('js', 'pages', 'prestations-dialogues.js'), /choisirMode|MODE_REQUIS/);
  for (const css of ['composants.css', 'ecrans.css', 'impression.css']) assert.doesNotMatch(await lire('css', css), /btn-payer/, css);
});

// ---- focus après un échec qui reconstruit la page

function faux() {
  const noeud = (extra = {}) => {
    const n = { disabled: false, attrs: {}, focus() { globalThis.document.activeElement = n; }, setAttribute(k, v) { n.attrs[k] = v; }, getAttribute: (k) => n.attrs[k] ?? null, ...extra };
    return n;
  };
  return noeud;
}

async function avecPage({ mode, versement, banniere }, fn) {
  const noeud = faux();
  const bouton = mode ? noeud(mode) : null;
  const vers = versement ? noeud({ ...versement, attrs: { 'data-versement': 'abc' } }) : null;
  const message = banniere ? noeud() : null;
  const body = noeud();
  globalThis.document = {
    activeElement: body,
    body,
    getElementById: (id) => (id === 'paiement-rapide-abc' && bouton ? { querySelector: (s) => (s === '[data-mode="cheque"]' ? bouton : null) } : null),
    querySelectorAll: (s) => (s === 'button[data-versement]' && vers ? [vers] : []),
    querySelector: (s) => (/#bandeaux/.test(s) ? message : null),
  };
  try {
    const { refocaliserApresRechargement } = await import('../../public/js/paiement-rapide.js');
    refocaliserApresRechargement({ idGroupe: 'paiement-rapide-abc', mode: 'cheque', ligneId: 'abc' });
    return fn({ bouton, vers, message, actif: globalThis.document.activeElement });
  } finally {
    delete globalThis.document;
  }
}

test('après un échec qui reconstruit la page, le focus revient au bouton du même mode quand il est utilisable', () =>
  avecPage({ mode: {}, versement: {}, banniere: true }, ({ bouton, actif }) => assert.equal(actif, bouton)));

test('boutons du groupe désactivés (conflit) : le focus va au bouton « Versement » de la ligne, s\'il est utilisable', () =>
  avecPage({ mode: { disabled: true }, versement: {}, banniere: true }, ({ vers, actif }) => assert.equal(actif, vers)));

test('tout est désactivé (conflit au clic) : le focus va au message du bandeau, qui explique la situation (jamais perdu sur la page)', () =>
  avecPage({ mode: { disabled: true }, versement: { disabled: true }, banniere: true }, ({ message, actif }) => {
    assert.equal(actif, message);
    assert.equal(message.attrs.tabindex, '-1');
  }));

test('rien d\'utilisable et pas de bandeau : aucune erreur, le focus reste où il est', () =>
  avecPage({ mode: { disabled: true }, banniere: false }, ({ bouton, actif }) => assert.notEqual(actif, bouton)));

// ---- confirmation d'homonyme au renommage depuis le dialogue d'une prestation

test('le dialogue de modification traite 409 PATIENT_EXISTANT comme la page Patients (dialogue d\'homonyme, puis renvoi avec homonyme: true)', async () => {
  const src = await lire('js', 'pages', 'prestations-dialogues.js');
  assert.match(src, /import \{ dialogueHomonyme \} from '\/js\/patients-dialogues\.js'/);
  const bloc = /err\.code === 'PATIENT_EXISTANT'[\s\S]*?\} else \{/.exec(src)?.[0];
  assert.ok(bloc, 'gestion de PATIENT_EXISTANT introuvable');
  assert.match(bloc, /dialogueHomonyme\(\{ mode: 'renommage'/);
  assert.match(bloc, /await enregistrer\(\{ \.\.\.options, homonyme: true \}\)/, 'la demande est renvoyée avec la confirmation, en gardant le choix « toutes les lignes »');
  assert.match(bloc, /else form\.entrees\.nom\.focus\(\)/, 'annulé : rien n\'est modifié, le focus revient au nom');
});

// ---- écran après un échec de migration

test('après un échec de migration, l\'écran dit que le fichier est intact, donne la cause et ne propose jamais « Repartir d\'un fichier vide »', async () => {
  const src = await lire('js', 'ecran-degrade.js');
  assert.match(src, /etat\.erreur\?\.raison === 'migration'/);
  assert.match(src, /Votre fichier de données est intact/);
  assert.match(src, /etat\.erreur\?\.cause/);
  const fichierVide = /const proposerFichierVide = \(\) => \{\s*if \(etat\.erreur\?\.raison !== 'absent' && etat\.erreur\?\.raison !== 'illisible'\) return;/.exec(src);
  assert.ok(fichierVide, 'le bouton n\'est proposé que pour un fichier absent ou illisible (donc jamais pour une migration)');
});

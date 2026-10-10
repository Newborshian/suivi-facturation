// Textes du paiement en un clic (public/js/paiement-libelles.js) : fonctions pures. Aucun nom de patient réel (jeu factice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBELLES_MODE } from '../../public/js/format.js';
import { MODES, PAR_MODE, EN_MODE, messagePaiement, modeConnu, nomBoutonPaiement, nomChangementMode, nomDeclencheurPaiement, nomGroupePaiement, titreBoutonPaiement } from '../../public/js/paiement-libelles.js';

const NBSP = ' ';
const ligne = { date: '2026-10-07', patient: 'Lapin Pierre', resteCentimes: 5800 };

test('les cinq modes, toujours dans le même ordre (carte, chèque, espèces, virement, autre)', () => {
  assert.deepEqual(MODES, ['carte', 'cheque', 'especes', 'virement', 'autre']);
  assert.deepEqual(Object.keys(PAR_MODE), MODES);
  assert.deepEqual(Object.keys(EN_MODE), MODES);
  assert.deepEqual(Object.keys(LIBELLES_MODE), MODES);
});

test('modeConnu : seulement les cinq clés (ni prototype, ni libellé, ni null)', () => {
  for (const m of MODES) assert.equal(modeConnu(m), true, m);
  for (const m of [null, undefined, '', 'bitcoin', 'Chèque', 'toString', '__proto__', 5]) assert.equal(modeConnu(m), false, String(m));
});

test('nom du groupe et nom d\'un bouton : verbe, montant exact, nom complet du mode, puis la prestation', () => {
  assert.equal(nomGroupePaiement(ligne), `Payer le reste de la prestation du 07/10/2026 de Lapin Pierre : 58,00${NBSP}€`);
  assert.equal(nomBoutonPaiement(ligne, 'cheque', false), `Payer 58,00${NBSP}€ par chèque : prestation du 07/10/2026 de Lapin Pierre`);
  assert.equal(nomBoutonPaiement(ligne, 'autre', false), `Payer 58,00${NBSP}€ par un autre mode : prestation du 07/10/2026 de Lapin Pierre`);
});

test('mode récent : « dernier mode utilisé » dans le nom accessible ET dans la bulle (jamais la couleur seule)', () => {
  assert.equal(nomBoutonPaiement(ligne, 'carte', true), `Payer 58,00${NBSP}€ par carte bancaire, dernier mode utilisé : prestation du 07/10/2026 de Lapin Pierre`);
  assert.equal(titreBoutonPaiement('carte', true), 'Carte bancaire (dernier mode utilisé)');
  assert.equal(titreBoutonPaiement('cheque', false), 'Chèque');
});

test('deux lignes : les noms accessibles sont distincts (date et patient inclus)', () => {
  const autre = { ...ligne, date: '2026-10-08', patient: 'Ours Baloo' };
  const noms = [ligne, autre].flatMap((l) => MODES.map((m) => nomBoutonPaiement(l, m, false)));
  assert.equal(new Set(noms).size, noms.length);
});

test('déclencheur compact : le nom accessible commence par le texte visible « Payer » (WCAG 2.5.3)', () => {
  assert.ok(nomDeclencheurPaiement(ligne).startsWith('Payer'));
  assert.match(nomDeclencheurPaiement(ligne), /prestation du 07\/10\/2026 de Lapin Pierre/);
});

test('changement direct du mode d\'un versement : « Passer le versement du jj/mm/aaaa en espèces »', () => {
  assert.equal(nomChangementMode('2026-10-07', 'especes'), 'Passer le versement du 07/10/2026 en espèces');
  assert.equal(nomChangementMode('2026-10-07', 'virement'), 'Passer le versement du 07/10/2026 en virement');
});

test('message D5 : « 58,00 € enregistrés par chèque. » avec le montant RÉEL du dernier versement renvoyé par le serveur', () => {
  const prestation = { versements: [{ montantCentimes: 2000, mode: 'carte' }, { montantCentimes: 3800, mode: 'cheque' }] };
  assert.deepEqual(messagePaiement(prestation, 5800), { texte: `38,00${NBSP}€ enregistrés par chèque.`, mode: 'cheque' });
  assert.equal(messagePaiement({ versements: [{ montantCentimes: 5800, mode: 'cheque' }] }, 1).texte, `58,00${NBSP}€ enregistrés par chèque.`);
  assert.equal(messagePaiement({ versements: [{ montantCentimes: 100, mode: 'autre' }] }, 1).texte, `1,00${NBSP}€ enregistrés par un autre mode.`);
});

test('message : réponse incomplète -> montant affiché (repli), sans inventer de mode', () => {
  assert.deepEqual(messagePaiement({ versements: [] }, 5800), { texte: `58,00${NBSP}€ enregistrés.`, mode: null });
  assert.deepEqual(messagePaiement(undefined, 5800), { texte: `58,00${NBSP}€ enregistrés.`, mode: null });
  assert.deepEqual(messagePaiement({ versements: [{ montantCentimes: 100, mode: 'bitcoin' }] }, 5800), { texte: `1,00${NBSP}€ enregistrés.`, mode: null });
});

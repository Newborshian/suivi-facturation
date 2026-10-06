// Mode de paiement « Carte bancaire » (valeur technique `carte`) et détail « dont X € pas encore facturés ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES_PAIEMENT, VERSION_COURANTE, controlerStructure } from '../../src/domain/schema.js';
import { validerVersement, validerPayerTotalite } from '../../src/domain/validation.js';
import { csvVersements } from '../../src/domain/csv.js';
import { genererExemple } from '../../src/exemple.js';
import { LIBELLES_MODE, libelleDontNonFactures } from '../../public/js/format.js';
import { ligneTest } from '../aides/donnees.js';

test('modes de paiement : liste finale, « Autre » en dernier ; libellés navigateur couvrent exactement les modes (même ordre)', () => {
  assert.deepEqual(MODES_PAIEMENT, ['carte', 'cheque', 'especes', 'virement', 'autre']);
  assert.deepEqual(Object.keys(LIBELLES_MODE), MODES_PAIEMENT);
  assert.deepEqual(Object.values(LIBELLES_MODE), ['Carte bancaire', 'Chèque', 'Espèces', 'Virement', 'Autre']);
});

test('« carte » est accepté pour un versement et pour « Payé en totalité » ; l\'ancien message d\'erreur est remplacé', () => {
  assert.equal(validerVersement({ montantCentimes: 1000, date: '2026-10-02', mode: 'carte' }).mode, 'carte');
  assert.equal(validerPayerTotalite({ mode: 'carte' }).mode, 'carte');
  let erreur;
  try {
    validerVersement({ montantCentimes: 1000, date: '2026-10-02', mode: 'bitcoin' });
  } catch (e) {
    erreur = e;
  }
  assert.ok(erreur, 'un mode inconnu est refusé');
  assert.match(JSON.stringify(erreur.details ?? erreur), /carte bancaire, chèque, espèces, virement ou autre\./);
});

test('compatibilité : un fichier avec les 4 anciens modes reste valide, sans migration (version de schéma inchangée)', () => {
  assert.equal(VERSION_COURANTE, 1);
  const e = genererExemple();
  e.prestations = ['cheque', 'virement', 'especes', 'autre'].map((mode, i) => ligneTest(i + 1, { versements: [{ id: `v${i}`, montantCentimes: 1000, date: '2026-09-30', mode }] }));
  e.parametres.dernierModePaiement = 'autre';
  assert.deepEqual(controlerStructure(e), []);
  e.prestations[0].versements[0].mode = 'carte';
  e.parametres.dernierModePaiement = 'carte';
  assert.deepEqual(controlerStructure(e), []);
  e.prestations[0].versements[0].mode = 'bitcoin';
  assert.deepEqual(controlerStructure(e), ['prestations[0].versements[0].mode invalide']);
});

test('export CSV : le mode « carte » sort en « Carte bancaire »', () => {
  const l = ligneTest(1, { versements: [{ id: 'v', montantCentimes: 2000, date: '2026-09-30', mode: 'carte' }] });
  assert.match(csvVersements([l]), /;Carte bancaire;20,00/);
});

test('jeu d\'exemple : contient des versements par carte', () => {
  const modes = new Set(genererExemple().prestations.flatMap((p) => p.versements.map((v) => v.mode)));
  assert.ok(modes.has('carte'));
});

test('libellé « dont X € pas encore facturés » : montant formaté, absent à zéro', () => {
  assert.match(libelleDontNonFactures(6000), /^dont 60,00.€ pas encore facturés$/);
  assert.equal(libelleDontNonFactures(0), '');
});

// Libellés du tableau de bord (« à facturer » et « reste à payer »), cohérence des tranches serveur / navigateur, noms accessibles
// et garde-fous de lecture du code de l'écran Prestations : pas de DOM sous node --test, donc contrôle du source pour cette partie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TRANCHES, impayes } from '../../src/domain/indicateurs.js';
import { LIBELLES_SERIES_CA, LIBELLE_A_FACTURER, libelleTranche, nomLienTranche } from '../../public/js/format.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { RACINE } from '../aides/temp.js';

test('tranches d\'impayés : définies une seule fois (TRANCHES) ; le serveur les renvoie dans /api/etat et le navigateur les consomme à l\'identique', async () => {
  const s = await demarrerServeurTest();
  try {
    const { tranchesAnciennete } = (await s.requete({ chemin: '/api/etat' })).json;
    assert.deepEqual(tranchesAnciennete, TRANCHES.map((t) => ({ id: t.id, libelle: t.libelle })));
    for (const t of TRANCHES) assert.equal(libelleTranche(tranchesAnciennete, t.id), t.libelle.charAt(0).toLowerCase() + t.libelle.slice(1), t.id);
    assert.equal(libelleTranche(tranchesAnciennete, 'inconnue'), null);
  } finally {
    await s.arreter();
  }
  // et la sortie réelle du serveur ne propose que ces identifiants
  const r = impayes([], '2026-10-02');
  for (const groupe of [r.factures, r.nonFactures]) assert.deepEqual(groupe.map((t) => t.tranche), TRANCHES.map((t) => t.id));
});

test('L\'indicateur de tête parle de montant de facture ; le graphique et les impayés parlent de reste à payer', () => {
  assert.equal(LIBELLE_A_FACTURER, 'À facturer : montant à mettre sur les factures');
  assert.match(LIBELLES_SERIES_CA.attente, /reste à payer/);
  assert.match(LIBELLES_SERIES_CA.aFacturer, /reste à payer/);
  assert.notEqual(LIBELLES_SERIES_CA.aFacturer, LIBELLE_A_FACTURER);
  const t = { libelle: 'Moins de 30 jours', resteCentimes: 4500, nombre: 1 };
  assert.match(nomLienTranche('À facturer', t), /reste à payer/);
});

test('Le nom accessible d\'un lien de tranche contient son groupe : jamais deux liens identiques', () => {
  const noms = new Set();
  for (const groupe of ['Facturées', 'À facturer']) for (const t of TRANCHES) noms.add(nomLienTranche(groupe, { libelle: t.libelle, resteCentimes: 4500, nombre: 2 }));
  assert.equal(noms.size, 8);
  assert.match(nomLienTranche('Facturées', { libelle: 'Moins de 30 jours', resteCentimes: 4500, nombre: 2 }), /^Facturées, moins de 30 jours : reste à payer 45,00.€, 2 prestations\. Voir la liste\.$/);
});

test('lecture du code : « Effacer les filtres » passe toujours par proteger, ne s\'enveloppe pas elle-même, recharge directement et remet le mois à zéro', () => {
  const source = fs.readFileSync(path.join(RACINE, 'public', 'js', 'pages', 'prestations.js'), 'utf8');
  const corps = /async function effacerFiltres\(\) \{([\s\S]*?)\n\}/.exec(source)?.[1];
  assert.ok(corps, 'fonction effacerFiltres introuvable');
  assert.doesNotMatch(corps, /proteger\(/, 'proteger imbriqué : le rechargement serait ignoré');
  assert.match(corps, /await charger\(\)/);
  assert.match(corps, /selectMois\.value = ''/);
  assert.equal([...source.matchAll(/click: \(\) => proteger\(effacerFiltres\)/g)].length, 3, 'les trois boutons passent par proteger(effacerFiltres)');
  assert.doesNotMatch(source, /click: effacerFiltres/);
});

test('lecture du code : les tableaux « Voir les chiffres » sont dépliés avant l\'impression puis refermés', () => {
  const source = fs.readFileSync(path.join(RACINE, 'public', 'js', 'pages', 'tableau-de-bord.js'), 'utf8');
  assert.match(source, /addEventListener\('beforeprint'/);
  assert.match(source, /addEventListener\('afterprint'/);
  assert.match(source, /details\.graphe__tableau:not\(\[open\]\)/);
});

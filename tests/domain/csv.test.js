import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOM, ENTETES_PRESTATIONS, ENTETES_VERSEMENTS, cellule, csvPrestations, csvVersements, serialiserCsv } from '../../src/domain/csv.js';
import { ligneTest } from '../aides/donnees.js';

/** Lecteur CSV minimal (séparateur ;, guillemets doublés, CRLF) pour vérifier ce qu'un tableur lirait. */
function lireCsv(texte) {
  const lignes = [];
  let ligne = [];
  let champ = '';
  let entre = false;
  const corps = texte.replace(/^﻿/, '');
  for (let i = 0; i < corps.length; i++) {
    const c = corps[i];
    if (entre) {
      if (c === '"' && corps[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') entre = false;
      else champ += c;
    } else if (c === '"') entre = true;
    else if (c === ';') {
      ligne.push(champ);
      champ = '';
    } else if (c === '\r' && corps[i + 1] === '\n') {
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = '';
      i++;
    } else champ += c;
  }
  assert.equal(champ, '', 'le fichier se termine par une fin de ligne');
  assert.equal(entre, false, 'guillemets équilibrés');
  return lignes;
}

test('cellule : texte simple inchangé, accents conservés', () => {
  assert.equal(cellule('Hérisson'), 'Hérisson');
  assert.equal(cellule('Séance individuelle 45 min'), 'Séance individuelle 45 min');
  assert.equal(cellule(''), '');
  assert.equal(cellule(null), '');
  assert.equal(cellule(undefined), '');
  assert.equal(cellule('Marie-Pierre'), 'Marie-Pierre', "un tiret au milieu n'est pas une formule");
  assert.equal(cellule('a=b'), 'a=b');
});

test('cellule : guillemets doublés, entourage si ; " ou saut de ligne', () => {
  assert.equal(cellule('a;b'), '"a;b"');
  assert.equal(cellule('il a dit "oui"'), '"il a dit ""oui"""');
  assert.equal(cellule('ligne1\nligne2'), '"ligne1\nligne2"');
  assert.equal(cellule('ligne1\r\nligne2'), '"ligne1\r\nligne2"');
  assert.equal(cellule('virgule, ok'), 'virgule, ok', "la virgule n'est pas le séparateur");
});

test("cellule : protection contre l'injection de formule (=, +, -, @, tabulation, retour chariot)", () => {
  assert.equal(cellule('=1+1'), "'=1+1");
  assert.equal(cellule('+33 6 00 00 00 00'), "'+33 6 00 00 00 00");
  assert.equal(cellule('-2+3'), "'-2+3");
  assert.equal(cellule('@SUM(A1:A9)'), "'@SUM(A1:A9)");
  assert.equal(cellule('\t=1'), "'\t=1");
  assert.equal(cellule('\r=1'), '"\'\r=1"', 'retour chariot : préfixé puis entouré de guillemets');
  assert.equal(cellule('=HYPERLINK("http://x";"clic")'), '"\'=HYPERLINK(""http://x"";""clic"")"', 'préfixe puis échappement des guillemets et du ;');
  assert.equal(cellule("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
});

test('prestations : BOM UTF-8, séparateur ;, fins de ligne CRLF, en-têtes, une ligne par prestation', () => {
  const texte = csvPrestations([ligneTest(1), ligneTest(2)]);
  assert.ok(texte.startsWith(BOM), 'BOM pour Excel');
  assert.equal(texte.charCodeAt(0), 0xfeff);
  assert.ok(texte.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(texte), 'aucun saut de ligne nu');
  const lignes = lireCsv(texte);
  assert.deepEqual(lignes[0], ENTETES_PRESTATIONS);
  assert.equal(lignes.length, 3);
  for (const l of lignes) assert.equal(l.length, 15, 'même nombre de colonnes partout');
  assert.equal(texte.split('\r\n')[0].replace(BOM, '').split(';').length, 15);
});

test('prestations : montants en euros avec virgule (centimes entiers, jamais de flottant), sans séparateur de milliers ni symbole', () => {
  const cas = [
    [125050, '1250,50'],
    [4500, '45,00'],
    [0, '0,00'],
    [5, '0,05'],
    [10, '0,10'],
    [1999, '19,99'],
    [10_000_000, '100000,00'],
    [100, '1,00'],
    [29, '0,29'],
  ];
  for (const [centimes, attendu] of cas) {
    const [, l] = lireCsv(csvPrestations([ligneTest(1, { montantCentimes: centimes })]));
    assert.equal(l[7], attendu, `${centimes} centimes`);
    assert.doesNotMatch(l[7], /€|\s|\./);
  }
});

test('prestations : dates JJ/MM/AAAA, statut et état en français, verse / reste / trop-perçu calculés (250 € versés 300 €)', () => {
  const ligne = ligneTest(3, {
    date: '2026-09-04',
    montantCentimes: 25000,
    statut: 'facture',
    factureLe: '2026-09-30',
    categorie: 'bilan',
    libelle: 'Bilan initial',
    versements: [{ id: 'v1', montantCentimes: 30000, date: '2026-10-01', mode: 'cheque' }],
  });
  const [, l] = lireCsv(csvPrestations([ligne]));
  assert.deepEqual(l, ['ligne-3', '04/09/2026', 'Lapin', 'Pierre', 'Bilan initial', 'Bilan', 'Graphisme', '250,00', 'Facturé', '30/09/2026', '300,00', '0,00', '50,00', 'Payé', '1']);
  const [, partiel] = lireCsv(csvPrestations([ligneTest(1, { versements: [{ id: 'v', montantCentimes: 2000, date: '2026-09-30', mode: 'especes' }] })]));
  assert.deepEqual([partiel[8], partiel[9], partiel[10], partiel[11], partiel[12], partiel[13]], ['À facturer', '', '20,00', '25,00', '0,00', 'Partiellement payé']);
  const [, vide] = lireCsv(csvPrestations([ligneTest(1)]));
  assert.deepEqual([vide[10], vide[11], vide[13], vide[14]], ['0,00', '45,00', 'Non payé', '0']);
});

test('prestations : un nom ou un motif commençant par une formule est neutralisé, les valeurs normales ne sont pas altérées', () => {
  const [, l] = lireCsv(csvPrestations([ligneTest(1, { patient: { id: 'p', nom: '=2+2', prenom: '@cmd' }, motif: '-1+1;"x"', libelle: '+libellé' })]));
  assert.equal(l[2], "'=2+2");
  assert.equal(l[3], "'@cmd");
  assert.equal(l[4], "'+libellé");
  assert.equal(l[6], "'-1+1;\"x\"");
  const [, ok] = lireCsv(csvPrestations([ligneTest(2, { patient: { id: 'p', nom: 'Dupont-Martin', prenom: 'Zoé' }, motif: "L'écriture, c'est dur" })]));
  assert.equal(ok[2], 'Dupont-Martin');
  assert.equal(ok[3], 'Zoé');
  assert.equal(ok[6], "L'écriture, c'est dur");
});

test('prestations : motif multiligne et point-virgule restent dans leur cellule', () => {
  const lignes = lireCsv(csvPrestations([ligneTest(1, { motif: 'a;b\nc "d"' })]));
  assert.equal(lignes.length, 2);
  assert.equal(lignes[1][6], 'a;b\nc "d"');
  assert.equal(lignes[1].length, 15);
});

test("prestations : tri par date puis création ; liste vide = seulement l'en-tête", () => {
  const l = lireCsv(csvPrestations([ligneTest(5, { date: '2026-09-20' }), ligneTest(1, { date: '2026-09-02' }), ligneTest(9, { date: '2026-09-11' })]));
  assert.deepEqual(l.slice(1).map((x) => x[1]), ['02/09/2026', '11/09/2026', '20/09/2026']);
  assert.deepEqual(lireCsv(csvPrestations([])), [ENTETES_PRESTATIONS]);
});

test("versements : une ligne par versement, en-têtes, mode en français, montants à la française, tri par date de versement", () => {
  const l1 = ligneTest(1, { versements: [{ id: 'a', montantCentimes: 2000, date: '2026-10-05', mode: 'cheque' }, { id: 'b', montantCentimes: 1550, date: '2026-09-30', mode: 'virement' }] });
  const l2 = ligneTest(2, { versements: [{ id: 'c', montantCentimes: 4500, date: '2026-10-01', mode: 'especes' }] });
  const l3 = ligneTest(3);
  const lignes = lireCsv(csvVersements([l1, l2, l3]));
  assert.deepEqual(lignes[0], ENTETES_VERSEMENTS);
  assert.equal(lignes.length, 4, "la prestation sans versement n'a pas de ligne");
  assert.deepEqual(lignes[1], ['ligne-1', '02/09/2026', 'Ours', 'Baloo', '30/09/2026', 'Virement', '15,50']);
  assert.deepEqual(lignes[2].slice(4), ['01/10/2026', 'Espèces', '45,00']);
  assert.deepEqual(lignes[3].slice(4), ['05/10/2026', 'Chèque', '20,00']);
  for (const l of lignes) assert.equal(l.length, 7);
});

test('versements : noms commençant par une formule neutralisés', () => {
  const l = ligneTest(1, { patient: { id: 'p', nom: '=1', prenom: '+2' }, versements: [{ id: 'a', montantCentimes: 100, date: '2026-10-05', mode: 'autre' }] });
  const lignes = lireCsv(csvVersements([l]));
  assert.deepEqual([lignes[1][2], lignes[1][3], lignes[1][5]], ["'=1", "'+2", 'Autre']);
});

test('serialiserCsv : BOM + CRLF, cellules échappées', () => {
  assert.equal(serialiserCsv(['a', 'b'], [['x;y', '=z']]), `${BOM}a;b\r\n"x;y";'=z\r\n`);
});

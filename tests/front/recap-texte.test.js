import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLONNES_PAR_DEFAUT, formaterDetailTexte, formaterRecapTexte } from '../../public/js/recap-texte.js';
import { moisPlusN, nomPatient } from '../../public/js/format.js';

const entree = (nom, prenom, o = {}) => ({
  patient: { id: nom, nom, prenom },
  nbSeances: 3,
  nbAutres: 0,
  duCentimes: 12500,
  payeCentimes: 4500,
  resteCentimes: 8000,
  lignes: [],
  ...o,
});
const total = { nbPatients: 2, nbSeances: 4, nbAutres: 1, duCentimes: 128000, payeCentimes: 4500, resteCentimes: 123500 };
const recap = (patients, o = {}) => ({ mois: '2026-10', vue: 'prestation', patients, total, ...o });

test('texte copié : en-tête, une ligne par patient, total ; colonnes par défaut Patient, Séances, Montant dû, Payé, Reste à payer (format de copie provisoire)', () => {
  const texte = formaterRecapTexte(recap([entree('Lapin', 'Pierre'), entree('Ours', 'Baloo', { nbSeances: 1, duCentimes: 25000, payeCentimes: 0, resteCentimes: 25000 })]));
  assert.equal(
    texte,
    ['Patient\tSéances\tMontant dû\tPayé\tReste à payer', 'Lapin Pierre\t3\t125,00\t45,00\t80,00', 'Ours Baloo\t1\t250,00\t0,00\t250,00', 'Total\t4\t1280,00\t45,00\t1235,00'].join('\n'),
  );
  assert.deepEqual(COLONNES_PAR_DEFAUT.prestation, ['patient', 'seances', 'du', 'paye', 'reste']);
});

test('texte copié : montants sans séparateur de milliers ni symbole, virgule décimale, exacts au centime', () => {
  const texte = formaterRecapTexte(recap([entree('Lapin', 'Pierre', { duCentimes: 123456789, payeCentimes: 5, resteCentimes: 123456784 })]), { total: false });
  assert.equal(texte.split('\n')[1], 'Lapin Pierre\t3\t1234567,89\t0,05\t1234567,84');
  assert.ok(!/[  €]/.test(texte));
});

test('texte copié : mois vide -> en-tête et total seulement ; options entete / total / colonnes', () => {
  const vide = recap([], { total: { nbPatients: 0, nbSeances: 0, nbAutres: 0, duCentimes: 0, payeCentimes: 0, resteCentimes: 0 } });
  assert.equal(formaterRecapTexte(vide), 'Patient\tSéances\tMontant dû\tPayé\tReste à payer\nTotal\t0\t0,00\t0,00\t0,00');
  assert.equal(formaterRecapTexte(vide, { entete: false, total: false }), '');
  assert.equal(formaterRecapTexte(recap([entree('Lapin', 'Pierre')]), { colonnes: ['patient', 'autres'], entete: true, total: false }), 'Patient\tAutres prestations\nLapin Pierre\t0');
  assert.throws(() => formaterRecapTexte(vide, { colonnes: ['inconnue'] }), RangeError);
});

test('texte copié, vue par date de versement : « Encaissé » à la place de « Payé », pas de reste à payer', () => {
  const v = recap([entree('Lapin', 'Pierre', { resteCentimes: null })], { vue: 'versement', total: { ...total, resteCentimes: null } });
  const lignes = formaterRecapTexte(v).split('\n');
  assert.equal(lignes[0], 'Patient\tSéances\tMontant dû\tEncaissé');
  assert.equal(lignes[1], 'Lapin Pierre\t3\t125,00\t45,00');
});

test('texte copié : pas de tabulation ni de saut de ligne dans une cellule ; un nom ne devient pas une formule de tableur', () => {
  const texte = formaterRecapTexte(recap([entree('=SOMME(A1)', 'Pierre\tX\nY'), entree('-1+1', 'Léa')]), { entete: false, total: false });
  const [a, b] = texte.split('\n');
  assert.equal(a.split('\t')[0], "'=SOMME(A1) Pierre X Y");
  assert.equal(b.split('\t')[0], "'-1+1 Léa");
  assert.equal(a.split('\t').length, 5);
});

test('détail copié : nom, en-tête, date / libellé / montant par prestation, total', () => {
  const e = entree('Lapin', 'Pierre', {
    lignes: [
      { date: '2026-10-03', libelle: 'Séance individuelle 45 min', montantCentimes: 4500 },
      { date: '2026-10-10', libelle: 'Bilan initial', montantCentimes: 25000 },
    ],
  });
  assert.equal(formaterDetailTexte(e), ['Lapin Pierre', 'Date\tPrestation\tMontant', '03/10/2026\tSéance individuelle 45 min\t45,00', '10/10/2026\tBilan initial\t250,00', 'Total\t\t295,00'].join('\n'));
  assert.equal(formaterDetailTexte(entree('Ours', 'Baloo')), 'Ours Baloo\nDate\tPrestation\tMontant\nTotal\t\t0,00');
});

test('mois précédent / suivant : changement d\'année, bornes 2000-2100', () => {
  assert.equal(moisPlusN('2026-12', 1), '2027-01');
  assert.equal(moisPlusN('2027-01', -1), '2026-12');
  assert.equal(moisPlusN('2026-10', 0), '2026-10');
  assert.equal(moisPlusN('2026-03', -3), '2025-12');
  assert.equal(moisPlusN('2000-01', -1), null);
  assert.equal(moisPlusN('2100-12', 1), null);
  assert.equal(moisPlusN('2100-12', 0), '2100-12');
  assert.equal(moisPlusN('abc', 1), null);
  assert.equal(nomPatient({ nom: 'Lapin', prenom: 'Pierre' }), 'Lapin Pierre');
});

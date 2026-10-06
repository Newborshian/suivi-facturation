// Recette QA : changements de mois et d'année, heure d'été, 29 février, mois de 28 à 31 jours, prévisions en fin d'année,
// historique insuffisant, prestations à venir (domaine pur, aucune horloge implicite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajouterJours, ajouterMois, ecartJours, estDateCivile, joursDansMois, lundiDeSemaine, moisDe, semaineIso } from '../../src/domain/dates.js';
import { caMensuel, listerMois, seances } from '../../src/domain/indicateurs.js';
import { historique, premiereEstimation, previsions } from '../../src/domain/previsions.js';
import { recapMensuel } from '../../src/domain/recap.js';
import { formatMois, moisPlusN, lireMontant } from '../../public/js/format.js';
import { ligne } from './aides-qa.js';

let compteur = 0;
const ligneUnique = (date, montantCentimes = 1000, extra = {}) => ligne(++compteur, { date, montantCentimes, ...extra });

test('mois de 28, 29, 30 et 31 jours : joursDansMois sur 2100 (non bissextile), 2000 (bissextile), 2024, 2026, 2028', () => {
  const attendu = (annee, bissextile) => [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((n, i) => [i + 1, n]).map(([m, n]) => assert.equal(joursDansMois(annee, m), n, `${annee}-${m}`));
  attendu(2000, true); // divisible par 400
  attendu(2024, true);
  attendu(2026, false);
  attendu(2028, true);
  attendu(2100, false); // divisible par 100 sans l'être par 400
  assert.equal(estDateCivile('2100-02-29'), false);
  assert.equal(estDateCivile('2000-02-29'), true);
  assert.equal(estDateCivile('2026-02-29'), false);
  assert.equal(estDateCivile('2028-02-29'), true);
  assert.equal(estDateCivile('2026-04-31'), false);
  assert.equal(estDateCivile('2026-12-31'), true);
});

test('29 février : une prestation du 29/02/2028 est dans février 2028 ; le 28/02/2027 + 1 jour = 01/03/2027 ; 29/02/2028 + 12 mois = 28/02/2029', () => {
  assert.equal(moisDe('2028-02-29'), '2028-02');
  assert.equal(ajouterJours('2027-02-28', 1), '2027-03-01');
  assert.equal(ajouterJours('2028-02-28', 1), '2028-02-29');
  assert.equal(ajouterMois('2028-02-29', 12), '2029-02-28');
  assert.equal(ajouterMois('2028-02-29', -12), '2027-02-28');
  assert.equal(ajouterMois('2026-01-31', 1), '2026-02-28');
  assert.equal(ajouterMois('2026-03-31', -1), '2026-02-28');
  assert.equal(ecartJours('2028-02-28', '2028-03-01'), 2);
  assert.equal(ecartJours('2027-02-28', '2027-03-01'), 1);
  const lignes = [ligneUnique('2028-02-29', 4500), ligneUnique('2028-03-01', 1000), ligneUnique('2028-02-01', 500)];
  const fev = recapMensuel(lignes, { mois: '2028-02', aujourdHui: '2028-03-05' });
  assert.equal(fev.total.duCentimes, 5000);
  assert.equal(fev.total.nbPrestations, 2);
  assert.equal(recapMensuel(lignes, { mois: '2028-03', aujourdHui: '2028-03-05' }).total.duCentimes, 1000);
});

test('heure d\'été (dernier dimanche de mars et d\'octobre) : écarts en jours entiers, lundis et semaines ISO justes', () => {
  // France : 2026-03-29 (23 h) et 2026-10-25 (25 h), 2027-03-28, 2027-10-31, 2028-03-26, 2028-10-29
  for (const [avant, apres] of [['2026-03-28', '2026-03-30'], ['2026-10-24', '2026-10-26'], ['2027-03-27', '2027-03-29'], ['2027-10-30', '2027-11-01'], ['2028-03-25', '2028-03-27'], ['2028-10-28', '2028-10-30']]) {
    assert.equal(ecartJours(avant, apres), 2, `${avant} -> ${apres}`);
    assert.equal(ajouterJours(avant, 2), apres);
  }
  assert.equal(lundiDeSemaine('2026-03-29'), '2026-03-23'); // dimanche du changement d'heure
  assert.equal(lundiDeSemaine('2026-10-25'), '2026-10-19');
  assert.equal(semaineIso('2026-03-29'), '2026-W13');
  assert.equal(semaineIso('2026-03-30'), '2026-W14');
  assert.equal(semaineIso('2026-10-25'), '2026-W43');
  assert.equal(semaineIso('2026-10-26'), '2026-W44');
  // chaque jour de 2026 à 2029 : lundi = jour suivant le dimanche précédent, semaine du lundi = semaine du jour
  let courant = '2026-01-01';
  while (courant <= '2029-12-31') {
    const lundi = lundiDeSemaine(courant);
    assert.ok(lundi <= courant && ecartJours(lundi, courant) <= 6, courant);
    assert.equal(semaineIso(lundi), semaineIso(courant), courant);
    courant = ajouterJours(courant, 1);
  }
});

test('semaines ISO de fin et de début d\'année : 2026-12-31 et 2027-01-01 en W53 de 2026 ; 2024-12-30 en W01 de 2025', () => {
  assert.equal(semaineIso('2026-12-31'), '2026-W53');
  assert.equal(semaineIso('2027-01-01'), '2026-W53');
  assert.equal(semaineIso('2027-01-04'), '2027-W01');
  assert.equal(semaineIso('2024-12-30'), '2025-W01');
  assert.equal(semaineIso('2025-12-29'), '2026-W01');
});

test('séances par semaine autour du 31 décembre : une semaine à cheval sur deux années n\'est comptée qu\'une fois', () => {
  const lignes = [ligneUnique('2026-12-30'), ligneUnique('2026-12-31'), ligneUnique('2027-01-01'), ligneUnique('2027-01-04')];
  const r = seances(lignes, { de: '2026-12', a: '2027-01', granularite: 'semaine', aujourdHui: '2027-01-10' });
  const w53 = r.periodes.find((p) => p.periode === '2026-W53');
  assert.equal(w53.realisees, 3);
  assert.equal(r.periodes.find((p) => p.periode === '2027-W01').realisees, 1);
  assert.equal(r.total.total, 4);
  const cles = r.periodes.map((p) => p.periode);
  assert.equal(new Set(cles).size, cles.length, 'aucune semaine en double');
  const parMois = seances(lignes, { de: '2026-12', a: '2027-01', granularite: 'mois', aujourdHui: '2027-01-10' });
  assert.equal(parMois.total.total, r.total.total, 'mêmes séances par mois et par semaine');
});

test('changement d\'année : CA et récapitulatif du 31/12 au 01/01 ; un versement de janvier sur une prestation de décembre', () => {
  const l1 = ligneUnique('2026-12-31', 5000, { versements: [{ id: 'v-a', montantCentimes: 2000, date: '2027-01-02', mode: 'virement' }], statut: 'facture', factureLe: '2026-12-31' });
  const l2 = ligneUnique('2027-01-01', 3000);
  const dec = recapMensuel([l1, l2], { mois: '2026-12', aujourdHui: '2027-01-15' });
  const jan = recapMensuel([l1, l2], { mois: '2027-01', aujourdHui: '2027-01-15' });
  assert.equal(dec.total.duCentimes, 5000);
  assert.equal(dec.total.payeCentimes, 2000, 'vue prestation : le versement de janvier compte pour la prestation de décembre');
  assert.equal(dec.total.resteCentimes, 3000);
  assert.equal(jan.total.duCentimes, 3000);
  const tresoDec = recapMensuel([l1, l2], { mois: '2026-12', vue: 'versement', aujourdHui: '2027-01-15' });
  const tresoJan = recapMensuel([l1, l2], { mois: '2027-01', vue: 'versement', aujourdHui: '2027-01-15' });
  assert.equal(tresoDec.total.payeCentimes, 0);
  assert.equal(tresoJan.total.payeCentimes, 2000, 'vue versement : encaissé en janvier');
  const ca = caMensuel([l1, l2], { de: '2026-12', a: '2027-01', aujourdHui: '2027-01-15' });
  assert.deepEqual(ca.mois.map((m) => m.mois), ['2026-12', '2027-01']);
  assert.equal(ca.mois[0].payeCentimes + ca.mois[0].attenteCentimes + ca.mois[0].aFacturerCentimes + ca.mois[0].aVenirCentimes, 5000);
});

test('listerMois : 12 mois à cheval sur deux années, 24 mois, un seul mois ; moisPlusN du navigateur franchit les années et refuse 1999 / 2101', () => {
  assert.deepEqual(listerMois('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.equal(listerMois('2024-03', '2026-02').length, 24);
  assert.deepEqual(listerMois('2026-10', '2026-10'), ['2026-10']);
  assert.equal(moisPlusN('2026-12', 1), '2027-01');
  assert.equal(moisPlusN('2027-01', -1), '2026-12');
  assert.equal(moisPlusN('2000-01', -1), null);
  assert.equal(moisPlusN('2100-12', 1), null);
  assert.equal(formatMois('2027-01'), 'janvier 2027');
  assert.equal(formatMois('2027-13'), '');
});

// ------------------------------------------------------------------ prévisions

const histo = (y, m) => {
  // trois mois complets avant (y, m) avec 100 € chacun, plus ancienne prestation au 1er du premier
  const mois = [-3, -2, -1].map((n) => moisDe(ajouterMois(`${y}-${String(m).padStart(2, '0')}-01`, n)));
  return mois.map((mm) => ligneUnique(`${mm}-01`, 10000));
};

test('prévision en fin d\'année : décembre -> horizon janvier, février, mars de l\'année suivante ; 31/12 : jours restants = 0', () => {
  const lignes = histo(2026, 12); // sept., oct., nov. à 100 € ; base 100 €
  const p = previsions(lignes, { aujourdHui: '2026-12-31' });
  assert.equal(p.suffisant, true);
  assert.equal(p.base, 10000);
  assert.deepEqual(p.mois.map((m) => m.mois), ['2026-12', '2027-01', '2027-02', '2027-03']);
  assert.equal(p.mois[0].estimationCentimes, 0, 'dernier jour du mois, rien de réalisé : plus rien à attendre');
  assert.equal(p.mois[1].estimationCentimes, 10000);
  const p1 = previsions(lignes, { aujourdHui: '2026-12-01' });
  assert.equal(p1.mois[0].estimationCentimes, 9677, '1er décembre : base × 30/31 = 9677,4 -> 9677');
});

test('prévision : jours restants justes dans un mois de 28, 29, 30 et 31 jours, le 15 du mois', () => {
  const attendu = [
    ['2027-02-15', 10000 * 13 / 28], // février 2027 : 28 jours
    ['2028-02-15', 10000 * 14 / 29], // février 2028 : 29 jours
    ['2026-11-15', 10000 * 15 / 30],
    ['2026-10-15', 10000 * 16 / 31],
  ];
  for (const [jour, brut] of attendu) {
    const [y, m] = jour.split('-').map(Number);
    const p = previsions(histo(y, m), { aujourdHui: jour });
    assert.equal(p.mois[0].estimationCentimes, Math.round(brut), jour);
  }
});

test('prévision : le 29 février et le passage à mars (année bissextile) ne décalent pas l\'horizon', () => {
  const p = previsions(histo(2028, 2), { aujourdHui: '2028-02-29' });
  assert.deepEqual(p.mois.map((m) => m.mois), ['2028-02', '2028-03', '2028-04', '2028-05']);
  assert.equal(p.mois[0].estimationCentimes, 0);
});

test('historique insuffisant : 0, 1, 2 mois complets -> aucun chiffre, nombre de mois manquants et date de première estimation', () => {
  assert.deepEqual(previsions([], { aujourdHui: '2026-10-10' }).suffisant, false);
  assert.equal(previsions([], { aujourdHui: '2026-10-10' }).premiereEstimationLe, null);
  const deuxMois = [ligneUnique('2026-08-01', 5000), ligneUnique('2026-09-10', 5000)];
  const p = previsions(deuxMois, { aujourdHui: '2026-10-10' });
  assert.equal(p.suffisant, false);
  assert.equal(p.moisComplets, 2);
  assert.equal(p.moisManquants, 1);
  assert.equal(p.base, null);
  assert.deepEqual(p.mois, []);
  assert.equal(p.premiereEstimationLe, '2026-11-01');
  // première prestation le 2 : le mois de la première prestation n'est pas complet
  assert.equal(historique([ligneUnique('2026-07-02')], '2026-10-10').moisComplets, 2);
  assert.equal(premiereEstimation('2026-07-02'), '2026-11-01');
  assert.equal(premiereEstimation('2026-07-01'), '2026-10-01');
  // exactement 3 mois complets
  assert.equal(previsions([ligneUnique('2026-07-01', 100)], { aujourdHui: '2026-10-10' }).suffisant, true);
});

test('prestations à venir seules : pas d\'historique, pas de prévision ; elles ne fabriquent jamais de mois « complets »', () => {
  const p = previsions([ligneUnique('2027-03-01', 99999), ligneUnique('2026-12-10', 5000)], { aujourdHui: '2026-10-10' });
  assert.equal(p.suffisant, false);
  assert.equal(p.moisComplets, 0);
  assert.equal(p.moisManquants, 3);
});

test('prestations à venir avec historique : séance planifiée au-dessus de la moyenne -> estimation = planifié ; en dessous -> moyenne ; jamais de double comptage', () => {
  const base = histo(2026, 10); // base 100 €
  const planifieHaut = previsions([...base, ligneUnique('2026-11-20', 25000)], { aujourdHui: '2026-10-10' });
  assert.equal(planifieHaut.mois[1].estimationCentimes, 25000);
  assert.equal(planifieHaut.mois[1].complementEstimeCentimes, 0);
  const planifieBas = previsions([...base, ligneUnique('2026-11-20', 4000)], { aujourdHui: '2026-10-10' });
  assert.equal(planifieBas.mois[1].estimationCentimes, 10000, 'max(planifié, moyenne), pas planifié + moyenne');
  assert.equal(planifieBas.mois[1].complementEstimeCentimes, 6000);
});

test('une pause d\'un mois (0 €) reste dans la moyenne (une pause compte comme un mois à 0 €) : base = (100 + 0 + 100) / 3 = 66,67 €', () => {
  const lignes = [ligneUnique('2026-07-01', 10000), ligneUnique('2026-09-05', 10000)];
  const p = previsions(lignes, { aujourdHui: '2026-10-10' });
  assert.equal(p.suffisant, true);
  assert.equal(p.base, 6667);
});

test('fin d\'année par le CA : 12 mois glissants à cheval sur deux années, aucun mois manquant ni dupliqué', () => {
  const ca = caMensuel([], { de: '2025-11', a: '2026-10', aujourdHui: '2026-10-02' });
  assert.equal(ca.mois.length, 12);
  assert.equal(ca.mois[0].mois, '2025-11');
  assert.equal(ca.mois[2].mois, '2026-01');
});

test('lireMontant du navigateur : cas limites de saisie (virgule, point, espaces, €, négatif, 3 décimales, notation scientifique)', () => {
  const ok = [['45', 4500], ['45,5', 4550], ['45.5', 4550], ['45,50 €', 4550], ['1 250,50', 125050], ['  0,01 ', 1], ['0', 0], ['00045', 4500], ['999999999,99', 99999999999]];
  for (const [saisie, centimes] of ok) assert.deepEqual(lireMontant(saisie), { ok: true, centimes }, saisie);
  for (const mauvais of ['-5', '45,505', '1e3', '4,5,0', 'abc', '45 euros', '1.250,50', '0x10', '１２', '--', ',', '.5']) {
    assert.equal(lireMontant(mauvais).ok, false, mauvais);
  }
  assert.equal(lireMontant('').raison, 'vide');
  assert.equal(lireMontant('1234567890').ok, false, 'plus de 9 chiffres avant la virgule');
});

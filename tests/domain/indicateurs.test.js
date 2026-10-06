import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancienneteJours, caMensuel, compteDansImpayes, impayes, listerMois, nombreMois, repartition, seances, trancheAnciennete } from '../../src/domain/indicateurs.js';
import { lundiDeSemaine, semaineIso } from '../../src/domain/dates.js';
import { recapMensuel } from '../../src/domain/recap.js';
import { filtrerPrestations } from '../../src/domain/prestations.js';
import { etatPaiement } from '../../src/domain/paiement.js';
import { validerFiltres, validerParametresIndicateurs } from '../../src/domain/validation.js';

let n = 0;
const lapin = { id: 'p-lapin', nom: 'Lapin', prenom: 'Pierre' };
const ours = { id: 'p-ours', nom: 'Ours', prenom: 'Baloo' };

/** Prestation factice ; `versements` = [[centimes, date], ...]. */
function ligne(date, montantCentimes, { statut = 'a_facturer', versements = [], categorie = 'seance', prestationId = 'seance-45', libelle = 'Séance individuelle 45 min', factureLe, patient = lapin } = {}) {
  n += 1;
  return {
    id: `l${n}`,
    patient,
    date,
    prestationId,
    libelle,
    categorie,
    motif: '',
    montantCentimes,
    statut,
    factureLe: statut === 'facture' ? (factureLe ?? date) : null,
    versements: versements.map(([m, d], i) => ({ id: `v${n}-${i}`, montantCentimes: m, date: d, mode: 'cheque' })),
    creeLe: '2026-01-01T00:00:00.000Z',
    modifieLe: '2026-01-01T00:00:00.000Z',
  };
}
const A = '2026-10-02';
const ca = (prestations, options = {}) => caMensuel(prestations, { de: '2026-10', a: '2026-10', aujourdHui: A, ...options });
const entierPartout = (valeur) => {
  if (typeof valeur === 'number') assert.ok(Number.isSafeInteger(valeur), `entier attendu : ${valeur}`);
  else if (valeur && typeof valeur === 'object') Object.values(valeur).forEach(entierPartout);
};

// ------------------------------------------------------------------ Mois

test('listerMois / nombreMois : changement d\'année, un seul mois', () => {
  assert.deepEqual(listerMois('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(listerMois('2026-10', '2026-10'), ['2026-10']);
  assert.equal(nombreMois('2025-11', '2026-10'), 12);
  assert.equal(nombreMois('2026-10', '2026-10'), 1);
  assert.equal(listerMois('2025-11', '2026-10').length, 12);
});

// ------------------------------------------------------------------ CA par mois

test('vecteur 2 : A 45 € facturé versé 20 €, B 35 € à facturer, C 45 € à facturer versé 45 €, D 250 € facturé versé 300 € -> payé 315, attente 25, à facturer 35, total 375, trop-perçu 50', () => {
  const r = ca([
    ligne('2026-10-01', 4500, { statut: 'facture', versements: [[2000, '2026-10-01']] }),
    ligne('2026-10-01', 3500),
    ligne('2026-10-01', 4500, { versements: [[4500, '2026-10-01']] }),
    ligne('2026-10-01', 25000, { statut: 'facture', versements: [[30000, '2026-10-01']] }),
  ]);
  const [m] = r.mois;
  assert.deepEqual(
    [m.payeCentimes, m.attenteCentimes, m.aFacturerCentimes, m.aVenirCentimes, m.totalCentimes, m.tropPercuCentimes, m.nombre],
    [31500, 2500, 3500, 0, 37500, 5000, 4],
  );
  assert.equal(m.payeCentimes + m.attenteCentimes + m.aFacturerCentimes + m.aVenirCentimes, m.totalCentimes);
  entierPartout(r);
});

test('invariant : payé + attente + à facturer + à venir = Σ montants, pour chaque mois, et la somme est celle du récapitulatif de la page Facturation du mois', () => {
  const lignes = [
    ligne('2026-09-05', 4500, { statut: 'facture', versements: [[1000, '2026-09-06'], [500, '2026-10-01']] }),
    ligne('2026-09-20', 3500),
    ligne('2026-10-01', 4500, { versements: [[4500, '2026-10-01']] }),
    ligne('2026-10-08', 4500, { versements: [[1000, '2026-10-02']] }), // à venir avec acompte
    ligne('2026-10-15', 3500, { statut: 'facture' }), // à venir facturée
    ligne('2026-10-20', 0), // 0 €
    ligne('2026-08-31', 25000, { categorie: 'bilan', statut: 'facture', versements: [[26000, '2026-09-01']] }), // trop-perçu
  ];
  const r = caMensuel(lignes, { de: '2026-08', a: '2026-10', aujourdHui: A });
  for (const m of r.mois) {
    assert.equal(m.payeCentimes + m.attenteCentimes + m.aFacturerCentimes + m.aVenirCentimes, m.totalCentimes, m.mois);
    const recap = recapMensuel(lignes, { mois: m.mois, vue: 'prestation', aujourdHui: A }).total;
    assert.equal(m.totalCentimes, recap.duCentimes, `${m.mois} : total = dû du récapitulatif`);
    assert.equal(m.payeCentimes, recap.payeCentimes, `${m.mois} : payé = payé du récapitulatif`);
    assert.equal(m.attenteCentimes + m.aFacturerCentimes + m.aVenirCentimes, recap.resteCentimes, `${m.mois} : reste = reste du récapitulatif`);
    assert.equal(m.tropPercuCentimes, recap.tropPercuCentimes, m.mois);
  }
  assert.equal(r.total.totalCentimes, r.mois.reduce((s, m) => s + m.totalCentimes, 0));
  entierPartout(r);
});

test('acompte : la part versée est « payé », le reste suit le statut (facturé -> attente, non facturé -> à facturer)', () => {
  const [m] = ca([ligne('2026-10-01', 4500, { statut: 'facture', versements: [[1500, '2026-10-01']] }), ligne('2026-10-01', 4500, { versements: [[1500, '2026-10-01']] })]).mois;
  assert.deepEqual([m.payeCentimes, m.attenteCentimes, m.aFacturerCentimes], [3000, 3000, 3000]);
});

test('trop-perçu : plafonné à la ligne dans « payé » (pas de compensation avec une autre ligne), signalé à part', () => {
  const [m] = ca([ligne('2026-10-01', 4500, { versements: [[6000, '2026-10-01']] }), ligne('2026-10-01', 3500)]).mois;
  assert.deepEqual([m.payeCentimes, m.aFacturerCentimes, m.totalCentimes, m.tropPercuCentimes], [4500, 3500, 8000, 1500]);
});

test('prestation à 0 € : comptée dans le nombre, rien dans les montants, jamais « à facturer »', () => {
  const [m] = ca([ligne('2026-10-01', 0), ligne('2026-10-01', 0, { statut: 'facture' })]).mois;
  assert.deepEqual([m.nombre, m.totalCentimes, m.aFacturerCentimes, m.attenteCentimes, m.payeCentimes], [2, 0, 0, 0, 0]);
});

test('prestation à venir NON facturée : son reste n\'est pas « à facturer » mais compté à part (aVenirCentimes, un reste) ; facturée : elle compte en « attente » ; sa part déjà versée reste « payé »', () => {
  const [m] = ca([ligne('2026-10-08', 4500), ligne('2026-10-09', 4500, { statut: 'facture' }), ligne('2026-10-10', 4500, { versements: [[1000, '2026-10-02']] })]).mois;
  assert.deepEqual([m.aFacturerCentimes, m.attenteCentimes, m.aVenirCentimes, m.payeCentimes, m.totalCentimes], [0, 4500, 8000, 1000, 13500]);
  // la veille et le jour même ne sont pas « à venir »
  const [j] = ca([ligne('2026-10-02', 4500), ligne('2026-10-03', 4500)]).mois;
  assert.deepEqual([j.aFacturerCentimes, j.aVenirCentimes], [4500, 4500]);
});

test('mois vide : présent avec des zéros (12 mois toujours renvoyés) ; changement d\'année', () => {
  const r = caMensuel([ligne('2026-12-31', 4500), ligne('2027-01-01', 3500)], { de: '2026-11', a: '2027-02', aujourdHui: '2027-03-01' });
  assert.deepEqual(r.mois.map((m) => m.mois), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(r.mois.map((m) => m.totalCentimes), [0, 4500, 3500, 0]);
  assert.equal(r.mois[0].nombre, 0);
  assert.equal(r.total.totalCentimes, 8000);
  assert.deepEqual(ca([]).total, { nombre: 0, payeCentimes: 0, attenteCentimes: 0, aFacturerCentimes: 0, aVenirCentimes: 0, totalCentimes: 0, tropPercuCentimes: 0 });
});

test('les prestations hors période sont ignorées', () => {
  assert.equal(ca([ligne('2026-09-30', 4500), ligne('2026-11-01', 4500)]).total.totalCentimes, 0);
});

test('vue versement : Σ des versements datés du mois, toutes prestations, trop-perçu compris, prestations d\'autres mois comprises', () => {
  const lignes = [
    ligne('2026-09-20', 4500, { versements: [[4500, '2026-10-01']] }),
    ligne('2026-10-01', 4500, { versements: [[1000, '2026-10-01'], [5000, '2026-11-02']] }),
    ligne('2026-10-05', 3500),
  ];
  const r = caMensuel(lignes, { de: '2026-09', a: '2026-11', vue: 'versement', aujourdHui: A });
  assert.deepEqual(r.mois.map((m) => m.encaisseCentimes), [0, 5500, 5000]);
  assert.deepEqual(r.mois.map((m) => m.nombre), [0, 2, 1]);
  assert.equal(r.total.encaisseCentimes, 10500);
  assert.throws(() => caMensuel([], { de: '2026-10', a: '2026-10', vue: 'x', aujourdHui: A }), RangeError);
});

// ------------------------------------------------------------------ Séances

test('séances par mois : catégorie « séance » seulement ; bilans et autres prestations comptés à part ; réalisées / à venir', () => {
  const r = seances(
    [
      ligne('2026-10-01', 4500),
      ligne('2026-10-02', 3500, { prestationId: 'seance-30', libelle: 'Séance à domicile 45 min' }),
      ligne('2026-10-03', 4500), // à venir
      ligne('2026-10-01', 25000, { categorie: 'bilan', prestationId: 'bilan-initial', libelle: 'Bilan initial' }),
      ligne('2026-10-04', 6000, { categorie: 'autre', prestationId: 'reunion-synthese', libelle: 'Réunion de synthèse' }),
      ligne('2026-09-30', 4500),
    ],
    { de: '2026-10', a: '2026-10', granularite: 'mois', aujourdHui: A },
  );
  assert.deepEqual(r.periodes.map((p) => [p.periode, p.realisees, p.aVenir, p.autres, p.total]), [['2026-10', 2, 1, 2, 3]]);
  assert.deepEqual(r.total, { realisees: 2, aVenir: 1, autres: 2, total: 3 });
});

test('séances par semaine ISO : semaines vides présentes, une semaine à cheval sur deux mois comptée une fois, W53 / changement d\'année', () => {
  assert.equal(semaineIso('2026-12-31'), '2026-W53');
  assert.equal(semaineIso('2027-01-01'), '2026-W53');
  assert.equal(semaineIso('2026-10-02'), '2026-W40');
  const r = seances([ligne('2026-12-31', 4500), ligne('2027-01-01', 4500), ligne('2027-01-04', 4500)], { de: '2026-12', a: '2027-01', granularite: 'semaine', aujourdHui: '2027-02-01' });
  const parSemaine = Object.fromEntries(r.periodes.map((p) => [p.periode, p.total]));
  assert.equal(parSemaine['2026-W53'], 2); // jeudi 31/12 et vendredi 01/01 : même semaine, comptée une seule fois
  assert.equal(parSemaine['2027-W01'], 1);
  assert.equal(parSemaine['2026-W50'], 0); // semaine sans séance : présente
  assert.equal(r.total.total, 3);
  assert.equal(r.periodes[0].periode, '2026-W49'); // lundi 30/11/2026 : semaine partielle (1er décembre)
  assert.equal(r.periodes[0].partielle, true);
  assert.equal(r.periodes[0].debut, '2026-11-30');
  assert.equal(r.periodes.at(-1).periode, '2027-W04'); // dimanche 31/01/2027 : fin de semaine, donc complète
  assert.equal(r.periodes.at(-1).partielle, false);
  assert.equal(r.periodes[2].partielle, false);
});

test('séances par semaine : seules les lignes des mois de la période comptent (semaine de bord tronquée)', () => {
  const r = seances([ligne('2026-09-30', 4500), ligne('2026-10-01', 4500)], { de: '2026-10', a: '2026-10', granularite: 'semaine', aujourdHui: A });
  assert.equal(r.total.total, 1); // le 30/09 est dans la même semaine ISO (W40) mais hors période
  assert.equal(r.periodes[0].periode, '2026-W40');
});

test('lundiDeSemaine : lundi, dimanche, changement d\'année', () => {
  assert.equal(lundiDeSemaine('2026-10-05'), '2026-10-05');
  assert.equal(lundiDeSemaine('2026-10-04'), '2026-09-28');
  assert.equal(lundiDeSemaine('2027-01-01'), '2026-12-28');
});

test('séances : mois sans activité, granularité inconnue', () => {
  const r = seances([], { de: '2026-09', a: '2026-10', aujourdHui: A });
  assert.deepEqual(r.periodes.map((p) => p.total), [0, 0]);
  assert.throws(() => seances([], { de: '2026-10', a: '2026-10', granularite: 'jour', aujourdHui: A }), RangeError);
});

// ------------------------------------------------------------------ Répartition

test('répartition : la somme des montants est exactement le total ; tri décroissant ; ‰ entiers', () => {
  const lignes = [
    ligne('2026-10-01', 4500),
    ligne('2026-10-08', 4500),
    ligne('2026-10-09', 25000, { categorie: 'bilan', prestationId: 'bilan-initial', libelle: 'Bilan initial' }),
    ligne('2026-09-09', 6000, { categorie: 'autre', prestationId: 'reunion-synthese', libelle: 'Réunion de synthèse' }), // hors période
    ligne('2026-10-10', 0, { categorie: 'autre', prestationId: 'compte-rendu', libelle: 'Courrier' }),
  ];
  const r = repartition(lignes, { de: '2026-10', a: '2026-10' });
  assert.deepEqual(r.types.map((t) => [t.prestationId, t.caCentimes, t.nombre]), [['bilan-initial', 25000, 1], ['seance-45', 9000, 2], ['compte-rendu', 0, 1]]);
  assert.equal(r.types.reduce((s, t) => s + t.caCentimes, 0), r.totalCentimes);
  assert.equal(r.totalCentimes, 34000);
  assert.deepEqual(r.types.map((t) => t.partPourMille), [735, 265, 0]); // 73,5 % + 26,5 %
  entierPartout(r);
});

test('répartition : somme exacte même quand les pourcentages arrondis ne font pas 100 %', () => {
  const r = repartition([ligne('2026-10-01', 100, { prestationId: 'a', libelle: 'A' }), ligne('2026-10-01', 100, { prestationId: 'b', libelle: 'B' }), ligne('2026-10-01', 100, { prestationId: 'c', libelle: 'C' })], { de: '2026-10', a: '2026-10' });
  assert.deepEqual(r.types.map((t) => t.partPourMille), [334, 333, 333]); // plus fort reste, égalité départagée par le tri : 100 % pile
  assert.equal(r.types.reduce((s, t) => s + t.caCentimes, 0), 300);
});

test('répartition : les parts en ‰ somment exactement 1000 (7 types égaux, restes inégaux, un type à 0)', () => {
  const somme = (r) => r.types.reduce((s, t) => s + t.partPourMille, 0);
  const periode = { de: '2026-10', a: '2026-10' };
  const sept = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ligne('2026-10-01', 100, { prestationId: id, libelle: id.toUpperCase() }));
  const r7 = repartition(sept, periode);
  assert.equal(somme(r7), 1000);
  assert.deepEqual(r7.types.map((t) => t.partPourMille), [143, 143, 143, 143, 143, 143, 142]);
  const mixte = repartition([ligne('2026-10-01', 1, { prestationId: 'x', libelle: 'X' }), ligne('2026-10-01', 2, { prestationId: 'y', libelle: 'Y' }), ligne('2026-10-01', 4, { prestationId: 'z', libelle: 'Z' }), ligne('2026-10-01', 0, { prestationId: 'w', libelle: 'W' })], periode);
  assert.equal(somme(mixte), 1000);
  assert.equal(mixte.types.find((t) => t.prestationId === 'w').partPourMille, 0);
  assert.equal(mixte.types.reduce((s, t) => s + t.caCentimes, 0), mixte.totalCentimes);
  assert.deepEqual(repartition(sept, periode), r7); // déterministe
  for (let n = 1; n <= 40; n++) {
    const lignes = Array.from({ length: n }, (_, i) => ligne('2026-10-01', 37 + i * 11, { prestationId: `t${i}`, libelle: `T${i}` }));
    assert.equal(somme(repartition(lignes, periode)), 1000, `${n} types`);
  }
});

test('répartition : un type renommé reste un seul groupe (libellé du catalogue, sinon libellé figé le plus récent)', () => {
  const lignes = [ligne('2026-09-01', 4500, { libelle: 'Séance individuelle 45 min' }), ligne('2026-10-01', 4500, { libelle: 'Séance 45 min (ancien nom)' })];
  assert.deepEqual(repartition(lignes, { de: '2026-09', a: '2026-10', catalogue: [{ id: 'seance-45', libelle: 'Nouveau nom' }] }).types.map((t) => [t.libelle, t.nombre]), [['Nouveau nom', 2]]);
  assert.equal(repartition(lignes, { de: '2026-09', a: '2026-10' }).types[0].libelle, 'Séance 45 min (ancien nom)');
});

test('répartition : période sans prestation, total 0', () => {
  assert.deepEqual(repartition([], { de: '2026-10', a: '2026-10' }), { de: '2026-10', a: '2026-10', totalCentimes: 0, nombre: 0, types: [] });
  assert.equal(repartition([ligne('2026-10-01', 0)], { de: '2026-10', a: '2026-10' }).types[0].partPourMille, 0);
});

test('répartition et CA : même total sur une même période (le dû)', () => {
  const lignes = [ligne('2026-09-01', 4500, { versements: [[9000, '2026-09-01']] }), ligne('2026-10-01', 3500, { statut: 'facture' }), ligne('2026-10-20', 4500)];
  assert.equal(repartition(lignes, { de: '2026-09', a: '2026-10' }).totalCentimes, caMensuel(lignes, { de: '2026-09', a: '2026-10', aujourdHui: A }).total.totalCentimes);
});

// ------------------------------------------------------------------ Impayés

test('vecteur 5 et frontières des tranches : 29 j -> 0-29 ; 30 -> 30-59 ; 59 ; 60 ; 89 ; 90 -> 90 et plus', () => {
  const facturee = (factureLe) => ligne('2026-06-01', 1000, { statut: 'facture', factureLe });
  const cas = { '2026-09-03': '0-29', '2026-09-02': '30-59', '2026-08-04': '30-59', '2026-08-03': '60-89', '2026-07-05': '60-89', '2026-07-04': '90-plus' };
  for (const [date, tranche] of Object.entries(cas)) assert.equal(trancheAnciennete(ancienneteJours(facturee(date), A)), tranche, date);
  assert.equal(ancienneteJours(facturee('2026-09-03'), A), 29);
  assert.equal(ancienneteJours(facturee('2026-09-02'), A), 30);
  assert.equal(ancienneteJours(facturee('2026-08-04'), A), 59);
  assert.equal(ancienneteJours(facturee('2026-08-03'), A), 60);
  assert.equal(ancienneteJours(facturee('2026-07-05'), A), 89);
  assert.equal(ancienneteJours(facturee('2026-07-04'), A), 90);
  assert.equal(ancienneteJours(facturee('2026-10-02'), A), 0);
});

test('impayés : facturées (depuis la facturation) et non facturées (depuis la prestation) séparées ; reste partiel ; total', () => {
  const r = impayes(
    [
      ligne('2026-06-01', 4500, { statut: 'facture', factureLe: '2026-09-02' }), // 30 j depuis la facturation (la prestation date de plus de 90 j)
      ligne('2026-09-20', 4500, { statut: 'facture', factureLe: '2026-09-30', versements: [[1500, '2026-10-01']] }), // 2 j, reste 30 €
      ligne('2026-05-01', 3500), // non facturée, 154 j depuis la prestation
      ligne('2026-09-25', 3500), // non facturée, 7 j
    ],
    A,
  );
  assert.deepEqual(r.factures.map((t) => [t.tranche, t.nombre, t.resteCentimes]), [['0-29', 1, 3000], ['30-59', 1, 4500], ['60-89', 0, 0], ['90-plus', 0, 0]]);
  assert.deepEqual(r.nonFactures.map((t) => [t.tranche, t.nombre, t.resteCentimes]), [['0-29', 1, 3500], ['30-59', 0, 0], ['60-89', 0, 0], ['90-plus', 1, 3500]]);
  assert.deepEqual([r.resteFactureCentimes, r.resteNonFactureCentimes, r.totalResteCentimes, r.nombre], [7500, 7000, 14500, 4]);
  assert.equal(r.factures.reduce((s, t) => s + t.resteCentimes, 0) + r.nonFactures.reduce((s, t) => s + t.resteCentimes, 0), r.totalResteCentimes);
  entierPartout(r);
});

test('impayés : payé, trop-perçu et 0 € absents ; prestation à venir exclue ; date de facturation future = tranche 0-29', () => {
  const r = impayes(
    [
      ligne('2026-09-01', 4500, { versements: [[4500, '2026-09-01']] }),
      ligne('2026-09-01', 4500, { versements: [[6000, '2026-09-01']] }),
      ligne('2026-09-01', 0),
      ligne('2026-10-03', 4500), // à venir
      ligne('2026-09-01', 4500, { statut: 'facture', factureLe: '2026-10-20' }),
    ],
    A,
  );
  assert.deepEqual([r.nombre, r.totalResteCentimes], [1, 4500]);
  assert.equal(r.factures[0].nombre, 1);
  assert.deepEqual(impayes([], A).totalResteCentimes, 0);
});

test('impayés : la prestation du jour même est un impayé (0 jour)', () => {
  assert.equal(impayes([ligne('2026-10-02', 4500)], A).nonFactures[0].nombre, 1);
});

// ------------------------------------------------------------------ Filtre « ancienneté » de la liste (clic sur une tranche)

test('filtre anciennete de la liste = mêmes lignes que la tranche du tableau de bord', () => {
  const lignes = [
    ligne('2026-06-01', 4500, { statut: 'facture', factureLe: '2026-09-02' }),
    ligne('2026-09-20', 4500, { statut: 'facture', factureLe: '2026-09-30' }),
    ligne('2026-05-01', 3500),
    ligne('2026-06-01', 4500, { statut: 'facture', factureLe: '2026-09-02', versements: [[4500, '2026-09-10']] }), // payée
  ];
  const f = (filtres) => filtrerPrestations(lignes, filtres, A, etatPaiement);
  assert.equal(f({ anciennete: '30-59', statut: 'facture' }).length, 1);
  assert.equal(f({ anciennete: '0-29', statut: 'facture' }).length, 1);
  assert.equal(f({ anciennete: '90-plus', statut: 'a_facturer' }).length, 1);
  assert.equal(f({ anciennete: '30-59', statut: 'a_facturer' }).length, 0);
  const r = impayes(lignes, A);
  assert.equal(f({ anciennete: '30-59', statut: 'facture' }).length, r.factures[1].nombre);
});

// ------------------------------------------------------------------ Paramètres

test('validerParametresIndicateurs : défaut = 12 derniers mois ; bornes ; paramètres inconnus ou invalides -> 400 ; aucun nom de patient', () => {
  const q = (s) => new URLSearchParams(s);
  assert.deepEqual(validerParametresIndicateurs(q(''), A), { de: '2025-11', a: '2026-10' });
  assert.deepEqual(validerParametresIndicateurs(q('de=2026-01&a=2026-03'), A), { de: '2026-01', a: '2026-03' });
  assert.deepEqual(validerParametresIndicateurs(q('vue=versement'), A, ['vue']), { de: '2025-11', a: '2026-10', vue: 'versement' });
  assert.deepEqual(validerParametresIndicateurs(q(''), A, ['granularite']), { de: '2025-11', a: '2026-10', granularite: 'mois' });
  assert.deepEqual(validerParametresIndicateurs(q('a=2026-02'), '2026-10-02').de, '2025-03');
  for (const [requete, extras] of [['de=2026-13', []], ['de=abc', []], ['a=2026-1', []], ['de=2026-05&a=2026-04', []], ['de=2020-01&a=2026-04', []], ['vue=x', ['vue']], ['granularite=jour', ['granularite']], ['vue=prestation', []], ['patient=Lapin', []]]) {
    assert.throws(() => validerParametresIndicateurs(q(requete), A, extras), { status: 400 }, requete);
  }
  assert.throws(() => validerFiltres(q('anciennete=31-59')), { status: 400 });
  assert.equal(validerFiltres(q('anciennete=90-plus')).anciennete, '90-plus');
});

test('prestation à venir déjà facturée : « attente » (reste à payer, acompte déduit), plus « à venir » ; l\'égalité avec le dû de Facturation du mois tient sur plusieurs mois', () => {
  const lignes = [
    ligne('2026-10-15', 5000, { statut: 'facture', factureLe: '2026-10-02', versements: [[2000, '2026-10-02']] }), // à venir, facturée, acompte
    ligne('2026-11-05', 4500, { statut: 'facture', factureLe: '2026-10-01' }), // à venir (mois suivant), facturée
    ligne('2026-11-06', 4500, { versements: [[500, '2026-10-02']] }), // à venir, non facturée, acompte
    ligne('2026-12-01', 3500, { statut: 'facture', factureLe: '2026-10-02', versements: [[3500, '2026-10-02']] }), // à venir, facturée, soldée
    ligne('2026-09-10', 4500, { statut: 'facture', factureLe: '2026-09-12', versements: [[1000, '2026-09-20']] }),
    ligne('2026-09-11', 3500),
  ];
  const r = caMensuel(lignes, { de: '2026-09', a: '2026-12', aujourdHui: A });
  const par = Object.fromEntries(r.mois.map((m) => [m.mois, m]));
  assert.deepEqual([par['2026-10'].attenteCentimes, par['2026-10'].aVenirCentimes, par['2026-10'].payeCentimes, par['2026-10'].totalCentimes], [3000, 0, 2000, 5000]);
  assert.deepEqual([par['2026-11'].attenteCentimes, par['2026-11'].aVenirCentimes, par['2026-11'].payeCentimes], [4500, 4000, 500]);
  assert.deepEqual([par['2026-12'].attenteCentimes, par['2026-12'].aVenirCentimes, par['2026-12'].payeCentimes], [0, 0, 3500]);
  for (const m of r.mois) {
    const recap = recapMensuel(lignes, { mois: m.mois, vue: 'prestation', aujourdHui: A }).total;
    assert.equal(m.totalCentimes, recap.duCentimes, `${m.mois} : total = dû`);
    assert.equal(m.payeCentimes, recap.payeCentimes, `${m.mois} : payé`);
    assert.equal(m.attenteCentimes + m.aFacturerCentimes + m.aVenirCentimes, recap.resteCentimes, `${m.mois} : reste`);
    assert.equal(m.payeCentimes + m.attenteCentimes + m.aFacturerCentimes + m.aVenirCentimes, m.totalCentimes, `${m.mois} : invariant`);
  }
  // « Reste à encaisser » = facturé en attente + à facturer (échus) de tous les mois ; l'à venir non facturé n'y est pas
  const imp = impayes(lignes, A);
  assert.equal(imp.totalResteCentimes, r.mois.reduce((t, m) => t + m.attenteCentimes + m.aFacturerCentimes, 0));
  assert.equal(imp.resteFactureCentimes, r.mois.reduce((t, m) => t + m.attenteCentimes, 0));
  assert.equal(imp.resteNonFactureCentimes, r.mois.reduce((t, m) => t + m.aFacturerCentimes, 0));
  entierPartout([r, imp]);
});

test('impayés : une prestation à venir déjà facturée compte (ancienneté depuis la facturation), une à venir non facturée non ; une soldée jamais ; le filtre de la liste suit la même règle', () => {
  const lignes = [
    ligne('2026-10-20', 4500, { statut: 'facture', factureLe: '2026-09-02', versements: [[1500, '2026-09-10']] }), // à venir, facturée il y a 30 j, reste 30 €
    ligne('2026-10-21', 4500),
    ligne('2026-10-22', 4500, { statut: 'facture', factureLe: '2026-10-01', versements: [[4500, '2026-10-01']] }),
  ];
  const r = impayes(lignes, A);
  assert.deepEqual([r.nombre, r.totalResteCentimes, r.resteFactureCentimes, r.resteNonFactureCentimes], [1, 3000, 3000, 0]);
  assert.deepEqual(r.factures.map((t) => t.nombre), [0, 1, 0, 0]);
  const f = (filtres) => filtrerPrestations(lignes, filtres, A, etatPaiement);
  assert.equal(f({ anciennete: '30-59', statut: 'facture' }).length, 1);
  assert.equal(f({ anciennete: '0-29' }).length, 0);
  assert.deepEqual(lignes.map((l) => compteDansImpayes(l, A)), [true, false, true]);
});

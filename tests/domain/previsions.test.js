import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajouterJours } from '../../src/domain/dates.js';
import { diviserArrondi, historique, premiereEstimation, previsions } from '../../src/domain/previsions.js';

let n = 0;
const lapin = { id: 'p-lapin', nom: 'Lapin', prenom: 'Pierre' };

/** Prestation factice ; `versements` = [[centimes, date], ...]. */
function ligne(date, montantCentimes, { statut = 'a_facturer', versements = [] } = {}) {
  n += 1;
  return {
    id: `l${n}`,
    patient: lapin,
    date,
    prestationId: 'seance-45',
    libelle: 'Séance individuelle 45 min',
    categorie: 'seance',
    motif: '',
    montantCentimes,
    statut,
    factureLe: statut === 'facture' ? date : null,
    versements: versements.map(([m, d], i) => ({ id: `v${n}-${i}`, montantCentimes: m, date: d, mode: 'cheque' })),
    creeLe: '2026-01-01T00:00:00.000Z',
    modifieLe: '2026-01-01T00:00:00.000Z',
  };
}
const entierPartout = (valeur) => {
  if (typeof valeur === 'number') assert.ok(Number.isSafeInteger(valeur), `entier attendu : ${valeur}`);
  else if (valeur && typeof valeur === 'object') Object.values(valeur).forEach(entierPartout);
};
const prev = (prestations, aujourdHui, options = {}) => previsions(prestations, { aujourdHui, ...options });

/** Trois mois d'historique juillet-août-septembre 2026 (330000 au total, base 110000), exemple de contrôle de l'architecture §6.7. */
const historique2026 = () => [ligne('2026-07-01', 100000), ligne('2026-07-20', 20000), ligne('2026-08-12', 60000), ligne('2026-09-15', 150000)];

// ------------------------------------------------------------------ Arrondi

test('diviserArrondi : entier le plus proche, moitié vers le haut, aucun flottant', () => {
  assert.equal(diviserArrondi(10, 3), 3);
  assert.equal(diviserArrondi(11, 3), 4);
  assert.equal(diviserArrondi(3, 2), 2); // 1,5 -> 2
  assert.equal(diviserArrondi(1, 2), 1); // 0,5 -> 1
  assert.equal(diviserArrondi(0, 31), 0);
  assert.equal(diviserArrondi(110000 * 21, 31), 74516); // 74516,13
});

// ------------------------------------------------------------------ Exemples de contrôle de l'architecture §6.7

test('vecteur n°3 : A = 2026-10-10, base 110000, octobre 114516, novembre 110000, décembre 110000, janvier 2027 150000', () => {
  const lignes = [...historique2026(), ligne('2026-10-05', 40000), ligne('2026-10-20', 30000), ligne('2026-11-05', 20000), ligne('2027-01-12', 150000)];
  const r = prev(lignes, '2026-10-10');
  assert.equal(r.suffisant, true);
  assert.equal(r.base, 110000);
  assert.deepEqual(r.mois.map((m) => m.mois), ['2026-10', '2026-11', '2026-12', '2027-01']);
  assert.deepEqual(r.mois[0], { mois: '2026-10', courant: true, realiseCentimes: 40000, planifieCentimes: 30000, complementEstimeCentimes: 44516, estimationCentimes: 114516 });
  assert.deepEqual(r.mois[1], { mois: '2026-11', courant: false, realiseCentimes: 0, planifieCentimes: 20000, complementEstimeCentimes: 90000, estimationCentimes: 110000 });
  assert.deepEqual(r.mois[2], { mois: '2026-12', courant: false, realiseCentimes: 0, planifieCentimes: 0, complementEstimeCentimes: 110000, estimationCentimes: 110000 });
  assert.deepEqual(r.mois[3], { mois: '2027-01', courant: false, realiseCentimes: 0, planifieCentimes: 150000, complementEstimeCentimes: 0, estimationCentimes: 150000 });
  entierPartout(r);
});

test('vecteur n°4 : plus ancienne prestation au 2026-08-05, A = 2026-10-10 -> insuffisant, rien n\'est calculé', () => {
  const r = prev([ligne('2026-08-05', 50000), ligne('2026-09-10', 60000)], '2026-10-10');
  assert.equal(r.suffisant, false);
  assert.equal(r.base, null);
  assert.deepEqual(r.mois, []);
  assert.equal(r.moisComplets, 1); // septembre seulement
  assert.equal(r.moisManquants, 2);
});

// ------------------------------------------------------------------ Historique minimal

test('historique : fichier vide -> 0 mois complet, 3 manquants (l’utilisatrice part de zéro)', () => {
  assert.deepEqual(historique([], '2026-10-10'), { plusAncienne: null, moisComplets: 0, moisManquants: 3 });
  const r = prev([], '2026-10-10');
  assert.equal(r.suffisant, false);
  assert.equal(r.moisManquants, 3);
  assert.deepEqual(r.mois, []);
});

test('historique : un seul mois (le mois en cours) ne compte pas ; un seul mois complet = 2 manquants', () => {
  assert.equal(prev([ligne('2026-10-03', 5000)], '2026-10-10').moisManquants, 3);
  assert.equal(prev([ligne('2026-10-01', 5000)], '2026-10-10').moisComplets, 0);
  const septembre = prev([ligne('2026-09-01', 5000), ligne('2026-10-03', 5000)], '2026-10-10');
  assert.equal(septembre.moisComplets, 1);
  assert.equal(septembre.moisManquants, 2);
  assert.equal(septembre.suffisant, false);
});

test('historique : frontière exacte au 1er jour de M-3 (au plus tard)', () => {
  assert.equal(historique([ligne('2026-07-01', 1)], '2026-10-10').moisManquants, 0); // juillet complet
  assert.equal(historique([ligne('2026-06-30', 1)], '2026-10-10').moisManquants, 0);
  assert.deepEqual(historique([ligne('2026-07-02', 1)], '2026-10-10'), { plusAncienne: '2026-07-02', moisComplets: 2, moisManquants: 1 }); // juillet incomplet
  assert.equal(historique([ligne('2026-07-01', 1)], '2026-10-01').moisManquants, 0); // le 1er du mois en cours : toujours juillet-septembre
  assert.equal(historique([ligne('2026-07-01', 1)], '2026-10-31').moisManquants, 0);
});

test('historique : une prestation à date future n\'est pas un historique ; une prestation à 0 € en est une', () => {
  assert.equal(prev([ligne('2026-11-20', 4500)], '2026-10-10').moisManquants, 3);
  const r = prev([ligne('2026-07-01', 0), ligne('2026-08-10', 30000), ligne('2026-09-10', 60000)], '2026-10-10');
  assert.equal(r.suffisant, true);
  assert.equal(r.base, 30000); // (0 + 30000 + 60000) / 3
});

test('historique : un mois sans activité au milieu compte pour 0 dans la moyenne', () => {
  const r = prev([ligne('2026-07-01', 90000), ligne('2026-09-15', 90000)], '2026-10-10');
  assert.equal(r.suffisant, true);
  assert.equal(r.base, 60000);
});

// ------------------------------------------------------------------ Bords du mois en cours

test('mois en cours au 1er jour : jours restants = jours du mois - 1 (30/31 de la base)', () => {
  const r = prev(historique2026(), '2026-10-01');
  assert.equal(r.mois[0].estimationCentimes, 106452); // 110000 x 30 / 31 = 106451,61
  assert.equal(r.mois[0].realiseCentimes, 0);
});

test('mois en cours au dernier jour : plus de jours restants, estimation = réalisé', () => {
  const lignes = [...historique2026(), ligne('2026-10-02', 40000), ligne('2026-10-31', 5000)];
  const r = prev(lignes, '2026-10-31');
  assert.deepEqual(r.mois[0], { mois: '2026-10', courant: true, realiseCentimes: 45000, planifieCentimes: 0, complementEstimeCentimes: 0, estimationCentimes: 45000 });
  assert.equal(r.mois[1].estimationCentimes, 110000);
});

test('une séance datée d\'aujourd\'hui est du réalisé, pas du planifié', () => {
  const r = prev([...historique2026(), ligne('2026-10-10', 4500)], '2026-10-10');
  assert.equal(r.mois[0].realiseCentimes, 4500);
  assert.equal(r.mois[0].planifieCentimes, 0);
});

test('mois de 30 jours (novembre), de 28 jours (février 2027) et de 29 jours (février 2028)', () => {
  const sur3 = (dates) => dates.map((d) => ligne(d, 30000)); // base 30000
  const nov = prev(sur3(['2026-08-01', '2026-09-10', '2026-10-10']), '2026-11-10');
  assert.equal(nov.mois[0].estimationCentimes, 20000); // 30000 x 20 / 30
  const fev27 = prev(sur3(['2026-11-01', '2026-12-10', '2027-01-10']), '2027-02-10');
  assert.equal(fev27.mois[0].estimationCentimes, 19286); // 30000 x 18 / 28 = 19285,71
  const fev28 = prev(sur3(['2027-11-01', '2027-12-10', '2028-01-10']), '2028-02-10');
  assert.equal(fev28.mois[0].estimationCentimes, 19655); // 30000 x 19 / 29 = 19655,17
});

test('passage de fin d\'année : décembre puis janvier à mars, historique à cheval sur deux années', () => {
  const lignes = [ligne('2026-09-01', 90000), ligne('2026-10-08', 60000), ligne('2026-11-03', 30000), ligne('2027-02-02', 70000)];
  const r = prev(lignes, '2026-12-15');
  assert.equal(r.base, 60000);
  assert.deepEqual(r.mois.map((m) => m.mois), ['2026-12', '2027-01', '2027-02', '2027-03']);
  assert.equal(r.mois[0].estimationCentimes, 30968); // 60000 x 16 / 31 = 30967,74
  assert.equal(r.mois[2].planifieCentimes, 70000);
  assert.equal(r.mois[2].estimationCentimes, 70000);
  assert.equal(r.mois[3].estimationCentimes, 60000);
  // et au 31 janvier 2027 : l'historique est octobre-décembre 2026
  const janvier = prev([ligne('2026-10-01', 30000), ligne('2026-11-02', 60000), ligne('2026-12-02', 90000)], '2027-01-31');
  assert.equal(janvier.base, 60000);
  assert.equal(janvier.mois[0].estimationCentimes, 0); // 31 janvier : plus de jours restants, rien de réalisé
});

// ------------------------------------------------------------------ Planifié contre moyenne

test('séances planifiées supérieures à la moyenne : le planifié l\'emporte, aucun complément', () => {
  const lignes = [...historique2026(), ligne('2026-10-03', 10000), ligne('2026-10-25', 200000), ligne('2026-11-10', 130000)];
  const r = prev(lignes, '2026-10-10');
  assert.equal(r.mois[0].estimationCentimes, 210000); // 10000 + max(200000, 74516)
  assert.equal(r.mois[0].complementEstimeCentimes, 0);
  assert.equal(r.mois[1].estimationCentimes, 130000);
  assert.equal(r.mois[1].complementEstimeCentimes, 0);
});

test('séances planifiées inférieures à la moyenne : pas de double comptage, estimation = réalisé + moyenne au prorata', () => {
  const lignes = [...historique2026(), ligne('2026-10-03', 10000), ligne('2026-10-25', 4500), ligne('2026-11-10', 4500)];
  const r = prev(lignes, '2026-10-10');
  assert.equal(r.mois[0].estimationCentimes, 84516); // 10000 + max(4500, 74516), et non 10000 + 4500 + 74516
  assert.equal(r.mois[0].complementEstimeCentimes, 70016); // 84516 - 10000 - 4500
  assert.equal(r.mois[1].estimationCentimes, 110000); // max(4500, 110000), et non 114500
});

test('planifié exactement égal à la moyenne : estimation inchangée', () => {
  const r = prev([...historique2026(), ligne('2026-11-04', 110000)], '2026-10-10');
  assert.equal(r.mois[1].estimationCentimes, 110000);
  assert.equal(r.mois[1].complementEstimeCentimes, 0);
});

// ------------------------------------------------------------------ Base = montants (totalCentimes), jamais les restes à payer

test('acomptes et facturation : seuls les montants comptent, aucun double comptage avec le réalisé', () => {
  const lignes = [
    ligne('2026-07-01', 9000, { statut: 'facture', versements: [[9000, '2026-07-06']] }), // payée
    ligne('2026-08-05', 9000, { statut: 'facture', versements: [[2000, '2026-08-06']] }), // acompte seul
    ligne('2026-09-05', 9000), // non facturée, rien versé
    ligne('2026-10-05', 4500, { versements: [[4500, '2026-10-05']] }), // réalisé, payé
    ligne('2026-10-20', 4500, { statut: 'facture', versements: [[1000, '2026-10-02']] }), // à venir, déjà facturée, acompte
    ligne('2026-11-10', 3000, { versements: [[3000, '2026-10-02']] }), // à venir, déjà payée en totalité
  ];
  const r = prev(lignes, '2026-10-10');
  assert.equal(r.base, 9000); // (9000 + 9000 + 9000) / 3 : les restes à payer (0, 7000, 9000) ne servent pas
  assert.equal(r.mois[0].realiseCentimes, 4500);
  assert.equal(r.mois[0].planifieCentimes, 4500); // montant, pas le reste (3500)
  assert.equal(r.mois[0].estimationCentimes, 10597); // 4500 + max(4500, 9000 x 21 / 31 = 6096,77 -> 6097)
  assert.equal(r.mois[1].planifieCentimes, 3000); // montant de la prestation déjà payée en totalité : comptée une fois
  assert.equal(r.mois[1].estimationCentimes, 9000);
});

test('prestation à 0 € : ne change aucun montant du réalisé ni du planifié', () => {
  const r = prev([...historique2026(), ligne('2026-10-03', 0), ligne('2026-10-25', 0)], '2026-10-10');
  assert.equal(r.mois[0].realiseCentimes, 0);
  assert.equal(r.mois[0].planifieCentimes, 0);
  assert.equal(r.mois[0].estimationCentimes, 74516);
});

// ------------------------------------------------------------------ Arrondis, fenêtres, déterminisme

test('arrondi de la base : moitié vers le haut, un seul arrondi, centimes entiers', () => {
  assert.equal(prev([ligne('2026-07-01', 100000), ligne('2026-08-01', 100000), ligne('2026-09-01', 100001)], '2026-10-10').base, 100000); // 100000,33
  assert.equal(prev([ligne('2026-07-01', 100000), ligne('2026-08-01', 100000), ligne('2026-09-01', 100002)], '2026-10-10').base, 100001); // 100000,67
  assert.equal(prev([ligne('2026-08-01', 1), ligne('2026-09-01', 2)], '2026-10-10', { fenetre: 2 }).base, 2); // 1,5 -> 2
});

test('hors fenêtre : mois antérieurs à M-3 et mois au-delà de l\'horizon sont ignorés', () => {
  const lignes = [ligne('2026-05-10', 999999), ...historique2026(), ligne('2027-02-10', 999999)];
  const r = prev(lignes, '2026-10-10');
  assert.equal(r.base, 110000);
  assert.equal(r.mois.length, 4);
  assert.ok(r.mois.every((m) => m.estimationCentimes < 999999));
});

test('contrat : sortie déterministe, entrées non modifiées, tout est entier, estimation >= réalisé + planifié, complément >= 0 chaque jour de l\'année', () => {
  const lignes = [...historique2026(), ligne('2026-10-05', 40000), ligne('2026-10-20', 30000), ligne('2026-11-05', 20000)];
  const avant = JSON.stringify(lignes);
  for (let jour = 0; jour < 365; jour++) {
    const date = new Date(Date.UTC(2026, 9, 1 + jour)).toISOString().slice(0, 10);
    const a = prev(lignes, date);
    assert.deepEqual(a, prev(lignes, date));
    entierPartout(a);
    for (const m of a.mois) {
      assert.ok(m.estimationCentimes >= m.realiseCentimes + m.planifieCentimes, date);
      assert.ok(m.complementEstimeCentimes >= 0, date);
      assert.equal(m.estimationCentimes, m.realiseCentimes + m.planifieCentimes + m.complementEstimeCentimes, date);
    }
  }
  assert.equal(JSON.stringify(lignes), avant);
});

test('options : fenêtre et horizon paramétrables', () => {
  const r = prev(historique2026(), '2026-10-10', { fenetre: 2, horizon: 1 }); // base sur août et septembre : 105000
  assert.equal(r.base, 105000);
  assert.deepEqual(r.mois.map((m) => m.mois), ['2026-10', '2026-11']);
});

// ------------------------------------------------------------------ Date de la première estimation

test('première estimation : première prestation le 2 novembre -> premier mois complet décembre -> le 1er mars', () => {
  assert.equal(premiereEstimation('2026-11-02'), '2027-03-01');
});

test('première estimation : prestation le 1er (mois complet) ; fin de mois ; autre année ; aucune prestation', () => {
  assert.equal(premiereEstimation('2026-11-01'), '2027-02-01');
  assert.equal(premiereEstimation('2026-08-05'), '2026-12-01'); // septembre premier complet -> sept., oct., nov. -> 1er décembre
  assert.equal(premiereEstimation('2026-10-31'), '2027-02-01'); // novembre premier complet
  assert.equal(premiereEstimation('2026-12-15'), '2027-04-01'); // passage d'année
  assert.equal(premiereEstimation('2026-11-02', 2), '2027-02-01'); // fenêtre paramétrable
  assert.equal(premiereEstimation(null), null);
});

test('première estimation exposée par previsions : date si historique insuffisant, null sinon', () => {
  const r = prev([ligne('2026-11-02', 4500)], '2027-02-15');
  assert.equal(r.suffisant, false);
  assert.equal(r.moisManquants, 1);
  assert.equal(r.premiereEstimationLe, '2027-03-01');
  assert.equal(prev([ligne('2026-11-02', 4500)], '2027-03-01').suffisant, true);
  assert.equal(prev([ligne('2026-11-02', 4500)], '2027-03-01').premiereEstimationLe, null);
  assert.equal(prev([], '2026-10-10').premiereEstimationLe, null); // fichier vide : rien à annoncer
});

test('première estimation : cohérente avec la règle de historique/previsions, la veille insuffisante et le jour même suffisant (toutes premières dates sur 2 ans)', () => {
  for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2028, 0, 1)); d = new Date(d.getTime() + 86_400_000 * 3)) {
    const premiere = d.toISOString().slice(0, 10);
    const date = premiereEstimation(premiere);
    assert.ok(date.endsWith('-01'));
    assert.equal(prev([ligne(premiere, 100)], date).suffisant, true, `${premiere} -> ${date}`);
    assert.equal(prev([ligne(premiere, 100)], ajouterJours(date, -1)).suffisant, false, `${premiere} -> veille de ${date}`);
  }
});

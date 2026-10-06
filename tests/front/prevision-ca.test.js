// Composition du graphique du CA avec l'estimation, « dont séances planifiées » borné, libellés,
// phrases d'explication et mention « (estimé) » sur l'axe. Fonctions pures, plus la lecture du source de l'écran
// (pas de DOM sous node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { caMensuel } from '../../src/domain/indicateurs.js';
import { previsions } from '../../src/domain/previsions.js';
import { LIBELLE_DONT_PLANIFIE, LIBELLE_PREVU_TABLEAU, LIBELLE_TOTAL_HORS_PREVU, MENTION_ESTIME, MENTION_PARTIEL, NOTE_VUE_ENCAISSE, composerMois, composerPrevision, formatJourLong, previsionPerimee, ligneVide, noteMethode, phrasePremiereEstimation } from '../../public/js/graphiques/prevision-ca.js';
import { RACINE } from '../aides/temp.js';

const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');
const ligneCa = (mois, { paye = 0, attente = 0, aFacturer = 0, aVenir = 0 } = {}) => ({ ...ligneVide(mois), payeCentimes: paye, attenteCentimes: attente, aFacturerCentimes: aFacturer, aVenirCentimes: aVenir, totalCentimes: paye + attente + aFacturer + aVenir });
const estimation = (mois, estimationCentimes, courant = false) => ({ mois, courant, realiseCentimes: 0, planifieCentimes: 0, complementEstimeCentimes: 0, estimationCentimes });

// ------------------------------------------------------------------ Montant en haut des barres (fonction pure)

test('Barre réalisée seule (pas d\'estimation pour ce mois) : pas de prévu, le haut de barre est la pile réelle', () => {
  const r = composerMois(ligneCa('2026-09', { paye: 10000, attente: 5000, aFacturer: 2500 }), undefined);
  assert.deepEqual(r.barres, [10000, 5000, 2500]);
  assert.equal(r.empile, 17500);
  assert.equal(r.prevu, 0);
  assert.equal(r.haut, 17500);
  assert.equal(r.estime, false);
  assert.equal(r.dontPlanifieCentimes, 0);
});

test('Estimation > réalisé : le prévu complète la pile jusqu\'à l\'estimation (haut = estimation)', () => {
  const r = composerMois(ligneCa('2026-10', { paye: 10000, attente: 5000 }), estimation('2026-10', 40000, true));
  assert.equal(r.prevu, 25000);
  assert.equal(r.haut, 40000);
  assert.equal(r.estime, true);
  assert.equal(r.courant, true);
});

test('Estimation < réalisé : jamais de prévu négatif, le haut garde la hauteur réelle', () => {
  const r = composerMois(ligneCa('2026-10', { paye: 30000, aFacturer: 20000 }), estimation('2026-10', 40000));
  assert.equal(r.prevu, 0);
  assert.equal(r.haut, 50000);
});

test('Mois estimé sans réalisé (mois suivant sans ligne) : tout est prévu', () => {
  const r = composerMois(ligneVide('2026-12'), estimation('2026-12', 110000));
  assert.deepEqual(r.barres, [0, 0, 0]);
  assert.equal(r.prevu, 110000);
  assert.equal(r.haut, 110000);
});

test('Centimes exacts, entiers sûrs, aucun arrondi', () => {
  const r = composerMois(ligneCa('2026-10', { paye: 3333, attente: 1, aFacturer: 99 }), estimation('2026-10', 114516, true));
  assert.equal(r.empile, 3433);
  assert.equal(r.prevu, 111083);
  assert.equal(r.haut, 114516);
  for (const v of [r.empile, r.prevu, r.haut]) assert.ok(Number.isSafeInteger(v));
});

// ------------------------------------------------------------------ « dont séances déjà planifiées » ne dépasse pas le prévu

test('Séance future facturée d\'avance avec acompte : le « dont planifiées » est 0, jamais le montant de la séance', () => {
  // séance de 45 € le 5/11, facturée d'avance, acompte de 10 € : payé 10 €, facturé en attente 35 €, rien « à venir non facturé »
  const r = composerMois(ligneCa('2026-11', { paye: 1000, attente: 3500 }), { ...estimation('2026-11', 4500), planifieCentimes: 4500 });
  assert.equal(r.prevu, 0);
  assert.equal(r.dontPlanifieCentimes, 0);
});

test('Séance future non facturée : le « dont » est son reste à payer, compris dans le prévu', () => {
  const r = composerMois(ligneCa('2026-10', { aVenir: 50000 }), { ...estimation('2026-10', 50000, true), planifieCentimes: 50000 });
  assert.equal(r.prevu, 50000);
  assert.equal(r.dontPlanifieCentimes, 50000);
});

test('Même en cas d\'incohérence entre deux réponses, le « dont » est borné par le prévu', () => {
  const r = composerMois(ligneCa('2026-10', { paye: 9000, aVenir: 5000 }), estimation('2026-10', 10000, true));
  assert.equal(r.prevu, 1000);
  assert.equal(r.dontPlanifieCentimes, 1000);
});

// ------------------------------------------------------------------ Composition avec les vraies réponses du serveur

let n = 0;
function prestation(date, montantCentimes, { statut = 'a_facturer', versements = [] } = {}) {
  n += 1;
  return { id: `l${n}`, patient: { id: 'p', nom: 'Lapin', prenom: 'Pierre' }, date, prestationId: 'x', libelle: 'Séance', categorie: 'seance', motif: '', montantCentimes, statut, factureLe: statut === 'facture' ? date : null, versements: versements.map(([m, d], i) => ({ id: `v${n}-${i}`, montantCentimes: m, date: d, mode: 'cheque' })), creeLe: '2026-01-01T00:00:00.000Z', modifieLe: '2026-01-01T00:00:00.000Z' };
}
const historique = () => [prestation('2026-07-01', 100000), prestation('2026-07-20', 20000), prestation('2026-08-12', 60000), prestation('2026-09-15', 150000)];

/** Ce que fait tableau-de-bord.js : ca-mensuel de la période + prévision + ca-mensuel des mois suivants. */
function reponses(prestations, aujourdHui, de = '2026-07') {
  const donnees = previsions(prestations, { aujourdHui });
  const mois = aujourdHui.slice(0, 7);
  const ca = caMensuel(prestations, { de, a: mois, aujourdHui });
  const suivants = donnees.mois.filter((m) => !m.courant);
  const futurs = suivants.length ? caMensuel(prestations, { de: suivants[0].mois, a: suivants.at(-1).mois, aujourdHui }) : null;
  return { ca, prevision: { donnees, futurs } };
}

test('Sur les vraies réponses du serveur, pile + prévu = estimation, mois suivants sans ligne compris', () => {
  const lignes = [...historique(), prestation('2026-10-05', 40000), prestation('2026-10-20', 30000), prestation('2026-11-05', 20000), prestation('2027-01-12', 150000)];
  const { ca, prevision } = reponses(lignes, '2026-10-10');
  const r = composerPrevision(ca.mois, prevision, true);
  assert.deepEqual(r.map((m) => m.mois), ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
  assert.deepEqual(r.map((m) => m.estime), [false, false, false, true, true, true, true]);
  assert.deepEqual(r.slice(3).map((m) => m.haut), [114516, 110000, 110000, 150000]); // exemple de contrôle de l'architecture §6.7
  assert.deepEqual(r.slice(0, 3).map((m) => m.prevu), [0, 0, 0]);
  assert.equal(r[3].courant, true);
});

test('Balayage de 100 situations aléatoires (400 mois estimés) (statuts, acomptes, séances d\'avance) : haut = estimation, prévu >= 0, dont <= prévu, aucun montant perdu', () => {
  let graine = 12345;
  const alea = (max) => {
    graine = (graine * 1103515245 + 12345) % 2147483648;
    return graine % max;
  };
  const statuts = ['a_facturer', 'facture'];
  for (let essai = 0; essai < 100; essai += 1) {
    const jour = String(1 + alea(28)).padStart(2, '0');
    const aujourdHui = `2026-10-${jour}`;
    const lignes = historique();
    for (let i = 0; i < 12; i += 1) {
      const [annee, mois] = [['2026', '09'], ['2026', '10'], ['2026', '10'], ['2026', '11'], ['2026', '12'], ['2027', '01']][alea(6)];
      const j = String(1 + alea(28)).padStart(2, '0');
      const montant = (1 + alea(30000));
      const versements = alea(3) === 0 ? [[Math.min(montant, 1 + alea(montant)), `${annee}-${mois}-${j}`]] : [];
      lignes.push(prestation(`${annee}-${mois}-${j}`, montant, { statut: statuts[alea(2)], versements }));
    }
    const { ca, prevision } = reponses(lignes, aujourdHui);
    const r = composerPrevision(ca.mois, prevision, true);
    for (const m of r.filter((x) => x.estime)) {
      assert.equal(m.haut, m.estimationCentimes, `${aujourdHui} ${m.mois}`);
      assert.ok(m.prevu >= 0);
      assert.ok(m.dontPlanifieCentimes <= m.prevu, `${aujourdHui} ${m.mois} : dont ${m.dontPlanifieCentimes} > prévu ${m.prevu}`);
      assert.equal(m.dontPlanifieCentimes, m.source.aVenirCentimes); // rien ne se perd : la colonne « à venir non facturé » est bien le « dont »
    }
  }
});

test('composerPrevision : null sans estimation (historique insuffisant, période sans mois en cours) ; mois suivants vides si leur ligne manque', () => {
  const lignes = [...historique(), prestation('2026-11-05', 20000)];
  const { ca, prevision } = reponses(lignes, '2026-10-10');
  assert.equal(composerPrevision(ca.mois, prevision, false), null);
  const court = reponses([prestation('2026-09-15', 1000)], '2026-10-10');
  assert.equal(composerPrevision(court.ca.mois, court.prevision, true), null);
  assert.equal(composerPrevision(ca.mois, null, true), null);
  assert.equal(composerPrevision(ca.mois, { erreur: 'x' }, true), null);
  const sansFuturs = composerPrevision(ca.mois, { donnees: prevision.donnees, futurs: null }, true);
  assert.deepEqual(sansFuturs.slice(-3).map((m) => [m.mois, m.barres.join('/'), m.prevu]), [['2026-11', '0/0/0', 110000], ['2026-12', '0/0/0', 110000], ['2027-01', '0/0/0', 110000]]);
});

// ------------------------------------------------------------------ Textes

test('La phrase d\'explication dit que le mois sans prestation compte pour 0 (vacances) et que le mois en cours suppose la saisie à jour', () => {
  const t = noteMethode(3);
  assert.match(t, /moyenne des 3 derniers mois complets/);
  assert.match(t, /un mois sans aucune prestation compte pour 0/);
  assert.match(t, /vacances/);
  assert.match(t, /mois en cours/);
  assert.match(t, /séances déjà réalisées sont saisies/);
  assert.match(t, /trop basse/);
});

test('La vue « Encaissé » explique pourquoi il n\'y a pas d\'estimation et où la trouver', () => {
  assert.match(NOTE_VUE_ENCAISSE, /Pas d'estimation dans cette vue/);
  assert.match(NOTE_VUE_ENCAISSE, /chiffre d'affaires dû/);
  assert.match(NOTE_VUE_ENCAISSE, /Dû par date de prestation/);
  const source = lire('public/js/pages/tdb-sections.js');
  assert.match(source, /figureEncaisse, el\('p', \{ classe: 'carte__note', texte: NOTE_VUE_ENCAISSE \}\)/);
});

test('Dates en français et phrase de la première estimation', () => {
  assert.equal(formatJourLong('2027-03-01'), '1er mars 2027');
  assert.equal(formatJourLong('2027-02-15'), '15 février 2027');
  assert.equal(formatJourLong(null), '');
  assert.equal(formatJourLong('2027-13-01'), '');
  assert.equal(phrasePremiereEstimation('2027-03-01'), 'La première estimation sera possible à partir du 1er mars 2027.');
  assert.equal(phrasePremiereEstimation(null), '');
});

test('L\'état « pas assez d\'historique » affiche la date fournie par le serveur', () => {
  const source = lire('public/js/pages/tdb-sections.js');
  assert.match(source, /phrasePremiereEstimation\(p\.premiereEstimationLe\)/);
});

test('En mode estimation, plus de « hors barres » ni de colonne « Prévu » ambiguë ; le reste « à venir » est dit compris dans le prévu', () => {
  for (const libelle of [LIBELLE_PREVU_TABLEAU, LIBELLE_DONT_PLANIFIE, LIBELLE_TOTAL_HORS_PREVU]) assert.doesNotMatch(libelle, /hors barres/);
  assert.match(LIBELLE_PREVU_TABLEAU, /complément jusqu'à l'estimation/);
  assert.match(LIBELLE_DONT_PLANIFIE, /non facturées/);
  const source = lire('public/js/pages/tdb-sections.js');
  assert.match(source, /compris dans la barre « prévu »/);
  assert.match(source, /if \(!estimation && avecAVenir\) entetes\.push\('À venir, non facturé \(hors barres\)'\)/);
  assert.doesNotMatch(source, /parMois/); // l'ancienne composition (non testée) a disparu de l'écran
});

test('« (estimé) » sur l\'axe pour les mois estimés, « (en partie) » pour le mois en cours ; l\'axe sait l\'écrire', () => {
  assert.equal(MENTION_ESTIME, '(estimé)');
  assert.equal(MENTION_PARTIEL, '(en partie)');
  const sections = lire('public/js/pages/tdb-sections.js');
  assert.match(sections, /mention: l\.courant \? MENTION_PARTIEL : l\.estime \? MENTION_ESTIME : null/);
  const barres = lire('public/js/graphiques/barres-svg.js');
  assert.match(barres, /categorie\.mention/);
  assert.match(barres, /\(c\.mention \? 1 : 0\)/, 'une ligne de plus sous l\'axe pour la mention');
});

test('previsionPerimee : dates du jour de la prévision et de ca-mensuel différentes -> relecture ; identiques ou sans prévision -> non', () => {
  const ca = { aujourdHui: '2026-10-31' };
  assert.equal(previsionPerimee(ca, { donnees: { aujourdHui: '2026-11-01' }, futurs: null }), true);
  assert.equal(previsionPerimee(ca, { donnees: { aujourdHui: '2026-10-31' }, futurs: null }), false);
  assert.equal(previsionPerimee(ca, null), false);
  assert.equal(previsionPerimee(ca, { erreur: 'x' }), false);
});

test('tableau de bord : la relecture de la prévision est branchée sur previsionPerimee, une seule fois', () => {
  const source = lire('public/js/pages/tableau-de-bord.js');
  assert.equal(source.match(/previsionPerimee\(/g).length, 2, 'un contrôle après la première lecture, un après la seule relecture');
});

// Recette QA : modules purs du navigateur (public/js) — formats français, filtre patient, texte copié, périodes, échelles, graphique avec estimation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correspondPatient, formatDate, formatEuros, formatMois, formatMontantSaisie, formatTaille, libellesModes, listeModesPaiement, normaliserRecherche, pluriel, resumePaiement } from '../../public/js/format.js';
import { formaterDetailTexte, formaterRecapTexte } from '../../public/js/recap-texte.js';
import { lignesAMarquer } from '../../public/js/recap-regles.js';
import { PERIODES, plagePeriode } from '../../public/js/periodes.js';
import { disposerColonnes, echelle } from '../../public/js/graphiques/mise-en-page.js';
import { composerPrevision } from '../../public/js/graphiques/prevision-ca.js';
import { caMensuel } from '../../src/domain/indicateurs.js';
import { previsions } from '../../src/domain/previsions.js';
import { recapMensuel } from '../../src/domain/recap.js';
import { ajouterMois } from '../../src/domain/dates.js';
import { prestationsAleatoires } from './aides-qa.js';

const NBSP = String.fromCharCode(0xa0);

test('formatEuros : séparateur de milliers et espace insécable avant €, deux décimales, 0 €, 1 centime, 100 000 €, valeur invalide', () => {
  assert.equal(formatEuros(0), `0,00${NBSP}€`);
  assert.equal(formatEuros(1), `0,01${NBSP}€`);
  assert.equal(formatEuros(125050).replace(/[  ]/g, ' '), '1 250,50 €');
  assert.equal(formatEuros(10_000_000).replace(/[  ]/g, ' '), '100 000,00 €');
  assert.equal(formatEuros(99999999999).replace(/[  ]/g, ' '), '999 999 999,99 €');
  assert.equal(formatEuros(NaN), '—');
  assert.equal(formatEuros(undefined), '—');
  assert.equal(formatEuros(1.5), '—');
  assert.equal(formatMontantSaisie(4500), '45,00');
  assert.equal(formatMontantSaisie(5), '0,05');
});

test('dates et mois en français ; tailles ; pluriels', () => {
  assert.equal(formatDate('2028-02-29'), '29/02/2028');
  assert.equal(formatDate('n\'importe quoi'), '');
  assert.equal(formatDate(null), '');
  assert.equal(formatMois('2026-12'), 'décembre 2026');
  assert.equal(formatMois('2026-00'), '');
  assert.equal(pluriel(0, 'prestation'), '0 prestation');
  assert.equal(pluriel(1, 'prestation'), '1 prestation');
  assert.equal(pluriel(2, 'prestation'), '2 prestations');
  assert.equal(formatTaille(0), '0 octet');
  assert.equal(formatTaille(1), '1 octet');
  assert.equal(formatTaille(2048).replace(NBSP, ' '), '2 Ko');
  assert.equal(formatTaille(-1), '—');
});

test('filtre patient : partiel, insensible à la casse et aux accents, « nom prénom » et « prénom nom », espaces multiples', () => {
  const p = { nom: 'Hérisson', prenom: 'Sonic' };
  for (const ok of ['', 'her', 'HÉR', 'sonic', 'herisson sonic', 'sonic herisson', '  sonic   hér ', 'ic', 'Sonic Hérisson']) assert.equal(correspondPatient(p, ok), true, JSON.stringify(ok));
  for (const ko of ['lapin', 'sonicc', 'hérissonn sonic', 'x']) assert.equal(correspondPatient(p, ko), false, ko);
  assert.equal(normaliserRecherche('  ÉCUREUIL  Noé '), 'ecureuil noe');
  assert.equal(correspondPatient({ nom: 'O\'Brien', prenom: 'Zoë' }, 'zoe o\'brien'), true);
});

test('modes de paiement affichés : ordre chronologique du premier versement, sans doublon, mode inconnu = « Autre », rien si non payé', () => {
  const v = (mode, date) => ({ mode, date });
  assert.deepEqual(libellesModes([v('virement', '2026-10-05'), v('especes', '2026-10-01'), v('virement', '2026-10-09')]), ['Espèces', 'Virement']);
  assert.deepEqual(libellesModes([v('bitcoin', '2026-10-01'), v(undefined, '2026-10-02')]), ['Autre']);
  assert.deepEqual(libellesModes(null), []);
  assert.deepEqual(listeModesPaiement({ etat: 'non_paye', versements: [] }), []);
  assert.equal(resumePaiement({ etat: 'paye', versements: [v('virement', '2026-10-05'), v('cheque', '2026-10-09')] }).aria, 'Payé en totalité par virement et chèque');
  assert.equal(resumePaiement({ etat: 'partiel', versements: [v('carte', '2026-10-05')] }).aria, 'Partiellement payé par carte bancaire');
  assert.equal(resumePaiement({ etat: 'paye', versements: [] }).aria, 'Payé en totalité', 'prestation à 0 € : payée sans versement');
  assert.equal(resumePaiement({ etat: 'non_paye', versements: [] }).aria, 'Non payé');
});

test('texte copié : tabulations et sauts de ligne neutralisés dans les noms, formule neutralisée, montants à la virgule sans symbole ; total et en-tête présents', () => {
  const lignes = [
    { id: 'a', patient: { id: 'p1', nom: 'Du\tpont', prenom: 'Zoë\nBis' }, date: '2026-10-01', prestationId: 'reunion-synthese', libelle: '=SOMME(A1)', categorie: 'seance', motif: '', montantCentimes: 125050, statut: 'a_facturer', factureLe: null, versements: [], creeLe: 'x', modifieLe: 'x' },
    { id: 'b', patient: { id: 'p2', nom: '=cmd', prenom: 'X' }, date: '2026-10-02', prestationId: 'reunion-synthese', libelle: 'Séance', categorie: 'seance', motif: '', montantCentimes: 4500, statut: 'a_facturer', factureLe: null, versements: [{ id: 'v', montantCentimes: 4500, date: '2026-10-02', mode: 'carte' }], creeLe: 'x', modifieLe: 'x' },
  ];
  const recap = recapMensuel(lignes, { mois: '2026-10', aujourdHui: '2026-10-15' });
  const texte = formaterRecapTexte(recap);
  const rangees = texte.split('\n');
  assert.equal(rangees[0], 'Patient\tSéances\tMontant dû\tPayé\tReste à payer');
  assert.equal(rangees.length, 4, 'en-tête + 2 patients + total');
  for (const r of rangees) assert.equal(r.split('\t').length, 5, `5 colonnes : ${JSON.stringify(r)}`);
  assert.ok(rangees.some((r) => r.startsWith('\'=cmd X\t')), 'formule neutralisée');
  assert.ok(rangees.some((r) => r.startsWith('Du pont Zoë Bis\t1\t1250,50\t0,00\t1250,50')), `nom nettoyé : ${rangees.join(' | ')}`);
  assert.equal(rangees.at(-1), 'Total\t2\t1295,50\t45,00\t1250,50');
  const detail = formaterDetailTexte(recap.patients.find((p) => p.patient.id === 'p1'));
  assert.ok(detail.includes('\'=SOMME(A1)'), 'libellé formule neutralisé dans le détail');
});

test('« Marquer facturé » : seules les lignes à facturer et échues (0 € comprises) ; les prestations à venir restent à facturer', () => {
  const l = (statut, aVenir, montant = 100) => ({ statut, aVenir, montantCentimes: montant });
  const r = lignesAMarquer([l('a_facturer', false), l('a_facturer', true), l('facture', false), l('a_facturer', false, 0)]);
  assert.equal(r.concernees.length, 2);
  assert.equal(r.aVenir, 1);
});

test('périodes du tableau de bord : 12 mois à cheval sur deux années, 1er janvier, 31 décembre, bornes 2000 et 2100 sans sortie de plage', () => {
  assert.deepEqual(plagePeriode('12-mois', '2026-10-03'), { de: '2025-11', a: '2026-10' });
  assert.deepEqual(plagePeriode('12-mois', '2026-01-01'), { de: '2025-02', a: '2026-01' });
  assert.deepEqual(plagePeriode('12-mois', '2026-12-31'), { de: '2026-01', a: '2026-12' });
  assert.deepEqual(plagePeriode('6-mois', '2026-03-15'), { de: '2025-10', a: '2026-03' });
  assert.deepEqual(plagePeriode('3-mois', '2027-01-31'), { de: '2026-11', a: '2027-01' });
  assert.deepEqual(plagePeriode('annee', '2026-02-28'), { de: '2026-01', a: '2026-02' });
  assert.deepEqual(plagePeriode('annee-precedente', '2026-02-28'), { de: '2025-01', a: '2025-12' });
  assert.deepEqual(plagePeriode('inconnue', '2026-10-03'), plagePeriode('12-mois', '2026-10-03'));
  const bas = plagePeriode('12-mois', '2000-03-01');
  assert.ok(bas.de >= '2000-01' && bas.de <= bas.a, JSON.stringify(bas));
  assert.deepEqual(plagePeriode('annee-precedente', '2000-06-01'), { de: '2000-01', a: '2000-06' });
  for (const p of PERIODES) {
    const r = plagePeriode(p.id, '2026-10-03');
    assert.ok(r.de <= r.a, p.id);
  }
});

test('échelle des graphiques : aucun maximum nul, pas de 1/2/5 × 10^n, le maximum couvre la valeur, quelle que soit l\'ordre de grandeur (0 à 100 000 €)', () => {
  for (const max of [0, 1, 99, 100, 101, 4999, 5000, 12345, 99_999, 1_000_000, 10_000_000, 123_456_789]) {
    const e = echelle(max, { pasMin: 100 });
    assert.ok(e.max >= max, `max ${e.max} >= ${max}`);
    assert.ok(e.max > 0);
    assert.ok(e.graduations.length >= 2 && e.graduations.length <= 12, `${max} : ${e.graduations.length} graduations`);
    assert.equal(e.graduations[0], 0);
    assert.equal(e.graduations.at(-1), e.max);
    assert.match(String(e.pas / 100), /^(1|2|5)0*$|^[0-9]+$/);
  }
  const c = disposerColonnes({ largeur: 600, hauteur: 300, marges: { gauche: 40, droite: 10, haut: 10, bas: 30 }, valeurs: [[100, 50], [0, 0], [300, 0]], maxAxe: 400 });
  assert.equal(c.colonnes.length, 3);
  for (const col of c.colonnes) assert.ok(col.barreX >= c.zone.x && col.barreX + col.barreLargeur <= c.zone.x + c.zone.largeur + 0.001);
  const vide = disposerColonnes({ largeur: 100, hauteur: 100, marges: { gauche: 40, droite: 40, haut: 40, bas: 40 }, valeurs: [], maxAxe: 100 });
  assert.equal(vide.colonnes.length, 0);
});

test('graphique du CA avec estimation (bout en bout serveur -> navigateur, 5 jeux aléatoires, plusieurs jours) : la pile monte exactement jusqu\'à l\'estimation, jamais de double comptage', () => {
  for (const graine of [1, 2, 3, 4, 5]) {
    const lignes = prestationsAleatoires(1200, { graine, debut: '2025-10-01', jours: 420, aujourdHui: '2026-10-03' });
    for (const jour of ['2026-10-01', '2026-10-03', '2026-10-31', '2026-11-15']) {
      const mois = jour.slice(0, 7);
      const de = ajouterMois(`${mois}-01`, -11).slice(0, 7);
      const ca = caMensuel(lignes, { de, a: mois, aujourdHui: jour });
      const prev = previsions(lignes, { aujourdHui: jour });
      const [futursDe, futursA] = [ajouterMois(`${mois}-01`, 1).slice(0, 7), ajouterMois(`${mois}-01`, 3).slice(0, 7)];
      const futurs = caMensuel(lignes, { de: futursDe, a: futursA, aujourdHui: jour });
      const compose = composerPrevision(ca.mois, { donnees: prev, futurs }, true);
      if (!prev.suffisant) { assert.equal(compose, null); continue; }
      assert.equal(compose.length, ca.mois.length + 3);
      for (const m of compose) {
        assert.ok(m.prevu >= 0, `${jour} ${m.mois} prévu >= 0`);
        assert.equal(m.haut, m.empile + m.prevu);
        if (m.estime) {
          assert.equal(m.haut, Math.max(m.estimationCentimes, m.empile), `${jour} ${m.mois} : haut = max(estimation, empilé)`);
          assert.ok(m.dontPlanifieCentimes <= m.prevu);
        } else {
          assert.equal(m.prevu, 0);
        }
        assert.equal(m.empile, m.barres[0] + m.barres[1] + m.barres[2]);
        assert.ok(m.empile <= m.source.totalCentimes || m.source.totalCentimes === 0 || m.empile <= m.source.totalCentimes + m.source.tropPercuCentimes, `${m.mois} barres <= total`);
      }
    }
  }
});

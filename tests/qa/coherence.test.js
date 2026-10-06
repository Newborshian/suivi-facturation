// Recette QA : cohérence entre Facturation du mois (recap) et Tableau de bord (indicateurs) sur plusieurs mois.
// Propriétés vérifiées sur des jeux pseudo-aléatoires déterministes (graines fixes), entièrement factices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aFacturerGlobal, recapMensuel } from '../../src/domain/recap.js';
import { caMensuel, impayes, listerMois, repartition, seances } from '../../src/domain/indicateurs.js';
import { etatPaiement } from '../../src/domain/paiement.js';
import { previsions } from '../../src/domain/previsions.js';
import { catalogueTest } from '../aides/catalogue-test.js';
import { moisDe } from '../../src/domain/dates.js';
import { prestationsAleatoires } from './aides-qa.js';

const AUJOURDHUI = '2026-06-15';
const jeux = [1, 2, 3, 4, 5].map((graine) => prestationsAleatoires(1500, { graine, debut: '2024-01-01', jours: 1000, aujourdHui: AUJOURDHUI }));
const de = '2024-01';
const a = '2026-09'; // couvre aussi des mois à venir (après AUJOURDHUI)

for (const [index, lignes] of jeux.entries()) {
  test(`jeu ${index + 1} : pour chaque mois, le « dû » de Facturation du mois = le total du graphique du CA = payé + reste`, () => {
    const ca = caMensuel(lignes, { de, a, aujourdHui: AUJOURDHUI });
    assert.equal(ca.mois.length, listerMois(de, a).length);
    for (const m of ca.mois) {
      const recap = recapMensuel(lignes, { mois: m.mois, aujourdHui: AUJOURDHUI });
      const t = recap.total;
      assert.equal(t.duCentimes, m.totalCentimes, `${m.mois} : dû du récapitulatif = total du mois du graphique`);
      assert.equal(t.duCentimes, t.payeCentimes + t.resteCentimes, `${m.mois} : dû = payé + reste`);
      assert.equal(t.payeCentimes, m.payeCentimes, `${m.mois} : payé identique`);
      assert.equal(t.resteCentimes, m.attenteCentimes + m.aFacturerCentimes + m.aVenirCentimes, `${m.mois} : reste = attente + à facturer + à venir`);
      // somme des barres (+ reste à venir non facturé, hors barres) = dû
      assert.equal(m.payeCentimes + m.attenteCentimes + m.aFacturerCentimes + m.aVenirCentimes, m.totalCentimes, `${m.mois} : somme des segments = dû`);
      assert.equal(t.tropPercuCentimes, m.tropPercuCentimes, `${m.mois} : trop-perçu identique`);
      assert.equal(t.nbPrestations, m.nombre, `${m.mois} : nombre de prestations identique`);
      // par patient : dû = payé + reste, et la somme des patients = total
      let sommeDu = 0;
      for (const p of recap.patients) {
        assert.equal(p.duCentimes, p.payeCentimes + p.resteCentimes, `${m.mois} / patient`);
        assert.equal(p.nbPrestations, p.nbSeances + p.nbAutres);
        sommeDu += p.duCentimes;
      }
      assert.equal(sommeDu, t.duCentimes);
    }
  });

  test(`jeu ${index + 1} : séances par mois = par semaine (mêmes totaux), nombre de séances du récapitulatif = nombre du graphique`, () => {
    const parMois = seances(lignes, { de, a, granularite: 'mois', aujourdHui: AUJOURDHUI });
    const parSemaine = seances(lignes, { de, a, granularite: 'semaine', aujourdHui: AUJOURDHUI });
    assert.deepEqual(parSemaine.total, parMois.total);
    for (const p of parMois.periodes) {
      const recap = recapMensuel(lignes, { mois: p.periode, aujourdHui: AUJOURDHUI });
      assert.equal(recap.total.nbSeances, p.total, `${p.periode} : séances`);
      assert.equal(recap.total.nbAutres, p.autres, `${p.periode} : autres prestations`);
      assert.equal(recap.total.nbSeances + recap.total.nbAutres, recap.total.nbPrestations);
    }
  });

  test(`jeu ${index + 1} : répartition par type = total des montants de la période ; impayés = somme des restes ; à facturer global cohérent`, () => {
    const rep = repartition(lignes, { de, a, catalogue: catalogueTest() });
    const attendu = lignes.filter((l) => moisDe(l.date) >= de && moisDe(l.date) <= a).reduce((s, l) => s + l.montantCentimes, 0);
    assert.equal(rep.totalCentimes, attendu);
    assert.equal(rep.types.reduce((s, t) => s + t.caCentimes, 0), attendu);
    assert.ok(rep.types.every((t) => t.partPourMille >= 0 && t.partPourMille <= 1000));

    const imp = impayes(lignes, AUJOURDHUI);
    const somme = (tr) => tr.reduce((s, t) => s + t.resteCentimes, 0);
    assert.equal(somme(imp.factures) + somme(imp.nonFactures), imp.totalResteCentimes);
    assert.equal(imp.resteFactureCentimes + imp.resteNonFactureCentimes, imp.totalResteCentimes);
    // recalcul indépendant : reste > 0 et (date échue ou facturée)
    const direct = lignes.filter((l) => (l.date <= AUJOURDHUI || l.statut === 'facture') && etatPaiement(l).resteCentimes > 0).reduce((s, l) => s + etatPaiement(l).resteCentimes, 0);
    assert.equal(imp.totalResteCentimes, direct);

    const af = aFacturerGlobal(lignes, AUJOURDHUI);
    const nonFact = lignes.filter((l) => l.statut === 'a_facturer');
    assert.equal(af.nombre + af.aVenirNombre + af.zeroNombre, nonFact.length);
    assert.equal(af.montantCentimes + af.aVenirMontantCentimes, nonFact.reduce((s, l) => s + l.montantCentimes, 0));
  });

  test(`jeu ${index + 1} : vue par date de versement : somme des mois = tous les versements ; trésorerie du graphique = « encaissé » du récapitulatif`, () => {
    const tresor = caMensuel(lignes, { de, a, vue: 'versement', aujourdHui: AUJOURDHUI });
    for (const m of tresor.mois) {
      const recap = recapMensuel(lignes, { mois: m.mois, vue: 'versement', aujourdHui: AUJOURDHUI });
      assert.equal(recap.total.payeCentimes, m.encaisseCentimes, `${m.mois} : encaissé`);
      assert.equal(recap.total.resteCentimes, null, 'pas de reste dans cette vue');
    }
    const attendu = lignes.flatMap((l) => l.versements).filter((v) => moisDe(v.date) >= de && moisDe(v.date) <= a).reduce((s, v) => s + v.montantCentimes, 0);
    assert.equal(tresor.total.encaisseCentimes, attendu);
  });

  test(`jeu ${index + 1} : prévision : entiers, déterministe, jamais inférieure au réalisé + planifié, base = moyenne arrondie des 3 derniers mois`, () => {
    for (const jour of ['2026-06-01', AUJOURDHUI, '2026-06-30', '2026-07-01']) {
      const p = previsions(lignes, { aujourdHui: jour });
      assert.deepEqual(p, previsions(lignes, { aujourdHui: jour }), 'déterministe');
      assert.equal(p.suffisant, true);
      assert.equal(p.mois.length, 4);
      // recalcul indépendant de la base : trois mois civils complets précédant le mois en cours
      const [y, mo] = jour.split('-').map(Number);
      const precedents = [1, 2, 3].map((k) => { const t = y * 12 + (mo - 1) - k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; });
      const somme = lignes.filter((l) => precedents.includes(moisDe(l.date))).reduce((s, l) => s + l.montantCentimes, 0);
      assert.equal(p.base, Math.floor((2 * somme + 3) / 6), `${jour} : base = somme / 3 arrondie`);
      for (const m of p.mois) {
        assert.ok(Number.isSafeInteger(m.estimationCentimes));
        assert.ok(m.estimationCentimes >= m.realiseCentimes + m.planifieCentimes, `${jour} ${m.mois}`);
        assert.equal(m.estimationCentimes, m.realiseCentimes + m.planifieCentimes + m.complementEstimeCentimes);
        assert.ok(m.complementEstimeCentimes >= 0);
      }
    }
  });
}

test('même données, ordre des lignes différent : mêmes totaux (aucune dépendance à l\'ordre du fichier)', () => {
  const lignes = jeux[0];
  const inversees = [...lignes].reverse();
  for (const mois of ['2025-03', '2026-06']) {
    assert.deepEqual(recapMensuel(lignes, { mois, aujourdHui: AUJOURDHUI }).total, recapMensuel(inversees, { mois, aujourdHui: AUJOURDHUI }).total);
  }
  assert.deepEqual(caMensuel(lignes, { de, a, aujourdHui: AUJOURDHUI }).total, caMensuel(inversees, { de, a, aujourdHui: AUJOURDHUI }).total);
});

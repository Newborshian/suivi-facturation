// Recette QA : volumétrie. 20 000 prestations factices (≈ 13 Mo, soit près de 10 ans d'activité à 2 200 lignes par an) :
// les endpoints restent rapides et exacts. Les seuils sont volontairement larges (machine lente, antivirus) : ils détectent
// une explosion (complexité quadratique), pas une variation de quelques dizaines de millisecondes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, etatAvec, prestationsAleatoires, saisie, serveurAvecFichier, texteJson } from './aides-qa.js';
import { etatPaiement } from '../../src/domain/paiement.js';

const N = 20_000;
// Jamais d'assertion de performance sans marge : un runner partagé et lent (macOS, antivirus) peut être bien plus lent que le poste de
// développement. Ces bornes ne repèrent qu'une explosion de complexité (complexité quadratique), pas une variation de vitesse.
const SEUIL_LECTURE_MS = 10_000;
const SEUIL_ECRITURE_MS = 12_000;
const SEUIL_DEMARRAGE_MS = 30_000;

async function chrono(fn) {
  const t = performance.now();
  const r = await fn();
  return { r, ms: performance.now() - t };
}

test(`${N} prestations : démarrage, lectures, indicateurs, exports et écritures dans des temps raisonnables, avec des résultats exacts`, async () => {
  const lignes = prestationsAleatoires(N, { graine: 2026, debut: '2025-11-01', jours: 330, aujourdHui: '2026-10-02' });
  const texte = texteJson(etatAvec(lignes, { revision: 9 }));
  const debut = performance.now();
  const s = await serveurAvecFichier(texte);
  const tDemarrage = performance.now() - debut;
  const a = client(s);
  const mesures = { demarrage: Math.round(tDemarrage) };
  try {
    assert.ok(tDemarrage < SEUIL_DEMARRAGE_MS, `démarrage ${Math.round(tDemarrage)} ms`);
    for (const chemin of [
      '/api/prestations', '/api/prestations?mois=2026-09', '/api/recap?mois=2026-09', '/api/recap?mois=2026-09&vue=versement',
      '/api/indicateurs/ca-mensuel', '/api/indicateurs/seances?granularite=semaine', '/api/indicateurs/repartition', '/api/indicateurs/impayes',
      '/api/indicateurs/prevision', '/api/indicateurs/synthese', '/api/patients', '/api/export?format=csv&contenu=prestations', '/api/export?format=json',
    ]) {
      const { r, ms } = await chrono(() => a.get(chemin));
      mesures[chemin] = Math.round(ms);
      assert.equal(r.status, 200, chemin);
      assert.ok(ms < SEUIL_LECTURE_MS, `${chemin} : ${Math.round(ms)} ms`);
    }
    // exactitude à cette échelle : le « dû » du récapitulatif de septembre 2026 = somme directe
    const direct = lignes.filter((l) => l.date.startsWith('2026-09')).reduce((x, l) => x + l.montantCentimes, 0);
    assert.equal((await a.get('/api/recap?mois=2026-09')).json.total.duCentimes, direct);
    const ca = (await a.get('/api/indicateurs/ca-mensuel?de=2025-11&a=2026-10')).json;
    assert.equal(ca.total.totalCentimes, lignes.filter((l) => l.date >= '2025-11-01' && l.date <= '2026-10-31').reduce((x, l) => x + l.montantCentimes, 0));
    const impayes = (await a.get('/api/indicateurs/impayes')).json;
    const attendu = lignes.filter((l) => l.date <= '2026-10-02' || l.statut === 'facture').reduce((x, l) => x + etatPaiement(l).resteCentimes, 0);
    assert.equal(impayes.totalResteCentimes, attendu);

    // écritures : création, paiement, suppression avec sauvegarde préalable, sur un fichier de 13 Mo
    const creation = await chrono(() => a.post('/api/prestations', saisie()));
    assert.equal(creation.r.status, 201);
    assert.ok(creation.ms < SEUIL_ECRITURE_MS, `création : ${Math.round(creation.ms)} ms`);
    const paiement = await chrono(() => a.post(`/api/prestations/${creation.r.json.donnees.id}/payer-totalite`, { mode: 'carte' }));
    assert.equal(paiement.r.status, 201);
    assert.ok(paiement.ms < SEUIL_ECRITURE_MS, `paiement : ${Math.round(paiement.ms)} ms`);
    const suppression = await chrono(() => a.del(`/api/prestations/${creation.r.json.donnees.id}`));
    assert.equal(suppression.r.status, 200);
    assert.ok(suppression.ms < SEUIL_ECRITURE_MS, `suppression : ${Math.round(suppression.ms)} ms`);
    Object.assign(mesures, { creation: Math.round(creation.ms), paiement: Math.round(paiement.ms), suppression: Math.round(suppression.ms) });

    // 8 écritures concurrentes sur le gros fichier : toutes appliquées, aucune perdue, aucun doublon d'identifiant
    const avant = (await a.get('/api/prestations')).json.lignes.length;
    const reponses = await Promise.all(Array.from({ length: 8 }, (_, i) => a.post('/api/prestations', saisie({ motif: `concurrent ${i}`, date: '2026-09-15' }))));
    assert.ok(reponses.every((r) => r.status === 201), reponses.map((r) => r.status).join(','));
    const apres = (await a.get('/api/prestations')).json.lignes;
    assert.equal(apres.length, avant + 8);
    assert.equal(new Set(apres.map((l) => l.id)).size, apres.length);
  } finally {
    await s.arreter();
    process.stdout.write(`# volumétrie (ms) : ${JSON.stringify(mesures)}\n`);
  }
});

test('50 écritures concurrentes sur un fichier de taille normale (2 200 lignes) : file unique, aucune perte', async () => {
  const s = await serveurAvecFichier(texteJson(etatAvec(prestationsAleatoires(2200, { graine: 3, debut: '2025-11-01', jours: 330, aujourdHui: '2026-10-02' }), { revision: 1 })));
  const a = client(s);
  try {
    const avant = (await a.get('/api/prestations')).json.lignes.length;
    const reponses = await Promise.all(Array.from({ length: 50 }, (_, i) => a.post('/api/prestations', saisie({ motif: `c${i}`, date: '2026-09-15' }))));
    assert.ok(reponses.every((r) => r.status === 201));
    assert.equal((await a.get('/api/prestations')).json.lignes.length, avant + 50);
  } finally {
    await s.arreter();
  }
});

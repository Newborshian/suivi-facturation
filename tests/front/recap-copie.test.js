// Texte copié et règles de l'écran « Facturation du mois », alimentés par la VRAIE sortie de GET /api/recap (serveur de test),
// pas par des objets construits à la main : si le serveur renomme un champ, ces tests le voient.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { formaterRecapTexte } from '../../public/js/recap-texte.js';
import { lignesAMarquerDuMois, nbAVenirAFacturer, recapACopier } from '../../public/js/recap-regles.js';

async function avecServeur(fn) {
  const s = await demarrerServeurTest(); // horloge fixe : 2026-10-02
  const entetes = { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json' };
  const a = {
    get: async (chemin) => (await s.requete({ chemin })).json,
    post: (chemin, corps) => s.requete({ methode: 'POST', chemin, headers: entetes, corps: JSON.stringify(corps) }),
  };
  try {
    await fn(a);
  } finally {
    await s.arreter();
  }
}
const saisie = (extra = {}) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-01', prestationId: 'seance-45', montantCentimes: 4500, motif: '', ...extra });

/** Vecteur 1 + une séance à venir + une autre patiente ; un versement de 45 € sur la première séance. */
async function peupler(a) {
  const l1 = (await a.post('/api/prestations', saisie())).json.donnees;
  await a.post('/api/prestations', saisie({ date: '2026-10-08' }));
  await a.post('/api/prestations', saisie({ date: '2026-10-15', prestationId: 'seance-30', montantCentimes: 3500 }));
  await a.post(`/api/prestations/${l1.id}/versements`, { montantCentimes: 4500, date: '2026-10-01', mode: 'cheque' });
}

test('texte copié depuis la vraie sortie de /api/recap : en-tête avec « Reste à payer », montants exacts, total', () =>
  avecServeur(async (a) => {
    await peupler(a);
    const texte = formaterRecapTexte(await a.get('/api/recap?mois=2026-10'));
    assert.equal(texte, ['Patient\tSéances\tMontant dû\tPayé\tReste à payer', 'Lapin Pierre\t3\t125,00\t45,00\t80,00', 'Total\t3\t125,00\t45,00\t80,00'].join('\n'));
  }));

test('vue par date de versement affichée : le texte copié est tout de même celui de la vue par date de prestation', () =>
  avecServeur(async (a) => {
    await peupler(a);
    const affichee = await a.get('/api/recap?mois=2026-10&vue=versement');
    assert.ok(!formaterRecapTexte(affichee).includes('Reste à payer'), 'la vue versement brute n\'a pas de reste à payer : elle ne doit pas être copiée telle quelle');
    let appels = 0;
    const copiee = await recapACopier(affichee, (mois) => {
      appels += 1;
      return a.get(`/api/recap?mois=${mois}&vue=prestation`);
    });
    assert.equal(appels, 1);
    assert.equal(copiee.vue, 'prestation');
    assert.equal(copiee.mois, '2026-10');
    const texte = formaterRecapTexte(copiee);
    assert.ok(texte.startsWith('Patient\tSéances\tMontant dû\tPayé\tReste à payer\n'));
    assert.ok(!texte.includes('Encaissé'));
    // Vue déjà par date de prestation : aucun rechargement.
    const direct = await a.get('/api/recap?mois=2026-10');
    assert.equal(await recapACopier(direct, () => assert.fail('pas de rechargement attendu')), direct);
  }));

test('« Marquer tout le mois facturé » : les prestations à venir sont exclues, comptées à part', () =>
  avecServeur(async (a) => {
    await peupler(a); // 01/10 (passée), 08/10 et 15/10 (à venir au 02/10)
    const r = await a.get('/api/recap?mois=2026-10');
    assert.deepEqual(lignesAMarquerDuMois(r.patients).map((l) => l.date), ['2026-10-01']);
    assert.equal(nbAVenirAFacturer(r.patients), 2);
    assert.ok(lignesAMarquerDuMois(r.patients).every((l) => l.statut === 'a_facturer' && !l.aVenir));
    // Marquer ces lignes seulement : les prestations à venir restent à facturer.
    await a.post('/api/prestations/statut', { ids: lignesAMarquerDuMois(r.patients).map((l) => l.id), statut: 'facture' });
    const apres = await a.get('/api/recap?mois=2026-10');
    assert.equal(lignesAMarquerDuMois(apres.patients).length, 0, 'bouton désactivé : plus rien à marquer');
    assert.equal(nbAVenirAFacturer(apres.patients), 2);
    assert.deepEqual(apres.aFacturer, { nombre: 0, montantCentimes: 0, aVenirNombre: 2, aVenirMontantCentimes: 8000, zeroNombre: 0 });
  }));

test('prestation à 0 € non facturée : absente de « À facturer » (« Tout est facturé »), dénombrée à part pour expliquer la liste', () =>
  avecServeur(async (a) => {
    const r0 = await a.post('/api/prestations', saisie({ montantCentimes: 0 }));
    assert.equal(r0.status, 201, r0.texte);
    const r = await a.get('/api/recap?mois=2026-10');
    assert.deepEqual(r.aFacturer, { nombre: 0, montantCentimes: 0, aVenirNombre: 0, aVenirMontantCentimes: 0, zeroNombre: 1 });
    // Le total de ce que la liste « à facturer » affichera = nombre + à venir + à 0 € : annoncé, pas caché.
    const { nombre, aVenirNombre, zeroNombre } = r.aFacturer;
    const { lignes } = await a.get('/api/prestations?statut=a_facturer');
    assert.equal(lignes.length, nombre + aVenirNombre + zeroNombre);
  }));

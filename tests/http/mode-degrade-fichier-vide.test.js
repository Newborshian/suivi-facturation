// Côté HTTP : relecture du fichier par GET /api/etat en mode dégradé, restauration décidée depuis l'écran dégradé,
// « repartir d'un fichier vide », rappel de conflit non résolu, utilisations du catalogue. Données factices uniquement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { ecrireFichierTest } from '../aides/temp.js';
import { etatTest, ligneTest, texteEtat } from '../aides/donnees.js';

const NOM_FICHIER = 'suivi-facturation.json';
const SAUV = 'sauvegarde-2026-09-20_10h00m00s_quotidienne.json';
const pause = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));

function api(s) {
  const appeler = (methode, chemin, corps) =>
    s.requete({
      methode,
      chemin,
      headers: { Origin: `http://127.0.0.1:${s.port}`, ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      corps: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
  return { get: (chemin) => s.requete({ chemin }), post: (chemin, corps) => appeler('POST', chemin, corps) };
}

async function avecServeur(fn, options) {
  const s = await demarrerServeurTest(options);
  try {
    await fn(s, api(s));
  } finally {
    await s.arreter();
  }
}

const ecrireDans = (dossier, ...morceaux) => async (contenu) => {
  await fs.mkdir(path.dirname(path.join(dossier, ...morceaux)), { recursive: true });
  await ecrireFichierTest(path.join(dossier, ...morceaux), contenu);
};
const preparerDossier = ({ actif, sauvegardes = {} }) => async (dossier) => {
  if (actif !== undefined) await ecrireDans(dossier, NOM_FICHIER)(actif);
  for (const [nom, contenu] of Object.entries(sauvegardes)) await ecrireDans(dossier, 'sauvegardes', nom)(contenu);
};

test('GET /api/etat en mode « absent » : relit le fichier ; revenu lisible, l\'application sort du mode dégradé sans rien écraser', () =>
  avecServeur(
    async (s, a) => {
      assert.equal((await a.get('/api/etat')).json.modeDegrade, true);
      assert.equal((await a.get('/api/etat')).json.modeDegrade, true, 'toujours absent');
      await assert.rejects(fs.stat(path.join(s.dossier, NOM_FICHIER)), { code: 'ENOENT' });
      const revenu = texteEtat(etatTest(4));
      await ecrireFichierTest(path.join(s.dossier, NOM_FICHIER), revenu);
      const etat = (await a.get('/api/etat')).json;
      assert.equal(etat.modeDegrade, false);
      assert.equal(etat.erreur, null);
      assert.equal(etat.nombrePrestations, 4);
      assert.equal(await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8'), revenu);
      assert.equal((await a.get('/api/prestations')).json.lignes.length, 4);
    },
    { preparer: preparerDossier({ sauvegardes: { [SAUV]: texteEtat(etatTest(2)) } }) },
  ));

test('restaurer « depuisModeDegrade » alors que le fichier est revenu : 409 FICHIER_REVENU, fichier intact ; type invalide 400', () =>
  avecServeur(
    async (s, a) => {
      assert.equal((await a.post(`/api/sauvegardes/${SAUV}/restaurer`, { confirmer: true, depuisModeDegrade: 'oui' })).status, 400);
      assert.equal((await a.post(`/api/sauvegardes/${SAUV}/restaurer`, { confirmer: true, autre: true })).status, 400);
      const revenu = texteEtat(etatTest(5));
      await ecrireFichierTest(path.join(s.dossier, NOM_FICHIER), revenu);
      const r = await a.post(`/api/sauvegardes/${SAUV}/restaurer`, { confirmer: true, depuisModeDegrade: true });
      assert.equal(r.status, 409);
      assert.equal(r.json.erreur.code, 'FICHIER_REVENU');
      assert.doesNotMatch(r.json.erreur.message, /rechargez/i, 'plus de conseil inutile');
      assert.equal(await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8'), revenu);
    },
    { preparer: preparerDossier({ sauvegardes: { [SAUV]: texteEtat(etatTest(2)) } }) },
  ));

test('POST /api/fichier-vide : confirmation obligatoire (422), Origin obligatoire (403), 201 sans sauvegarde restaurable, le fichier abîmé est conservé', () =>
  avecServeur(
    async (s, a) => {
      assert.equal((await a.post('/api/fichier-vide', {})).status, 422);
      assert.equal((await a.post('/api/fichier-vide', { confirmer: true, x: 1 })).status, 400);
      assert.equal((await s.requete({ methode: 'POST', chemin: '/api/fichier-vide', headers: { 'Content-Type': 'application/json' }, corps: '{"confirmer":true}' })).status, 403);
      assert.equal((await s.requete({ chemin: '/api/fichier-vide' })).status, 405);
      const abime = await fs.readFile(path.join(s.dossier, NOM_FICHIER));
      const r = await a.post('/api/fichier-vide', { confirmer: true });
      assert.equal(r.status, 201);
      assert.deepEqual(await fs.readFile(path.join(s.dossier, 'sauvegardes', r.json.donnees.sauvegardeAvant)), abime);
      assert.equal((await a.get('/api/etat')).json.modeDegrade, false);
      assert.equal((await a.get('/api/prestations')).json.lignes.length, 0);
      assert.equal((await a.post('/api/fichier-vide', { confirmer: true })).status, 409, 'plus en mode dégradé');
    },
    { preparer: preparerDossier({ actif: 'abîmé', sauvegardes: { 'sauvegarde-2026-09-01_10h00m00s_manuelle.json': '{ abîmée' } }) },
  ));

test('POST /api/fichier-vide : refusé (409 SAUVEGARDE_RESTAURABLE) quand une sauvegarde peut être restaurée', () =>
  avecServeur(
    async (s, a) => {
      const r = await a.post('/api/fichier-vide', { confirmer: true });
      assert.equal(r.status, 409);
      assert.equal(r.json.erreur.code, 'SAUVEGARDE_RESTAURABLE');
      assert.equal(await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8'), 'abîmé');
    },
    { preparer: preparerDossier({ actif: 'abîmé', sauvegardes: { [SAUV]: texteEtat(etatTest(2)) } }) },
  ));

test('GET /api/etat : conflit non résolu exposé au démarrage (copies de conflit plus récentes que le fichier actif), absent sinon', async () => {
  await avecServeur(
    async (s, a) => {
      const etat = (await a.get('/api/etat')).json;
      assert.equal(etat.conflit, null);
      assert.equal(etat.conflitNonResolu.type, 'non-resolu');
      assert.match(etat.conflitNonResolu.sauvegardes.application, /_conflit-memoire\.json$/);
      assert.match(etat.conflitNonResolu.sauvegardes.disque, /_conflit-disque\.json$/);
      assert.equal(etat.conflitNonResolu.application.nombrePrestations, 2);
      assert.equal(etat.conflitNonResolu.disque.nombrePrestations, 7);
      // Choisir une version (restaurer la copie de l'application) lève le rappel.
      await pause();
      const r = await a.post(`/api/sauvegardes/${etat.conflitNonResolu.sauvegardes.application}/restaurer`, { confirmer: true });
      assert.equal(r.status, 200);
      assert.equal((await a.get('/api/etat')).json.conflitNonResolu, null);
    },
    {
      preparer: async (dossier) => {
        await ecrireDans(dossier, NOM_FICHIER)(texteEtat(etatTest(7, { revision: 9 })));
        await pause();
        await ecrireDans(dossier, 'sauvegardes', 'sauvegarde-2026-10-02_09h14m03s_conflit-disque.json')(texteEtat(etatTest(7, { revision: 9 })));
        await ecrireDans(dossier, 'sauvegardes', 'sauvegarde-2026-10-02_09h14m03s_conflit-memoire.json')(texteEtat(etatTest(2, { revision: 5 })));
      },
    },
  );
  await avecServeur(async (s, a) => {
    assert.equal((await a.get('/api/etat')).json.conflitNonResolu, null);
  }, { preparer: preparerDossier({ actif: texteEtat(etatTest(2)) }) });
});

test('GET /api/catalogue : `utilisations` = nombre de prestations par type (fichier actif), pour avertir avant un renommage', () =>
  avecServeur(
    async (s, a) => {
      const r = (await a.get('/api/catalogue')).json;
      assert.deepEqual(r.utilisations, { 'seance-45': 3, 'bilan-initial': 1 });
      assert.ok(r.catalogue.length > 0);
    },
    {
      preparer: preparerDossier({
        actif: texteEtat(etatTest(0, { prestations: [ligneTest(1), ligneTest(2), ligneTest(3), ligneTest(4, { prestationId: 'bilan-initial', libelle: 'Bilan initial', categorie: 'bilan' })] })),
      }),
    },
  ));

test('premier démarrage sur un dossier réellement vide : fichier créé avec un catalogue VIDE, aucune prestation ni sauvegarde, pas de jeu d\'exemple', () =>
  avecServeur(async (s, a) => {
    assert.deepEqual(await fs.readdir(s.dossier), [NOM_FICHIER], 'seul le fichier de données est créé (pas de dossier de sauvegardes)');
    const etat = (await a.get('/api/etat')).json;
    assert.equal(etat.modeDegrade, false);
    assert.equal(etat.nombrePrestations, 0, "l'écran d'accueil vide se fonde sur ce nombre");
    assert.equal(etat.conflit, null);
    assert.equal(etat.conflitNonResolu, null);
    assert.deepEqual(etat.avertissements, []);
    const catalogue = (await a.get('/api/catalogue')).json;
    assert.deepEqual(catalogue.catalogue, [], 'catalogue vide : aucun tarif livré par défaut');
    assert.deepEqual(catalogue.utilisations, {});
    assert.deepEqual((await a.get('/api/sauvegardes')).json.sauvegardes, []);
    const liste = await a.get('/api/prestations');
    assert.equal(liste.status, 200);
    assert.deepEqual(liste.json.lignes, [], 'aucune prestation d\'exemple');
    const recap = await a.get('/api/recap');
    assert.equal(recap.status, 200);
    assert.deepEqual(recap.json.patients, []);
    // Les pages et le module d'accueil vide sont servis.
    assert.equal((await a.get('/js/accueil-vide.js')).status, 200);
    assert.equal((await a.get('/js/catalogue-etat.js')).status, 200);
    assert.equal((await a.get('/')).status, 200);
  }, { catalogueVide: true }));

// Restauration (y compris modes dégradés), export JSON et CSV, catalogue modifiable, paramètres, sécurité HTTP des nouvelles routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { ecrireFichierTest } from '../aides/temp.js';
import { horlogeReglable } from '../aides/horloge.js';
import { catalogueTest } from '../aides/catalogue-test.js';
import { etatTest, texteEtat } from '../aides/donnees.js';

const NOM_FICHIER = 'suivi-facturation.json';
const SAUV = 'sauvegarde-2026-09-20_10h00m00s_quotidienne.json';

function api(s) {
  const appeler = (methode, chemin, corps, enTetes = {}) =>
    s.requete({
      methode,
      chemin,
      headers: { Origin: `http://127.0.0.1:${s.port}`, ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}), ...enTetes },
      corps: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
  return {
    get: (chemin, enTetes) => s.requete({ chemin, headers: enTetes }),
    post: (chemin, corps, enTetes) => appeler('POST', chemin, corps, enTetes),
    patch: (chemin, corps) => appeler('PATCH', chemin, corps),
    del: (chemin) => appeler('DELETE', chemin),
  };
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
/** Prépare un dossier : fichier actif (texte) et sauvegardes {nom: texte}. */
const preparerDossier = ({ actif, sauvegardes = {}, archives = {} }) => async (dossier) => {
  if (actif !== undefined) await ecrireDans(dossier, NOM_FICHIER)(actif);
  for (const [nom, contenu] of Object.entries(sauvegardes)) await ecrireDans(dossier, 'sauvegardes', nom)(contenu);
  for (const [nom, contenu] of Object.entries(archives)) await ecrireDans(dossier, nom)(contenu);
};
const disque = async (s) => JSON.parse(await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8'));
const saisie = (extra = {}) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500, motif: 'Graphisme', ...extra });
const BOM = '﻿';

// ======================================================= Restauration

test('GET /api/sauvegardes : date, taille, nombre de prestations, lisible ; POST …/restaurer remplace le fichier, sauvegarde l\'état actuel avant', () =>
  avecServeur(
    async (s, a) => {
      const liste = (await a.get('/api/sauvegardes')).json.sauvegardes;
      const choisie = liste.find((x) => x.nom === SAUV);
      assert.equal(choisie.nombrePrestations, 5);
      assert.equal(choisie.restaurable, true);
      assert.equal(choisie.jour, '2026-09-20');
      assert.equal(choisie.heure, '10:00:00');
      assert.ok(choisie.tailleOctets > 0);

      const avant = await fs.readFile(path.join(s.dossier, NOM_FICHIER));
      const r = await a.post(`/api/sauvegardes/${SAUV}/restaurer`, { confirmer: true });
      assert.equal(r.status, 200);
      assert.equal(r.json.donnees.nombrePrestations, 5);
      assert.equal(r.json.donnees.annulable, true);
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.equal((await disque(s)).prestations.length, 5);
      assert.deepEqual(await fs.readFile(path.join(s.dossier, 'sauvegardes', r.json.donnees.sauvegardeAvant)), avant);
      assert.equal((await a.get('/api/prestations')).json.lignes.length, 5, "l'application sert l'état restauré");
      assert.equal((await a.get('/api/etat')).json.nombrePrestations, 5);
      assert.ok(!s.journal.some((l) => l.includes('Lapin')));
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(2)), sauvegardes: { [SAUV]: texteEtat(etatTest(5)) } }) },
  ));

test('restauration : confirmation obligatoire, champs inconnus refusés, nom inconnu 404', () =>
  avecServeur(
    async (s, a) => {
      const avant = await fs.readFile(path.join(s.dossier, NOM_FICHIER));
      for (const corps of [{}, { confirmer: false }, { confirmer: 'oui' }, { confirmer: 1 }]) {
        const r = await a.post(`/api/sauvegardes/${SAUV}/restaurer`, corps);
        assert.equal(r.status, 422, JSON.stringify(corps));
        assert.equal(r.json.erreur.code, 'VALIDATION');
      }
      assert.equal((await a.post(`/api/sauvegardes/${SAUV}/restaurer`, { confirmer: true, nom: 'x' })).status, 400);
      assert.equal((await a.post('/api/sauvegardes/sauvegarde-2026-01-01_00h00m00s_manuelle.json/restaurer', { confirmer: true })).status, 404);
      assert.deepEqual(await fs.readFile(path.join(s.dossier, NOM_FICHIER)), avant, 'rien n\'a été touché');
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(2)), sauvegardes: { [SAUV]: texteEtat(etatTest(5)) } }) },
  ));

test('restauration : le nom est contrôlé par le motif strict, jamais un chemin (traversée refusée en 404, fichier actif intact)', () =>
  avecServeur(
    async (s, a) => {
      const avant = await fs.readFile(path.join(s.dossier, NOM_FICHIER));
      for (const nom of ['..%2Fsuivi-facturation.json', '%2e%2e%2fsuivi-facturation.json', '..%5Csuivi-facturation.json', 'suivi-facturation.json', 'archive-2025.json', '%00', 'sauvegarde-x', '..']) {
        const r = await a.post(`/api/sauvegardes/${nom}/restaurer`, { confirmer: true });
        assert.ok([404, 400].includes(r.status), `${nom} -> ${r.status}`);
        assert.notEqual(r.status, 200, nom);
      }
      assert.deepEqual(await fs.readFile(path.join(s.dossier, NOM_FICHIER)), avant);
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(2)), sauvegardes: { [SAUV]: texteEtat(etatTest(5)) } }) },
  ));

test('restauration : sauvegarde corrompue, incompatible ou vide = 422 SAUVEGARDE_INCOMPATIBLE, état actuel intact, liste signale « illisible »', () => {
  const futur = etatTest(1);
  futur.schemaVersion = 99;
  const sauvegardes = {
    'sauvegarde-2026-09-01_10h00m00s_manuelle.json': '{ corrompue',
    'sauvegarde-2026-09-02_10h00m00s_manuelle.json': JSON.stringify(futur),
    'sauvegarde-2026-09-03_10h00m00s_manuelle.json': '',
  };
  return avecServeur(
    async (s, a) => {
      const avant = await fs.readFile(path.join(s.dossier, NOM_FICHIER));
      for (const nom of Object.keys(sauvegardes)) {
        const r = await a.post(`/api/sauvegardes/${nom}/restaurer`, { confirmer: true });
        assert.equal(r.status, 422, nom);
        assert.equal(r.json.erreur.code, 'SAUVEGARDE_INCOMPATIBLE');
        assert.match(r.json.erreur.message, /n'ont pas été touchées|n'a pas été touchée/);
        assert.equal(r.json.erreur.message.includes('Lapin'), false);
      }
      assert.deepEqual(await fs.readFile(path.join(s.dossier, NOM_FICHIER)), avant);
      const liste = (await a.get('/api/sauvegardes')).json.sauvegardes.filter((x) => x.nom in sauvegardes);
      assert.equal(liste.length, 3);
      assert.ok(liste.every((x) => x.restaurable === false && typeof x.raisonRefus === 'string'));
      assert.ok(!(await fs.readdir(path.join(s.dossier, 'sauvegardes'))).some((n) => n.includes('avant-restauration')), 'pas de sauvegarde de sécurité pour un refus');
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(2)), sauvegardes }) },
  );
});

test('sécurité de la restauration : Origin obligatoire, Sec-Fetch-Site cross-site refusé, Host étranger refusé, Content-Type JSON obligatoire, GET refusé (405)', () =>
  avecServeur(
    async (s, a) => {
      const avant = await fs.readFile(path.join(s.dossier, NOM_FICHIER));
      const chemin = `/api/sauvegardes/${SAUV}/restaurer`;
      const corps = JSON.stringify({ confirmer: true });
      const json = { 'Content-Type': 'application/json' };
      assert.equal((await s.requete({ methode: 'POST', chemin, headers: json, corps })).status, 403, 'sans Origin');
      assert.equal((await s.requete({ methode: 'POST', chemin, headers: { ...json, Origin: 'http://evil.example' }, corps })).status, 403, 'Origin étrangère');
      assert.equal((await s.requete({ methode: 'POST', chemin, headers: { ...json, Origin: `http://127.0.0.1:${s.port}`, 'Sec-Fetch-Site': 'cross-site' }, corps })).status, 403, 'cross-site');
      assert.equal((await s.requete({ methode: 'POST', chemin, headers: { ...json, Origin: `http://127.0.0.1:${s.port}` }, corps, hote: 'evil.example' })).status, 403, 'Host étranger (DNS rebinding)');
      const texte = await s.requete({ methode: 'POST', chemin, headers: { 'Content-Type': 'text/plain', Origin: `http://127.0.0.1:${s.port}` }, corps });
      assert.equal(texte.status, 415);
      assert.equal((await a.get(chemin)).status, 405);
      assert.deepEqual(await fs.readFile(path.join(s.dossier, NOM_FICHIER)), avant, 'aucune de ces requêtes n\'a touché au fichier');
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(2)), sauvegardes: { [SAUV]: texteEtat(etatTest(5)) } }) },
  ));

test('POST /api/sauvegardes : sauvegarde manuelle (201) visible dans la liste ; Origin obligatoire', () =>
  avecServeur(async (s, a) => {
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/sauvegardes' })).status, 403);
    const r = await a.post('/api/sauvegardes');
    assert.equal(r.status, 201);
    assert.match(r.json.donnees.nom, /_manuelle\.json$/);
    assert.ok((await a.get('/api/sauvegardes')).json.sauvegardes.some((x) => x.nom === r.json.donnees.nom && x.raison === 'manuelle'));
  }));

// ================================================== Modes dégradés

test('fichier illisible : l\'application reste joignable, les routes de données répondent 503, la restauration est possible et rend tout fonctionnel', () =>
  avecServeur(
    async (s, a) => {
      const abime = await fs.readFile(path.join(s.dossier, NOM_FICHIER));
      const etat = (await a.get('/api/etat')).json;
      assert.equal(etat.modeDegrade, true);
      assert.equal(etat.erreur.raison, 'illisible');
      assert.doesNotMatch(etat.erreur.message, /JSON|parse|syntax/i, 'message sans jargon');
      assert.match(etat.erreur.message, /sauvegarde à restaurer/);
      assert.equal((await a.get('/api/prestations')).status, 503);
      assert.equal((await a.post('/api/prestations', saisie())).status, 503);
      const liste = (await a.get('/api/sauvegardes')).json.sauvegardes;
      assert.equal(liste.length, 1);

      const r = await a.post(`/api/sauvegardes/${SAUV}/restaurer`, { confirmer: true });
      assert.equal(r.status, 200);
      assert.equal(r.json.donnees.annulable, false);
      assert.deepEqual(await fs.readFile(path.join(s.dossier, 'sauvegardes', r.json.donnees.sauvegardeAvant)), abime, 'le fichier abîmé est conservé tel quel');
      assert.equal((await a.get('/api/etat')).json.modeDegrade, false);
      assert.equal((await a.get('/api/prestations')).json.lignes.length, 3);
      assert.equal((await a.post('/api/prestations', saisie())).status, 201);
    },
    { preparer: preparerDossier({ actif: '{"format":"suivi-facturation","schemaVersion":1,"prestations":[{"nom":"Lapin', sauvegardes: { [SAUV]: texteEtat(etatTest(3)) } }) },
  ));

test('fichier absent alors que des sauvegardes existent : mode dégradé « absent », rien n\'est créé, restauration possible', () =>
  avecServeur(
    async (s, a) => {
      await assert.rejects(fs.stat(path.join(s.dossier, NOM_FICHIER)), { code: 'ENOENT' });
      const etat = (await a.get('/api/etat')).json;
      assert.equal(etat.modeDegrade, true);
      assert.equal(etat.erreur.raison, 'absent');
      assert.equal((await a.get('/api/catalogue')).status, 503);
      const r = await a.post(`/api/sauvegardes/${SAUV}/restaurer`, { confirmer: true });
      assert.equal(r.status, 200);
      assert.equal(r.json.donnees.sauvegardeAvant, null);
      assert.equal((await disque(s)).prestations.length, 4);
      assert.equal((await a.get('/api/etat')).json.modeDegrade, false);
    },
    { preparer: preparerDossier({ sauvegardes: { [SAUV]: texteEtat(etatTest(4)) } }) },
  ));

test('conflit de synchronisation : écritures refusées avec un message sans « relancez », les deux versions sont proposées, restaurer l\'une lève le conflit', () =>
  avecServeur(
    async (s, a) => {
      assert.equal((await a.post('/api/prestations', saisie())).status, 201);
      await ecrireFichierTest(path.join(s.dossier, NOM_FICHIER), texteEtat(etatTest(9, { revision: 40 }))); // remplacé par le client de synchro
      const etat = (await a.get('/api/etat')).json;
      assert.equal(etat.conflit.type, 'modifie');
      assert.equal(etat.conflit.disque.nombrePrestations, 9);
      assert.equal(etat.conflit.application.nombrePrestations, 1);
      const { disque: nomDisque, application: nomApp } = etat.conflit.sauvegardes;
      assert.match(nomDisque, /conflit-disque/);
      assert.match(nomApp, /conflit-memoire/);

      const refus = await a.post('/api/prestations', saisie({ date: '2026-10-03' }));
      assert.equal(refus.status, 409);
      assert.equal(refus.json.erreur.code, 'CONFLIT_FICHIER');
      assert.doesNotMatch(refus.json.erreur.message, /relancez|fermez/i);
      assert.match(refus.json.erreur.message, /choisissez la version à garder/i);

      const liste = (await a.get('/api/sauvegardes')).json.sauvegardes;
      assert.equal(liste.find((x) => x.nom === nomDisque).nombrePrestations, 9);
      assert.equal(liste.find((x) => x.nom === nomApp).nombrePrestations, 1);

      const r = await a.post(`/api/sauvegardes/${nomApp}/restaurer`, { confirmer: true });
      assert.equal(r.status, 200);
      const apres = (await a.get('/api/etat')).json;
      assert.equal(apres.conflit, null);
      assert.equal((await disque(s)).prestations.length, 1);
      assert.equal((await a.post('/api/prestations', saisie({ date: '2026-10-03' }))).status, 201, 'les saisies reprennent');
      const sauvegardes = (await a.get('/api/sauvegardes')).json.sauvegardes;
      assert.ok(sauvegardes.some((x) => x.nom === nomDisque), 'la version du disque reste sauvegardée');
    },
  ));

test('fichier du disque en conflit lui-même illisible : sa copie est signalée « illisible » et refusée, celle de l\'application reste restaurable', () =>
  avecServeur(async (s, a) => {
    assert.equal((await a.post('/api/prestations', saisie())).status, 201);
    await ecrireFichierTest(path.join(s.dossier, NOM_FICHIER), 'contenu abîmé par la synchro');
    const etat = (await a.get('/api/etat')).json;
    assert.equal(etat.conflit.disque.lisible, false);
    const liste = (await a.get('/api/sauvegardes')).json.sauvegardes;
    assert.equal(liste.find((x) => x.nom === etat.conflit.sauvegardes.disque).restaurable, false);
    assert.equal((await a.post(`/api/sauvegardes/${etat.conflit.sauvegardes.disque}/restaurer`, { confirmer: true })).status, 422);
    assert.equal((await a.post(`/api/sauvegardes/${etat.conflit.sauvegardes.application}/restaurer`, { confirmer: true })).status, 200);
    assert.equal((await disque(s)).prestations.length, 1);
  }));

// ============================================================== Export

test('export JSON : en-têtes de téléchargement, nom daté, contenu = fichier actif + archives lisibles, aucune donnée dans l\'URL', () => {
  const ligneArchivee = {
    id: 'ancienne', patient: { id: 'p-ancien', nom: 'Lapin', prenom: 'Pierre' }, date: '2025-03-14', prestationId: 'seance-45', libelle: 'Séance individuelle 45 min', categorie: 'seance',
    motif: '', montantCentimes: 5800, statut: 'facture', factureLe: '2025-03-31', versements: [], creeLe: '2025-03-14T16:02:11.000Z', modifieLe: '2025-03-31T08:30:00.000Z',
  };
  const archive = JSON.stringify({ format: 'suivi-facturation-archive', schemaVersion: 1, annee: 2025, majLe: '2026-01-01T00:00:00.000Z', prestations: [ligneArchivee] });
  return avecServeur(
    async (s, a) => {
      await a.post('/api/prestations', saisie());
      const r = await a.get('/api/export?format=json');
      assert.equal(r.status, 200);
      assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
      assert.equal(r.headers['content-disposition'], 'attachment; filename="suivi-facturation-export-2026-10-02.json"');
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.match(r.headers['content-security-policy'], /default-src 'none'/);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.texte));
      assert.equal(r.json.format, 'suivi-facturation-export');
      assert.equal(r.json.actif.prestations.length, 1);
      assert.equal(r.json.actif.catalogue.length, catalogueTest().length);
      assert.deepEqual(Object.keys(r.json.archives), ['2025']);
      assert.equal(r.json.archivesIllisibles, undefined);
      assert.deepEqual((await a.get('/api/export')).json.actif, r.json.actif, 'json par défaut');
      assert.ok(s.journal.every((l) => !/Lapin|Pierre/.test(l)));
      assert.ok(s.journal.some((l) => l.startsWith('GET /api/export ')), 'journal sans paramètres de requête');
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(0)), archives: { 'archive-2025.json': archive } }) },
  );
});

test('export JSON : une archive illisible est signalée (jamais ignorée en silence)', () =>
  avecServeur(
    async (s, a) => {
      const r = await a.get('/api/export?format=json');
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.archivesIllisibles, ['2024']);
      assert.deepEqual(r.json.archives, {});
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(0)), archives: { 'archive-2024.json': '{ abîmée' } }) },
  ));

test('export CSV prestations : BOM, ; , CRLF, montants français, accents, dates JJ/MM/AAAA, nom de fichier daté', () =>
  avecServeur(async (s, a) => {
    await a.post('/api/prestations', saisie({ patient: { nom: 'Hérisson', prenom: 'Zoé' }, montantCentimes: 125050, date: '2026-09-04', motif: 'Écriture; "cursive"' }));
    const r = await a.get('/api/export?format=csv&contenu=prestations');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(r.headers['content-disposition'], 'attachment; filename="suivi-facturation-prestations-2026-10-02.csv"');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.ok(r.texte.startsWith(BOM));
    const lignes = r.texte.slice(1).split('\r\n');
    assert.equal(lignes[0], 'id;date;nom;prenom;prestation;categorie;motif;montant;statut;facture_le;verse;reste;trop_percu;etat;nb_versements');
    assert.equal(lignes.length, 3);
    assert.equal(lignes[2], '');
    assert.match(lignes[1], /^[0-9a-f-]{36};04\/09\/2026;Hérisson;Zoé;Séance individuelle 45 min;Séance;"Écriture; ""cursive""";1250,50;À facturer;;0,00;1250,50;0,00;Non payé;0$/);
    assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.texte, 'utf8'));
  }));

test("export CSV : un nom saisi comme une formule est neutralisé dans le fichier téléchargé", () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie({ patient: { nom: '=HYPERLINK("http://x")', prenom: '@evil' }, motif: '+1-1' }))).json.donnees;
    await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 1000, date: '2026-10-02', mode: 'cheque' });
    const p = (await a.get('/api/export?format=csv&contenu=prestations')).texte;
    assert.ok(p.includes(`;"'=HYPERLINK(""http://x"")";'@evil;`), p);
    assert.ok(p.includes(";'+1-1;"));
    assert.equal(p.split('\r\n').some((ligne) => /;[=+@-]/.test(ligne.replace(/"[^"]*"/g, '""'))), false, 'aucune cellule ne commence par =, +, - ou @');
    const v = (await a.get('/api/export?format=csv&contenu=versements')).texte;
    assert.ok(v.startsWith(`${BOM}prestation_id;date_prestation;nom;prenom;date_versement;mode;montant\r\n`));
    assert.ok(v.includes(`;"'=HYPERLINK(""http://x"")";'@evil;02/10/2026;Chèque;10,00\r\n`), v);
  }));

test('export CSV : les prestations des archives lisibles sont incluses, sans doublon avec le fichier actif', () => {
  const ligneArchive = { ...etatTest(1).prestations[0], id: 'archivee', date: '2024-05-06' };
  const doublon = { ...etatTest(1).prestations[0], id: 'ligne-0', date: '2024-05-07' };
  const archive = JSON.stringify({ format: 'suivi-facturation-archive', schemaVersion: 1, annee: 2024, majLe: '2025-01-01T00:00:00.000Z', prestations: [ligneArchive, doublon] });
  return avecServeur(
    async (s, a) => {
      const l = (await a.get('/api/export?format=csv&contenu=prestations')).texte.slice(1).split('\r\n').filter(Boolean);
      assert.equal(l.length, 3, 'en-tête + 1 ligne active + 1 ligne archivée (le doublon d\'id est écarté)');
      assert.ok(l.some((x) => x.startsWith('archivee;06/05/2024')));
      assert.ok(!l.some((x) => x.includes('07/05/2024')));
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(1)), archives: { 'archive-2024.json': archive } }) },
  );
});

test('export : paramètres invalides ou inconnus = 400, méthode autre que GET = 405, fichier illisible = 503', async () => {
  await avecServeur(async (s, a) => {
    for (const q of ['format=xml', 'format=csv&contenu=tout', 'format=json&contenu=prestations', 'format=csv&patient=Lapin', 'nom=Lapin', 'format=csv&contenu=prestations&contenu=versements&x=1']) {
      assert.equal((await a.get(`/api/export?${q}`)).status, 400, q);
    }
    assert.equal((await a.post('/api/export?format=json', {})).status, 405);
    assert.equal((await a.del('/api/export')).status, 405);
  });
  await avecServeur(
    async (s, a) => {
      assert.equal((await a.get('/api/export?format=json')).status, 503);
      assert.equal((await a.get('/api/export?format=csv')).status, 503);
    },
    { preparer: preparerDossier({ actif: 'abîmé', sauvegardes: { [SAUV]: texteEtat(etatTest(1)) } }) },
  );
});

test('export : Host étranger et Sec-Fetch-Site cross-site refusés (pas d\'export depuis un autre site) ; HEAD sans corps', () =>
  avecServeur(async (s, a) => {
    await a.post('/api/prestations', saisie());
    assert.equal((await s.requete({ chemin: '/api/export?format=json', hote: 'evil.example' })).status, 403);
    assert.equal((await a.get('/api/export?format=json', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await a.get('/api/export?format=json', { 'Sec-Fetch-Site': 'same-site' })).status, 403);
    assert.equal((await a.get('/api/export?format=json', { 'Sec-Fetch-Site': 'same-origin' })).status, 200);
    assert.equal((await a.get('/api/export?format=json', { 'Sec-Fetch-Site': 'none' })).status, 200);
    const head = await s.requete({ methode: 'HEAD', chemin: '/api/export?format=csv' });
    assert.equal(head.status, 200);
    assert.equal(head.texte, '');
    assert.match(head.headers['content-disposition'], /attachment/);
  }));

test('export CSV en lecture seule (schéma plus récent) : 503 explicite ; l\'export JSON reste possible', () => {
  const futur = etatTest(1);
  futur.schemaVersion = 99;
  return avecServeur(
    async (s, a) => {
      const csv = await a.get('/api/export?format=csv');
      assert.equal(csv.status, 503);
      assert.equal(csv.json.erreur.code, 'SCHEMA_PLUS_RECENT');
      assert.equal((await a.get('/api/export?format=json')).status, 200);
    },
    { preparer: preparerDossier({ actif: texteEtat(futur) }) },
  );
});

// ============================================================ Catalogue

test('POST /api/catalogue : ajout 201 (active, en dernier, centimes), persisté ; validations 422 ; champ inconnu 400', () =>
  avecServeur(async (s, a) => {
    const r = await a.post('/api/catalogue', { libelle: 'Atelier parents', tarifCentimes: 7550, categorie: 'autre' });
    assert.equal(r.status, 201);
    assert.equal(r.json.donnees.actif, true);
    assert.equal(r.json.donnees.ordre, catalogueTest().length + 1);
    assert.equal(r.json.donnees.tarifCentimes, 7550);
    assert.equal((await disque(s)).catalogue.length, catalogueTest().length + 1);
    assert.equal((await a.get('/api/catalogue')).json.catalogue.length, catalogueTest().length + 1);
    for (const corps of [{}, { libelle: '', tarifCentimes: 100, categorie: 'autre' }, { libelle: 'x', tarifCentimes: -1, categorie: 'autre' }, { libelle: 'x', tarifCentimes: 12.5, categorie: 'autre' }, { libelle: 'x', tarifCentimes: 100, categorie: 'zzz' }]) {
      const e = await a.post('/api/catalogue', corps);
      assert.equal(e.status, 422, JSON.stringify(corps));
      assert.ok(Object.keys(e.json.erreur.champs).length >= 1);
    }
    assert.equal((await a.post('/api/catalogue', { libelle: 'x', tarifCentimes: 100, categorie: 'autre', id: 'forcé' })).status, 400);
    assert.equal((await disque(s)).catalogue.length, catalogueTest().length + 1, 'aucun ajout invalide n\'a été enregistré');
  }));

test('PATCH /api/catalogue/{id} : libellé figé dans les prestations déjà saisies, nouvelles saisies au nouveau tarif et libellé', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie({ montantCentimes: 4000 }))).json.donnees; // montant ajusté à la main
    assert.equal(l.libelle, 'Séance individuelle 45 min');
    const r = await a.patch('/api/catalogue/seance-45', { libelle: 'Séance 45 min (nouveau nom)', tarifCentimes: 5000, categorie: 'bilan' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.donnees, { id: 'seance-45', libelle: 'Séance 45 min (nouveau nom)', tarifCentimes: 5000, categorie: 'bilan', actif: true, ordre: catalogueTest().find((c) => c.id === 'seance-45').ordre });
    const surDisque = await disque(s);
    assert.equal(surDisque.catalogue.find((c) => c.id === 'seance-45').tarifCentimes, 5000);
    assert.equal(surDisque.prestations[0].libelle, 'Séance individuelle 45 min', 'la ligne existante garde son libellé');
    assert.equal(surDisque.prestations[0].categorie, 'seance');
    assert.equal(surDisque.prestations[0].montantCentimes, 4000, 'le montant saisi est conservé (pas de modification rétroactive)');
    const relue = (await a.get(`/api/prestations/${l.id}`)).json.donnees;
    assert.equal(relue.libelle, 'Séance individuelle 45 min');
    const neuve = (await a.post('/api/prestations', saisie({ date: '2026-10-03', montantCentimes: 5000 }))).json.donnees;
    assert.equal(neuve.libelle, 'Séance 45 min (nouveau nom)');
    assert.equal(neuve.categorie, 'bilan');
    assert.equal((await disque(s)).prestations[0].libelle, 'Séance individuelle 45 min');
  }));

test('désactivation : retirée de la saisie (422) mais conservée dans le catalogue et dans l\'historique ; réactivable', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    assert.equal((await a.patch('/api/catalogue/seance-45', { actif: false })).status, 200);
    const catalogue = (await a.get('/api/catalogue')).json.catalogue;
    assert.equal(catalogue.find((c) => c.id === 'seance-45').actif, false);
    assert.equal(catalogue.length, catalogueTest().length, 'toujours dans le catalogue (actifs et inactifs)');
    const refus = await a.post('/api/prestations', saisie({ date: '2026-10-03' }));
    assert.equal(refus.status, 422);
    assert.ok(refus.json.erreur.champs.prestationId);
    assert.equal((await a.get(`/api/prestations/${l.id}`)).json.donnees.libelle, 'Séance individuelle 45 min');
    assert.equal((await a.patch('/api/catalogue/seance-45', { actif: true })).status, 200);
    assert.equal((await a.post('/api/prestations', saisie({ date: '2026-10-03' }))).status, 201);
  }));

test('PATCH /api/catalogue : id inconnu 404, valeurs invalides 422 / 400, rien n\'est modifié', () =>
  avecServeur(async (s, a) => {
    const avant = JSON.stringify((await disque(s)).catalogue);
    assert.equal((await a.patch('/api/catalogue/nexiste-pas', { actif: false })).status, 404);
    assert.equal((await a.patch('/api/catalogue/reunion-synthese', { tarifCentimes: -1 })).status, 422);
    assert.equal((await a.patch('/api/catalogue/reunion-synthese', { tarifCentimes: 10.5 })).status, 422);
    assert.equal((await a.patch('/api/catalogue/reunion-synthese', { libelle: '' })).status, 422);
    assert.equal((await a.patch('/api/catalogue/reunion-synthese', { actif: 'oui' })).status, 400);
    assert.equal((await a.patch('/api/catalogue/reunion-synthese', { id: 'x' })).status, 400);
    assert.equal(JSON.stringify((await disque(s)).catalogue), avant);
  }));

test('DELETE /api/catalogue/{id} : jamais si référencé (ligne active ou archive), 409 CATALOGUE_UTILISE ; sinon supprimé après sauvegarde', () => {
  const archive = JSON.stringify({ format: 'suivi-facturation-archive', schemaVersion: 1, annee: 2024, majLe: '2025-01-01T00:00:00.000Z', prestations: [{ ...etatTest(1).prestations[0], id: 'a1', prestationId: 'seance-domicile-45', date: '2024-02-02' }] });
  return avecServeur(
    async (s, a) => {
      await a.post('/api/prestations', saisie({ prestationId: 'reunion-synthese', montantCentimes: 6000 }));
      const avant = await disque(s);
      for (const id of ['reunion-synthese', 'seance-domicile-45']) {
        const r = await a.del(`/api/catalogue/${id}`);
        assert.equal(r.status, 409, id);
        assert.equal(r.json.erreur.code, 'CATALOGUE_UTILISE');
        assert.match(r.json.erreur.message, /désactiv/);
      }
      assert.deepEqual((await disque(s)).catalogue, avant.catalogue);
      assert.equal((await a.del('/api/catalogue/nexiste-pas')).status, 404);

      const ok = await a.del('/api/catalogue/compte-rendu');
      assert.equal(ok.status, 200);
      assert.equal((await disque(s)).catalogue.some((c) => c.id === 'compte-rendu'), false);
      const sauv = (await a.get('/api/sauvegardes')).json.sauvegardes.find((x) => x.raison === 'avant-suppression');
      assert.ok(sauv, 'sauvegarde préalable à la suppression');
      assert.equal(JSON.parse(await fs.readFile(path.join(s.dossier, 'sauvegardes', sauv.nom), 'utf8')).catalogue.some((c) => c.id === 'compte-rendu'), true, 'la sauvegarde contient encore l\'entrée');
      assert.equal((await s.requete({ methode: 'DELETE', chemin: '/api/catalogue/bilan-initial' })).status, 403, 'Origin obligatoire');
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(0)), archives: { 'archive-2024.json': archive } }) },
  );
});

test('DELETE /api/catalogue : une archive illisible empêche de garantir que le type est inutilisé : suppression refusée', () =>
  avecServeur(
    async (s, a) => {
      const r = await a.del('/api/catalogue/compte-rendu');
      assert.equal(r.status, 409);
      assert.equal((await disque(s)).catalogue.length, catalogueTest().length);
    },
    { preparer: preparerDossier({ actif: texteEtat(etatTest(0)), archives: { 'archive-2023.json': 'abîmée' } }) },
  ));

test('catalogue : routes d\'écriture protégées (Origin, Content-Type, Host)', () =>
  avecServeur(async (s, a) => {
    const corps = JSON.stringify({ libelle: 'x', tarifCentimes: 100, categorie: 'autre' });
    const json = { 'Content-Type': 'application/json' };
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/catalogue', headers: json, corps })).status, 403);
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/catalogue', headers: { ...json, Origin: 'http://evil.example' }, corps })).status, 403);
    assert.equal((await s.requete({ methode: 'PATCH', chemin: '/api/catalogue/reunion-synthese', headers: { ...json, Origin: `http://127.0.0.1:${s.port}` }, corps: '{"actif":false}', hote: 'evil.example' })).status, 403);
    assert.equal((await s.requete({ methode: 'POST', chemin: '/api/catalogue', headers: { 'Content-Type': 'text/plain', Origin: `http://127.0.0.1:${s.port}` }, corps })).status, 415);
    assert.equal((await disque(s)).catalogue.length, catalogueTest().length);
  }));

// ============================================================ Paramètres

test('PATCH /api/parametres : nombre de sauvegardes conservées enregistré, exposé par /api/etat ; valeurs invalides refusées', () =>
  avecServeur(async (s, a) => {
    assert.equal((await a.get('/api/etat')).json.sauvegardesConservees, 30);
    const r = await a.patch('/api/parametres', { sauvegardesConservees: 12 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.donnees, { sauvegardesConservees: 12 });
    assert.equal((await disque(s)).parametres.sauvegardesConservees, 12);
    assert.equal((await a.get('/api/etat')).json.sauvegardesConservees, 12);
    for (const v of [0, 1, 6, -1, 366, 3.5, '10', null]) assert.equal((await a.patch('/api/parametres', { sauvegardesConservees: v })).status, 422, String(v));
    assert.equal((await a.patch('/api/parametres', { dernierModePaiement: 'cheque' })).status, 400, 'seul ce paramètre est modifiable');
    assert.equal((await a.patch('/api/parametres', {})).status, 400);
    assert.equal((await disque(s)).parametres.sauvegardesConservees, 12);
    assert.equal((await s.requete({ methode: 'PATCH', chemin: '/api/parametres', headers: { 'Content-Type': 'application/json' }, corps: '{"sauvegardesConservees":2}' })).status, 403, 'Origin obligatoire');
  }));

test('rotation : avec 7 jours conservés (minimum), les jours plus anciens disparaissent à la sauvegarde suivante, toutes celles du jour sont gardées, les archives et les sauvegardes d\'opération sont intactes', () => {
  const horloge = horlogeReglable('2026-10-02', '09:00:00');
  return avecServeur(
    async (s, a) => {
      await a.patch('/api/parametres', { sauvegardesConservees: 7 });
      for (let jour = 2; jour <= 10; jour++) { // une sauvegarde manuelle par jour pendant 9 jours
        horloge.regler(`2026-10-${String(jour).padStart(2, '0')}`, '09:10:00');
        assert.equal((await a.post('/api/sauvegardes')).status, 201);
      }
      for (const h of ['10:00:00', '11:00:00', '12:00:00']) { // trois autres le dernier jour : toutes conservées
        horloge.regler('2026-10-10', h);
        assert.equal((await a.post('/api/sauvegardes')).status, 201);
      }
      const liste = (await a.get('/api/sauvegardes')).json.sauvegardes;
      const quotidiennes = liste.filter((x) => x.reserve === 'quotidienne');
      assert.deepEqual([...new Set(quotidiennes.map((x) => x.jour))], ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
      assert.deepEqual(quotidiennes.filter((x) => x.jour === '2026-10-10').map((x) => x.heure), ['09:10:00', '10:00:00', '11:00:00', '12:00:00']);
      for (const jour of ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']) assert.equal(quotidiennes.filter((x) => x.jour === jour).length, 1, jour);
      assert.ok(liste.some((x) => x.raison === 'avant-suppression'), "la réserve « opération » n'est pas touchée");
      assert.ok((await fs.stat(path.join(s.dossier, 'archive-2024.json'))).isFile());
    },
    {
      horloge,
      preparer: preparerDossier({
        actif: texteEtat(etatTest(0)),
        sauvegardes: { 'sauvegarde-2026-09-01_08h00m00s_avant-suppression.json': texteEtat(etatTest(1)), 'sauvegarde-2026-09-01_08h00m00s_demarrage.json': texteEtat(etatTest(1)) },
        archives: { 'archive-2024.json': JSON.stringify({ format: 'suivi-facturation-archive', schemaVersion: 1, annee: 2024, majLe: '2025-01-01T00:00:00.000Z', prestations: [] }) },
      }),
    },
  );
});

// ====================================================== Pages statiques

test('parametres.html et les scripts de thème sont servis avec la CSP stricte ; aucune donnée dans les URL', () =>
  avecServeur(async (s) => {
    const page = await s.requete({ chemin: '/parametres.html' });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(page.texte, /<h1>Paramètres<\/h1>/);
    for (const chemin of ['/js/theme-init.js', '/js/theme.js', '/js/pages/parametres.js', '/js/pages/parametres-tarifs.js', '/js/restauration.js', '/js/conflit.js', '/js/ecran-degrade.js']) {
      const r = await s.requete({ chemin });
      assert.equal(r.status, 200, chemin);
      assert.match(r.headers['content-type'], /text\/javascript/);
    }
  }));

// API du registre des patients (lot P2). Noms fictifs uniquement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { fsSauvegardesBloquees } from '../aides/fs-defaillant.js';
import { etatInitialTest } from '../aides/catalogue-test.js';
import { ecrireFichierTest } from '../aides/temp.js';

const NOM_FICHIER = 'suivi-facturation.json';
const ID_ARCHIVE = '3b9d0000-0000-4000-8000-0000000000b1';
const ID_AUTRE = '3b9d0000-0000-4000-8000-0000000000b2';

function api(s) {
  const appeler = (methode, chemin, corps) =>
    s.requete({
      methode,
      chemin,
      headers: { Origin: `http://127.0.0.1:${s.port}`, ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      corps: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
  return {
    get: (chemin) => s.requete({ chemin }),
    post: (chemin, corps) => appeler('POST', chemin, corps),
    patch: (chemin, corps) => appeler('PATCH', chemin, corps),
    del: (chemin) => appeler('DELETE', chemin),
  };
}
const saisie = (extra = {}) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500, motif: 'Graphisme', ...extra });
const disque = async (s) => JSON.parse(await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8'));
const liste = async (a) => (await a.get('/api/patients')).json.patients;
const sauvegardesDe = async (s, raison) => (await fs.readdir(path.join(s.dossier, 'sauvegardes')).catch(() => [])).filter((n) => n.includes(`_${raison}`));

async function avecServeur(fn, options) {
  const s = await demarrerServeurTest(options);
  try {
    await fn(s, api(s));
  } finally {
    await s.arreter();
  }
}
const creer = async (a, nom, prenom, extra = {}) => (await a.post('/api/patients', { nom, prenom, ...extra })).json.donnees;

test('GET /api/patients : registre vide, champs de chaque entrée, paramètre de requête refusé', () =>
  avecServeur(async (s, a) => {
    const r = await a.get('/api/patients');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.patients, []);
    assert.equal((await a.get('/api/patients?nom=Lapin')).status, 400, 'aucun nom dans l\'URL');
    await creer(a, 'Lapin', 'Pierre');
    const [p] = await liste(a);
    assert.deepEqual(Object.keys(p).sort(), ['actif', 'dernierePrestation', 'homonyme', 'id', 'nom', 'nombrePrestations', 'prenom', 'supprimable']);
    assert.deepEqual({ actif: p.actif, n: p.nombrePrestations, d: p.dernierePrestation, h: p.homonyme, sup: p.supprimable }, { actif: true, n: 0, d: null, h: false, sup: true });
  }));

test('POST /api/patients : 201, patient actif sans prestation, jeton d\'annulation, disque avec ses seuls champs', () =>
  avecServeur(async (s, a) => {
    const r = await a.post('/api/patients', { nom: '  Lapin ', prenom: 'Pierre' });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.json.donnees).sort(), ['actif', 'id', 'nom', 'prenom']);
    assert.equal(r.json.donnees.nom, 'Lapin', 'texte normalisé');
    assert.equal(r.json.donnees.actif, true);
    assert.deepEqual(r.json.avertissements, []);
    assert.ok(r.json.annulation);
    assert.equal(r.headers['cache-control'], 'no-store');
    const d = await disque(s);
    assert.deepEqual(d.patients, [r.json.donnees]);
    assert.equal(d.prestations.length, 0);
  }));

test('POST /api/patients : 422 VALIDATION avec champs (vide, trop long, invisible, bidirectionnel), 400 champ inconnu / homonyme non booléen / JSON invalide, 415 sans type', () =>
  avecServeur(async (s, a) => {
    const vide = await a.post('/api/patients', { nom: '', prenom: '  ' });
    assert.equal(vide.status, 422);
    assert.equal(vide.json.erreur.code, 'VALIDATION');
    assert.deepEqual(Object.keys(vide.json.erreur.champs).sort(), ['nom', 'prenom']);
    assert.deepEqual(Object.keys((await a.post('/api/patients', { prenom: 'Pierre' })).json.erreur.champs), ['nom']);
    for (const mauvais of ['x'.repeat(101), 'La\u0000pin', 'La​pin', 'La‮pin', 'La⁦pin', 'La\npin']) {
      const r = await a.post('/api/patients', { nom: mauvais, prenom: 'Pierre' });
      assert.equal(r.status, 422, JSON.stringify(mauvais));
      assert.ok(r.json.erreur.champs.nom);
      const p = await a.post('/api/patients', { nom: 'Lapin', prenom: mauvais });
      assert.equal(p.status, 422, JSON.stringify(mauvais));
      assert.ok(p.json.erreur.champs.prenom);
    }
    assert.equal((await a.post('/api/patients', { nom: 'Lapin', prenom: 'Pierre', actif: false })).status, 400);
    assert.equal((await a.post('/api/patients', { nom: 'Lapin', prenom: 'Pierre', homonyme: 'oui' })).status, 400);
    const sansType = await s.requete({ methode: 'POST', chemin: '/api/patients', headers: { Origin: `http://127.0.0.1:${s.port}` }, corps: '{}' });
    assert.equal(sansType.status, 415);
    const invalide = await s.requete({ methode: 'POST', chemin: '/api/patients', headers: { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json' }, corps: '{ pas du json' });
    assert.equal(invalide.status, 400);
    assert.equal((await disque(s)).patients.length, 0);
  }));

test('POST /api/patients : même clé = 409 PATIENT_EXISTANT (candidats sans nom) ; homonyme: true crée un second patient, tous deux « homonyme » ; archivé compte', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Lapin', 'Pierre');
    const refus = await a.post('/api/patients', { nom: 'LAPIN  ', prenom: ' pierre' });
    assert.equal(refus.status, 409);
    assert.equal(refus.json.erreur.code, 'PATIENT_EXISTANT');
    assert.deepEqual(refus.json.erreur.details.candidats, [{ id: p.id, dernierePrestation: null }]);
    assert.ok(!refus.texte.includes('Lapin') && !refus.texte.includes('Pierre'), 'aucun nom dans l\'erreur');
    assert.equal((await liste(a)).length, 1);
    const ok = await a.post('/api/patients', { nom: 'LAPIN', prenom: 'pierre', homonyme: true });
    assert.equal(ok.status, 201);
    assert.notEqual(ok.json.donnees.id, p.id);
    const l = await liste(a);
    assert.equal(l.length, 2);
    assert.ok(l.every((x) => x.homonyme));
    await a.patch(`/api/patients/${p.id}`, { actif: false });
    assert.equal((await a.post('/api/patients', { nom: 'Lapin', prenom: 'Pierre', homonyme: false })).status, 409);
    // la clé est sensible aux accents : ce n'est pas un homonyme
    assert.equal((await a.post('/api/patients', { nom: 'Cygne', prenom: 'Léa' })).status, 201);
    assert.equal((await a.post('/api/patients', { nom: 'Cygne', prenom: 'Lea' })).status, 201);
  }));

test('POST /api/patients : double clic (deux requêtes simultanées) = un seul patient, la seconde reçoit PATIENT_EXISTANT', () =>
  avecServeur(async (s, a) => {
    const r = await Promise.all([a.post('/api/patients', { nom: 'Lapin', prenom: 'Pierre' }), a.post('/api/patients', { nom: 'Lapin', prenom: 'Pierre' })]);
    assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
    assert.equal(r.find((x) => x.status === 409).json.erreur.code, 'PATIENT_EXISTANT');
    assert.equal((await disque(s)).patients.length, 1);
  }));

test('PATCH /api/patients/{id} : renommage propagé à toutes les lignes, identifiant stable, lignesModifiees, récapitulatif à jour', () =>
  avecServeur(async (s, a) => {
    const l1 = (await a.post('/api/prestations', saisie({ patient: { nom: 'Lapen', prenom: 'Pierre' } }))).json.donnees;
    await a.post('/api/prestations', saisie({ patient: { nom: 'Lapen', prenom: 'Pierre' }, date: '2026-10-03' }));
    const autre = (await a.post('/api/prestations', saisie({ patient: { nom: 'Ours', prenom: 'Baloo' } }))).json.donnees;
    const id = l1.patient.id;
    const r = await a.patch(`/api/patients/${id}`, { nom: 'Lapin' });
    assert.equal(r.status, 200);
    assert.equal(r.json.donnees.lignesModifiees, 2);
    assert.deepEqual(r.json.donnees.patient, { id, nom: 'Lapin', prenom: 'Pierre', actif: true });
    assert.ok(r.json.annulation);
    const d = await disque(s);
    assert.deepEqual(d.patients.find((p) => p.id === id), { id, nom: 'Lapin', prenom: 'Pierre', actif: true });
    for (const l of d.prestations.filter((x) => x.patient.id === id)) assert.deepEqual(l.patient, { id, nom: 'Lapin', prenom: 'Pierre' });
    assert.deepEqual(d.prestations.find((x) => x.id === autre.id).patient, autre.patient, 'les autres patients ne bougent pas');
    const recap = (await a.get('/api/recap?mois=2026-10')).json;
    assert.ok(JSON.stringify(recap.patients).includes('Lapin'));
    assert.ok(!JSON.stringify(recap.patients).includes('Lapen'));
    assert.equal((await a.patch(`/api/patients/${id}`, { nom: 'Lapin' })).json.donnees.lignesModifiees, 0, 'même écriture : rien à propager');
  }));

test('PATCH /api/patients/{id} : casse ou espaces sans confirmation ; vers le nom d\'un autre = 409 PATIENT_EXISTANT puis homonyme: true (PATIENT_HOMONYME)', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Lapin', 'Pierre');
    const o = await creer(a, 'Ours', 'Baloo');
    const casse = await a.patch(`/api/patients/${p.id}`, { nom: 'LAPIN', prenom: '  Pierre ' });
    assert.equal(casse.status, 200);
    assert.equal(casse.json.donnees.patient.nom, 'LAPIN');
    assert.deepEqual(casse.json.avertissements, []);
    const refus = await a.patch(`/api/patients/${o.id}`, { nom: 'lapin', prenom: 'pierre' });
    assert.equal(refus.status, 409);
    assert.equal(refus.json.erreur.code, 'PATIENT_EXISTANT');
    assert.deepEqual(refus.json.erreur.details.candidats.map((c) => c.id), [p.id]);
    assert.ok(!/lapin|pierre/i.test(refus.texte), 'aucun nom dans l\'erreur');
    assert.equal((await disque(s)).patients.find((x) => x.id === o.id).nom, 'Ours', 'rien n\'a changé');
    const ok = await a.patch(`/api/patients/${o.id}`, { nom: 'lapin', prenom: 'pierre', homonyme: true });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.avertissements.map((x) => x.code), ['PATIENT_HOMONYME']);
    assert.ok((await liste(a)).every((x) => x.homonyme));
  }));

test('PATCH /api/patients/{id} : 400 corps vide / sans nom-prénom-actif / champ inconnu / actif non booléen ; 422 nom invalide ; 404 inconnu ; aucune écriture', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Lapin', 'Pierre');
    const avant = (await disque(s)).revision;
    assert.equal((await a.patch(`/api/patients/${p.id}`, {})).status, 400);
    assert.equal((await a.patch(`/api/patients/${p.id}`, { homonyme: true })).status, 400);
    assert.equal((await a.patch(`/api/patients/${p.id}`, { role: 'x', nom: 'A' })).status, 400);
    assert.equal((await a.patch(`/api/patients/${p.id}`, { actif: 'non' })).status, 400);
    const v = await a.patch(`/api/patients/${p.id}`, { nom: ' ' });
    assert.equal(v.status, 422);
    assert.ok(v.json.erreur.champs.nom);
    assert.equal((await a.patch(`/api/patients/${p.id}`, { prenom: 'Pi​erre' })).status, 422);
    const inconnu = await a.patch('/api/patients/inconnu', { nom: 'A' });
    assert.equal(inconnu.status, 404);
    assert.equal(inconnu.json.erreur.code, 'INTROUVABLE');
    assert.equal((await disque(s)).revision, avant, 'aucune écriture');
  }));

test('PATCH actif : archiver / réactiver (idempotent), prestations conservées, avertissement PATIENT_ARCHIVE_EN_COURS avec les nombres', () =>
  avecServeur(async (s, a) => {
    const vide = await creer(a, 'Cygne', 'Léa');
    const archive = await a.patch(`/api/patients/${vide.id}`, { actif: false });
    assert.equal(archive.status, 200);
    assert.equal(archive.json.donnees.patient.actif, false);
    assert.deepEqual(archive.json.avertissements, []);
    assert.equal((await liste(a))[0].actif, false);
    const encore = await a.patch(`/api/patients/${vide.id}`, { actif: false });
    assert.equal(encore.status, 200, 'idempotent');
    assert.equal(encore.json.donnees.patient.actif, false);
    assert.equal((await a.patch(`/api/patients/${vide.id}`, { actif: true })).json.donnees.patient.actif, true);

    const l = (await a.post('/api/prestations', saisie({ date: '2026-10-20' }))).json.donnees;
    const r = await a.patch(`/api/patients/${l.patient.id}`, { actif: false });
    assert.equal(r.status, 200);
    const av = r.json.avertissements.find((x) => x.code === 'PATIENT_ARCHIVE_EN_COURS');
    assert.ok(av);
    assert.deepEqual(av.details, { aVenir: 1, impayees: 1 });
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 1, 'les prestations restent visibles');
    assert.equal((await a.get('/api/recap?mois=2026-10')).status, 200);
  }));

test('POST /api/prestations : un patient archivé choisi est réactivé avec l\'avertissement PATIENT_REACTIVE', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Ours', 'Baloo');
    await a.patch(`/api/patients/${p.id}`, { actif: false });
    const r = await a.post('/api/prestations', saisie({ patient: undefined, patientId: p.id }));
    assert.equal(r.status, 201);
    assert.ok(r.json.avertissements.some((x) => x.code === 'PATIENT_REACTIVE'));
    assert.equal((await liste(a))[0].actif, true);
  }));

test('DELETE /api/patients/{id} : patient sans prestation supprimé après sauvegarde avant-suppression ; 404 ensuite', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Lapin', 'Pierre');
    const r = await a.del(`/api/patients/${p.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.donnees, { id: p.id });
    assert.ok(r.json.annulation);
    assert.deepEqual((await disque(s)).patients, []);
    assert.equal((await sauvegardesDe(s, 'avant-suppression')).length, 1);
    const encore = await a.del(`/api/patients/${p.id}`);
    assert.equal(encore.status, 404);
    assert.equal(encore.json.erreur.code, 'INTROUVABLE');
  }));

test('DELETE /api/patients/{id} : 409 PATIENT_UTILISE avec une ligne du fichier actif ; supprimer la prestation laisse le patient, alors supprimable', () =>
  avecServeur(async (s, a) => {
    const l = (await a.post('/api/prestations', saisie())).json.donnees;
    const id = l.patient.id;
    assert.equal((await liste(a))[0].supprimable, false);
    const r = await a.del(`/api/patients/${id}`);
    assert.equal(r.status, 409);
    assert.equal(r.json.erreur.code, 'PATIENT_UTILISE');
    assert.equal((await disque(s)).patients.length, 1);
    assert.equal((await a.del(`/api/prestations/${l.id}`)).status, 200);
    assert.equal((await disque(s)).patients.length, 1, 'le patient reste au registre');
    assert.equal((await liste(a))[0].supprimable, true);
    assert.equal((await a.del(`/api/patients/${id}`)).status, 200);
  }));

const ligneArchive = {
  id: '8f1c2e0a-0000-4000-8000-0000000000a1',
  patient: { id: ID_ARCHIVE, nom: 'Lapin', prenom: 'Pierre' },
  date: '2022-03-14',
  prestationId: 'seance-45',
  libelle: 'Séance individuelle 45 min',
  categorie: 'seance',
  motif: 'Graphisme',
  montantCentimes: 5800,
  statut: 'facture',
  factureLe: '2022-03-31',
  versements: [{ id: 'c41a0000-0000-4000-8000-0000000000c1', montantCentimes: 5800, date: '2022-04-02', mode: 'cheque' }],
  creeLe: '2022-03-14T16:02:11.000Z',
  modifieLe: '2022-04-02T08:30:00.000Z',
};
const archive = (prestations) => JSON.stringify({ format: 'suivi-facturation-archive', prestations });
const etatAvecRegistre = () => ({
  ...etatInitialTest(),
  patients: [
    { id: ID_ARCHIVE, nom: 'Lapin', prenom: 'Pierre', actif: true },
    { id: ID_AUTRE, nom: 'Ours', prenom: 'Baloo', actif: true },
  ],
});
const preparerArchives = (archives) => async (dossier) => {
  await ecrireFichierTest(path.join(dossier, NOM_FICHIER), JSON.stringify(etatAvecRegistre(), null, 2));
  for (const [nom, contenu] of Object.entries(archives)) await ecrireFichierTest(path.join(dossier, nom), contenu);
};

test('DELETE : patient présent dans une archive lisible = 409 PATIENT_UTILISE (supprimable false) ; un autre patient reste supprimable', () =>
  avecServeur(
    async (s, a) => {
      const l = await liste(a);
      const dansArchive = l.find((p) => p.id === ID_ARCHIVE);
      assert.equal(dansArchive.supprimable, false);
      assert.equal(dansArchive.nombrePrestations, 0, 'seul le fichier actif est compté');
      const r = await a.del(`/api/patients/${ID_ARCHIVE}`);
      assert.equal(r.status, 409);
      assert.equal(r.json.erreur.code, 'PATIENT_UTILISE');
      assert.equal((await disque(s)).patients.length, 2);
      assert.equal(l.find((p) => p.id === ID_AUTRE).supprimable, true);
      assert.equal((await a.del(`/api/patients/${ID_AUTRE}`)).status, 200);
    },
    { preparer: preparerArchives({ 'archive-2022.json': archive([ligneArchive]) }) },
  ));

test('DELETE : une archive illisible interdit toute suppression (409 PATIENT_UTILISE), GET ne répond jamais 500', () =>
  avecServeur(
    async (s, a) => {
      const l = await liste(a);
      assert.equal(l.length, 2);
      assert.ok(l.every((p) => p.supprimable === false));
      for (const p of l) {
        const r = await a.del(`/api/patients/${p.id}`);
        assert.equal(r.status, 409);
        assert.equal(r.json.erreur.code, 'PATIENT_UTILISE');
      }
      assert.equal((await disque(s)).patients.length, 2);
    },
    { preparer: preparerArchives({ 'archive-2023.json': '{"format":"suivi-facturation-archive","prestations":[{"id":"8f1c2e0a-0000-4000' }) },
  ));

test('DELETE : sauvegarde de sécurité impossible = 503 SAUVEGARDE_ECHOUEE, patient conservé', () => {
  const { fs: fsSimule, etat } = fsSauvegardesBloquees();
  return avecServeur(
    async (s, a) => {
      const p = await creer(a, 'Lapin', 'Pierre');
      etat.bloque = true;
      const r = await a.del(`/api/patients/${p.id}`);
      assert.equal(r.status, 503);
      assert.equal(r.json.erreur.code, 'SAUVEGARDE_ECHOUEE');
      assert.equal((await disque(s)).patients.length, 1);
      etat.bloque = false;
      assert.equal((await a.del(`/api/patients/${p.id}`)).status, 200);
    },
    { fs: fsSimule },
  );
});

test('annulation : création, renommage, archivage et suppression d\'un patient sont annulables (une seule fois)', () =>
  avecServeur(async (s, a) => {
    const c = await a.post('/api/patients', { nom: 'Lapin', prenom: 'Pierre' });
    assert.equal((await a.post(`/api/annulations/${c.json.annulation}`)).status, 200);
    assert.deepEqual((await disque(s)).patients, [], 'création annulée');

    const p = await creer(a, 'Lapin', 'Pierre');
    await a.post('/api/prestations', saisie({ patient: undefined, patientId: p.id }));
    const ren = await a.patch(`/api/patients/${p.id}`, { nom: 'Lapen' });
    assert.equal((await a.post(`/api/annulations/${ren.json.annulation}`)).status, 200);
    let d = await disque(s);
    assert.equal(d.patients[0].nom, 'Lapin');
    assert.equal(d.prestations[0].patient.nom, 'Lapin', 'l\'ancien nom revient partout');

    const arc = await a.patch(`/api/patients/${p.id}`, { actif: false });
    assert.equal((await a.post(`/api/annulations/${arc.json.annulation}`)).status, 200);
    assert.equal((await disque(s)).patients[0].actif, true);
    assert.equal((await a.post(`/api/annulations/${arc.json.annulation}`)).status, 409, 'une seule fois');

    const vide = await creer(a, 'Ours', 'Baloo');
    const sup = await a.del(`/api/patients/${vide.id}`);
    assert.equal((await disque(s)).patients.length, 1);
    assert.equal((await a.post(`/api/annulations/${sup.json.annulation}`)).status, 200);
    d = await disque(s);
    assert.deepEqual(d.patients.map((x) => x.nom).sort(), ['Lapin', 'Ours']);
  }));

test('annulation refusée (409 ANNULATION_IMPOSSIBLE) si une autre modification a eu lieu entre-temps', () =>
  avecServeur(async (s, a) => {
    const c = await a.post('/api/patients', { nom: 'Lapin', prenom: 'Pierre' });
    await a.post('/api/patients', { nom: 'Ours', prenom: 'Baloo' });
    const r = await a.post(`/api/annulations/${c.json.annulation}`);
    assert.equal(r.status, 409);
    assert.equal(r.json.erreur.code, 'ANNULATION_IMPOSSIBLE');
    assert.equal((await disque(s)).patients.length, 2);
  }));

test('création d\'une prestation avec un nouveau patient : annuler retire la prestation ET le patient ; annuler la réactivation le remet archivé', () =>
  avecServeur(async (s, a) => {
    const r = await a.post('/api/prestations', saisie());
    assert.equal((await disque(s)).patients.length, 1);
    assert.equal((await a.post(`/api/annulations/${r.json.annulation}`)).status, 200);
    const d = await disque(s);
    assert.equal(d.patients.length, 0);
    assert.equal(d.prestations.length, 0);

    const p = await creer(a, 'Ours', 'Baloo');
    await a.patch(`/api/patients/${p.id}`, { actif: false });
    const reactive = await a.post('/api/prestations', saisie({ patient: undefined, patientId: p.id }));
    assert.equal((await a.post(`/api/annulations/${reactive.json.annulation}`)).status, 200);
    assert.equal((await disque(s)).patients[0].actif, false);
  }));

test('GET /api/patients : nombre de prestations et dernière date calculés sur le fichier actif', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Lapin', 'Pierre');
    await a.post('/api/prestations', saisie({ patient: undefined, patientId: p.id, date: '2026-09-01' }));
    await a.post('/api/prestations', saisie({ patient: undefined, patientId: p.id, date: '2026-09-15' }));
    const [e] = await liste(a);
    assert.equal(e.nombrePrestations, 2);
    assert.equal(e.dernierePrestation, '2026-09-15');
    assert.equal(e.supprimable, false);
  }));

test('méthodes non prévues = 405 ; pas de route de réparation dans ce lot', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Lapin', 'Pierre');
    for (const [methode, chemin] of [['PUT', '/api/patients'], ['DELETE', '/api/patients'], ['POST', `/api/patients/${p.id}`], ['GET', `/api/patients/${p.id}`]]) {
      const r = await s.requete({ methode, chemin, headers: { Origin: `http://127.0.0.1:${s.port}` } });
      assert.equal(r.status, 405, `${methode} ${chemin}`);
    }
    assert.equal((await a.post('/api/patients/reparer', { confirmer: true })).status, 405);
  }));

test('sécurité : Host étranger, Origin absente ou étrangère sur une écriture, Sec-Fetch-Site cross-site = 403 ; rien n\'est écrit', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Lapin', 'Pierre');
    const corps = JSON.stringify({ nom: 'Ours', prenom: 'Baloo' });
    const json = { 'Content-Type': 'application/json' };
    const origine = `http://127.0.0.1:${s.port}`;
    const tentatives = [
      { methode: 'POST', chemin: '/api/patients', headers: { ...json, Origin: origine }, hote: 'evil.example', corps },
      { methode: 'POST', chemin: '/api/patients', headers: json, corps },
      { methode: 'POST', chemin: '/api/patients', headers: { ...json, Origin: 'http://evil.example' }, corps },
      { methode: 'PATCH', chemin: `/api/patients/${p.id}`, headers: { ...json, Origin: 'http://evil.example' }, corps },
      { methode: 'DELETE', chemin: `/api/patients/${p.id}`, headers: {} },
      { methode: 'DELETE', chemin: `/api/patients/${p.id}`, headers: { Origin: origine, 'Sec-Fetch-Site': 'cross-site' } },
      { methode: 'GET', chemin: '/api/patients', headers: { 'Sec-Fetch-Site': 'cross-site' } },
      { methode: 'GET', chemin: '/api/patients', headers: {}, hote: 'evil.example' },
    ];
    for (const t of tentatives) assert.equal((await s.requete(t)).status, 403, `${t.methode} ${t.chemin} ${JSON.stringify(t.headers)}`);
    assert.deepEqual((await disque(s)).patients.map((x) => x.id), [p.id]);
  }));

test('mode dégradé (fichier illisible) : toutes les routes de patients répondent 503 DONNEES_ILLISIBLES, fichier intact', () =>
  avecServeur(
    async (s, a) => {
      const avant = await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8');
      for (const r of [await a.get('/api/patients'), await a.post('/api/patients', { nom: 'A', prenom: 'B' }), await a.patch('/api/patients/x', { nom: 'A' }), await a.del('/api/patients/x')]) {
        assert.equal(r.status, 503);
        assert.equal(r.json.erreur.code, 'DONNEES_ILLISIBLES');
      }
      assert.equal(await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8'), avant);
    },
    { preparer: (d) => ecrireFichierTest(path.join(d, NOM_FICHIER), '{ pas du json') },
  ));

test('lecture seule (schéma plus récent) : liste lisible, écritures refusées 503 SCHEMA_PLUS_RECENT', () =>
  avecServeur(
    async (s, a) => {
      assert.equal((await a.get('/api/patients')).status, 200);
      for (const r of [await a.post('/api/patients', { nom: 'A', prenom: 'B' }), await a.patch(`/api/patients/${ID_ARCHIVE}`, { actif: false }), await a.del(`/api/patients/${ID_AUTRE}`)]) {
        assert.equal(r.status, 503);
        assert.equal(r.json.erreur.code, 'SCHEMA_PLUS_RECENT');
      }
    },
    { preparer: (d) => ecrireFichierTest(path.join(d, NOM_FICHIER), JSON.stringify({ ...etatAvecRegistre(), schemaVersion: 42 })) },
  ));

test('conflit de fichier (modifié ailleurs) : écritures refusées 409 CONFLIT_FICHIER, rien n\'est enregistré', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Lapin', 'Pierre');
    await ecrireFichierTest(path.join(s.dossier, NOM_FICHIER), JSON.stringify({ ...etatInitialTest(), revision: 40 }));
    for (const r of [await a.post('/api/patients', { nom: 'Ours', prenom: 'Baloo' }), await a.patch(`/api/patients/${p.id}`, { actif: false }), await a.del(`/api/patients/${p.id}`)]) {
      assert.equal(r.status, 409);
      assert.equal(r.json.erreur.code, 'CONFLIT_FICHIER');
    }
    assert.equal((await disque(s)).revision, 40, 'le fichier posé ailleurs est intact');
  }));

test('journal : aucun nom ni prénom de patient, même sur erreur', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Secretnom', 'Secretprenom');
    await a.post('/api/patients', { nom: 'Secretnom', prenom: 'Secretprenom' }); // 409
    await a.post('/api/patients', { nom: 'Secret​nom', prenom: 'X' }); // 422
    await a.patch(`/api/patients/${p.id}`, { nom: 'Autresecret' });
    await a.del(`/api/patients/${p.id}`); // 200
    await a.patch(`/api/patients/${p.id}`, { actif: false }); // 404
    assert.ok(!/secret/i.test(s.journal.join('\n')), 'ni nom ni prénom dans le journal');
  }));

test('export JSON : contient le registre (actif.patients)', () =>
  avecServeur(async (s, a) => {
    const p = await creer(a, 'Lapin', 'Pierre');
    const r = await a.get('/api/export?format=json');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.actif.patients, [p]);
  }));

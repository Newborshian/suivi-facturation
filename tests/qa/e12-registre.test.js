// Recette QA de l'épic E12 (registre des patients) : migration d'une COPIE de fichier v1 fictif (homonymes, casses et espaces
// différents, patient sans prénom, identifiant vide, version plus récente), parcours HTTP du registre, confidentialité du registre
// et volumétrie (5 000 prestations). Données 100 % factices ; dossiers temporaires sous .tmp/tests/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { client, lireDisque, octetsDisque, saisie, serveurAvecFichier } from './aides-qa.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { catalogueTest } from '../aides/catalogue-test.js';
import { horlogeReglable } from '../aides/horloge.js';
import { csvPrestations, csvVersements } from '../../src/domain/csv.js';
import { ajouterJours } from '../../src/domain/dates.js';

const NOMS_FICTIFS = ['Lapin', 'Ours', 'Cygne', 'Dupont', 'Renard', 'Zed', 'Panda'];

let compteur = 0;
/** Ligne de fichier v1 (même forme que le fichier de données). */
function ligneV1(pid, nom, prenom, date, extra = {}) {
  compteur += 1;
  return {
    id: `v1-${compteur}`,
    patient: { id: pid, nom, prenom },
    date,
    prestationId: 'seance-45',
    libelle: 'Séance individuelle 45 min',
    categorie: 'seance',
    motif: 'Graphisme',
    montantCentimes: 5800,
    statut: 'a_facturer',
    factureLe: null,
    versements: [],
    creeLe: `2026-09-01T08:00:${String(compteur % 60).padStart(2, '0')}.000Z`,
    modifieLe: '2026-09-01T08:00:00.000Z',
    ...extra,
  };
}
const v = (id, montantCentimes, date, mode) => ({ id, montantCentimes, date, mode });

/** Fichier v1 fictif : écritures anciennes en minuscules, espaces parasites, deux patients de même clé (homonymes), séance à venir. */
function fichierV1(lignesSupplementaires = []) {
  const lignes = [
    ligneV1('pa', 'lapin', 'pierre', '2026-08-03'),
    ligneV1('pa', 'Lapin', 'Pierre', '2026-09-28', { statut: 'facture', factureLe: '2026-09-30', versements: [v('va', 2000, '2026-10-01', 'carte')] }),
    ligneV1('pb', 'Renard', 'Basile', '2026-09-10', { statut: 'facture', factureLe: '2026-09-30', versements: [v('vb', 5800, '2026-10-01', 'cheque')] }),
    ligneV1('pc', 'RENARD', ' Basile', '2026-09-30'), // homonyme assumé : id distinct, même clé
    ligneV1('pd', 'Cygne', 'Léa', '2026-09-20'),
    ligneV1('pd', 'Cygne  ', 'Léa', '2026-09-29'),
    ligneV1('pe', 'dupont', 'jean', '2026-05-01'), // ancienne écriture
    ligneV1('pe', 'Dupont', 'Jean', '2026-07-01', { montantCentimes: 17000 }), // écriture la plus récente : celle du registre
    ligneV1('pf', 'Ours', 'Baloo', '2026-10-20'), // à venir
    ligneV1('pf', 'Ours', 'Baloo', '2026-09-25', { montantCentimes: 4200, versements: [v('vc', 4200, '2026-09-25', 'especes')] }),
    ...lignesSupplementaires,
  ];
  return {
    format: 'suivi-facturation',
    schemaVersion: 1,
    revision: 7,
    majLe: '2026-10-01T08:00:00.000Z',
    parametres: { sauvegardesConservees: 30, dernierModePaiement: 'virement' },
    catalogue: catalogueTest(),
    prestations: lignes,
  };
}
const texte = (o) => `${JSON.stringify(o, null, 2)}\n`;
const sansPatient = (l) => {
  const { patient, ...reste } = l;
  return reste;
};
const sauvegardesDe = async (dossier) => (await fs.readdir(path.join(dossier, 'sauvegardes')).catch(() => [])).sort();

// ------------------------------------------------------------------------------------------------ Migration (E12-S9, S10)

test('migration d\'une copie v1 : sauvegarde « avant-migration » identique octet pour octet, lignes inchangées, registre reconstruit (homonymes, écriture la plus récente)', async () => {
  const original = texte(fichierV1());
  const s = await serveurAvecFichier(original);
  try {
    const a = client(s);
    const sauvegardes = await sauvegardesDe(s.dossier);
    const avant = sauvegardes.filter((n) => n.endsWith('_avant-migration.json'));
    assert.equal(avant.length, 1, 'une seule sauvegarde avant-migration');
    const octetsAvant = await fs.readFile(path.join(s.dossier, 'sauvegardes', avant[0]));
    assert.ok(octetsAvant.equals(Buffer.from(original, 'utf8')), 'copie octet pour octet du fichier d\'origine');

    const apres = await lireDisque(s.dossier);
    const o = JSON.parse(original);
    assert.equal(apres.schemaVersion, 2);
    assert.equal(apres.revision, o.revision, 'la révision n\'est pas changée par la migration');
    assert.equal(apres.prestations.length, o.prestations.length);
    o.prestations.forEach((l, i) => assert.deepEqual(sansPatient(apres.prestations[i]), sansPatient(l), `ligne ${i} : montants, versements, statut, dates, identifiants, modifieLe`));

    assert.equal(apres.patients.length, 6, 'un patient par identifiant distinct');
    assert.ok(apres.patients.every((p) => p.actif === true), 'aucun patient archivé d\'office');
    for (const p of apres.patients) assert.deepEqual(Object.keys(p).sort(), ['actif', 'id', 'nom', 'prenom'], 'registre : id, nom, prenom, actif seulement');
    const parId = Object.fromEntries(apres.patients.map((p) => [p.id, p]));
    assert.deepEqual([parId.pe.nom, parId.pe.prenom], ['Dupont', 'Jean'], 'écriture de la ligne la plus récente');
    assert.deepEqual([parId.pd.nom, parId.pd.prenom], ['Cygne', 'Léa'], 'espaces de bord et doubles espaces normalisés');
    assert.deepEqual([parId.pc.nom, parId.pc.prenom], ['RENARD', 'Basile']);
    for (const l of apres.prestations) assert.deepEqual({ ...l.patient }, { id: l.patient.id, nom: parId[l.patient.id].nom, prenom: parId[l.patient.id].prenom }, 'copie alignée sur le registre');

    const liste = (await a.get('/api/patients')).json.patients;
    assert.deepEqual(liste.filter((p) => p.homonyme).map((p) => p.id).sort(), ['pb', 'pc'], 'les deux homonymes assumés sont marqués');
    assert.deepEqual((await a.get('/api/etat')).json.avertissements, [], 'aucun avertissement d\'incohérence après migration');
    const resume = (await a.get('/api/sauvegardes')).json.sauvegardes.find((x) => x.raison === 'avant-migration');
    assert.equal(resume.schemaVersion, 1);
    assert.equal(resume.nombrePatients, 6, 'nombre de patients d\'une sauvegarde v1 : reconstruit depuis ses lignes');
  } finally {
    await s.arreter();
  }
});

test('migration : les exports CSV (prestations et versements) sont ceux d\'avant, aux seules écritures de noms près (casse, espaces)', async () => {
  const original = fichierV1();
  const s = await serveurAvecFichier(texte(original));
  try {
    const a = client(s);
    const registre = Object.fromEntries((await lireDisque(s.dossier)).patients.map((p) => [p.id, p]));
    const attendu = original.prestations.map((l) => ({ ...l, patient: { id: l.patient.id, nom: registre[l.patient.id].nom, prenom: registre[l.patient.id].prenom } }));
    const sansBom = (t) => t.replace(/^﻿/, '');
    assert.equal((await a.get('/api/export?format=csv&contenu=prestations')).texte, csvPrestations(attendu));
    assert.equal((await a.get('/api/export?format=csv&contenu=versements')).texte, csvVersements(attendu));
    // Mêmes colonnes et mêmes montants que le CSV calculé sur les lignes d'origine : seules les colonnes nom et prénom peuvent différer.
    const brut = (t) => sansBom(t).split('\r\n').map((x) => x.split(';'));
    const avant = brut(csvPrestations(original.prestations));
    const apres = brut((await a.get('/api/export?format=csv&contenu=prestations')).texte);
    assert.equal(apres.length, avant.length);
    apres.forEach((cols, i) => assert.deepEqual([...cols.slice(0, 2), ...cols.slice(4)], [...avant[i].slice(0, 2), ...avant[i].slice(4)], `ligne ${i} du CSV`));
    // Export JSON complet : contient le registre en plus des prestations (E12-S10).
    const complet = (await a.get('/api/export?format=json')).json;
    assert.equal(complet.actif.patients.length, 6);
    assert.equal(complet.actif.prestations.length, original.prestations.length);
  } finally {
    await s.arreter();
  }
});

for (const [titre, ligneFautive] of [
  ['patient sans prénom', ligneV1('pg', 'Martin', '', '2026-09-15')],
  ['ligne dont l\'identifiant de patient est vide (orpheline)', ligneV1('', 'Sans', 'Identifiant', '2026-09-15')],
  ['ligne sans objet patient', (() => { const l = ligneV1('ph', 'X', 'Y', '2026-09-15'); delete l.patient; return l; })()],
]) {
  test(`échec de migration (${titre}) : fichier d'origine intact octet pour octet, aucune sauvegarde, mode dégradé, écritures refusées`, async () => {
    const original = texte(fichierV1([ligneFautive]));
    const s = await serveurAvecFichier(original);
    try {
      const a = client(s);
      assert.ok((await octetsDisque(s.dossier)).equals(Buffer.from(original, 'utf8')), 'fichier d\'origine non modifié');
      assert.deepEqual(await sauvegardesDe(s.dossier), [], 'aucune sauvegarde créée (la migration a échoué avant)');
      const etat = (await a.get('/api/etat')).json;
      assert.equal(etat.modeDegrade, true);
      assert.equal(etat.erreur.code, 'DONNEES_ILLISIBLES');
      assert.match(etat.erreur.message, /Rien n'a été modifié/);
      assert.equal((await a.get('/api/patients')).status, 503);
      assert.equal((await a.post('/api/patients', { nom: 'Zed', prenom: 'Zoe' })).status, 503);
      assert.equal((await a.post('/api/prestations', saisie())).status, 503);
      assert.ok((await octetsDisque(s.dossier)).equals(Buffer.from(original, 'utf8')), 'toujours intact après les tentatives d\'écriture');
    } finally {
      await s.arreter();
    }
  });
}

test('fichier d\'une version plus récente (3) : lecture seule, aucune migration, aucune sauvegarde, toute écriture refusée (503 SCHEMA_PLUS_RECENT), lectures possibles', async () => {
  const v2 = JSON.parse(texte(fichierV1()));
  // Un fichier v2 valide rangé comme « version 3 » : registre reconstruit à la main (même règle que la migration).
  const { reconstruireRegistre } = await import('../../src/domain/patients.js');
  const r = reconstruireRegistre(v2.prestations);
  const v3 = { ...v2, schemaVersion: 3, patients: r.patients, prestations: r.prestations };
  const original = texte(v3);
  const s = await serveurAvecFichier(original);
  try {
    const a = client(s);
    assert.ok((await octetsDisque(s.dossier)).equals(Buffer.from(original, 'utf8')));
    assert.deepEqual(await sauvegardesDe(s.dossier), []);
    const etat = (await a.get('/api/etat')).json;
    assert.equal(etat.lectureSeule, true);
    assert.equal(etat.modeDegrade, false);
    assert.equal((await a.get('/api/patients')).status, 200, 'la liste reste consultable');
    const id = (await a.get('/api/patients')).json.patients[0].id;
    for (const [methode, chemin, corps] of [
      ['post', '/api/patients', { nom: 'Zed', prenom: 'Zoe' }],
      ['patch', `/api/patients/${id}`, { actif: false }],
      ['del', `/api/patients/${id}`, undefined],
      ['post', '/api/prestations', saisie()],
    ]) {
      const rep = await a[methode](chemin, corps);
      assert.equal(rep.status, 503, `${methode} ${chemin}`);
      assert.equal(rep.json.erreur.code, 'SCHEMA_PLUS_RECENT', `${methode} ${chemin}`);
    }
    assert.ok((await octetsDisque(s.dossier)).equals(Buffer.from(original, 'utf8')), 'fichier toujours identique');
    assert.deepEqual(await sauvegardesDe(s.dossier), []);
  } finally {
    await s.arreter();
  }
});

test('restauration d\'une sauvegarde v1 après la mise à jour : migrée de la même façon (registre reconstruit), la sauvegarde elle-même reste intacte', async () => {
  const original = texte(fichierV1());
  const s = await serveurAvecFichier(original);
  try {
    const a = client(s);
    assert.equal((await a.post('/api/patients', { nom: 'Zed', prenom: 'Zoe' })).status, 201);
    assert.equal((await lireDisque(s.dossier)).patients.length, 7);
    const nom = (await a.get('/api/sauvegardes')).json.sauvegardes.find((x) => x.raison === 'avant-migration').nom;
    const r = await a.post(`/api/sauvegardes/${nom}/restaurer`, { confirmer: true });
    assert.equal(r.status, 200);
    const disque = await lireDisque(s.dossier);
    assert.equal(disque.schemaVersion, 2);
    assert.equal(disque.patients.length, 6, 'registre reconstruit depuis les lignes de la sauvegarde (Zed Zoe, créé après, n\'y est pas)');
    assert.ok((await fs.readFile(path.join(s.dossier, 'sauvegardes', nom))).equals(Buffer.from(original, 'utf8')), 'la sauvegarde v1 n\'est jamais modifiée');
  } finally {
    await s.arreter();
  }
});

// ------------------------------------------------------------------------------------------------ Parcours HTTP du registre (E12-S1 à S8)

async function avec(fn) {
  const s = await demarrerServeurTest();
  try {
    await fn(s, client(s));
  } finally {
    await s.arreter();
  }
}
const registre = async (a) => (await a.get('/api/patients')).json.patients;

test('registre : ajout, homonyme (409 sans nom dans les candidats), confirmation, double requête concurrente (un seul patient), champs hors périmètre refusés', () =>
  avec(async (s, a) => {
    const c = await a.post('/api/patients', { nom: 'Lapin', prenom: 'Pierre' });
    assert.equal(c.status, 201);
    assert.deepEqual(Object.keys(c.json.donnees).sort(), ['actif', 'id', 'nom', 'prenom']);
    const doublon = await a.post('/api/patients', { nom: ' LAPIN ', prenom: 'pierre' });
    assert.equal(doublon.status, 409);
    assert.equal(doublon.json.erreur.code, 'PATIENT_EXISTANT');
    assert.deepEqual(doublon.json.erreur.details.candidats, [{ id: c.json.donnees.id, dernierePrestation: null }], 'candidats : identifiant et date, jamais de nom');
    assert.ok(!/lapin|pierre/i.test(JSON.stringify(doublon.json)), 'aucun nom dans l\'erreur d\'homonyme');
    assert.equal((await registre(a)).length, 1, 'rien n\'est créé sans confirmation');
    assert.equal((await a.post('/api/patients', { nom: 'Lapin', prenom: 'Pierre', homonyme: true })).status, 201);
    const liste = await registre(a);
    assert.equal(liste.length, 2);
    assert.ok(liste.every((p) => p.homonyme), 'les deux sont marqués « Homonyme »');

    // double envoi simultané du même nom : un seul patient créé, la seconde requête reçoit la demande de confirmation
    const [x, y] = await Promise.all([a.post('/api/patients', { nom: 'Panda', prenom: 'Po' }), a.post('/api/patients', { nom: 'Panda', prenom: 'Po' })]);
    assert.deepEqual([x.status, y.status].sort(), [201, 409]);
    assert.equal((await registre(a)).filter((p) => p.nom === 'Panda').length, 1);

    for (const corps of [{ nom: 'A', prenom: 'B', telephone: '0102030405' }, { nom: 'A', prenom: 'B', naissance: '2015-01-01' }, { nom: 'A', prenom: 'B', note: 'x' }]) {
      assert.equal((await a.post('/api/patients', corps)).status, 400, JSON.stringify(corps));
    }
    for (const corps of [{ nom: '', prenom: 'B' }, { nom: 'A', prenom: '   ' }, { nom: 'x'.repeat(101), prenom: 'B' }, { nom: 'A‮b', prenom: 'B' }, { nom: 'A​b', prenom: 'B' }, { nom: 'A\u0007b', prenom: 'B' }]) {
      const r = await a.post('/api/patients', corps);
      assert.equal(r.status, 422, JSON.stringify(corps));
      assert.equal(r.json.erreur.code, 'VALIDATION');
    }
    const disque = await lireDisque(s.dossier);
    for (const p of disque.patients) assert.deepEqual(Object.keys(p).sort(), ['actif', 'id', 'nom', 'prenom'], 'périmètre du registre (E12-S12)');
  }));

test('registre : renommage propagé aux prestations, annulation, casse sans confirmation, homonyme confirmé sans fusion, archivage idempotent avec avertissement', () =>
  avec(async (s, a) => {
    const lignes = [];
    for (const date of ['2026-09-01', '2026-09-08', '2026-10-15']) lignes.push((await a.post('/api/prestations', saisie({ patient: { nom: 'Lapen', prenom: 'Pierre' }, date }))).json.donnees);
    const id = lignes[0].patient.id;
    assert.ok(lignes.every((l) => l.patient.id === id), 'un seul patient pour trois prestations');
    const rn = await a.patch(`/api/patients/${id}`, { nom: 'Lapin' });
    assert.equal(rn.status, 200);
    assert.equal(rn.json.donnees.lignesModifiees, 3);
    assert.ok((await lireDisque(s.dossier)).prestations.every((l) => l.patient.nom === 'Lapin' && l.patient.id === id), 'les lignes portent le nouveau nom, identifiant inchangé');
    assert.equal((await a.post(`/api/annulations/${rn.json.annulation}`)).status, 200);
    assert.ok((await lireDisque(s.dossier)).prestations.every((l) => l.patient.nom === 'Lapen'), 'annulation : l\'ancien nom revient partout');

    assert.equal((await a.patch(`/api/patients/${id}`, { nom: 'LAPEN', prenom: ' pierre ' })).status, 200, 'changement de casse ou d\'espaces : sans confirmation');

    const autre = (await a.post('/api/patients', { nom: 'Ours', prenom: 'Baloo' })).json.donnees;
    const vers = await a.patch(`/api/patients/${autre.id}`, { nom: 'Lapen', prenom: 'Pierre' });
    assert.equal(vers.status, 409);
    assert.equal(vers.json.erreur.code, 'PATIENT_EXISTANT');
    assert.equal((await a.patch(`/api/patients/${autre.id}`, { nom: 'Lapen', prenom: 'Pierre', homonyme: true })).status, 200);
    assert.equal((await registre(a)).length, 2, 'aucune fusion : deux patients distincts');

    // archivage : avertissement (séance à venir, reste à payer), idempotent, prestations inchangées
    const arch = await a.patch(`/api/patients/${id}`, { actif: false });
    assert.equal(arch.status, 200);
    const w = arch.json.avertissements.find((x) => x.code === 'PATIENT_ARCHIVE_EN_COURS');
    assert.deepEqual(w.details, { aVenir: 1, impayees: 3 });
    const encore = await a.patch(`/api/patients/${id}`, { actif: false });
    assert.equal(encore.status, 200);
    assert.deepEqual(encore.json.avertissements, [], 'deuxième archivage : rien ne change, aucune erreur');
    assert.equal((await lireDisque(s.dossier)).prestations.length, 3);
    assert.equal((await a.patch(`/api/patients/${id}`, { actif: true })).status, 200);
  }));

test('registre : suppression refusée si prestation, autorisée sans prestation après sauvegarde « avant-suppression », annulable ; 404 sur identifiant inconnu', () =>
  avec(async (s, a) => {
    const avecLigne = (await a.post('/api/prestations', saisie())).json.donnees.patient.id;
    const sans = (await a.post('/api/patients', { nom: 'Cygne', prenom: 'Léa' })).json.donnees.id;
    const liste = await registre(a);
    assert.equal(liste.find((p) => p.id === avecLigne).supprimable, false);
    assert.equal(liste.find((p) => p.id === sans).supprimable, true);
    const refus = await a.del(`/api/patients/${avecLigne}`);
    assert.equal(refus.status, 409);
    assert.equal(refus.json.erreur.code, 'PATIENT_UTILISE');
    assert.equal((await a.del('/api/patients/inexistant')).status, 404);
    const ok = await a.del(`/api/patients/${sans}`);
    assert.equal(ok.status, 200);
    assert.ok((await sauvegardesDe(s.dossier)).some((n) => n.endsWith('_avant-suppression.json')));
    assert.equal((await registre(a)).length, 1);
    assert.equal((await a.post(`/api/annulations/${ok.json.annulation}`)).status, 200);
    assert.equal((await registre(a)).length, 2, 'annulation : le patient est de retour');
  }));

test('saisie : patient archivé réactivé avec la prestation (annulation : de nouveau archivé) ; nouveau patient créé avec la prestation (annulation : retiré) ; homonymes : choix demandé', () =>
  avec(async (s, a) => {
    const baloo = (await a.post('/api/patients', { nom: 'Ours', prenom: 'Baloo' })).json.donnees;
    await a.patch(`/api/patients/${baloo.id}`, { actif: false });
    const r = await a.post('/api/prestations', saisie({ patient: { nom: 'ours', prenom: 'BALOO' } }));
    assert.equal(r.status, 201);
    assert.equal(r.json.donnees.patient.id, baloo.id, 'rattachée au patient archivé (même clé)');
    assert.deepEqual(r.json.donnees.patient, { id: baloo.id, nom: 'Ours', prenom: 'Baloo' }, 'la ligne porte l\'écriture du registre');
    assert.ok(r.json.avertissements.some((x) => x.code === 'PATIENT_REACTIVE'));
    assert.equal((await registre(a)).find((p) => p.id === baloo.id).actif, true);
    await a.post(`/api/annulations/${r.json.annulation}`);
    assert.equal((await registre(a)).find((p) => p.id === baloo.id).actif, false, 'annulation : de nouveau archivé');

    const n = await a.post('/api/prestations', saisie({ patient: { nom: 'Panda', prenom: 'Po' } }));
    assert.equal((await registre(a)).length, 2);
    await a.post(`/api/annulations/${n.json.annulation}`);
    assert.equal((await registre(a)).length, 1, 'annulation : la prestation et le patient créé avec elle disparaissent');

    await a.post('/api/patients', { nom: 'Ours', prenom: 'Baloo', homonyme: true });
    const h = await a.post('/api/prestations', saisie({ patient: { nom: 'Ours', prenom: 'Baloo' } }));
    assert.equal(h.status, 409);
    assert.equal(h.json.erreur.code, 'PATIENTS_HOMONYMES');
    assert.equal(h.json.erreur.details.candidats.length, 2);
    assert.ok(!/ours|baloo/i.test(JSON.stringify(h.json)), 'candidats décrits sans nom');
    const parId = (id) => {
      const c = saisie();
      delete c.patient;
      return { ...c, patientId: id };
    };
    const choisi = await a.post('/api/prestations', parId(baloo.id));
    assert.equal(choisi.status, 201);
    assert.equal(choisi.json.donnees.patient.id, baloo.id);
    assert.equal((await a.post('/api/prestations', parId('inconnu'))).status, 422);
  }));

test('registre : un nom n\'apparaît jamais dans le journal des requêtes ni dans une URL ; aucun paramètre nominatif accepté', () =>
  avec(async (s, a) => {
    const id = (await a.post('/api/patients', { nom: 'Cygne', prenom: 'Léa' })).json.donnees.id;
    await a.patch(`/api/patients/${id}`, { nom: 'Cygnus' });
    await a.post('/api/patients', { nom: 'Cygnus', prenom: 'Léa' });
    await a.post('/api/prestations', saisie({ patient: { nom: 'Panda', prenom: 'Po' } }));
    await a.get('/api/patients');
    await a.get('/api/prestations');
    await a.del(`/api/patients/${id}`);
    assert.equal((await a.get('/api/patients?nom=Cygnus')).status, 400, 'pas de filtre nominatif dans l\'URL');
    assert.equal((await a.get('/api/prestations?patient=Panda')).status, 400);
    assert.ok(s.journal.length > 5);
    const journal = s.journal.join('\n');
    for (const nom of [...NOMS_FICTIFS, 'Cygnus', 'Léa', 'Po', 'Pierre']) assert.ok(!journal.includes(nom), `« ${nom} » dans le journal`);
    assert.ok(s.journal.some((l) => /^POST \/api\/patients 409 PATIENT_EXISTANT$/.test(l)), 'méthode, chemin sans paramètre, statut et code');
    assert.ok(s.journal.every((l) => !l.includes('?')), 'aucun paramètre de requête journalisé');
  }));

// ------------------------------------------------------------------------------------------------ Volumétrie (E12-S9 à 5 000 prestations)

test('5 000 prestations, 150 patients : migration v1 -> v2, liste, renommage du patient le plus chargé, dans des temps raisonnables et avec des résultats exacts', async () => {
  const lignes = [];
  let graine = 7;
  const alea = () => {
    graine = (graine * 1103515245 + 12345) & 0x7fffffff;
    return graine / 0x7fffffff;
  };
  const NOMS = ['Lapin', 'Ours', 'Hérisson', 'Renard', 'Loup', 'Chouette', 'Castor', 'Blaireau', 'Écureuil', 'Cerf', 'Panda', 'Koala', 'Lynx', 'Aigle', 'Cygne'];
  for (let i = 0; i < 5000; i++) {
    const p = Math.floor(alea() * 150);
    const nom = NOMS[p % 15] + (p >= 15 ? ` ${Math.floor(p / 15)}` : '');
    const paye = alea() < 0.6;
    lignes.push(ligneV1(`pat-${p}`, i % 7 === 0 ? nom.toUpperCase() : nom, `Prénom${p % 14}`, ajouterJours('2024-01-01', Math.floor(alea() * 1000)), paye
      ? { statut: 'facture', factureLe: '2026-09-01', versements: [v(`pv-${i}`, 5800, '2026-09-02', 'carte')] }
      : {}));
  }
  const original = texte({ ...fichierV1(), prestations: lignes });
  const debut = performance.now();
  const s = await serveurAvecFichier(original);
  const tDemarrage = performance.now() - debut;
  try {
    const a = client(s);
    assert.ok(tDemarrage < 20_000, `démarrage avec migration : ${Math.round(tDemarrage)} ms`);
    const avant = (await sauvegardesDe(s.dossier)).find((n) => n.endsWith('_avant-migration.json'));
    assert.ok((await fs.readFile(path.join(s.dossier, 'sauvegardes', avant))).equals(Buffer.from(original, 'utf8')), 'sauvegarde identique à 5 000 lignes');
    const t1 = performance.now();
    const liste = (await a.get('/api/patients')).json.patients;
    const tListe = performance.now() - t1;
    assert.equal(liste.length, 150);
    assert.equal(liste.reduce((n, p) => n + p.nombrePrestations, 0), 5000, 'aucune prestation perdue ni comptée deux fois');
    assert.ok(tListe < 3_000, `GET /api/patients : ${Math.round(tListe)} ms`);
    const gros = [...liste].sort((x, y) => y.nombrePrestations - x.nombrePrestations)[0];
    const t2 = performance.now();
    const rn = await a.patch(`/api/patients/${gros.id}`, { nom: `${gros.nom} Renommé` });
    const tRenommage = performance.now() - t2;
    assert.equal(rn.status, 200);
    assert.ok(rn.json.donnees.lignesModifiees <= gros.nombrePrestations && rn.json.donnees.lignesModifiees > 0);
    assert.ok(tRenommage < 5_000, `renommage de ${gros.nombrePrestations} prestations : ${Math.round(tRenommage)} ms`);
    const disque = await lireDisque(s.dossier);
    assert.equal(disque.prestations.filter((l) => l.patient.id === gros.id && l.patient.nom !== `${gros.nom} Renommé`).length, 0);
    assert.equal((await a.get('/api/etat')).json.nombrePrestations, 5000);
    process.stdout.write(`# volumétrie E12 : migration+démarrage ${Math.round(tDemarrage)} ms, liste ${Math.round(tListe)} ms, renommage (${gros.nombrePrestations} lignes) ${Math.round(tRenommage)} ms\n`);
  } finally {
    await s.arreter();
  }
});

// ------------------------------------------------------------------------------------------------ Renommage depuis la saisie (E12-S3)

test('E12-S3 : un dialogue de modification ouvert avant un renommage reçoit 409 MODIFIEE_AILLEURS à l\'enregistrement (rien n\'est écrasé)', async () => {
  const horloge = horlogeReglable('2026-10-02', '09:00:00');
  const s = await demarrerServeurTest({ horloge });
  try {
    const a = client(s);
    const l = (await a.post('/api/prestations', saisie({ patient: { nom: 'Cygne', prenom: 'Léa' } }))).json.donnees;
    horloge.regler('2026-10-02', '09:05:00');
    assert.equal((await a.patch(`/api/patients/${l.patient.id}`, { nom: 'Cygnus' })).status, 200);
    const obsolete = await a.patch(`/api/prestations/${l.id}`, { modifieLe: l.modifieLe, motif: 'Écrasement' });
    assert.equal(obsolete.status, 409);
    assert.equal(obsolete.json.erreur.code, 'MODIFIEE_AILLEURS');
    const disque = await lireDisque(s.dossier);
    assert.equal(disque.prestations[0].patient.nom, 'Cygnus');
    assert.equal(disque.prestations[0].motif, 'Graphisme', 'le motif n\'a pas été écrasé');
  } finally {
    await s.arreter();
  }
});

test('AN-E12-1 : renommer un patient depuis le dialogue d\'une prestation vers le nom d\'un AUTRE patient demande la même confirmation d\'homonyme que la page Patients (D5)', async () => {
  const s = await demarrerServeurTest();
  try {
    const a = client(s);
    await a.post('/api/prestations', saisie({ patient: { nom: 'Lapin', prenom: 'Pierre' } }));
    await a.post('/api/prestations', saisie({ patient: { nom: 'Ours', prenom: 'Baloo' }, date: '2026-09-01' }));
    const b2 = (await a.post('/api/prestations', saisie({ patient: { nom: 'Ours', prenom: 'Baloo' }, date: '2026-09-02' }))).json.donnees;
    const r = await a.patch(`/api/prestations/${b2.id}`, { modifieLe: b2.modifieLe, patient: { nom: 'Lapin', prenom: 'Pierre' }, renommerPatient: true });
    assert.equal(r.status, 409, 'confirmation demandée avant de créer l\'homonyme');
    assert.equal(r.json.erreur.code, 'PATIENT_EXISTANT');
    assert.equal((await a.get('/api/patients')).json.patients.filter((p) => p.homonyme).length, 0, 'rien n\'est renommé sans confirmation');
  } finally {
    await s.arreter();
  }
});

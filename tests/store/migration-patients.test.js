// Registre des patients côté stockage : migration d'un fichier version 1 au démarrage, échecs sans perte, fichier plus récent,
// restauration d'une sauvegarde version 1, annulation (le registre revient avec la dernière écriture), incohérences signalées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { creerDossierTemp, ecrireFichierTest, supprimerDossierTemp } from '../aides/temp.js';
import { horlogeFixe } from '../aides/horloge.js';
import { enV1, etatTest, etatV1, texteEtat } from '../aides/donnees.js';
import { fsAvecRenameRefuse, fsSauvegardesBloquees } from '../aides/fs-defaillant.js';
import { genererExemple } from '../../src/exemple.js';
import { VERSION_COURANTE, compterIncoherencesPatients, controlerStructure } from '../../src/domain/schema.js';
import { creerPatient, modifierPatient, supprimerPatient } from '../../src/domain/patients.js';
import { creerPrestation } from '../../src/domain/prestations.js';
import { NOM_FICHIER_ACTIF, ouvrirStore } from '../../src/store/store.js';
import { listerSauvegardesDetaillees } from '../../src/store/restauration.js';

const RAPIDE = { delais: [1, 1] };
const lireJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
const sauvegardes = async (d) => (await fs.readdir(path.join(d, 'sauvegardes')).catch(() => [])).sort();
const ctx = () => {
  let n = 0;
  return { aujourdHui: '2026-10-02', maintenant: '2026-10-02T09:00:00.000Z', nouvelId: () => `id-${++n}-${Math.random().toString(16).slice(2)}` };
};

/** Dossier temporaire avec le fichier de départ ; `fn(dossier, chemin, ouvrir)` où `ouvrir(options)` ouvre le store. */
async function avecFichier(contenu, fn) {
  const dossier = await creerDossierTemp('migration-patients');
  try {
    const chemin = path.join(dossier, NOM_FICHIER_ACTIF);
    if (contenu !== null) await ecrireFichierTest(chemin, contenu);
    const ouvrir = (options = {}) => ouvrirStore({ dossier, horloge: horlogeFixe('2026-10-02'), optionsAtomique: RAPIDE, ...options });
    await fn(dossier, chemin, ouvrir);
  } finally {
    await supprimerDossierTemp(dossier);
  }
}

test('fichier version 1 : migré au démarrage, sauvegarde « avant-migration » identique octet pour octet, lignes et révision conservées', async () => {
  const v1 = etatV1(5, { revision: 12 });
  const texte = texteEtat(v1);
  await avecFichier(texte, async (dossier, chemin, ouvrir) => {
    const store = await ouvrir();
    assert.equal(store.etat().modeDegrade, false);
    assert.equal(store.etat().lectureSeule, false);
    const disque = await lireJson(chemin);
    assert.equal(disque.schemaVersion, VERSION_COURANTE);
    assert.equal(disque.revision, 12, 'la migration n\'est pas une saisie : révision inchangée');
    assert.deepEqual(disque.prestations, v1.prestations, 'lignes strictement identiques');
    assert.equal(disque.patients.length, 3);
    assert.ok(disque.patients.every((p) => p.actif === true));
    assert.deepEqual(controlerStructure(disque), []);
    assert.deepEqual(compterIncoherencesPatients(disque), { orphelines: 0, copiesDivergentes: 0 });
    assert.deepEqual(store.lire(), disque);
    const migrations = (await sauvegardes(dossier)).filter((n) => n.endsWith('_avant-migration.json'));
    assert.equal(migrations.length, 1);
    assert.equal(await fs.readFile(path.join(dossier, 'sauvegardes', migrations[0]), 'utf8'), texte, 'copie octet pour octet de l\'original');
    assert.equal(store.etat().avertissements.length, 0, 'aucune incohérence signalée');
  });
});

test('fichier version 1 : une seconde ouverture ne migre plus et ne réécrit rien', async () => {
  await avecFichier(texteEtat(etatV1(3)), async (dossier, chemin, ouvrir) => {
    await ouvrir();
    const apres = await fs.readFile(chemin);
    const avant = await sauvegardes(dossier);
    await ouvrir();
    assert.ok((await fs.readFile(chemin)).equals(apres), 'fichier inchangé');
    assert.equal((await sauvegardes(dossier)).filter((n) => n.includes('avant-migration')).length, 1);
    assert.deepEqual((await sauvegardes(dossier)).filter((n) => n.includes('avant-migration')), avant.filter((n) => n.includes('avant-migration')));
  });
});

test('fichier version 1 sans prestation : migré, registre vide', async () => {
  await avecFichier(texteEtat(etatV1(0)), async (dossier, chemin, ouvrir) => {
    const store = await ouvrir();
    assert.equal(store.etat().modeDegrade, false);
    const disque = await lireJson(chemin);
    assert.equal(disque.schemaVersion, VERSION_COURANTE);
    assert.deepEqual(disque.patients, []);
    assert.deepEqual(disque.prestations, []);
  });
});

test('fichier version 1 : homonymes et patient renommé — deux patients, un patient à l\'écriture de la ligne la plus récente', async () => {
  const v1 = etatV1(0);
  const base = etatV1(4).prestations;
  v1.prestations = [
    { ...base[0], date: '2026-08-01', patient: { id: 'a', nom: 'Lapin', prenom: 'Pierre' } },
    { ...base[1], date: '2026-08-02', patient: { id: 'b', nom: 'lapin', prenom: 'pierre' } },
    { ...base[2], date: '2026-07-01', patient: { id: 'c', nom: 'dupont', prenom: 'jean' } },
    { ...base[3], date: '2026-09-14', patient: { id: 'c', nom: 'Dupont', prenom: 'Jean' } },
  ];
  await avecFichier(texteEtat(v1), async (dossier, chemin, ouvrir) => {
    await ouvrir();
    const disque = await lireJson(chemin);
    assert.deepEqual(disque.patients.map((p) => [p.id, p.nom, p.prenom]).sort(), [['a', 'Lapin', 'Pierre'], ['b', 'lapin', 'pierre'], ['c', 'Dupont', 'Jean']]);
    assert.equal(disque.prestations.find((l) => l.date === '2026-07-01').patient.nom, 'Dupont', 'copie alignée');
  });
});

test('migration impossible (patient sans prénom) : mode dégradé, fichier d\'origine intact, aucune sauvegarde ni écriture', async () => {
  const v1 = etatV1(3);
  v1.prestations[1].patient = { id: 'x', nom: 'Lapin', prenom: '' };
  const texte = texteEtat(v1);
  await avecFichier(texte, async (dossier, chemin, ouvrir) => {
    const store = await ouvrir();
    assert.equal(store.etat().modeDegrade, true);
    assert.equal(store.etat().erreur.raison, 'illisible');
    assert.equal(await fs.readFile(chemin, 'utf8'), texte);
    assert.deepEqual(await sauvegardes(dossier), []);
    await assert.rejects(store.muter('x', () => {}), (e) => e.status === 503 && e.code === 'DONNEES_ILLISIBLES');
  });
});

test('migration impossible (ligne sans patient, ligne orpheline d\'un fichier v1 abîmé) : mode dégradé, fichier d\'origine intact', async () => {
  const v1 = etatV1(3);
  delete v1.prestations[2].patient;
  const texte = texteEtat(v1);
  await avecFichier(texte, async (dossier, chemin, ouvrir) => {
    const store = await ouvrir();
    assert.equal(store.etat().modeDegrade, true);
    assert.equal(await fs.readFile(chemin, 'utf8'), texte);
    assert.deepEqual(await sauvegardes(dossier), []);
  });
});

test('migration : écriture du fichier migré refusée (disque, verrou) -> mode dégradé, fichier d\'origine intact octet pour octet', async () => {
  const texte = texteEtat(etatV1(3, { revision: 4 }));
  await avecFichier(texte, async (dossier, chemin, ouvrir) => {
    const { fs: coupe } = fsAvecRenameRefuse(1000, 'EIO');
    const store = await ouvrir({ fs: coupe });
    assert.equal(store.etat().modeDegrade, true);
    assert.equal(await fs.readFile(chemin, 'utf8'), texte);
    assert.equal((await fs.readdir(dossier)).filter((n) => n.includes('.tmp-')).length, 0, 'aucun temporaire laissé');
  });
});

test('migration : sauvegarde « avant-migration » impossible -> mode dégradé, fichier d\'origine intact, rien d\'écrit', async () => {
  const texte = texteEtat(etatV1(3, { revision: 4 }));
  await avecFichier(texte, async (dossier, chemin, ouvrir) => {
    const { fs: bloque, etat } = fsSauvegardesBloquees();
    etat.bloque = true;
    const store = await ouvrir({ fs: bloque });
    assert.equal(store.etat().modeDegrade, true);
    assert.equal(await fs.readFile(chemin, 'utf8'), texte);
  });
});

test('fichier de version plus récente : lecture seule, registre non touché, fichier intact, aucune migration ni sauvegarde', async () => {
  const futur = { ...etatTest(2), schemaVersion: VERSION_COURANTE + 1, champFutur: { a: 1 } };
  const texte = texteEtat(futur);
  await avecFichier(texte, async (dossier, chemin, ouvrir) => {
    const store = await ouvrir();
    assert.equal(store.etat().lectureSeule, true);
    await assert.rejects(store.muter('x', () => {}), (e) => e.code === 'SCHEMA_PLUS_RECENT');
    assert.equal(await fs.readFile(chemin, 'utf8'), texte);
    assert.deepEqual(await sauvegardes(dossier), []);
  });
});

test('restauration d\'une sauvegarde version 1 : registre reconstruit, fichier écrit en version courante, sauvegarde d\'origine intacte', async () => {
  const SAUV = 'sauvegarde-2026-09-01_08h00m00s_manuelle.json';
  const v1 = texteEtat(etatV1(6));
  await avecFichier(texteEtat(etatTest(1)), async (dossier, chemin, ouvrir) => {
    await fs.mkdir(path.join(dossier, 'sauvegardes'), { recursive: true });
    await ecrireFichierTest(path.join(dossier, 'sauvegardes', SAUV), v1);
    const store = await ouvrir();
    const liste = await store.sauvegardes();
    const resume = liste.find((s) => s.nom === SAUV);
    assert.equal(resume.restaurable, true);
    assert.equal(resume.schemaVersion, 1);
    assert.equal(resume.nombrePatients, 3, 'registre reconstruit en mémoire : même nombre qu\'avant');
    const r = await store.restaurer(SAUV);
    assert.equal(r.nombrePrestations, 6);
    const disque = await lireJson(chemin);
    assert.equal(disque.schemaVersion, VERSION_COURANTE);
    assert.equal(disque.patients.length, 3);
    assert.deepEqual(compterIncoherencesPatients(disque), { orphelines: 0, copiesDivergentes: 0 });
    assert.equal(await fs.readFile(path.join(dossier, 'sauvegardes', SAUV), 'utf8'), v1, 'la sauvegarde reste en version 1');
  });
});

test('liste des sauvegardes : nombrePatients d\'une sauvegarde version 2 = taille de son registre (patients sans prestation compris)', async () => {
  const exemple = genererExemple();
  await avecFichier(texteEtat(etatTest(1)), async (dossier, chemin, ouvrir) => {
    await fs.mkdir(path.join(dossier, 'sauvegardes'), { recursive: true });
    await ecrireFichierTest(path.join(dossier, 'sauvegardes', 'sauvegarde-2026-09-01_08h00m00s_manuelle.json'), texteEtat(exemple));
    await ouvrir();
    const liste = await listerSauvegardesDetaillees({ dossier });
    const s = liste.find((x) => x.nom.includes('2026-09-01'));
    assert.equal(s.nombrePatients, exemple.patients.length);
    assert.equal(s.nombrePatients, 7, '6 patients actifs et 1 archivé sans prestation');
  });
});

test('annulation : la création d\'une prestation avec un nouveau patient retire aussi le patient', async () => {
  await avecFichier(texteEtat(etatTest(0)), async (dossier, chemin, ouvrir) => {
    const store = await ouvrir();
    const c = ctx();
    const r = await store.muter('creer-prestation', (copie) => creerPrestation(copie, { patient: { nom: 'Cygne', prenom: 'Léa' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500 }, c));
    assert.equal(store.lire().patients.length, 1);
    assert.equal(store.lire().prestations.length, 1);
    await store.annuler(r.annulation);
    assert.deepEqual(store.lire().patients, []);
    assert.equal(store.lire().prestations.length, 0);
    assert.deepEqual((await lireJson(chemin)).patients, []);
  });
});

test('annulation : création, renommage (propagé aux lignes), archivage et suppression d\'un patient reviennent à l\'état d\'avant', async () => {
  await avecFichier(texteEtat(etatTest(4)), async (dossier, chemin, ouvrir) => {
    const store = await ouvrir();
    const c = ctx();
    const avant = structuredClone(store.lire());

    const cree = await store.muter('creer-patient', (copie) => creerPatient(copie, { nom: 'Cygne', prenom: 'Léa' }, c));
    assert.equal(store.lire().patients.length, 4);
    await store.annuler(cree.annulation);
    assert.deepEqual(store.lire().patients, avant.patients);

    const id = avant.patients[0].id;
    const renomme = await store.muter('renommer-patient', (copie) => modifierPatient(copie, id, { nom: 'Renommé' }, c));
    assert.ok(renomme.resultat.lignesModifiees > 0);
    assert.ok(store.lire().prestations.some((l) => l.patient.nom === 'Renommé'));
    await store.annuler(renomme.annulation);
    assert.deepEqual(store.lire().patients, avant.patients);
    assert.deepEqual(store.lire().prestations, avant.prestations, 'lignes et modifieLe revenus');

    const archive = await store.muter('archiver-patient', (copie) => modifierPatient(copie, id, { actif: false }, c));
    assert.equal(store.lire().patients.find((p) => p.id === id).actif, false);
    await store.annuler(archive.annulation);
    assert.equal(store.lire().patients.find((p) => p.id === id).actif, true);

    const vide = await store.muter('creer-patient', (copie) => creerPatient(copie, { nom: 'Zèbre', prenom: 'Zoé' }, c));
    const supprime = await store.muter('supprimer-patient', (copie) => supprimerPatient(copie, vide.resultat.id));
    assert.equal(store.lire().patients.some((p) => p.id === vide.resultat.id), false);
    await store.annuler(supprime.annulation);
    assert.equal(store.lire().patients.some((p) => p.id === vide.resultat.id), true);
    assert.deepEqual(controlerStructure(await lireJson(chemin)), []);
  });
});

test('annulation : impossible si une autre écriture a eu lieu depuis (409), le registre n\'est pas touché', async () => {
  await avecFichier(texteEtat(etatTest(2)), async (dossier, chemin, ouvrir) => {
    const store = await ouvrir();
    const c = ctx();
    const premiere = await store.muter('creer-patient', (copie) => creerPatient(copie, { nom: 'Cygne', prenom: 'Léa' }, c));
    await store.muter('creer-patient', (copie) => creerPatient(copie, { nom: 'Zèbre', prenom: 'Zoé' }, c));
    await assert.rejects(store.annuler(premiere.annulation), (e) => e.status === 409 && e.code === 'ANNULATION_IMPOSSIBLE');
    assert.equal(store.lire().patients.length, 4);
  });
});

test('incohérences : ligne orpheline et copie divergente signalées (DONNEES_INCOHERENTES), rien n\'est corrigé ni réécrit, le fichier reste modifiable', async () => {
  const etat = etatTest(3);
  etat.patients = etat.patients.filter((p) => p.id !== 'patient-ours');
  const lapin = etat.patients.find((p) => p.id === 'patient-lapin');
  lapin.nom = 'Renommé';
  const texte = texteEtat(etat);
  assert.deepEqual(compterIncoherencesPatients(etat), { orphelines: 1, copiesDivergentes: 1 });
  await avecFichier(texte, async (dossier, chemin, ouvrir) => {
    const store = await ouvrir();
    assert.equal(store.etat().modeDegrade, false);
    const a = store.etat().avertissements.find((x) => x.code === 'DONNEES_INCOHERENTES');
    assert.ok(a, 'avertissement présent');
    assert.match(a.message, /absent du registre/);
    assert.match(a.message, /différent de celui du registre/);
    assert.ok(!a.message.includes('Lapin') && !a.message.includes('Renommé'), 'aucun nom dans le message');
    assert.equal(await fs.readFile(chemin, 'utf8'), texte, 'fichier non réécrit');
    await store.muter('x', (copie) => { copie.parametres.sauvegardesConservees = 40; });
    assert.equal(store.lire().parametres.sauvegardesConservees, 40);
  });
});

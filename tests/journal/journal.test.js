// Journal d'événements : format, niveaux, rotation à 1 Mo, repli sans plantage, aucune donnée de patient.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { creerJournal, decrireErreur, horodatageLocal, LIMITE_JOURNAL_OCTETS, NOM_JOURNAL } from '../../src/journal.js';
import { resoudreDossierJournal, ErreurConfig, RACINE_PROJET } from '../../src/config.js';
import { ouvrirStore } from '../../src/store/store.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { fsSauvegardesBloquees } from '../aides/fs-defaillant.js';
import { horlogeFixe } from '../aides/horloge.js';
import { creerDossierTemp, ecrireFichierTest, supprimerDossierTemp } from '../aides/temp.js';

const FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} (INFO|AVERT|ERREUR) +\S.*$/;
const lignes = async (chemin) => (await fs.readFile(chemin, 'utf8')).split('\n').filter(Boolean);

async function avecDossier(fn) {
  const dossier = await creerDossierTemp('journal');
  try {
    await fn(dossier);
  } finally {
    await supprimerDossierTemp(dossier);
  }
}

test('horodatage : ISO local avec décalage', () => {
  assert.match(horodatageLocal(new Date(2026, 9, 4, 14, 3, 5, 7)), /^2026-10-04T14:03:05\.007[+-]\d{2}:\d{2}$/);
});

test('format et niveaux : une ligne par événement, INFO / AVERT / ERREUR, dossier créé, retours à la ligne aplatis', () =>
  avecDossier(async (dossier) => {
    const cible = path.join(dossier, 'sous', 'logs'); // n'existe pas encore
    const j = creerJournal({ dossier: cible });
    assert.equal(j.chemin, path.join(cible, NOM_JOURNAL));
    j.info('Démarrage : test');
    j.avert('Attention');
    j.erreur('Ligne 1\nLigne 2\r\nLigne 3');
    const l = await lignes(j.chemin);
    assert.equal(l.length, 3);
    for (const ligne of l) assert.match(ligne, FORMAT);
    assert.match(l[0], / INFO +Démarrage : test$/);
    assert.match(l[1], / AVERT +Attention$/);
    assert.match(l[2], / ERREUR +Ligne 1 \| Ligne 2 \| Ligne 3$/);
  }));

test("rotation : au-delà de 1 Mo, le fichier devient .log.1 (l'ancien .1 est remplacé) et un nouveau fichier démarre", () =>
  avecDossier(async (dossier) => {
    const j = creerJournal({ dossier });
    const precedent = `${j.chemin}.1`;
    await ecrireFichierTest(precedent, 'TRES ANCIEN CONTENU\n');
    await ecrireFichierTest(j.chemin, 'x'.repeat(LIMITE_JOURNAL_OCTETS - 10) + '\n');
    j.info('première ligne après le seuil');
    const nouveau = await lignes(j.chemin);
    assert.equal(nouveau.length, 1);
    assert.match(nouveau[0], /première ligne après le seuil$/);
    const ancien = await fs.readFile(precedent, 'utf8');
    assert.ok(ancien.startsWith('xxxx'), "le .1 est l'ancien fichier courant");
    assert.ok(!ancien.includes('TRES ANCIEN'), "l'ancien .1 est remplacé");
    assert.deepEqual((await fs.readdir(dossier)).sort(), [NOM_JOURNAL, `${NOM_JOURNAL}.1`]);
    // Sous le seuil : pas de rotation.
    j.info('deuxième');
    assert.equal((await lignes(j.chemin)).length, 2);
  }));

test('rotation : boucle réaliste, jamais plus de deux fichiers, taille du fichier courant bornée', () =>
  avecDossier(async (dossier) => {
    const j = creerJournal({ dossier, limite: 2000 });
    for (let i = 0; i < 100; i++) j.info(`Événement numéro ${i} ${'.'.repeat(40)}`);
    assert.deepEqual((await fs.readdir(dossier)).sort(), [NOM_JOURNAL, `${NOM_JOURNAL}.1`]);
    assert.ok((await fs.stat(j.chemin)).size <= 2000);
  }));

test('dossier non inscriptible : aucune exception, repli sur la sortie de secours', () =>
  avecDossier(async (dossier) => {
    const fichierBloquant = path.join(dossier, 'pas-un-dossier');
    await ecrireFichierTest(fichierBloquant, 'x');
    const secours = [];
    const j = creerJournal({ dossier: path.join(fichierBloquant, 'logs'), secours: (t) => secours.push(t) });
    assert.doesNotThrow(() => j.erreur('Événement important'));
    assert.equal(secours.length, 1);
    assert.match(secours[0], /Événement important/);
    // Même une sortie de secours défaillante ne fait pas planter.
    const j2 = creerJournal({
      dossier: path.join(fichierBloquant, 'logs'),
      secours: () => {
        throw new Error('stderr fermé');
      },
    });
    assert.doesNotThrow(() => j2.info('rien'));
  }));

test('decrireErreur : nom, code et pile, jamais le message', () => {
  const err = Object.assign(new Error('contient Lapin Pierre'), { code: 'EXXX' });
  const texte = decrireErreur(err);
  assert.match(texte, /^Error \(EXXX\)/);
  assert.doesNotMatch(texte, /Lapin|Pierre/);
  assert.equal(decrireErreur('texte'), 'valeur non-erreur (string)');
});

test('ERGO_LOG_DIR : défaut logs/, .tmp/ admis, public/ src/ et le reste du projet refusés, dossier hors projet admis', () => {
  assert.equal(resoudreDossierJournal({}), path.join(RACINE_PROJET, 'logs'));
  assert.equal(resoudreDossierJournal({ ERGO_LOG_DIR: '  ' }), path.join(RACINE_PROJET, 'logs'));
  assert.equal(resoudreDossierJournal({ ERGO_LOG_DIR: '.tmp/x' }), path.join(RACINE_PROJET, '.tmp', 'x'));
  for (const refuse of ['public', 'src/http', 'docs', 'data', 'logs/../src']) {
    assert.throws(() => resoudreDossierJournal({ ERGO_LOG_DIR: refuse }), ErreurConfig, refuse);
  }
  assert.doesNotThrow(() => resoudreDossierJournal({ ERGO_LOG_DIR: path.resolve(RACINE_PROJET, '..', 'autre-dossier-logs') }));
});

// ------------------------------------------------ Événements du serveur et du stockage, sans donnée de patient

const NOMS = ['Lapin', 'Pierre', 'Graphisme', 'Zorglub'];
const saisie = () => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4567, motif: 'Graphisme Zorglub' });
const entetesEcriture = (s) => ({ Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json' });

test('événements : 5xx, conflit, échec de sauvegarde journalisés ; aucune ligne par requête normale ; aucun nom, motif ni montant', () =>
  avecDossier(async (dossierLog) => {
    const j = creerJournal({ dossier: dossierLog });
    const { fs: fsSimule, etat } = fsSauvegardesBloquees();
    const s = await demarrerServeurTest({
      evenements: j,
      fs: fsSimule,
      ajouterRoutes: (routeur) =>
        routeur.ajouter('GET', '/api/test-boom', async () => {
          throw new Error('Lapin Pierre 4567 Graphisme');
        }),
    });
    try {
      // Requêtes normales (2xx, 4xx) : aucune ligne.
      assert.equal((await s.requete({ chemin: '/api/sante' })).status, 200);
      assert.equal((await s.requete({ chemin: '/api/inconnue' })).status, 404);
      assert.equal((await s.requete({ chemin: '/api/prestations' })).status, 200);
      assert.equal(await fs.stat(j.chemin).then(() => true, () => false), false, 'aucune ligne pour les requêtes normales');

      // Échec de sauvegarde automatique (dossier sauvegardes/ inaccessible) pendant une saisie réelle.
      etat.bloque = true;
      const r = await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: entetesEcriture(s), corps: JSON.stringify(saisie()) });
      assert.equal(r.status, 201);
      etat.bloque = false;

      // Erreur 5xx dont le message contient des données : seul le nom d'erreur est écrit.
      assert.equal((await s.requete({ chemin: '/api/test-boom' })).status, 500);

      // Conflit : le fichier est modifié « ailleurs » puis une saisie est tentée.
      const chemin = path.join(s.dossier, 'suivi-facturation.json');
      await ecrireFichierTest(chemin, (await fs.readFile(chemin, 'utf8')) + '\n ');
      const c = await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: entetesEcriture(s), corps: JSON.stringify(saisie()) });
      assert.equal(c.status, 409);
    } finally {
      await s.arreter();
    }
    const l = await lignes(j.chemin);
    for (const ligne of l) assert.match(ligne, FORMAT);
    const texte = l.join('\n');
    assert.match(texte, /ERREUR +Échec de la sauvegarde/);
    assert.match(texte, /ERREUR +Erreur HTTP 500 \(ERREUR_INTERNE\) sur GET \/api\/test-boom/);
    assert.match(texte, /AVERT +Conflit de synchronisation détecté/);
    assert.doesNotMatch(texte, /sante|inconnue/, 'pas de ligne par requête normale');
    assert.ok(!/\b(200|201|404)\b/.test(texte.replace(/^\S+/gm, '')), 'pas de statut de requête normale');
    for (const interdit of [...NOMS, '4567', '45,67', '45.67']) assert.ok(!texte.includes(interdit), `« ${interdit} » ne doit pas figurer dans le journal`);
  }));

test('mode dégradé (fichier illisible contenant un nom) : journalisé sans le contenu du fichier', () =>
  avecDossier(async (dossierLog) => {
    const dossierDonnees = await creerDossierTemp('journal-donnees');
    try {
      await ecrireFichierTest(path.join(dossierDonnees, 'suivi-facturation.json'), '{"patient":"Lapin Pierre Graphisme", ');
      const j = creerJournal({ dossier: dossierLog });
      await ouvrirStore({ dossier: dossierDonnees, horloge: horlogeFixe('2026-10-02'), journal: j });
      const texte = (await lignes(j.chemin)).join('\n');
      assert.match(texte, /AVERT +Mode dégradé : fichier de données inutilisable \(raison : illisible\)/);
      for (const interdit of NOMS) assert.ok(!texte.includes(interdit));
    } finally {
      await supprimerDossierTemp(dossierDonnees);
    }
  }));

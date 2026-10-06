import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { creerDossierTemp, ecrireFichierTest, supprimerDossierTemp } from '../aides/temp.js';
import { horlogeFixe } from '../aides/horloge.js';
import { etatTest, texteEtat } from '../aides/donnees.js';
import { fsRenameRefuseSur, fsSauvegardesBloquees } from '../aides/fs-defaillant.js';
import { NOM_FICHIER_ACTIF, ouvrirStore } from '../../src/store/store.js';
import { analyserContenu, listerSauvegardesDetaillees, resumerSauvegarde } from '../../src/store/restauration.js';

const RAPIDE = { delais: [1, 1] };

/** `preparer(dossier, ecrire)` écrit les fichiers de départ ; `fn(dossier, store, chemin)` s'exécute avec le store ouvert. */
async function avecStore(preparer, fn, options = {}) {
  const dossier = await creerDossierTemp('resto');
  try {
    const chemin = path.join(dossier, NOM_FICHIER_ACTIF);
    await fs.mkdir(path.join(dossier, 'sauvegardes'), { recursive: true });
    await preparer({
      dossier,
      chemin,
      actif: (contenu) => ecrireFichierTest(chemin, contenu),
      sauvegarde: (nom, contenu) => ecrireFichierTest(path.join(dossier, 'sauvegardes', nom), contenu),
    });
    const store = await ouvrirStore({ dossier, horloge: options.horloge ?? horlogeFixe('2026-10-02'), optionsAtomique: RAPIDE, ...options.store });
    await fn(dossier, store, chemin);
  } finally {
    await supprimerDossierTemp(dossier);
  }
}

const SAUV = 'sauvegarde-2026-09-20_10h00m00s_quotidienne.json';
const noms = async (d) => (await fs.readdir(path.join(d, 'sauvegardes'))).sort();
const lireJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
const echoue = (promesse, code, status) =>
  assert.rejects(promesse, (err) => {
    assert.equal(err.code, code);
    if (status) assert.equal(err.status, status);
    return true;
  });
const fichiersTemporaires = async (d) => (await fs.readdir(d)).filter((n) => n.includes('.tmp-'));

// --- Analyse du contenu d'une sauvegarde ---

test('analyserContenu : valide, illisible, mauvais format, trop récente, incohérente ; jamais de donnée dans les messages', () => {
  assert.equal(analyserContenu(Buffer.from(texteEtat(etatTest(3)))).ok, true);
  assert.equal(analyserContenu(Buffer.from('﻿' + texteEtat(etatTest(1)))).ok, true, 'BOM accepté');
  const ko = (texte) => analyserContenu(Buffer.from(texte));
  assert.equal(ko('{ ceci n\'est pas du JSON').ok, false);
  assert.equal(ko('').ok, false);
  assert.equal(ko('[]').ok, false);
  assert.equal(ko(JSON.stringify({ format: 'autre', schemaVersion: 1 })).code, 'illisible');
  const futur = etatTest(1);
  futur.schemaVersion = 99;
  assert.equal(ko(JSON.stringify(futur)).code, 'incompatible');
  const doublon = etatTest(2);
  doublon.prestations[1].id = doublon.prestations[0].id;
  assert.equal(ko(JSON.stringify(doublon)).code, 'illisible');
  const centimesFlottants = etatTest(1);
  centimesFlottants.prestations[0].montantCentimes = 45.5;
  assert.equal(ko(JSON.stringify(centimesFlottants)).ok, false);
  for (const texte of ["{ pas du json Lapin", JSON.stringify(doublon)]) assert.doesNotMatch(ko(texte).message, /Lapin|Pierre/);
});

test('resumerSauvegarde : nombre de prestations, de patients, période et révision', () => {
  const etat = etatTest(7, { revision: 12 });
  const r = resumerSauvegarde(Buffer.from(texteEtat(etat)));
  assert.equal(r.lisible, true);
  assert.equal(r.nombrePrestations, 7);
  assert.equal(r.nombrePatients, 3);
  assert.equal(r.revision, 12);
  assert.equal(r.premiereDate, '2026-09-01');
  assert.equal(r.derniereDate, '2026-09-07');
  const vide = resumerSauvegarde(Buffer.from(texteEtat(etatTest(0))));
  assert.equal(vide.nombrePrestations, 0);
  assert.equal(vide.premiereDate, null);
  assert.equal(resumerSauvegarde(Buffer.from('xx')).lisible, false);
});

// --- Restauration nominale ---

test('restauration : état actuel sauvegardé AVANT (octet pour octet), puis remplacé ; l\'état en mémoire, le disque et la révision suivent', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2, { revision: 10 })));
      await sauvegarde(SAUV, texteEtat(etatTest(5, { revision: 3 })));
    },
    async (dossier, store, chemin) => {
      const avant = await fs.readFile(chemin);
      const r = await store.restaurer(SAUV);
      assert.equal(r.restauree, SAUV);
      assert.equal(r.nombrePrestations, 5);
      assert.equal(r.annulable, true);
      assert.match(r.sauvegardeAvant, /_avant-restauration\.json$/);
      assert.deepEqual(await fs.readFile(path.join(dossier, 'sauvegardes', r.sauvegardeAvant)), avant, "copie brute de l'état d'avant");

      assert.equal(store.lire().prestations.length, 5);
      const surDisque = await lireJson(chemin);
      assert.equal(surDisque.prestations.length, 5);
      assert.equal(surDisque.revision, 11, 'la révision ne recule jamais : max(sauvegarde, actuelle) + 1');
      assert.deepEqual((await fichiersTemporaires(dossier)), []);
      assert.equal(store.etat().conflit, null);
      // L'empreinte est à jour : une modification ensuite ne déclenche pas de faux conflit.
      await store.muter('t', (copie) => { copie.parametres.dernierModePaiement = 'cheque'; });
      assert.equal(store.etat().conflit, null);
      assert.equal((await lireJson(chemin)).revision, 12);
    },
  ));

test('restauration : annulable en restaurant la sauvegarde « avant-restauration »', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2)));
      await sauvegarde(SAUV, texteEtat(etatTest(6)));
    },
    async (dossier, store) => {
      const r = await store.restaurer(SAUV);
      assert.equal(store.lire().prestations.length, 6);
      const retour = await store.restaurer(r.sauvegardeAvant);
      assert.equal(retour.nombrePrestations, 2);
      assert.equal(store.lire().prestations.length, 2);
    },
  ));

test('restauration : la sauvegarde choisie reste intacte (copie, pas déplacement)', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(1)));
      await sauvegarde(SAUV, texteEtat(etatTest(4)));
    },
    async (dossier, store) => {
      const octets = await fs.readFile(path.join(dossier, 'sauvegardes', SAUV));
      await store.restaurer(SAUV);
      assert.deepEqual(await fs.readFile(path.join(dossier, 'sauvegardes', SAUV)), octets);
    },
  ));

// --- Refus : rien n'est touché ---

test('sauvegarde corrompue : refus 422, fichier actuel et état intacts, aucune sauvegarde « avant-restauration » créée', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2)));
      await sauvegarde(SAUV, '{"format":"suivi-facturation","schemaVersion":1,"prestations":[ {"id"');
    },
    async (dossier, store, chemin) => {
      const avant = await fs.readFile(chemin);
      const listeAvant = await noms(dossier);
      await echoue(store.restaurer(SAUV), 'SAUVEGARDE_INCOMPATIBLE', 422);
      assert.deepEqual(await fs.readFile(chemin), avant);
      assert.equal(store.lire().prestations.length, 2);
      assert.deepEqual(await noms(dossier), listeAvant, 'aucune sauvegarde de sécurité inutile');
      assert.equal(store.etat().modeDegrade, false);
    },
  ));

test('sauvegardes incompatibles (version plus récente, structure incohérente, mauvais format) : refusées, état intact', () => {
  const futur = etatTest(1);
  futur.schemaVersion = 99;
  const doublon = etatTest(2);
  doublon.prestations[1].id = doublon.prestations[0].id;
  const cas = {
    'sauvegarde-2026-09-01_10h00m00s_manuelle.json': JSON.stringify(futur),
    'sauvegarde-2026-09-02_10h00m00s_manuelle.json': JSON.stringify(doublon),
    'sauvegarde-2026-09-03_10h00m00s_manuelle.json': JSON.stringify({ format: 'autre' }),
    'sauvegarde-2026-09-04_10h00m00s_manuelle.json': '',
  };
  return avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2)));
      for (const [nom, contenu] of Object.entries(cas)) await sauvegarde(nom, contenu);
    },
    async (dossier, store, chemin) => {
      const avant = await fs.readFile(chemin);
      for (const nom of Object.keys(cas)) await echoue(store.restaurer(nom), 'SAUVEGARDE_INCOMPATIBLE', 422);
      assert.deepEqual(await fs.readFile(chemin), avant);
      assert.equal(store.lire().prestations.length, 2);
      assert.equal((await noms(dossier)).filter((n) => n.includes('avant-restauration')).length, 0);
    },
  );
});

test('nom de sauvegarde : seul le motif exact est accepté (jamais un chemin, une archive ou le fichier actif)', () =>
  avecStore(
    async ({ actif, dossier }) => {
      await actif(texteEtat(etatTest(2)));
      await ecrireFichierTest(path.join(dossier, 'archive-2025.json'), JSON.stringify({ format: 'suivi-facturation-archive', prestations: [] }));
    },
    async (dossier, store, chemin) => {
      const avant = await fs.readFile(chemin);
      for (const nom of ['../suivi-facturation.json', '..\\suivi-facturation.json', 'suivi-facturation.json', 'archive-2025.json', 'sauvegarde-x.json', 'sauvegarde-2026-09-20_10h00m00s_inconnue.json', '', 'sauvegardes/' + SAUV]) {
        await echoue(store.restaurer(nom), 'INTROUVABLE', 404);
      }
      await echoue(store.restaurer(SAUV), 'INTROUVABLE', 404); // nom valide mais fichier absent
      assert.deepEqual(await fs.readFile(chemin), avant);
    },
  ));

// --- Échecs en cours de route ---

test("échec en cours d'écriture (fichier actif verrouillé) : 503, fichier actuel et mémoire intacts, temporaire supprimé, sauvegarde de sécurité conservée ; puis succès quand le verrou tombe", async () => {
  const { fs: fsSimule, etat } = fsRenameRefuseSur(/suivi-facturation\.json$/);
  etat.bloque = false; // le démarrage (fichier existant) n'écrit pas ; on bloque après l'ouverture
  await avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2)));
      await sauvegarde(SAUV, texteEtat(etatTest(5)));
    },
    async (dossier, store, chemin) => {
      const avant = await fs.readFile(chemin);
      etat.bloque = true;
      await echoue(store.restaurer(SAUV), 'FICHIER_VERROUILLE', 503);
      assert.ok(etat.refus >= 2, 'plusieurs tentatives avant d\'abandonner');
      assert.deepEqual(await fs.readFile(chemin), avant, 'le fichier actuel est intact');
      assert.equal(store.lire().prestations.length, 2, "l'état en mémoire est intact");
      assert.deepEqual(await fichiersTemporaires(dossier), [], 'aucun fichier temporaire abandonné');
      assert.equal((await noms(dossier)).filter((n) => n.includes('avant-restauration')).length, 1, 'la sauvegarde de sécurité existe');
      // La file n'est pas bloquée : une fois le verrou tombé, la restauration suivante réussit.
      etat.bloque = false;
      const r = await store.restaurer(SAUV);
      assert.equal(r.nombrePrestations, 5);
      assert.equal((await lireJson(chemin)).prestations.length, 5);
    },
    { store: { fs: fsSimule } },
  );
});

test("sauvegarde de sécurité impossible : restauration annulée (503 SAUVEGARDE_ECHOUEE), rien n'est modifié", async () => {
  const { fs: fsSimule, etat } = fsSauvegardesBloquees();
  await avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2)));
      await sauvegarde(SAUV, texteEtat(etatTest(5)));
    },
    async (dossier, store, chemin) => {
      const avant = await fs.readFile(chemin);
      etat.bloque = true;
      await echoue(store.restaurer(SAUV), 'SAUVEGARDE_ECHOUEE', 503);
      assert.deepEqual(await fs.readFile(chemin), avant);
      assert.equal(store.lire().prestations.length, 2);
    },
    { store: { fs: fsSimule } },
  );
});

// --- Modes dégradés ---

test('fichier actuel illisible : restauration possible ; copie brute du fichier abîmé conservée ; sortie du mode dégradé ; non annulable', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif('{"format":"suivi-facturation","schemaVersion":1, abîmé Lapin');
      await sauvegarde(SAUV, texteEtat(etatTest(4)));
    },
    async (dossier, store, chemin) => {
      assert.equal(store.etat().modeDegrade, true);
      assert.throws(() => store.lire(), (e) => e.code === 'DONNEES_ILLISIBLES');
      await echoue(store.muter('t', () => {}), 'DONNEES_ILLISIBLES', 503);
      const abime = await fs.readFile(chemin);

      const r = await store.restaurer(SAUV);
      assert.equal(r.annulable, false, 'on ne revient pas à un fichier illisible');
      assert.deepEqual(await fs.readFile(path.join(dossier, 'sauvegardes', r.sauvegardeAvant)), abime, 'copie brute du fichier abîmé');
      assert.equal(store.etat().modeDegrade, false);
      assert.equal(store.etat().erreur, null);
      assert.equal(store.lire().prestations.length, 4);
      assert.equal((await lireJson(chemin)).prestations.length, 4);
      await store.muter('t', (copie) => { copie.parametres.dernierModePaiement = 'virement'; }); // l'application refonctionne
    },
  ));

test('fichier actuel illisible ET sauvegarde illisible : refus, le fichier abîmé n\'est pas écrasé', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif('abîmé');
      await sauvegarde(SAUV, 'abîmée aussi');
    },
    async (dossier, store, chemin) => {
      await echoue(store.restaurer(SAUV), 'SAUVEGARDE_INCOMPATIBLE', 422);
      assert.equal(await fs.readFile(chemin, 'utf8'), 'abîmé');
      assert.equal(store.etat().modeDegrade, true);
    },
  ));

test('fichier absent (mode « absent » : des sauvegardes existent) : restauration sans sauvegarde de sécurité inutile', () =>
  avecStore(
    async ({ sauvegarde }) => {
      await sauvegarde(SAUV, texteEtat(etatTest(3)));
    },
    async (dossier, store, chemin) => {
      assert.equal(store.etat().modeDegrade, true);
      assert.equal(store.etat().erreur.raison, 'absent');
      await assert.rejects(fs.stat(chemin), { code: 'ENOENT' });
      const r = await store.restaurer(SAUV);
      assert.equal(r.sauvegardeAvant, null);
      assert.equal(r.annulable, false);
      assert.equal(store.etat().modeDegrade, false);
      assert.equal((await lireJson(chemin)).prestations.length, 3);
      assert.equal((await noms(dossier)).filter((n) => n.includes('avant-restauration')).length, 0);
    },
  ));

test('conflit de synchronisation : restaurer la copie « disque » ou « application » lève le conflit, l\'autre version reste en sauvegarde', async () => {
  for (const choix of ['disque', 'application']) {
    await avecStore(
      async ({ actif }) => {
        await actif(texteEtat(etatTest(2, { revision: 5 })));
      },
      async (dossier, store, chemin) => {
        // Le client de synchro remplace le fichier par une autre version pendant que l'application tourne.
        await ecrireFichierTest(chemin, texteEtat(etatTest(7, { revision: 9 })));
        await store.verifierFichier();
        const conflit = store.etat().conflit;
        assert.equal(conflit.type, 'modifie');
        assert.equal(conflit.disque.nombrePrestations, 7);
        assert.equal(conflit.application.nombrePrestations, 2);
        await echoue(store.muter('t', () => {}), 'CONFLIT_FICHIER', 409);

        const r = await store.restaurer(conflit.sauvegardes[choix]);
        assert.equal(store.etat().conflit, null);
        assert.equal(r.nombrePrestations, choix === 'disque' ? 7 : 2);
        assert.equal(store.lire().prestations.length, choix === 'disque' ? 7 : 2);
        assert.equal((await lireJson(chemin)).prestations.length, choix === 'disque' ? 7 : 2);
        await store.muter('t', (copie) => { copie.parametres.dernierModePaiement = 'cheque'; }); // plus bloqué
        const restantes = (await noms(dossier)).filter((n) => /conflit-/.test(n));
        assert.equal(restantes.length, 2, 'les deux versions du conflit restent sauvegardées');
      },
    );
  }
});

test('conflit « fichier disparu » : la version de l\'application peut être rétablie', () =>
  avecStore(
    async ({ actif }) => {
      await actif(texteEtat(etatTest(3)));
    },
    async (dossier, store, chemin) => {
      await fs.unlink(chemin);
      await store.verifierFichier();
      assert.equal(store.etat().conflit.type, 'disparu');
      assert.equal(store.etat().conflit.sauvegardes.disque, null);
      await store.restaurer(store.etat().conflit.sauvegardes.application);
      assert.equal(store.etat().conflit, null);
      assert.equal((await lireJson(chemin)).prestations.length, 3);
    },
  ));

test('lecture seule (schéma plus récent) : une sauvegarde compatible permet de sortir de la lecture seule', () => {
  const futur = etatTest(1);
  futur.schemaVersion = 99;
  return avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(futur));
      await sauvegarde(SAUV, texteEtat(etatTest(3)));
    },
    async (dossier, store) => {
      assert.equal(store.etat().lectureSeule, true);
      const r = await store.restaurer(SAUV);
      assert.equal(r.annulable, false, 'le fichier de la version future ne serait pas restaurable ici');
      assert.equal(store.etat().lectureSeule, false);
      assert.equal(store.lire().prestations.length, 3);
    },
  );
});

// --- Liste, sauvegarde manuelle ---

test('liste détaillée : lisible / restaurable, prestations, taille ; une sauvegarde abîmée n\'empêche pas la liste et ne fuit aucune donnée', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(1)));
      await sauvegarde('sauvegarde-2026-09-01_10h00m00s_manuelle.json', texteEtat(etatTest(4)));
      await sauvegarde('sauvegarde-2026-09-02_10h00m00s_manuelle.json', '{ abîmée Lapin');
      await sauvegarde('autre-fichier.json', '{}');
    },
    async (dossier, store) => {
      const liste = await store.sauvegardes();
      const par = Object.fromEntries(liste.map((s) => [s.jour, s]));
      assert.equal(liste.some((s) => s.nom === 'autre-fichier.json'), false, 'fichiers étrangers ignorés');
      assert.equal(par['2026-09-01'].restaurable, true);
      assert.equal(par['2026-09-01'].nombrePrestations, 4);
      assert.ok(par['2026-09-01'].tailleOctets > 0);
      assert.equal(par['2026-09-02'].restaurable, false);
      assert.equal(par['2026-09-02'].lisible, false);
      assert.match(par['2026-09-02'].raisonRefus, /abîmée|pas lisible/);
      assert.ok(!JSON.stringify(par['2026-09-02']).includes('Lapin'));
      assert.deepEqual((await listerSauvegardesDetaillees({ dossier })).map((s) => s.nom), liste.map((s) => s.nom));
    },
  ));

test('sauvegarde manuelle : copie octet pour octet du fichier actif ; refusée en mode dégradé', async () => {
  await avecStore(
    async ({ actif }) => {
      await actif(texteEtat(etatTest(2)));
    },
    async (dossier, store, chemin) => {
      const { nom } = await store.sauvegarderMaintenant();
      assert.match(nom, /_manuelle\.json$/);
      assert.deepEqual(await fs.readFile(path.join(dossier, 'sauvegardes', nom)), await fs.readFile(chemin));
    },
  );
  await avecStore(
    async ({ actif }) => {
      await actif('abîmé');
    },
    async (dossier, store) => {
      await echoue(store.sauvegarderMaintenant(), 'DONNEES_ILLISIBLES', 503);
    },
  );
});

test("/api/etat côté store : nombre de prestations et de sauvegardes conservées exposés (Paramètres)", () =>
  avecStore(
    async ({ actif }) => {
      await actif(texteEtat(etatTest(4)));
    },
    async (dossier, store) => {
      const e = store.etat();
      assert.equal(e.nombrePrestations, 4);
      assert.equal(e.sauvegardesConservees, 30);
    },
  ));

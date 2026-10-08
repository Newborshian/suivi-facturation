// Relecture du fichier en mode dégradé, aucune rotation destructive pendant une restauration,
// copie de la version en mémoire, conservation par âge des copies de conflit, conflit non résolu au redémarrage,
// « repartir d'un fichier vide », minimum de 7 sauvegardes. Données factices uniquement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { creerDossierTemp, ecrireFichierTest, supprimerDossierTemp } from '../aides/temp.js';
import { horlogeFixe } from '../aides/horloge.js';
import { etatTest, ligneTest, texteEtat } from '../aides/donnees.js';
import { fsSauvegardesBloquees } from '../aides/fs-defaillant.js';
import { MIGRATIONS, VERSION_COURANTE } from '../../src/domain/schema.js';
import { NOM_FICHIER_ACTIF, ouvrirStore } from '../../src/store/store.js';
import { appliquerRotation } from '../../src/store/sauvegardes.js';

const RAPIDE = { delais: [1, 1] };
const SAUV = 'sauvegarde-2026-09-20_10h00m00s_quotidienne.json';
const pause = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const lireJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
const noms = async (d) => (await fs.readdir(path.join(d, 'sauvegardes'))).sort();
const echoue = (promesse, code, status) =>
  assert.rejects(promesse, (err) => {
    assert.equal(err.code, code);
    if (status) assert.equal(err.status, status);
    return true;
  });

/** `preparer({ dossier, chemin, actif, sauvegarde })` écrit les fichiers de départ ; `fn(dossier, store, chemin, rouvrir)` s'exécute store ouvert. */
async function avecStore(preparer, fn, { horloge = horlogeFixe('2026-10-02'), store: optionsStore = {} } = {}) {
  const dossier = await creerDossierTemp('restauration-rotation');
  try {
    const chemin = path.join(dossier, NOM_FICHIER_ACTIF);
    await fs.mkdir(path.join(dossier, 'sauvegardes'), { recursive: true });
    await preparer({
      dossier,
      chemin,
      actif: (contenu) => ecrireFichierTest(chemin, contenu),
      sauvegarde: (nom, contenu) => ecrireFichierTest(path.join(dossier, 'sauvegardes', nom), contenu),
    });
    const rouvrir = (options = {}) => ouvrirStore({ dossier, horloge, optionsAtomique: RAPIDE, ...optionsStore, ...options });
    await fn(dossier, await rouvrir(), chemin, rouvrir);
  } finally {
    await supprimerDossierTemp(dossier);
  }
}

/** n noms de sauvegardes quotidiennes distincts (mai à juin 2026), tous antérieurs à SAUV. */
const nomsQuotidiens = (n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(2026, 4, 1 + i);
    const p = (x) => String(x).padStart(2, '0');
    return `sauvegarde-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_08h00m00s_quotidienne.json`;
  });

async function preparerHistorique({ actif, sauvegarde }, contenuActif, n = 40) {
  await actif(contenuActif);
  await sauvegarde(SAUV, texteEtat(etatTest(5)));
  for (const nom of nomsQuotidiens(n)) await sauvegarde(nom, texteEtat(etatTest(1)));
}

// ============================================ Point 1 : le fichier revient pendant le mode dégradé

test('fichier absent au démarrage puis revenu : la relecture sort du mode dégradé, sans rien créer ni écraser', () =>
  avecStore(
    async ({ sauvegarde }) => sauvegarde(SAUV, texteEtat(etatTest(2))),
    async (dossier, store, chemin) => {
      assert.equal(store.etat().erreur.raison, 'absent');
      await store.verifierFichier();
      assert.equal(store.etat().modeDegrade, true, 'toujours absent');
      await assert.rejects(fs.stat(chemin), { code: 'ENOENT' }, 'rien n\'est créé pendant la relecture');

      const revenu = texteEtat(etatTest(5, { revision: 8 }));
      await ecrireFichierTest(chemin, revenu); // la synchronisation se termine
      await store.verifierFichier(); // ce que fait GET /api/etat
      assert.equal(store.etat().modeDegrade, false);
      assert.equal(store.etat().erreur, null);
      assert.equal(store.lire().prestations.length, 5, 'le fichier revenu est repris tel quel');
      assert.equal(await fs.readFile(chemin, 'utf8'), revenu, 'aucune écriture sur le fichier revenu');
      assert.equal((await noms(dossier)).filter((n) => n.includes('avant-restauration')).length, 0);
      await store.muter('t', (copie) => { copie.parametres.dernierModePaiement = 'cheque'; }); // l'application refonctionne
    },
  ));

test('fichier illisible au démarrage (lu pendant la synchronisation) puis complet : la relecture le reprend', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(4)).slice(0, 300)); // tronqué
      await sauvegarde(SAUV, texteEtat(etatTest(2)));
    },
    async (dossier, store, chemin) => {
      assert.equal(store.etat().erreur.raison, 'illisible');
      await store.verifierFichier();
      assert.equal(store.etat().modeDegrade, true, 'toujours tronqué');
      await ecrireFichierTest(chemin, texteEtat(etatTest(4)));
      await store.verifierFichier();
      assert.equal(store.etat().modeDegrade, false);
      assert.equal(store.lire().prestations.length, 4);
    },
  ));

test("restauration décidée depuis l'écran dégradé alors que le fichier est revenu : refusée (409 FICHIER_REVENU), le fichier revenu n'est pas écrasé", () =>
  avecStore(
    async ({ sauvegarde }) => sauvegarde(SAUV, texteEtat(etatTest(2))),
    async (dossier, store, chemin) => {
      assert.equal(store.etat().modeDegrade, true);
      const revenu = texteEtat(etatTest(5, { revision: 8 }));
      await ecrireFichierTest(chemin, revenu); // revenu entre l'affichage du choix et le clic, aucune relecture entre-temps
      await echoue(store.restaurer(SAUV, { depuisModeDegrade: true }), 'FICHIER_REVENU', 409);
      assert.equal(await fs.readFile(chemin, 'utf8'), revenu, 'fichier intact');
      assert.equal(store.etat().modeDegrade, false, "l'application a repris le fichier");
      assert.equal(store.lire().prestations.length, 5);
      assert.equal((await noms(dossier)).filter((n) => n.includes('avant-restauration')).length, 0, 'aucune opération entamée');
      // Sans la décision prise depuis l'écran dégradé (Paramètres, par exemple), la restauration normale reste possible.
      const r = await store.restaurer(SAUV);
      assert.equal(r.nombrePrestations, 2);
      assert.deepEqual(await fs.readFile(path.join(dossier, 'sauvegardes', r.sauvegardeAvant), 'utf8'), revenu, 'le fichier revenu est copié avant');
    },
  ));

// ============================================ Point 2 : jamais de rotation destructive pendant une restauration

test('rotation : réglage courant 365, restauration d\'une sauvegarde réglée sur 30 : aucune sauvegarde quotidienne supprimée, le réglage 365 est conservé', () => {
  const actif = etatTest(2);
  actif.parametres.sauvegardesConservees = 365;
  return avecStore(
    async (aides) => preparerHistorique(aides, texteEtat(actif)),
    async (dossier, store, chemin) => {
      const avant = await noms(dossier);
      assert.ok(avant.filter((n) => n.includes('quotidienne')).length >= 41);
      assert.equal(store.etat().sauvegardesConservees, 365);

      const r = await store.restaurer(SAUV); // la sauvegarde choisie est réglée sur 30
      const apres = await noms(dossier);
      for (const nom of avant) assert.ok(apres.includes(nom), `${nom} supprimée par la restauration`);
      assert.equal(r.nombrePrestations, 5);
      assert.equal((await lireJson(chemin)).parametres.sauvegardesConservees, 365, 'le réglage courant prime sur celui de la sauvegarde');
      assert.equal(store.etat().sauvegardesConservees, 365);

      await store.sauvegarderMaintenant(); // la rotation suivante utilise le réglage courant, pas 30
      for (const nom of avant) assert.ok((await noms(dossier)).includes(nom), `${nom} supprimée après la restauration`);
    },
  );
});

test('rotation : mode dégradé (fichier incohérent mais réglé sur 120), restauration : rien n\'est supprimé et le réglage 120 est retrouvé', () => {
  const incoherent = etatTest(2);
  incoherent.parametres.sauvegardesConservees = 120;
  incoherent.prestations[1].id = incoherent.prestations[0].id; // structure invalide : mode dégradé
  return avecStore(
    async (aides) => preparerHistorique(aides, texteEtat(incoherent)),
    async (dossier, store, chemin) => {
      assert.equal(store.etat().modeDegrade, true);
      assert.equal(store.etat().sauvegardesConservees, null);
      const avant = await noms(dossier);
      const r = await store.restaurer(SAUV);
      const apres = await noms(dossier);
      for (const nom of avant) assert.ok(apres.includes(nom), `${nom} supprimée en mode dégradé`);
      assert.match(r.sauvegardeAvant, /avant-restauration/);
      assert.equal((await lireJson(chemin)).parametres.sauvegardesConservees, 120, 'le réglage lu dans le fichier abîmé est conservé');
    },
  );
});

test('rotation : mode dégradé avec un fichier totalement illisible (réglage inconnu) : aucune sauvegarde supprimée pendant la restauration', () =>
  avecStore(
    async (aides) => preparerHistorique(aides, '{ abîmé'),
    async (dossier, store) => {
      const avant = await noms(dossier);
      await store.restaurer(SAUV);
      const apres = await noms(dossier);
      for (const nom of avant) assert.ok(apres.includes(nom), `${nom} supprimée`);
      assert.equal(apres.length, avant.length + 1, 'seule la copie du fichier abîmé s\'ajoute');
    },
  ));

test('réglage inférieur à 7 dans un fichier modifié à la main : la limite appliquée est ramenée à 7 (jamais 1 ni 3)', () => {
  const peu = etatTest(1);
  peu.parametres.sauvegardesConservees = 3;
  return avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(peu));
      for (const nom of nomsQuotidiens(6)) await sauvegarde(nom, texteEtat(etatTest(1)));
    },
    async (dossier, store) => {
      assert.equal(store.etat().sauvegardesConservees, 7);
      await store.sauvegarderMaintenant();
      const quotidiennes = (await noms(dossier)).filter((n) => /_(demarrage|quotidienne|manuelle)\.json$/.test(n));
      assert.equal(quotidiennes.length, 8, '6 jours précédents + démarrage + manuelle du jour : 7 jours conservés, pas 3');
      assert.equal(new Set(quotidiennes.map((n) => n.slice(11, 21))).size, 7);
    },
  );
});

// ============================================ Point 3 : la version en mémoire est copiée aussi

test('restauration alors que le disque a changé sans détection : la version en mémoire est copiée à part avant d\'être remplacée', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2, { revision: 5 })));
      await sauvegarde(SAUV, texteEtat(etatTest(6)));
    },
    async (dossier, store, chemin) => {
      await store.muter('ajout', (copie) => { copie.prestations.push(ligneTest(50)); }); // saisie de l'application : 3 prestations en mémoire
      await ecrireFichierTest(chemin, texteEtat(etatTest(9, { revision: 20 }))); // la synchro remplace le fichier, rien n'a encore été détecté
      const r = await store.restaurer(SAUV);

      assert.ok(r.sauvegardeApplication, 'copie de la version en mémoire annoncée');
      const memoire = await lireJson(path.join(dossier, 'sauvegardes', r.sauvegardeApplication));
      assert.equal(memoire.prestations.length, 3, 'les dernières saisies sont dans la copie');
      assert.ok(memoire.prestations.some((l) => l.id === 'ligne-50'));
      const disque = await lireJson(path.join(dossier, 'sauvegardes', r.sauvegardeAvant));
      assert.equal(disque.prestations.length, 9, 'la version du disque est copiée aussi');
      assert.equal((await lireJson(chemin)).prestations.length, 6, 'la sauvegarde choisie est en place');
      assert.equal(store.etat().conflit, null, 'le conflit est levé par la restauration');
    },
  ));

test('restauration sans changement du disque : pas de copie superflue de la version en mémoire', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2)));
      await sauvegarde(SAUV, texteEtat(etatTest(6)));
    },
    async (dossier, store) => {
      const r = await store.restaurer(SAUV);
      assert.equal(r.sauvegardeApplication, null);
      assert.equal((await noms(dossier)).filter((n) => n.includes('conflit-')).length, 0);
    },
  ));

test('copie de la version en mémoire impossible : restauration annulée avec un message honnête, rien n\'est modifié ; puis succès quand le dossier redevient accessible', async () => {
  const { fs: fsSimule, etat } = fsSauvegardesBloquees();
  await avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2, { revision: 5 })));
      await sauvegarde(SAUV, texteEtat(etatTest(6)));
    },
    async (dossier, store, chemin) => {
      etat.bloque = true; // le dossier sauvegardes/ devient inaccessible
      const externe = texteEtat(etatTest(7, { revision: 9 }));
      await ecrireFichierTest(chemin, externe);
      await store.verifierFichier(); // conflit détecté, mais aucune des deux copies n'a pu être créée
      const conflit = store.etat().conflit;
      assert.equal(conflit.sauvegardes.application, null);
      assert.equal(conflit.sauvegardes.disque, null);

      await assert.rejects(store.restaurer(SAUV), (err) => {
        assert.equal(err.code, 'SAUVEGARDE_ECHOUEE');
        assert.equal(err.status, 503);
        assert.match(err.message, /version de l'application/);
        assert.match(err.message, /annulée/);
        return true;
      });
      assert.equal(await fs.readFile(chemin, 'utf8'), externe, 'le fichier du disque est intact');
      assert.ok(store.etat().conflit, 'le conflit reste déclaré : rien n\'a été résolu');
      assert.equal((await noms(dossier)).filter((n) => n.includes('avant-restauration')).length, 0);

      etat.bloque = false;
      const r = await store.restaurer(SAUV);
      assert.ok(r.sauvegardeApplication, 'la copie manquante est créée au moment de la restauration');
      assert.equal((await lireJson(path.join(dossier, 'sauvegardes', r.sauvegardeApplication))).prestations.length, 2, 'contenu = version en mémoire');
      assert.equal((await lireJson(path.join(dossier, 'sauvegardes', r.sauvegardeAvant))).prestations.length, 7, 'contenu = version du disque');
      assert.equal(store.etat().conflit, null);
    },
    { store: { fs: fsSimule } },
  );
});

test('sauvegarde manuelle alors que le fichier a disparu : le message dit que le fichier est absent (et non « utilisé par un autre programme »)', () =>
  avecStore(
    async ({ actif }) => actif(texteEtat(etatTest(2))),
    async (dossier, store, chemin) => {
      await fs.unlink(chemin);
      await store.verifierFichier();
      assert.equal(store.etat().conflit.type, 'disparu');
      await assert.rejects(store.sauvegarderMaintenant(), (err) => {
        assert.equal(err.code, 'FICHIER_ABSENT');
        assert.doesNotMatch(err.message, /autre programme/);
        assert.match(err.message, /n'est plus dans son dossier/);
        return true;
      });
    },
  ));

// ============================================ Point 4 : conservation par âge, rappel au démarrage

test('rotation par âge : copies de conflit et « avant restauration » gardées 90 jours (hors limite de 30), au-delà supprimées', async () => {
  const dossier = await creerDossierTemp('age');
  try {
    await fs.mkdir(path.join(dossier, 'sauvegardes'));
    const ecrire = (nom) => ecrireFichierTest(path.join(dossier, 'sauvegardes', nom), '{}');
    const maintenant = new Date(2026, 9, 2, 12, 0, 0);
    const vieux = ['sauvegarde-2026-06-20_09h00m00s_conflit-memoire.json', 'sauvegarde-2026-06-20_09h00m00s_conflit-disque.json', 'sauvegarde-2026-06-01_09h00m00s_avant-restauration.json', 'sauvegarde-2026-06-01_09h00m00s_avant-reinitialisation.json'];
    const recents = ['sauvegarde-2026-07-10_09h00m00s_conflit-memoire.json', 'sauvegarde-2026-07-10_09h00m00s_conflit-disque.json', 'sauvegarde-2026-09-30_09h00m00s_avant-restauration.json'];
    const operationsAnciennes = ['sauvegarde-2025-01-01_09h00m00s_avant-suppression.json']; // réserve « opération » : limite de 30, pas d'âge
    for (const nom of [...vieux, ...recents, ...operationsAnciennes]) await ecrire(nom);
    for (let i = 1; i <= 35; i++) await ecrire(`sauvegarde-2026-09-${String((i % 28) + 1).padStart(2, '0')}_10h${String(i).padStart(2, '0')}m00s_avant-suppression.json`);

    const supprimes = await appliquerRotation({ dossier, joursQuotidiens: 30, maintenant });
    for (const nom of vieux) assert.ok(supprimes.includes(nom), `${nom} aurait dû être supprimée (plus de 90 jours)`);
    const restantes = await noms(dossier);
    for (const nom of recents) assert.ok(restantes.includes(nom), `${nom} doit rester (moins de 90 jours)`);
    assert.equal(restantes.filter((n) => n.includes('avant-suppression')).length, 30, 'la réserve « opération » garde sa limite de 30');
    assert.ok(!restantes.includes(operationsAnciennes[0]), 'la plus ancienne des opérations est évincée par le nombre');

    // Sans « maintenant » (appel sans horloge), la rotation par âge n'est jamais appliquée.
    await ecrire('sauvegarde-2020-01-01_09h00m00s_conflit-memoire.json');
    await appliquerRotation({ dossier, joursQuotidiens: 30 });
    assert.ok((await noms(dossier)).includes('sauvegarde-2020-01-01_09h00m00s_conflit-memoire.json'));
  } finally {
    await supprimerDossierTemp(dossier);
  }
});

test('rotation : limite quotidienne absente (réglage inconnu) = la réserve quotidienne n\'est jamais touchée', async () => {
  const dossier = await creerDossierTemp('inconnu');
  try {
    await fs.mkdir(path.join(dossier, 'sauvegardes'));
    for (const nom of nomsQuotidiens(40)) await ecrireFichierTest(path.join(dossier, 'sauvegardes', nom), '{}');
    assert.deepEqual(await appliquerRotation({ dossier }), []);
    assert.equal((await noms(dossier)).length, 40);
  } finally {
    await supprimerDossierTemp(dossier);
  }
});

test('conflit puis 35 opérations destructives : la copie « version de l\'application » du conflit reste (ne peut plus être évincée par le nombre)', () =>
  avecStore(
    async ({ actif }) => actif(texteEtat(etatTest(2))),
    async (dossier, store, chemin) => {
      await ecrireFichierTest(chemin, texteEtat(etatTest(7, { revision: 9 })));
      await store.verifierFichier();
      const { application, disque } = store.etat().conflit.sauvegardes;
      assert.ok(application && disque);
      await store.restaurer(disque); // le conflit est résolu : 35 suppressions suivent
      for (let i = 0; i < 35; i++) await store.muter('sup', (copie) => { copie.parametres.dernierModePaiement = 'cheque'; }, { sauvegardeAvant: 'avant-suppression', suivreAnnulation: false });
      const restantes = await noms(dossier);
      assert.ok(restantes.includes(application), 'copie de la version de l\'application conservée');
      assert.ok(restantes.includes(disque));
      assert.equal(restantes.filter((n) => n.includes('avant-suppression')).length, 30);
    },
  ));

test('rotation intégrée : une copie de conflit de plus de 90 jours est supprimée à la sauvegarde suivante, une de moins de 90 jours reste', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(2)));
      await sauvegarde('sauvegarde-2026-06-20_09h00m00s_conflit-memoire.json', texteEtat(etatTest(1)));
      await sauvegarde('sauvegarde-2026-07-10_09h00m00s_conflit-memoire.json', texteEtat(etatTest(1)));
    },
    async (dossier, store) => {
      await store.sauvegarderMaintenant();
      const restantes = await noms(dossier);
      assert.ok(!restantes.includes('sauvegarde-2026-06-20_09h00m00s_conflit-memoire.json'));
      assert.ok(restantes.includes('sauvegarde-2026-07-10_09h00m00s_conflit-memoire.json'));
    },
  ));

test('conflit non résolu au redémarrage : le rappel est exposé avec les deux copies ; résoudre (restaurer l\'une) le fait disparaître, aussi au redémarrage suivant', () =>
  avecStore(
    async ({ actif }) => actif(texteEtat(etatTest(2, { revision: 5 }))),
    async (dossier, store, chemin, rouvrir) => {
      assert.equal(store.etat().conflitNonResolu, null, 'aucun conflit : aucun rappel');
      await pause();
      await ecrireFichierTest(chemin, texteEtat(etatTest(7, { revision: 9 }))); // la synchro remplace le fichier
      await pause();
      await store.verifierFichier();
      const conflit = store.etat().conflit;
      assert.ok(conflit);
      await store.fermer();

      // L'application est fermée sans choisir, puis relancée : le conflit n'est plus en mémoire mais les copies sont là.
      const relance = await rouvrir();
      assert.equal(relance.etat().conflit, null);
      const rappel = relance.etat().conflitNonResolu;
      assert.ok(rappel, 'rappel au démarrage');
      assert.equal(rappel.type, 'non-resolu');
      assert.equal(rappel.sauvegardes.application, conflit.sauvegardes.application);
      assert.equal(rappel.sauvegardes.disque, conflit.sauvegardes.disque);
      assert.equal(rappel.application.nombrePrestations, 2);
      assert.equal(rappel.disque.nombrePrestations, 7);
      assert.ok(Number.isFinite(Date.parse(rappel.detecteLe)));
      assert.equal(relance.lire().prestations.length, 7, 'la version du disque est celle utilisée');

      await pause();
      await relance.restaurer(rappel.sauvegardes.application); // « Garder la version de l'application » depuis le rappel
      assert.equal(relance.etat().conflitNonResolu, null);
      assert.equal(relance.lire().prestations.length, 2);
      await relance.fermer();
      const encore = await rouvrir();
      assert.equal(encore.etat().conflitNonResolu, null, 'résolu : plus de rappel au redémarrage suivant');
    },
  ));

test('conflit non résolu : une copie « conflit-memoire » plus ancienne que le fichier actif ne déclenche aucun rappel', () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await sauvegarde('sauvegarde-2026-09-01_09h00m00s_conflit-memoire.json', texteEtat(etatTest(1)));
      await pause();
      await actif(texteEtat(etatTest(2))); // fichier actif écrit après : le conflit a été résolu depuis
    },
    async (dossier, store) => {
      assert.equal(store.etat().conflitNonResolu, null);
    },
  ));

// ============================================ Repartir d'un fichier vide

test('fichier vide : fichier absent et aucune sauvegarde restaurable : un nouveau fichier est créé (catalogue vide), l\'application refonctionne', () =>
  avecStore(
    async ({ sauvegarde }) => sauvegarde('sauvegarde-2026-09-01_10h00m00s_manuelle.json', '{ abîmée'),
    async (dossier, store, chemin) => {
      assert.equal(store.etat().erreur.raison, 'absent');
      const r = await store.repartirDeZero();
      assert.equal(r.sauvegardeAvant, null, 'pas de fichier existant à conserver');
      assert.equal(store.etat().modeDegrade, false);
      const fichier = await lireJson(chemin);
      assert.equal(fichier.prestations.length, 0);
      assert.deepEqual(fichier.catalogue, [], 'repartir d un fichier vide : catalogue vide');
      assert.ok(fichier.revision >= 1);
      await store.muter('t', (copie) => { copie.parametres.dernierModePaiement = 'cheque'; });
    },
  ));

test('fichier vide : fichier abîmé et aucune sauvegarde restaurable : copie brute du fichier abîmé conservée d\'abord', () =>
  avecStore(
    async ({ actif }) => actif('{"format":"suivi-facturation","schemaVersion":1, abîmé Lapin'),
    async (dossier, store, chemin) => {
      const abime = await fs.readFile(chemin);
      const r = await store.repartirDeZero();
      assert.match(r.sauvegardeAvant, /_avant-reinitialisation\.json$/);
      assert.deepEqual(await fs.readFile(path.join(dossier, 'sauvegardes', r.sauvegardeAvant)), abime, 'copie octet pour octet');
      assert.equal((await lireJson(chemin)).prestations.length, 0);
      assert.equal(store.etat().modeDegrade, false);
    },
  ));

test("fichier vide : refusé tant qu'une sauvegarde est restaurable (409), fichier intact", () =>
  avecStore(
    async ({ actif, sauvegarde }) => {
      await actif('abîmé');
      await sauvegarde(SAUV, texteEtat(etatTest(3)));
    },
    async (dossier, store, chemin) => {
      await echoue(store.repartirDeZero(), 'SAUVEGARDE_RESTAURABLE', 409);
      assert.equal(await fs.readFile(chemin, 'utf8'), 'abîmé');
      assert.equal(store.etat().modeDegrade, true);
    },
  ));

test('fichier vide : refusé si le fichier est revenu lisible (jamais d\'écrasement), et hors mode dégradé', () =>
  avecStore(
    async ({ sauvegarde }) => sauvegarde('sauvegarde-2026-09-01_10h00m00s_manuelle.json', '{ abîmée'),
    async (dossier, store, chemin) => {
      const revenu = texteEtat(etatTest(4));
      await ecrireFichierTest(chemin, revenu);
      await echoue(store.repartirDeZero(), 'FICHIER_REVENU', 409);
      assert.equal(await fs.readFile(chemin, 'utf8'), revenu);
      await echoue(store.repartirDeZero(), 'FICHIER_REVENU', 409); // plus en mode dégradé
      assert.equal(store.lire().prestations.length, 4);
    },
  ));

test('fichier vide : copie du fichier abîmé impossible : opération annulée, rien n\'est modifié', async () => {
  const { fs: fsSimule, etat } = fsSauvegardesBloquees();
  await avecStore(
    async ({ actif }) => actif('abîmé'),
    async (dossier, store, chemin) => {
      etat.bloque = true;
      await echoue(store.repartirDeZero(), 'SAUVEGARDE_ECHOUEE', 503);
      assert.equal(await fs.readFile(chemin, 'utf8'), 'abîmé');
      assert.equal(store.etat().modeDegrade, true);
    },
    { store: { fs: fsSimule } },
  );
});

// ============================================ Migration à la restauration (cas non couvert initialement)

test('restauration d\'une sauvegarde d\'un schéma plus ancien : migrée en mémoire, fichier écrit en version courante, sauvegarde d\'origine intacte', () => {
  const ancienne = etatTest(3);
  ancienne.schemaVersion = 0;
  const migrations = { 0: (etat) => ({ ...etat, migreDepuisV0: undefined }), ...MIGRATIONS };
  return avecStore(
    async ({ actif, sauvegarde }) => {
      await actif(texteEtat(etatTest(1)));
      await sauvegarde(SAUV, texteEtat(ancienne));
    },
    async (dossier, store, chemin) => {
      const octets = await fs.readFile(path.join(dossier, 'sauvegardes', SAUV));
      const r = await store.restaurer(SAUV);
      assert.equal(r.nombrePrestations, 3);
      assert.equal((await lireJson(chemin)).schemaVersion, VERSION_COURANTE);
      assert.deepEqual(await fs.readFile(path.join(dossier, 'sauvegardes', SAUV)), octets, 'la sauvegarde reste en version 0');
      const liste = await store.sauvegardes();
      assert.equal(liste.find((s) => s.nom === SAUV).restaurable, true);
    },
    { store: { migrations } },
  );
});

test('résolution d\'un conflit : un événement est journalisé (choix seulement, ni nom de sauvegarde ni contenu) ; une restauration sans conflit ne journalise rien', () => {
  const lignes = [];
  const journal = { avert() {}, erreur() {}, info: (m) => lignes.push(m) };
  return avecStore(
    async ({ actif }) => actif(texteEtat(etatTest(2, { revision: 5 }))),
    async (dossier, store, chemin) => {
      await pause();
      await ecrireFichierTest(chemin, texteEtat(etatTest(7, { revision: 9 })));
      await pause();
      await store.verifierFichier();
      const { sauvegardes } = store.etat().conflit;
      await pause();
      await store.restaurer(sauvegardes.disque);
      assert.equal(lignes.length, 1);
      assert.match(lignes[0], /Conflit de synchronisation résolu \(choix : version du disque\)/);
      assert.ok(!lignes[0].includes('sauvegarde-'), 'aucun nom de fichier dans le journal');
      // Sans conflit : aucune ligne.
      await pause();
      await store.restaurer(sauvegardes.application);
      assert.equal(lignes.length, 1, 'pas de conflit à résoudre : pas de ligne');
    },
    { store: { journal } },
  );
});

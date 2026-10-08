// Stockage : état en mémoire + file d'écriture unique + contrôle d'empreinte avant écriture.
// Seul module (avec ses voisins de src/store/) à toucher au disque.
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ErreurApp } from '../erreurs.js';
import { FORMAT, MIGRATIONS, VERSION_COURANTE, compterIncoherencesPatients, compterIncoherencesStatut, controlerStructure, creerEtatInitial, migrer } from '../domain/schema.js';
import { SAUVEGARDES_MAX, SAUVEGARDES_MIN } from '../domain/validation.js';
import { ecrireAtomique, nettoyerTemporaires } from './fichier-atomique.js';
import { chercherConflitNonResolu, empreinteDe, resumerVersion, sha256 } from './conflit.js';
import { analyserContenu, listerSauvegardesDetaillees } from './restauration.js';
import { SOUS_DOSSIER_SAUVEGARDES, analyserNomSauvegarde, appliquerRotation, creerSauvegarde, listerSauvegardes, nettoyerTemporairesSauvegardes } from './sauvegardes.js';

export const NOM_FICHIER_ACTIF = 'suivi-facturation.json';
const ATTENTE_ARRET_MS = 5000;

function geler(valeur) {
  if (valeur && typeof valeur === 'object' && !Object.isFrozen(valeur)) {
    Object.freeze(valeur);
    Object.values(valeur).forEach(geler);
  }
  return valeur;
}

/** Réglage « sauvegardes à conserver » lisible dans des octets (fichier abîmé ou d'une autre version), sinon null. */
function reglageDans(octets) {
  try {
    const n = JSON.parse(octets.toString('utf8').replace(/^﻿/, ''))?.parametres?.sauvegardesConservees;
    return Number.isSafeInteger(n) && n >= 1 ? n : null;
  } catch {
    return null;
  }
}

const MESSAGE_STRUCTURE_INCONNUE = "Ce fichier a été créé par une version plus récente de l'application, dont le contenu n'est pas reconnu par cette version : il ne peut pas être affiché ici. Il est conservé tel quel, sans aucune modification. Utilisez la version de l'application qui l'a créé.";

/** Avertissement de lecture sur les statuts et les patients incohérents du fichier ; null si le fichier est cohérent. Rien n'est corrigé en silence. */
function avertissementIncoherences(etat) {
  const { factureSansDate, aFacturerAvecDate } = compterIncoherencesStatut(etat);
  const { orphelines, copiesDivergentes } = compterIncoherencesPatients(etat);
  if (factureSansDate === 0 && aFacturerAvecDate === 0 && orphelines === 0 && copiesDivergentes === 0) return null;
  const phrases = [];
  if (factureSansDate > 0) phrases.push(`${factureSansDate} prestation${factureSansDate > 1 ? 's sont marquées' : ' est marquée'} « facturé${factureSansDate > 1 ? 'es' : 'e'} » sans date de facturation (la date de la prestation sert alors à calculer l'ancienneté des impayés).`);
  if (aFacturerAvecDate > 0) phrases.push(`${aFacturerAvecDate} prestation${aFacturerAvecDate > 1 ? 's sont marquées' : ' est marquée'} « à facturer » alors qu'une date de facturation est enregistrée.`);
  if (orphelines > 0) phrases.push(`${orphelines} prestation${orphelines > 1 ? 's concernent' : ' concerne'} un patient absent du registre des patients.`);
  if (copiesDivergentes > 0) phrases.push(`${copiesDivergentes} prestation${copiesDivergentes > 1 ? 's portent' : ' porte'} un nom de patient différent de celui du registre.`);
  return { code: 'DONNEES_INCOHERENTES', message: `${phrases.join(' ')} Le fichier n'a pas été modifié ; vérifiez ces prestations dans la liste.` };
}

const serialiser = (etat) => `${JSON.stringify(etat, null, 2)}\n`;

const AVERTISSEMENT_SAUVEGARDE = {
  code: 'SAUVEGARDE_ECHOUEE',
  message: "La sauvegarde automatique n'a pas pu être créée (dossier de sauvegarde inaccessible ?). L'application continue de fonctionner et rien n'est effacé. Vérifiez le dossier de données.",
};

/** Lignes dont la valeur diffère entre deux états : Map<id, ligne d'avant | null si elle n'existait pas>. Les lignes sont gelées : pas de copie. */
function lignesTouchees(ancien, nouveau) {
  const avant = new Map(ancien.prestations.map((l) => [l.id, l]));
  const apres = new Map(nouveau.prestations.map((l) => [l.id, l]));
  const touchees = new Map();
  for (const [id, ligne] of apres) {
    const origine = avant.get(id);
    if (!origine) touchees.set(id, null);
    else if (JSON.stringify(origine) !== JSON.stringify(ligne)) touchees.set(id, origine);
  }
  for (const [id, origine] of avant) if (!apres.has(id)) touchees.set(id, origine);
  return touchees;
}

/**
 * Ouvre le stockage du dossier de données (déjà validé par config.js).
 *   store.lire()            instantané immuable (lève 503 en mode dégradé)
 *   store.muter(raison, fn) mutation sérialisée ; fn(copie) modifie la copie et peut renvoyer { avertissements }
 *   store.verifierFichier() contrôle d'empreinte (passe par la file)
 *   store.etat()            drapeaux d'état pour /api/etat
 *   store.annuler(jeton)    annule la dernière mutation, tant qu'aucune autre n'a eu lieu depuis
 *   store.sauvegardes()     liste détaillée des sauvegardes datées : taille, lisibilité, nombre de prestations
 *   store.sauvegarderMaintenant() sauvegarde manuelle ; store.restaurer(nom) restauration d'une sauvegarde, possible dans tous les modes
 *
 *   store.restaurer(nom, { depuisModeDegrade }) : si l'utilisatrice a décidé depuis l'écran « fichier absent / illisible » et que le
 *                           fichier est revenu lisible entre-temps, la restauration est refusée (409 FICHIER_REVENU) : on ne l'écrase pas.
 *   store.repartirDeZero()  fichier vide, seulement en mode absent / illisible et sans aucune sauvegarde restaurable
 *
 * `etatInitial(maintenant)` : état d'un fichier créé neuf (premier démarrage, « repartir d'un fichier vide »). Par défaut `creerEtatInitial`,
 * dont le catalogue est VIDE ; les tests peuvent fournir un état garni sans changer le comportement de création.
 *
 * Sauvegardes (architecture §7.3) : au démarrage (sauf si identique à la dernière), avant la première modification
 * de chaque jour, et avant une opération destructive (option `sauvegardeAvant` de muter) ; rotation après chaque création, sauf en mode
 * dégradé et pendant une restauration (aucune suppression à ces moments-là). La réserve quotidienne garde un nombre de JOURS d'historique :
 * toujours le réglage courant (7 à 365), jamais une valeur par défaut ni celle d'une sauvegarde restaurée.
 */
export async function ouvrirStore({ dossier, horloge, fs = fsp, optionsAtomique, migrations = MIGRATIONS, journal = { avert() {}, erreur() {} }, etatInitial = creerEtatInitial } = {}) {
  const chemin = path.join(dossier, NOM_FICHIER_ACTIF);
  const optAtomique = { fs, ...optionsAtomique };

  let etat = null;
  let degrade = null; // { code, raison, message } : fichier absent ou illisible, jamais écrasé
  let lectureSeule = false;
  let conflit = null;
  let empreinte = null;
  let file = Promise.resolve();
  let creeAuDemarrage = false;
  let avertissementSauvegarde = null; // persistant jusqu'à la prochaine sauvegarde réussie
  let derniereSauvegarde = null;
  let jourSauvegardeQuotidienne = null; // jour civil dont le début est déjà couvert par une sauvegarde
  let derniereAnnulation = null; // { jeton, revision, avant: Map, parametresAvant, patientsAvant }
  let reglageCourant = null; // dernier réglage « sauvegardes à conserver » connu (null tant qu'aucun fichier n'a été lu)
  let structureInconnue = false; // fichier d'une version plus récente dont la structure n'est pas celle de cette version : illisible ici, jamais écrit
  let conflitNonResolu = null; // rappel au démarrage, même forme que `conflit`

  /** Adopte un nouvel état en mémoire (gelé) et retient son réglage de sauvegardes. */
  const poser = (nouvelEtat) => {
    etat = geler(nouvelEtat);
    const n = nouvelEtat?.parametres?.sauvegardesConservees;
    if (Number.isSafeInteger(n)) reglageCourant = n;
  };

  const enfiler = (tache) => {
    const suite = file.then(tache);
    file = suite.catch(() => {});
    return suite;
  };

  // Journal d'événements (src/journal.js) : codes et circonstances seulement, jamais de message d'erreur ni de contenu de données.
  const signalerDegrade = (raison, message) => {
    if (degrade?.raison !== raison) journal.avert(`Mode dégradé : fichier de données inutilisable (raison : ${raison}). Rien n'a été modifié.`);
    degrade = { code: 'DONNEES_ILLISIBLES', raison, message };
  };

  /**
   * Contenu d'un dossier ; ENOENT (et ENOTDIR : un fichier occupe la place du dossier, il ne peut donc pas contenir de sauvegarde) signifie « rien ici ».
   * Toute autre erreur est relancée : le dossier existe peut-être, mais n'est pas lisible.
   */
  async function lister(dir) {
    try {
      return await fs.readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
      throw err;
    }
  }

  /** Empreinte du fichier qu'on vient d'écrire. Si le `stat` échoue (fichier tenu un instant), empreinte « à recalculer » : le prochain contrôle relit et compare le contenu. */
  async function empreinteApresEcriture(texte) {
    const octets = Buffer.from(texte);
    try {
      return empreinteDe(await fs.stat(chemin), octets);
    } catch {
      return { mtimeMs: -1, taille: -1, sha256: sha256(octets) };
    }
  }

  /** Adopte l'état écrit : posé AVANT le `stat`, pour qu'un échec du `stat` ne laisse jamais la mémoire derrière le disque. */
  async function memoriser(etatSuivant, texte) {
    poser(etatSuivant);
    empreinte = await empreinteApresEcriture(texte);
  }

  async function charger() {
    structureInconnue = false;
    await nettoyerTemporaires(dossier, { fs });
    await nettoyerTemporairesSauvegardes(dossier, { fs });
    let stat;
    let octets;
    try {
      stat = await fs.stat(chemin);
      octets = await fs.readFile(chemin);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        return signalerDegrade('lecture', "Le fichier de données n'a pas pu être lu (accès refusé ou fichier verrouillé). Rien n'a été modifié. Fermez les programmes qui l'utilisent puis relancez l'application.");
      }
      let archives;
      let sauvegardes;
      try {
        archives = (await lister(dossier)).some((n) => /^archive-\d{4}\.json$/.test(n));
        sauvegardes = (await lister(path.join(dossier, SOUS_DOSSIER_SAUVEGARDES))).length > 0;
      } catch {
        // Impossible de savoir s'il existe des sauvegardes ou des archives : on ne crée surtout pas un fichier vide.
        return signalerDegrade('lecture', "Le fichier de données est introuvable et le dossier des sauvegardes n'a pas pu être lu (accès refusé ?). Rien n'a été créé. Vérifiez les droits du dossier de données puis relancez l'application.");
      }
      if (archives || sauvegardes) {
        return signalerDegrade('absent', "Le fichier de données est introuvable alors que des sauvegardes ou des archives existent (synchronisation pas terminée ?). Rien n'a été créé. Choisissez une sauvegarde à restaurer.");
      }
      const initial = etatInitial(horloge.maintenant());
      const texte = serialiser(initial);
      await ecrireAtomique(chemin, texte, optAtomique);
      creeAuDemarrage = true; // rien à sauvegarder : le fichier vient d'être créé
      return memoriser(initial, texte);
    }

    empreinte = empreinteDe(stat, octets);
    let donnees;
    try {
      donnees = JSON.parse(octets.toString('utf8').replace(/^﻿/, ''));
    } catch {
      empreinte = null;
      return signalerDegrade('illisible', "Le fichier de données est illisible (abîmé ou incomplet). Rien n'a été modifié. Choisissez une sauvegarde à restaurer.");
    }
    if (typeof donnees !== 'object' || donnees === null || donnees.format !== FORMAT || !Number.isSafeInteger(donnees.schemaVersion) || donnees.schemaVersion < 0) {
      empreinte = null;
      return signalerDegrade('illisible', "Le fichier de données n'a pas le format attendu. Rien n'a été modifié. Choisissez une sauvegarde à restaurer.");
    }

    if (donnees.schemaVersion > VERSION_COURANTE) {
      journal.avert('Fichier de données créé par une version plus récente : ouvert en lecture seule.');
      lectureSeule = true; // ni migration ni écriture : le fichier vient d'une version plus récente
      structureInconnue = controlerStructure(donnees).length > 0; // structure différente : les écrans de lecture répondent 503 au lieu de planter
      poser(donnees);
      return;
    }

    if (donnees.schemaVersion < VERSION_COURANTE) {
      try {
        const migre = migrer(donnees, migrations);
        const problemes = controlerStructure(migre);
        if (problemes.length > 0) throw new Error('Structure invalide après migration.');
        await creerSauvegarde({ dossier, maintenant: horloge.maintenant(), raison: 'avant-migration', contenu: octets, fs, optionsAtomique });
        const texte = serialiser(migre);
        await ecrireAtomique(chemin, texte, optAtomique);
        return memoriser(migre, texte);
      } catch {
        return signalerDegrade('illisible', "La mise à jour du fichier de données vers la version actuelle a échoué. Rien n'a été modifié.");
      }
    }

    if (controlerStructure(donnees).length > 0) {
      empreinte = null;
      return signalerDegrade('illisible', "Le contenu du fichier de données est incohérent. Rien n'a été modifié. Choisissez une sauvegarde à restaurer.");
    }
    poser(donnees);
  }

  /**
   * Mode dégradé : relit le fichier actif (la synchronisation a pu le ramener, ou finir de l'écrire). S'il est maintenant lisible,
   * on sort du mode dégradé comme au démarrage, sans rien écraser. Sinon l'état dégradé est mis à jour (raison et message).
   */
  async function relireFichier() {
    if (!degrade) return;
    const ancien = degrade;
    degrade = null;
    lectureSeule = false;
    try {
      await charger();
    } catch {
      degrade = ancien; // la relecture ne doit jamais aggraver la situation
      return;
    }
    if (!degrade) {
      await sauvegardeDemarrage();
      await detecterConflitNonResolu();
    }
  }

  async function detecterConflitNonResolu() {
    conflitNonResolu = null;
    if (!etat || degrade || conflit || !empreinte) return;
    conflitNonResolu = await chercherConflitNonResolu({ dossier, fs, mtimeActif: empreinte.mtimeMs });
  }

  async function declarerConflit(type, octetsDisque) {
    const sauvegardes = { disque: null, application: null };
    const maintenant = horloge.maintenant();
    try {
      if (octetsDisque) sauvegardes.disque = await creerSauvegarde({ dossier, maintenant, raison: 'conflit-disque', contenu: octetsDisque, fs, optionsAtomique });
    } catch { /* la détection prime ; l'absence de copie est indiquée dans `sauvegardes` */ }
    try {
      sauvegardes.application = await creerSauvegarde({ dossier, maintenant, raison: 'conflit-memoire', contenu: serialiser(etat), fs, optionsAtomique });
    } catch { /* idem */ }
    journal.avert(`Conflit de synchronisation détecté (type : ${type}). Les deux versions sont conservées dans les sauvegardes.`);
    conflit = {
      type,
      detecteLe: maintenant.toISOString(),
      disque: octetsDisque ? resumerVersion(octetsDisque) : null,
      application: { nombrePrestations: Array.isArray(etat.prestations) ? etat.prestations.length : null, revision: etat.revision ?? null, majLe: etat.majLe ?? null },
      sauvegardes,
    };
  }

  // Le fichier sur disque est-il celui que nous avons lu ou écrit en dernier ? (architecture §7.6)
  async function controlerEmpreinte() {
    if (!empreinte || conflit || degrade || !etat) return;
    let stat;
    try {
      stat = await fs.stat(chemin);
    } catch {
      return declarerConflit('disparu', null);
    }
    if (stat.mtimeMs === empreinte.mtimeMs && stat.size === empreinte.taille) return;
    let octets;
    try {
      octets = await fs.readFile(chemin);
    } catch {
      throw new ErreurApp(503, 'FICHIER_VERROUILLE', 'Le fichier de données est utilisé par un autre programme. Réessayez dans un instant.');
    }
    if (sha256(octets) === empreinte.sha256) {
      empreinte = empreinteDe(stat, octets); // seule la date a été touchée (client de synchro)
      return;
    }
    return declarerConflit('modifie', octets);
  }

  /** Réglage courant (nombre de JOURS d'historique), ramené dans les bornes 7 à 365 ; null si aucun fichier n'a encore été lu (aucune rotation quotidienne alors). */
  const joursConserves = () => (reglageCourant === null ? null : Math.min(SAUVEGARDES_MAX, Math.max(SAUVEGARDES_MIN, reglageCourant)));

  /**
   * Crée la sauvegarde puis applique la rotation (une rotation en échec ne compromet pas la sauvegarde).
   * Aucune rotation en mode dégradé ni quand `rotation: false` (restauration, réinitialisation) : on ne supprime jamais rien à ces moments-là.
   */
  async function sauvegarder(raison, octets, { rotation = true } = {}) {
    const nom = await creerSauvegarde({ dossier, maintenant: horloge.maintenant(), raison, contenu: octets, fs, optionsAtomique });
    derniereSauvegarde = nom;
    if (rotation && !degrade) {
      await appliquerRotation({ dossier, joursQuotidiens: joursConserves(), maintenant: horloge.maintenant(), fs, journal })
        .catch((err) => journal.avert(`Rotation des sauvegardes en échec (code : ${err?.code ?? err?.name ?? 'inconnu'}) : des sauvegardes anciennes peuvent s'accumuler.`));
    }
    return nom;
  }

  /** Journalise un échec de sauvegarde (une fois par série d'échecs pour les sauvegardes automatiques). */
  function echecSauvegarde(quand, err) {
    if (avertissementSauvegarde && quand !== 'manuelle' && quand !== 'de sécurité avant opération') return;
    journal.erreur(`Échec de la sauvegarde ${quand} (code : ${err?.code ?? err?.name ?? 'inconnu'}).`);
  }

  // Sauvegarde de démarrage : sauf si le fichier est identique à la plus récente sauvegarde quotidienne (évite d'épuiser la rotation).
  async function sauvegardeDemarrage() {
    if (!etat || degrade || lectureSeule || creeAuDemarrage) return; // rien à protéger, ou fichier d'une version plus récente (laissé tel quel)
    const jour = horloge.aujourdHui();
    try {
      const octets = await fs.readFile(chemin);
      const existantes = (await listerSauvegardes({ dossier, fs })).filter((s) => s.reserve === 'quotidienne');
      const derniere = existantes[existantes.length - 1];
      if (derniere) {
        const octetsDerniere = await fs.readFile(path.join(dossier, SOUS_DOSSIER_SAUVEGARDES, derniere.nom));
        if (sha256(octetsDerniere) === sha256(octets)) {
          derniereSauvegarde = derniere.nom;
          jourSauvegardeQuotidienne = jour;
          return;
        }
      }
      await sauvegarder('demarrage', octets);
      jourSauvegardeQuotidienne = jour;
      avertissementSauvegarde = null;
    } catch (err) {
      echecSauvegarde('de démarrage', err);
      avertissementSauvegarde = AVERTISSEMENT_SAUVEGARDE;
    }
  }

  // Avant la première modification de chaque jour civil (la sauvegarde de démarrage du jour compte comme cette sauvegarde).
  async function sauvegardeQuotidienne() {
    const jour = horloge.aujourdHui();
    if (jourSauvegardeQuotidienne === jour) return;
    try {
      await sauvegarder('quotidienne', await fs.readFile(chemin));
      jourSauvegardeQuotidienne = jour;
      avertissementSauvegarde = null;
    } catch (err) {
      echecSauvegarde('quotidienne', err);
      avertissementSauvegarde = AVERTISSEMENT_SAUVEGARDE; // l'application continue
    }
  }

  async function executer(raison, fn, { sauvegardeAvant = null, suivreAnnulation = true } = {}) {
    if (degrade) throw new ErreurApp(503, degrade.code, degrade.message);
    if (lectureSeule) throw new ErreurApp(503, 'SCHEMA_PLUS_RECENT', 'Ce fichier a été créé par une version plus récente de l\'application. Il est ouvert en lecture seule : aucune modification n\'est possible.');
    const refus = () => new ErreurApp(409, 'CONFLIT_FICHIER', "Le fichier de données a été modifié ailleurs (synchronisation ?). Rien n'a été enregistré et les deux versions ont été conservées dans les sauvegardes. Choisissez la version à garder (bouton en haut de la page).");
    await controlerEmpreinte();
    if (conflit) throw refus();

    const ancien = etat;
    const copie = structuredClone(etat);
    const retour = (await fn(copie)) ?? {};
    const suivant = retour.etat ?? copie;
    suivant.revision = etat.revision + 1;
    suivant.majLe = horloge.maintenant().toISOString();
    if (controlerStructure(suivant).length > 0) {
      throw new ErreurApp(500, 'ERREUR_INTERNE', 'Une erreur interne a empêché l\'enregistrement. Rien n\'a été modifié.');
    }

    // Sauvegardes de l'état AVANT cette modification (`fn` a réussi : une saisie refusée n'en crée pas).
    await sauvegardeQuotidienne();
    if (sauvegardeAvant) {
      try {
        await sauvegarder(sauvegardeAvant, await fs.readFile(chemin));
      } catch (err) {
        echecSauvegarde('de sécurité avant opération', err);
        throw new ErreurApp(503, 'SAUVEGARDE_ECHOUEE', "L'opération a été annulée : la sauvegarde de sécurité n'a pas pu être créée. Rien n'a été modifié.");
      }
    }

    const texte = serialiser(suivant);
    await ecrireAtomique(chemin, texte, optAtomique); // en cas d'échec, la mémoire reste inchangée
    await memoriser(suivant, texte);

    let annulation = null;
    if (suivreAnnulation) {
      annulation = randomUUID();
      derniereAnnulation = { jeton: annulation, revision: suivant.revision, avant: lignesTouchees(ancien, etat), parametresAvant: ancien.parametres, patientsAvant: ancien.patients };
    } else {
      derniereAnnulation = null;
    }
    // Alerte immédiate si la sauvegarde automatique du jour n'a pas pu être créée (elle est aussi dans /api/etat).
    const avertissements = [...(retour.avertissements ?? [])];
    if (avertissementSauvegarde) avertissements.push(avertissementSauvegarde);
    return { etat, avertissements, resultat: retour.resultat, annulation };
  }

  /** Restaure l'état d'avant la dernière mutation si aucune autre n'a eu lieu depuis (même révision). */
  function annulerDerniere(jeton) {
    if (!derniereAnnulation || derniereAnnulation.jeton !== jeton || !etat || etat.revision !== derniereAnnulation.revision) {
      throw new ErreurApp(409, 'ANNULATION_IMPOSSIBLE', "Impossible d'annuler : une autre modification a été faite depuis, ou l'application a été relancée.");
    }
    const { avant, parametresAvant, patientsAvant } = derniereAnnulation;
    return executer(
      'annulation',
      (copie) => {
        for (const [id, ligne] of avant) {
          const i = copie.prestations.findIndex((l) => l.id === id);
          if (ligne === null) {
            if (i >= 0) copie.prestations.splice(i, 1);
          } else if (i >= 0) copie.prestations[i] = structuredClone(ligne);
          else copie.prestations.push(structuredClone(ligne));
        }
        copie.parametres = structuredClone(parametresAvant);
        copie.patients = structuredClone(patientsAvant); // registre d'avant : un patient créé avec la prestation annulée disparaît avec elle
      },
      // Annuler une création supprime la ligne : sauvegarde préalable comme pour toute suppression (échec = opération annulée).
      { suivreAnnulation: false, sauvegardeAvant: [...avant.values()].some((ligne) => ligne === null) ? 'avant-suppression' : null },
    );
  }

  /** Sauvegarde manuelle (« Sauvegarder maintenant ») : copie du fichier actif tel qu'il est sur le disque. */
  async function sauvegardeManuelle() {
    if (degrade) throw new ErreurApp(503, degrade.code, degrade.message);
    let octets;
    try {
      octets = await fs.readFile(chemin);
    } catch (err) {
      if (err.code === 'ENOENT') throw new ErreurApp(409, 'FICHIER_ABSENT', "Le fichier de données n'est plus dans son dossier : aucune sauvegarde n'a été créée. Choisissez la version à garder (bouton en haut de la page) puis recommencez.");
      throw new ErreurApp(503, 'FICHIER_VERROUILLE', 'Le fichier de données est utilisé par un autre programme. Réessayez dans un instant.');
    }
    try {
      const nom = await sauvegarder('manuelle', octets);
      avertissementSauvegarde = null;
      return { nom };
    } catch (err) {
      echecSauvegarde('manuelle', err);
      throw new ErreurApp(503, 'SAUVEGARDE_ECHOUEE', "La sauvegarde n'a pas pu être créée (dossier de sauvegarde inaccessible ?). Rien n'a été modifié.");
    }
  }

  const fichierRevenu = () => new ErreurApp(409, 'FICHIER_REVENU', "Le fichier de données est revenu et il est de nouveau lisible (synchronisation terminée ?). Il n'a pas été remplacé : rien n'a été modifié. L'application l'a repris tel quel.");

  /** Après une restauration ou une réinitialisation : état et empreinte à jour, tous les drapeaux d'anomalie levés. */
  async function adopterFichierEcrit(nouvelEtat, texte) {
    empreinte = await empreinteApresEcriture(texte); // si le `stat` échoue : empreinte à recalculer au prochain contrôle
    poser(nouvelEtat);
    degrade = null;
    lectureSeule = false;
    structureInconnue = false;
    conflit = null;
    conflitNonResolu = null;
    derniereAnnulation = null;
  }

  /**
   * Restaure une sauvegarde, dans la file, quel que soit le mode (normal, fichier illisible ou absent, conflit, lecture seule).
   * 0. en mode dégradé, le fichier actif est relu : s'il est revenu lisible et que la décision a été prise depuis l'écran dégradé
   *    (`depuisModeDegrade`), refus 409 FICHIER_REVENU : on ne l'écrase pas ;
   * 1. contrôle de la sauvegarde choisie (abîmée ou incompatible : refus, rien n'est touché) ;
   * 2. version en mémoire : si le disque a changé sans qu'on l'ait vu (ou si un conflit est déclaré sans copie de la version de
   *    l'application), la version en mémoire est copiée à part (conflit-memoire) ; si cette copie échoue, la restauration est annulée ;
   * 3. sauvegarde « avant-restauration » du fichier actuel tel qu'il est sur le disque (copie brute, même illisible) : échec = annulation ;
   * 4. écriture atomique, puis rechargement de l'état et de l'empreinte. Une écriture en échec laisse le fichier actuel intact.
   * Aucune rotation pendant l'opération ; le réglage « sauvegardes à conserver » courant est conservé dans le fichier restauré.
   */
  async function restaurerSauvegarde(nom, { depuisModeDegrade = false } = {}) {
    if (!analyserNomSauvegarde(nom)) throw new ErreurApp(404, 'INTROUVABLE', 'Cette sauvegarde est introuvable.');
    if (degrade) await relireFichier();
    if (depuisModeDegrade && !degrade) throw fichierRevenu();
    let octets;
    try {
      octets = await fs.readFile(path.join(dossier, SOUS_DOSSIER_SAUVEGARDES, nom));
    } catch (err) {
      if (err.code === 'ENOENT') throw new ErreurApp(404, 'INTROUVABLE', 'Cette sauvegarde est introuvable (elle a peut-être été supprimée par la rotation).');
      throw new ErreurApp(503, 'FICHIER_VERROUILLE', "Cette sauvegarde n'a pas pu être lue (fichier occupé). Réessayez dans un instant ; rien n'a été modifié.");
    }
    const verdict = analyserContenu(octets, migrations);
    if (!verdict.ok) throw new ErreurApp(422, 'SAUVEGARDE_INCOMPATIBLE', verdict.message);

    // La version en mémoire (dernières saisies de l'application) n'est protégée que si le disque lui est identique ou si elle est copiée.
    let sauvegardeApplication = null;
    if (etat && !degrade) {
      await controlerEmpreinte(); // disque changé en douce : déclare le conflit et copie les deux versions
      if (conflit) {
        sauvegardeApplication = conflit.sauvegardes.application;
        if (!sauvegardeApplication) {
          try {
            sauvegardeApplication = await creerSauvegarde({ dossier, maintenant: horloge.maintenant(), raison: 'conflit-memoire', contenu: serialiser(etat), fs, optionsAtomique });
            conflit.sauvegardes.application = sauvegardeApplication;
          } catch {
            throw new ErreurApp(503, 'SAUVEGARDE_ECHOUEE', "La restauration a été annulée : la version de l'application (vos dernières saisies, pas encore dans le fichier du disque) n'a pas pu être mise de côté. Rien n'a été modifié.");
          }
        }
      }
    }

    let actuel = null;
    try {
      actuel = await fs.readFile(chemin);
    } catch (err) {
      if (err.code !== 'ENOENT') throw new ErreurApp(503, 'FICHIER_VERROUILLE', "Le fichier de données actuel n'a pas pu être lu pour être sauvegardé (fichier occupé). La restauration est annulée ; rien n'a été modifié.");
    }
    let sauvegardeAvant = null;
    if (actuel) {
      try {
        sauvegardeAvant = await sauvegarder('avant-restauration', actuel, { rotation: false });
      } catch {
        throw new ErreurApp(503, 'SAUVEGARDE_ECHOUEE', "La restauration a été annulée : la sauvegarde de sécurité de l'état actuel n'a pas pu être créée. Rien n'a été modifié.");
      }
    }
    const annulable = sauvegardeAvant !== null && analyserContenu(actuel, migrations).ok;
    const revisionActuelle = actuel ? (resumerVersion(actuel).revision ?? 0) : 0;

    const restaure = verdict.etat;
    restaure.revision = Math.max(restaure.revision, revisionActuelle, etat?.revision ?? 0) + 1;
    restaure.majLe = horloge.maintenant().toISOString();
    const reglage = reglageCourant ?? (actuel ? reglageDans(actuel) : null); // le réglage courant prime sur celui de la sauvegarde
    if (reglage !== null) restaure.parametres.sauvegardesConservees = reglage;
    const texte = serialiser(restaure);
    await ecrireAtomique(chemin, texte, optAtomique); // en cas d'échec : le fichier actuel est intact, l'état en mémoire aussi

    const conflitResolu = conflit ?? conflitNonResolu; // lu avant que l'adoption du fichier lève les drapeaux
    await adopterFichierEcrit(restaure, texte);
    if (conflitResolu) {
      // Événement seulement : jamais de nom de sauvegarde, de patient ni de contenu.
      const choix = nom === conflitResolu.sauvegardes?.disque ? 'version du disque' : nom === conflitResolu.sauvegardes?.application ? "version de l'application" : 'autre sauvegarde';
      journal.info?.(`Conflit de synchronisation résolu (choix : ${choix}). Les deux versions restent dans les sauvegardes.`);
    }
    return { restauree: nom, sauvegardeAvant, sauvegardeApplication, annulable, nombrePrestations: restaure.prestations.length };
  }

  /**
   * Repartir d'un fichier vide : seulement en mode « absent » ou « illisible », quand aucune sauvegarde n'est restaurable.
   * Le fichier existant (même abîmé) est copié à part d'abord ; si la copie est impossible, rien n'est fait.
   */
  async function repartirDeZero() {
    if (degrade) await relireFichier();
    if (!degrade) throw fichierRevenu();
    if (degrade.raison !== 'absent' && degrade.raison !== 'illisible') {
      throw new ErreurApp(409, 'REINITIALISATION_REFUSEE', "Le fichier de données est occupé par un autre programme : il ne peut pas être remplacé pour l'instant. Réessayez dans un instant.");
    }
    if ((await listerSauvegardesDetaillees({ dossier, fs, migrations })).some((s) => s.restaurable)) {
      throw new ErreurApp(409, 'SAUVEGARDE_RESTAURABLE', "Une sauvegarde peut être restaurée : utilisez-la plutôt que de repartir d'un fichier vide.");
    }
    let actuel = null;
    try {
      actuel = await fs.readFile(chemin);
    } catch (err) {
      if (err.code !== 'ENOENT') throw new ErreurApp(503, 'FICHIER_VERROUILLE', "Le fichier de données actuel n'a pas pu être lu pour être conservé (fichier occupé). Rien n'a été modifié.");
    }
    let sauvegardeAvant = null;
    if (actuel) {
      try {
        sauvegardeAvant = await sauvegarder('avant-reinitialisation', actuel, { rotation: false });
      } catch {
        throw new ErreurApp(503, 'SAUVEGARDE_ECHOUEE', "L'opération a été annulée : la copie de sécurité du fichier actuel n'a pas pu être créée. Rien n'a été modifié.");
      }
    }
    const initial = etatInitial(horloge.maintenant());
    initial.revision = (actuel ? (resumerVersion(actuel).revision ?? 0) : 0) + 1;
    const reglage = reglageCourant ?? (actuel ? reglageDans(actuel) : null);
    if (reglage !== null) initial.parametres.sauvegardesConservees = reglage;
    const texte = serialiser(initial);
    await ecrireAtomique(chemin, texte, optAtomique);
    await adopterFichierEcrit(initial, texte);
    return { sauvegardeAvant, nombrePrestations: 0 };
  }

  await charger();
  await sauvegardeDemarrage();
  await detecterConflitNonResolu();

  return {
    /** `brut: true` : état tel que lu, même si sa structure est inconnue (export complet, jamais d'écran). */
    lire({ brut = false } = {}) {
      if (degrade) throw new ErreurApp(503, degrade.code, degrade.message);
      if (structureInconnue && !brut) throw new ErreurApp(503, 'SCHEMA_PLUS_RECENT', MESSAGE_STRUCTURE_INCONNUE);
      return etat;
    },
    /** `options.sauvegardeAvant` : raison d'une sauvegarde préalable obligatoire (opération destructive) ; son échec annule l'opération. */
    muter(raison, fn, options) {
      return enfiler(() => executer(raison, fn, options));
    },
    annuler(jeton) {
      return enfiler(() => annulerDerniere(jeton));
    },
    sauvegardes() {
      return listerSauvegardesDetaillees({ dossier, fs, migrations });
    },
    sauvegarderMaintenant() {
      return enfiler(() => sauvegardeManuelle());
    },
    restaurer(nom, options) {
      return enfiler(() => restaurerSauvegarde(nom, options));
    },
    repartirDeZero() {
      return enfiler(() => repartirDeZero());
    },
    /** Contrôle d'empreinte ; en mode dégradé, relit le fichier (il a pu revenir ou finir d'être synchronisé). */
    verifierFichier() {
      return enfiler(() => (degrade ? relireFichier() : controlerEmpreinte())).catch(() => {});
    },
    etat() {
      return {
        modeDegrade: degrade !== null,
        erreur: degrade ? { code: degrade.code, raison: degrade.raison, message: degrade.message } : null,
        lectureSeule,
        structureInconnue,
        conflit,
        conflitNonResolu,
        avertissements: [avertissementSauvegarde, !degrade && !structureInconnue && etat ? avertissementIncoherences(etat) : null].filter(Boolean),
        derniereSauvegarde,
        tailleOctets: empreinte ? empreinte.taille : null,
        nombrePrestations: Array.isArray(etat?.prestations) ? etat.prestations.length : null,
        sauvegardesConservees: etat ? joursConserves() : null,
      };
    },
    /** Attend la fin des écritures en cours (arrêt propre), au plus 5 s. */
    async fermer() {
      await Promise.race([file, new Promise((r) => setTimeout(r, ATTENTE_ARRET_MS).unref())]);
    },
  };
}

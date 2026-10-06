// Configuration : variables d'environnement (éventuellement chargées depuis .env par `process.loadEnvFile` dans src/server.js, ou `--env-file` du lanceur).
// L'adresse d'écoute n'est PAS configurable : toujours 127.0.0.1 (voir http/serveur.js).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODE_DOSSIER } from './droits.js';

export const RACINE_PROJET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT_DEFAUT = 4780;
export const CODE_SORTIE_CONFIG = 2;

// Conseil ajouté par le démarrage du serveur (src/server.js) après un refus portant sur le dossier de données.
// Hors de `message` : l'outil « Choisir le dossier » réutilise ces messages et ne doit pas se renvoyer à lui-même.
export const AIDE_DOSSIER_DONNEES =
  'Pour choisir un autre dossier de données, double-cliquez sur le fichier « Choisir le dossier de donnees.bat » (dans le dossier « scripts » du projet).\n' +
  '(Information technique : ce choix est enregistré dans la variable ERGO_DATA_DIR du fichier .env.)';

export class ErreurConfig extends Error {
  constructor(message, { aide = null } = {}) {
    super(message);
    this.name = 'ErreurConfig';
    this.codeSortie = CODE_SORTIE_CONFIG;
    this.aide = aide;
  }
}

/**
 * Dossier du journal : `<projet>/logs` par défaut, ou ERGO_LOG_DIR (relatif au projet ou absolu). Seule lecture disque : la résolution des liens (le journal crée le dossier).
 * Mêmes garde-fous que le dossier de données : jamais dans public/ ni src/ (servi ou mêlé au code) ; dans le projet, seuls logs/ et .tmp/ (ignorés par git).
 */
export function resoudreDossierJournal(env = process.env, racine = RACINE_PROJET) {
  const brut = (env.ERGO_LOG_DIR ?? '').trim();
  const defaut = path.join(racine, 'logs');
  if (brut === '') return defaut;
  const dossier = path.resolve(racine, brut);
  refuserEmplacementInterdit(dossier, racine, { sujet: 'Le dossier du journal', admis: ['logs', '.tmp'] });
  return dossier;
}

/** Lit la configuration depuis un objet d'environnement. Pas d'accès disque. */
export function lireConfig(env = process.env, racine = RACINE_PROJET) {
  const brut = (env.ERGO_DATA_DIR ?? '').trim();
  const parDefaut = brut === '';
  const dossier = parDefaut ? path.join(racine, 'data') : path.resolve(racine, brut);

  let port = PORT_DEFAUT;
  const portBrut = (env.ERGO_PORT ?? '').trim();
  if (portBrut !== '') {
    port = Number(portBrut);
    if (!/^\d+$/.test(portBrut) || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ErreurConfig(`ERGO_PORT doit être un numéro de port entre 1 et 65535 (valeur reçue : « ${portBrut.slice(0, 20)} »).`);
    }
  }
  // ERGO_MODE_DEMO=1 est posée par scripts/demo.mjs seulement : l'interface affiche alors « Données d'exemple ». Jamais en usage normal.
  return { dossier, dossierParDefaut: parDefaut, port, racine, arretAuto: lireArretAuto(env), demonstration: (env.ERGO_MODE_DEMO ?? '').trim() === '1' };
}

/**
 * Arrêt automatique à la fermeture de la page : ERGO_ARRET_AUTO=1 l'active (défaut : désactivé ; 0 ou absent = jamais).
 * Délais en secondes entières (1 à 86400) : ERGO_ARRET_DELAI_FERMETURE_S (10), ERGO_ARRET_DELAI_PULSATION_S (600), ERGO_ARRET_DELAI_PREMIERE_PAGE_S (300).
 */
export function lireArretAuto(env = process.env) {
  const brut = (env.ERGO_ARRET_AUTO ?? '').trim();
  if (!['', '0', '1'].includes(brut)) {
    throw new ErreurConfig(`ERGO_ARRET_AUTO doit valoir 1 (arrêt automatique) ou 0 (aucun arrêt automatique) (valeur reçue : « ${brut.slice(0, 20)} »).`);
  }
  const delai = (nom, defautS) => {
    const valeur = (env[nom] ?? '').trim();
    if (valeur === '') return defautS * 1000;
    const n = Number(valeur);
    if (!/^\d+$/.test(valeur) || n < 1 || n > 86400) {
      throw new ErreurConfig(`${nom} doit être un nombre entier de secondes entre 1 et 86400 (valeur reçue : « ${valeur.slice(0, 20)} »).`);
    }
    return n * 1000;
  };
  return {
    actif: brut === '1',
    delais: {
      fermetureMs: delai('ERGO_ARRET_DELAI_FERMETURE_S', 10),
      pulsationMs: delai('ERGO_ARRET_DELAI_PULSATION_S', 600),
      premierePageMs: delai('ERGO_ARRET_DELAI_PREMIERE_PAGE_S', 300),
    },
  };
}

function estDans(parent, enfant) {
  const rel = path.relative(parent, enfant);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Chemin réel même si la fin du chemin n'existe pas encore : ancêtre existant résolu (liens et jonctions suivis) + reste. */
export function cheminReel(chemin) {
  let courant = path.resolve(chemin);
  const reste = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(courant), ...reste.reverse());
    } catch {
      const parent = path.dirname(courant);
      if (parent === courant) return path.resolve(chemin);
      reste.push(path.basename(courant));
      courant = parent;
    }
  }
}

/**
 * Emplacements interdits pour un dossier choisi par variable d'environnement (journal, verrous) : jamais dans public/ ni src/ (servi ou mêlé au code) ;
 * dans le projet, seuls les sous-dossiers `admis` (ignorés par git). La règle est appliquée au chemin écrit PUIS au chemin réel : un lien symbolique
 * ou une jonction ne peut pas détourner le dossier vers public/, src/ ou le reste du projet (même règle que pour le dossier de données).
 */
export function refuserEmplacementInterdit(dossier, racine, { sujet, admis }) {
  const liste = admis.map((nom) => `« ${nom} »`).join(' et ');
  const refus = (nomInterdit, suffixe) =>
    new ErreurConfig(
      nomInterdit
        ? `${sujet} ne peut pas se trouver dans « ${nomInterdit} » du projet : ${dossier}${suffixe}`
        : `${sujet} ne peut pas se trouver dans le projet (hors ${liste}) : ${dossier}${suffixe}`,
    );
  const verifier = (d, r, admisChemins, suffixe) => {
    for (const interdit of [path.join(r, 'public'), path.join(r, 'src')]) {
      if (estDans(interdit, d)) throw refus(path.basename(interdit), suffixe);
    }
    if (estDans(r, d) && !admisChemins.some((a) => estDans(a, d))) throw refus(null, suffixe);
  };
  verifier(dossier, racine, admis.map((nom) => path.join(racine, nom)), '');
  // Chemin réel : les sous-dossiers admis sont eux aussi résolus (un « logs » ou « .tmp » lui-même détourné n'est plus admis).
  const reelRacine = cheminReel(racine);
  verifier(cheminReel(dossier), reelRacine, admis.map((nom) => cheminReel(path.join(racine, nom))), ' (le chemin passe par un lien symbolique ou une jonction)');
}

/**
 * Valide le dossier de données et renvoie son chemin réel :
 * - par défaut `<projet>/data` est créé s'il manque ;
 * - un ERGO_DATA_DIR explicite doit exister (jamais de création « ailleurs »), être inscriptible,
 *   et ne pas se trouver dans public/ (servi par le serveur statique) ni dans src/.
 */
export async function verifierDossierDonnees(config, { fs = fsp } = {}) {
  const { dossier, dossierParDefaut, racine } = config;
  if (dossierParDefaut) {
    await fs.mkdir(dossier, { recursive: true, mode: MODE_DOSSIER });
  }
  let stat;
  try {
    stat = await fs.stat(dossier);
  } catch {
    throw new ErreurConfig(`Le dossier de données choisi n'existe pas : ${dossier}\nCréez-le d'abord ou choisissez-en un autre. L'application ne crée pas de dossier à cet endroit.`, { aide: AIDE_DOSSIER_DONNEES });
  }
  if (!stat.isDirectory()) {
    throw new ErreurConfig(`Le chemin choisi pour les données ne désigne pas un dossier : ${dossier}`, { aide: AIDE_DOSSIER_DONNEES });
  }
  const reel = await fs.realpath(dossier);
  const interdits = [path.join(racine, 'public'), path.join(racine, 'src')];
  for (const interdit of interdits) {
    const reelInterdit = await fs.realpath(interdit).catch(() => interdit);
    if (estDans(reelInterdit, reel) || estDans(interdit, reel)) {
      throw new ErreurConfig(`Le dossier de données ne peut pas se trouver dans « ${path.basename(interdit)} » du projet (il serait accessible depuis le navigateur ou mêlé au code) : ${dossier}`, { aide: AIDE_DOSSIER_DONNEES });
    }
  }
  // Dans le projet, seuls data/ et .tmp/ (ignorés par git) sont admis : sinon les données de santé risquent d'être publiées par erreur.
  // La comparaison se fait sur les chemins réels : un lien ou un chemin relatif détourné (`data/../x`, junction) ne contourne pas la règle.
  const reelRacine = await fs.realpath(racine).catch(() => racine);
  if (estDans(reelRacine, reel)) {
    const admis = [];
    for (const nom of ['data', '.tmp']) admis.push(await fs.realpath(path.join(racine, nom)).catch(() => path.join(reelRacine, nom)));
    if (!admis.some((a) => estDans(a, reel))) {
      throw new ErreurConfig(
        `Le dossier de données ne peut pas se trouver dans le projet (hors « data » et « .tmp »), car il pourrait être publié avec le code : ${dossier}\n` +
          'Choisissez un dossier en dehors du projet (par exemple le dossier synchronisé de votre cloud) ou gardez le dossier prévu par défaut.',
        { aide: AIDE_DOSSIER_DONNEES },
      );
    }
  }
  const sonde = path.join(reel, `.test-ecriture-${process.pid}`);
  try {
    await fs.writeFile(sonde, '', { flag: 'wx' });
    await fs.unlink(sonde);
  } catch {
    throw new ErreurConfig(`Le dossier de données n'est pas accessible en écriture : ${dossier}\nVérifiez les droits du dossier ou choisissez-en un autre.`, { aide: AIDE_DOSSIER_DONNEES });
  }
  return reel;
}


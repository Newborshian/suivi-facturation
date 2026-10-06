// Mode démonstration : `npm run demo` (ou `node scripts/suivi.mjs demo`).
// Lance l'application sur une COPIE du jeu d'exemple fictif (config/exemple.json), datée d'AUJOURD'HUI, dans un dossier à part sous le
// dossier temporaire du système. Jamais `data/`, jamais le dossier configuré par un .env. Les données de démonstration ne sont pas
// conservées : à chaque lancement elles repartent du jeu d'exemple.
//
// Dossier de démonstration : UNIQUE à chaque lancement (`fs.mkdtempSync(<tmpdir>/suivi-facturation-demo-XXXXXX)`, droits 0700 là où le
// système les gère), avec donnees/, logs/ et verrou/. Deux démonstrations simultanées ont donc chacune leur dossier et leur port.
//
// Garde-fous de sécurité (un dossier temporaire prévisible ou un lien pourraient détourner les écritures ou les suppressions) :
// - aucun lien symbolique ni point de jonction n'est suivi : chaque dossier manipulé est vérifié par `lstat` (dossier ordinaire créé
//   ici) avant usage, et son chemin réel doit être celui attendu ; sinon refus avec un message clair ;
// - le seul fichier écrit est le jeu de données (création exclusive, jamais par-dessus un fichier ou un lien existant) ;
// - à la sortie, les fichiers ORDINAIRES du dossier unique sont supprimés un par un, puis ses dossiers vides en remontant. Aucune
//   suppression récursive, aucun lien suivi. Si une suppression échoue, le dossier est laissé en place (message discret) ;
// - ERGO_DATA_DIR, ERGO_LOG_DIR, ERGO_VERROU_DIR et ERGO_PORT sont IMPOSÉS à ce serveur (src/server.js ne remplace jamais une variable
//   déjà définie) ; garde-fou : refus si le dossier de démonstration est (ou contient, ou est dans) le dossier de données réel.
//   Le fichier .env n'est que LU (pour ce garde-fou), jamais écrit.
//
// Le serveur tourne DANS ce processus (un seul processus : Ctrl+C, le bouton Quitter ou la fermeture de la page l'arrête proprement).
// Si le processus est tué brutalement (SIGKILL, coupure de courant), le dossier temporaire reste : il est inoffensif (données fictives).
// Aucune dépendance, aucun accès réseau hors de cet ordinateur (127.0.0.1 uniquement).
// Variables d'essai : ERGO_LANCEUR_SANS_NAVIGATEUR=1 n'ouvre pas le navigateur ; ERGO_DEMO_PORT_MIN / ERGO_DEMO_PORT_MAX changent la plage de ports.
//
// Importer ce fichier n'a aucun effet de bord : les fonctions exportées (dont `main`) ne font rien tant qu'on ne les appelle pas.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { lireConfig } from '../src/config.js';
import { ajouterJours, ecartJours, estDateCivile, aujourdHuiLocal } from '../src/domain/dates.js';
import { ADRESSE, RACINE, pause, portEstLibre, estNotreApplication, ouvrirNavigateur } from './lib-lanceur.mjs';

export const PREFIXE_DOSSIER_DEMO = 'suivi-facturation-demo-';
export const SOUS_DOSSIERS = ['donnees', 'logs', 'verrou'];
const FICHIER_DONNEES = 'suivi-facturation.json';
// Plage de ports de la démonstration (4790 à 4799) ; variables d'essai ERGO_DEMO_PORT_MIN / ERGO_DEMO_PORT_MAX (entiers 1024 à 65535) pour les essais.
const entierPort = (v, defaut) => { const n = Number(String(v ?? '').trim()); return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : defaut; };
const PORT_DEMO_MIN = () => entierPort(process.env.ERGO_DEMO_PORT_MIN, 4790);
const PORT_DEMO_MAX = () => entierPort(process.env.ERGO_DEMO_PORT_MAX, 4799);
const EST_WINDOWS = process.platform === 'win32';
export const MESSAGE_DEMO = 'Mode démonstration : données fictives, non conservées. Fermez l\'onglet ou faites Ctrl+C pour arrêter.';

const normaliser = (p) => {
  let reel = path.resolve(p);
  try { reel = fs.realpathSync(reel); } catch { /* absent : chemin tel quel */ }
  return EST_WINDOWS ? reel.toLowerCase() : reel;
};
const estDans = (parent, enfant) => {
  const rel = path.relative(parent, enfant);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const memeChemin = (a, b) => (EST_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Garde-fou : vrai si le dossier de démonstration touche le dossier de données réel (identique, contenu ou contenant). */
export function demoTouheLesDonneesReelles(dossierDemo, dossierReel) {
  const a = normaliser(dossierDemo);
  const b = normaliser(dossierReel);
  return estDans(a, b) || estDans(b, a);
}

// --- Jeu de données daté du jour ---

const RE_ISO = /^(\d{4}-\d{2}-\d{2})(T.*)?$/;
const decalerTexte = (valeur, jours) => {
  if (typeof valeur !== 'string') return valeur;
  const m = RE_ISO.exec(valeur);
  if (!m || !estDateCivile(m[1])) return valeur;
  return ajouterJours(m[1], jours) + (m[2] ?? '');
};

/** Date de référence du jeu : jour de sa dernière mise à jour (`majLe`), à défaut la date de la dernière prestation passée. */
export function dateReferenceDuJeu(jeu) {
  const m = RE_ISO.exec(jeu?.majLe ?? '');
  if (m && estDateCivile(m[1])) return m[1];
  throw new Error('le jeu d\'exemple n\'a pas de date de référence (majLe)');
}

/**
 * Copie du jeu d'exemple dont TOUTES les dates (prestations, dates de facturation, versements, créations, modifications, `majLe`) sont
 * décalées du nombre entier de jours qui sépare sa date de référence de `aujourdHui` (AAAA-MM-JJ). L'objet d'origine n'est pas modifié.
 * Le décalage est un calcul de calendrier en UTC (fins de mois, 29 février) ; toute date produite est revérifiée.
 * (Le générateur `genererExemple` accepte bien une date de référence, mais ses cas particuliers sont écrits avec des dates absolues :
 * il ne suffit donc pas ; le décalage garde tout cohérent.)
 */
export function jeuDuJour(jeu, aujourdHui) {
  if (!estDateCivile(aujourdHui)) throw new Error('date du jour invalide');
  const jours = ecartJours(dateReferenceDuJeu(jeu), aujourdHui);
  const copie = structuredClone(jeu);
  copie.majLe = decalerTexte(copie.majLe, jours);
  for (const p of copie.prestations ?? []) {
    p.date = decalerTexte(p.date, jours);
    p.factureLe = decalerTexte(p.factureLe, jours);
    p.creeLe = decalerTexte(p.creeLe, jours);
    p.modifieLe = decalerTexte(p.modifieLe, jours);
    for (const v of p.versements ?? []) v.date = decalerTexte(v.date, jours);
  }
  for (const p of copie.prestations ?? []) {
    const dates = [p.date, p.factureLe, ...(p.versements ?? []).map((v) => v.date)].filter((d) => d !== null && d !== undefined);
    if (!dates.every(estDateCivile)) throw new Error('une date du jeu de démonstration sort du calendrier');
  }
  return copie;
}

// --- Dossier unique, sans lien suivi ---

/** Dossier ORDINAIRE (ni lien symbolique, ni point de jonction : `lstat` ne suit pas le lien). */
export function estDossierOrdinaire(chemin) {
  try { const s = fs.lstatSync(chemin); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; }
}
/** Existe-t-il quelque chose à ce chemin (lien compris, sans le suivre) ? */
const existeSansSuivre = (chemin) => { try { fs.lstatSync(chemin); return true; } catch { return false; } };
/** Chemin de `rel` sous `base`, après vérification que base et CHAQUE composant intermédiaire sont des dossiers ordinaires. Sinon null. */
function cheminOrdinaire(base, rel) {
  if (!estDossierOrdinaire(base)) return null;
  let courant = base;
  for (const nom of rel.split('/')) {
    courant = path.join(courant, nom);
    if (!estDossierOrdinaire(courant)) return null;
  }
  return courant;
}

/** Vérifie que le dossier unique et ses sous-dossiers sont ordinaires et que leur chemin réel est celui attendu. Lève une erreur claire. */
export function verifierDossierDemo(dossiers) {
  const refus = (chemin) => new Error(`Démonstration refusée : « ${chemin} » est un lien ou un point de jonction (ou n'est pas un dossier ordinaire). Rien n'a été touché.`);
  if (!estDossierOrdinaire(dossiers.base)) throw refus(dossiers.base);
  const baseReelle = fs.realpathSync(dossiers.base);
  for (const nom of SOUS_DOSSIERS) {
    const chemin = dossiers[nom];
    if (!estDossierOrdinaire(chemin)) throw refus(chemin);
    if (!memeChemin(fs.realpathSync(chemin), path.join(baseReelle, nom))) throw refus(chemin);
  }
}

/**
 * Crée le dossier unique (mkdtemp) et donnees/, logs/, verrou/ (0700 là où l'OS gère les droits), puis les vérifie.
 * Si la vérification échoue, retire ce qui vient d'être créé (fichiers vides seulement) et relève l'erreur.
 */
export function creerDossierDemo(tmp = os.tmpdir()) {
  const base = fs.mkdtempSync(path.join(tmp, PREFIXE_DOSSIER_DEMO));
  const dossiers = { base, donnees: path.join(base, 'donnees'), logs: path.join(base, 'logs'), verrou: path.join(base, 'verrou') };
  try {
    if (!EST_WINDOWS) fs.chmodSync(base, 0o700);
    for (const nom of SOUS_DOSSIERS) fs.mkdirSync(dossiers[nom], { mode: 0o700 }); // PAS recursive : un dossier déjà présent est une erreur
    verifierDossierDemo(dossiers);
  } catch (err) {
    retirerDossierDemo(base);
    throw err;
  }
  return dossiers;
}

/** Écrit le jeu de démonstration (datée du jour) dans `donnees/` : création exclusive, jamais par-dessus un fichier ou un lien. */
export function ecrireJeuDemo(dossiers, aujourdHui, jeuBase = JSON.parse(fs.readFileSync(path.join(RACINE, 'config', 'exemple.json'), 'utf8'))) {
  verifierDossierDemo(dossiers); // juste avant d'écrire : rien n'a été remplacé par un lien depuis la création
  const jeu = jeuDuJour(jeuBase, aujourdHui);
  fs.writeFileSync(path.join(dossiers.donnees, FICHIER_DONNEES), `${JSON.stringify(jeu, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return jeu;
}

/**
 * Retire le dossier de démonstration SANS RÉCURSION ET SANS SUIVRE DE LIEN : dans donnees/sauvegardes, donnees, logs et verrou (et
 * seulement s'ils sont des dossiers ordinaires, tout le chemin vérifié par `lstat`), supprime un à un les fichiers ordinaires, puis
 * les dossiers vides en remontant, puis `base`. Tout ce qui n'est pas un fichier ordinaire (lien, jonction, dossier inattendu) est laissé.
 * Renvoie la liste des chemins restants (vide = tout est retiré). Ne lève jamais d'erreur.
 */
export function retirerDossierDemo(base) {
  const restes = [];
  if (!existeSansSuivre(base)) return []; // déjà retiré
  if (!estDossierOrdinaire(base)) return [base]; // lien, jonction ou fichier : on n'y touche pas
  for (const rel of ['donnees/sauvegardes', 'donnees', 'logs', 'verrou']) {
    const chemin = path.join(base, ...rel.split('/'));
    if (!existeSansSuivre(chemin)) continue;
    const dossier = cheminOrdinaire(base, rel);
    if (dossier === null) { restes.push(chemin); continue; } // lien, jonction ou fichier : on n'y touche pas
    let noms = [];
    try { noms = fs.readdirSync(dossier); } catch { restes.push(dossier); continue; }
    for (const nom of noms) {
      const f = path.join(dossier, nom);
      try { if (fs.lstatSync(f).isFile()) fs.unlinkSync(f); } catch { /* verrouillé : il restera */ }
    }
    try { fs.rmdirSync(dossier); } catch { restes.push(dossier); } // rmdir ne supprime qu'un dossier VIDE
  }
  try { fs.rmdirSync(base); } catch { restes.push(base); }
  return restes;
}

function nettoyerEtSignaler(base) {
  const restes = retirerDossierDemo(base);
  if (restes.length > 0) {
    try { fs.writeSync(2, `Le dossier temporaire de démonstration n'a pas pu être entièrement supprimé : ${base} (données fictives, sans danger ; vous pouvez le supprimer vous-même).\n`); } catch { /* rien à faire */ }
  }
}

async function choisirPort() {
  for (let p = PORT_DEMO_MIN(); p <= PORT_DEMO_MAX(); p++) if (await portEstLibre(p)) return p;
  return await new Promise((resolve, reject) => {
    const sonde = http.createServer();
    sonde.once('error', reject);
    sonde.listen(0, ADRESSE, () => { const { port } = sonde.address(); sonde.close(() => resolve(port)); });
  });
}

export async function main() {
  // 1. Dossier de données réel configuré (environnement + .env, sans rien écraser ni écrire) : sert uniquement au garde-fou.
  const fichierEnv = path.join(RACINE, '.env');
  if (fs.existsSync(fichierEnv)) { try { process.loadEnvFile(fichierEnv); } catch { /* .env illisible : le garde-fou se base sur l'environnement */ } }
  let dossierReel;
  try { dossierReel = lireConfig(process.env).dossier; } catch { dossierReel = path.join(RACINE, 'data'); }

  // 2. Dossier unique de ce lancement, vérifié (aucun lien suivi).
  let dossiers;
  try {
    dossiers = creerDossierDemo();
  } catch (err) {
    console.error(String(err?.message ?? '').startsWith('Démonstration refusée') ? err.message : `Démonstration impossible : le dossier temporaire n'a pas pu être préparé (${err?.code ?? err?.name ?? 'erreur'}). Rien n'a été touché.`);
    return 1;
  }
  const { base, donnees, logs: dossierLogs, verrou: dossierVerrou } = dossiers;
  if (demoTouheLesDonneesReelles(base, dossierReel) || demoTouheLesDonneesReelles(base, path.join(RACINE, 'data'))) {
    nettoyerEtSignaler(base);
    console.error(`Démonstration refusée : son dossier (${base}) correspond au dossier de données réel. Rien n'a été touché.`);
    return 1;
  }

  // 3. Jeu fictif daté d'aujourd'hui.
  try {
    ecrireJeuDemo(dossiers, aujourdHuiLocal(new Date()));
  } catch (err) {
    nettoyerEtSignaler(base);
    console.error(String(err?.message ?? '').startsWith('Démonstration refusée') ? err.message : `Démonstration impossible : le jeu fictif n'a pas pu être préparé (${err?.code ?? err?.name ?? 'erreur'}). Rien n'a été touché.`);
    return 1;
  }

  let nettoyageArme = false;
  try {
  // 4. Port libre, puis variables IMPOSÉES (avant le chargement du serveur, qui ne remplace jamais une variable déjà définie).
  const port = await choisirPort();
  Object.assign(process.env, {
    ERGO_DATA_DIR: donnees,
    ERGO_LOG_DIR: dossierLogs,
    ERGO_VERROU_DIR: dossierVerrou,
    ERGO_PORT: String(port),
    ERGO_MODE_DEMO: '1', // /api/etat annonce la démonstration : l'interface affiche « Données d'exemple »
    ERGO_ARRET_AUTO: '1',
    ERGO_ARRET_DELAI_FERMETURE_S: '10',
    ERGO_ARRET_DELAI_PULSATION_S: '600',
    ERGO_ARRET_DELAI_PREMIERE_PAGE_S: '300',
  });
  const url = `http://${ADRESSE}:${port}/`;
  console.log(`\n${MESSAGE_DEMO}\nAdresse : ${url}\n`);

  // 5. Le serveur démarre dans ce processus ; il s'arrête avec lui (Ctrl+C, fermeture de la page, POST /api/arreter), libère son verrou,
  //    puis notre nettoyage s'exécute (enregistré APRÈS l'import du serveur : son propre nettoyage passe d'abord). Synchrone, sans récursion.
  await import('../src/server.js');
  process.on('exit', () => nettoyerEtSignaler(base));
  nettoyageArme = true;
  for (let i = 0; i < 100; i++) {
    if (await estNotreApplication(port)) {
      await ouvrirNavigateur(url, { info: (m) => console.log(m) });
      return null; // le serveur garde le processus en vie
    }
    await pause(300);
  }
  console.error('La démonstration n\'a pas répondu à temps (voir le journal du dossier de démonstration).');
  return 1; // le processus sort : le nettoyage s'exécute
  } catch (err) {
    if (!nettoyageArme) nettoyerEtSignaler(base); // échec avant l'enregistrement du nettoyage de sortie
    throw err;
  }
}

// Lancé directement (`node scripts/demo.mjs`) ; importé par suivi.mjs ou les tests : ne fait rien à l'import.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then((code) => { if (code !== null) process.exit(code); }, (err) => {
    console.error(`Erreur inattendue (${err?.code ?? err?.name ?? 'inconnue'}).`);
    process.exit(1);
  });
}

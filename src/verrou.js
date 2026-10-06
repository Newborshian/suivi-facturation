// Verrou d'instance : une seule application active par dossier de données (quel que soit le port).
// Fichier LOCAL à la machine, jamais dans le dossier de données (synchronisé par le cloud). Dossier : ERGO_VERROU_DIR s'il est défini ; sinon un dossier
// PROPRE À L'UTILISATEUR, créé en 0700 : Windows et macOS, sous-dossier « suivi-facturation-verrous » du dossier temporaire de l'utilisateur ;
// Linux, $XDG_RUNTIME_DIR/suivi-facturation, à défaut ~/.local/state/suivi-facturation/verrous. Ce dossier par défaut est REFUSÉ (ErreurConfig, code 2)
// s'il n'appartient pas à l'utilisateur courant ou s'il est modifiable par le groupe ou les autres ; un fichier verrou d'un autre propriétaire l'est aussi
// (contrôles faits seulement là où process.getuid existe).
// Nom : suivi-facturation-<16 premiers caractères hexa du SHA-256 du chemin réel du dossier de données>.verrou
// Contenu JSON minimal, aucune donnée de patient : { pid, port, demarreLe, version, dossier }.
//
// API publique (importable par les scripts) :
//   cheminVerrou(dossierDonnees, { env })            -> chemin du fichier verrou (sans accès au verrou lui-même)
//   lireVerrou(dossierDonnees, { env, delaiSondeMs }) -> { statut: 'absent' | 'actif' | 'perime' | 'bloque', pid, port, demarreLe, version, dossier }
//        absent = pas de fichier ; perime = PID mort ; actif = PID vivant ET /api/sante répond « suivi-facturation » ;
//        bloque = PID vivant mais aucune réponse valide (instance bloquée), ou fichier verrou présent mais impossible à lire après les réessais
//                 (jamais supprimé dans ce cas). Si le processus de ce PID a démarré APRÈS l'heure inscrite dans le verrou, le PID a été réutilisé
//                 (redémarrage de l'ordinateur) : le verrou est alors « perime ». Heure de démarrage inconnue : règle « bloque » conservée, avertissement au journal.
//   acquerirVerrou({ dossierDonnees, port, version, env, journal }) ->   (port : null au démarrage ; mettreAJourPort le renseigne quand le serveur écoute)
//      { statut: 'acquis', repris, ancien } | { statut: 'actif', verrou } | { statut: 'bloque', verrou }
//        repris = true si un verrou périmé a été remplacé (arrêt précédent anormal). Lève ErreurConfig (code 2, fail closed) si le verrou ne peut pas être créé ;
//        ne lève JAMAIS une autre erreur (une simple contention de fichiers ne donne jamais un code de sortie 1).
//   mettreAJourPort({ dossierDonnees, port, env, journal }) -> met à jour le port d'écoute (seulement si le verrou porte notre PID) ; ne lève pas, renvoie false en cas d'échec
//   libererVerrou({ dossierDonnees, env, pid, journal })    -> supprime le verrou s'il porte encore notre PID ; synchrone (utilisable dans `exit`)
// Toute opération fichier réessaie sur EPERM / EBUSY / EACCES (Windows : fichier tenu un instant par un autre processus) et sur un contenu JSON
// incomplet, avec une attente aléatoire de 10 à 60 ms, jusqu'à 2 s. Chaque série de réessais épuisée est écrite au journal avec le code d'erreur réel.
// Un verrou « bloque » n'est JAMAIS supprimé ni tué automatiquement. Il ne protège pas entre deux ordinateurs.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { RACINE_PROJET, ErreurConfig, cheminReel, refuserEmplacementInterdit } from './config.js';
import { MODE_DOSSIER } from './droits.js';

export const DELAI_SONDE_MS = 1500;
/** Un verrou plus récent que ça dont le serveur ne répond pas encore est un démarrage en cours (sauvegarde, nettoyage...), pas une instance bloquée. */
export const PATIENCE_DEMARRAGE_MS = 15_000;
const TENTATIVES_REPRISE = 3;
/** Erreurs de système de fichiers transitoires sous Windows (fichier tenu un instant par un autre processus, antivirus, indexeur). */
const TRANSITOIRES = ['EPERM', 'EBUSY', 'EACCES'];
/** Réessais : attente aléatoire entre minMs et maxMs, jusqu'à dureeMs au total. */
export const REESSAI = { dureeMs: 2000, minMs: 10, maxMs: 60 };
/** Un processus qui a démarré plus de ce délai après l'heure inscrite dans le verrou n'est pas celui qui l'a écrit (PID réutilisé). */
export const MARGE_DEMARRAGE_MS = 5000;
const DELAI_COMMANDE_MS = 5000;
const NOM_DOSSIER_VERROUS = 'suivi-facturation-verrous';

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dormirSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const attente = (reessai) => reessai.minMs + Math.random() * (reessai.maxMs - reessai.minMs);
const estDans = (parent, enfant) => {
  const rel = path.relative(parent, enfant);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Contexte des opérations : système de fichiers (remplaçable par un faux dans les tests), journal facultatif, paramètres de réessai. */
const uidCourant = () => (typeof process.getuid === 'function' ? process.getuid() : null);
const contexte = ({ fsApi = fs, journal = null, reessai = REESSAI, uid = uidCourant(), demarrageProcessus = lireDemarrageProcessus } = {}) =>
  ({ fs: fsApi, journal, reessai, uid, demarrage: memoriserParPid(demarrageProcessus), inconnus: new Set() });
/** Une seule lecture de l'heure de démarrage par PID et par opération (la commande peut durer un moment). */
function memoriserParPid(lire) {
  const memoire = new Map();
  return (pid) => {
    if (!memoire.has(pid)) memoire.set(pid, Promise.resolve().then(() => lire(pid)));
    return memoire.get(pid);
  };
}

function signaler(ctx, nom, err, essais) {
  try { ctx.journal?.avert(`Verrou : « ${nom} » en échec après ${essais} essai(s) sur ${ctx.reessai.dureeMs} ms (${err?.code ?? err?.name ?? 'erreur'}).`); } catch { /* le journal ne doit jamais gêner */ }
}

/** Exécute `op` (synchrone) ; réessaie sur les erreurs transitoires. Après épuisement : journal puis relance de la dernière erreur. */
async function essayer(ctx, nom, op) {
  const fin = Date.now() + ctx.reessai.dureeMs;
  for (let essais = 1; ; essais++) {
    try {
      return op();
    } catch (err) {
      if (!TRANSITOIRES.includes(err.code)) throw err;
      if (Date.now() >= fin) { signaler(ctx, nom, err, essais); throw err; }
      await dormir(attente(ctx.reessai));
    }
  }
}

function essayerSync(ctx, nom, op) {
  const fin = Date.now() + ctx.reessai.dureeMs;
  for (let essais = 1; ; essais++) {
    try {
      return op();
    } catch (err) {
      if (!TRANSITOIRES.includes(err.code)) throw err;
      if (Date.now() >= fin) { signaler(ctx, nom, err, essais); throw err; }
      dormirSync(attente(ctx.reessai));
    }
  }
}

/** Dossier par défaut, propre à l'utilisateur (voir l'en-tête). */
function dossierVerrousParDefaut(env, { plateforme = process.platform, tmp = os.tmpdir(), maison = os.homedir() } = {}) {
  if (plateforme === 'win32' || plateforme === 'darwin') return path.join(tmp, NOM_DOSSIER_VERROUS);
  const xdg = (env.XDG_RUNTIME_DIR ?? '').trim();
  if (xdg !== '' && path.isAbsolute(xdg)) return path.join(xdg, 'suivi-facturation');
  return path.join(maison, '.local', 'state', 'suivi-facturation', 'verrous');
}

/**
 * Dossier des verrous : ERGO_VERROU_DIR (refusé dans public/ et src/, et dans le projet hors .tmp/), liens et jonctions résolus ou le dossier propre à l'utilisateur.
 * -> { dossier, parDefaut }
 */
function dossierVerrous(env, systeme = {}, racine = RACINE_PROJET) {
  const brut = (env.ERGO_VERROU_DIR ?? '').trim();
  if (brut === '') return { dossier: dossierVerrousParDefaut(env, systeme), parDefaut: true };
  const dossier = path.resolve(racine, brut);
  refuserEmplacementInterdit(dossier, racine, { sujet: 'ERGO_VERROU_DIR', admis: ['.tmp'] });
  return { dossier, parDefaut: false };
}

/** Le dossier par défaut doit appartenir à l'utilisateur courant et n'être modifiable ni par le groupe ni par les autres : sinon échec fermé (code 2). */
function controlerDossierPrive(ctx, dossier) {
  if (ctx.uid === null) return; // Windows : les droits viennent du profil de l'utilisateur
  let st;
  try {
    st = ctx.fs.lstatSync(dossier);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw new ErreurConfig(`Le dossier des verrous ne peut pas être contrôlé (${err.code ?? 'erreur'}) : ${dossier}. Définissez ERGO_VERROU_DIR vers un dossier qui vous appartient.`);
  }
  if (!st.isDirectory()) throw new ErreurConfig(`Le dossier des verrous n'est pas un dossier ordinaire (lien ou fichier) : ${dossier}. Supprimez-le ou définissez ERGO_VERROU_DIR vers un dossier qui vous appartient.`);
  if (st.uid !== ctx.uid) throw new ErreurConfig(`Le dossier des verrous n'appartient pas à l'utilisateur courant : ${dossier}. L'application ne démarre pas. Définissez ERGO_VERROU_DIR vers un dossier qui vous appartient.`);
  if ((st.mode & 0o022) !== 0) throw new ErreurConfig(`Le dossier des verrous est modifiable par d'autres comptes : ${dossier}. L'application ne démarre pas. Retirez ces droits (chmod 700) ou définissez ERGO_VERROU_DIR vers un dossier privé.`);
}

function resoudreVerrou(dossierDonnees, env, systeme) {
  const { dossier, parDefaut } = dossierVerrous(env, systeme);
  const reel = cheminReel(dossierDonnees);
  if (estDans(reel, cheminReel(dossier))) throw new ErreurConfig(`Le fichier verrou ne peut pas se trouver dans le dossier de données : ${dossier}`);
  const empreinte = crypto.createHash('sha256').update(process.platform === 'win32' ? reel.toLowerCase() : reel).digest('hex').slice(0, 16);
  return { chemin: path.join(dossier, `suivi-facturation-${empreinte}.verrou`), dossier, parDefaut };
}

export function cheminVerrou(dossierDonnees, { env = process.env, systeme } = {}) {
  return resoudreVerrou(dossierDonnees, env, systeme).chemin;
}

const pidVivant = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // EPERM = le processus existe mais appartient à un autre utilisateur
  }
};

const contenuValide = (v) => v && typeof v === 'object' && Number.isSafeInteger(v.pid);

/**
 * Lecture brute : objet, null si absent, `{ invalide: true }` si le contenu reste illisible jusqu'à la fin des réessais (écriture jamais terminée),
 * `{ inaccessible: true }` si le fichier existe mais ne peut pas être ouvert (EPERM / EBUSY / EACCES persistant : il appartient peut-être à une instance vivante).
 */
async function lireBrut(ctx, chemin) {
  const fin = Date.now() + ctx.reessai.dureeMs;
  let derniere = null;
  for (;;) {
    let texte;
    try {
      texte = ctx.fs.readFileSync(chemin, 'utf8');
      if (ctx.uid !== null && ctx.fs.statSync(chemin).uid !== ctx.uid) {
        throw new ErreurConfig(`Le fichier verrou n'appartient pas à l'utilisateur courant : ${chemin}. L'application ne démarre pas et ne le touche pas. Définissez ERGO_VERROU_DIR vers un dossier qui vous appartient.`);
      }
      derniere = null;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      if (!TRANSITOIRES.includes(err.code)) throw err;
      derniere = err;
    }
    if (texte !== undefined) {
      try {
        const v = JSON.parse(texte);
        if (contenuValide(v)) return v;
      } catch { /* en cours d'écriture ? */ }
    }
    if (Date.now() >= fin) break;
    await dormir(attente(ctx.reessai));
  }
  if (derniere) {
    signaler(ctx, 'lecture du verrou', derniere, 0);
    return { inaccessible: true };
  }
  return { invalide: true };
}

/** L'application répond-elle sur ce port ? (node:http plutôt que fetch : pas de connexion gardée ouverte, sortie du processus sans risque) */
function sonder(port, delaiMs) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(null);
  return new Promise((resolve) => {
    let termine = false;
    const fin = (valeur) => {
      if (termine) return;
      termine = true;
      clearTimeout(minuteur);
      req.destroy();
      resolve(valeur);
    };
    const req = http.get({ host: '127.0.0.1', port, path: '/api/sante', agent: false, headers: { Connection: 'close' } }, (res) => {
      const morceaux = [];
      let taille = 0;
      res.on('data', (m) => {
        taille += m.length;
        if (taille > 4096) return fin(null);
        morceaux.push(m);
      });
      res.on('end', () => {
        try {
          const corps = JSON.parse(Buffer.concat(morceaux).toString('utf8'));
          fin(corps?.application === 'suivi-facturation' ? corps : null);
        } catch {
          fin(null);
        }
      });
      res.on('error', () => fin(null));
    });
    const minuteur = setTimeout(() => fin(null), delaiMs);
    req.on('error', () => fin(null));
  });
}

const verrouPublic = (statut, v = {}) => ({ statut, pid: v.pid ?? null, port: v.port ?? null, demarreLe: v.demarreLe ?? null, version: v.version ?? null, dossier: v.dossier ?? null });

async function evaluer(ctx, chemin, delaiSondeMs) {
  const v = await lireBrut(ctx, chemin);
  if (v === null) return verrouPublic('absent');
  if (v.inaccessible) return { ...verrouPublic('bloque'), transitoire: true }; // présent mais illisible : on ne conclut ni « périmé » ni « libre »
  if (v.invalide || !pidVivant(v.pid)) return verrouPublic('perime', v.invalide ? {} : v);
  if (await sonder(v.port, delaiSondeMs)) return verrouPublic('actif', v);
  // PID vivant sans réponse : instance bloquée, OU PID réutilisé par un autre processus après un redémarrage (le verrou survit dans le dossier temporaire).
  return verrouPublic((await processusPlusRecentQueLeVerrou(ctx, v)) ? 'perime' : 'bloque', v);
}

/** Le processus de ce PID a-t-il démarré après l'heure inscrite dans le verrou (à la marge près) ? Inconnu : false, avec un avertissement discret (une fois par PID). */
async function processusPlusRecentQueLeVerrou(ctx, v) {
  const ecrit = Date.parse(v.demarreLe ?? '');
  if (!Number.isFinite(ecrit)) return false;
  let debut = null;
  let code = 'inconnue';
  try {
    debut = await ctx.demarrage(v.pid);
  } catch (err) {
    code = err?.code ?? err?.name ?? code;
  }
  if (!(debut instanceof Date) || Number.isNaN(debut.getTime())) {
    if (!ctx.inconnus.has(v.pid) && !avertisInconnus.has(v.pid)) {
      ctx.inconnus.add(v.pid);
      avertisInconnus.add(v.pid);
      try { ctx.journal?.avert(`Verrou : heure de démarrage du processus ${v.pid} inconnue (${code}) ; un PID réutilisé après un redémarrage ne peut pas être distingué.`); } catch { /* le journal ne doit jamais gêner */ }
    }
    return false;
  }
  return debut.getTime() > ecrit + MARGE_DEMARRAGE_MS;
}
const avertisInconnus = new Set(); // par processus : l'avertissement n'est pas répété à chaque lecture

/** Exécute une commande (sans fenêtre, durée limitée) ; renvoie sa sortie standard. */
function executerCommande(commande, args) {
  return new Promise((resolve, reject) => {
    execFile(commande, args, { windowsHide: true, timeout: DELAI_COMMANDE_MS, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }, (err, sortie) => (err ? reject(err) : resolve(sortie)));
  });
}

/** Linux : champ `starttime` (22e) de /proc/<pid>/stat, en battements d'horloge depuis le démarrage du système (btime, secondes, de /proc/stat). */
export function analyserDemarrageLinux(contenuStat, contenuProcStat, hz = 100) {
  const apresNom = contenuStat.slice(contenuStat.lastIndexOf(')') + 2).split(' '); // le nom du processus (entre parenthèses) peut contenir des espaces
  const battements = Number(apresNom[19]);
  const btime = Number(/^btime (\d+)$/m.exec(contenuProcStat)?.[1]);
  if (!Number.isFinite(battements) || !Number.isFinite(btime)) return null;
  return new Date((btime + battements / hz) * 1000);
}

/**
 * Heure de démarrage du processus `pid` (Date), ou null si elle ne peut pas être lue (processus parti, permission, commande absente).
 * Windows : PowerShell (StartTime, UTC) ; Linux : /proc ; macOS et autres : `ps -o lstart=`. Toujours borné dans le temps, sans fenêtre visible.
 * `executer` et `lireFichier` sont remplaçables dans les tests.
 */
export async function lireDemarrageProcessus(pid, { plateforme = process.platform, executer = executerCommande, lireFichier = (c) => fs.readFileSync(c, 'utf8') } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (plateforme === 'win32') {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const commande = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')`;
    const sortie = (await executer(powershell, ['-NoProfile', '-NonInteractive', '-Command', commande])).trim();
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(sortie) ? new Date(sortie) : null;
  }
  if (plateforme === 'linux') {
    try {
      const date = analyserDemarrageLinux(lireFichier(`/proc/${pid}/stat`), lireFichier('/proc/stat'));
      if (date) return date;
    } catch { /* /proc indisponible : repli sur ps */ }
  }
  const date = new Date((await executer('ps', ['-o', 'lstart=', '-p', String(pid)])).trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function lireVerrou(dossierDonnees, { env = process.env, delaiSondeMs = DELAI_SONDE_MS, journal = null, fsApi, reessai, uid, demarrageProcessus, systeme } = {}) {
  const ctx = contexte({ fsApi, journal, reessai, uid, demarrageProcessus });
  const { chemin, dossier, parDefaut } = resoudreVerrou(dossierDonnees, env, systeme);
  if (parDefaut) controlerDossierPrive(ctx, dossier);
  const { transitoire, ...v } = await evaluer(ctx, chemin, delaiSondeMs);
  return v;
}

function creerFichier(ctx, chemin, contenu) {
  const fd = ctx.fs.openSync(chemin, 'wx', 0o600); // atomique : un seul processus gagne
  try {
    ctx.fs.writeSync(fd, contenu);
  } catch (err) {
    try { ctx.fs.closeSync(fd); } catch { /* ignoré */ }
    try { ctx.fs.unlinkSync(chemin); } catch { /* ignoré : un fichier incomplet sera jugé périmé */ }
    throw err;
  }
  ctx.fs.closeSync(fd);
}

/** Création exclusive avec réessais. 'cree' | 'existe' (EEXIST : un autre l'a) | 'impossible' (erreur transitoire persistante, déjà journalisée). Autre erreur : relancée. */
async function creerAvecReessais(ctx, nom, chemin, contenu) {
  try {
    await essayer(ctx, nom, () => creerFichier(ctx, chemin, contenu));
    return 'cree';
  } catch (err) {
    if (err.code === 'EEXIST') return 'existe';
    if (TRANSITOIRES.includes(err.code)) return 'impossible';
    throw err;
  }
}

/** Verrou de reprise : un seul processus à la fois supprime un verrou périmé (évite d'effacer le verrou frais d'un autre). */
async function avecReprise(ctx, chemin, tache) {
  const mutex = `${chemin}.reprise`;
  const fin = Date.now() + 5000 + ctx.reessai.dureeMs;
  for (;;) {
    const r = await creerAvecReessais(ctx, 'mutex de reprise', mutex, String(process.pid));
    if (r === 'cree') break;
    if (r === 'impossible') throw new ErreurConfig('Impossible de reprendre le verrou périmé (fichier de reprise inaccessible).');
    try { if (Date.now() - ctx.fs.statSync(mutex).mtimeMs > 10_000) ctx.fs.unlinkSync(mutex); } catch { /* déjà parti */ }
    if (Date.now() > fin) throw new ErreurConfig('Impossible de reprendre le verrou périmé (un autre démarrage est en cours).');
    await dormir(attente(ctx.reessai));
  }
  try {
    return await tache();
  } finally {
    try { await essayer(ctx, 'suppression du mutex de reprise', () => ctx.fs.unlinkSync(mutex)); } catch { /* déjà parti, ou illisible : périmé après 10 s */ }
  }
}

/** État final après épuisement des tentatives : 3 (actif), 4 (bloqué) ou 2 (fail closed : ErreurConfig). Jamais « erreur inattendue ». */
async function conclure(ctx, chemin, delaiSondeMs, raison) {
  const v = await evaluer(ctx, chemin, delaiSondeMs);
  if (v.statut === 'actif') return { statut: 'actif', verrou: v };
  if (v.statut === 'bloque') { const { transitoire, ...publique } = v; return { statut: 'bloque', verrou: publique }; }
  throw new ErreurConfig(`Le fichier verrou ne peut pas être créé ou repris (${raison}).`);
}

export async function acquerirVerrou({ dossierDonnees, port, version, env = process.env, delaiSondeMs = DELAI_SONDE_MS, patienceMs = PATIENCE_DEMARRAGE_MS, journal = null, fsApi, reessai, uid, demarrageProcessus, systeme } = {}) {
  const ctx = contexte({ fsApi, journal, reessai, uid, demarrageProcessus });
  const { chemin, dossier: dossierDesVerrous, parDefaut } = resoudreVerrou(dossierDonnees, env, systeme);
  const contenu = JSON.stringify({ pid: process.pid, port, demarreLe: new Date().toISOString(), version, dossier: cheminReel(dossierDonnees) });
  try {
    ctx.fs.mkdirSync(dossierDesVerrous, { recursive: true, mode: MODE_DOSSIER });
  } catch (err) {
    throw new ErreurConfig(`Le fichier verrou ne peut pas être créé (dossier des verrous inaccessible : ${err.code ?? 'erreur'}).`);
  }
  if (parDefaut) controlerDossierPrive(ctx, dossierDesVerrous); // échec fermé : dossier d'un autre propriétaire ou modifiable par d'autres comptes
  let ancien = null;
  let reprises = 0;
  const limite = Date.now() + patienceMs + 5000;
  try {
    for (;;) {
      const creation = await creerAvecReessais(ctx, 'création du verrou', chemin, contenu);
      if (creation === 'cree') return { statut: 'acquis', repris: ancien !== null, ancien };
      const v = await evaluer(ctx, chemin, delaiSondeMs);
      if (v.statut === 'absent') {
        if (creation === 'impossible') throw new ErreurConfig('Le fichier verrou ne peut pas être créé (accès refusé de façon persistante).');
        continue; // libéré entre-temps : on retente
      }
      if (v.statut === 'actif') return { statut: 'actif', verrou: v };
      if (v.statut === 'bloque') {
        const age = Date.now() - Date.parse(v.demarreLe ?? '');
        // Démarrage tout récent d'une autre instance (pas encore à l'écoute), ou verrou momentanément illisible : on attend, sans jamais agir dessus.
        if ((v.transitoire || (Number.isFinite(age) && age < patienceMs)) && Date.now() < limite) { await dormir(150); continue; }
        const { transitoire, ...publique } = v;
        return { statut: 'bloque', verrou: publique };
      }
      // perime : reprise, sous verrou de reprise, après nouvelle vérification (un autre démarrage a pu le reprendre).
      if (++reprises > TENTATIVES_REPRISE + 20) return await conclure(ctx, chemin, delaiSondeMs, 'trop de tentatives de reprise');
      await avecReprise(ctx, chemin, async () => {
        const encore = await evaluer(ctx, chemin, delaiSondeMs);
        if (encore.statut !== 'perime') return;
        ancien = encore;
        try { await essayer(ctx, 'suppression du verrou périmé', () => ctx.fs.unlinkSync(chemin)); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      });
    }
  } catch (err) {
    // Contention persistante ou erreur imprévue : on relit l'état et on conclut proprement (actif -> 3, bloqué -> 4, sinon ErreurConfig -> 2).
    if (!(err instanceof ErreurConfig)) { try { journal?.avert(`Verrou : erreur imprévue (${err?.code ?? err?.name ?? 'erreur'}), état relu.`); } catch { /* ignoré */ } }
    try {
      return await conclure(ctx, chemin, delaiSondeMs, err?.code ?? err?.name ?? 'erreur');
    } catch (suite) {
      if (suite instanceof ErreurConfig) throw err instanceof ErreurConfig ? err : suite;
      throw new ErreurConfig(`Le fichier verrou ne peut pas être créé (${suite?.code ?? 'erreur'}).`);
    }
  }
}

/** Lecture synchrone avec réessais (erreurs transitoires, contenu incomplet). null si absent ou toujours illisible. */
function lireSync(ctx, chemin) {
  const fin = Date.now() + ctx.reessai.dureeMs;
  for (;;) {
    let transitoire = null;
    try {
      const v = JSON.parse(ctx.fs.readFileSync(chemin, 'utf8'));
      if (contenuValide(v)) return v;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      if (TRANSITOIRES.includes(err.code)) transitoire = err;
    }
    if (Date.now() >= fin) {
      if (transitoire) signaler(ctx, 'lecture du verrou', transitoire, 0);
      return null;
    }
    dormirSync(attente(ctx.reessai));
  }
}

/** Met à jour le port d'écoute (réécriture atomique : fichier temporaire puis renommage, avec réessais). Sans effet si le verrou n'est plus le nôtre. Ne lève pas. */
export function mettreAJourPort({ dossierDonnees, port, env = process.env, pid = process.pid, journal = null, fsApi, reessai } = {}) {
  const ctx = contexte({ fsApi, journal, reessai });
  const chemin = cheminVerrou(dossierDonnees, { env });
  const v = lireSync(ctx, chemin);
  if (!v || v.pid !== pid || v.port === port) return false;
  const temporaire = `${chemin}.${pid}.${crypto.randomUUID()}.tmp`; // nom imprévisible + création exclusive : jamais d'écriture à travers un lien existant
  try {
    essayerSync(ctx, 'écriture du port', () => ctx.fs.writeFileSync(temporaire, JSON.stringify({ ...v, port }), { mode: 0o600, flag: 'wx' }));
    essayerSync(ctx, 'renommage du verrou', () => ctx.fs.renameSync(temporaire, chemin));
    return true;
  } catch (err) {
    try { ctx.fs.unlinkSync(temporaire); } catch { /* ignoré */ }
    try { journal?.avert(`Verrou : port d'écoute non enregistré (${err?.code ?? err?.name ?? 'erreur'}) ; le serveur continue, une autre instance conclura « bloquée » au lieu de « déjà lancée ».`); } catch { /* ignoré */ }
    return false;
  }
}

/** Supprime le verrou s'il contient encore notre PID (jamais celui d'une autre instance). Synchrone, ne lève jamais. */
export function libererVerrou({ dossierDonnees, env = process.env, pid = process.pid, journal = null, fsApi, reessai, systeme } = {}) {
  try {
    const ctx = contexte({ fsApi, journal, reessai });
    const chemin = cheminVerrou(dossierDonnees, { env, systeme });
    const v = lireSync(ctx, chemin);
    if (!v || v.pid !== pid) return false;
    essayerSync(ctx, 'suppression du verrou', () => ctx.fs.unlinkSync(chemin));
    return true;
  } catch {
    return false;
  }
}

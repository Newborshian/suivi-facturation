// Fonctions communes aux scripts du lanceur (lancer-silencieux.mjs, arreter.mjs, outils-lanceur.mjs, suivi.mjs).
// Aucune dépendance, aucun accès réseau hors de cet ordinateur (127.0.0.1 uniquement). Fonctionne sous Windows, Linux et macOS.
// Ce module ne fait rien à l'import : il ne contient que des fonctions.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RACINE_PROJET, PORT_DEFAUT as PORT_DEFAUT_SERVEUR, lireConfig } from '../src/config.js';
import { cheminVerrou } from '../src/verrou.js';

export const ADRESSE = '127.0.0.1';
export const PORT_DEFAUT = PORT_DEFAUT_SERVEUR; // 4780, défini une seule fois dans src/config.js
export const PORT_REPLI_MIN = 4781;
export const PORT_REPLI_MAX = 4799;
export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CODE_INSTANCE_BLOQUEE = 20; // lanceur et arrêt : une ancienne instance ne répond plus
export const CODE_ARRET_REFUSE = 21; // arrêt forcé refusé : le PID du verrou n'est pas un processus « node »

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Port demandé par l'environnement : { defini, port } ; port = null si la valeur est invalide. Vide = non défini (4780 par défaut). */
export function lirePortDemande(env = process.env) {
  const brut = (env.ERGO_PORT ?? '').trim();
  if (brut === '') return { defini: false, port: PORT_DEFAUT, brut };
  const port = Number(brut);
  const valide = /^\d+$/.test(brut) && Number.isInteger(port) && port >= 1 && port <= 65535;
  return { defini: true, port: valide ? port : null, brut };
}

/** Dossier de données tel que le serveur le calculera (même formule que src/config.js), sans jamais lever d'erreur. */
export function dossierDonnees(env = process.env) {
  try {
    return lireConfig(env).dossier;
  } catch {
    const brut = (env.ERGO_DATA_DIR ?? '').trim();
    return brut === '' ? path.join(RACINE_PROJET, 'data') : path.resolve(RACINE_PROJET, brut);
  }
}

/** Corps de GET /api/sante si c'est bien suivi-facturation qui répond sur ce port, sinon null. */
export function sonderSante(port) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return resolve(null);
    const requete = http.get({ host: ADRESSE, port, path: '/api/sante', timeout: 2000, agent: false, headers: { Connection: 'close' } }, (reponse) => {
      let texte = '';
      reponse.setEncoding('utf8');
      reponse.on('data', (morceau) => { if (texte.length < 2000) texte += morceau; });
      reponse.on('end', () => {
        try {
          const corps = JSON.parse(texte);
          resolve(reponse.statusCode === 200 && corps?.application === 'suivi-facturation' ? corps : null);
        } catch { resolve(null); }
      });
    });
    requete.on('timeout', () => requete.destroy());
    requete.on('error', () => resolve(null));
  });
}

export const estNotreApplication = async (port) => (await sonderSante(port)) !== null;

export function portEstLibre(port) {
  return new Promise((resolve) => {
    const sonde = http.createServer();
    sonde.once('error', () => resolve(false));
    sonde.listen(port, ADRESSE, () => sonde.close(() => resolve(true)));
  });
}

/** POST /api/arreter avec les en-têtes que le serveur exige (Host et Origin corrects). Renvoie le code HTTP, ou 0 en cas d'échec. */
export function demanderArret(port, delaiMs = 3000) {
  return new Promise((resolve) => {
    const requete = http.request({ host: ADRESSE, port, path: '/api/arreter', method: 'POST', timeout: delaiMs, headers: { Host: `${ADRESSE}:${port}`, Origin: `http://${ADRESSE}:${port}`, 'Content-Length': '0' } }, (reponse) => {
      reponse.resume();
      reponse.on('end', () => resolve(reponse.statusCode));
    });
    requete.on('timeout', () => requete.destroy());
    requete.on('error', () => resolve(0));
    requete.end();
  });
}

const essayerOuverture = (commande, args, options = {}) => new Promise((resolve) => {
  let fini = false;
  const termine = (valeur) => { if (!fini) { fini = true; resolve(valeur); } };
  let enfant;
  try {
    enfant = spawn(commande, args, { stdio: 'ignore', detached: true, windowsHide: true, ...options });
  } catch { return termine(false); }
  enfant.once('error', () => termine(false));
  enfant.once('spawn', () => { enfant.unref(); termine(true); });
});

/**
 * Ouvre le navigateur par défaut sur `url` (adresse construite par nos soins : 127.0.0.1 + port numérique, aucun risque d'injection).
 * win32 : `start` ; darwin : `open` ; linux : `xdg-open`, repli `gio open`, `sensible-browser`.
 * Renvoie true si une commande a été lancée, false sinon (alors l'adresse est donnée à `info`, sans erreur).
 * ERGO_LANCEUR_SANS_NAVIGATEUR=1 (essais) : n'ouvre rien.
 */
export async function ouvrirNavigateur(url, { info = () => {}, plateforme = process.platform } = {}) {
  if (process.env.ERGO_LANCEUR_SANS_NAVIGATEUR === '1') {
    info(`ouverture du navigateur ignorée (essai) : ${url}`);
    return false;
  }
  let candidats;
  if (plateforme === 'win32') candidats = [['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`]]];
  else if (plateforme === 'darwin') candidats = [['open', [url]]];
  else candidats = [['xdg-open', [url]], ['gio', ['open', url]], ['sensible-browser', [url]]];
  for (const [commande, args] of candidats) {
    const options = commande === 'cmd.exe' ? { windowsVerbatimArguments: true } : {};
    const ok = await essayerOuverture(commande, args, options);
    if (ok) {
      info(`navigateur ouvert sur ${url}`);
      return true;
    }
  }
  info(`aucun moyen d'ouvrir le navigateur trouvé : ouvrez votre navigateur à l'adresse ${url}`);
  return false;
}

/** Démarre `node src/server.js` détaché (survit au lanceur et à la fenêtre qui l'a lancé). windowsHide est sans effet hors Windows. */
export function demarrerServeurDetache(env = process.env) {
  return spawn(process.execPath, [path.join('src', 'server.js')], { cwd: RACINE, detached: true, windowsHide: true, stdio: 'ignore', env });
}

export function pidVivant(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Nom du programme d'un processus (par PID, jamais par nom), ou null s'il n'existe pas ou n'est pas lisible. */
export function nomProcessus(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      const m = /^"([^"]+)","(\d+)"/m.exec(r.stdout ?? '');
      return m && Number(m[2]) === pid ? m[1] : null;
    }
    if (process.platform === 'linux') {
      // Le programme réellement exécuté : plus fiable que `comm`, que certains environnements Linux réécrivent (nom de fil, titre du processus).
      try { return path.basename(fs.readlinkSync(`/proc/${pid}/exe`)); } catch { /* processus d'un autre compte ou /proc absent : repli sur ps */ }
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 10_000 });
    const nom = (r.stdout ?? '').trim();
    return r.status === 0 && nom !== '' ? path.basename(nom) : null;
  } catch {
    return null;
  }
}

export const estProgrammeNode = (nom) => typeof nom === 'string' && /^(node|nodejs)(\.exe)?$/i.test(nom); // « nodejs » : anciens paquets Debian/Ubuntu

// --- Verrou de lancement : un seul lanceur à la fois décide et démarre ---
// Dossier voisin du verrou d'instance (même dossier local à la machine), créé par mkdir (atomique), avec un fichier « pid » dedans.
// Périmé s'il a plus de 60 s ou si son PID est mort. Ce n'est qu'une optimisation : le verrou d'instance du serveur reste le garde-fou
// (un second serveur lancé par erreur sort avec le code 3, que le lanceur traite comme un succès).
export const AGE_MAX_LANCEMENT_MS = 60_000;

export function cheminVerrouLancement(dossier, env = process.env) {
  return `${cheminVerrou(dossier, { env })}.lancement`;
}

function nettoyerVerrouLancement(chemin) {
  try { fs.unlinkSync(path.join(chemin, 'pid')); } catch { /* absent */ }
  try { fs.rmdirSync(chemin); } catch { /* absent ou non vide : un autre l'a repris */ }
}

/**
 * Prend le verrou de lancement ; attend au plus `attenteMs` qu'un autre lanceur le libère.
 * Renvoie { obtenu, liberer() }. Si l'attente est dépassée : obtenu = false (on continue sans, le verrou d'instance protège).
 */
export async function prendreVerrouLancement(dossier, { env = process.env, attenteMs = 30_000 } = {}) {
  const chemin = cheminVerrouLancement(dossier, env);
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const limite = Date.now() + attenteMs;
  for (;;) {
    try {
      fs.mkdirSync(chemin);
      try { fs.writeFileSync(path.join(chemin, 'pid'), String(process.pid)); } catch { /* le dossier suffit */ }
      let libere = false;
      return {
        obtenu: true,
        chemin,
        liberer() {
          if (libere) return;
          libere = true;
          try {
            if (fs.readFileSync(path.join(chemin, 'pid'), 'utf8').trim() === String(process.pid)) nettoyerVerrouLancement(chemin);
          } catch { /* déjà parti */ }
        },
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let perime = false;
    try {
      const age = Date.now() - fs.statSync(chemin).mtimeMs;
      let pid = NaN;
      try { pid = Number(fs.readFileSync(path.join(chemin, 'pid'), 'utf8').trim()); } catch { /* pas encore écrit */ }
      perime = age > AGE_MAX_LANCEMENT_MS || (Number.isFinite(pid) ? !pidVivant(pid) : age > 5000);
    } catch { continue; } // libéré entre-temps
    if (perime) {
      nettoyerVerrouLancement(chemin);
      continue;
    }
    if (Date.now() >= limite) return { obtenu: false, chemin, liberer() {} };
    await pause(150);
  }
}

/** Message d'échec écrit par le lanceur : { journal, message } (ou null s'il n'y en a pas). */
export function lireMessageLanceur(env = process.env) {
  const chemin = (env.ERGO_LANCEUR_MESSAGE ?? '').trim() || path.join(RACINE, 'logs', 'message-lanceur.txt');
  try {
    const texte = fs.readFileSync(chemin, 'utf8').replace(/\r\n/g, '\n');
    const m = /^journal=([^\n]*)\n([\s\S]*)$/.exec(texte);
    return m ? { journal: m[1], message: m[2].trim() } : { journal: null, message: texte.trim() };
  } catch {
    return null;
  }
}

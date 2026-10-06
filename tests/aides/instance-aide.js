// Aides des tests d'instance unique : lancement de vrais processus `node src/server.js` (ports dynamiques, dossiers sous .tmp/tests/).
// Seuls les processus lancés ici sont arrêtés, par PID (jamais par nom).
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { RACINE, creerDossierTemp, supprimerDossierTemp } from './temp.js';
import { requeteBrute } from './serveur-aide.js';

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export const portLibre = () =>
  new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** Dossiers temporaires d'un scénario : données, journal, verrous (supprimés à la fin, fichier par fichier). */
export async function avecDossiers(fn) {
  const dossiers = { donnees: await creerDossierTemp('inst-donnees'), logs: await creerDossierTemp('inst-logs'), verrous: await creerDossierTemp('inst-verrous') };
  const lances = [];
  const lancer = (options) => {
    const s = lancerServeur({ ...dossiers, ...options });
    lances.push(s);
    return s;
  };
  try {
    return await fn({ ...dossiers, lancer, env: { ERGO_VERROU_DIR: dossiers.verrous } });
  } finally {
    for (const s of lances) {
      if (s.enfant.exitCode === null && s.enfant.signalCode === null) s.enfant.kill(); // processus lancé par ce test : arrêt par PID
      await Promise.race([s.fin, pause(5000)]);
    }
    for (const d of Object.values(dossiers)) await supprimerDossierTemp(d);
  }
}

/** Lance `node src/server.js` sans attendre. `fin` = promesse du code de sortie. */
export function lancerServeur({ donnees, logs, verrous, port, env = {} }) {
  const base = { ...process.env, ERGO_SANS_ENV: '1', ERGO_DATA_DIR: donnees, ERGO_LOG_DIR: logs, ERGO_VERROU_DIR: verrous, ERGO_PORT: String(port) };
  for (const nom of Object.keys(base)) if (nom.startsWith('ERGO_ARRET_')) delete base[nom];
  const enfant = spawn(process.execPath, [path.join(RACINE, 'src', 'server.js')], { cwd: RACINE, env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let sortie = '';
  enfant.stdout.on('data', (m) => (sortie += m));
  enfant.stderr.on('data', (m) => (sortie += m));
  const fin = new Promise((resolve) => enfant.on('close', (code, signal) => resolve(code ?? `signal ${signal}`)));
  return { enfant, pid: enfant.pid, port, fin, sortie: () => sortie };
}

/** Attend que ce serveur précis réponde sur /api/sante (même PID), ou lève si le processus s'arrête avant. */
export async function attendrePret(s, delaiMs = 15_000) {
  let termine = null;
  s.fin.then((code) => (termine = code));
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    if (termine !== null) throw new Error(`Le serveur s'est arrêté (code ${termine}) : ${s.sortie()}`);
    try {
      const r = await requeteBrute({ port: s.port, chemin: '/api/sante' });
      if (r.status === 200 && r.json?.pid === s.pid) return r.json;
    } catch { /* pas encore prêt */ }
    await pause(60);
  }
  throw new Error(`Le serveur n'a pas démarré. Sortie : ${s.sortie()}`);
}

/** Arrêt propre par le bouton (POST /api/arreter) ; renvoie le code de sortie. */
export async function arreterParBouton(s) {
  const r = await requeteBrute({ port: s.port, methode: 'POST', chemin: '/api/arreter', headers: { Origin: `http://127.0.0.1:${s.port}` } });
  if (r.status !== 202) throw new Error(`Arrêt refusé (${r.status})`);
  return Promise.race([s.fin, pause(10_000).then(() => { throw new Error(`Pas de sortie. Sortie : ${s.sortie()}`); })]);
}

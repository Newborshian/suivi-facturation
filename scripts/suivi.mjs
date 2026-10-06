// Point d'entrée unique en terminal (Windows, Linux, macOS). Détecte le système (process.platform) ; toute la logique est en Node.
//
//   node scripts/suivi.mjs lancer       démarre l'application en arrière-plan (sans fenêtre) et ouvre le navigateur
//   node scripts/suivi.mjs arreter      arrête l'application (arrêt propre) ; `arreter --forcer` si elle ne répond plus
//   node scripts/suivi.mjs raccourci    crée le raccourci (Bureau Windows, fichier .desktop Linux, application .app macOS)
//   node scripts/suivi.mjs diagnostic   démarre l'application au premier plan / dans une fenêtre visible, avec les messages en direct
//   node scripts/suivi.mjs demo       essaie l'application sur des données fictives (rien n'est conservé), `npm run demo`
//   node scripts/suivi.mjs aide         affiche ce mode d'emploi
//
// Aucune dépendance, aucun accès réseau hors de cet ordinateur (127.0.0.1 uniquement).
// Linux et macOS : non vérifié sur le système réel (développé et essayé sous Windows).
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawn, spawnSync } from 'node:child_process';
import { RACINE, CODE_INSTANCE_BLOQUEE, lireMessageLanceur } from './lib-lanceur.mjs';

const SCRIPTS = path.join(RACINE, 'scripts');
const AIDE = `suivi-facturation : commandes disponibles

  node scripts/suivi.mjs lancer       Démarre l'application en arrière-plan et ouvre le navigateur.
                                      Si elle tourne déjà, ouvre simplement la page.
  node scripts/suivi.mjs arreter      Arrête l'application proprement.
                                      Avec --forcer : arrête aussi une copie qui ne répond plus (après confirmation).
  node scripts/suivi.mjs raccourci    Crée le raccourci du système (Windows : Bureau ; Linux : fichier .desktop ;
                                      macOS : application « Suivi Facturation.app » sur le Bureau).
  node scripts/suivi.mjs diagnostic   Démarre l'application avec les messages visibles (Windows : nouvelle fenêtre ;
                                      Linux et macOS : dans ce terminal, Ctrl+C pour arrêter).
  node scripts/suivi.mjs demo         Essaie l'application sur des données FICTIVES (dossier temporaire, rien n'est conservé,
                                      jamais vos vraies données). S'arrête à la fermeture de la page ou par Ctrl+C.
  node scripts/suivi.mjs aide         Affiche ce texte.

Variables utiles : ERGO_DATA_DIR, ERGO_PORT (voir scripts/env.exemple et docs/exploitation.md).
Linux et macOS : non vérifié sur le système réel.
`;

const MESSAGES_ARRET = {
  0: "L'application est arrêtée.",
  10: "L'application n'était pas lancée.",
  11: "Le port de l'application est pris par un autre logiciel : suivi-facturation n'est pas lancé. Rien n'a été arrêté.",
  12: "Le numéro de port (ERGO_PORT) du fichier .env n'est pas valide. Corrigez-le, puis réessayez.",
  20: "L'application ne répond plus et n'a pas été arrêtée (rien n'a été touché).",
  21: "L'ancienne copie n'a pas été arrêtée : le processus concerné ne ressemble pas à l'application (rien n'a été touché).",
};

const executer = (script, args = []) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { stdio: 'inherit', windowsHide: true, cwd: RACINE }).status ?? 1;

async function oui(question) {
  if (process.env.SUIVI_FORCER_OUI === '1') return true;
  if (process.env.ERGO_LANCEUR_SANS_BOITE === '1' || !process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const reponse = (await rl.question(`${question} (o = oui, n = non) : `)).trim().toLowerCase();
    return reponse === 'o' || reponse === 'oui';
  } finally {
    rl.close();
  }
}

function afficherMessageLanceur(code) {
  const m = lireMessageLanceur();
  console.error(m?.message || `L'application n'a pas pu démarrer (code ${code}).`);
  if (m?.journal) console.error(`Journal : ${m.journal}`);
}

async function lancer() {
  let code = executer('lancer-silencieux.mjs');
  if (code === CODE_INSTANCE_BLOQUEE) {
    afficherMessageLanceur(code);
    if (!(await oui("L'arrêter et la relancer ?"))) return code;
    const arret = executer('arreter.mjs', ['--forcer']);
    if (arret !== 0) {
      console.error(MESSAGES_ARRET[arret] ?? `L'ancienne copie n'a pas pu être arrêtée (code ${arret}).`);
      return arret;
    }
    code = executer('lancer-silencieux.mjs');
  }
  if (code !== 0) afficherMessageLanceur(code);
  return code;
}

async function arreter(args) {
  let code = executer('arreter.mjs', args);
  if (code === CODE_INSTANCE_BLOQUEE && !args.includes('--forcer')) {
    console.error("L'application ne répond plus. Une ancienne copie est toujours présente mais ne réagit plus (vos données ne sont pas touchées).");
    if (await oui("L'arrêter ?")) code = executer('arreter.mjs', ['--forcer']);
  }
  console.log(MESSAGES_ARRET[code] ?? `L'arrêt n'a pas abouti (code ${code}). Essayez le bouton « Quitter l'application » de l'onglet Paramètres.`);
  return code;
}

function diagnostic() {
  if (process.platform === 'win32') {
    // Nouvelle fenêtre visible : le mode diagnostic Windows (« Lancer suivi-facturation.bat »).
    const bat = path.join(SCRIPTS, 'Lancer suivi-facturation.bat');
    const enfant = spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${bat}"`], { windowsVerbatimArguments: true, stdio: 'ignore', detached: true });
    enfant.on('error', () => {});
    enfant.unref();
    console.log('Le mode diagnostic s\'ouvre dans une nouvelle fenêtre. Fermer cette fenêtre arrête l\'application.');
    return 0;
  }
  console.log('Mode diagnostic : l\'application tourne dans ce terminal (Ctrl+C pour l\'arrêter).');
  const r = spawnSync(process.execPath, [path.join('src', 'server.js')], { stdio: 'inherit', cwd: RACINE });
  const code = r.status ?? 1;
  if (code === 3) console.log("L'application est déjà lancée (ailleurs ou en arrière-plan) : rien de plus n'est démarré.");
  if (code === 4) console.log("L'application ne répond plus : une ancienne copie est toujours présente. Utilisez « node scripts/suivi.mjs arreter --forcer ».");
  return code;
}

async function main() {
  const [commande, ...args] = process.argv.slice(2);
  switch (commande) {
    case 'lancer': return lancer();
    case 'arreter': return arreter(args);
    case 'raccourci': return executer('creer-raccourci.mjs');
    case 'diagnostic': return diagnostic();
    case 'demo': return (await import('./demo.mjs')).main(); // null : le serveur de démonstration garde le processus en vie
    case 'aide':
    case '--aide':
    case '-h':
    case undefined:
      console.log(AIDE);
      return 0;
    default:
      console.error(`Commande inconnue : « ${String(commande).slice(0, 30)} ».\n`);
      console.error(AIDE);
      return 64;
  }
}

main().then((code) => { if (code !== null) process.exit(code); }, (err) => {
  console.error(`Erreur inattendue (${err?.code ?? err?.name ?? 'inconnue'}).`);
  process.exit(1);
});

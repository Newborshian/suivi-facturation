// Garde de diagnostic des fichiers de test qui démarrent un serveur (importé par serveur-aide.js).
// Contexte : sous Windows, le processus d'un fichier de test s'arrête parfois (3 à 4 % des exécutions complètes) sans rendre ses résultats :
// « test failed » sans sous-test, dossier .tmp/tests/http-* non nettoyé. Mesures (mesures internes) : aucune exception ni rejet
// non gérés, pas de code de sortie JS, jamais reproduit hors de la suite complète. Cause NON démontrée.
// Constat empirique, à ne pas prendre pour une explication : avec des écouteurs de signaux (SIGINT, SIGTERM, SIGBREAK) dans le processus
// de test, environ 1 arrêt sur 400 exécutions complètes contre 3 à 4 sur 100 sans (les écouteurs ne se déclenchent jamais). L'arrêt n'a donc
// pas disparu. Quand il survient, aucune trace JS : pas d'exception, pas de rejet, pas d'événement exit, pas de signal reçu (mort brutale
// du processus enfant, hors de notre code). Si une cause JS apparaît un jour, elle sera écrite sur stderr et dans .tmp/diagnostic-tests/<pid>.log.
// La garde ne change PAS le comportement du processus : exceptions et rejets sont seulement journalisés (uncaughtExceptionMonitor), jamais
// interceptés ni suivis d'un process.exit, pour que node:test les rattache au test fautif et que le rapport reste lisible.
import fs from 'node:fs';
import path from 'node:path';
import { RACINE } from './temp.js';

const DOSSIER = path.join(RACINE, '.tmp', 'diagnostic-tests');
const fichier = path.join(DOSSIER, `${process.pid}.log`);

function noter(texte) {
  const ligne = `[${new Date().toISOString()}] pid ${process.pid} ${texte}\n`;
  try {
    fs.mkdirSync(DOSSIER, { recursive: true });
    fs.appendFileSync(fichier, ligne);
  } catch { /* le diagnostic ne doit jamais casser un test */ }
  try { process.stderr.write(ligne); } catch { /* idem */ }
}

let installe = false;
export function installerGardeProcessus() {
  if (installe) return;
  installe = true;
  // Un rejet non géré devient une exception non interceptée (mode par défaut de Node) : l'origine l'indique, rien n'est avalé.
  process.on('uncaughtExceptionMonitor', (err, origine) => noter(`exception non interceptée (${origine}) : ${err?.stack ?? err}`));
  process.on('exit', (code) => {
    if (code !== 0) noter(`sortie avec le code ${code}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.on(signal, () => {
      noter(`signal ${signal}`);
      process.exit(1);
    });
  }
}
installerGardeProcessus();

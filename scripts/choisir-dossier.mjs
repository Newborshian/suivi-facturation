// Choix du dossier de données : écrit ERGO_DATA_DIR dans le fichier .env à la racine du projet.
// Appelé par « Choisir le dossier de donnees.bat ». Aucune dépendance, aucun accès réseau, aucun secret manipulé.
//
// Garanties :
//  - un .env existant n'est jamais modifié sans confirmation explicite ; il est d'abord copié en « .env.bak » ;
//  - les autres lignes du .env (ERGO_PORT, commentaires...) sont conservées telles quelles ;
//  - le dossier choisi est contrôlé avec les mêmes règles que l'application (existe, inscriptible, pas dans le projet) ;
//  - rien n'est jamais écrit dans le dossier de données lui-même (hormis le fichier-test d'écriture, supprimé aussitôt).
//
// Usage : node scripts/choisir-dossier.mjs [chemin-du-dossier]
//   Sans chemin : fenêtre Windows « Choisir un dossier », ou saisie au clavier si la fenêtre n'est pas disponible.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { RACINE_PROJET, lireConfig, verifierDossierDonnees, ErreurConfig } from '../src/config.js';

const FICHIER_ENV = path.join(RACINE_PROJET, '.env');
const FICHIER_ANCIEN = path.join(RACINE_PROJET, '.env.bak');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
// Les lignes saisies (ou redirigées depuis un fichier) sont mises en attente dès le départ : aucune n'est perdue.
const lignesSaisies = rl[Symbol.asyncIterator]();

async function demander(question) {
  process.stdout.write(question);
  const { value, done } = await lignesSaisies.next();
  return done ? '' : String(value).trim();
}

async function ouiNon(question) {
  const reponse = (await demander(`${question} (O = oui, N = non) : `)).toLowerCase();
  return reponse === 'o' || reponse === 'oui';
}

function messageClair(message) {
  return message
    .replace(' indiqué par ERGO_DATA_DIR', '')
    .replace("Créez-le d'abord ou corrigez la variable.", "Créez-le d'abord ou choisissez-en un autre.")
    .replace(/ERGO_DATA_DIR/g, 'Le dossier de données');
}

function quitter(code, message) {
  if (message) console.log(message);
  rl.close();
  process.exit(code);
}

/** Fenêtre Windows « Choisir un dossier » (PowerShell, local). Renvoie '' si annulée ou indisponible. */
function choisirParFenetre() {
  const script =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; " +
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
    "$d.Description = 'Choisissez le dossier où ranger les données de suivi-facturation (par exemple un dossier de Proton Drive)'; " +
    "$d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: false, timeout: 10 * 60 * 1000 });
  return r.status === 0 ? (r.stdout ?? '').trim() : '';
}

/** Valeur à écrire dans .env : entre apostrophes (aucune interprétation des « \ » de Windows). */
function valeurPourEnv(chemin) {
  if (/[\r\n]/.test(chemin)) return null;
  for (const guillemet of ["'", '`', '"']) {
    if (!chemin.includes(guillemet)) {
      const valeur = `${guillemet}${chemin}${guillemet}`;
      // Contrôle de bout en bout avec l'analyseur de Node : on relit ce que l'application lira.
      if (parseEnv(`ERGO_DATA_DIR=${valeur}`).ERGO_DATA_DIR === chemin) return valeur;
    }
  }
  return null;
}

async function main() {
  console.log('');
  console.log(' Choix du dossier de données de suivi-facturation');
  console.log(' -------------------------------------------------');

  let choix = (process.argv[2] ?? '').trim();
  if (choix === '') {
    console.log(' Une fenêtre va s\'ouvrir pour choisir le dossier (elle peut apparaître derrière celle-ci).');
    choix = choisirParFenetre();
    if (choix === '') {
      console.log(' Aucun dossier choisi dans la fenêtre. Vous pouvez aussi taper ou coller le chemin ici.');
      choix = await demander(' Chemin du dossier (laisser vide pour annuler) : ');
    }
  }
  choix = choix.replace(/^"(.*)"$/, '$1').trim();
  if (choix === '') quitter(0, ' Annulé : rien n\'a été modifié.');
  if (!path.isAbsolute(choix)) quitter(1, ` Le chemin doit être complet (par exemple C:\\Users\\...\\Proton Drive\\suivi-facturation) : « ${choix} ».\n Rien n'a été modifié.`);

  let dossier;
  try {
    dossier = await verifierDossierDonnees(lireConfig({ ERGO_DATA_DIR: choix }));
  } catch (err) {
    if (err instanceof ErreurConfig) quitter(2, `\n Ce dossier ne convient pas.\n ${messageClair(err.message)}\n\n Rien n'a été modifié.`);
    throw err;
  }

  const valeur = valeurPourEnv(choix);
  if (valeur === null) quitter(2, ' Ce chemin contient des caractères que le fichier .env ne sait pas enregistrer. Choisissez un autre dossier.\n Rien n\'a été modifié.');

  console.log('');
  console.log(` Dossier choisi : ${dossier}`);
  if (fs.existsSync(path.join(dossier, 'suivi-facturation.json'))) {
    console.log(' Ce dossier contient déjà un fichier de données suivi-facturation.json : l\'application le reprendra tel quel.');
  } else {
    console.log(' Ce dossier ne contient pas encore de fichier de données : un fichier vide sera créé au prochain lancement.');
    console.log(' ATTENTION : vos données actuelles (si vous en avez) ne sont PAS déplacées automatiquement.');
    console.log(' Avant de relancer, copiez le fichier suivi-facturation.json de l\'ancien dossier (et les dossiers « sauvegardes »)');
    console.log(' dans ce nouveau dossier (voir docs\\exploitation.md).');
  }

  let lignes = [];
  const existe = fs.existsSync(FICHIER_ENV);
  if (existe) {
    const actuel = fs.readFileSync(FICHIER_ENV, 'utf8');
    lignes = actuel.split(/\r?\n/);
    if (lignes.at(-1) === '') lignes.pop();
    const ancien = parseEnv(actuel).ERGO_DATA_DIR;
    console.log('');
    console.log(' Un fichier .env existe déjà.');
    console.log(ancien === undefined ? ' Il ne définit pas encore de dossier de données.' : ` Dossier de données actuellement enregistré : ${ancien}`);
    if (ancien === choix) quitter(0, ' C\'est déjà le dossier choisi : rien à changer.');
    console.log(' Il sera remplacé par le nouveau dossier ; les autres lignes du fichier sont conservées.');
    console.log(' Une copie de l\'ancien fichier sera gardée sous le nom « .env.bak ».');
    if (!(await ouiNon('\n Modifier le fichier .env ?'))) quitter(0, ' Annulé : rien n\'a été modifié.');
  } else if (!(await ouiNon('\n Enregistrer ce dossier (création du fichier .env) ?'))) {
    quitter(0, ' Annulé : rien n\'a été modifié.');
  }

  if (existe) fs.copyFileSync(FICHIER_ENV, FICHIER_ANCIEN);
  const nouvelle = `ERGO_DATA_DIR=${valeur}`;
  let remplace = false;
  const resultat = lignes.map((ligne) => {
    if (/^\s*(export\s+)?ERGO_DATA_DIR\s*=/.test(ligne)) {
      if (remplace) return null; // doublon : on ne garde qu'une définition
      remplace = true;
      return nouvelle;
    }
    return ligne;
  }).filter((l) => l !== null);
  if (!remplace) resultat.push(nouvelle);
  fs.writeFileSync(FICHIER_ENV, `${resultat.join('\r\n')}\r\n`, 'utf8');

  // Relecture de contrôle.
  if (parseEnv(fs.readFileSync(FICHIER_ENV, 'utf8')).ERGO_DATA_DIR !== choix) quitter(3, ' Erreur : le fichier .env écrit ne correspond pas au dossier choisi. Restaurez « .env.bak » si besoin.');

  console.log('');
  console.log(' Dossier de données enregistré.');
  console.log(' Fermez l\'application si elle est ouverte, puis relancez le raccourci « Suivi Facturation ».');
  console.log(' (Le fichier « Lancer suivi-facturation.bat » est le mode diagnostic, réservé aux dépannages.)');
  quitter(0);
}

main().catch((err) => {
  console.error(` Erreur inattendue (${err?.code ?? err?.name ?? 'inconnue'}). Rien n'a été modifié si ce message apparaît avant la confirmation.`);
  quitter(3);
});

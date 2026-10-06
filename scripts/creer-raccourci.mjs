// Créateur de raccourci UNIQUE : détecte le système et crée le bon raccourci (jamais deux pour un même système).
//
//   node scripts/creer-raccourci.mjs        (ou : node scripts/suivi.mjs raccourci)
//
//   Windows : appelle « Creer le raccourci Bureau.vbs » (qui reste utilisable en double-clic) -> « Suivi Facturation.lnk » sur le Bureau.
//   Linux   : « Suivi-facturation.desktop » (nom de fichier technique) avec Name=Suivi Facturation, sur le Bureau
//             (xdg-user-dir DESKTOP, sinon ~/Bureau, sinon ~/Desktop) ET dans ~/.local/share/applications/ (menu des applications),
//             exécutable et « de confiance » (gio) si possible.
//   macOS   : « Suivi Facturation.app » sur le Bureau (Info.plist, script de lancement, icône .icns produite ici en Node pur).
//
// Le nom AFFICHÉ est « Suivi Facturation » ; le nom technique (projet, fichiers de scripts) reste « suivi-facturation ».
// ANCIEN raccourci « Suivi-facturation » (portant NOTRE cible) : détecté et remplacé après confirmation Oui/Non ; jamais deux raccourcis
// pour un même système. Un fichier qui n'est pas le nôtre n'est jamais supprimé ni écrasé.
//
// Le raccourci contient le chemin ABSOLU du projet : si le dossier est déplacé, relancer ce script.
// Demande confirmation avant de remplacer un raccourci existant (terminal interactif). Aucune dépendance, aucun accès réseau.
// Linux et macOS : non vérifié sur le système réel.
//
// Variables d'essai : SUIVI_RACCOURCI_DOSSIER=<dossier> (écrit dans ce dossier au lieu du vrai Bureau ; sous Linux, la copie du menu
//                     va dans <dossier>/applications), SUIVI_PLATEFORME_FORCE=linux|darwin|win32 (génération pour un autre système que
//                     le système courant ; win32 n'est possible que sous Windows), SUIVI_CONFIRMER_OUI=1 (répond Oui à toute question de
//                     remplacement, sans interaction), ERGO_LANCEUR_SANS_BOITE=1 (remplace sans demander un raccourci « Suivi Facturation »
//                     existant ; ne suffit PAS à retirer un ancien raccourci : réponse Non).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { RACINE } from './lib-lanceur.mjs';

const SCRIPTS = path.join(RACINE, 'scripts');
const NOM = 'Suivi Facturation'; // nom AFFICHÉ
const NOM_ANCIEN = 'Suivi-facturation'; // ancien nom affiché (et nom technique des fichiers : .desktop, lanceur, exécutable macOS)
const SORTIE = { ok: 0, echec: 1, refuse: 2 };

const plateforme = (process.env.SUIVI_PLATEFORME_FORCE ?? '').trim() || process.platform;
const dossierEssai = (process.env.SUIVI_RACCOURCI_DOSSIER ?? '').trim();
// Essai de génération Linux/macOS depuis Windows (SUIVI_PLATEFORME_FORCE) : les chemins écrits dans les fichiers prennent la forme POSIX.
const versSysteme = (chemin) => (process.platform === 'win32' && plateforme !== 'win32' ? chemin.replaceAll('\\', '/') : chemin);

function fin(code, message) {
  if (message) (code === 0 ? console.log : console.error)(message);
  process.exit(code);
}

/**
 * Question Oui/Non en terminal. SUIVI_CONFIRMER_OUI=1 répond Oui. Sans terminal interactif : refus (rien n'est modifié).
 * `sansBoiteVautOui` : ERGO_LANCEUR_SANS_BOITE=1 remplace sans demander (raccourci actuel) ; faux pour un ancien raccourci (réponse Non).
 */
async function demander(question, sansBoiteVautOui) {
  if (process.env.SUIVI_CONFIRMER_OUI === '1') return true;
  if (process.env.ERGO_LANCEUR_SANS_BOITE === '1') return sansBoiteVautOui;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const reponse = (await rl.question(`${question} (o = oui, n = non) : `)).trim().toLowerCase();
    return reponse === 'o' || reponse === 'oui';
  } finally {
    rl.close();
  }
}

/**
 * existants : [{ chemin, genre }] avec genre 'ancien' (ancien nom « Suivi-facturation », notre cible) ou 'actuel' (déjà « Suivi Facturation »).
 * Un genre 'ancien' est remplacé seulement après un Oui explicite ; sur Non, rien n'est créé ni supprimé.
 */
async function confirmerRemplacement(existants) {
  if (existants.length === 0) return;
  const anciens = existants.filter((e) => e.genre === 'ancien');
  const question = anciens.length > 0
    ? `Un ancien raccourci « ${NOM_ANCIEN} » existe (${anciens[0].chemin}). Le remplacer par « ${NOM} » ?`
    : `Un raccourci « ${NOM} » existe déjà (${existants[0].chemin}). Le remplacer ?`;
  if (await demander(question, anciens.length === 0)) return;
  fin(SORTIE.refuse, anciens.length > 0
    ? `Un ancien raccourci « ${NOM_ANCIEN} » existe (${anciens[0].chemin}) et n'a pas été remplacé : rien n'a été créé ni supprimé (il ne doit pas y avoir deux raccourcis). Relancez et répondez Oui pour le remplacer, ou supprimez-le vous-même.`
    : `Un raccourci « ${NOM} » existe déjà (${existants[0].chemin}). Rien n'a été modifié.`);
}

function dossierInscriptible(dossier) {
  try {
    return fs.statSync(dossier).isDirectory();
  } catch {
    return false;
  }
}

// --- Windows ---
function windows() {
  if (process.platform !== 'win32') fin(SORTIE.echec, 'Le raccourci Windows ne peut être créé que sous Windows.');
  const vbs = path.join(SCRIPTS, 'Creer le raccourci Bureau.vbs');
  if (!fs.existsSync(vbs)) fin(SORTIE.echec, `Le créateur de raccourci Windows est introuvable : ${vbs}`);
  const r = spawnSync('wscript.exe', ['//nologo', vbs], { stdio: 'inherit', env: process.env });
  // 0 créé, 2 refusé (Non, ou ancien raccourci non remplacé), 1 échec (le .vbs affiche sa propre boîte)
  if (r.status === SORTIE.refuse) fin(SORTIE.refuse, `Rien n'a été créé ni supprimé : un raccourci existe déjà et n'a pas été remplacé (il ne doit pas y avoir deux raccourcis « ${NOM_ANCIEN} » / « ${NOM} »). Pour répondre Oui sans boîte : SUIVI_CONFIRMER_OUI=1.`);
  fin(r.status ?? SORTIE.echec);
}

// --- Linux ---
function bureauLinux() {
  if (dossierEssai) return dossierEssai;
  const maison = os.homedir();
  const r = spawnSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8', timeout: 5000 });
  const xdg = r.status === 0 ? (r.stdout ?? '').trim() : '';
  const candidats = [xdg && path.resolve(xdg) !== path.resolve(maison) ? xdg : null, path.join(maison, 'Bureau'), path.join(maison, 'Desktop')];
  return candidats.find((c) => c && dossierInscriptible(c)) ?? null;
}

/** Valeur de `Exec=` : chemin entre guillemets. Les caractères spéciaux du format (" ` $ \ saut de ligne) sont refusés, % est doublé. */
function execDesktop(chemin) {
  if (/["`$\\\r\n]/.test(chemin)) fin(SORTIE.echec, `Le chemin du projet contient un caractère que le format .desktop ne permet pas d'écrire simplement : ${chemin}\nDéplacez le projet dans un dossier au nom plus simple, puis relancez.`);
  return `"${chemin.replace(/%/g, '%%')}"`;
}

/** Genre d'un fichier .desktop existant : 'ancien' (Name=Suivi-facturation, Exec = NOTRE lanceur), 'actuel' (Exec = notre lanceur, autre nom), 'etranger' (autre Exec : jamais touché). */
function genreDesktop(fichier) {
  let texte;
  try { texte = fs.readFileSync(fichier, 'utf8'); } catch { return 'etranger'; }
  const valeur = (cle) => (texte.split(/\r?\n/).find((l) => l.startsWith(`${cle}=`)) ?? '').slice(cle.length + 1).trim();
  const exec = valeur('Exec').replace(/^"(.*)"$/, '$1').replace(/%%/g, '%');
  const morceaux = exec.split(/[\\/]/);
  const estNotreLanceur = morceaux.at(-1) === 'Suivi-facturation.sh' && morceaux.at(-2) === 'scripts';
  if (!estNotreLanceur) return 'etranger';
  return valeur('Name') === NOM_ANCIEN ? 'ancien' : 'actuel';
}

function contenuDesktop(lanceur, icone) {
  if (/[\r\n]/.test(icone)) fin(SORTIE.echec, "Le chemin de l'icône contient un saut de ligne.");
  return [
    '[Desktop Entry]',
    'Version=1.0',
    'Type=Application',
    `Name=${NOM}`,
    "Comment=Suivi d'activité et de facturation (application locale)",
    `Exec=${execDesktop(lanceur)}`,
    `Icon=${icone}`,
    'Terminal=false',
    'Categories=Office;',
    '',
  ].join('\n');
}

async function linux() {
  const lanceur = versSysteme(path.join(SCRIPTS, 'Suivi-facturation.sh'));
  const icone = versSysteme(path.join(SCRIPTS, 'icone', 'logo-512.png'));
  if (!fs.existsSync(path.join(SCRIPTS, 'Suivi-facturation.sh'))) fin(SORTIE.echec, `Le lanceur est introuvable : ${lanceur}`);
  try { fs.chmodSync(path.join(SCRIPTS, 'Suivi-facturation.sh'), 0o755); } catch { /* le droit d'exécution manque peut-être : voir le message final */ }
  const bureau = bureauLinux();
  if (!bureau) fin(SORTIE.echec, "Le Bureau est introuvable (ni xdg-user-dir, ni ~/Bureau, ni ~/Desktop) : le raccourci n'a pas été créé.");
  const menu = dossierEssai ? path.join(dossierEssai, 'applications') : path.join(os.homedir(), '.local', 'share', 'applications');
  const cibles = [path.join(bureau, `${NOM_ANCIEN}.desktop`), path.join(menu, `${NOM_ANCIEN}.desktop`)]; // nom de fichier technique, Name= affiche « Suivi Facturation »
  const existants = cibles.filter((c) => fs.existsSync(c)).map((chemin) => ({ chemin, genre: genreDesktop(chemin) }));
  const etranger = existants.find((e) => e.genre === 'etranger');
  if (etranger) fin(SORTIE.echec, `Le fichier ${etranger.chemin} existe mais n'est pas le raccourci de cette application : il n'a pas été touché et rien n'a été créé. Renommez-le ou supprimez-le vous-même, puis relancez.`);
  await confirmerRemplacement(existants);
  const contenu = contenuDesktop(lanceur, icone);
  try {
    fs.mkdirSync(menu, { recursive: true });
    for (const cible of cibles) {
      fs.writeFileSync(cible, contenu, { encoding: 'utf8', mode: 0o755 });
      fs.chmodSync(cible, 0o755);
    }
  } catch (err) {
    fin(SORTIE.echec, `Le raccourci n'a pas pu être créé (${err.code ?? 'erreur'}).`);
  }
  // « De confiance » : sans cela, certains gestionnaires de fichiers (GNOME) refusent de lancer le fichier du Bureau.
  const gio = spawnSync('gio', ['--version'], { stdio: 'ignore', timeout: 5000 });
  let confiance = false;
  if (gio.status === 0 && !dossierEssai) {
    confiance = spawnSync('gio', ['set', cibles[0], 'metadata::trusted', 'true'], { stdio: 'ignore', timeout: 5000 }).status === 0;
  }
  console.log(`Raccourci créé : ${cibles[0]}`);
  console.log(`Entrée du menu des applications : ${cibles[1]}`);
  if (!confiance && !dossierEssai) console.log('Si le raccourci du Bureau est grisé : clic droit > « Autoriser le lancement » (ou « Allow Launching »).');
  try { fs.accessSync(path.join(SCRIPTS, 'Suivi-facturation.sh'), fs.constants.X_OK); } catch { console.log(`Attention : ${lanceur} n'est pas exécutable. Lancez : chmod +x scripts/*.sh`); }
  console.log('Le raccourci contient le chemin absolu du projet : si le dossier est déplacé, relancez cette commande. (Linux : non vérifié sur le système réel.)');
  fin(SORTIE.ok);
}

// --- macOS ---
const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function lireTailleImagePng(png) {
  if (png.length < 24 || !png.subarray(0, 8).equals(SIGNATURE_PNG) || png.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { largeur: png.readUInt32BE(16), hauteur: png.readUInt32BE(20) };
}

/** Image PNG 256 x 256 de l'icône Windows (.ico) : l'entrée de largeur 0 (= 256) dont les données sont un PNG. */
function png256DepuisIco(chemin) {
  const ico = fs.readFileSync(chemin);
  const nombre = ico.readUInt16LE(4);
  for (let i = 0; i < nombre; i++) {
    const e = 6 + i * 16;
    if (ico[e] === 0 && ico[e + 1] === 0) {
      const taille = ico.readUInt32LE(e + 8);
      const decalage = ico.readUInt32LE(e + 12);
      return ico.subarray(decalage, decalage + taille);
    }
  }
  return null;
}

/** Conteneur ICNS : « icns » + longueur totale, puis des entrées (type 4 caractères + longueur incluant l'en-tête de 8 octets + données PNG). */
export function construireIcns(entrees) {
  const morceaux = entrees.map(({ type, png }) => {
    const en = Buffer.alloc(8);
    en.write(type, 0, 'latin1');
    en.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([en, png]);
  });
  const total = 8 + morceaux.reduce((n, m) => n + m.length, 0);
  const entete = Buffer.alloc(8);
  entete.write('icns', 0, 'latin1');
  entete.writeUInt32BE(total, 4);
  return Buffer.concat([entete, ...morceaux]);
}

function icnsDuProjet() {
  const png512 = fs.readFileSync(path.join(SCRIPTS, 'icone', 'logo-512.png'));
  const png256 = png256DepuisIco(path.join(SCRIPTS, 'icone', 'suivi-facturation.ico'));
  const t512 = lireTailleImagePng(png512);
  const t256 = png256 ? lireTailleImagePng(png256) : null;
  if (t512?.largeur !== 512 || t512?.hauteur !== 512) fin(SORTIE.echec, "L'image scripts/icone/logo-512.png n'est pas un PNG de 512 x 512 pixels.");
  if (t256?.largeur !== 256 || t256?.hauteur !== 256) fin(SORTIE.echec, "L'image 256 x 256 n'a pas été trouvée dans scripts/icone/suivi-facturation.ico.");
  return construireIcns([{ type: 'ic08', png: png256 }, { type: 'ic09', png: png512 }]); // ic08 = 256 px, ic09 = 512 px (PNG)
}

const echapperXml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function contenuInfoPlist(version) {
  const cles = [
    ['CFBundleName', NOM], ['CFBundleDisplayName', NOM], ['CFBundleIdentifier', 'local.suivi-facturation.lanceur'],
    ['CFBundleExecutable', NOM_ANCIEN], ['CFBundleIconFile', 'suivi-facturation.icns'], ['CFBundlePackageType', 'APPL'],
    ['CFBundleInfoDictionaryVersion', '6.0'], ['CFBundleVersion', version], ['CFBundleShortVersionString', version],
    ['LSMinimumSystemVersion', '10.13'],
  ];
  const lignes = cles.map(([c, v]) => `\t<key>${c}</key>\n\t<string>${echapperXml(v)}</string>`);
  lignes.push('\t<key>LSUIElement</key>\n\t<true/>'); // application sans icône persistante dans le Dock : elle ne fait que lancer le script
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${lignes.join('\n')}\n</dict>\n</plist>\n`;
}

/**
 * Genre d'un .app existant : 'ancien' (Suivi-facturation.app dont le script appelle NOTRE lanceur), 'actuel' (Suivi Facturation.app idem),
 * 'etranger' sinon. Le contenu est examiné sans suivre de lien symbolique.
 */
function genreApp(app, genreSiNotre) {
  try {
    const exe = path.join(app, 'Contents', 'MacOS', NOM_ANCIEN);
    if (fs.lstatSync(exe).isSymbolicLink()) return 'etranger';
    const texte = fs.readFileSync(exe, 'utf8');
    const exec = texte.split(/\r?\n/).find((l) => l.startsWith('exec ')) ?? '';
    return /[\\/]scripts[\\/]Suivi-facturation\.sh'$/.test(exec.trim()) ? genreSiNotre : 'etranger';
  } catch {
    return 'etranger';
  }
}

/**
 * Plan de suppression de l'ancien bundle, ou null s'il contient autre chose que la structure que NOUS créons (ou un lien symbolique).
 * La vérification a lieu AVANT toute création : sans plan, rien n'est créé (jamais deux raccourcis, jamais de suppression inattendue).
 */
function planSuppressionBundle(app) {
  const attendu = [
    ['Contents', 'Info.plist'], ['Contents', 'MacOS', NOM_ANCIEN], ['Contents', 'Resources', 'suivi-facturation.icns'],
  ].map((p) => path.join(app, ...p));
  const dossiers = [path.join(app, 'Contents', 'MacOS'), path.join(app, 'Contents', 'Resources'), path.join(app, 'Contents'), app];
  const connu = new Set([...attendu, ...dossiers]);
  const trouves = [];
  const parcourir = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      trouves.push(p);
      if (e.isSymbolicLink()) return;
      if (e.isDirectory()) parcourir(p);
    }
  };
  parcourir(app);
  if (trouves.some((p) => !connu.has(p) || fs.lstatSync(p).isSymbolicLink())) return null;
  return { fichiers: trouves.filter((p) => !dossiers.includes(p)), dossiers };
}

/** Supprime l'ancien bundle selon le plan : fichier par fichier, puis dossier par dossier en remontant (aucune suppression récursive). */
function supprimerBundleAncien(plan) {
  for (const f of plan.fichiers) fs.unlinkSync(f);
  for (const d of plan.dossiers) fs.rmdirSync(d); // rmdir échoue si le dossier n'est pas vide : jamais de suppression de contenu inattendu
}

const entreGuillemetsSh = (t) => `'${String(t).replace(/'/g, `'\\''`)}'`;

async function darwin() {
  const lanceur = versSysteme(path.join(SCRIPTS, 'Suivi-facturation.sh'));
  if (!fs.existsSync(path.join(SCRIPTS, 'Suivi-facturation.sh'))) fin(SORTIE.echec, `Le lanceur est introuvable : ${lanceur}`);
  try { fs.chmodSync(path.join(SCRIPTS, 'Suivi-facturation.sh'), 0o755); } catch { /* voir le message final */ }
  const bureau = dossierEssai || path.join(os.homedir(), 'Desktop');
  if (!dossierInscriptible(bureau)) fin(SORTIE.echec, "Le Bureau est introuvable : le raccourci n'a pas été créé.");
  const app = path.join(bureau, `${NOM}.app`);
  const appAncienne = path.join(bureau, `${NOM_ANCIEN}.app`);
  const existants = [];
  if (fs.existsSync(appAncienne)) existants.push({ chemin: appAncienne, genre: genreApp(appAncienne, 'ancien') });
  if (fs.existsSync(app)) existants.push({ chemin: app, genre: genreApp(app, 'actuel') });
  const etranger = existants.find((e) => e.genre === 'etranger');
  if (etranger) fin(SORTIE.echec, `${etranger.chemin} existe mais n'est pas le raccourci de cette application : il n'a pas été touché et rien n'a été créé. Renommez-le ou supprimez-le vous-même, puis relancez.`);
  let plan = null;
  if (fs.existsSync(appAncienne)) {
    try { plan = planSuppressionBundle(appAncienne); } catch { plan = null; }
    if (!plan) fin(SORTIE.echec, `L'ancien raccourci ${appAncienne} contient des fichiers inattendus : il n'a pas été touché et rien n'a été créé (il ne doit pas y avoir deux raccourcis). Supprimez-le vous-même, puis relancez.`);
  }
  await confirmerRemplacement(existants);
  const version = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version ?? '0.0.0';
  const icns = icnsDuProjet();
  const executable = path.join(app, 'Contents', 'MacOS', NOM_ANCIEN); // exécutable : nom technique
  try {
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), contenuInfoPlist(version), 'utf8');
    fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'suivi-facturation.icns'), icns);
    fs.writeFileSync(executable, `#!/bin/sh\n# Généré par scripts/creer-raccourci.mjs : lance l'application (chemin absolu du projet).\nexec ${entreGuillemetsSh(lanceur)}\n`, { encoding: 'utf8', mode: 0o755 });
    fs.chmodSync(executable, 0o755);
  } catch (err) {
    fin(SORTIE.echec, `L'application n'a pas pu être créée (${err.code ?? 'erreur'}).`);
  }
  if (existants.some((e) => e.chemin === appAncienne)) {
    try {
      supprimerBundleAncien(plan);
      console.log(`Ancien raccourci retiré : ${appAncienne}`);
    } catch (err) {
      console.log(`Attention : l'ancien raccourci ${appAncienne} n'a pas pu être entièrement retiré (${err.code ?? 'erreur'}). Supprimez-le vous-même pour ne garder qu'un seul raccourci.`);
    }
  }
  console.log(`Application créée : ${app}`);
  console.log("Le raccourci contient le chemin absolu du projet : si le dossier est déplacé, relancez cette commande. (macOS : non vérifié sur le système réel ; au premier lancement, macOS peut demander une confirmation : clic droit > Ouvrir.)");
  fin(SORTIE.ok);
}

async function main() {
  if (!['win32', 'linux', 'darwin'].includes(plateforme)) {
    fin(SORTIE.echec, `Système non pris en charge : ${plateforme}. Les systèmes pris en charge sont Windows, Linux et macOS.`);
  }
  if (plateforme === 'win32') return windows();
  if (plateforme === 'linux') return linux();
  return darwin();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();

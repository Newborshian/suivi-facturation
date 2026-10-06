// Lanceur silencieux (appelé par « Suivi-facturation.vbs » sous Windows, « Suivi-facturation.sh » sous Linux/macOS, ou
// `node scripts/suivi.mjs lancer`). Aucune dépendance, aucun accès réseau hors de cet ordinateur (127.0.0.1 uniquement),
// aucune écriture dans le dossier de données.
//
//   node scripts/lancer-silencieux.mjs
//
// Ce que fait le lanceur :
// 1. prend le « verrou de lancement » (dossier voisin du verrou d'instance) : deux lanceurs simultanés ne démarrent pas deux serveurs ;
//    le second attend (30 s au plus) puis constate que l'application tourne et ouvre simplement le navigateur ;
// 2. lit le verrou d'instance (src/verrou.js) : application déjà lancée sur ce dossier de données (QUEL QUE SOIT son port) -> ouvre le
//    navigateur sur le port du VERROU, sans démarrer de second serveur ; instance bloquée -> code 20 et message ;
// 3. sinon choisit le port : ERGO_PORT s'il est défini (occupé = message, pas de repli) ; sinon 4780, ou le premier port libre de 4781 à 4799
//    si 4780 est pris par un autre logiciel ;
// 4. démarre src/server.js DÉTACHÉ (le serveur survit à la fermeture du lanceur et de la fenêtre qui l'a lancé), attend qu'il réponde
//    (20 s au plus), puis ouvre le navigateur par défaut. Un serveur qui sort avec le code 3 (« déjà lancée ») est un succès.
//
// Journal : celui du serveur (logs/suivi-facturation.log ou ERGO_LOG_DIR), lignes préfixées « Lanceur : ». Aucune donnée de patient.
// Échec : message en français dans logs/message-lanceur.txt (1re ligne « journal=<chemin> », le reste = message).
// Code de sortie : 0 = application prête ou déjà lancée ; 1 = échec (message écrit) ; 20 = une ancienne instance ne répond plus (message écrit).
//
// Arrêt automatique : le serveur démarré ici reçoit ERGO_ARRET_AUTO=1 sauf si la variable est déjà définie (environnement ou .env).
//
// Variables d'essai : ERGO_LANCEUR_SANS_NAVIGATEUR=1 (n'ouvre pas le navigateur), ERGO_LANCEUR_MESSAGE=<fichier> (autre emplacement du
// fichier de message ; le .vbs et le .sh lisent la même variable), ERGO_VERROU_DIR (dossier des verrous, voir src/verrou.js).
import fs from 'node:fs';
import path from 'node:path';
import { lireVerrou } from '../src/verrou.js';
import {
  ADRESSE, PORT_DEFAUT, PORT_REPLI_MIN, PORT_REPLI_MAX, RACINE, CODE_INSTANCE_BLOQUEE,
  pause, lirePortDemande, dossierDonnees, sonderSante, portEstLibre, ouvrirNavigateur, demarrerServeurDetache, prendreVerrouLancement,
} from './lib-lanceur.mjs';

const DELAI_DEMARRAGE_MS = 20000;
const PATIENCE_VERROU_MS = 15000; // doit rester identique à PATIENCE_DEMARRAGE_MS de src/verrou.js
const FICHIER_MESSAGE = (process.env.ERGO_LANCEUR_MESSAGE ?? '').trim() || path.join(RACINE, 'logs', 'message-lanceur.txt');

// --- Journal (réutilise celui du serveur : même format, même rotation) ---
let journal = { chemin: path.join(RACINE, 'logs', 'suivi-facturation.log'), info() {}, erreur() {} };
const infoJ = (m) => journal.info(`Lanceur : ${m}`);
const erreurJ = (m) => journal.erreur(`Lanceur : ${m}`);

let verrouLancement = null;
const libererLancement = () => { try { verrouLancement?.liberer(); } catch { /* rien à faire */ } };
process.on('exit', libererLancement);

function sortir(code) {
  libererLancement();
  process.exit(code);
}

/** Écrit le message destiné à l'utilisatrice, puis sort avec le code donné (1 par défaut). */
function echec(message, detailJournal, code = 1) {
  erreurJ(detailJournal ?? message.replace(/\s*\n\s*/g, ' '));
  try {
    fs.mkdirSync(path.dirname(FICHIER_MESSAGE), { recursive: true });
    fs.writeFileSync(FICHIER_MESSAGE, `journal=${journal.chemin}\n${message}\n`, 'utf8');
  } catch { /* rien d'autre à tenter : le code de sortie suffit à l'enveloppe */ }
  sortir(code);
}

/** Instance bloquée : code dédié, message pour l'utilisatrice (l'enveloppe propose de l'arrêter ; rien n'est arrêté ici). */
function instanceBloquee(verrou, detail) {
  const ou = verrou?.port ? ` (port ${verrou.port})` : '';
  echec(`L'application ne répond plus.\nUne ancienne copie de l'application${ou} est toujours présente mais ne réagit plus. Elle n'a pas été arrêtée et vos données n'ont pas été touchées.\nIl faut l'arrêter avant de relancer.`, detail ?? `instance bloquée (PID ${verrou?.pid ?? 'inconnu'}, port ${verrou?.port ?? 'inconnu'}), rien n'a été arrêté`, CODE_INSTANCE_BLOQUEE);
}

/** Dernières lignes ERREUR du serveur écrites dans le journal depuis `depuis` (taille du fichier avant le démarrage). */
function erreursDuJournal(depuis) {
  try {
    const taille = fs.statSync(journal.chemin).size;
    const debut = taille >= depuis ? depuis : 0; // journal pivoté entre-temps : on lit tout
    const fd = fs.openSync(journal.chemin, 'r');
    try {
      const longueur = Math.min(taille - debut, 16384);
      const tampon = Buffer.alloc(longueur);
      fs.readSync(fd, tampon, 0, longueur, taille - longueur);
      return tampon.toString('utf8').split('\n')
        .map((l) => /^\S+ ERREUR\s+(.*)$/.exec(l.replace(/\r$/, '')))
        .filter(Boolean)
        .map((m) => m[1])
        .filter((t) => !t.startsWith('Lanceur : '))
        .map((t) => t.replace(/^Démarrage impossible : /, '').split(' | ')
          // les conseils du serveur renvoient au .bat de choix du dossier ou à une variable : le message du lanceur donne déjà le conseil adapté
          .filter((l) => !l.startsWith('Pour choisir un autre dossier') && !l.startsWith('(Information technique')).join('\n').trim())
        .filter(Boolean)
        .slice(-2);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

function tailleJournal() {
  try { return fs.statSync(journal.chemin).size; } catch { return 0; }
}

async function ouvrir(port) {
  await ouvrirNavigateur(`http://${ADRESSE}:${port}/`, { info: infoJ });
  await pause(500);
}

/** Lit le verrou ; une erreur de configuration (ERGO_VERROU_DIR refusé...) devient un message pour l'utilisatrice. */
async function lireEtatVerrou(dossier) {
  try {
    return await lireVerrou(dossier);
  } catch (err) {
    echec(`Le dossier des verrous d'instance est refusé (${err?.message ?? 'erreur'}).\nL'application n'a pas été démarrée et aucune donnée n'a été touchée.\nSi vous avez défini ERGO_VERROU_DIR dans le fichier .env, corrigez ou supprimez cette ligne.`, `verrou illisible : ${err?.message ?? 'erreur'}`);
  }
}

/** Application déjà lancée (verrou « actif ») : ouvre le navigateur sur le port du verrou, sans rien démarrer. */
async function succesDejaLancee(verrou, raison) {
  infoJ(`application déjà lancée (PID ${verrou.pid}, port ${verrou.port})${raison ? ` ${raison}` : ''}, ouverture du navigateur`);
  libererLancement();
  await ouvrir(verrou.port);
  sortir(0);
}

/** Verrou « bloque » mais très récent : c'est probablement un démarrage en cours (sauvegarde...). On attend qu'il devienne actif. */
async function attendreDemarrageEnCours(dossier, verrou) {
  const debut = Date.parse(verrou.demarreLe ?? '');
  if (!Number.isFinite(debut)) return verrou;
  const limite = debut + PATIENCE_VERROU_MS + 2000;
  let courant = verrou;
  while (courant.statut === 'bloque' && Date.now() < limite) {
    await pause(500);
    courant = await lireEtatVerrou(dossier);
  }
  return courant;
}

/** Le serveur qu'on vient de lancer est sorti avant d'être prêt. */
async function serveurSorti(sortie, dossier, depuis) {
  if (sortie.code === 3 || (dossier && sortie.code !== 2 && sortie.code !== 4)) {
    // Code 3 : « déjà lancée » = succès. Autre sortie anormale (ex. course de démarrage) : si une instance répond bien, c'est un succès aussi.
    const fin = Date.now() + (sortie.code === 3 ? 12000 : 3000);
    while (dossier && Date.now() < fin) {
      const v = await lireEtatVerrou(dossier);
      if (v.statut === 'actif') {
        await succesDejaLancee(v, sortie.code === 3 ? '(le serveur lancé est sorti avec le code 3)' : `(le serveur lancé est sorti avec le code ${sortie.code ?? sortie.erreur} mais une instance répond)`);
      }
      if (v.statut === 'bloque' && sortie.code === 3) return instanceBloquee(v);
      await pause(300);
    }
  }
  if (sortie.code === 4) {
    const v = dossier ? await lireEtatVerrou(dossier) : null;
    return instanceBloquee(v, "le serveur a refusé de démarrer (code 4) : une ancienne instance ne répond plus, rien n'a été arrêté");
  }
  if (sortie.code === 2) {
    const lignes = erreursDuJournal(depuis);
    const raison = lignes.length > 0 ? lignes.join('\n') : 'la configuration est refusée (voir le journal).';
    return echec(`L'application n'a pas pu démarrer.\nRaison : ${raison}\nAucun fichier de données n'a été modifié.\nPour changer le dossier de données : utilisez « Choisir le dossier de donnees.bat » (Windows) ou « node scripts/choisir-dossier.mjs » (dossier scripts du projet).`, "le serveur s'est arrêté au démarrage (code 2, erreur de configuration)");
  }
  return echec(`L'application s'est arrêtée de façon inattendue au démarrage (code ${sortie.code ?? sortie.erreur}).\nVos données ne sont pas perdues. Relancez ; si le problème persiste, demandez de l'aide en montrant le journal.`, `le serveur s'est arrêté au démarrage (code ${sortie.code ?? sortie.erreur})`);
}

/** Version majeure de Node.js à partir d'une chaîne « 22.4.1 » (0 si illisible). */
const versionMajeure = (version) => { const n = Number.parseInt(String(version), 10); return Number.isFinite(n) ? n : 0; };

async function main() {
  // Contrôle de la version de Node AVANT tout le reste : le .env est chargé avec process.loadEnvFile (absent des Node très anciens) ;
  // sinon l'utilisatrice verrait « .env illisible » au lieu de « Node trop ancien ».
  const majeur = versionMajeure(process.versions.node);
  if (majeur < 24) {
    echec(`La version de Node.js installée (${majeur}) est trop ancienne : il faut la version 24.\nInstallez Node.js 24 depuis https://nodejs.org, puis relancez l'application.`, `Node.js ${majeur} trop ancien (24 requis)`);
  }

  try { fs.unlinkSync(FICHIER_MESSAGE); } catch { /* absent : normal */ }

  // .env facultatif, lu comme le fait le serveur (les variables déjà définies ne sont pas écrasées).
  try {
    if (fs.existsSync(path.join(RACINE, '.env'))) process.loadEnvFile(path.join(RACINE, '.env'));
  } catch {
    echec("Le fichier de réglages (.env) est illisible ou mal écrit.\nOuvrez-le avec un éditeur de texte (à la racine du projet) et vérifiez-le, ou supprimez-le : l'application fonctionne sans lui.\nAucune donnée n'a été touchée.", 'fichier .env illisible');
  }

  try {
    const { creerJournal } = await import('../src/journal.js');
    const { resoudreDossierJournal } = await import('../src/config.js');
    let dossierJournal;
    try { dossierJournal = resoudreDossierJournal(); } catch { dossierJournal = path.join(RACINE, 'logs'); }
    journal = creerJournal({ dossier: dossierJournal });
  } catch { /* journal indisponible : on continue sans, le message reste écrit */ }

  // Arrêt automatique à la fermeture de la page : activé pour le serveur lancé ici, sauf choix explicite déjà présent
  // (variable d'environnement ou .env, chargé ci-dessus : « ERGO_ARRET_AUTO=0 » désactive). Le mode diagnostic (.bat) ne l'active pas.
  const arretAutoExplicite = process.env.ERGO_ARRET_AUTO !== undefined;
  if (!arretAutoExplicite) process.env.ERGO_ARRET_AUTO = '1';
  infoJ(`arrêt automatique à la fermeture de la page : ${process.env.ERGO_ARRET_AUTO.trim() === '1' ? 'activé' : 'désactivé'}`);

  const demande = lirePortDemande();
  if (demande.port === null) {
    const valeur = demande.brut.slice(0, 20);
    echec(`Le numéro de port (ERGO_PORT) du fichier .env n'est pas valide : « ${valeur} ».\nIl faut un nombre entier de 1 à 65535 (par exemple 4780).\nOuvrez le fichier .env (à la racine du projet) avec un éditeur de texte, corrigez ou supprimez la ligne ERGO_PORT, enregistrez, puis relancez.\nL'application n'a pas été démarrée et aucune donnée n'a été touchée.`, `ERGO_PORT invalide : « ${valeur} »`);
  }

  const dossier = dossierDonnees();

  // 1. Verrou de lancement : un seul lanceur décide et démarre ; les autres attendent puis relisent l'état.
  try {
    verrouLancement = await prendreVerrouLancement(dossier);
  } catch (err) {
    echec(`Le dossier des verrous d'instance est refusé (${err?.message ?? err?.code ?? 'erreur'}).\nL'application n'a pas été démarrée et aucune donnée n'a été touchée.\nSi vous avez défini ERGO_VERROU_DIR dans le fichier .env, corrigez ou supprimez cette ligne.`, `verrou de lancement impossible : ${err?.code ?? err?.message ?? 'erreur'}`);
  }
  if (verrouLancement.obtenu) infoJ('verrou de lancement pris');
  else infoJ("verrou de lancement toujours tenu par un autre lanceur après 30 s : poursuite sans lui (le verrou d'instance du serveur protège)");

  // 2. État de l'instance pour ce dossier de données.
  let verrou = await lireEtatVerrou(dossier);
  if (verrou.statut === 'bloque') verrou = await attendreDemarrageEnCours(dossier, verrou);
  if (verrou.statut === 'actif') await succesDejaLancee(verrou);
  if (verrou.statut === 'bloque') instanceBloquee(verrou);

  // 3. Choix du port.
  let port = demande.port;
  const libre = await portEstLibre(port);
  if (!libre) {
    const autreCopie = await sonderSante(port); // notre application, mais d'un autre dossier de données (sinon le verrou aurait répondu)
    if (demande.defini) {
      if (autreCopie) {
        echec(`Le port réseau (${port}) est déjà utilisé par une autre copie de l'application (un autre dossier de données).\nL'application n'a pas été démarrée et aucune donnée n'a été touchée.\nQue faire : fermez l'autre copie, ou choisissez un autre port (ERGO_PORT dans le fichier .env).`, `port ${port} (ERGO_PORT) occupé par une autre copie de l'application (autre dossier de données)`);
      }
      echec(`Le port réseau (${port}) utilisé par l'application est déjà pris par un AUTRE logiciel.\nL'application n'a pas été démarrée et aucune donnée n'a été touchée.\nQue faire : redémarrez l'ordinateur puis relancez ; sinon demandez de l'aide (on peut choisir un autre port, ERGO_PORT dans le fichier .env).`, `port ${port} (ERGO_PORT) occupé par un autre programme, pas de repli`);
    }
    // ERGO_PORT non défini : repli sur le premier port libre de 4781 à 4799.
    let repli = null;
    for (let p = PORT_REPLI_MIN; p <= PORT_REPLI_MAX && repli === null; p++) if (await portEstLibre(p)) repli = p;
    if (repli === null) {
      echec(`Le port habituel (${PORT_DEFAUT}) et les ports de remplacement (${PORT_REPLI_MIN} à ${PORT_REPLI_MAX}) sont tous pris par d'autres logiciels.\nL'application n'a pas été démarrée et aucune donnée n'a été touchée.\nQue faire : redémarrez l'ordinateur puis relancez ; sinon demandez de l'aide (ERGO_PORT dans le fichier .env).`, `ports ${PORT_DEFAUT} à ${PORT_REPLI_MAX} tous occupés`);
    }
    infoJ(`port ${port} occupé par ${autreCopie ? 'une autre copie de l\'application' : 'un autre logiciel'}, utilisation du port ${repli}`);
    port = repli;
    process.env.ERGO_PORT = String(port); // transmis au serveur
  }

  // 4. Démarrage.
  infoJ(`démarrage du serveur détaché (port ${port})`);
  const depuis = tailleJournal();
  const debut = Date.now();
  let sortie = null; // renseigné si le serveur s'arrête avant d'être prêt
  let enfant;
  try {
    enfant = demarrerServeurDetache(process.env);
  } catch (err) {
    echec(`Le serveur n'a pas pu être lancé (${err?.code ?? err?.name ?? 'erreur inconnue'}).\nRelancez ; si le problème persiste, demandez de l'aide.`, `lancement du serveur impossible : ${err?.code ?? err?.name ?? 'inconnue'}`);
  }
  enfant.on('error', (err) => { sortie = { code: null, erreur: err?.code ?? err?.name ?? 'inconnue' }; });
  enfant.on('exit', (code) => { sortie = { code }; });
  enfant.unref();

  while (Date.now() - debut < DELAI_DEMARRAGE_MS) {
    if (sortie) break;
    const sante = await sonderSante(port);
    if (sante && sante.pid === enfant.pid) {
      infoJ(`serveur prêt en ${Date.now() - debut} ms (PID ${enfant.pid}, port ${port})`);
      libererLancement();
      await ouvrir(port);
      sortir(0);
    }
    await pause(250);
  }

  if (sortie) await serveurSorti(sortie, dossier, depuis);

  // Délai dépassé : le serveur que nous venons de lancer ne répond pas ; on l'arrête (c'est notre processus, par PID).
  try { process.kill(enfant.pid); } catch { /* déjà arrêté */ }
  echec(`L'application met trop de temps à démarrer (plus de ${DELAI_DEMARRAGE_MS / 1000} secondes) ; elle a été arrêtée.\nCause possible : ordinateur très chargé ou antivirus qui analyse les fichiers. Réessayez dans un instant.\nVos données ne sont pas perdues.`, `délai de démarrage dépassé (${DELAI_DEMARRAGE_MS / 1000} s), serveur PID ${enfant.pid} arrêté`);
}

main().catch((err) => {
  echec(`Le lanceur a rencontré une erreur inattendue (${err?.code ?? err?.name ?? 'inconnue'}).\nRelancez ; si le problème persiste, demandez de l'aide en montrant le journal.`, `erreur inattendue : ${err?.code ?? err?.name ?? 'inconnue'}`);
});

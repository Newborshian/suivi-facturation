// Point d'entrée : configuration -> contrôle du dossier -> stockage -> serveur sur 127.0.0.1.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { RACINE_PROJET, CODE_SORTIE_CONFIG, ErreurConfig, lireConfig, resoudreDossierJournal, verifierDossierDonnees } from './config.js';
import { ErreurApp } from './erreurs.js';
import { creerHorloge } from './horloge.js';
import { creerArret } from './arret.js';
import { creerPresence } from './presence.js';
import { creerServeur, erreurLiaisonPort, portEstLibre } from './http/serveur.js';
import { creerJournal, decrireErreur, journalNul } from './journal.js';
import { ouvrirStore } from './store/store.js';
import { acquerirVerrou, libererVerrou, mettreAJourPort } from './verrou.js';

const erreurPortOccupe = (port) =>
  new ErreurConfig(`Le port ${port} est déjà utilisé (l'application est peut-être déjà lancée). Aucun fichier de données n'a été touché. Fermez l'autre instance ou changez ERGO_PORT.`);

// `.env` est facultatif : chargé ici s'il existe (évite le message anglais de `node --env-file-if-exists` quand il est absent).
// Déjà chargé par le lanceur Windows (--env-file) : les variables existantes ne sont jamais écrasées.
// ERGO_SANS_ENV=1 saute ce chargement (posée par les aides de test : le .env d'un poste de développement ne doit pas changer leur résultat).
if (process.env.ERGO_SANS_ENV !== '1' && fs.existsSync(path.join(RACINE_PROJET, '.env'))) process.loadEnvFile(path.join(RACINE_PROJET, '.env'));

// Journal d'événements (logs/suivi-facturation.log) : créé dès le début de main() pour que les erreurs fatales de configuration y figurent aussi.
let journal = journalNul;
export const CODE_SORTIE_DEJA_LANCEE = 3; // application déjà lancée sur ce dossier de données
export const CODE_SORTIE_BLOQUEE = 4; // ancienne instance toujours présente mais qui ne répond plus

// Verrou d'instance (src/verrou.js) : pris au démarrage, libéré à tout arrêt (seulement s'il porte encore notre PID).
// Une fermeture forcée le laisse périmé : il est repris, avec un avertissement, au démarrage suivant.
let verrou = null; // { dossierDonnees } une fois acquis
// Réessais courts (0,5 s au lieu de 2 s par défaut) : ces lectures/suppressions sont SYNCHRONES, donc le garde-temps de l'arrêt ne peut pas les interrompre.
// Un verrou non supprimé n'est pas grave : il est jugé périmé (PID mort) et repris, avec un avertissement, au démarrage suivant.
const REESSAI_LIBERATION = { dureeMs: 500, minMs: 10, maxMs: 60 };
const libererNotreVerrou = () => {
  if (!verrou) return;
  const { dossierDonnees } = verrou;
  verrou = null; // d'abord : le gestionnaire `exit` ne refait jamais une seconde série de réessais après un arrêt forcé
  libererVerrou({ dossierDonnees, journal, reessai: REESSAI_LIBERATION });
};
process.on('exit', libererNotreVerrou); // dernier recours
// Signaux (SIGHUP : fermeture d'un terminal sous Linux/macOS) : avant la fin du démarrage, on libère simplement le verrou ; ensuite, arrêt propre.
let surSignal = () => { libererNotreVerrou(); process.exit(0); };
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.on(signal, () => surSignal(signal));

// Exceptions et rejets non gérés : écrits dans le journal (nom, code, pile ; jamais le message) puis arrêt, comme le comportement par défaut de Node.
process.on('uncaughtException', (err) => {
  journal.erreur(`Exception non interceptée : ${decrireErreur(err)}`);
  libererNotreVerrou();
  console.error(`Erreur inattendue (${err?.code ?? err?.name ?? 'inconnue'}). L'application s'arrête.`);
  process.exit(1);
});
process.on('unhandledRejection', (raison) => {
  journal.erreur(`Rejet de promesse non géré : ${decrireErreur(raison)}`);
  libererNotreVerrou();
  console.error(`Erreur inattendue (${raison?.code ?? raison?.name ?? 'inconnue'}). L'application s'arrête.`);
  process.exit(1);
});

async function main() {
  let dossierJournal;
  let erreurJournal = null;
  try {
    dossierJournal = resoudreDossierJournal();
  } catch (err) {
    erreurJournal = err; // ERGO_LOG_DIR refusé : l'erreur est écrite dans le journal par défaut puis le démarrage s'arrête (code 2)
    dossierJournal = path.join(RACINE_PROJET, 'logs');
  }
  journal = creerJournal({ dossier: dossierJournal });
  if (erreurJournal) throw erreurJournal;

  const config = lireConfig();
  const { version } = JSON.parse(await fsp.readFile(path.join(RACINE_PROJET, 'package.json'), 'utf8'));
  // Verrou d'abord, puis port : une seconde instance doit s'arrêter avant de toucher au dossier de données (temporaires, sauvegarde de démarrage).
  const prise = await acquerirVerrou({ dossierDonnees: config.dossier, port: null, version, journal }); // port inconnu tant que le serveur n'écoute pas : les autres instances attendent sans sonder
  if (prise.statut === 'actif') {
    const { pid, port } = prise.verrou;
    journal.info(`Démarrage ignoré : application déjà lancée (PID ${pid}, port ${port}).`);
    console.log(`L'application est déjà lancée (port ${port}).`);
    process.exit(CODE_SORTIE_DEJA_LANCEE);
  }
  if (prise.statut === 'bloque') {
    const { pid, port } = prise.verrou;
    const message = `Une ancienne instance (PID ${pid ?? 'inconnu'}, port ${port ?? 'inconnu'}) ne répond plus. Elle n'a pas été arrêtée et le fichier de données n'a pas été touché. Arrêtez-la (par ce PID) puis relancez l'application.`;
    journal.avert(`Démarrage refusé : ${message}`);
    console.error(`Démarrage impossible : ${message}`);
    process.exit(CODE_SORTIE_BLOQUEE);
  }
  verrou = { dossierDonnees: config.dossier };
  if (!(await portEstLibre(config.port))) throw erreurPortOccupe(config.port);
  config.dossier = await verifierDossierDonnees(config);
  const horloge = creerHorloge();
  const store = await ouvrirStore({ dossier: config.dossier, horloge, journal });
  const etat = store.etat();
  if (prise.repris) {
    const resultat = etat.modeDegrade ? `mode dégradé (raison : ${etat.erreur?.raison ?? 'inconnue'})` : etat.lectureSeule ? "lecture seule (fichier d'une version plus récente)" : 'lisible';
    journal.avert(`Le dernier arrêt de l'application n'était pas normal (processus terminé de force, panne ou coupure). Le fichier de données a été contrôlé : ${resultat}.`);
  }
  // Arrêt propre (src/arret.js) : garde-temps de 5 s, plus de nouvelles requêtes, file d'écriture vidée, connexions fermées, verrou libéré, code 0.
  const arreter = creerArret({ app: { cesserEcoute: () => app.cesserEcoute(), fermerConnexions: () => app.fermerConnexions() }, store, libererVerrou: libererNotreVerrou, journal });
  // Arrêt automatique (ERGO_ARRET_AUTO=1) : même arrêt propre que le bouton, avec la raison dans le journal.
  const presence = creerPresence({
    actif: config.arretAuto.actif,
    delais: config.arretAuto.delais,
    surArret: (raison) => {
      journal.info(`Arrêt automatique : ${raison}.`);
      arreter('arrêt automatique');
    },
  });
  const app = creerServeur({ store, config, horloge, version, evenements: journal, presence, demanderArret: () => arreter('bouton Quitter') });

  let port;
  try {
    port = await app.demarrer(config.port);
  } catch (err) {
    if (err.code === 'EADDRINUSE') throw erreurPortOccupe(config.port); // course rare entre la sonde et l'écoute
    if (typeof err.code === 'string' && err.code.startsWith('E')) throw erreurLiaisonPort(config.port, err);
    throw err;
  }

  mettreAJourPort({ dossierDonnees: config.dossier, port, journal });
  presence.demarrer();
  journal.info(`Démarrage : version ${version}, port ${port}, dossier de données ${config.dossier}`);
  console.log(`suivi-facturation ${version} : http://127.0.0.1:${port}`);
  console.log(`Dossier de données : ${config.dossier}`);
  if (etat.modeDegrade) console.log(`ATTENTION : ${etat.erreur.message}`);
  if (etat.lectureSeule) console.log('ATTENTION : fichier créé par une version plus récente, lecture seule.');

  surSignal = (signal) => arreter(`signal ${signal}`);
}

main().catch((err) => {
  if (err instanceof ErreurConfig || err instanceof ErreurApp) {
    console.error(`Démarrage impossible : ${err.message}`);
    if (err.aide) console.error(err.aide);
    journal.erreur(`Démarrage impossible : ${err.message}${err.aide ? `
${err.aide}` : ''}`);
    libererNotreVerrou();
    process.exit(err.codeSortie ?? CODE_SORTIE_CONFIG);
  }
  journal.erreur(`Démarrage impossible : erreur inattendue : ${decrireErreur(err)}`);
  console.error(`Démarrage impossible : erreur inattendue (${err?.code ?? err?.name ?? 'inconnue'}).`);
  libererNotreVerrou();
  process.exit(1);
});

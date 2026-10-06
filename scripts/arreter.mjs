// Arrêt de secours (appelé par « Arreter suivi-facturation.vbs / .sh » ou `node scripts/suivi.mjs arreter`), sans passer par le bouton de l'interface.
// Demande l'ARRÊT PROPRE (POST /api/arreter) : jamais d'arrêt de processus par son nom, ni par un PID deviné.
// 127.0.0.1 uniquement, aucune dépendance, aucune écriture hors journal.
//
//   node scripts/arreter.mjs            arrêt propre de l'application (port retrouvé dans le verrou d'instance, sinon ERGO_PORT / 4780)
//   node scripts/arreter.mjs --forcer   cas d'une instance BLOQUÉE (qui ne répond plus) : arrêt propre tenté 3 s, puis, seulement si le PID
//                                       du verrou est vivant ET que ce PID est bien un programme « node » (nom vérifié par PID), arrêt de
//                                       CE seul PID. Jamais d'arrêt par nom, jamais de PID deviné.
//
// Code de sortie : 0 = application arrêtée (port libéré) ; 10 = l'application n'était pas lancée ;
//                  11 = le port est occupé par autre chose (rien n'a été arrêté) ; 12 = ERGO_PORT invalide ;
//                  20 = l'application ne répond plus (sans --forcer : rien n'a été arrêté) ;
//                  21 = arrêt forcé refusé : le PID du verrou n'est pas un programme « node » (rien n'a été arrêté) ;
//                  1 = la demande n'a pas abouti (réponse inattendue, ou port / processus toujours là après le délai).
import fs from 'node:fs';
import path from 'node:path';
import { lireVerrou } from '../src/verrou.js';
import {
  RACINE, CODE_INSTANCE_BLOQUEE, CODE_ARRET_REFUSE,
  pause, lirePortDemande, dossierDonnees, estNotreApplication, portEstLibre, demanderArret, pidVivant, nomProcessus, estProgrammeNode,
} from './lib-lanceur.mjs';

let journal = { info() {}, erreur() {} };

async function attendrePortLibre(port, dixiemes) {
  for (let i = 0; i < dixiemes; i++) {
    if (await portEstLibre(port)) return true;
    await pause(250);
  }
  return false;
}

async function attendreFinProcessus(pid, delaiMs) {
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    if (!pidVivant(pid)) return true;
    await pause(150);
  }
  return !pidVivant(pid);
}

/** Instance bloquée : arrêt propre tenté 3 s, puis arrêt du seul PID du verrou s'il s'agit bien d'un programme « node ». */
async function arretForce(dossier) {
  let verrou = await lireVerrou(dossier);
  if (verrou.statut !== 'bloque') {
    journal.info(`Arrêt forcé : l'instance n'est plus bloquée (état « ${verrou.statut} »), rien à faire.`);
    return verrou.statut === 'actif' ? arretPropre(verrou.port) : 0;
  }
  const { pid, port } = verrou;
  journal.info(`Arrêt forcé : instance bloquée (PID ${pid}, port ${port ?? 'inconnu'}), demande d'arrêt propre.`);
  if (port) {
    await demanderArret(port, 3000);
    if (await attendreFinProcessus(pid, 3000)) {
      journal.info('Arrêt forcé : l\'instance s\'est arrêtée proprement.');
      return 0;
    }
  }
  // Le verrou a-t-il changé pendant ce temps ? (relecture juste avant d'agir)
  verrou = await lireVerrou(dossier);
  if (verrou.statut !== 'bloque' || verrou.pid !== pid) {
    journal.info(`Arrêt forcé : le verrou a changé (état « ${verrou.statut} »), aucun processus arrêté.`);
    return 0;
  }
  const nom = nomProcessus(pid);
  if (!estProgrammeNode(nom)) {
    journal.erreur(`Arrêt forcé refusé : le PID ${pid} du verrou correspond à « ${nom ?? 'aucun processus lisible'} », pas à node. Rien n'a été arrêté.`);
    return CODE_ARRET_REFUSE;
  }
  journal.info(`Arrêt forcé : arrêt du processus ${pid} (${nom}), seul PID indiqué par le verrou.`);
  try {
    process.kill(pid, process.platform === 'win32' ? undefined : 'SIGTERM');
  } catch (err) {
    if (err.code !== 'ESRCH') {
      journal.erreur(`Arrêt forcé : impossible d'arrêter le processus ${pid} (${err.code ?? 'erreur'}).`);
      return 1;
    }
  }
  let fini = await attendreFinProcessus(pid, 4000);
  if (!fini && process.platform !== 'win32') {
    try { process.kill(pid, 'SIGKILL'); } catch { /* déjà parti */ }
    fini = await attendreFinProcessus(pid, 3000);
  }
  if (!fini) {
    journal.erreur(`Arrêt forcé : le processus ${pid} est toujours présent.`);
    return 1;
  }
  journal.info(`Arrêt forcé : processus ${pid} arrêté. Le prochain démarrage signalera un arrêt anormal (verrou périmé repris).`);
  return 0;
}

async function arretPropre(port) {
  journal.info(`Arrêt de secours : demande d'arrêt propre (port ${port}).`);
  const statut = await demanderArret(port, 3000);
  if (statut !== 202) {
    journal.erreur(`Arrêt de secours : réponse inattendue (${statut}).`);
    return 1;
  }
  if (await attendrePortLibre(port, 40)) { // 40 x 250 ms = 10 s
    journal.info('Arrêt de secours : port libéré.');
    return 0;
  }
  journal.erreur('Arrêt de secours : le port est toujours occupé après 10 s.');
  return 1;
}

async function main() {
  const forcer = process.argv.slice(2).includes('--forcer');
  try { if (fs.existsSync(path.join(RACINE, '.env'))) process.loadEnvFile(path.join(RACINE, '.env')); } catch { /* .env illisible : valeurs par défaut */ }
  try {
    const { creerJournal } = await import('../src/journal.js');
    const { resoudreDossierJournal } = await import('../src/config.js');
    let dossierJournal;
    try { dossierJournal = resoudreDossierJournal(); } catch { dossierJournal = path.join(RACINE, 'logs'); }
    journal = creerJournal({ dossier: dossierJournal });
  } catch { /* journal indisponible */ }

  const demande = lirePortDemande();
  if (demande.port === null) return 12;
  const dossier = dossierDonnees();

  // Le verrou d'instance donne le port RÉEL (il peut différer de ERGO_PORT / 4780 : repli de port, autre ERGO_PORT d'un lancement précédent).
  let verrou = null;
  try { verrou = await lireVerrou(dossier); } catch { /* ERGO_VERROU_DIR refusé : on se rabat sur le port configuré */ }
  if (verrou?.statut === 'actif') return arretPropre(verrou.port);
  if (verrou?.statut === 'bloque') {
    if (forcer) return arretForce(dossier);
    journal.info(`Arrêt de secours : instance bloquée (PID ${verrou.pid}, port ${verrou.port ?? 'inconnu'}), rien n'a été arrêté (utiliser --forcer après confirmation).`);
    return CODE_INSTANCE_BLOQUEE;
  }

  // Pas de verrou exploitable : port configuré.
  const port = demande.port;
  if (!(await estNotreApplication(port))) {
    journal.info('Arrêt de secours : application non lancée, rien à arrêter.');
    return (await portEstLibre(port)) ? 10 : 11;
  }
  return arretPropre(port);
}

main().then((code) => process.exit(code), (err) => {
  journal.erreur(`Arrêt de secours : erreur inattendue (${err?.code ?? err?.name ?? 'inconnue'}).`);
  process.exit(1);
});

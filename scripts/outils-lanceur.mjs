// Outils du mode diagnostic (appelés par « Lancer suivi-facturation.bat »). Aucune dépendance, aucun accès réseau
// hors de cet ordinateur (127.0.0.1 uniquement), aucune écriture sur disque.
//
//   node --env-file-if-exists=.env scripts/outils-lanceur.mjs etat
//       Code de sortie : 0 = port libre (on peut démarrer) ; 10 = notre application tourne déjà (sur CE dossier de données, quel que soit son port) ;
//                        11 = le port est occupé par autre chose ; 12 = ERGO_PORT invalide (message en français affiché ici) ;
//                        13 = une ancienne instance est présente mais ne répond plus (message affiché ici).
//   node --env-file-if-exists=.env scripts/outils-lanceur.mjs ouvrir [--maintenant]
//       Attend que l'application réponde (30 s au plus, sans bruit), puis ouvre le navigateur par défaut, sur le port indiqué par le
//       verrou d'instance (sinon ERGO_PORT / 4780). Avec --maintenant : n'attend pas.
//
// L'ouverture du navigateur est multi-plateforme (voir lib-lanceur.mjs). Variable de test : ERGO_LANCEUR_SANS_NAVIGATEUR=1 affiche l'adresse.
import { lireVerrou } from '../src/verrou.js';
import { ADRESSE, pause, lirePortDemande, dossierDonnees, estNotreApplication, portEstLibre, ouvrirNavigateur } from './lib-lanceur.mjs';

/** Verrou d'instance de ce dossier de données, ou null s'il est illisible (ERGO_VERROU_DIR refusé). */
async function verrouActuel() {
  try { return await lireVerrou(dossierDonnees()); } catch { return null; }
}

async function main() {
  const [commande, option] = process.argv.slice(2);
  const demande = lirePortDemande();
  if (demande.port === null) {
    if (commande === 'etat') {
      console.error(`ERGO_PORT « ${demande.brut.slice(0, 20)} » n'est pas un numéro de port valide : il faut un nombre entier entre 1 et 65535. Corrigez la ligne ERGO_PORT du fichier .env.`);
    }
    process.exit(12);
  }

  if (commande === 'etat') {
    const verrou = await verrouActuel();
    if (verrou?.statut === 'actif') process.exit(10);
    if (verrou?.statut === 'bloque') {
      console.error(`Une ancienne copie de l'application (PID ${verrou.pid}, port ${verrou.port ?? 'inconnu'}) ne répond plus. Rien n'a été arrêté.`);
      process.exit(13);
    }
    if (await estNotreApplication(demande.port)) process.exit(10);
    process.exit((await portEstLibre(demande.port)) ? 0 : 11);
  }
  if (commande === 'ouvrir') {
    const essais = option === '--maintenant' ? 1 : 100; // 100 x 300 ms = 30 s
    for (let i = 0; i < essais; i++) {
      const verrou = await verrouActuel();
      const port = verrou?.statut === 'actif' ? verrou.port : demande.port;
      if (await estNotreApplication(port)) {
        await ouvrirNavigateur(`http://${ADRESSE}:${port}/`, { info: (m) => { if (m.startsWith('ouverture')) console.log(`(test) ${m}`); else if (m.startsWith('aucun')) console.log(m); } });
        await pause(500);
        process.exit(0);
      }
      await pause(300);
    }
    process.exit(1);
  }
  console.error('Commande inconnue.');
  process.exit(64);
}

main();

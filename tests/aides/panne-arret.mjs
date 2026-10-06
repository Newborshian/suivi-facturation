// Préchargement (node --import) pour les tests d'arrêt : simule des pannes pendant l'arrêt du VRAI processus `src/server.js`.
// ERGO_TEST_PANNE = liste séparée par des virgules :
//   verrou-eperm    : la suppression du fichier verrou échoue toujours avec EPERM (Windows : fichier tenu par un antivirus)
//   serveur-bloque  : le serveur de l'application ne se ferme jamais (close() sans effet, closeAllConnections() ne ferme rien) : seul le garde-temps peut faire sortir.
//                     Seul le serveur créé AVEC un gestionnaire de requêtes est touché (pas la sonde de port du démarrage).
import fs from 'node:fs';
import http from 'node:http';

const pannes = (process.env.ERGO_TEST_PANNE ?? '').split(',').map((x) => x.trim());

if (pannes.includes('verrou-eperm')) {
  const unlink = fs.unlinkSync.bind(fs);
  fs.unlinkSync = (chemin, ...suite) => {
    if (String(chemin).endsWith('.verrou')) throw Object.assign(new Error('EPERM simulé'), { code: 'EPERM' });
    return unlink(chemin, ...suite);
  };
}
//   port-eacces     : la sonde de port du démarrage (serveur sans gestionnaire de requêtes) échoue avec EACCES, comme un port réservé sous Linux.
if (pannes.includes('port-eacces')) {
  const creer = http.createServer.bind(http);
  http.createServer = (...args) => {
    const serveur = creer(...args);
    if (!args.some((a) => typeof a === 'function')) {
      serveur.listen = () => {
        queueMicrotask(() => serveur.emit('error', Object.assign(new Error('EACCES simulé'), { code: 'EACCES' })));
        return serveur;
      };
    }
    return serveur;
  };
}
if (pannes.includes('serveur-bloque')) {
  const creer = http.createServer.bind(http);
  http.createServer = (...args) => {
    const serveur = creer(...args);
    if (args.some((a) => typeof a === 'function')) {
      serveur.close = () => serveur;
      serveur.closeAllConnections = () => {};
    }
    return serveur;
  };
}

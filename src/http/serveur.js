// Serveur HTTP : écoute sur 127.0.0.1 UNIQUEMENT. Chaîne : en-têtes -> contrôles de sécurité -> API | statique.
import http from 'node:http';
import path from 'node:path';
import { ErreurApp } from '../erreurs.js';
import { ErreurConfig, RACINE_PROJET } from '../config.js';
import { decrireErreur, journalNul } from '../journal.js';
import { enregistrerRoutesApi } from './api/index.js';
import { enErreurHttp, envoyerJson } from './reponses.js';
import { creerRouteur } from './routeur.js';
import { appliquerEntetes, controlerRequete } from './securite.js';
import { servirStatique } from './statique.js';

export const ADRESSE_ECOUTE = '127.0.0.1'; // en dur : jamais configurable

/** Liaison au port impossible (autre cause que « déjà utilisé ») : configuration refusée, code de sortie 2, message en français. */
export function erreurLiaisonPort(port, err) {
  const cause = err?.code === 'EACCES' ? "accès refusé : ce port est réservé par le système (essayez un numéro supérieur à 1023)" : `erreur ${err?.code ?? 'inconnue'}`;
  return new ErreurConfig(`Le port ${port} ne peut pas être ouvert sur 127.0.0.1 (${cause}). Aucun fichier de données n'a été touché. Changez ERGO_PORT.`);
}

/**
 * Le port est-il libre sur 127.0.0.1 ? (sonde : écoute puis fermeture immédiates, aucun trafic).
 * Sert à refuser une seconde instance AVANT toute action sur le dossier de données.
 * Port occupé : false. Toute autre erreur de liaison (accès refusé, adresse indisponible…) : ErreurConfig (code de sortie 2).
 */
export function portEstLibre(port) {
  return new Promise((resolve, reject) => {
    const sonde = http.createServer();
    sonde.once('error', (err) => (err.code === 'EADDRINUSE' ? resolve(false) : reject(erreurLiaisonPort(port, err))));
    sonde.listen(port, ADRESSE_ECOUTE, () => sonde.close(() => resolve(true)));
  });
}

const nettoyerPourJournal = (texte) => texte.replace(/[^\x20-\x7e]/g, '?').slice(0, 200);

/**
 * `ajouterRoutes(routeur)` (facultatif) permet d'ajouter des routes, notamment pour les tests.
 * `journal(ligne)` reçoit une ligne par requête : méthode, chemin sans paramètres, statut, code d'erreur.
 * `evenements` = journal d'événements (src/journal.js) : seules les erreurs 5xx y sont écrites, jamais les requêtes normales.
 * `demanderArret()` est appelée après l'envoi de la réponse de POST /api/arreter.
 */
export function creerServeur({ store, config, horloge, version, racinePublic = path.join(RACINE_PROJET, 'public'), journal = console.log, evenements = journalNul, demanderArret, presence, ajouterRoutes } = {}) {
  const routeur = creerRouteur();
  enregistrerRoutesApi(routeur, { store, config, horloge, version, demanderArret, presence, evenements });
  if (ajouterRoutes) ajouterRoutes(routeur);

  let server;
  const dernierEnvoi5xx = new Map(); // une même erreur 5xx n'est écrite qu'une fois par minute (ex. interrogations répétées en mode dégradé)
  function journaliser5xx(req, chemin, status, codeErreur, err) {
    const cle = `${req.method} ${chemin} ${status} ${codeErreur}`;
    const maintenant = Date.now();
    if (maintenant - (dernierEnvoi5xx.get(cle) ?? 0) < 60_000) return;
    if (dernierEnvoi5xx.size > 200) dernierEnvoi5xx.clear();
    dernierEnvoi5xx.set(cle, maintenant);
    // Jamais le message de l'erreur : il pourrait contenir des données.
    evenements.erreur(`Erreur HTTP ${status} (${codeErreur}) sur ${req.method} ${nettoyerPourJournal(chemin)}${err instanceof ErreurApp ? '' : ` : ${decrireErreur(err)}`}`);
  }
  const portActif = () => server.address()?.port;

  async function traiter(req, res) {
    appliquerEntetes(res);
    const chemin = (req.url ?? '/').split(/[?#]/, 1)[0];
    const requete = { chemin, query: new URLSearchParams((req.url ?? '').split('?')[1]?.split('#')[0] ?? '') };
    let code = '';
    // Les battements de présence (toutes les 15 s par page) ne sont pas écrits dans la console : bruit sans intérêt.
    res.on('finish', () => !(chemin === '/api/presence' && res.statusCode === 204) && journal(`${req.method} ${nettoyerPourJournal(chemin)} ${res.statusCode}${code ? ` ${code}` : ''}`));
    try {
      controlerRequete(req, portActif());
      if (chemin === '/api' || chemin.startsWith('/api/')) {
        const trouve = routeur.resoudre(req.method, chemin);
        if (!trouve) throw new ErreurApp(404, 'INTROUVABLE', 'Ressource introuvable.');
        if (trouve.methodesAutorisees) throw new ErreurApp(405, 'METHODE_REFUSEE', 'Méthode non autorisée.');
        const reponse = await trouve.gestionnaire(req, res, { params: trouve.params, requete });
        if (reponse && !res.writableEnded) {
          envoyerJson(res, reponse.status ?? 200, reponse.corps, { sansCorps: req.method === 'HEAD' });
        }
      } else if (chemin === '/favicon.ico' && (req.method === 'GET' || req.method === 'HEAD')) {
        // Pas d'icône pour l'instant : 204 plutôt qu'un 404 à chaque page. Contrôles et en-têtes de sécurité déjà appliqués.
        res.statusCode = 204;
        res.setHeader('Cache-Control', 'no-cache');
        res.end();
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await servirStatique(req, res, chemin, racinePublic);
      } else {
        throw new ErreurApp(405, 'METHODE_REFUSEE', 'Méthode non autorisée.');
      }
    } catch (err) {
      const { status, code: codeErreur, corps } = enErreurHttp(err);
      code = codeErreur;
      if (status >= 500) journaliser5xx(req, chemin, status, codeErreur, err);
      if (!(err instanceof ErreurApp)) journal(`Erreur interne : ${err?.name ?? 'inconnue'}`); // jamais le message : il pourrait contenir des données
      if (!res.headersSent) {
        envoyerJson(res, status, corps, { sansCorps: req.method === 'HEAD' });
      } else {
        res.destroy();
      }
    }
  }

  server = http.createServer((req, res) => {
    traiter(req, res).catch(() => res.destroy());
  });

  return {
    server,
    /** Démarre l'écoute ; renvoie le port réellement utilisé (utile avec le port 0 des tests). */
    demarrer(port = config.port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, ADRESSE_ECOUTE, () => {
          server.off('error', reject);
          resolve(server.address().port);
        });
      });
    },
    /** Plus de nouvelle requête : la promesse est tenue quand toutes les connexions sont fermées (voir fermerConnexions). */
    cesserEcoute() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    fermerConnexions() {
      server.closeAllConnections();
    },
    /** Fermeture immédiate : écoute et connexions. */
    arreter() {
      const fin = this.cesserEcoute();
      this.fermerConnexions();
      return fin;
    },
  };
}

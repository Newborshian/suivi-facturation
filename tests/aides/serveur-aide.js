// Serveur de test : 127.0.0.1, port 0 (choisi par l'OS), dossier de données temporaire sous .tmp/tests/.
import http from 'node:http';
import './garde-processus.js';
import { creerDossierTemp, supprimerDossierTemp } from './temp.js';
import { etatInitialTest } from './catalogue-test.js';
import { horlogeFixe } from './horloge.js';
import { creerServeur } from '../../src/http/serveur.js';
import { ouvrirStore } from '../../src/store/store.js';

/**
 * `horloge` et `fs` (simulé) sont facultatifs : horloge fixe du 2026-10-02 et vrai système de fichiers par défaut.
 * L'application crée un catalogue VIDE sur un dossier neuf : sauf `catalogueVide: true`, le fichier créé au premier démarrage reçoit le catalogue
 * de test (option `etatInitial` du store ; les tests de saisie en ont besoin). Un fichier préparé par le test n'est jamais touché.
 */
export async function demarrerServeurTest({ ajouterRoutes, preparer, racinePublic, horloge = horlogeFixe('2026-10-02'), fs, evenements, demanderArret, presence, catalogueVide = false } = {}) {
  const dossier = await creerDossierTemp('http');
  if (preparer) await preparer(dossier);
  const store = await ouvrirStore({ dossier, horloge, ...(catalogueVide ? {} : { etatInitial: etatInitialTest }), ...(fs ? { fs } : {}), ...(evenements ? { journal: evenements } : {}) });
  const journal = [];
  const app = creerServeur({ store, config: { dossier, port: 0 }, horloge, version: '0.0.0-test', racinePublic, journal: (l) => journal.push(l), ajouterRoutes, ...(evenements ? { evenements } : {}), ...(demanderArret ? { demanderArret } : {}), ...(presence ? { presence } : {}) });
  const port = await app.demarrer(0);
  return {
    port,
    dossier,
    store,
    journal,
    app,
    async arreter() {
      await app.arreter();
      await supprimerDossierTemp(dossier);
    },
    /** Requête brute via node:http (permet de forcer Host, Origin, chemins non normalisés). */
    requete(options) {
      return requeteBrute({ port, ...options }); // `reprises: n` : voir requeteBrute
    },
  };
}

/** `headers` peut imposer un Content-Length explicite (sans quoi node envoie le corps en Transfer-Encoding: chunked). */
export async function requeteBrute({ reprises = 0, ...options }) {
  for (let essai = 0; ; essai++) {
    try {
      return await requeteUnique(options);
    } catch (err) {
      // Sous Windows, un serveur qui répond 413 et ferme sans avoir lu le corps peut réinitialiser la connexion (RST) avant que le client
      // ait lu la réponse. Seuls les tests de refus de gros corps demandent des reprises ; les autres échouent tout de suite.
      if (!['ECONNRESET', 'EPIPE'].includes(err.code) || essai >= reprises) throw err;
    }
  }
}

function requeteUnique({ port, methode = 'GET', chemin = '/', headers = {}, corps, hote = `127.0.0.1:${port}` }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: methode, path: chemin, headers: { Host: hote, ...headers } }, (res) => {
      const morceaux = [];
      res.on('data', (m) => morceaux.push(m));
      res.on('end', () => {
        const texte = Buffer.concat(morceaux).toString('utf8');
        let json = null;
        try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, texte, json });
      });
    });
    req.on('error', reject);
    if (corps !== undefined) req.write(corps);
    req.end();
  });
}

// Arrêt propre du processus, dans cet ordre : garde-temps armé, plus de nouvelles requêtes, file d'écriture vidée,
// connexions restantes fermées, verrou libéré, ligne au journal, sortie. Dépendances injectables pour les tests.
import { decrireErreur } from './journal.js';

export const DELAI_ARRET_MS = 5000;

/**
 * @param {object} o
 * @param {{ cesserEcoute: () => Promise<void>, fermerConnexions: () => void }} o.app serveur HTTP
 * @param {{ fermer: () => Promise<void> }} o.store
 * @param {() => void} o.libererVerrou
 * @param {{ info: Function, avert: Function, erreur: Function }} o.journal
 * @returns {(origine: string) => Promise<void>} appel unique : un second appel est sans effet
 *
 * Le garde-temps est armé en premier, jamais désarmé ni `unref` : s'il expire, sortie forcée (code 0 ; le verrou est alors libéré par le gestionnaire `exit`).
 */
export function creerArret({ app, store, libererVerrou, journal, sortir = (code) => process.exit(code), delaiMs = DELAI_ARRET_MS, minuteur = setTimeout }) {
  let enCours = false;
  return async function arreter(origine) {
    if (enCours) return;
    enCours = true;
    minuteur(() => {
      journal.avert(`Arrêt (${origine}) : délai de ${delaiMs / 1000} s dépassé, sortie forcée.`);
      sortir(0);
    }, delaiMs);
    try {
      const ecouteFermee = app.cesserEcoute(); // plus aucune nouvelle requête (les connexions déjà ouvertes finissent leur travail)
      await store.fermer(); // file d'écriture vidée
      app.fermerConnexions();
      await ecouteFermee;
      libererVerrou();
      journal.info(`Arrêt propre (${origine}).`);
      sortir(0);
    } catch (err) {
      journal.erreur(`Arrêt (${origine}) en échec : ${decrireErreur(err)}`);
      libererVerrou();
      sortir(1);
    }
  };
}

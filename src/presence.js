// Présence des pages ouvertes : décide quand l'application doit s'arrêter toute seule (quand plus aucune page n'est ouverte).
// Logique pure : horloge et minuteurs injectables (tests sans attente réelle). Aucune donnée de patient : seuls des identifiants d'onglet opaques.
//
// Règles (toutes évaluées par `controler()`, appelée toutes les `periodeMs` et une fois à l'échéance d'un délai de grâce) :
//  - le dernier identifiant disparaît (« fermee » ou plus de battement depuis `pulsationMs`) : délai de grâce de `fermetureMs`, annulé par toute « ouverte » ;
//  - aucune page connectée depuis le démarrage au bout de `premierePageMs` : arrêt ;
//  - saut d'horloge (mise en veille : plus de `sautMs` entre deux contrôles) : tous les `dernierVu` repartent de « maintenant », aucune échéance ce tour-là.
// Désactivée (`actif: false`) : les signaux sont validés puis ignorés, jamais d'arrêt.

export const MOTIF_ID = /^[A-Za-z0-9-]{8,64}$/;
export const ETATS = ['ouverte', 'fermee'];
export const MAX_IDENTIFIANTS = 50;
export const DELAIS_DEFAUT_S = { fermeture: 10, pulsation: 600, premierePage: 300 };

const duree = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 && s % 60 === 0 ? `${s / 60} minute${s === 60 ? '' : 's'}` : `${s} seconde${s === 1 ? '' : 's'}`;
};

/**
 * @param {object} o
 * @param {boolean} [o.actif]
 * @param {{fermetureMs:number, pulsationMs:number, premierePageMs:number}} o.delais
 * @param {(raison: string) => void} o.surArret appelée au plus une fois ; la raison complète la phrase « Arrêt automatique : … »
 */
export function creerPresence({
  actif = false,
  delais = { fermetureMs: DELAIS_DEFAUT_S.fermeture * 1000, pulsationMs: DELAIS_DEFAUT_S.pulsation * 1000, premierePageMs: DELAIS_DEFAUT_S.premierePage * 1000 },
  surArret = () => {},
  maintenant = Date.now,
  minuteurs = { setInterval, clearInterval, setTimeout, clearTimeout },
  periodeMs = 5000,
  sautMs = 60_000,
  maxIdentifiants = MAX_IDENTIFIANTS,
} = {}) {
  const pages = new Map(); // id -> dernierVu ; l'ordre d'insertion = du moins récemment vu au plus récent
  let debut = maintenant();
  let dernierControle = debut;
  let dejaConnectee = false;
  let finDepuis = null; // instant où la dernière page a disparu
  let raisonFin = '';
  let arretDemande = false;
  let intervalle = null;
  let minuteurGrace = null;

  function annulerGrace() {
    finDepuis = null;
    if (minuteurGrace !== null) minuteurs.clearTimeout(minuteurGrace);
    minuteurGrace = null;
  }

  function demarrerGrace(raison, depuis) {
    finDepuis = depuis;
    raisonFin = raison;
    if (minuteurGrace !== null) minuteurs.clearTimeout(minuteurGrace);
    minuteurGrace = minuteurs.setTimeout(controler, delais.fermetureMs + 1);
    minuteurGrace?.unref?.();
  }

  function arreter(raison) {
    if (arretDemande) return;
    arretDemande = true;
    arreterSurveillance();
    surArret(raison);
  }

  function controler() {
    if (!actif || arretDemande) return;
    const t = maintenant();
    if (t - dernierControle > sautMs) {
      // Mise en veille (ou horloge changée) : l'absence de battement n'est pas démontrée. On repart de zéro, sans rien déclencher.
      for (const id of pages.keys()) pages.set(id, t);
      debut = t;
      if (finDepuis !== null) finDepuis = t;
      dernierControle = t;
      return;
    }
    dernierControle = t;
    for (const [id, vu] of pages) if (t - vu >= delais.pulsationMs) pages.delete(id);
    if (pages.size > 0) {
      annulerGrace();
      return;
    }
    if (!dejaConnectee) {
      if (t - debut >= delais.premierePageMs) arreter(`aucune page ne s'est connectée en ${duree(delais.premierePageMs)}`);
      return;
    }
    if (finDepuis === null) demarrerGrace(`plus aucun battement depuis ${duree(delais.pulsationMs)}`, t);
    else if (t - finDepuis >= delais.fermetureMs) arreter(raisonFin);
  }

  function arreterSurveillance() {
    if (intervalle !== null) minuteurs.clearInterval(intervalle);
    intervalle = null;
    annulerGrace();
  }

  return {
    actif,
    /** Valide puis enregistre un signal. -> false si l'identifiant ou l'état est invalide (rien n'est retenu). */
    signaler(id, etat) {
      if (typeof id !== 'string' || !MOTIF_ID.test(id) || !ETATS.includes(etat)) return false;
      if (!actif || arretDemande) return true;
      if (etat === 'ouverte') {
        pages.delete(id); // réinsérer = le plus récent
        pages.set(id, maintenant());
        while (pages.size > maxIdentifiants) pages.delete(pages.keys().next().value);
        dejaConnectee = true;
        annulerGrace();
      } else if (pages.delete(id) && pages.size === 0) {
        demarrerGrace('la dernière page a été fermée', maintenant());
      }
      return true;
    },
    /** Lance le contrôle périodique (les minuteurs ne retiennent pas le processus). À appeler quand le serveur écoute. */
    demarrer() {
      if (!actif || intervalle !== null) return;
      debut = maintenant();
      dernierControle = debut;
      intervalle = minuteurs.setInterval(controler, periodeMs);
      intervalle?.unref?.();
    },
    arreter: arreterSurveillance,
    controler,
    nombre: () => pages.size,
  };
}

// Présence de la page : signale au serveur que cet onglet est ouvert (toutes les 15 s) puis fermé (sendBeacon), pour l'arrêt automatique.
// Chargé par toutes les pages. Aucune donnée de patient : seulement un identifiant de page aléatoire. Les erreurs de réseau sont ignorées,
// sauf deux échecs de suite : le serveur est alors arrêté, la page l'explique une seule fois et n'envoie plus rien.
import { alerte } from '/js/bandeaux.js';
import { el } from '/js/dom.js';

const CHEMIN = '/api/presence';
const PERIODE_MS = 15_000;
const ECHECS_MAX = 2;

// Un identifiant par chargement de page, jamais stocké : un onglet dupliqué (qui copie le stockage de session) a donc le sien.
// La navigation et le rechargement changent d'identifiant ; le délai de grâce du serveur les couvre.
const id = crypto.randomUUID();
let arretee = false; // arrêt manuel (bouton « Quitter ») ou serveur constaté arrêté : plus aucune requête
let echecs = 0;
let minuteur = null;

const corps = (etat) => JSON.stringify({ id, etat });

async function battement() {
  if (arretee) return;
  try {
    await fetch(CHEMIN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps('ouverte'), keepalive: true });
    echecs = 0;
  } catch {
    echecs += 1;
    if (echecs >= ECHECS_MAX) signalerArret();
  }
}

function signalerArret() {
  arreterPresence();
  const conteneur = el('div', { classe: 'bandeaux' }, alerte('attention', "L'application est arrêtée.", 'Pour la relancer, utilisez le raccourci Suivi Facturation du Bureau, puis rechargez cette page.', 'alert'));
  document.querySelector('main')?.prepend(conteneur); // hors de #bandeaux : les pages le vident à chaque affichage
}

/** Plus aucune requête depuis cette page (arrêt manuel de l'application, ou serveur déjà arrêté). */
export function arreterPresence() {
  arretee = true;
  if (minuteur !== null) clearInterval(minuteur);
  minuteur = null;
}

function demarrer() {
  battement();
  minuteur = setInterval(battement, PERIODE_MS);
  addEventListener('pagehide', () => {
    if (arretee) return;
    try {
      navigator.sendBeacon(CHEMIN, corps('fermee'));
    } catch {
      // rien à faire : le serveur oubliera cette page après son délai sans battement
    }
  });
  addEventListener('pageshow', (evenement) => {
    if (evenement.persisted) battement(); // retour depuis le cache avant/arrière : la page était « fermée » pour le serveur
  });
}

demarrer();

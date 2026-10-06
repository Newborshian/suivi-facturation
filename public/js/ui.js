// Éléments d'interface communs : messages éphémères (toasts) et boîtes de dialogue natives <dialog>.
// Aucune donnée n'est insérée autrement que par textContent (voir dom.js).
import { descriptionChamp } from '/js/accessibilite.js';
import { el } from '/js/dom.js';

// ---------------------------------------------------------------- Toasts

const DUREES = { succes: 6000, annulable: 12000, attention: 10000 }; // une erreur reste jusqu'à fermeture
let toastCourant = null;

function retirerToast() {
  if (!toastCourant) return;
  clearTimeout(toastCourant.minuteur);
  toastCourant.noeud.remove();
  toastCourant = null;
}

/**
 * Affiche un message éphémère (un seul à la fois : un nouveau remplace le précédent).
 * `variante` : 'succes' | 'attention' | 'erreur' ; `action` : { libelle, auClic } (ex. « Annuler »).
 * La minuterie se met en pause au survol et au focus (WCAG 2.2.1) ; une erreur reste jusqu'à fermeture.
 */
export function afficherToast({ texte, variante = 'succes', action }) {
  const conteneur = document.querySelector('.toasts');
  if (!conteneur) return;
  retirerToast();

  const classe = variante === 'succes' ? 'toast' : `toast toast--${variante}`;
  const noeud = el('div', { classe, attributs: { role: variante === 'erreur' ? 'alert' : null } }, el('p', { classe: 'toast__texte', texte }));
  if (action) {
    noeud.append(
      el('button', {
        classe: 'toast__action',
        texte: action.libelle,
        attributs: { type: 'button' },
        evenements: {
          click: async () => {
            retirerToast();
            await action.auClic();
          },
        },
      }),
    );
  }
  noeud.append(el('button', { classe: 'toast__fermer', texte: '×', attributs: { type: 'button', 'aria-label': 'Fermer' }, evenements: { click: retirerToast } }));
  conteneur.append(noeud);

  const courant = { noeud, minuteur: null };
  toastCourant = courant;
  const duree = variante === 'erreur' ? null : action ? DUREES.annulable : variante === 'attention' ? DUREES.attention : DUREES.succes;
  const armer = () => {
    if (duree === null) return;
    clearTimeout(courant.minuteur);
    courant.minuteur = setTimeout(() => {
      if (toastCourant === courant) retirerToast();
    }, duree);
  };
  const pauser = () => clearTimeout(courant.minuteur);
  for (const evenement of ['mouseenter', 'focusin']) noeud.addEventListener(evenement, pauser);
  for (const evenement of ['mouseleave', 'focusout']) noeud.addEventListener(evenement, armer);
  armer();
}

// ------------------------------------------------------------- Dialogues

let compteurDialogues = 0;

/**
 * Crée une boîte de dialogue modale (<dialog> natif : piège à focus, Échap et inertie fournis par le navigateur).
 * `titre` : question ou intitulé ; `large` : variante large. Renvoie { dialogue, corps, pied, ouvrir, fermer }.
 * `ouvrir(focusInitial)` : donne le focus à l'élément indiqué (sinon le navigateur choisit le premier) ;
 * à la fermeture, le focus retourne à l'élément qui avait le focus à l'ouverture.
 */
export function creerDialogue({ titre, large = false }) {
  const idTitre = `dialogue-titre-${++compteurDialogues}`;
  const corps = el('div', { classe: 'dialogue__corps' });
  const pied = el('div', { classe: 'dialogue__pied' });
  const dialogue = el(
    'dialog',
    { classe: large ? 'dialogue dialogue--large' : 'dialogue', attributs: { 'aria-labelledby': idTitre } },
    el('div', { classe: 'dialogue__entete' }, el('h2', { classe: 'dialogue__titre', texte: titre, attributs: { id: idTitre } })),
    corps,
    pied,
  );
  let declencheur = null;
  dialogue.addEventListener('close', () => {
    dialogue.remove();
    if (declencheur && document.contains(declencheur)) declencheur.focus();
  });
  return {
    dialogue,
    corps,
    pied,
    ouvrir(focusInitial) {
      declencheur = document.activeElement;
      document.body.append(dialogue);
      dialogue.showModal();
      if (focusInitial) focusInitial.focus();
    },
    fermer() {
      if (dialogue.open) dialogue.close();
    },
  };
}

/**
 * Confirmation d'une action : le focus initial est sur « Annuler » (une frappe accidentelle sur Entrée ne détruit rien).
 * -> Promise<boolean> (true si l'utilisatrice confirme).
 */
export function confirmer({ titre, texte, libelleConfirmer, danger = false }) {
  return new Promise((resolve) => {
    const d = creerDialogue({ titre });
    let reponse = false;
    for (const paragraphe of Array.isArray(texte) ? texte : [texte]) d.corps.append(el('p', { texte: paragraphe }));
    const annuler = el('button', { classe: 'btn btn--secondaire', texte: 'Annuler', attributs: { type: 'button' }, evenements: { click: () => d.fermer() } });
    const valider = el('button', {
      classe: danger ? 'btn btn--danger' : 'btn btn--primaire',
      texte: libelleConfirmer,
      attributs: { type: 'button' },
      evenements: {
        click: () => {
          reponse = true;
          d.fermer();
        },
      },
    });
    d.pied.append(annuler, valider);
    d.dialogue.addEventListener('close', () => resolve(reponse));
    d.ouvrir(annuler);
  });
}

// --------------------------------------------------------------- Champs

let compteurChamps = 0;

/**
 * Champ de formulaire accessible (label visible lié, message d'erreur lié par aria-describedby).
 * `creerEntree(id)` renvoie l'élément de saisie (input, select…). -> { racine, entree, erreur(message), effacerErreur() }
 */
export function creerChamp({ label, requis = false, aide, large = false, creerEntree }) {
  const id = `champ-${++compteurChamps}`;
  const idErreur = `${id}-erreur`;
  const idAide = aide ? `${id}-aide` : null;
  const entree = creerEntree(id);
  const saisie = entree.matches('input, select, textarea') ? entree : entree.querySelector('input, select, textarea'); // le champ montant enveloppe son input
  const paraErreur = el('p', { classe: 'champ__erreur', attributs: { id: idErreur, hidden: true } });
  const racine = el(
    'div',
    { classe: large ? 'champ champ--large' : 'champ' },
    el('label', { classe: 'champ__label', attributs: { for: id } }, label, requis ? el('span', { classe: 'champ__requis', texte: ' (obligatoire)' }) : null),
    entree,
    aide ? el('p', { classe: 'champ__aide', texte: aide, attributs: { id: idAide } }) : null,
    paraErreur,
  );
  const decrire = (enErreur) => {
    const valeur = descriptionChamp({ idAide, idErreur, enErreur });
    if (valeur === null) saisie.removeAttribute('aria-describedby');
    else saisie.setAttribute('aria-describedby', valeur);
  };
  decrire(false); // l'aide est annoncée avec le champ (« Entre 7 et 365 »)
  return {
    racine,
    entree,
    saisie,
    erreur(message) {
      racine.classList.add('champ--erreur');
      saisie.setAttribute('aria-invalid', 'true');
      decrire(true);
      paraErreur.textContent = message; // le « ! » est ajouté par le CSS
      paraErreur.hidden = false;
    },
    effacerErreur() {
      racine.classList.remove('champ--erreur');
      saisie.removeAttribute('aria-invalid');
      decrire(false);
      paraErreur.textContent = '';
      paraErreur.hidden = true;
    },
  };
}

/** Champ montant (« 45,00 € ») : texte, pas `number`, pour accepter « 1 250,50 ». */
export function creerEntreeMontant(id, valeur = '') {
  return el(
    'div',
    { classe: 'champ-montant' },
    el('input', { classe: 'input', attributs: { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', name: 'montant' }, proprietes: { value: valeur } }),
    el('span', { classe: 'champ-montant__unite', texte: '€', attributs: { 'aria-hidden': 'true' } }),
  );
}

/** Résumé d'erreurs en tête de formulaire (liens vers chaque champ en erreur). */
export function creerResume() {
  const racine = el('div', { classe: 'alerte alerte--danger', attributs: { role: 'alert', hidden: true, tabindex: '-1' } });
  return {
    racine,
    afficher(titre, liens) {
      racine.replaceChildren(
        el(
          'div',
          { classe: 'alerte__corps' },
          el('strong', { classe: 'alerte__titre', texte: titre }),
          ...liens.map(({ texte, cible }) =>
            el(
              'p',
              { classe: 'alerte__texte' },
              el('a', {
                texte,
                attributs: { href: '#' },
                evenements: {
                  click: (evenement) => {
                    evenement.preventDefault();
                    cible.focus();
                  },
                },
              }),
            ),
          ),
        ),
      );
      racine.hidden = false;
    },
    masquer() {
      racine.hidden = true;
      racine.replaceChildren();
    },
  };
}

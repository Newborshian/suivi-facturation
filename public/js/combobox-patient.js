// Combobox de recherche de patient (design system §8.10) : deux champs (Nom, Prénom) qui cherchent dans le même registre,
// motif ARIA 1.2 « combobox avec liste » (le focus ne quitte jamais le champ), une seule indication pour les deux champs.
// La liste PROPOSE : Entrée valide le formulaire tant qu'aucune option n'est active. Construit par el() / textContent uniquement.
import { el } from '/js/dom.js';
import { annonceSuggestions, indicationPatient, libelleSuggestion, optionCreer, rechercherPatients } from '/js/recherche-patients.js';

const DELAI_ANNONCE_MS = 400; // l'annonce attend une pause de frappe : le lecteur d'écran ne lit pas chaque lettre
let compteur = 0;

/**
 * `registre` : () => liste des patients (GET /api/patients), toujours la plus récente ; `suivant` : () => élément qui reçoit le focus
 * après le choix d'une suggestion (la date). -> { indication, composant, relier, patientChoisi, reinitialiser, actualiser, fermer }.
 */
export function creerSelecteurPatient({ registre, suivant }) {
  const numero = ++compteur;
  const etat = { choisi: null, creerChoisi: false };
  const combos = {};
  const indication = el('p', { classe: 'indication-patient', attributs: { id: `indication-patient-${numero}`, role: 'status' } });
  const lireSaisie = () => ({ nom: combos.nom?.saisie.value ?? '', prenom: combos.prenom?.saisie.value ?? '' });

  function majIndication() {
    const r = indicationPatient(registre(), lireSaisie(), etat.choisi, etat.creerChoisi);
    if ((indication.getAttribute('data-patient') ?? null) === r.type && indication.textContent === r.texte) return; // pas de ré-annonce inutile
    if (r.type) indication.setAttribute('data-patient', r.type);
    else indication.removeAttribute('data-patient');
    indication.textContent = r.texte;
  }

  const estOuvert = (c) => !c.liste.hidden;

  function fermer(c) {
    c.liste.hidden = true;
    c.vide.hidden = true;
    c.saisie.setAttribute('aria-expanded', 'false');
    c.saisie.removeAttribute('aria-activedescendant');
    c.actif = -1;
  }
  const fermerTout = () => Object.values(combos).forEach(fermer);

  function annoncer(c, texte) {
    clearTimeout(c.minuterie);
    if (texte === '') {
      c.annonce.textContent = '';
      return;
    }
    c.minuterie = setTimeout(() => {
      c.annonce.textContent = texte;
    }, DELAI_ANNONCE_MS);
  }

  function activer(c, index) {
    c.actif = index;
    c.entrees.forEach((_, i) => c.options[i].setAttribute('aria-selected', i === index ? 'true' : 'false'));
    if (index >= 0) {
      c.saisie.setAttribute('aria-activedescendant', c.options[index].id);
      c.options[index].scrollIntoView({ block: 'nearest' });
    } else {
      c.saisie.removeAttribute('aria-activedescendant');
    }
  }

  function choisir(c, index) {
    const entree = c.entrees[index];
    if (!entree) return;
    const autre = c === combos.nom ? combos.prenom : combos.nom;
    fermerTout();
    annoncer(c, '');
    if (entree.type === 'patient') {
      etat.choisi = entree.patient;
      etat.creerChoisi = false;
      combos.nom.saisie.value = entree.patient.nom;
      combos.prenom.saisie.value = entree.patient.prenom;
      majIndication();
      (suivant?.() ?? c.saisie).focus();
    } else {
      // « Créer… » ne crée rien : le patient naît avec la prestation. On garde le texte tel quel.
      etat.choisi = null;
      etat.creerChoisi = true;
      majIndication();
      (autre.saisie.value.trim() === '' ? autre.saisie : (suivant?.() ?? c.saisie)).focus();
    }
  }

  /** Reconstruit la liste de `c` d'après les deux champs. `force` : ouvrir même si rien n'est tapé (flèche bas). */
  function rendre(c, { force = false } = {}) {
    const saisie = lireSaisie();
    const videTape = saisie.nom.trim() === '' && saisie.prenom.trim() === '';
    if (videTape && !force) {
      fermer(c);
      annoncer(c, '');
      return;
    }
    const reg = registre();
    const { patients, total } = rechercherPatients(reg, saisie, { repli: c.cle });
    const creer = optionCreer(reg, saisie.nom, saisie.prenom);
    c.entrees = [...patients.map((patient) => ({ type: 'patient', patient })), ...(creer ? [{ type: 'creer', texte: creer.texte }] : [])];
    c.options = c.entrees.map((entree, i) => {
      const id = `${c.saisie.id}-opt-${i}`;
      const attributs = { role: 'option', id, 'aria-selected': 'false' };
      const evenements = {
        mousedown: (evenement) => evenement.preventDefault(), // le focus reste dans le champ
        click: () => choisir(c, i),
      };
      if (entree.type === 'creer') return el('li', { classe: 'suggestion suggestion--creer', texte: entree.texte, attributs, evenements });
      const l = libelleSuggestion(entree.patient);
      return el(
        'li',
        { classe: entree.patient.actif === false ? 'suggestion suggestion--archive' : 'suggestion', attributs, evenements },
        el('span', { classe: 'suggestion__nom', texte: l.nom }),
        l.detail ? el('span', { classe: 'suggestion__detail', texte: l.detail }) : null,
        l.marque ? el('span', { classe: 'suggestion__marque', texte: l.marque }) : null,
      );
    });
    c.liste.replaceChildren(...c.options);
    c.actif = -1;
    c.saisie.removeAttribute('aria-activedescendant');
    if (c.entrees.length > 0) {
      c.vide.hidden = true;
      c.liste.hidden = false;
      c.saisie.setAttribute('aria-expanded', 'true');
    } else {
      // Rien à proposer ni à créer : message dans le même cadre, hors du listbox (qui ne contient que des options).
      c.liste.hidden = true;
      c.saisie.setAttribute('aria-expanded', 'false');
      c.vide.textContent = reg.length === 0 ? 'Aucun patient enregistré pour le moment. Tapez un nom pour en créer un.' : 'Aucun patient enregistré ne correspond.';
      c.vide.hidden = false;
    }
    annoncer(c, videTape ? '' : annonceSuggestions({ nombre: patients.length, total, creer: creer !== null }));
  }

  function deplacer(c, pas) {
    const n = c.entrees.length;
    if (n === 0) return;
    const suivantIndex = c.actif < 0 ? (pas > 0 ? 0 : n - 1) : (c.actif + pas + n) % n; // la dernière ramène à la première, et inversement
    activer(c, suivantIndex);
  }

  function surClavier(c, evenement) {
    if (evenement.isComposing) return;
    if (evenement.key === 'ArrowDown') {
      evenement.preventDefault();
      if (estOuvert(c)) deplacer(c, 1);
      else rendre(c, { force: true });
    } else if (evenement.key === 'ArrowUp') {
      if (!estOuvert(c)) return;
      evenement.preventDefault();
      deplacer(c, -1);
    } else if (evenement.key === 'Enter') {
      if (estOuvert(c) && c.actif >= 0) {
        evenement.preventDefault(); // choisit l'option sans envoyer le formulaire
        choisir(c, c.actif);
      }
    } else if (evenement.key === 'Escape') {
      if (estOuvert(c) || !c.vide.hidden) {
        evenement.preventDefault();
        evenement.stopPropagation(); // ne ferme pas le dialogue parent
        fermer(c);
      }
    }
  }

  return {
    indication,

    /** Contenu du champ (à passer à creerChamp) : <div class="combo"> avec le champ, la liste et le message « aucun résultat ». */
    composant(cle, id) {
      const saisie = el('input', {
        classe: 'input',
        attributs: {
          id,
          type: 'text',
          autocomplete: 'off',
          maxlength: '100',
          name: cle,
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-haspopup': 'listbox',
          'aria-expanded': 'false',
          'aria-controls': `${id}-liste`,
        },
      });
      const liste = el('ul', { classe: 'suggestions', attributs: { id: `${id}-liste`, role: 'listbox', 'aria-label': 'Patients enregistrés', hidden: true } });
      const vide = el('p', { classe: 'suggestions__vide', attributs: { id: `${id}-vide`, hidden: true } });
      const annonce = el('div', { classe: 'sr-only', attributs: { id: `${id}-annonce`, role: 'status' } });
      const c = { cle, saisie, liste, vide, annonce, entrees: [], options: [], actif: -1, minuterie: null };
      combos[cle] = c;
      saisie.addEventListener('input', () => {
        // Frappe à la main : le choix précédent est abandonné (saisie libre), l'autre liste se ferme.
        etat.choisi = null;
        etat.creerChoisi = false;
        Object.values(combos).forEach((autre) => autre !== c && fermer(autre));
        rendre(c);
        majIndication();
      });
      saisie.addEventListener('keydown', (evenement) => surClavier(c, evenement));
      saisie.addEventListener('blur', () => {
        fermer(c); // Tab ferme la liste sans rien choisir
        annoncer(c, '');
      });
      return el('div', { classe: 'combo' }, saisie, liste, vide, annonce);
    },

    /**
     * Relie le champ créé par creerChamp : classe `champ--combo`, description (annonce, indication) conservée quand creerChamp
     * réécrit `aria-describedby` (erreur affichée ou effacée). Le champ de saisie est `champ.saisie`.
     */
    relier(cle, champ) {
      const c = combos[cle];
      champ.racine.classList.add('champ--combo');
      const completer = () => {
        const ids = new Set((c.saisie.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
        ids.add(c.annonce.id);
        ids.add(indication.id);
        c.saisie.setAttribute('aria-describedby', [...ids].join(' '));
      };
      const { erreur, effacerErreur } = champ;
      champ.erreur = (message) => {
        erreur(message);
        completer();
      };
      champ.effacerErreur = () => {
        effacerErreur();
        completer();
      };
      completer();
    },

    /** Patient choisi dans la liste (envoi de `patientId`), ou null (saisie libre : nom + prénom). */
    patientChoisi: () => etat.choisi,
    /** Abandonne le choix et ferme les listes (champs remplis par programme, formulaire vidé, patient introuvable). */
    reinitialiser() {
      etat.choisi = null;
      etat.creerChoisi = false;
      fermerTout();
      majIndication();
    },
    /** Le registre a changé (création, annulation, autre onglet) : l'indication est recalculée. */
    actualiser: majIndication,
    fermer: fermerTout,
  };
}

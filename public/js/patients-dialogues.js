// Dialogues communs aux patients (design system §8.11) : « Un patient porte déjà ce nom » (ajout ou renommage vers un nom existant).
// Le serveur ne renvoie que des identifiants et des dates (409 PATIENT_EXISTANT) : les noms viennent du registre déjà chargé par la page.
import { alerte } from '/js/bandeaux.js';
import { el } from '/js/dom.js';
import { formatDate, pluriel } from '/js/format.js';
import { candidatsAffiches } from '/js/recherche-patients.js';
import { creerDialogue } from '/js/ui.js';

const bouton = (texte, classe, auClic, attributs = {}) => el('button', { classe: `btn ${classe}`, texte, attributs: { type: 'button', ...attributs }, evenements: { click: auClic } });

/**
 * Un patient existant (élément `li` de `ul.patients-existants`) : nom, prénom, badges « Archivé » / « Homonyme », nombre de prestations, date de la dernière.
 * `c` : { nom, prenom, actif, homonyme, nombrePrestations (ou null), dernierePrestation } ; `repli` : nom et prénom tapés, si `c` n'en a pas.
 */
export function lignePatientExistant(c, { nom = '', prenom = '' } = {}, action = null) {
  return el(
    'li',
    {},
    el('span', { classe: 'patient__nom', texte: c.nom || nom }),
    el('span', { classe: 'patient__prenom', texte: c.prenom || prenom }),
    c.actif ? null : el('span', { classe: 'badge badge--archive', texte: 'Archivé' }),
    c.homonyme ? el('span', { classe: 'badge badge--homonyme', texte: 'Homonyme' }) : null,
    c.nombrePrestations === null ? null : el('span', { texte: pluriel(c.nombrePrestations, 'prestation') }),
    el('span', { classe: 'cellule-double__secondaire', texte: c.dernierePrestation ? `dernière prestation le ${formatDate(c.dernierePrestation)}` : 'aucune prestation' }),
    action,
  );
}

/**
 * Un patient porte déjà ce nom et ce prénom (409 PATIENT_EXISTANT). Rien n'est créé ni renommé tant que l'utilisatrice n'a pas choisi.
 * `mode` : 'ajout' (Annuler, Créer quand même un homonyme, Utiliser ce patient) ou 'renommage' (Annuler, Renommer quand même : pas de fusion).
 * `candidats` : details.candidats de l'erreur ([{ id, dernierePrestation }]) ; `registre` : liste GET /api/patients pour retrouver les noms.
 * -> Promise<null (annulé) | { homonyme: true } | { patientId }>
 */
export function dialogueHomonyme({ mode = 'ajout', nom, prenom, candidats, registre }) {
  return new Promise((resolve) => {
    const d = creerDialogue({ titre: 'Un patient porte déjà ce nom' });
    let reponse = null;
    const choisir = (valeur) => () => {
      reponse = valeur;
      d.fermer();
    };
    const ajout = mode === 'ajout';
    const liste = candidatsAffiches(candidats, registre);
    const plusieurs = liste.length > 1;
    d.corps.append(
      alerte('attention', 'Attention', ajout ? "Rien n'est créé tant que vous n'avez pas choisi." : "Rien n'est renommé tant que vous n'avez pas choisi.", 'status'),
      el(
        'ul',
        { classe: 'patients-existants', attributs: { 'aria-label': liste.length > 1 ? 'Patients enregistrés qui portent ce nom' : 'Patient enregistré qui porte ce nom' } },
        ...liste.map((c) =>
          lignePatientExistant(
            c,
            { nom, prenom },
            ajout && plusieurs ? bouton('Utiliser celui-ci', 'btn--secondaire btn--petit', choisir({ patientId: c.id }), { 'aria-label': `Utiliser le patient ${c.nom || nom} ${c.prenom || prenom}, ${c.dernierePrestation ? `dernière prestation le ${formatDate(c.dernierePrestation)}` : 'aucune prestation'}` }) : null,
          ),
        ),
      ),
    );
    const annuler = bouton('Annuler', 'btn--secondaire', () => d.fermer());
    d.pied.append(annuler, bouton(ajout ? 'Créer quand même un homonyme' : 'Renommer quand même (homonyme)', 'btn--secondaire', choisir({ homonyme: true })));
    if (ajout && liste.length === 1) d.pied.append(bouton('Utiliser ce patient', 'btn--primaire', choisir({ patientId: liste[0].id })));
    d.dialogue.addEventListener('close', () => resolve(reponse));
    d.ouvrir(annuler); // focus initial sur Annuler : une frappe accidentelle sur Entrée ne crée rien
  });
}

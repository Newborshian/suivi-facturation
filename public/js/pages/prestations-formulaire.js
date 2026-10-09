// Champs d'une prestation (Nom, Prénom, Date, Prestation, Montant, Motif), partagés entre le formulaire d'ajout rapide
// et le dialogue de modification. L'ordre de tabulation est l'ordre visuel.
import { creerSelecteurPatient } from '/js/combobox-patient.js';
import { el } from '/js/dom.js';
import { formatEuros, formatMontantSaisie, lireMontant } from '/js/format.js';
import { creerChamp, creerEntreeMontant } from '/js/ui.js';

const MESSAGES_MONTANT = {
  vide: 'Indiquez le montant.',
  invalide: 'Le montant doit être un nombre positif, par exemple 45 ou 45,50.',
};

/**
 * `catalogue` : prestations proposées (actives) ; `typeActuel` : type d'une ligne existante, gardé dans la liste même s'il est désactivé.
 * `prefillMontant` : le choix d'une prestation remplit le montant avec son tarif (ajout rapide uniquement).
 * `indiquerTarif` : le choix d'une prestation affiche son tarif sous le montant, sans le modifier (dialogue de modification).
 * `registre` : () => patients enregistrés (GET /api/patients), toujours la liste la plus récente ; Nom et Prénom sont des combobox qui les proposent.
 */
export function creerFormulairePrestation({ catalogue, aujourdHui, prefillMontant = false, indiquerTarif = false, typeActuel = null, registre = () => [] }) {
  const selecteur = creerSelecteurPatient({ registre, suivant: () => champDate.entree });
  const champNom = creerChamp({ label: 'Nom', requis: true, aide: 'Tapez pour chercher un patient enregistré.', creerEntree: (id) => selecteur.composant('nom', id) });
  const champPrenom = creerChamp({ label: 'Prénom', requis: true, aide: 'Le prénom propose aussi les patients enregistrés.', creerEntree: (id) => selecteur.composant('prenom', id) });
  selecteur.relier('nom', champNom);
  selecteur.relier('prenom', champPrenom);
  // Aides lues par les lecteurs d'écran seulement : visibles, elles décaleraient Nom et Prénom par rapport aux autres champs de la grille.
  for (const champ of [champNom, champPrenom]) champ.racine.querySelector('.champ__aide')?.classList.add('sr-only');
  const champDate = creerChamp({
    label: 'Date',
    requis: true,
    creerEntree: (id) => el('input', { classe: 'input', attributs: { id, type: 'date', name: 'date' }, proprietes: { value: aujourdHui } }),
  });

  const options = catalogue.filter((c) => c.actif).sort((a, b) => a.ordre - b.ordre);
  if (typeActuel && !options.some((c) => c.id === typeActuel.id)) options.push(typeActuel);
  const champPrestation = creerChamp({
    label: 'Prestation',
    requis: true,
    creerEntree: (id) =>
      el(
        'select',
        { classe: 'input', attributs: { id, name: 'prestation' } },
        el('option', { texte: 'Choisir une prestation', attributs: { value: '' } }),
        ...options.map((c) => el('option', { texte: c.actif ? c.libelle : `${c.libelle} (retirée du catalogue)`, attributs: { value: c.id } })),
      ),
  });
  const champMontant = creerChamp({ label: 'Montant (€)', requis: true, creerEntree: (id) => creerEntreeMontant(id) });
  const entreeMontant = champMontant.saisie;
  const champMotif = creerChamp({
    label: 'Motif',
    large: true,
    creerEntree: (id) => el('input', { classe: 'input', attributs: { id, type: 'text', autocomplete: 'off', maxlength: '200', name: 'motif' } }),
  });

  const tout = { nom: champNom, prenom: champPrenom, date: champDate, prestationId: champPrestation, montantCentimes: champMontant, motif: champMotif };
  const entrees = { nom: champNom.saisie, prenom: champPrenom.saisie, date: champDate.entree, prestationId: champPrestation.entree, montantCentimes: entreeMontant, motif: champMotif.entree };

  const tarif = (id) => catalogue.find((c) => c.id === id)?.tarifCentimes;
  // Modification : le montant n'est jamais écrasé, mais le tarif de la prestation choisie est rappelé en indication.
  const indication = el('p', { classe: 'champ__aide', attributs: { hidden: true, 'aria-live': 'polite' } });
  if (indiquerTarif) champMontant.racine.insertBefore(indication, champMontant.racine.querySelector('.champ__erreur'));
  const masquerIndication = () => {
    indication.hidden = true;
    indication.textContent = '';
  };
  champPrestation.entree.addEventListener('change', () => {
    const t = tarif(champPrestation.entree.value);
    if (prefillMontant && t !== undefined) entreeMontant.value = formatMontantSaisie(t);
    if (indiquerTarif) {
      if (t === undefined) masquerIndication();
      else {
        indication.textContent = `Tarif : ${formatEuros(t)}`;
        indication.hidden = false;
      }
    }
  });
  // Tab arrive sur le montant avec le texte sélectionné : une frappe le remplace.
  entreeMontant.addEventListener('focus', () => entreeMontant.select());

  const racine = el('div', { classe: 'formulaire-grille' }, champNom.racine, champPrenom.racine, champDate.racine, champPrestation.racine, champMontant.racine, champMotif.racine);

  return {
    racine,
    entrees,
    /** Indication « Patient enregistré / Nouveau patient / Patient archivé » (un seul élément pour les deux champs) : placée par l'appelant. */
    indication: selecteur.indication,
    /** Patient choisi dans la liste ({ id, nom, prenom, actif… }), ou null : saisie libre (nom + prénom). */
    patientChoisi: () => selecteur.patientChoisi(),
    /** Abandonne le choix d'un patient (patient devenu introuvable : liste périmée). */
    abandonnerChoix: () => selecteur.reinitialiser(),
    /** Le registre a changé : l'indication est recalculée. */
    actualiserPatients: () => selecteur.actualiser(),
    fermerSuggestions: () => selecteur.fermer(),
    /** Remplit les champs (ligne existante, ou valeurs conservées après un ajout). */
    remplir({ nom, prenom, date, prestationId, montantCentimes, motif }) {
      if (nom !== undefined || prenom !== undefined) selecteur.reinitialiser(); // champs remplis par programme : aucun patient « choisi »
      if (nom !== undefined) champNom.saisie.value = nom;
      if (prenom !== undefined) champPrenom.saisie.value = prenom;
      if (date !== undefined) champDate.entree.value = date;
      if (prestationId !== undefined) {
        champPrestation.entree.value = prestationId;
        masquerIndication();
      }
      if (montantCentimes !== undefined) entreeMontant.value = formatMontantSaisie(montantCentimes);
      if (motif !== undefined) champMotif.entree.value = motif;
    },
    /** Remet le montant au tarif de la prestation choisie (après un ajout). */
    appliquerTarif() {
      const t = tarif(champPrestation.entree.value);
      entreeMontant.value = t === undefined ? '' : formatMontantSaisie(t);
    },
    viderPatientEtMotif() {
      champNom.saisie.value = '';
      champPrenom.saisie.value = '';
      champMotif.entree.value = '';
      selecteur.reinitialiser();
    },
    lire() {
      return {
        nom: champNom.saisie.value,
        prenom: champPrenom.saisie.value,
        date: champDate.entree.value,
        prestationId: champPrestation.entree.value,
        montant: lireMontant(entreeMontant.value),
        motif: champMotif.entree.value,
      };
    },
    /** Corps d'API des champs de la ligne (le patient et ses options sont ajoutés par l'appelant). */
    corps() {
      const v = this.lire();
      return { date: v.date, prestationId: v.prestationId, montantCentimes: v.montant.ok ? v.montant.centimes : null, motif: v.motif };
    },
    effacerErreurs() {
      for (const champ of Object.values(tout)) champ.effacerErreur();
    },
    /**
     * Affiche les erreurs reçues du serveur (422) ; le message local du montant (« abc ») remplace le message générique.
     * -> liste ordonnée [{ texte, cible }] pour le résumé ; le premier champ en erreur reçoit le focus de l'appelant.
     */
    afficherErreurs(champs, montantLu) {
      const messages = { ...champs };
      if (messages.patientId && !messages.nom) messages.nom = messages.patientId; // patient choisi devenu introuvable : le message va sous Nom
      if (montantLu && !montantLu.ok) messages.montantCentimes = MESSAGES_MONTANT[montantLu.raison];
      const liens = [];
      for (const [cle, champ] of Object.entries(tout)) {
        if (!messages[cle]) continue;
        champ.erreur(messages[cle]);
        liens.push({ texte: messages[cle], cible: entrees[cle] });
      }
      return liens;
    },
  };
}

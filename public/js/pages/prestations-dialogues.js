// Dialogues de l'écran Prestations : versement, mode de paiement, homonymes, modification.
// `ctx` (fourni par la page) : { catalogue, aujourdHui, dernierMode (lecture/écriture), notifier({texte, avertissements, annulation}) }.
import { ErreurApi, appeler } from '/js/api.js';
import { el } from '/js/dom.js';
import { LIBELLES_ETAT, LIBELLES_MODE, formatDate, formatEuros, formatMontantSaisie, lireMontant, pluriel } from '/js/format.js';
import { creerFormulairePrestation } from '/js/pages/prestations-formulaire.js';
import { confirmer, creerChamp, creerDialogue, creerEntreeMontant, creerResume } from '/js/ui.js';

const bouton = (texte, classe, auClic, attributs = {}) => el('button', { classe: `btn ${classe}`, texte, attributs: { type: 'button', ...attributs }, evenements: auClic ? { click: auClic } : {} });
const alerteDansDialogue = (variante, titre, texte) =>
  el('div', { classe: `alerte alerte--${variante}`, attributs: { role: variante === 'danger' ? 'alert' : 'status' } }, el('div', { classe: 'alerte__corps' }, el('strong', { classe: 'alerte__titre', texte: titre }), el('p', { classe: 'alerte__texte', texte })));

function optionsMode(selectionne) {
  return [
    ...(selectionne ? [] : [el('option', { texte: 'Choisir le mode de paiement', attributs: { value: '' } })]),
    ...Object.entries(LIBELLES_MODE).map(([valeur, libelle]) => el('option', { texte: libelle, attributs: { value: valeur, selected: valeur === selectionne } })),
  ];
}

// ------------------------------------------------------------ Homonymes

/**
 * Plusieurs patients portent ce nom (409 PATIENTS_HOMONYMES) : choisir le bon, ou en créer un nouveau.
 * -> Promise<{ patientId } | { nouveau: true } | null>
 */
export function choisirHomonyme({ nom, prenom, candidats }) {
  return new Promise((resolve) => {
    const d = creerDialogue({ titre: 'Plusieurs patients portent ce nom' });
    let reponse = null;
    const erreur = el('p', { classe: 'champ__erreur', attributs: { hidden: true, role: 'alert' } });
    const groupe = el('fieldset', { classe: 'groupe' }, el('legend', { texte: `Qui est ${prenom} ${nom} ?` }));
    const radios = [];
    const ajouterOption = (valeur, libelle) => {
      const radio = el('input', { attributs: { type: 'radio', name: 'patient-homonyme', value: valeur } });
      radios.push(radio);
      groupe.append(el('label', { classe: 'case' }, radio, el('span', { texte: libelle })));
    };
    candidats.forEach((c) => ajouterOption(c.id, `${prenom} ${nom} — dernière prestation le ${formatDate(c.dernierePrestation)}`));
    ajouterOption('nouveau', 'Nouveau patient (même nom)');
    d.corps.append(el('p', { texte: 'Deux patients ont le même nom et le même prénom. Choisissez celui de cette prestation.' }), groupe, erreur);
    const annuler = bouton('Annuler', 'btn--secondaire', () => d.fermer());
    const continuer = bouton('Continuer', 'btn--primaire', () => {
      const choisi = radios.find((r) => r.checked);
      if (!choisi) {
        erreur.textContent = 'Choisissez un patient, ou « Nouveau patient ».';
        erreur.hidden = false;
        return;
      }
      reponse = choisi.value === 'nouveau' ? { nouveau: true } : { patientId: choisi.value };
      d.fermer();
    });
    d.pied.append(annuler, continuer);
    d.dialogue.addEventListener('close', () => resolve(reponse));
    d.ouvrir(radios[0]);
  });
}

// ------------------------------------------------------------- Renommage

/**
 * Le nom d'un patient qui a d'autres prestations est modifié sur une seule ligne (409 RENOMMAGE_PATIENT) :
 * rien n'est détaché sans que l'utilisatrice l'ait choisi.
 * -> Promise<'toutes' | 'cette-ligne' | null>
 */
export function choisirRenommage({ ancien, nouveau, autresLignes }) {
  return new Promise((resolve) => {
    const d = creerDialogue({ titre: 'Renommer ce patient ?' });
    let reponse = null;
    const choisir = (valeur) => () => {
      reponse = valeur;
      d.fermer();
    };
    d.corps.append(
      el('p', { texte: `Vous changez « ${ancien} » en « ${nouveau} ». Ce patient a ${pluriel(autresLignes, 'autre prestation', 'autres prestations')}.` }),
      el('p', { texte: `Renommer sur toutes ses prestations : le nom est changé partout (${autresLignes + 1} au total), le patient reste le même.` }),
      alerteDansDialogue(
        'attention',
        'Attention',
        `Modifier seulement cette ligne : elle sera détachée de « ${ancien} » et comptée comme un autre patient (« ${nouveau} ») dans les récapitulatifs. Les autres prestations (${autresLignes}) restent au nom de « ${ancien} ».`,
      ),
    );
    const annuler = bouton('Annuler', 'btn--secondaire', () => d.fermer());
    d.pied.append(annuler, bouton('Modifier seulement cette ligne', 'btn--secondaire', choisir('cette-ligne')), bouton('Renommer sur toutes les prestations', 'btn--primaire', choisir('toutes')));
    d.dialogue.addEventListener('close', () => resolve(reponse));
    d.ouvrir(annuler);
  });
}

// ---------------------------------------------------------- Mode de paiement

/** Aucun mode de paiement n'a jamais été utilisé (422 MODE_REQUIS) : demander lequel. -> Promise<mode | null> */
export function choisirMode({ resteCentimes }) {
  return new Promise((resolve) => {
    const d = creerDialogue({ titre: 'Quel mode de paiement ?' });
    let reponse = null;
    const champ = creerChamp({ label: 'Mode de paiement', requis: true, creerEntree: (id) => el('select', { classe: 'input', attributs: { id } }, ...optionsMode(null)) });
    d.corps.append(
      el('p', { texte: `Ce sera un versement de ${formatEuros(resteCentimes)}, daté d'aujourd'hui. Le mode choisi sera proposé la prochaine fois.` }),
      champ.racine,
    );
    const valider = () => {
      if (!champ.entree.value) {
        champ.erreur('Choisissez le mode de paiement.');
        champ.entree.focus();
        return;
      }
      reponse = champ.entree.value;
      d.fermer();
    };
    d.pied.append(bouton('Annuler', 'btn--secondaire', () => d.fermer()), bouton('Enregistrer le paiement', 'btn--primaire', valider));
    d.dialogue.addEventListener('close', () => resolve(reponse));
    d.ouvrir(champ.entree);
  });
}

// -------------------------------------------------------------- Versement

/**
 * Ajout (versement = null) ou modification d'un versement. Appelle l'API puis se ferme.
 * -> Promise<{ ligne, avertissements, annulation } | null> (null si abandon).
 */
export function dialogueVersement({ ligne, versement = null, ctx }) {
  return new Promise((resolve) => {
    const d = creerDialogue({ titre: versement ? 'Modifier le versement' : 'Ajouter un versement' });
    let resultat = null;
    const resume = creerResume();
    const zoneAvertissements = el('div', { classe: 'avertissements', attributs: { 'aria-live': 'polite' } });
    const zoneErreur = el('div', { attributs: { 'aria-live': 'polite' } });
    // Reste à payer une fois ce versement mis de côté (modification) ou reste actuel (ajout).
    const resteDisponible = Math.max(0, ligne.montantCentimes - (ligne.verseCentimes - (versement?.montantCentimes ?? 0)));

    const champMontant = creerChamp({
      label: 'Montant (€)',
      requis: true,
      creerEntree: (id) => creerEntreeMontant(id, versement ? formatMontantSaisie(versement.montantCentimes) : ligne.resteCentimes > 0 ? formatMontantSaisie(ligne.resteCentimes) : ''),
    });
    const champDate = creerChamp({ label: 'Date du versement', requis: true, creerEntree: (id) => el('input', { classe: 'input', attributs: { id, type: 'date' }, proprietes: { value: versement?.date ?? ctx.aujourdHui } }) });
    const modeInitial = versement?.mode ?? ctx.dernierMode.valeur ?? null;
    const champMode = creerChamp({ label: 'Mode de paiement', requis: true, creerEntree: (id) => el('select', { classe: 'input', attributs: { id } }, ...optionsMode(modeInitial)) });
    const champs = { montantCentimes: champMontant, date: champDate, mode: champMode };
    const entrees = { montantCentimes: champMontant.saisie, date: champDate.entree, mode: champMode.entree };

    const evaluerAvertissements = () => {
      const liste = [];
      const m = lireMontant(champMontant.saisie.value);
      if (m.ok && m.centimes > resteDisponible) liste.push(`Ce versement dépasse le reste à payer de ${formatEuros(m.centimes - resteDisponible)}. Il sera enregistré tel quel.`);
      if (champDate.entree.value && champDate.entree.value < ligne.date) liste.push(`Ce versement est daté avant la prestation (${formatDate(ligne.date)}).`);
      zoneAvertissements.replaceChildren(...liste.map((t) => alerteDansDialogue('attention', 'Attention', t)));
    };
    champMontant.saisie.addEventListener('input', evaluerAvertissements);
    champDate.entree.addEventListener('input', evaluerAvertissements);
    champMontant.saisie.addEventListener('focus', () => champMontant.saisie.select());
    evaluerAvertissements();

    const formulaire = el(
      'form',
      { classe: 'pile', attributs: { novalidate: true, id: `form-versement-${ligne.id}` } },
      el('p', { classe: 'champ__aide', texte: `Prestation du ${formatDate(ligne.date)} — montant ${formatEuros(ligne.montantCentimes)}, reste à payer ${formatEuros(ligne.resteCentimes)}.` }),
      resume.racine,
      el('div', { classe: 'formulaire-grille' }, champMontant.racine, champDate.racine, champMode.racine),
      zoneAvertissements,
      zoneErreur,
    );
    d.corps.append(formulaire);

    const enregistrer = bouton(versement ? 'Enregistrer les modifications' : 'Enregistrer le versement', 'btn--primaire', null, { type: 'submit', form: formulaire.id });
    d.pied.append(bouton('Annuler', 'btn--secondaire', () => d.fermer()), enregistrer);

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      Object.values(champs).forEach((c) => c.effacerErreur());
      resume.masquer();
      zoneErreur.replaceChildren();
      const montant = lireMontant(champMontant.saisie.value);
      const corps = { montantCentimes: montant.ok ? montant.centimes : null, date: champDate.entree.value, mode: champMode.entree.value };
      enregistrer.setAttribute('aria-busy', 'true');
      enregistrer.disabled = true;
      try {
        const chemin = `/api/prestations/${ligne.id}/versements`;
        const r = versement ? await appeler('PATCH', `${chemin}/${versement.id}`, corps) : await appeler('POST', chemin, corps);
        if (corps.mode) ctx.dernierMode.valeur = corps.mode;
        resultat = { ligne: r.donnees, avertissements: r.avertissements, annulation: r.annulation };
        d.fermer();
      } catch (err) {
        enregistrer.removeAttribute('aria-busy');
        enregistrer.disabled = false;
        if (err instanceof ErreurApi && err.status === 422 && err.champs) {
          const messages = { ...err.champs };
          if (!montant.ok && messages.montantCentimes) messages.montantCentimes = montant.raison === 'vide' ? 'Indiquez le montant du versement.' : 'Le montant doit être un nombre positif, par exemple 20 ou 20,50.';
          const liens = [];
          for (const [cle, champ] of Object.entries(champs)) {
            if (!messages[cle]) continue;
            champ.erreur(messages[cle]);
            liens.push({ texte: messages[cle], cible: entrees[cle] });
          }
          resume.afficher(pluriel(liens.length, 'champ à corriger', 'champs à corriger'), liens);
          liens[0]?.cible.focus();
        } else {
          zoneErreur.replaceChildren(alerteDansDialogue('danger', 'Erreur', err.message));
        }
      }
    });

    d.dialogue.addEventListener('close', () => resolve(resultat));
    d.ouvrir(champMontant.saisie);
  });
}

// ------------------------------------------------------------ Modification

/**
 * Modification d'une prestation (champs, versements, suppression).
 * -> Promise<{ modifiee: boolean }> ; `modifiee` : la liste doit être rechargée.
 */
export function dialogueModification({ ligne: ligneInitiale, ctx }) {
  return new Promise((resolve) => {
    let ligne = ligneInitiale;
    let modifiee = false;
    const d = creerDialogue({ titre: 'Modifier la prestation', large: true });
    const resume = creerResume();
    const zoneAlerte = el('div', { attributs: { 'aria-live': 'polite' } });
    const typeActuel = { id: ligne.prestationId, libelle: ligne.libelle, tarifCentimes: ligne.montantCentimes, categorie: ligne.categorie, actif: false, ordre: 9999 };
    const form = creerFormulairePrestation({ catalogue: ctx.catalogue, aujourdHui: ctx.aujourdHui, typeActuel, indiquerTarif: true, registre: () => ctx.patients ?? [] });
    const idForm = `form-modif-${ligne.id}`;

    const remplirDepuisLigne = () => form.remplir({ nom: ligne.patient.nom, prenom: ligne.patient.prenom, date: ligne.date, prestationId: ligne.prestationId, montantCentimes: ligne.montantCentimes, motif: ligne.motif });
    remplirDepuisLigne();

    // --- Section versements
    const sectionVersements = el('section', { classe: 'pile pile--s', attributs: { 'aria-labelledby': `${idForm}-versements` } });
    const rendreVersements = () => {
      const entete = el(
        'div',
        { classe: 'groupe-horizontal' },
        el('h3', { texte: 'Versements', attributs: { id: `${idForm}-versements` } }),
        bouton('Ajouter un versement', 'btn--secondaire btn--petit', () => ouvrirVersement(null)),
      );
      const recap = el('p', { classe: 'champ__aide', texte: `${LIBELLES_ETAT[ligne.etat]} — versé ${formatEuros(ligne.verseCentimes)}, reste à payer ${formatEuros(ligne.resteCentimes)}${ligne.tropPercuCentimes > 0 ? `, trop-perçu ${formatEuros(ligne.tropPercuCentimes)}` : ''}.` });
      let liste;
      if (ligne.versements.length === 0) {
        liste = el('p', { texte: 'Aucun versement.' });
      } else {
        liste = el(
          'div',
          { classe: 'table-wrap', attributs: { role: 'region', 'aria-label': 'Versements de la prestation', tabindex: '0' } },
          el(
            'table',
            { classe: 'table table--dense versements-liste' },
            el('caption', { classe: 'sr-only', texte: 'Versements de la prestation' }),
            el('thead', {}, el('tr', {}, el('th', { texte: 'Date', attributs: { scope: 'col' } }), el('th', { texte: 'Mode', attributs: { scope: 'col' } }), el('th', { texte: 'Montant', classe: 'col-montant', attributs: { scope: 'col' } }), el('th', { texte: 'Actions', classe: 'col-action', attributs: { scope: 'col' } }))),
            el(
              'tbody',
              {},
              ...ligne.versements.map((v) =>
                el(
                  'tr',
                  {},
                  el('td', { texte: formatDate(v.date) }),
                  el('td', { texte: LIBELLES_MODE[v.mode] }),
                  el('td', { classe: 'col-montant', texte: formatEuros(v.montantCentimes) }),
                  el(
                    'td',
                    { classe: 'col-action' },
                    el(
                      'span',
                      { classe: 'actions-ligne' },
                      bouton('Modifier', 'btn--secondaire btn--petit', () => ouvrirVersement(v), { 'aria-label': `Modifier le versement du ${formatDate(v.date)}` }),
                      bouton('Supprimer', 'btn--danger-discret btn--petit', () => supprimerVersement(v), { 'aria-label': `Supprimer le versement du ${formatDate(v.date)}` }),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      }
      sectionVersements.replaceChildren(entete, recap, liste);
    };

    async function ouvrirVersement(versement) {
      const r = await dialogueVersement({ ligne, versement, ctx });
      if (!r) return;
      ligne = r.ligne;
      modifiee = true;
      rendreVersements();
      ctx.notifier({ texte: versement ? 'Versement modifié.' : 'Versement enregistré.', avertissements: r.avertissements });
    }

    async function supprimerVersement(v) {
      const ok = await confirmer({
        titre: 'Supprimer ce versement ?',
        texte: `Le versement de ${formatEuros(v.montantCentimes)} du ${formatDate(v.date)} sera supprimé. L'état de paiement sera recalculé. Une sauvegarde est faite avant la suppression.`,
        libelleConfirmer: 'Supprimer le versement',
        danger: true,
      });
      if (!ok) return;
      try {
        const r = await appeler('DELETE', `/api/prestations/${ligne.id}/versements/${v.id}`);
        ligne = r.donnees;
        modifiee = true;
        rendreVersements();
        ctx.notifier({ texte: 'Versement supprimé.', avertissements: r.avertissements });
      } catch (err) {
        zoneAlerte.replaceChildren(alerteDansDialogue('danger', 'Erreur', err.message));
      }
    }

    async function supprimerPrestation() {
      const n = ligne.versements.length;
      const ok = await confirmer({
        titre: 'Supprimer cette prestation ?',
        texte: `${n > 0 ? `${pluriel(n, 'versement associé sera supprimé', 'versements associés seront supprimés')} avec elle. ` : ''}Une sauvegarde est faite avant la suppression, et vous pourrez annuler juste après.`,
        libelleConfirmer: 'Supprimer la prestation',
        danger: true,
      });
      if (!ok) return;
      try {
        const r = await appeler('DELETE', `/api/prestations/${ligne.id}`);
        modifiee = true;
        d.fermer();
        ctx.notifier({ texte: 'Prestation supprimée.', avertissements: r.avertissements, annulation: r.annulation });
      } catch (err) {
        zoneAlerte.replaceChildren(alerteDansDialogue('danger', 'Erreur', err.message));
      }
    }

    // --- Enregistrement
    async function enregistrer(options = {}) {
      form.effacerErreurs();
      resume.masquer();
      zoneAlerte.replaceChildren();
      form.fermerSuggestions();
      const v = form.lire();
      const corps = { modifieLe: ligne.modifieLe, ...form.corps(), ...options };
      const patientModifie = v.nom !== ligne.patient.nom || v.prenom !== ligne.patient.prenom;
      const choisi = form.patientChoisi();
      // Patient choisi dans la liste : rattachement par identifiant (la ligne prend l'écriture du registre). Sinon, comme avant :
      // le nom n'est envoyé que s'il a été modifié à la main.
      if (choisi && !options.patientId && !options.nouveauPatient) corps.patientId = choisi.id;
      else if (!options.patientId && (patientModifie || options.nouveauPatient)) corps.patient = { nom: v.nom, prenom: v.prenom };
      boutonEnregistrer.setAttribute('aria-busy', 'true');
      boutonEnregistrer.disabled = true;
      try {
        const r = await appeler('PATCH', `/api/prestations/${ligne.id}`, corps);
        ligne = r.donnees;
        modifiee = true;
        d.fermer();
        ctx.notifier({ texte: options.renommerPatient ? 'Patient renommé sur toutes ses prestations.' : 'Prestation modifiée.', avertissements: r.avertissements, ligneId: ligne.id });
      } catch (err) {
        boutonEnregistrer.removeAttribute('aria-busy');
        boutonEnregistrer.disabled = false;
        if (err instanceof ErreurApi && err.status === 422 && err.champs) {
          if (err.champs.patientId) form.abandonnerChoix(); // patient devenu introuvable : on revient à la saisie libre
          const liens = form.afficherErreurs(err.champs, v.montant);
          resume.afficher(pluriel(liens.length, 'champ à corriger', 'champs à corriger'), liens);
          liens[0]?.cible.focus();
        } else if (err instanceof ErreurApi && err.code === 'MODIFIEE_AILLEURS') {
          zoneAlerte.replaceChildren(
            el(
              'div',
              { classe: 'alerte alerte--attention', attributs: { role: 'alert' } },
              el('div', { classe: 'alerte__corps' }, el('strong', { classe: 'alerte__titre', texte: 'Attention' }), el('p', { classe: 'alerte__texte', texte: 'Cette prestation a été modifiée entre-temps.' })),
              el('div', { classe: 'alerte__actions' }, bouton('Recharger', 'btn--secondaire btn--petit', recharger)),
            ),
          );
        } else if (err instanceof ErreurApi && err.code === 'PATIENTS_HOMONYMES') {
          const choix = await choisirHomonyme({ nom: v.nom, prenom: v.prenom, candidats: err.details?.candidats ?? [] });
          if (choix) await enregistrer(choix.patientId ? { patientId: choix.patientId } : { nouveauPatient: true });
        } else if (err instanceof ErreurApi && err.code === 'RENOMMAGE_PATIENT') {
          const choix = await choisirRenommage({ ancien: `${ligne.patient.prenom} ${ligne.patient.nom}`, nouveau: `${v.prenom.trim()} ${v.nom.trim()}`, autresLignes: err.details?.autresLignes ?? 0 });
          if (choix === 'toutes') await enregistrer({ renommerPatient: true });
          else if (choix === 'cette-ligne') await enregistrer({ detacherLigne: true });
        } else {
          zoneAlerte.replaceChildren(alerteDansDialogue('danger', 'Erreur', err.message));
        }
      }
    }

    async function recharger() {
      try {
        ligne = (await appeler('GET', `/api/prestations/${ligne.id}`)).donnees;
        remplirDepuisLigne();
        rendreVersements();
        zoneAlerte.replaceChildren();
        form.effacerErreurs();
      } catch (err) {
        zoneAlerte.replaceChildren(alerteDansDialogue('danger', 'Erreur', err.message));
      }
    }

    const formulaire = el('form', { classe: 'pile', attributs: { novalidate: true, id: idForm } }, resume.racine, form.racine, form.indication);
    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      enregistrer();
    });
    const boutonEnregistrer = bouton('Enregistrer', 'btn--primaire', null, { type: 'submit', form: idForm });
    rendreVersements();
    d.corps.append(formulaire, zoneAlerte, sectionVersements);
    d.pied.append(bouton('Supprimer cette prestation', 'btn--danger-discret', supprimerPrestation), bouton('Annuler', 'btn--secondaire', () => d.fermer()), boutonEnregistrer);
    d.dialogue.addEventListener('close', () => resolve({ modifiee }));
    d.ouvrir(form.entrees.nom);
  });
}

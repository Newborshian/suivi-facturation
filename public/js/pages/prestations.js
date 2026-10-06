// Écran « Prestations » : ajout rapide, liste filtrable, statut et paiement en un clic, sélection multiple.
// Le serveur calcule (état de paiement, totaux par ligne) ; ici on affiche, on filtre localement et on appelle l'API.
// Le filtre sur le patient reste dans le navigateur : aucun nom dans l'URL, ni dans le stockage du navigateur.
import { ErreurApi, appeler, lireEtat } from '/js/api.js';
import { remplacerSiFichierVide } from '/js/accueil-vide.js';
import { afficherBandeaux, alerte } from '/js/bandeaux.js';
import { LIEN_TARIFS, etatCatalogue, explicationFormulaireDesactive, saisieImpossible } from '/js/catalogue-etat.js';
import { el, elementModesPaiement, remplacer } from '/js/dom.js';
import { afficherEcranDegrade } from '/js/ecran-degrade.js';
import { ecritureAutorisee, explicationEcritureImpossible } from '/js/ecriture.js';
import { LIBELLES_ETAT, LIBELLES_STATUT, correspondPatient, formatDate, formatDateCourte, formatEuros, formatMois, libelleTranche, listeModesPaiement, montantDernierVersement, pluriel, resumePaiement, totaliserLignes } from '/js/format.js';
import { choisirHomonyme, choisirMode, dialogueModification, dialogueVersement } from '/js/pages/prestations-dialogues.js';
import { creerFormulairePrestation } from '/js/pages/prestations-formulaire.js';
import { lignesAMarquer } from '/js/recap-regles.js';
import { appliquerSelection, etatBarreSelection, toutSelectionne } from '/js/selection.js';
import { afficherToast, creerResume } from '/js/ui.js';

const CLE_STOCKAGE = 'suivi-facturation.prestations.filtres'; // uniquement mois, facturation et paiement : jamais de nom

const page = {
  aujourdHui: '',
  catalogue: [],
  dernierMode: { valeur: null },
  lignes: [],
  moisDisponibles: [],
  filtres: { mois: '', statut: '', etat: '', patient: '' },
  lienInvalide: false, // l'URL demandait une tranche d'impayés non reconnue : la liste habituelle est affichée, et on le dit
  tranches: [], // tranches d'ancienneté des impayés, telles que le serveur les définit (GET /api/etat)
  impayes: null, // { statut, anciennete } : arrivée depuis le tableau de bord (clic sur une tranche d'impayés) ; null = liste habituelle
  selection: new Set(),
  recent: null,
  occupe: false,
  ecriture: true, // faux en lecture seule, en conflit ou en mode dégradé : les contrôles d'écriture sont désactivés
  explication: '', // pourquoi l'écriture est impossible (infobulle et texte lié aux contrôles désactivés)
  alerteSauvegarde: false, // le bandeau « sauvegarde en échec » est affiché
  formAjout: null,
};

// ------------------------------------------------------- Écriture impossible

const ID_RAISON = 'raison-ecriture';

/** Attributs d'un contrôle d'écriture : désactivé, avec infobulle et texte lié, quand l'écriture est impossible. */
const accesEcriture = () => (page.ecriture ? {} : { disabled: true, title: page.explication, 'aria-describedby': ID_RAISON });

/** Mémorise l'état d'écriture ; renvoie vrai s'il a changé. */
function appliquerEtatEcriture(etat) {
  const avant = page.ecriture;
  page.ecriture = ecritureAutorisee(etat);
  page.explication = explicationEcritureImpossible(etat);
  if (zone.raison) zone.raison.textContent = page.explication;
  return avant !== page.ecriture;
}

// ------------------------------------------------------- Stockage des filtres

function lireFiltresMemorises() {
  try {
    const brut = JSON.parse(sessionStorage.getItem(CLE_STOCKAGE) ?? 'null');
    if (brut && typeof brut === 'object') return brut;
  } catch {
    // stockage indisponible : on repart des valeurs par défaut
  }
  return null;
}

function memoriserFiltres() {
  if (page.impayes) return; // mode impayés : les filtres (mois « tous ») ne doivent pas devenir ceux de la prochaine ouverture
  try {
    const { mois, statut, etat } = page.filtres;
    sessionStorage.setItem(CLE_STOCKAGE, JSON.stringify({ mois, statut, etat }));
  } catch {
    // sans conséquence
  }
}

// ---------------------------------------------------------------- Notifications

function notifier({ texte, avertissements = [], annulation }) {
  const messages = avertissements.map((a) => a.message);
  // Une sauvegarde automatique en échec ne doit pas rester dans un toast éphémère : le bandeau persistant est rafraîchi tout de suite
  // (il disparaît de lui-même à la première sauvegarde réussie).
  if (page.alerteSauvegarde || avertissements.some((a) => a.code === 'SAUVEGARDE_ECHOUEE')) actualiserBandeaux();
  afficherToast({
    texte: [texte, ...messages].join(' '),
    variante: messages.length > 0 ? 'attention' : 'succes',
    action: annulation ? { libelle: 'Annuler', auClic: () => proteger(() => annulerAction(annulation)) } : undefined,
  });
}

async function annulerAction(jeton) {
  try {
    await appeler('POST', `/api/annulations/${jeton}`);
    afficherToast({ texte: 'Action annulée.' });
  } catch (err) {
    afficherToast({ texte: err.message, variante: 'erreur' });
  }
  await charger();
}

/** Une seule action à la fois (évite les doubles clics) ; toute erreur devient un message clair. */
async function proteger(action) {
  if (page.occupe) return;
  page.occupe = true;
  try {
    await action();
  } catch (err) {
    afficherToast({ texte: err instanceof ErreurApi ? err.message : 'Une erreur est survenue.', variante: 'erreur' });
    if (err instanceof ErreurApi && [404, 409, 503].includes(err.status)) {
      await charger().catch(() => {});
      await actualiserBandeaux();
    }
  } finally {
    page.occupe = false;
  }
}

async function actualiserBandeaux() {
  try {
    const etat = await lireEtat();
    page.dernierMode.valeur = etat.dernierModePaiement ?? page.dernierMode.valeur;
    page.alerteSauvegarde = (etat.avertissements ?? []).some((a) => a.code === 'SAUVEGARDE_ECHOUEE');
    const change = appliquerEtatEcriture(etat);
    afficherBandeaux(document.getElementById('bandeaux'), etat);
    if (change && zone.ajout?.isConnected) {
      const nouveau = construireAjout();
      zone.ajout.replaceWith(nouveau);
      zone.ajout = nouveau;
      rendreListe();
    }
  } catch {
    // la page signale déjà l'erreur de chargement
  }
}

/**
 * La page peut rester ouverte après minuit : la date du jour est relue auprès du serveur (retour sur l'onglet, minuterie,
 * ouverture d'un formulaire). Une date choisie à la main dans le formulaire d'ajout n'est jamais écrasée.
 */
async function actualiserDate() {
  try {
    const { aujourdHui } = await lireEtat();
    if (!aujourdHui || aujourdHui === page.aujourdHui) return;
    const ancienne = page.aujourdHui;
    page.aujourdHui = aujourdHui;
    const champDate = page.formAjout?.entrees.date;
    if (champDate && champDate.value === ancienne) champDate.value = aujourdHui;
    majOptionsMois();
    await charger(); // « À venir » est recalculé par le serveur
  } catch {
    // la date sera relue à la prochaine occasion
  }
}

// ---------------------------------------------------------------- Chargement

async function charger() {
  let chemin = page.filtres.mois ? `/api/prestations?mois=${encodeURIComponent(page.filtres.mois)}` : '/api/prestations';
  if (page.impayes) chemin = `/api/prestations?${new URLSearchParams(page.impayes)}`; // statut + tranche d'ancienneté : aucun nom dans l'URL
  const r = await appeler('GET', chemin);
  page.lignes = r.lignes;
  page.moisDisponibles = r.moisDisponibles;
  majOptionsMois();
  rendreListe();
}

const moisCourant = () => page.aujourdHui.slice(0, 7);

function lignesVisibles() {
  const { statut, etat, patient } = page.filtres;
  return page.lignes.filter((l) => (statut === '' || l.statut === statut) && (etat === '' || l.etat === etat) && correspondPatient(l.patient, patient));
}

// ---------------------------------------------------------------- Actions

async function basculerStatut(ligne) {
  const cible = ligne.statut === 'facture' ? 'a_facturer' : 'facture';
  const r = await appeler('POST', '/api/prestations/statut', { ids: [ligne.id], statut: cible });
  page.recent = ligne.id;
  if (r.donnees.modifiees === 0) {
    notifier({ texte: 'Cette prestation avait déjà ce statut (modifiée depuis un autre onglet ?). La liste est à jour.', avertissements: r.avertissements });
  } else {
    notifier({ texte: cible === 'facture' ? 'Marqué facturé.' : 'Remis à facturer.', avertissements: r.avertissements, annulation: r.annulation });
  }
  await charger();
}

async function marquerSelectionFacturee() {
  if (page.selection.size === 0) return;
  // Même règle que l'écran Facturation (recap-regles.js) : les prestations à venir restent à facturer, et on le dit.
  const { concernees, aVenir } = lignesAMarquer(page.lignes.filter((l) => page.selection.has(l.id)));
  const noteAVenir = aVenir > 0 ? ` ${pluriel(aVenir, 'prestation à venir est restée', 'prestations à venir sont restées')} à facturer.` : '';
  const ids = concernees.map((l) => l.id);
  if (ids.length === 0) {
    notifier({ texte: `Rien à marquer : les prestations sélectionnées sont déjà facturées ou à venir.${noteAVenir}` });
    return;
  }
  const r = await appeler('POST', '/api/prestations/statut', { ids, statut: 'facture' });
  page.selection.clear();
  const n = r.donnees.modifiees;
  notifier({
    texte: (n === 0 ? 'Les prestations sélectionnées étaient déjà facturées.' : `${pluriel(n, 'prestation marquée facturée', 'prestations marquées facturées')}.`) + noteAVenir,
    avertissements: r.avertissements,
    annulation: n > 0 ? r.annulation : undefined,
  });
  await charger();
}

async function payerEnTotalite(ligne, mode) {
  try {
    const r = await appeler('POST', `/api/prestations/${ligne.id}/payer-totalite`, mode ? { mode } : {});
    page.dernierMode.valeur = r.donnees.versements.at(-1)?.mode ?? page.dernierMode.valeur;
    page.recent = ligne.id;
    notifier({ texte: `${formatEuros(montantDernierVersement(r.donnees, ligne.resteCentimes))} enregistrés.`, avertissements: r.avertissements, annulation: r.annulation });
    await charger();
  } catch (err) {
    if (err instanceof ErreurApi && err.code === 'MODE_REQUIS') {
      const choisi = await choisirMode({ resteCentimes: ligne.resteCentimes });
      if (choisi) await payerEnTotalite(ligne, choisi);
      return;
    }
    throw err;
  }
}

async function ajouterVersement(ligne) {
  await actualiserDate();
  const r = await dialogueVersement({ ligne, ctx });
  if (!r) return;
  page.recent = ligne.id;
  notifier({ texte: 'Versement enregistré.', avertissements: r.avertissements, annulation: r.annulation });
  await charger();
}

async function modifier(ligne) {
  await actualiserDate();
  const { modifiee } = await dialogueModification({ ligne, ctx });
  if (modifiee) {
    page.recent = ligne.id;
    await charger();
  }
}

const ctx = {
  get catalogue() {
    return page.catalogue;
  },
  get aujourdHui() {
    return page.aujourdHui;
  },
  dernierMode: page.dernierMode,
  notifier,
};

// ---------------------------------------------------------------- Liste

const zone = {};

function cellule(classe, ...enfants) {
  return el('td', { classe }, ...enfants);
}

function creerLigne(l, recent) {
  const nomComplet = `${l.patient.prenom} ${l.patient.nom}`;
  const classes = [l.aVenir ? 'ligne--a-venir' : '', page.selection.has(l.id) ? 'ligne--selectionnee' : '', recent ? 'ligne--modifiee-recemment' : ''].filter(Boolean).join(' ');
  const secondaire = [l.libelle, l.motif].filter((t) => t !== '').join(' · ');
  const anneeCourante = page.aujourdHui.slice(0, 4);

  const case_ = el('input', {
    attributs: { type: 'checkbox', 'aria-label': `Sélectionner la prestation du ${formatDate(l.date)} de ${nomComplet}`, ...accesEcriture() },
    proprietes: { checked: page.selection.has(l.id) },
    evenements: {
      change: (evenement) => {
        // Seules la ligne, « Tout sélectionner » et la barre changent : la liste entière n'est pas reconstruite.
        appliquerSelection(page.selection, l.id, evenement.target.checked);
        evenement.target.closest('tr')?.classList.toggle('ligne--selectionnee', evenement.target.checked);
        majSelection();
      },
    },
  });

  const statutCible = l.statut === 'facture' ? 'Remettre à facturer' : 'Marquer comme facturé';
  const boutonStatut = el('button', {
    classe: 'badge btn-statut',
    texte: LIBELLES_STATUT[l.statut],
    attributs: { type: 'button', 'data-statut': l.statut, 'aria-label': `Statut de facturation : ${LIBELLES_STATUT[l.statut].toLowerCase()}. ${statutCible}.`, ...accesEcriture() },
    evenements: { click: () => proteger(() => basculerStatut(l)) },
  });

  const paiement = resumePaiement(l);
  const modesPaiement = listeModesPaiement(l);
  const detailPaiement = `versé ${formatEuros(l.verseCentimes)} · reste ${formatEuros(l.resteCentimes)}`;
  const actions = el('span', { classe: 'actions-ligne' });
  if (l.resteCentimes > 0) {
    actions.append(
      el('button', {
        classe: 'btn btn--petit btn-payer',
        texte: 'Payé en totalité',
        attributs: { type: 'button', 'aria-label': `Payé en totalité : ${formatEuros(l.resteCentimes)} pour la prestation du ${formatDate(l.date)} de ${nomComplet}`, ...accesEcriture() },
        evenements: { click: () => proteger(() => payerEnTotalite(l)) },
      }),
    );
  }
  actions.append(
    el('button', { classe: 'btn btn--petit btn--secondaire', texte: 'Versement', attributs: { type: 'button', 'aria-label': `Ajouter un versement à la prestation du ${formatDate(l.date)} de ${nomComplet}`, ...accesEcriture() }, evenements: { click: () => proteger(() => ajouterVersement(l)) } }),
    el('button', { classe: 'btn btn--petit btn--secondaire', texte: 'Modifier', attributs: { type: 'button', 'aria-label': `Modifier la prestation du ${formatDate(l.date)} de ${nomComplet}`, ...accesEcriture() }, evenements: { click: () => proteger(() => modifier(l)) } }),
  );

  return el(
    'tr',
    { classe: classes },
    cellule('col-case', case_),
    cellule('', formatDateCourte(l.date, anneeCourante)),
    cellule(
      '',
      el('div', {}, el('strong', { classe: 'patient-nom', texte: nomComplet }), l.aVenir ? el('span', { classe: 'badge badge--a-venir', texte: 'À venir' }) : null),
      el('div', { classe: 'cellule-double__secondaire', texte: secondaire }),
    ),
    cellule('col-montant', el('span', { classe: l.montantCentimes === 0 ? 'montant montant--zero' : 'montant', texte: formatEuros(l.montantCentimes) })),
    cellule('', boutonStatut),
    cellule(
      'col-etat-paiement',
      el(
        'div',
        { attributs: { role: 'group', 'aria-label': paiement.aria } },
        el('span', { classe: 'badge', texte: LIBELLES_ETAT[l.etat], attributs: { 'data-etat': l.etat } }),
        modesPaiement.length === 0 ? null : elementModesPaiement(modesPaiement),
      ),
      el('div', { classe: 'cellule-double__secondaire', texte: detailPaiement }),
      l.tropPercuCentimes > 0 ? el('span', { classe: 'badge badge--attention', texte: `Trop-perçu ${formatEuros(l.tropPercuCentimes)}` }) : null,
    ),
    cellule('col-action', actions),
  );
}

/** Met à jour « Tout sélectionner » et la barre de sélection (annoncée par aria-live, sans voler le focus). */
function majSelection() {
  if (zone.caseTout) zone.caseTout.checked = toutSelectionne(zone.idsVisibles, page.selection);
  const barre = etatBarreSelection(page.selection.size);
  zone.barre.hidden = !barre.visible;
  zone.barreTexte.textContent = barre.texte;
}

function rendreListe() {
  const visibles = lignesVisibles();
  const idsVisibles = new Set(visibles.map((l) => l.id));
  for (const id of [...page.selection]) if (!idsVisibles.has(id)) page.selection.delete(id);
  if (!page.ecriture) page.selection.clear(); // la sélection ne sert qu'aux modifications
  const recent = page.recent;
  page.recent = null;

  // Résumé : nombre, montant, payé, reste des lignes filtrées
  const t = totaliserLignes(visibles);
  remplacer(
    zone.resume,
    el('span', {}, el('strong', { texte: String(t.nombre) }), ` ${t.nombre > 1 ? 'prestations' : 'prestation'}`),
    el('span', {}, 'Montant ', el('strong', { texte: formatEuros(t.montantCentimes) })),
    el('span', {}, 'Payé ', el('strong', { texte: formatEuros(t.payeCentimes) })),
    el('span', {}, 'Reste ', el('strong', { texte: formatEuros(t.resteCentimes) })),
  );

  if (visibles.length === 0) {
    const filtreActif = page.filtres.statut !== '' || page.filtres.etat !== '' || page.filtres.patient.trim() !== '';
    const vide = page.lignes.length === 0 && !filtreActif;
    const bloque = vide && saisieImpossible(page.catalogue);
    const message = el(
      'div',
      { classe: 'etat-vide' },
      el('p', { classe: 'etat-vide__titre', texte: vide && page.filtres.mois ? 'Aucune prestation ce mois-ci' : 'Aucune prestation' }),
      // Catalogue inutilisable : la consigne est déjà dans l'alerte du formulaire désactivé, on ne la répète pas ici.
      bloque ? null : el('p', { classe: 'etat-vide__texte', texte: vide ? 'Ajoutez une prestation avec le formulaire ci-dessus.' : 'Aucune prestation ne correspond aux filtres choisis.' }),
      vide ? null : el('div', { classe: 'etat-vide__actions' }, el('button', { classe: 'btn btn--secondaire', texte: 'Effacer les filtres', attributs: { type: 'button' }, evenements: { click: () => proteger(effacerFiltres) } })),
    );
    remplacer(zone.liste, message);
    zone.caseTout = null;
    zone.idsVisibles = [];
    if (vide && !bloque) remplacerSiFichierVide(message, { ajouter: false, catalogue: page.catalogue }); // premier démarrage : accueil explicite (fichier sans aucune prestation)
  } else {
    zone.idsVisibles = visibles.map((l) => l.id);
    const caseTout = el('input', {
      attributs: { type: 'checkbox', 'aria-label': 'Tout sélectionner', ...accesEcriture() },
      proprietes: { checked: toutSelectionne(zone.idsVisibles, page.selection) },
      evenements: {
        change: (evenement) => {
          if (evenement.target.checked) visibles.forEach((l) => page.selection.add(l.id));
          else page.selection.clear();
          rendreListe();
        },
      },
    });
    zone.caseTout = caseTout;
    remplacer(
      zone.liste,
      el(
        'div',
        { classe: 'table-wrap table-wrap--haut', attributs: { role: 'region', 'aria-label': 'Liste des prestations', tabindex: '0' } },
        el(
          'table',
          { classe: 'table' },
          el('caption', { classe: 'sr-only', texte: 'Prestations, triées par date' }),
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { classe: 'col-case', attributs: { scope: 'col' } }, caseTout),
              el('th', { texte: 'Date', attributs: { scope: 'col' } }),
              el('th', { texte: 'Patient et prestation', attributs: { scope: 'col' } }),
              el('th', { texte: 'Montant', classe: 'col-montant', attributs: { scope: 'col' } }),
              el('th', { texte: 'Facturation', attributs: { scope: 'col' } }),
              el('th', { texte: 'Paiement', classe: 'col-etat-paiement', attributs: { scope: 'col' } }),
              el('th', { texte: 'Actions', classe: 'col-action', attributs: { scope: 'col' } }),
            ),
          ),
          el('tbody', {}, ...visibles.map((l) => creerLigne(l, l.id === recent))),
        ),
      ),
    );
  }

  majSelection();
}

// ---------------------------------------------------------------- Filtres

function majOptionsMois() {
  const mois = [...new Set([...page.moisDisponibles, moisCourant(), ...(page.filtres.mois ? [page.filtres.mois] : [])])].sort().reverse();
  remplacer(
    zone.selectMois,
    el('option', { texte: 'Tous les mois', attributs: { value: '' } }),
    ...mois.map((m) => el('option', { texte: formatMois(m), attributs: { value: m } })),
  );
  zone.selectMois.value = page.filtres.mois;
}

/** Tranche d'impayés demandée par l'URL (/prestations.html?statut=facture&anciennete=30-59) ; seules des valeurs connues sont acceptées. */
function lireImpayesUrl(tranches) {
  const q = new URLSearchParams(window.location.search);
  const statut = q.get('statut');
  const anciennete = q.get('anciennete');
  if (anciennete === null) return null;
  return ['a_facturer', 'facture'].includes(statut) && libelleTranche(tranches, anciennete) !== null ? { statut, anciennete } : null;
}

/** Bandeau « impayés d'une tranche » : dit ce que la liste montre et permet de revenir à la liste habituelle. */
function majNoteImpayes() {
  if (!zone.noteImpayes) return;
  if (!page.impayes) {
    zone.noteImpayes.replaceChildren(page.lienInvalide ? alerte('attention', 'Lien non reconnu', "Ce lien d'impayés n'est pas reconnu : la liste habituelle est affichée. Revenez au tableau de bord et cliquez de nouveau sur la tranche.", 'status') : '');
    return;
  }
  const facture = page.impayes.statut === 'facture';
  zone.noteImpayes.replaceChildren(
    alerte(null, facture ? 'Impayés facturés' : 'Impayés à facturer', `Prestations échues avec un reste à payer, ${facture ? 'facturées' : 'pas encore facturées'} depuis ${libelleTranche(page.tranches, page.impayes.anciennete)} (${facture ? 'date de facturation' : 'date de prestation'}), tous mois confondus. Les filtres Paiement et Patient restent utilisables.`, 'status', [
      el('button', { classe: 'btn btn--secondaire', texte: 'Voir toutes les prestations', attributs: { type: 'button' }, evenements: { click: () => proteger(effacerFiltres) } }),
    ]),
  );
}

async function quitterImpayes() {
  if (!page.impayes) return;
  page.impayes = null;
  window.history.replaceState(null, '', window.location.pathname);
  majNoteImpayes();
}

/** Toujours appelée via `proteger(effacerFiltres)` (jamais seule, jamais en imbriquant `proteger` : le rechargement serait ignoré). */
async function effacerFiltres() {
  await quitterImpayes();
  page.lienInvalide = false;
  majNoteImpayes();
  page.filtres = { mois: '', statut: '', etat: '', patient: '' };
  zone.recherche.value = '';
  zone.selectStatut.value = '';
  zone.selectEtat.value = '';
  zone.selectMois.value = '';
  memoriserFiltres();
  await charger();
}

function creerSelect(libelle, options, valeur, auChangement) {
  const id = `filtre-${libelle.toLowerCase().replace(/[^a-z]/g, '')}`;
  const select = el('select', { classe: 'input', attributs: { id } }, ...options.map(([v, texte]) => el('option', { texte, attributs: { value: v } })));
  select.value = valeur;
  select.addEventListener('change', () => auChangement(select.value));
  return { select, racine: el('div', { classe: 'champ' }, el('label', { classe: 'champ__label', texte: libelle, attributs: { for: id } }), select) };
}

// ---------------------------------------------------------------- Ajout rapide

function construireAjout() {
  const form = creerFormulairePrestation({ catalogue: page.catalogue, aujourdHui: page.aujourdHui, prefillMontant: true });
  page.formAjout = form;
  const resume = creerResume();
  const idForm = 'form-ajout';
  const boutonAjouter = el('button', { classe: 'btn btn--primaire', texte: 'Ajouter la prestation', attributs: { type: 'submit' } });

  async function soumettre(extra = {}) {
    form.effacerErreurs();
    resume.masquer();
    const v = form.lire();
    const corps = { ...form.corps(), ...extra };
    if (!extra.patientId) corps.patient = { nom: v.nom, prenom: v.prenom };
    if (extra.nouveauPatient === true) corps.nouveauPatient = true;
    boutonAjouter.setAttribute('aria-busy', 'true');
    try {
      const r = await appeler('POST', '/api/prestations', corps);
      const ligne = r.donnees;
      page.recent = ligne.id;
      const horsFiltre = page.filtres.mois !== '' && page.filtres.mois !== ligne.date.slice(0, 7);
      notifier({
        texte: `Prestation ajoutée pour ${ligne.patient.prenom} ${ligne.patient.nom}.${horsFiltre ? ` Elle apparaît dans le mois de ${formatMois(ligne.date.slice(0, 7))}.` : ''}`,
        avertissements: r.avertissements,
      });
      // La date et la prestation sont conservées pour enchaîner ; le montant revient au tarif de la prestation.
      form.viderPatientEtMotif();
      form.appliquerTarif();
      form.entrees.nom.focus();
      await charger();
    } catch (err) {
      if (err instanceof ErreurApi && err.status === 422 && err.champs) {
        const liens = form.afficherErreurs(err.champs, v.montant);
        resume.afficher(pluriel(liens.length, 'champ à corriger', 'champs à corriger'), liens);
        liens[0]?.cible.focus();
      } else if (err instanceof ErreurApi && err.code === 'PATIENTS_HOMONYMES') {
        const choix = await choisirHomonyme({ nom: v.nom, prenom: v.prenom, candidats: err.details?.candidats ?? [] });
        if (choix) {
          await soumettre(choix.patientId ? { patientId: choix.patientId } : { nouveauPatient: true });
          return;
        }
        form.entrees.nom.focus();
      } else {
        throw err;
      }
    } finally {
      boutonAjouter.removeAttribute('aria-busy');
    }
  }

  const formulaire = el(
    'form',
    { classe: 'pile', attributs: { novalidate: true, id: idForm } },
    resume.racine,
    form.racine,
    el('div', { classe: 'ajout-rapide__actions' }, boutonAjouter, el('p', { classe: 'ajout-rapide__astuce', texte: 'Entrée pour valider · Tab pour passer au champ suivant' })),
  );
  formulaire.addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    proteger(() => soumettre());
  });

  // Catalogue vide ou entièrement désactivé : rien ne peut être saisi. Le formulaire reste visible mais désactivé, avec l'explication et le lien.
  const explication = explicationFormulaireDesactive(page.catalogue);
  if (explication || !page.ecriture) {
    for (const champ of formulaire.querySelectorAll('input, select, button, textarea')) {
      champ.disabled = true;
      if (page.ecriture) continue;
      // Écriture impossible (lecture seule, conflit) : l'explication est liée à chaque contrôle, sans écraser une description existante.
      champ.setAttribute('aria-describedby', [champ.getAttribute('aria-describedby'), ID_RAISON].filter(Boolean).join(' '));
      if (champ.tagName === 'BUTTON') champ.title = page.explication;
    }
    formulaire.setAttribute('aria-disabled', 'true');
  }

  return el(
    'section',
    { classe: 'carte ajout-rapide', attributs: { 'aria-labelledby': 'titre-ajout', 'data-ajout-desactive': explication ? 'oui' : null } },
    el('div', { classe: 'carte__entete' }, el('h2', { classe: 'carte__titre', texte: 'Ajouter une prestation', attributs: { id: 'titre-ajout' } })),
    explication ? alerte('attention', explication.titre, explication.texte, 'status', [el('a', { classe: 'btn btn--primaire', texte: explication.lien, attributs: { href: LIEN_TARIFS } })]) : null,
    formulaire,
  );
}

// ---------------------------------------------------------------- Démarrage

function construirePage() {
  const memorises = lireFiltresMemorises();
  page.filtres = { mois: memorises?.mois ?? moisCourant(), statut: memorises?.statut ?? '', etat: memorises?.etat ?? '', patient: '' };
  if (!['', 'a_facturer', 'facture'].includes(page.filtres.statut)) page.filtres.statut = '';
  if (!['', 'non_paye', 'partiel', 'paye'].includes(page.filtres.etat)) page.filtres.etat = '';
  if (page.filtres.mois !== '' && !/^\d{4}-\d{2}$/.test(page.filtres.mois)) page.filtres.mois = moisCourant();
  page.impayes = lireImpayesUrl(page.tranches);
  if (!page.impayes && new URLSearchParams(window.location.search).has('anciennete')) {
    page.lienInvalide = true;
    window.history.replaceState(null, '', window.location.pathname);
  }
  if (page.impayes) page.filtres = { mois: '', statut: page.impayes.statut, etat: '', patient: '' };

  const mois = creerSelect('Mois', [['', 'Tous les mois']], page.filtres.mois, async (valeur) => {
    await quitterImpayes();
    page.filtres.mois = valeur;
    page.selection.clear();
    memoriserFiltres();
    await proteger(charger);
  });
  zone.selectMois = mois.select;
  const statut = creerSelect('Facturation', [['', 'Tous'], ['a_facturer', 'À facturer'], ['facture', 'Facturé']], page.filtres.statut, (valeur) => {
    page.filtres.statut = valeur;
    memoriserFiltres();
    rendreListe();
  });
  zone.selectStatut = statut.select;
  const etat = creerSelect('Paiement', [['', 'Tous'], ['non_paye', 'Non payé'], ['partiel', 'Partiellement payé'], ['paye', 'Payé']], page.filtres.etat, (valeur) => {
    page.filtres.etat = valeur;
    memoriserFiltres();
    rendreListe();
  });
  zone.selectEtat = etat.select;

  zone.recherche = el('input', { classe: 'input input--recherche', attributs: { id: 'filtre-patient', type: 'search', autocomplete: 'off', placeholder: 'Nom ou prénom' } });
  zone.recherche.addEventListener('input', () => {
    page.filtres.patient = zone.recherche.value; // jamais mémorisé, jamais dans l'URL
    rendreListe();
  });
  const recherche = el('div', { classe: 'champ' }, el('label', { classe: 'champ__label', texte: 'Patient', attributs: { for: 'filtre-patient' } }), zone.recherche);

  const filtres = el(
    'div',
    { classe: 'filtres', attributs: { role: 'group', 'aria-label': 'Filtres de la liste' } },
    mois.racine,
    recherche,
    statut.racine,
    etat.racine,
    el('button', { classe: 'btn btn--discret', texte: 'Effacer les filtres', attributs: { type: 'button' }, evenements: { click: () => proteger(effacerFiltres) } }),
  );

  zone.noteImpayes = el('div', {});
  majNoteImpayes();
  zone.resume = el('p', { classe: 'resume-liste', attributs: { 'aria-live': 'polite' } });
  zone.liste = el('div', {});
  zone.barreTexte = el('span', { classe: 'barre-selection__texte', attributs: { role: 'status' } });
  zone.barre = el(
    'div',
    { classe: 'barre-selection', attributs: { hidden: true } },
    zone.barreTexte,
    el('button', { classe: 'btn btn--primaire', texte: 'Marquer facturé', attributs: { type: 'button' }, evenements: { click: () => proteger(marquerSelectionFacturee) } }),
    el('button', { classe: 'btn btn--secondaire', texte: 'Tout désélectionner', attributs: { type: 'button' }, evenements: { click: () => { page.selection.clear(); rendreListe(); } } }),
  );

  zone.raison = el('p', { classe: 'sr-only', texte: page.explication, attributs: { id: ID_RAISON } });
  zone.ajout = construireAjout();
  remplacer(document.getElementById('zone'), zone.raison, zone.ajout, el('div', { classe: 'pile' }, zone.noteImpayes, filtres, zone.resume, zone.liste, zone.barre));
}

async function demarrer() {
  const zoneBandeaux = document.getElementById('bandeaux');
  try {
    const etat = await lireEtat();
    afficherBandeaux(zoneBandeaux, etat);
    page.alerteSauvegarde = (etat.avertissements ?? []).some((a) => a.code === 'SAUVEGARDE_ECHOUEE');
    appliquerEtatEcriture(etat);
    if (etat.modeDegrade) {
      await afficherEcranDegrade(document.getElementById('zone'), etat);
      return;
    }
    page.aujourdHui = etat.aujourdHui;
    page.tranches = etat.tranchesAnciennete ?? [];
    page.dernierMode.valeur = etat.dernierModePaiement ?? null;
    page.catalogue = (await appeler('GET', '/api/catalogue')).catalogue;
    construirePage();
    await charger();
    // Page laissée ouverte (PC jamais éteint) : date du jour relue au retour sur l'onglet et chaque minute.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        actualiserDate();
        // Un tarif modifié dans Paramètres (autre onglet) doit être celui de l'ajout rapide (sinon l'ajout rapide utiliserait l'ancien tarif).
        appeler('GET', '/api/catalogue').then((r) => {
          const avant = etatCatalogue(page.catalogue);
          page.catalogue = r.catalogue;
          // Prestations définies (ou désactivées) dans un autre onglet : le formulaire passe de désactivé à utilisable, ou l'inverse.
          if (etatCatalogue(page.catalogue) !== avant && zone.ajout?.isConnected) {
            const nouveau = construireAjout();
            zone.ajout.replaceWith(nouveau);
            zone.ajout = nouveau;
            rendreListe();
          }
        }).catch(() => {});
      }
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') actualiserDate();
    }, 60_000);
  } catch (err) {
    remplacer(zoneBandeaux, alerte('danger', 'Erreur', err.message, 'alert'));
    remplacer(document.getElementById('zone'));
  }
}

demarrer();

// Écran « Patients » : liste, recherche et filtre, ajout (avec les patients proches), renommage, archivage / réactivation sans dialogue,
// suppression d'un patient sans prestation. Le registre ne contient que nom, prénom et « actif » : aucune donnée de santé.
// Le serveur calcule (nombre de prestations, homonymes, patients supprimables) ; ici on affiche, on filtre localement et on appelle l'API.
// Aucun nom dans l'URL ni dans le stockage du navigateur : seul le filtre Actifs / Archivés / Tous peut être retenu (sessionStorage).
import { ErreurApi, appeler, lireEtat } from '/js/api.js';
import { afficherBandeaux, alerte } from '/js/bandeaux.js';
import { el, remplacer } from '/js/dom.js';
import { afficherEcranDegrade } from '/js/ecran-degrade.js';
import { MESSAGE_ACTION_EN_COURS, ecritureAutorisee, explicationEcritureImpossible } from '/js/ecriture.js';
import { correspondPatient, formatDate, normaliserRecherche, pluriel } from '/js/format.js';
import { dialogueHomonyme, lignePatientExistant } from '/js/patients-dialogues.js';
import { rechercherPatients } from '/js/recherche-patients.js';
import { afficherToast, confirmer, creerChamp, creerDialogue, creerResume } from '/js/ui.js';

const CLE_STOCKAGE = 'suivi-facturation.patients.filtre'; // « actifs », « archives » ou « tous » : jamais de nom
const FILTRES = [
  ['actifs', 'Actifs'],
  ['archives', 'Archivés'],
  ['tous', 'Tous'],
];
const MAX_PROCHES = 5;
const ID_RAISON = 'raison-ecriture';

const page = {
  patients: [],
  afficher: 'actifs',
  recherche: '', // jamais mémorisée, jamais dans l'URL
  recent: null,
  occupe: false,
  ecriture: true, // faux en lecture seule, en conflit ou en mode dégradé : les contrôles d'écriture sont désactivés
  explication: '',
  alerteSauvegarde: false,
};
const zone = {};

/** Attributs d'un contrôle d'écriture : désactivé, avec infobulle et texte lié, quand l'écriture est impossible. */
const accesEcriture = () => (page.ecriture ? {} : { disabled: true, title: page.explication, 'aria-describedby': ID_RAISON });
const nomComplet = (p) => `${p.nom} ${p.prenom}`;

// ------------------------------------------------------- Filtre mémorisé

function lireFiltreMemorise() {
  try {
    const valeur = sessionStorage.getItem(CLE_STOCKAGE);
    if (FILTRES.some(([cle]) => cle === valeur)) return valeur;
  } catch {
    // stockage indisponible : filtre par défaut
  }
  return 'actifs';
}

function memoriserFiltre() {
  try {
    sessionStorage.setItem(CLE_STOCKAGE, page.afficher);
  } catch {
    // sans conséquence
  }
}

// ---------------------------------------------------------- Notifications

function notifier({ texte, avertissements = [], annulation }) {
  const messages = avertissements.map((a) => a.message);
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
  if (page.occupe) {
    afficherToast({ texte: MESSAGE_ACTION_EN_COURS, variante: 'attention' }); // le clic est ignoré : on le dit
    return;
  }
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

function appliquerEtatEcriture(etat) {
  const avant = page.ecriture;
  page.ecriture = ecritureAutorisee(etat);
  page.explication = explicationEcritureImpossible(etat);
  if (zone.raison) zone.raison.textContent = page.explication;
  return avant !== page.ecriture;
}

async function actualiserBandeaux() {
  try {
    const etat = await lireEtat();
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

// ---------------------------------------------------------------- Chargement

async function charger() {
  page.patients = (await appeler('GET', '/api/patients')).patients;
  rendreListe();
  majProches();
}

// ------------------------------------------------------------------ Liste

function patientsVisibles() {
  return page.patients.filter((p) => (page.afficher === 'tous' || (page.afficher === 'actifs' ? p.actif : !p.actif)) && correspondPatient(p, page.recherche));
}

/** Rend le focus utile après une action : le même bouton si la ligne existe encore, sinon la liste. */
function restaurerFocus(id, action) {
  const bouton = id ? zone.liste.querySelector(`[data-patient-id="${CSS.escape(id)}"][data-action="${action}"]`) : null;
  (bouton ?? zone.liste.querySelector('[role="region"]') ?? zone.recherche).focus();
}

const dateDerniere = (p) => (p.dernierePrestation ? `dernière prestation le ${formatDate(p.dernierePrestation)}` : 'aucune prestation');

function boutonAction(p, action, libelle, classe, auClic) {
  const precision = p.homonyme ? `, ${dateDerniere(p)}` : '';
  return el('button', {
    classe: `btn btn--petit ${classe}`,
    texte: libelle,
    attributs: { type: 'button', 'data-patient-id': p.id, 'data-action': action, 'aria-label': `${libelle} le patient ${nomComplet(p)}${precision}`, ...accesEcriture() },
    evenements: { click: () => proteger(() => auClic(p)) },
  });
}

function creerLigne(p) {
  const actions = el('span', { classe: 'actions-ligne' }, boutonAction(p, 'renommer', 'Renommer', 'btn--secondaire', renommer));
  actions.append(p.actif ? boutonAction(p, 'archiver', 'Archiver', 'btn--secondaire', (x) => changerActif(x, false)) : boutonAction(p, 'reactiver', 'Réactiver', 'btn--secondaire', (x) => changerActif(x, true)));
  if (p.supprimable) actions.append(boutonAction(p, 'supprimer', 'Supprimer', 'btn--danger-discret', supprimer));
  const classes = [p.actif ? '' : 'ligne--archivee', p.id === page.recent ? 'ligne--modifiee-recemment' : ''].filter(Boolean).join(' ');
  const meta = `${p.actif ? '' : 'Archivé · '}${p.nombrePrestations === 0 ? 'aucune prestation' : pluriel(p.nombrePrestations, 'prestation')}`;
  return el(
    'tr',
    { classe: classes, attributs: { 'data-patient-id': p.id } },
    el(
      'th',
      { attributs: { scope: 'row' } },
      el('span', { classe: 'patient__nom', texte: p.nom }),
      ' ',
      el('span', { classe: 'patient__prenom', texte: p.prenom }),
      p.homonyme ? el('span', { classe: 'patient__badges' }, el('span', { classe: 'badge badge--homonyme', texte: 'Homonyme' })) : null,
      el('span', { classe: 'cellule-double__secondaire', texte: dateDerniere(p) }),
      el('span', { classe: 'patient-meta', texte: meta }),
    ),
    el('td', { classe: 'col-detail-patient' }, p.actif ? el('span', { classe: 'badge badge--actif', texte: 'Actif' }) : el('span', { classe: 'badge badge--archive', texte: 'Archivé' })),
    el('td', { classe: 'col-detail-patient col-nombre', texte: String(p.nombrePrestations) }),
    el('td', { classe: 'col-action' }, actions),
  );
}

function etatVide() {
  const effacer = el('button', { classe: 'btn btn--secondaire', texte: 'Effacer les filtres', attributs: { type: 'button' }, evenements: { click: effacerFiltres } });
  if (page.patients.length === 0) {
    return el(
      'div',
      { classe: 'etat-vide', attributs: { 'data-accueil-vide': 'oui' } },
      el('p', { classe: 'etat-vide__titre', texte: 'Aucun patient enregistré' }),
      el('p', { classe: 'etat-vide__texte', texte: 'Les patients se créent ici ou directement quand vous saisissez une prestation.' }),
      el(
        'div',
        { classe: 'etat-vide__actions' },
        el('button', { classe: 'btn btn--primaire', texte: 'Ajouter un patient', attributs: { type: 'button', ...accesEcriture() }, evenements: { click: () => zone.nom.focus() } }),
        el('a', { classe: 'btn btn--secondaire', texte: 'Saisir une prestation', attributs: { href: '/prestations.html' } }),
      ),
    );
  }
  const titre = page.recherche.trim() === '' && page.afficher === 'archives' ? 'Aucun patient archivé' : page.recherche.trim() === '' && page.afficher === 'actifs' ? 'Aucun patient actif' : 'Aucun patient';
  return el(
    'div',
    { classe: 'etat-vide' },
    el('p', { classe: 'etat-vide__titre', texte: titre }),
    el('p', { classe: 'etat-vide__texte', texte: 'Aucun patient ne correspond aux filtres choisis.' }),
    el('div', { classe: 'etat-vide__actions' }, effacer),
  );
}

function rendreListe() {
  const visibles = patientsVisibles();
  const recent = page.recent;
  remplacer(zone.resume, el('span', {}, el('strong', { texte: String(visibles.length) }), ` ${visibles.length > 1 ? 'patients affichés' : 'patient affiché'}`));
  if (visibles.length === 0) {
    remplacer(zone.liste, etatVide());
  } else {
    remplacer(
      zone.liste,
      el(
        'div',
        { classe: 'table-wrap table-wrap--haut', attributs: { role: 'region', 'aria-label': 'Liste des patients', tabindex: '0' } },
        el(
          'table',
          { classe: 'table table-patients' },
          el('caption', { classe: 'sr-only', texte: 'Patients enregistrés, triés par nom puis prénom' }),
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { texte: 'Patient', attributs: { scope: 'col' } }),
              el('th', { texte: 'État', classe: 'col-detail-patient', attributs: { scope: 'col' } }),
              el('th', { texte: 'Prestations', classe: 'col-detail-patient col-nombre', attributs: { scope: 'col' } }),
              el('th', { texte: 'Actions', classe: 'col-action', attributs: { scope: 'col' } }),
            ),
          ),
          el('tbody', {}, ...visibles.map(creerLigne)),
        ),
      ),
    );
    if (recent) zone.liste.querySelector(`tr[data-patient-id="${CSS.escape(recent)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  page.recent = null;
  for (const bouton of zone.segments ?? []) bouton.setAttribute('aria-pressed', String(bouton.dataset.filtre === page.afficher));
}

// -------------------------------------------------------------- Filtres

/** Toujours appelée par un clic : remet la recherche à zéro et affiche tous les patients. */
function effacerFiltres() {
  page.recherche = '';
  zone.recherche.value = '';
  choisirFiltre('tous');
}

function choisirFiltre(valeur) {
  page.afficher = valeur;
  memoriserFiltre();
  rendreListe();
}

/** Rend un patient visible (« Utiliser ce patient », patient retrouvé) : filtre élargi si besoin, ligne mise en évidence. */
function reveler(id) {
  const p = page.patients.find((x) => x.id === id);
  if (!p) return;
  page.recherche = '';
  zone.recherche.value = '';
  if (page.afficher !== 'tous' && (page.afficher === 'actifs') !== p.actif) {
    page.afficher = 'tous';
    memoriserFiltre();
  }
  page.recent = id;
  rendreListe();
}

// ---------------------------------------------------------------- Ajout

const POSER_NOM = { type: 'text', autocomplete: 'off', maxlength: '100' };

let signatureProches = null;

function construireAjout() {
  signatureProches = null; // la liste des patients proches est reconstruite avec le formulaire
  const resume = creerResume();
  const champNom = creerChamp({ label: 'Nom', requis: true, creerEntree: (id) => el('input', { classe: 'input', attributs: { id, name: 'nom', ...POSER_NOM } }) });
  const champPrenom = creerChamp({ label: 'Prénom', requis: true, creerEntree: (id) => el('input', { classe: 'input', attributs: { id, name: 'prenom', ...POSER_NOM } }) });
  zone.nom = champNom.entree;
  zone.prenom = champPrenom.entree;
  zone.proches = el('div', { classe: 'pile pile--s', attributs: { role: 'status', 'aria-live': 'polite' } });
  const boutonAjouter = el('button', { classe: 'btn btn--primaire', texte: 'Ajouter le patient', attributs: { type: 'submit' } });
  const champs = { nom: champNom, prenom: champPrenom };

  async function soumettre(extra = {}) {
    Object.values(champs).forEach((c) => c.effacerErreur());
    resume.masquer();
    const nom = champNom.entree.value;
    const prenom = champPrenom.entree.value;
    boutonAjouter.setAttribute('aria-busy', 'true');
    try {
      const r = await appeler('POST', '/api/patients', { nom, prenom, ...extra });
      champNom.entree.value = '';
      champPrenom.entree.value = '';
      page.recent = r.donnees.id;
      notifier({ texte: `Patient ajouté : ${nomComplet(r.donnees)}.`, avertissements: r.avertissements, annulation: r.annulation });
      champNom.entree.focus();
      await charger();
    } catch (err) {
      if (err instanceof ErreurApi && err.status === 422 && err.champs) {
        const liens = [];
        for (const [cle, champ] of Object.entries(champs)) {
          if (!err.champs[cle]) continue;
          champ.erreur(err.champs[cle]);
          liens.push({ texte: err.champs[cle], cible: champ.entree });
        }
        resume.afficher(pluriel(liens.length, 'champ à corriger', 'champs à corriger'), liens);
        liens[0]?.cible.focus();
      } else if (err instanceof ErreurApi && err.code === 'PATIENT_EXISTANT') {
        await charger();
        const choix = await dialogueHomonyme({ mode: 'ajout', nom, prenom, candidats: err.details?.candidats ?? [], registre: page.patients });
        if (choix?.homonyme) {
          await soumettre({ homonyme: true });
          return;
        }
        if (choix?.patientId) {
          const p = page.patients.find((x) => x.id === choix.patientId);
          champNom.entree.value = '';
          champPrenom.entree.value = '';
          majProches();
          reveler(choix.patientId);
          notifier({ texte: `Ce patient est déjà enregistré${p ? ` : ${nomComplet(p)}` : ''}. Rien n'a été créé.` });
          return;
        }
        champNom.entree.focus();
      } else {
        throw err;
      }
    } finally {
      boutonAjouter.removeAttribute('aria-busy');
    }
  }

  const formulaire = el(
    'form',
    { classe: 'pile', attributs: { novalidate: true, id: 'form-ajout-patient' } },
    resume.racine,
    el('div', { classe: 'formulaire-grille' }, champNom.racine, champPrenom.racine),
    zone.proches,
    el('div', { classe: 'ajout-rapide__actions' }, boutonAjouter, el('p', { classe: 'ajout-rapide__astuce', texte: 'Entrée pour valider · Tab pour passer au champ suivant' })),
  );
  formulaire.addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    proteger(() => soumettre());
  });
  for (const champ of [champNom, champPrenom]) champ.entree.addEventListener('input', majProches);

  if (!page.ecriture) {
    for (const champ of formulaire.querySelectorAll('input, button')) {
      champ.disabled = true;
      champ.setAttribute('aria-describedby', [champ.getAttribute('aria-describedby'), ID_RAISON].filter(Boolean).join(' '));
      if (champ.tagName === 'BUTTON') champ.title = page.explication;
    }
    formulaire.setAttribute('aria-disabled', 'true');
  }

  return el(
    'section',
    { classe: 'carte ajout-rapide', attributs: { 'aria-labelledby': 'titre-ajout-patient' } },
    el('div', { classe: 'carte__entete' }, el('h2', { classe: 'carte__titre', texte: 'Ajouter un patient', attributs: { id: 'titre-ajout-patient' } })),
    formulaire,
  );
}

/** Patients enregistrés qui ressemblent à ce qui est tapé (liste informative : n'empêche rien). Mise à jour seulement si elle change. */
function majProches() {
  if (!zone.proches || !zone.nom) return;
  const nom = zone.nom.value;
  const prenom = zone.prenom.value;
  const avecDeux = normaliserRecherche(nom) !== '' && normaliserRecherche(prenom) !== '';
  const { patients, total } = avecDeux ? rechercherPatients(page.patients, { nom, prenom }, { limite: MAX_PROCHES }) : { patients: [], total: 0 };
  const signature = JSON.stringify([patients.map((p) => [p.id, p.nom, p.prenom, p.actif, p.nombrePrestations, p.dernierePrestation, p.homonyme]), total]);
  if (signature === signatureProches) return;
  signatureProches = signature;
  if (patients.length === 0) {
    zone.proches.replaceChildren();
    return;
  }
  remplacer(
    zone.proches,
    el('p', { classe: 'champ__aide', texte: patients.length > 1 ? 'Des patients enregistrés ressemblent à ce nom :' : 'Un patient enregistré ressemble à ce nom :' }),
    el('ul', { classe: 'patients-existants' }, ...patients.map((p) => lignePatientExistant(p))),
    total > patients.length ? el('p', { classe: 'champ__aide', texte: `Et ${total - patients.length} autre${total - patients.length > 1 ? 's' : ''} : précisez le nom.` }) : null,
  );
}

// ------------------------------------------------------------ Actions

async function changerActif(p, actif) {
  const r = await appeler('PATCH', `/api/patients/${p.id}`, { actif });
  notifier({ texte: `${nomComplet(p)} ${actif ? 'réactivé' : 'archivé'}.`, avertissements: r.avertissements, annulation: r.annulation });
  page.recent = actif ? p.id : null;
  await charger();
  restaurerFocus(p.id, actif ? 'archiver' : 'reactiver');
}

async function supprimer(p) {
  const ok = await confirmer({
    titre: 'Supprimer ce patient ?',
    texte: `${nomComplet(p)} n'a aucune prestation. Une sauvegarde est faite juste avant.`,
    libelleConfirmer: 'Supprimer le patient',
    danger: true,
  });
  if (!ok) return;
  const r = await appeler('DELETE', `/api/patients/${p.id}`);
  notifier({ texte: `${nomComplet(p)} supprimé.`, avertissements: r.avertissements, annulation: r.annulation });
  await charger();
  restaurerFocus(null);
}

/** Dialogue « Renommer le patient » : le serveur change le nom du registre et de toutes ses prestations du fichier actif. */
async function renommer(p) {
  const resultat = await new Promise((resolve) => {
    const d = creerDialogue({ titre: 'Renommer le patient' });
    let reponse = null;
    const resume = creerResume();
    const zoneErreur = el('div', { attributs: { 'aria-live': 'polite' } });
    const champ = (label, nom, valeur) => creerChamp({ label, requis: true, creerEntree: (id) => el('input', { classe: 'input', attributs: { id, name: nom, ...POSER_NOM }, proprietes: { value: valeur } }) });
    const champNom = champ('Nom', 'nom', p.nom);
    const champPrenom = champ('Prénom', 'prenom', p.prenom);
    const champs = { nom: champNom, prenom: champPrenom };
    const archives = p.nombrePrestations === 0 && !p.supprimable; // le patient figure ailleurs que dans le fichier actif (archive annuelle)
    const formulaire = el(
      'form',
      { classe: 'pile', attributs: { novalidate: true, id: `form-renommer-${p.id}` } },
      resume.racine,
      el('div', { classe: 'formulaire-grille' }, champNom.racine, champPrenom.racine),
      el('p', { classe: 'champ__aide', texte: p.nombrePrestations === 0 ? 'Aucune prestation à mettre à jour.' : `${pluriel(p.nombrePrestations, 'prestation sera mise à jour', 'prestations seront mises à jour')}.` }),
      archives ? el('p', { classe: 'champ__aide', texte: 'Les prestations rangées dans les archives annuelles gardent l\'ancien nom.' }) : null,
      zoneErreur,
    );
    d.corps.append(formulaire);
    const enregistrer = el('button', { classe: 'btn btn--primaire', texte: 'Renommer', attributs: { type: 'submit', form: formulaire.id } });
    d.pied.append(el('button', { classe: 'btn btn--secondaire', texte: 'Annuler', attributs: { type: 'button' }, evenements: { click: () => d.fermer() } }), enregistrer);

    async function envoyer(extra = {}) {
      const nom = champNom.entree.value;
      const prenom = champPrenom.entree.value;
      if (nom.trim() === p.nom && prenom.trim() === p.prenom) {
        d.fermer(); // rien n'a changé
        return;
      }
      enregistrer.setAttribute('aria-busy', 'true');
      enregistrer.disabled = true;
      try {
        const r = await appeler('PATCH', `/api/patients/${p.id}`, { nom, prenom, ...extra });
        reponse = r;
        d.fermer();
      } catch (err) {
        enregistrer.removeAttribute('aria-busy');
        enregistrer.disabled = false;
        if (err instanceof ErreurApi && err.status === 422 && err.champs) {
          const liens = [];
          for (const [cle, c] of Object.entries(champs)) {
            if (!err.champs[cle]) continue;
            c.erreur(err.champs[cle]);
            liens.push({ texte: err.champs[cle], cible: c.entree });
          }
          resume.afficher(pluriel(liens.length, 'champ à corriger', 'champs à corriger'), liens);
          liens[0]?.cible.focus();
        } else if (err instanceof ErreurApi && err.code === 'PATIENT_EXISTANT') {
          const choix = await dialogueHomonyme({ mode: 'renommage', nom, prenom, candidats: err.details?.candidats ?? [], registre: page.patients });
          if (choix?.homonyme) await envoyer({ homonyme: true });
          else champNom.entree.focus();
        } else if (err instanceof ErreurApi && [404, 409, 503].includes(err.status)) {
          d.fermer();
          reponse = null;
          resolve({ erreur: err });
        } else {
          zoneErreur.replaceChildren(alerte('danger', 'Erreur', err.message, 'alert'));
        }
      }
    }

    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      Object.values(champs).forEach((c) => c.effacerErreur());
      resume.masquer();
      zoneErreur.replaceChildren();
      envoyer();
    });
    d.dialogue.addEventListener('close', () => resolve({ reponse }));
    d.ouvrir(champNom.entree);
  });
  if (resultat.erreur) throw resultat.erreur;
  const r = resultat.reponse;
  if (!r) return;
  const apres = r.donnees.patient;
  const n = r.donnees.lignesModifiees;
  notifier({
    texte: `${nomComplet(p)} renommé en ${nomComplet(apres)}.${n > 0 ? ` ${pluriel(n, 'prestation mise à jour', 'prestations mises à jour')}.` : ''}`,
    avertissements: r.avertissements,
    annulation: r.annulation,
  });
  page.recent = p.id;
  await charger();
  restaurerFocus(p.id, 'renommer');
}

// ---------------------------------------------------------------- Démarrage

function construirePage() {
  page.afficher = lireFiltreMemorise();
  zone.raison = el('p', { classe: 'sr-only', texte: page.explication, attributs: { id: ID_RAISON } });
  zone.ajout = construireAjout();

  const aide = el(
    'aside',
    { classe: 'aide-patients', attributs: { 'aria-labelledby': 'titre-aide-patients' } },
    el('h2', { classe: 'aide-patients__titre', texte: 'Actif, archivé, archives annuelles : quelle différence ?', attributs: { id: 'titre-aide-patients' } }),
    el(
      'dl',
      { classe: 'infos' },
      el('dt', { texte: 'Patient actif' }),
      el('dd', { texte: 'Proposé en premier quand vous saisissez une prestation.' }),
      el('dt', { texte: 'Patient archivé' }),
      el('dd', { texte: "N'est plus proposé en premier à la saisie. Ses prestations, ses chiffres, ses exports et ses sauvegardes ne changent pas. Vous pouvez le réactiver à tout moment." }),
      el('dt', { texte: 'Archives annuelles' }),
      el('dd', { texte: "Anciennes prestations rangées par année, en lecture seule. Cette fonction n'est pas encore disponible. Archiver un patient n'a aucun rapport avec elles." }),
    ),
  );

  zone.recherche = el('input', { classe: 'input input--recherche', attributs: { id: 'filtre-recherche-patient', type: 'search', autocomplete: 'off', placeholder: 'Nom ou prénom' } });
  zone.recherche.addEventListener('input', () => {
    page.recherche = zone.recherche.value; // jamais mémorisée, jamais dans l'URL
    rendreListe();
  });
  zone.segments = FILTRES.map(([cle, libelle]) =>
    el('button', { classe: 'segment__bouton', texte: libelle, attributs: { type: 'button', 'data-filtre': cle, 'aria-pressed': String(page.afficher === cle) }, evenements: { click: () => choisirFiltre(cle) } }),
  );
  const filtres = el(
    'div',
    { classe: 'filtres', attributs: { role: 'group', 'aria-label': 'Filtres de la liste des patients' } },
    el('div', { classe: 'champ' }, el('label', { classe: 'champ__label', texte: 'Recherche', attributs: { for: 'filtre-recherche-patient' } }), zone.recherche),
    el('div', { classe: 'champ' }, el('span', { classe: 'champ__label', texte: 'Afficher' }), el('div', { classe: 'segment', attributs: { role: 'group', 'aria-label': 'Patients à afficher' } }, ...zone.segments)),
  );
  zone.resume = el('p', { classe: 'resume-liste', attributs: { 'aria-live': 'polite' } });
  zone.liste = el('div', {});
  remplacer(document.getElementById('zone'), zone.raison, zone.ajout, aide, filtres, zone.resume, zone.liste);
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
    construirePage();
    await charger();
    // Page laissée ouverte : la liste est relue au retour sur l'onglet (patients créés à la saisie d'une prestation, autre onglet).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !page.occupe) charger().catch(() => {});
    });
  } catch (err) {
    remplacer(zoneBandeaux, alerte('danger', 'Erreur', err.message, 'alert'));
    remplacer(document.getElementById('zone'));
  }
}

demarrer();

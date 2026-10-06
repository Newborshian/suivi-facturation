// Écran « Facturation du mois » (récapitulatif du mois) : récapitulatif par patient, copiable et imprimable.
// Le serveur calcule (GET /api/recap) ; ici on affiche. Seul un mois choisi explicitement est retenu dans sessionStorage
// (jamais de nom de patient) ; la vue n'est jamais retenue.
import { ErreurApi, appeler, lireEtat } from '/js/api.js';
import { remplacerSiFichierVide } from '/js/accueil-vide.js';
import { LIEN_TARIFS, saisieImpossible } from '/js/catalogue-etat.js';
import { afficherBandeaux, alerte } from '/js/bandeaux.js';
import { el, remplacer } from '/js/dom.js';
import { afficherEcranDegrade } from '/js/ecran-degrade.js';
import { ecritureAutorisee } from '/js/ecriture.js';
import { formatDate, formatEuros, formatMois, moisPlusN, montantDernierVersement, nomPatient, pluriel } from '/js/format.js';
import { dialogueModification, dialogueVersement, choisirMode } from '/js/pages/prestations-dialogues.js';
import { construireTableau } from '/js/pages/facturation-tableau.js';
import { formaterDetailTexte, formaterRecapTexte } from '/js/recap-texte.js';
import { lignesAMarquer, lignesAMarquerDuMois, nbAVenirAFacturer, recapACopier, toutesLesLignes } from '/js/recap-regles.js';
import { afficherToast, confirmer, creerDialogue } from '/js/ui.js';

const CLE_STOCKAGE = 'suivi-facturation.facturation.vue'; // mois et vue seulement : jamais de nom
const CLE_FILTRES_PRESTATIONS = 'suivi-facturation.prestations.filtres'; // même clé que l'écran Prestations (lien « Voir la liste »)

const page = {
  mois: null, // null = mois en cours (le serveur le fournit)
  vue: 'prestation',
  recap: null,
  catalogue: [],
  dernierMode: { valeur: null },
  ouverts: new Set(), // patients dont le détail est déplié (identifiants opaques)
  detailImpression: false, // décoché par défaut
  recent: null,
  ecriture: true,
  occupe: false,
  alerteSauvegarde: false,
  requete: 0, // numéro de la dernière requête : une réponse tardive n'écrase pas une plus récente
};
const zone = {};

// ------------------------------------------------------- Stockage (non nominatif)

function lireMemoire() {
  try {
    const brut = JSON.parse(sessionStorage.getItem(CLE_STOCKAGE) ?? 'null');
    if (brut && typeof brut === 'object') return brut;
  } catch {
    // stockage indisponible : valeurs par défaut
  }
  return null;
}

/** Seul un mois choisi explicitement est retenu ; la vue n'est jamais retenue : l'écran s'ouvre sur « par date de prestation ». */
function memoriser() {
  try {
    sessionStorage.setItem(CLE_STOCKAGE, JSON.stringify({ mois: page.mois }));
  } catch {
    // sans conséquence
  }
}

// ---------------------------------------------------------------- Messages

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
  if (page.occupe) return;
  page.occupe = true;
  try {
    await action();
  } catch (err) {
    afficherToast({ texte: err instanceof ErreurApi ? err.message : 'Une erreur est survenue.', variante: 'erreur' });
    if (err instanceof ErreurApi && [404, 409, 503].includes(err.status)) {
      await actualiserBandeaux(); // d'abord : le mode lecture seule doit être connu avant le nouveau rendu
      await charger().catch(() => {});
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
    page.ecriture = ecritureAutorisee(etat);
    afficherBandeaux(document.getElementById('bandeaux'), etat);
  } catch {
    // l'erreur de chargement est déjà signalée par la page
  }
}

// ---------------------------------------------------------------- Chargement

async function charger() {
  const numero = ++page.requete;
  const parametres = new URLSearchParams({ vue: page.vue });
  if (page.mois) parametres.set('mois', page.mois); // le mois est le seul paramètre : aucun nom de patient dans l'URL
  try {
    const recap = await appeler('GET', `/api/recap?${parametres}`);
    if (numero !== page.requete) return;
    page.recap = recap;
    rendre();
  } catch (err) {
    if (numero !== page.requete) return;
    if (err instanceof ErreurApi && err.status === 400) {
      page.mois = null; // mois mémorisé invalide : on repart du mois en cours
      memoriser();
    }
    remplacer(
      zone.contenu,
      el(
        'div',
        { classe: 'pile' },
        alerte('danger', 'Erreur', err instanceof ErreurApi ? err.message : 'Le récapitulatif ne peut pas être affiché.', 'alert'),
        el('div', {}, el('button', { classe: 'btn btn--secondaire', texte: 'Réessayer', attributs: { type: 'button' }, evenements: { click: () => proteger(charger) } })),
      ),
    );
  }
}

/** Choix explicite du mois : seul cas où il est retenu. Le mois en cours est représenté par `null` (suit la date du jour). */
async function choisirMois(mois) {
  if (!mois) return;
  const cible = mois === page.recap?.aujourdHui.slice(0, 7) ? null : mois;
  if (cible === page.mois) return;
  page.mois = cible;
  memoriser();
  // Pas de `proteger` : une simple lecture ne doit pas être ignorée pendant une action ; `page.requete` écarte les réponses tardives.
  await charger();
}

async function choisirVue(vue) {
  if (vue === page.vue) return;
  page.vue = vue;
  await charger();
}

// ---------------------------------------------------------------- Actions

/** Même règle pour « tout le mois » et pour un patient (recap-regles.js) : les prestations à venir restent à facturer, et on le dit. */
async function marquerFacture(lignes, qui) {
  const { concernees, aVenir } = lignesAMarquer(lignes);
  const ids = concernees.map((l) => l.id);
  if (ids.length === 0) return;
  const noteAVenir = !aVenir ? '' : ` ${pluriel(aVenir, 'prestation', 'prestations')} à venir ${aVenir > 1 ? 'ne sont pas concernées' : "n'est pas concernée"} : ${aVenir > 1 ? 'elles restent' : 'elle reste'} à facturer.`;
  const ok = await confirmer({
    titre: `Marquer ${pluriel(ids.length, 'prestation', 'prestations')} ${qui} comme ${ids.length > 1 ? 'facturées' : 'facturée'} ?`,
    texte: `${ids.length > 1 ? 'Elles passeront' : 'Elle passera'} au statut « Facturé ». Les prestations déjà facturées ne sont pas modifiées.${noteAVenir}`,
    libelleConfirmer: 'Marquer facturé',
  });
  if (!ok) return;
  const r = await appeler('POST', '/api/prestations/statut', { ids, statut: 'facture' });
  const n = r.donnees.modifiees;
  notifier({
    texte: n === 0 ? 'Ces prestations étaient déjà facturées. Le récapitulatif est à jour.' : `${pluriel(n, 'prestation marquée facturée', 'prestations marquées facturées')}.`,
    avertissements: r.avertissements,
    annulation: n > 0 ? r.annulation : undefined,
  });
  await charger();
}

async function basculerStatut(ligne) {
  const cible = ligne.statut === 'facture' ? 'a_facturer' : 'facture';
  const r = await appeler('POST', '/api/prestations/statut', { ids: [ligne.id], statut: cible });
  page.recent = ligne.patient.id;
  if (r.donnees.modifiees === 0) notifier({ texte: 'Cette prestation avait déjà ce statut (modifiée depuis un autre onglet ?). Le récapitulatif est à jour.', avertissements: r.avertissements });
  else notifier({ texte: cible === 'facture' ? 'Marqué facturé.' : 'Remis à facturer.', avertissements: r.avertissements, annulation: r.annulation });
  await charger();
}

async function payer(ligne, mode) {
  try {
    const r = await appeler('POST', `/api/prestations/${ligne.id}/payer-totalite`, mode ? { mode } : {});
    page.dernierMode.valeur = r.donnees.versements.at(-1)?.mode ?? page.dernierMode.valeur;
    page.recent = ligne.patient.id;
    notifier({ texte: `${formatEuros(montantDernierVersement(r.donnees, ligne.resteCentimes))} enregistrés.`, avertissements: r.avertissements, annulation: r.annulation });
    await charger();
  } catch (err) {
    if (err instanceof ErreurApi && err.code === 'MODE_REQUIS') {
      const choisi = await choisirMode({ resteCentimes: ligne.resteCentimes });
      if (choisi) await payer(ligne, choisi);
      return;
    }
    throw err;
  }
}

const ctxDialogues = {
  get catalogue() {
    return page.catalogue;
  },
  get aujourdHui() {
    return page.recap?.aujourdHui ?? '';
  },
  dernierMode: page.dernierMode,
  notifier,
};

async function ajouterVersement(ligne) {
  const r = await dialogueVersement({ ligne, ctx: ctxDialogues });
  if (!r) return;
  page.recent = ligne.patient.id;
  notifier({ texte: 'Versement enregistré.', avertissements: r.avertissements, annulation: r.annulation });
  await charger();
}

async function modifier(ligne) {
  const { modifiee } = await dialogueModification({ ligne, ctx: ctxDialogues });
  if (modifiee) {
    page.recent = ligne.patient.id;
    await charger();
  }
}

// ---------------------------------------------------------------- Copie

/** Copie impossible (presse-papiers indisponible ou refusé) : le texte est proposé sélectionné, à copier avec Ctrl+C. */
function proposerCopieManuelle(texte) {
  const d = creerDialogue({ titre: 'Copie automatique impossible', large: true });
  const zoneTexte = el('textarea', { classe: 'input', attributs: { readonly: true, rows: '10', 'aria-label': 'Texte à copier' }, proprietes: { value: texte } });
  d.corps.append(el('p', { texte: 'Le navigateur n\'autorise pas la copie automatique. Le texte ci-dessous est sélectionné : copiez-le avec Ctrl+C (ou Cmd+C), puis collez-le dans votre outil.' }), zoneTexte);
  d.pied.append(el('button', { classe: 'btn btn--primaire', texte: 'Fermer', attributs: { type: 'button' }, evenements: { click: () => d.fermer() } }));
  d.ouvrir(zoneTexte);
  zoneTexte.select();
}

/** -> true si le texte est dans le presse-papiers ; sinon ouvre l'alternative manuelle. */
async function copierTexte(texte) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('presse-papiers indisponible');
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    proposerCopieManuelle(texte);
    return false;
  }
}

/** Retour visuel sur le bouton (« Copié ✓ » deux secondes) en plus du message. */
function retourCopie(bouton, libelleInitial) {
  bouton.textContent = 'Copié ✓';
  setTimeout(() => {
    bouton.textContent = libelleInitial;
  }, 2000);
}

/** Copie TOUJOURS la vue par date de prestation (celle qui sert à facturer, avec le reste à payer), même si la vue par versement est affichée. */
async function copierRecap(bouton) {
  const libelle = bouton.textContent;
  const recap = await recapACopier(page.recap, (mois) => appeler('GET', `/api/recap?${new URLSearchParams({ vue: 'prestation', mois })}`));
  if (recap.patients.length === 0) {
    afficherToast({ texte: `Aucune prestation en ${formatMois(recap.mois)} : rien à copier.`, variante: 'attention' });
    return;
  }
  if (await copierTexte(formaterRecapTexte(recap))) {
    retourCopie(bouton, libelle);
    afficherToast({ texte: `Récapitulatif par date de prestation, ${formatMois(recap.mois)}, copié (${pluriel(recap.patients.length, 'patient')}).` });
  }
}

async function copierDetail(entree, bouton) {
  const libelle = bouton.textContent;
  if (await copierTexte(formaterDetailTexte(entree))) {
    retourCopie(bouton, libelle);
    afficherToast({ texte: `Détail copié (${pluriel(entree.lignes.length, 'prestation')}).` });
  }
}

// ---------------------------------------------------------------- Rendu

function selecteurMois(recap) {
  const precedent = moisPlusN(recap.mois, -1);
  const suivant = moisPlusN(recap.mois, 1);
  const moisCourant = recap.aujourdHui.slice(0, 7);
  const select = el(
    'select',
    { classe: 'input', attributs: { 'aria-label': 'Mois affiché' }, evenements: { change: (evenement) => choisirMois(evenement.target.value) } },
    ...[...recap.moisDisponibles].sort().reverse().map((m) => el('option', { texte: formatMois(m), attributs: { value: m, selected: m === recap.mois } })),
  );
  const nav = (cible, texte, libelle) =>
    el('button', { classe: 'btn btn--secondaire', texte, attributs: { type: 'button', disabled: cible === null, 'aria-label': cible ? `${libelle} : ${formatMois(cible)}` : null }, evenements: { click: () => choisirMois(cible) } });
  return el(
    'div',
    { classe: 'selecteur-mois', attributs: { role: 'group', 'aria-label': 'Choix du mois' } },
    nav(precedent, '◀ Mois précédent', 'Mois précédent'),
    select,
    nav(suivant, 'Mois suivant ▶', 'Mois suivant'),
    el('button', { classe: 'btn btn--discret', texte: 'Mois en cours', attributs: { type: 'button', disabled: recap.mois === moisCourant }, evenements: { click: () => choisirMois(moisCourant) } }),
  );
}

function commutateurVue() {
  const option = (vue, libelle) => el('button', { classe: 'segment__bouton', texte: libelle, attributs: { type: 'button', 'aria-pressed': String(page.vue === vue) }, evenements: { click: () => choisirVue(vue) } });
  return el('div', { classe: 'segment', attributs: { role: 'group', 'aria-label': 'Vue du récapitulatif' } }, option('prestation', 'Par date de prestation'), option('versement', 'Par date de versement'));
}

/** Zone live stable (dans index.html), mise à jour seulement quand le message change : pas d'annonce répétée à chaque rendu. */
let derniereAnnonce = null;
function annoncerAFacturer(message) {
  if (message === derniereAnnonce) return;
  derniereAnnonce = message;
  const annonce = document.getElementById('annonce-facturer');
  if (annonce) annonce.textContent = message;
}

/** Prestations encore à facturer, tous mois confondus. Les prestations à venir sont comptées à part. */
function indicateurAFacturer(recap) {
  if (recap.fichierVide) {
    annoncerAFacturer(''); // fichier sans aucune prestation : seul l'accueil vide s'affiche
    return null;
  }
  const { nombre, montantCentimes, aVenirNombre, aVenirMontantCentimes, zeroNombre } = recap.aFacturer;
  const aVenir = aVenirNombre > 0 ? `${pluriel(aVenirNombre, 'prestation', 'prestations')} à venir (${formatEuros(aVenirMontantCentimes)}) ${aVenirNombre > 1 ? 'seront' : 'sera'} à facturer plus tard.` : '';
  // La liste « à facturer » montre aussi les prestations à venir et celles à 0 € ; on le dit au lieu de laisser un écart inexpliqué.
  const zero = zeroNombre > 0 ? `${pluriel(zeroNombre, 'prestation', 'prestations')} à 0 € non facturée${zeroNombre > 1 ? 's ne sont pas comptées' : ' n\'est pas comptée'}.` : '';
  const complement = [aVenir, zero].filter(Boolean).join(' ');
  if (nombre === 0) {
    annoncerAFacturer('Tout est facturé.');
    return el(
      'div',
      { classe: 'alerte alerte--succes no-print' },
      el('div', { classe: 'alerte__corps' }, el('strong', { classe: 'alerte__titre', texte: 'Tout est facturé' }), complement ? el('p', { classe: 'alerte__texte', texte: complement }) : null),
    );
  }
  annoncerAFacturer(`À facturer : ${pluriel(nombre, 'prestation', 'prestations')}, ${formatEuros(montantCentimes)}.`);
  const totalListe = nombre + aVenirNombre + zeroNombre;
  const voirListe = el('a', {
    classe: 'btn btn--secondaire btn--petit',
    texte: 'Voir la liste',
    attributs: { href: '/prestations.html', ...(totalListe > nombre ? { 'aria-label': `Voir la liste : ${pluriel(totalListe, 'ligne', 'lignes')}, dont celles à venir ou à 0 €` } : {}) },
    evenements: {
      click: () => {
        // L'écran Prestations relit ses filtres dans sessionStorage : on y pose « à facturer, tous les mois ».
        try {
          sessionStorage.setItem(CLE_FILTRES_PRESTATIONS, JSON.stringify({ mois: '', statut: 'a_facturer', etat: '' }));
        } catch {
          // sans conséquence : la page s'ouvre avec ses filtres habituels
        }
      },
    },
  });
  return el(
    'div',
    { classe: 'alerte no-print' },
    el(
      'div',
      { classe: 'alerte__corps' },
      el('strong', { classe: 'alerte__titre', texte: 'À facturer, tous mois confondus' }),
      el('p', { classe: 'alerte__texte', texte: `${pluriel(nombre, 'prestation', 'prestations')} · ${formatEuros(montantCentimes)}${complement ? ` — ${complement}` : ''}` }),
      totalListe > nombre ? el('p', { classe: 'alerte__texte', texte: `« Voir la liste » affiche ${pluriel(totalListe, 'ligne', 'lignes')} : ces ${nombre}, plus celles à venir ou à 0 € ci-dessus.` }) : null,
    ),
    el('div', { classe: 'alerte__actions' }, voirListe),
  );
}

function rendre() {
  const recap = page.recap;
  const vide = recap.patients.length === 0;
  const parPrestation = recap.vue === 'prestation';

  const imprimer = el('button', { classe: 'btn btn--secondaire', texte: 'Imprimer', attributs: { type: 'button' }, evenements: { click: () => window.print() } });
  const copier = el('button', { classe: 'btn btn--primaire', texte: parPrestation ? 'Copier le récapitulatif' : 'Copier le récapitulatif (par date de prestation)', attributs: { type: 'button', disabled: parPrestation && vide } });
  copier.addEventListener('click', () => proteger(() => copierRecap(copier)));
  const nbMoisAFacturer = lignesAMarquerDuMois(recap.patients).length;
  const nbMoisAVenir = nbAVenirAFacturer(recap.patients);
  const toutFacture = el('button', {
    classe: 'btn btn--secondaire',
    texte: 'Marquer tout le mois facturé',
    attributs: {
      type: 'button',
      disabled: !page.ecriture || !parPrestation || nbMoisAFacturer === 0,
      title: parPrestation && nbMoisAVenir > 0 ? `${pluriel(nbMoisAFacturer, 'prestation', 'prestations')} concernée${nbMoisAFacturer > 1 ? 's' : ''} ; ${pluriel(nbMoisAVenir, 'prestation', 'prestations')} à venir exclue${nbMoisAVenir > 1 ? 's' : ''}.` : null,
    },
    evenements: { click: () => proteger(() => marquerFacture(toutesLesLignes(recap.patients), 'de ce mois')) },
  });
  const caseDetail = el('input', {
    attributs: { type: 'checkbox' },
    proprietes: { checked: page.detailImpression },
    evenements: {
      change: (evenement) => {
        page.detailImpression = evenement.target.checked;
        const tableau = document.querySelector('.recap');
        if (page.detailImpression) tableau?.setAttribute('data-impression-detail', 'oui');
        else tableau?.removeAttribute('data-impression-detail');
      },
    },
  });

  const outils = el('div', { classe: 'recap__outils' }, selecteurMois(recap), commutateurVue());
  const actions = el(
    'div',
    { classe: 'recap__outils' },
    el('div', { classe: 'recap__actions' }, copier, imprimer, toutFacture),
    el('label', { classe: 'case' }, caseDetail, el('span', { texte: 'Inclure le détail à l\'impression' })),
  );

  const noteVue = el('p', {
    classe: 'recap__note-vue no-print',
    texte: parPrestation
      ? 'Vue par date de prestation : prestations datées de ce mois ; « Payé » compte tout ce qui a été versé sur elles, quelle que soit la date du versement.'
      : 'Vue par date de versement (trésorerie) : « Encaissé » = versements datés de ce mois, y compris sur des prestations d\'autres mois ; « Dû » = prestations de ce mois. Pas de reste à payer dans cette vue.',
  });
  const titreImpression = el(
    'div',
    { classe: 'recap__titre-impression' },
    el('h1', { texte: `Facturation — ${formatMois(recap.mois)}` }),
    el('p', { texte: `Récapitulatif par patient (${parPrestation ? 'par date de prestation' : 'par date de versement'}) · imprimé le ${formatDate(recap.aujourdHui)}` }),
  );

  let corps;
  if (vide) {
    corps = el(
      'div',
      { classe: 'etat-vide' },
      el('p', { classe: 'etat-vide__titre', texte: parPrestation ? 'Aucune prestation ce mois-ci' : 'Aucune prestation ni versement ce mois-ci' }),
      el('p', { classe: 'etat-vide__texte', texte: 'Choisissez un autre mois ou ajoutez une prestation.' }),
      el('div', { classe: 'etat-vide__actions' }, saisieImpossible(page.catalogue) ? el('a', { classe: 'btn btn--primaire', texte: 'Définir mes prestations et tarifs', attributs: { href: LIEN_TARIFS } }) : el('a', { classe: 'btn btn--primaire', texte: 'Ajouter une prestation', attributs: { href: '/prestations.html' } })),
    );
  } else {
    const tableau = construireTableau(recap, {
      ouverts: page.ouverts,
      detailImpression: page.detailImpression,
      recent: page.recent,
      ecriture: page.ecriture,
      actions: {
        basculer: (id) => {
          if (page.ouverts.has(id)) page.ouverts.delete(id);
          else page.ouverts.add(id);
          rendre();
          document.querySelector(`[aria-controls="detail-${CSS.escape(id)}"]`)?.focus();
        },
        marquerFacture: (e) => proteger(() => marquerFacture(e.lignes, `de ${nomPatient(e.patient)}`)),
        copierDetail,
        basculerStatut: (l) => proteger(() => basculerStatut(l)),
        payer: (l) => proteger(() => payer(l)),
        versement: (l) => proteger(() => ajouterVersement(l)),
        modifier: (l) => proteger(() => modifier(l)),
      },
    });
    page.recent = null;
    corps = el('div', { classe: 'table-wrap', attributs: { role: 'region', 'aria-label': `Récapitulatif par patient, ${formatMois(recap.mois)}`, tabindex: '0' } }, tableau);
  }

  const note = el('p', { classe: 'recap__note-vue no-print', texte: 'Séances = prestations de catégorie « Séance » ; les autres catégories (bilan, autre) sont dans « Autres ».' });
  const pied = el('p', { classe: 'recap__pied-impression', texte: 'Séances = prestations de catégorie « Séance » ; les autres catégories (bilan, autre) sont comptées dans « Autres ».' });
  remplacer(zone.contenu, titreImpression, outils, indicateurAFacturer(recap), actions, noteVue, corps, vide ? null : note, pied);
  if (vide) remplacerSiFichierVide(corps, { ajouter: true, catalogue: page.catalogue }); // premier démarrage : accueil explicite (fichier sans aucune prestation)
}

// ---------------------------------------------------------------- Démarrage

async function demarrer() {
  const zoneBandeaux = document.getElementById('bandeaux');
  zone.contenu = document.getElementById('zone');
  try {
    const etat = await lireEtat();
    afficherBandeaux(zoneBandeaux, etat);
    page.alerteSauvegarde = (etat.avertissements ?? []).some((a) => a.code === 'SAUVEGARDE_ECHOUEE');
    page.ecriture = ecritureAutorisee(etat);
    if (etat.modeDegrade) {
      await afficherEcranDegrade(zone.contenu, etat);
      return;
    }
    page.dernierMode.valeur = etat.dernierModePaiement ?? null;
    page.catalogue = (await appeler('GET', '/api/catalogue')).catalogue;
    const memoire = lireMemoire();
    if (memoire && /^\d{4}-\d{2}$/.test(memoire.mois ?? '')) page.mois = memoire.mois;
    await charger();
    // Page laissée ouverte, ou données modifiées dans un autre onglet : rechargement au retour sur l'onglet.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !page.occupe) charger().catch(() => {});
    });
  } catch (err) {
    remplacer(zoneBandeaux, alerte('danger', 'Erreur', err.message, 'alert'));
    remplacer(zone.contenu);
  }
}

demarrer();

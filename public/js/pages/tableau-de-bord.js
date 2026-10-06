// Écran « Tableau de bord » (CA, séances, répartition, impayés) : CA par mois empilé, séances, répartition par type, impayés par ancienneté.
// Le serveur calcule (GET /api/indicateurs/*, centimes entiers) ; ici on dessine. Chaque section se charge seule : une section en erreur
// n'empêche pas l'affichage des autres. Aucune donnée nominative (ni dans l'URL, ni dans le titre, ni dans le stockage du navigateur).
import { ErreurApi, appeler, lireEtat } from '/js/api.js';
import { afficherBandeaux, alerte } from '/js/bandeaux.js';
import { el, remplacer } from '/js/dom.js';
import { afficherEcranDegrade } from '/js/ecran-degrade.js';
import { previsionPerimee } from '/js/graphiques/prevision-ca.js';
import { PERIODES, PERIODE_DEFAUT, plagePeriode } from '/js/periodes.js';
import { carteErreur, sectionCa, sectionImpayes, sectionIndicateurs, sectionRepartition, sectionSeances } from '/js/pages/tdb-sections.js';

const page = { periode: PERIODE_DEFAUT, vueCa: 'prestation', granularite: 'mois', aujourdHui: '' };
const zones = {}; // nom de section -> élément actuellement affiché
const numeros = {}; // nom de section -> numéro de la dernière requête (une réponse tardive n'écrase pas une plus récente)

const plage = () => plagePeriode(page.periode, page.aujourdHui);
const parametres = (extra = {}) => new URLSearchParams({ ...plage(), ...extra });

/** Remplace l'élément affiché d'une section ; `focus` : sélecteur de l'élément à refocaliser (l'ancien a disparu avec le contenu). */
function afficher(nom, noeud, focus) {
  zones[nom].replaceWith(noeud);
  zones[nom] = noeud;
  if (focus) noeud.querySelector(focus)?.focus();
}

const emplacement = (classe) => el('section', { classe: `carte ${classe}`.trim() }, el('p', { classe: 'chargement', texte: 'Chargement…', attributs: { role: 'status' } }));

/** Charge une section : `construire(donnees)` -> élément ; toute erreur devient une carte d'erreur, les autres sections continuent. */
async function charger(nom, chemin, construire, titreErreur, classesErreur = '', focus) {
  const numero = (numeros[nom] = (numeros[nom] ?? 0) + 1);
  try {
    const donnees = await appeler('GET', chemin);
    if (numero !== numeros[nom]) return;
    const noeud = await construire(donnees); // asynchrone pour le CA : la prévision est demandée à part, son échec n'empêche pas le graphique
    if (numero !== numeros[nom]) return;
    afficher(nom, noeud, focus);
  } catch (err) {
    if (numero !== numeros[nom]) return;
    const message = err instanceof ErreurApi ? err.message : 'Cette section ne peut pas être affichée.';
    afficher(nom, carteErreur(titreErreur, message, classesErreur));
  }
}

const chargerIndicateurs = () => charger('indicateurs', '/api/indicateurs/synthese', sectionIndicateurs, 'Indicateurs du mois');
const chargerCa = (focus) => charger('ca', `/api/indicateurs/ca-mensuel?${parametres({ vue: page.vueCa })}`, composerCa, "Chiffre d'affaires par mois", '', focus);

/** Section du CA avec sa prévision. Si leurs dates « aujourd'hui » diffèrent (minuit passé entre les deux lectures), une seule relecture ; sinon, sans estimation. */
async function composerCa(d) {
  let ca = d;
  let prevision = await lirePrevision(ca);
  if (previsionPerimee(ca, prevision)) {
    ca = await appeler('GET', `/api/indicateurs/ca-mensuel?${parametres({ vue: page.vueCa })}`);
    prevision = await lirePrevision(ca);
    if (previsionPerimee(ca, prevision)) prevision = null;
  }
  return sectionCa(ca, plage(), prevision);
}

/**
 * Prévision, vue « dû par date de prestation » seulement : { donnees, futurs } ou { erreur } ; null si non applicable.
 * `futurs` = CA déjà saisi des mois suivants (séances planifiées, acomptes) pour poser la série « prévu » sur les mêmes barres.
 */
async function lirePrevision(d) {
  if (d.vue !== 'prestation' || d.total.nombre === 0) return null;
  try {
    const donnees = await appeler('GET', '/api/indicateurs/prevision');
    const suivants = donnees.suffisant ? donnees.mois.filter((m) => !m.courant) : [];
    if (suivants.length === 0 || d.a !== donnees.aujourdHui.slice(0, 7)) return { donnees, futurs: null };
    const futurs = await appeler('GET', `/api/indicateurs/ca-mensuel?${new URLSearchParams({ de: suivants[0].mois, a: suivants.at(-1).mois, vue: 'prestation' })}`);
    return { donnees, futurs };
  } catch (err) {
    return { erreur: err instanceof ErreurApi ? err.message : "L'estimation ne peut pas être affichée." };
  }
}
const chargerSeances = (focus) =>
  charger('seances', `/api/indicateurs/seances?${parametres({ granularite: page.granularite })}`, (d) => sectionSeances(d, plage(), choisirGranularite), 'Séances', 'tdb-moitie', focus);
const chargerRepartition = () => charger('repartition', `/api/indicateurs/repartition?${parametres()}`, (d) => sectionRepartition(d, plage()), 'Répartition par prestation', 'tdb-moitie');
const chargerImpayes = () => charger('impayes', '/api/indicateurs/impayes', sectionImpayes, 'Reste à encaisser par ancienneté', 'tdb-moitie');

function choisirGranularite(valeur) {
  if (valeur === page.granularite) return;
  page.granularite = valeur;
  chargerSeances('.segment__bouton[aria-pressed="true"]');
}

function choisirVueCa(valeur) {
  if (valeur === page.vueCa) return;
  page.vueCa = valeur;
  for (const bouton of document.querySelectorAll('[data-vue-ca]')) bouton.setAttribute('aria-pressed', String(bouton.dataset.vueCa === valeur));
  chargerCa();
}

function outils() {
  const select = el(
    'select',
    { classe: 'input', attributs: { id: 'tdb-periode' }, evenements: { change: (evenement) => {
      page.periode = evenement.target.value;
      chargerCa();
      chargerSeances();
      chargerRepartition();
    } } },
    ...PERIODES.map((p) => el('option', { texte: p.libelle, attributs: { value: p.id, selected: p.id === page.periode } })),
  );
  const vue = (valeur, libelle) => el('button', { classe: 'segment__bouton', texte: libelle, attributs: { type: 'button', 'data-vue-ca': valeur, 'aria-pressed': String(page.vueCa === valeur) }, evenements: { click: () => choisirVueCa(valeur) } });
  return el(
    'div',
    { classe: 'tdb-outils no-print' },
    el('div', { classe: 'champ' }, el('label', { classe: 'champ__label', texte: 'Période', attributs: { for: 'tdb-periode' } }), select),
    el(
      'div',
      { classe: 'champ' },
      el('span', { classe: 'champ__label', texte: 'Vue du chiffre d\'affaires', attributs: { id: 'tdb-vue-libelle' } }),
      el('div', { classe: 'segment', attributs: { role: 'group', 'aria-labelledby': 'tdb-vue-libelle' } }, vue('prestation', 'Dû par date de prestation'), vue('versement', 'Encaissé par date de versement')),
    ),
  );
}

function construirePage(zone) {
  zones.indicateurs = emplacement('');
  zones.ca = emplacement('');
  zones.seances = emplacement('tdb-moitie');
  zones.repartition = emplacement('tdb-moitie');
  zones.impayes = emplacement('tdb-moitie');
  remplacer(zone, outils(), zones.indicateurs, el('div', { classe: 'tdb-grille' }, zones.ca, zones.seances, zones.impayes, zones.repartition));
  const imprimer = el('button', { classe: 'btn btn--secondaire', texte: 'Imprimer', attributs: { type: 'button' }, evenements: { click: () => window.print() } });
  document.querySelector('.page-titre').append(el('div', { classe: 'page-actions no-print' }, imprimer));
}

/** Impression : le contenu d'un <details> fermé n'est pas rendu, quel que soit son style. On déplie « Voir les chiffres » le temps de l'impression. */
let tableauxDeplies = [];
window.addEventListener('beforeprint', () => {
  tableauxDeplies = [...document.querySelectorAll('details.graphe__tableau:not([open])')];
  for (const d of tableauxDeplies) d.open = true;
});
window.addEventListener('afterprint', () => {
  for (const d of tableauxDeplies) d.open = false;
  tableauxDeplies = [];
});

function accueilVide() {
  return el(
    'div',
    { classe: 'etat-vide' },
    el('p', { classe: 'etat-vide__titre', texte: 'Pas encore de données à afficher' }),
    el('p', { classe: 'etat-vide__texte', texte: 'Le tableau de bord se remplit dès que des prestations sont enregistrées : chiffre d\'affaires par mois, séances, répartition par prestation et impayés.' }),
    el('div', { classe: 'etat-vide__actions' }, el('a', { classe: 'btn btn--primaire', texte: 'Ajouter une prestation', attributs: { href: '/prestations.html' } })),
  );
}

function tout() {
  return Promise.all([chargerIndicateurs(), chargerCa(), chargerSeances(), chargerRepartition(), chargerImpayes()]);
}

async function demarrer() {
  const zoneBandeaux = document.getElementById('bandeaux');
  const zone = document.getElementById('zone');
  try {
    const etat = await lireEtat();
    afficherBandeaux(zoneBandeaux, etat);
    if (etat.modeDegrade) {
      await afficherEcranDegrade(zone, etat);
      return;
    }
    page.aujourdHui = etat.aujourdHui;
    if (etat.nombrePrestations === 0) {
      remplacer(zone, accueilVide());
      return;
    }
    construirePage(zone);
    await tout();
    // Page laissée ouverte, ou données modifiées dans un autre onglet : rechargement au retour sur l'onglet.
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        page.aujourdHui = (await lireEtat()).aujourdHui;
      } catch {
        return;
      }
      tout();
    });
  } catch (err) {
    remplacer(zoneBandeaux, alerte('danger', 'Erreur', err.message, 'alert'));
    remplacer(zone);
  }
}

demarrer();

// Sections du tableau de bord : construisent le DOM à partir des réponses de /api/indicateurs/*. Aucun calcul métier ici :
// le serveur calcule (centimes entiers), on ne fait que mettre en forme. Textes de données par textContent uniquement.
import { alerte } from '/js/bandeaux.js';
import { el } from '/js/dom.js';
import { LIBELLES_SERIES_CA, LIBELLE_A_FACTURER, LIBELLE_SERIE_PREVU, formatDate, formatEuros, formatMois, libelleDontNonFactures, nomLienTranche, pluriel } from '/js/format.js';
import { listeBarresH } from '/js/graphiques/barres-h.js';
import { graphiqueBarres } from '/js/graphiques/barres-svg.js';
import { formatEurosCourt, libelleSemaine, moisCourt } from '/js/graphiques/mise-en-page.js';
import { LIBELLE_DONT_PLANIFIE, LIBELLE_ESTIMATION_MOIS, LIBELLE_PREVU_TABLEAU, LIBELLE_TOTAL_HORS_PREVU, MENTION_ESTIME, MENTION_PARTIEL, NOTE_VUE_ENCAISSE, composerMois, composerPrevision, noteMethode, phrasePremiereEstimation } from '/js/graphiques/prevision-ca.js';
import { formaterPlage } from '/js/periodes.js';

const pourcent = (pourMille) => `${(pourMille / 10).toFixed(1).replace('.', ',')} %`;
const somme = (liste, cle) => liste.reduce((s, x) => s + x[cle], 0);

/** Carte en erreur : les autres sections restent affichées. */
export function carteErreur(titre, message, classes = '') {
  return el('section', { classe: `carte tdb-section-erreur ${classes}`.trim(), attributs: { 'aria-label': titre } }, el('h2', { classe: 'carte__titre', texte: titre }), alerte('attention', 'Section non affichée', message, 'status'));
}

function etatVide(titre, texte) {
  return el('div', { classe: 'etat-vide' }, el('p', { classe: 'etat-vide__titre', texte: titre }), texte ? el('p', { classe: 'etat-vide__texte', texte }) : null);
}

/** Enveloppe d'une section : carte + titre de niveau 2 (les figures portent leur propre titre, voir `carteFigure`). */
let compteurCartes = 0;
function carte(titre, classes, ...contenu) {
  const id = `tdb-carte-${++compteurCartes}`;
  return el('section', { classe: `carte ${classes}`.trim(), attributs: { 'aria-labelledby': id } }, el('div', { classe: 'carte__entete' }, el('h2', { classe: 'carte__titre', texte: titre, attributs: { id } })), ...contenu);
}

/** Carte contenant une figure dont le titre (h2) sert de titre de section, ou un état vide sous un titre h2. */
function carteFigure(classes, figureOuTitre) {
  return el('section', { classe: `carte ${classes}`.trim() }, figureOuTitre);
}

// ------------------------------------------------------------------ Indicateurs de tête

function kpi(serie, libelle, valeur, ...details) {
  return el('div', { classe: 'kpi', attributs: { 'data-serie': serie } }, el('p', { classe: 'kpi__libelle', texte: libelle }), el('p', { classe: 'kpi__valeur', texte: valeur }), ...details.filter(Boolean).map((d) => el('p', { classe: 'kpi__detail', texte: d })));
}

export function sectionIndicateurs(s) {
  const { resteAEncaisser: reste, aFacturer, caMois, seancesMois } = s;
  const aVenir = aFacturer.aVenirNombre > 0 ? `${pluriel(aFacturer.aVenirNombre, 'prestation')} à venir (${formatEuros(aFacturer.aVenirMontantCentimes)}) en plus` : '';
  return el(
    'section',
    { classe: 'grille-cartes', attributs: { 'aria-label': `Indicateurs de ${formatMois(s.mois)}` } },
    kpi('attente', 'Reste à encaisser', formatEuros(reste.montantCentimes), reste.nombre === 0 ? 'Rien en attente de paiement' : `Reste à payer, facturé ou non : ${pluriel(reste.nombre, 'prestation')} (hors prestations à venir non facturées)`, libelleDontNonFactures(reste.resteNonFactureCentimes)),
    kpi('a-facturer', LIBELLE_A_FACTURER, formatEuros(aFacturer.montantCentimes), `${pluriel(aFacturer.nombre, 'prestation')}, acomptes compris`, aVenir),
    kpi('paye', 'CA du mois (dû)', formatEuros(caMois.totalCentimes), formatMois(s.mois), `dont payé : ${formatEuros(caMois.payeCentimes)}`, caMois.aVenirCentimes > 0 ? `dont à venir : ${formatEuros(caMois.aVenirCentimes)}` : ''),
    kpi('neutre', 'Séances du mois', String(seancesMois.realisees), formatMois(s.mois), seancesMois.aVenir > 0 ? `+ ${seancesMois.aVenir} à venir` : '', seancesMois.autres > 0 ? `+ ${pluriel(seancesMois.autres, 'autre prestation', 'autres prestations')} (catégories bilan et autre)` : 'Prestations de catégorie « Séance » uniquement'),
  );
}

// ------------------------------------------------------------------ CA par mois

function categorieMois(m, indice, moisCourant) {
  return { libelle: moisCourt(m.mois), annee: indice === 0 || m.mois.endsWith('-01') ? m.mois.slice(0, 4) : null, libelleLong: formatMois(m.mois), courante: m.mois === moisCourant };
}

export function sectionCa(d, plage, prevision = null) {
  const parPrestation = d.vue === 'prestation';
  const moisCourant = d.aujourdHui.slice(0, 7);
  const periode = formaterPlage(plage, formatMois);
  const titre = parPrestation ? "Chiffre d'affaires par mois" : 'Encaissé par mois (date de versement)';
  if (d.total.nombre === 0) {
    return carteFigure('', el('div', { classe: 'pile' }, el('h2', { classe: 'graphe__titre', texte: titre }), etatVide(parPrestation ? 'Aucune prestation sur cette période' : 'Aucun versement sur cette période', "Choisissez une autre période, ou ajoutez des prestations dans l'écran Prestations.")));
  }

  if (!parPrestation) {
    const crete = d.mois.reduce((a, b) => (b.encaisseCentimes > a.encaisseCentimes ? b : a));
    const figureEncaisse = graphiqueBarres({
        titre,
        sousTitre: `Encaissé par date de versement, ${periode} : ne se compare pas au CA dû. Montants en euros.`,
        description: `Barres par mois, ${periode}. Total encaissé : ${formatEuros(d.total.encaisseCentimes)}. Mois le plus élevé : ${formatMois(crete.mois)}, ${formatEuros(crete.encaisseCentimes)}.`,
        series: [{ cle: 'paye', libelle: 'Encaissé' }],
        categories: d.mois.map((m, i) => ({ ...categorieMois(m, i, moisCourant), valeurs: [m.encaisseCentimes] })),
        format: formatEuros,
        formatCourt: formatEurosCourt,
        pasMin: 100,
        tableau: {
          entetes: ['Mois', 'Encaissé', 'Versements'],
          lignes: d.mois.map((m) => [formatMois(m.mois), formatEuros(m.encaisseCentimes), String(m.nombre)]),
          pied: ['Total de la période', formatEuros(d.total.encaisseCentimes), String(d.total.nombre)],
        },
      });
    return carteFigure('', el('div', { classe: 'pile' }, figureEncaisse, el('p', { classe: 'carte__note', texte: NOTE_VUE_ENCAISSE })));
  }

  // Série « prévu » : seulement si le serveur a pu estimer (historique suffisant) ET si la période inclut le mois en cours.
  // La composition (prévu = estimation - hauteur des barres, sans double comptage) est dans prevision-ca.js, pure et testée.
  const composes = composerPrevision(d.mois, prevision, d.a === moisCourant);
  const estimation = composes !== null;
  const lignesCa = composes ?? d.mois.map((m) => composerMois(m));
  const avecAVenir = lignesCa.some((l) => l.source.aVenirCentimes > 0);
  const avecTropPercu = d.total.tropPercuCentimes > 0;
  const crete = lignesCa.filter((l) => d.mois.includes(l.source)).reduce((a, b) => (b.empile > a.empile ? b : a));
  const libelleMois = (l) => (l.courant ? `${formatMois(l.mois)} (en cours, en partie estimé)` : l.estime ? `${formatMois(l.mois)} (estimé)` : formatMois(l.mois));
  const cumul = composerMois(d.total);

  // Tableau. Sans estimation : « à venir non facturé » est hors barres. Avec estimation : ce reste à payer est dans la barre « prévu »,
  // donc une seule colonne « dont séances déjà planifiées » (jamais plus grande que le prévu) à côté du complément estimé.
  const entetes = ['Mois', ...Object.values(LIBELLES_SERIES_CA), estimation ? LIBELLE_TOTAL_HORS_PREVU : avecAVenir ? 'Total des barres' : 'Total'];
  if (!estimation && avecAVenir) entetes.push('À venir, non facturé (hors barres)');
  if (avecAVenir) entetes.push('Total du mois (dû)');
  if (avecTropPercu) entetes.push('Trop-perçu (hors total)');
  if (estimation) entetes.push(LIBELLE_PREVU_TABLEAU, ...(avecAVenir ? [LIBELLE_DONT_PLANIFIE] : []), LIBELLE_ESTIMATION_MOIS);
  const ligne = (l, libelle, avecEstimation) => [
    libelle,
    ...l.barres.map(formatEuros),
    formatEuros(l.empile),
    ...(!estimation && avecAVenir ? [formatEuros(l.source.aVenirCentimes)] : []),
    ...(avecAVenir ? [formatEuros(l.source.totalCentimes)] : []),
    ...(avecTropPercu ? [formatEuros(l.source.tropPercuCentimes)] : []),
    ...(estimation ? (avecEstimation && l.estime ? [formatEuros(l.prevu), ...(avecAVenir ? [formatEuros(l.dontPlanifieCentimes)] : []), formatEuros(l.estimationCentimes)] : Array(avecAVenir ? 3 : 2).fill('—')) : []),
  ];
  const nombreFuturs = lignesCa.length - d.mois.length;

  const figure = graphiqueBarres({
    titre,
    badge: estimation ? 'Estimation indicative' : null,
    sousTitre: `Par date de prestation, ${periode}${estimation ? ' et les 3 mois suivants (estimés)' : ''}. Montants en euros. Les barres « facturé en attente » et « à facturer » montrent le reste à payer (acomptes déduits). Un versement compte comme payé pour sa part, même sur une prestation à venir.${avecAVenir ? (estimation ? ' Le reste à payer des prestations à venir non facturées est compris dans la barre « prévu ».' : " Le reste à payer des prestations à venir non facturées n'est pas dans les barres : il figure dans le tableau et l'info-bulle.") : ''}${estimation ? ' Estimation indicative : moyenne des 3 derniers mois et séances déjà planifiées. Les barres en tirets sont une estimation, pas des montants dus.' : ''}`,
    description: `Barres empilées par mois, ${periode} : payé, facturé en attente (reste à payer), à facturer (reste à payer). Total des barres : ${formatEuros(cumul.empile)}. Mois le plus élevé : ${formatMois(crete.mois)}, ${formatEuros(crete.empile)}.${estimation ? ' Le mois en cours et les 3 suivants comportent une estimation indicative en tirets (moyenne des 3 derniers mois et séances déjà planifiées).' : ''}`,
    series: [
      { cle: 'paye', libelle: LIBELLES_SERIES_CA.paye },
      { cle: 'attente', libelle: LIBELLES_SERIES_CA.attente },
      { cle: 'a-facturer', libelle: LIBELLES_SERIES_CA.aFacturer },
      ...(estimation ? [{ cle: 'prevu', libelle: LIBELLE_SERIE_PREVU }] : []),
    ],
    categories: lignesCa.map((l, i) => {
      let extras = [];
      if (l.estime) extras = [{ libelle: LIBELLE_DONT_PLANIFIE, texte: formatEuros(l.dontPlanifieCentimes) }]; // déjà compris dans le prévu
      else if (l.source.aVenirCentimes > 0) extras = [{ libelle: 'À venir, non facturé (hors barres)', texte: formatEuros(l.source.aVenirCentimes) }];
      return { ...categorieMois(l.source, i, moisCourant), mention: l.courant ? MENTION_PARTIEL : l.estime ? MENTION_ESTIME : null, libelleLong: libelleMois(l), valeurs: [...l.barres, ...(estimation ? [l.prevu] : [])], extras };
    }),
    format: formatEuros,
    formatCourt: formatEurosCourt,
    pasMin: 100,
    largeurEtiquette: estimation ? 56 : 44,
    nomTotal: estimation ? 'total (prévu compris)' : avecAVenir ? 'total des barres' : 'total',
    tableau: {
      entetes,
      lignes: lignesCa.map((l) => ligne(l, libelleMois(l), true)),
      pied: ligne(cumul, nombreFuturs > 0 ? 'Total de la période (mois à venir exclus)' : 'Total de la période', false),
    },
  });
  return carteFigure('', el('div', { classe: 'pile' }, figure, notePrevision(prevision, d, moisCourant)));
}

/** Message sous le graphique : méthode, ou raison pour laquelle l'estimation n'est pas affichée (historique insuffisant : état normal d'un début d'activité ; erreur ; période sans mois en cours). */
function notePrevision(prevision, d, moisCourant) {
  if (!prevision) return null;
  if (prevision.erreur) return alerte('attention', 'Estimation non affichée', prevision.erreur, 'status');
  const p = prevision.donnees;
  if (!p.suffisant) {
    const deja = p.moisComplets > 0 ? ` ${pluriel(p.moisComplets, 'mois complet', 'mois complets')} de données jusqu'ici.` : '';
    const quand = phrasePremiereEstimation(p.premiereEstimationLe);
    return etatVide(
      "Estimation indicative : pas assez d'historique pour le moment",
      `Il faut au moins ${p.fenetre} mois complets de données pour estimer le chiffre d'affaires à venir (moyenne des ${p.fenetre} derniers mois et séances déjà planifiées) ; ${p.moisManquants} ${p.moisManquants > 1 ? 'mois manquants' : 'mois manquant'}.${deja}${quand ? ` ${quand}` : ''} Aucun chiffre n'est avancé tant que l'historique est trop court.`,
    );
  }
  if (d.a !== moisCourant) return el('p', { classe: 'carte__note', texte: "L'estimation indicative ne s'affiche que pour une période qui inclut le mois en cours." });
  return el('p', { classe: 'carte__note', texte: noteMethode(p.fenetre) });
}

// ------------------------------------------------------------------ Séances

export function sectionSeances(d, plage, choisirGranularite) {
  const parSemaine = d.granularite === 'semaine';
  const periode = formaterPlage(plage, formatMois);
  const titre = 'Séances';
  const commutateur = el(
    'div',
    { classe: 'segment', attributs: { role: 'group', 'aria-label': 'Regroupement des séances' } },
    ...[['mois', 'Par mois'], ['semaine', 'Par semaine']].map(([valeur, libelle]) => el('button', { classe: 'segment__bouton', texte: libelle, attributs: { type: 'button', 'aria-pressed': String(d.granularite === valeur) }, evenements: { click: () => choisirGranularite(valeur) } })),
  );
  const entete = el('div', { classe: 'tdb-outils' }, commutateur);
  if (d.total.total === 0 && d.total.autres === 0) {
    return carteFigure('tdb-moitie', el('div', { classe: 'pile' }, el('h2', { classe: 'graphe__titre', texte: titre }), entete, etatVide('Aucune séance sur cette période', 'Les prestations de catégorie « Séance » enregistrées dans Prestations apparaîtront ici.')));
  }

  const moisCourant = d.aujourdHui.slice(0, 7);
  const semaineCourante = d.periodes.find((p) => p.debut <= d.aujourdHui && d.aujourdHui <= finSemaine(p.debut))?.periode;
  const categories = d.periodes.map((p, i) => {
    if (!parSemaine) return { ...categorieMois({ mois: p.periode }, i, moisCourant), valeurs: [p.realisees, p.aVenir], extras: [{ libelle: 'Autres prestations', texte: String(p.autres) }] };
    return {
      libelle: libelleSemaine(p.periode),
      annee: i === 0 || p.periode.endsWith('-W01') ? p.periode.slice(0, 4) : null,
      libelleLong: `Semaine ${p.periode.slice(-2)} (du ${formatDate(p.debut)})${p.partielle ? ', partielle' : ''}`,
      courante: p.periode === semaineCourante,
      valeurs: [p.realisees, p.aVenir],
      extras: [{ libelle: 'Autres prestations', texte: String(p.autres) }],
    };
  });
  const libelleLigne = (p) => (parSemaine ? `${libelleSemaine(p.periode, true)} (du ${formatDate(p.debut)})${p.partielle ? ', partielle' : ''}` : formatMois(p.periode));
  const crete = d.periodes.reduce((a, b) => (b.total > a.total ? b : a));
  const figure = graphiqueBarres({
    titre,
    sousTitre: `Prestations de catégorie « Séance » par ${parSemaine ? 'semaine ISO (lundi à dimanche ; une semaine à cheval sur deux mois est comptée une fois)' : 'mois'}, ${periode}. Les autres catégories (bilan, autre) ne sont pas comptées.`,
    description: `Barres par ${parSemaine ? 'semaine' : 'mois'}, ${periode}. ${d.total.realisees} séances réalisées${d.total.aVenir ? `, ${d.total.aVenir} à venir` : ''}. Période la plus chargée : ${libelleLigne(crete)}, ${crete.total}.`,
    series: [
      { cle: 'neutre', libelle: 'Séances réalisées' },
      { cle: 'prevu', libelle: 'Séances à venir' },
    ],
    categories,
    format: String,
    formatCourt: String,
    pasMin: 1,
    largeurValeur: 22,
    largeurEtiquette: parSemaine ? 30 : 44,
    nomTotal: 'total séances',
    outils: entete,
    tableau: {
      entetes: [parSemaine ? 'Semaine' : 'Mois', 'Réalisées', 'À venir', 'Total séances', 'Autres prestations'],
      lignes: d.periodes.map((p) => [libelleLigne(p), String(p.realisees), String(p.aVenir), String(p.total), String(p.autres)]),
      pied: ['Total de la période', String(d.total.realisees), String(d.total.aVenir), String(d.total.total), String(d.total.autres)],
    },
  });
  const note = parSemaine && d.periodes.some((p) => p.partielle) ? el('p', { classe: 'carte__note', texte: 'Les semaines des bords de la période sont partielles : seuls les jours de la période sont comptés.' }) : null;
  return carteFigure('tdb-moitie', el('div', { classe: 'pile' }, figure, note));
}

/** Dimanche de la semaine qui commence le lundi `debut` (AAAA-MM-JJ). */
function finSemaine(debut) {
  const [a, m, j] = debut.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, j + 6));
  return `${String(f.getUTCFullYear()).padStart(4, '0')}-${String(f.getUTCMonth() + 1).padStart(2, '0')}-${String(f.getUTCDate()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ Répartition

export function sectionRepartition(d, plage) {
  const titre = 'Répartition du chiffre d\'affaires par prestation';
  const periode = formaterPlage(plage, formatMois);
  if (d.types.length === 0) return carte(titre, 'tdb-moitie', etatVide('Aucune prestation sur cette période', 'Choisissez une autre période.'));
  const items = d.types.map((t) => ({
    libelle: t.libelle,
    valeur: formatEuros(t.caCentimes),
    detail: `${pourcent(t.partPourMille)} · ${pluriel(t.nombre, 'prestation')}`,
    part: t.partPourMille / 10,
  }));
  return carte(
    titre,
    'tdb-moitie',
    el('p', { classe: 'carte__note', texte: `Chiffre d'affaires dû par date de prestation, ${periode}, prestations à venir comprises.` }),
    listeBarresH(items),
    el('p', { classe: 'carte__note', texte: `Total : ${formatEuros(d.totalCentimes)} (${pluriel(d.nombre, 'prestation')}).` }),
  );
}

// ------------------------------------------------------------------ Impayés

export function sectionImpayes(d) {
  const titre = 'Reste à encaisser par ancienneté';
  if (d.nombre === 0) return carte(titre, 'tdb-moitie', el('div', { classe: 'etat-vide etat-vide--positif' }, el('p', { classe: 'etat-vide__titre', texte: 'Aucun impayé' }), el('p', { classe: 'etat-vide__texte', texte: 'Toutes les prestations échues sont soldées.' })));
  const maximum = Math.max(...[...d.factures, ...d.nonFactures].map((t) => t.resteCentimes), 1);
  const groupe = (statut, tranches, serie, titreGroupe, note, nomGroupe) =>
    el(
      'div',
      { classe: 'pile pile--s' },
      el('h3', { classe: 'carte__titre', texte: `${titreGroupe} : ${formatEuros(somme(tranches, 'resteCentimes'))} (reste à payer)` }),
      el('p', { classe: 'carte__note', texte: note }),
      listeBarresH(
        tranches.map((t) => ({
          libelle: t.libelle,
          valeur: formatEuros(t.resteCentimes),
          detail: pluriel(t.nombre, 'prestation'),
          part: (t.resteCentimes / maximum) * 100,
          serie,
          // Clic sur une tranche : la liste des prestations concernées (filtre de l'écran Prestations, sans nom de patient dans l'URL).
          href: t.nombre > 0 ? `/prestations.html?statut=${statut}&anciennete=${t.tranche}` : null,
          aria: t.nombre > 0 ? nomLienTranche(nomGroupe, t) : null,
        })),
      ),
    );
  return carte(
    titre,
    'tdb-moitie',
    el('p', { classe: 'kpi__valeur', texte: formatEuros(d.totalResteCentimes) }),
    el('p', { classe: 'carte__note', texte: `${pluriel(d.nombre, 'prestation')} échue${d.nombre > 1 ? 's' : ''} non soldée${d.nombre > 1 ? 's' : ''} (toutes périodes ; les prestations à venir non facturées ne sont pas comptées). Montants : reste à payer, acomptes déduits.` }),
    groupe('facture', d.factures, 'attente', 'Facturées, à relancer', 'Ancienneté depuis la date de facturation. Cliquez sur une ligne pour voir la liste.', 'Facturées'),
    groupe('a_facturer', d.nonFactures, 'a-facturer', 'À facturer, pas encore relançable', 'Ancienneté depuis la date de prestation : à facturer avant toute relance.', 'À facturer'),
  );
}

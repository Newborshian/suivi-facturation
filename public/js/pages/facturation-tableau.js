// Tableau « Facturation du mois » : une ligne par patient, détail dépliable, ligne de total.
// Construction du DOM par textContent uniquement (dom.js) ; aucune donnée n'est injectée comme HTML.
import { el } from '/js/dom.js';
import { lignesAMarquer } from '/js/recap-regles.js';
import { LIBELLES_ETAT, LIBELLES_MODE, LIBELLES_STATUT, formatDate, formatDateCourte, formatEuros, formatMois, nomPatient, pluriel } from '/js/format.js';

const bouton = (texte, classe, auClic, { desactive = false, label } = {}) =>
  el('button', { classe: `btn ${classe}`, texte, attributs: { type: 'button', disabled: desactive, 'aria-label': label }, evenements: { click: auClic } });

const montant = (centimes, { reste = false } = {}) => el('span', { classe: centimes === 0 ? 'montant montant--zero' : reste ? 'montant montant--reste' : 'montant', texte: formatEuros(centimes) });
const badgeEtat = (etat) => el('span', { classe: 'badge', texte: LIBELLES_ETAT[etat], attributs: { 'data-etat': etat } });
const idDetail = (patientId) => `detail-${patientId}`;

/** Cellule d'état : badge d'état dérivé des totaux + badge « Trop-perçu » séparé (jamais compensé avec une autre ligne). */
function celluleEtat(e, vue) {
  if (vue === 'versement') return el('td', { classe: 'col-etat-paiement' });
  return el(
    'td',
    { classe: 'col-etat-paiement' },
    badgeEtat(e.etat),
    e.tropPercuCentimes > 0 ? el('span', { classe: 'badge badge--attention', texte: `Trop-perçu ${formatEuros(e.tropPercuCentimes)}` }) : null,
  );
}

/** Détail des prestations du mois d'un patient, avec les actions modifier et versement sans quitter l'écran. */
function tableauLignes(e, { aujourdHui, ecriture, actions }) {
  const annee = aujourdHui.slice(0, 4);
  const lignes = e.lignes.map((l) => {
    const nom = nomPatient(l.patient);
    const designation = `la prestation du ${formatDate(l.date)} de ${nom}`;
    const statut = el('button', {
      classe: 'badge btn-statut',
      texte: LIBELLES_STATUT[l.statut],
      attributs: {
        type: 'button',
        disabled: !ecriture,
        'data-statut': l.statut,
        'aria-label': `Statut de facturation : ${LIBELLES_STATUT[l.statut].toLowerCase()}. ${l.statut === 'facture' ? 'Remettre à facturer' : 'Marquer comme facturé'} (${designation}).`,
      },
      evenements: { click: () => actions.basculerStatut(l) },
    });
    const boutons = el('span', { classe: 'actions-ligne' });
    if (l.resteCentimes > 0) boutons.append(bouton('Payé en totalité', 'btn--petit btn-payer', () => actions.payer(l), { desactive: !ecriture, label: `Payé en totalité : ${formatEuros(l.resteCentimes)} pour ${designation}` }));
    boutons.append(
      bouton('Versement', 'btn--petit btn--secondaire', () => actions.versement(l), { desactive: !ecriture, label: `Ajouter un versement à ${designation}` }),
      bouton('Modifier', 'btn--petit btn--secondaire', () => actions.modifier(l), { desactive: !ecriture, label: `Modifier ${designation}` }),
    );
    return el(
      'tr',
      { classe: l.aVenir ? 'ligne--a-venir' : '' },
      el('td', { texte: formatDateCourte(l.date, annee) }),
      el(
        'td',
        {},
        el('div', {}, l.libelle, l.aVenir ? el('span', { classe: 'badge badge--a-venir', texte: 'À venir' }) : null),
        l.motif !== '' ? el('div', { classe: 'cellule-double__secondaire', texte: l.motif }) : null,
      ),
      el('td', { classe: 'col-montant' }, montant(l.montantCentimes)),
      el('td', {}, statut),
      el(
        'td',
        { classe: 'col-etat-paiement' },
        badgeEtat(l.etat),
        el('div', { classe: 'cellule-double__secondaire', texte: `versé ${formatEuros(l.verseCentimes)} · reste ${formatEuros(l.resteCentimes)}` }),
        l.tropPercuCentimes > 0 ? el('span', { classe: 'badge badge--attention', texte: `Trop-perçu ${formatEuros(l.tropPercuCentimes)}` }) : null,
      ),
      el('td', { classe: 'col-action' }, boutons),
    );
  });
  return el(
    'div',
    { classe: 'table-wrap', attributs: { role: 'region', 'aria-label': `Prestations du mois de ${nomPatient(e.patient)}` } },
    el(
      'table',
      { classe: 'table table--dense' },
      el('caption', { classe: 'sr-only', texte: `Prestations du mois de ${nomPatient(e.patient)}` }),
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { texte: 'Date', attributs: { scope: 'col' } }),
          el('th', { texte: 'Prestation', attributs: { scope: 'col' } }),
          el('th', { texte: 'Montant', classe: 'col-montant', attributs: { scope: 'col' } }),
          el('th', { texte: 'Facturation', attributs: { scope: 'col' } }),
          el('th', { texte: 'Paiement', classe: 'col-etat-paiement', attributs: { scope: 'col' } }),
          el('th', { texte: 'Actions', classe: 'col-action', attributs: { scope: 'col' } }),
        ),
      ),
      el('tbody', {}, ...lignes),
    ),
  );
}

/** Vue par date de versement : versements reçus dans le mois, y compris sur des prestations d'autres mois. */
function tableauVersements(e, mois) {
  return el(
    'div',
    { classe: 'table-wrap', attributs: { role: 'region', 'aria-label': `Versements de ${nomPatient(e.patient)} en ${formatMois(mois)}` } },
    el(
      'table',
      { classe: 'table table--dense versements-liste' },
      el('caption', { texte: `Versements reçus en ${formatMois(mois)}` }),
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { texte: 'Date du versement', attributs: { scope: 'col' } }),
          el('th', { texte: 'Mode', attributs: { scope: 'col' } }),
          el('th', { texte: 'Montant', classe: 'col-montant', attributs: { scope: 'col' } }),
          el('th', { texte: 'Prestation concernée', attributs: { scope: 'col' } }),
        ),
      ),
      el(
        'tbody',
        {},
        ...e.versements.map((v) =>
          el('tr', {}, el('td', { texte: formatDate(v.date) }), el('td', { texte: LIBELLES_MODE[v.mode] ?? v.mode }), el('td', { classe: 'col-montant' }, montant(v.montantCentimes)), el('td', { texte: `${v.libelle} du ${formatDate(v.datePrestation)}` })),
        ),
      ),
    ),
  );
}

function detail(e, recap, options) {
  const { actions, ecriture } = options;
  const contenu = el('div', { classe: 'ligne-detail__contenu pile pile--s' });
  if (e.lignes.length > 0) contenu.append(tableauLignes(e, { aujourdHui: recap.aujourdHui, ecriture, actions }));
  else contenu.append(el('p', { texte: 'Aucune prestation ce mois-ci pour ce patient : seuls des versements ont été reçus.' }));
  if (recap.vue === 'versement' && e.versements.length > 0) contenu.append(tableauVersements(e, recap.mois));
  if (e.lignes.length > 0) {
    contenu.append(el('div', { classe: 'groupe-horizontal' }, bouton('Copier le détail', 'btn--petit btn--secondaire', (evenement) => actions.copierDetail(e, evenement.currentTarget), { label: `Copier le détail des prestations de ${nomPatient(e.patient)}` })));
  }
  return contenu;
}

/**
 * -> <table class="table recap">. `options` : { ouverts:Set, detailImpression, recent, ecriture, actions }.
 * actions : { basculer(id), marquerFacture(entree), copierDetail(entree, bouton), basculerStatut(l), payer(l), versement(l), modifier(l) }.
 */
export function construireTableau(recap, options) {
  const { ouverts, detailImpression, recent, ecriture, actions } = options;
  const parPrestation = recap.vue === 'prestation';
  const nbColonnes = parPrestation ? 8 : 6; // patient, séances, autres, dû, payé/encaissé, [reste, état,] actions
  const th = (texte, classe) => el('th', { texte, classe, attributs: { scope: 'col' } });

  const entete = el(
    'tr',
    {},
    th('Patient'),
    th('Séances', 'col-nombre'),
    th('Autres', 'col-nombre'),
    th('Dû', 'col-montant'),
    th(parPrestation ? 'Payé' : 'Encaissé', 'col-montant'),
    parPrestation ? th('Reste à payer', 'col-montant col-reste') : null,
    parPrestation ? th('État', 'col-etat-paiement') : null,
    th('Actions', 'col-action'),
  );

  const corps = recap.patients.map((e) => {
    const ouvert = ouverts.has(e.patient.id);
    const nom = nomPatient(e.patient);
    const nomAffiche = el('span', { classe: 'patient-nom', texte: nom });
    const declencheur = el('button', {
      classe: 'btn-deplier',
      attributs: { type: 'button', 'aria-expanded': String(ouvert), 'aria-controls': idDetail(e.patient.id) },
      evenements: { click: () => actions.basculer(e.patient.id) },
    }, nomAffiche);
    const action = el('td', { classe: 'col-action' });
    // Même règle que « tout le mois » : seules les prestations échues sont concernées (les à venir restent à facturer).
    const { concernees: aMarquer, aVenir: aVenirLaissees } = lignesAMarquer(e.lignes);
    if (parPrestation && aMarquer.length > 0) {
      const precision = aVenirLaissees > 0 ? ` (${pluriel(aVenirLaissees, 'prestation à venir exclue', 'prestations à venir exclues')})` : '';
      action.append(bouton('Marquer facturé', 'btn--petit btn--secondaire', () => actions.marquerFacture(e), { desactive: !ecriture, label: `Marquer facturé : ${pluriel(aMarquer.length, 'prestation', 'prestations')} de ${nom}${precision}` }));
    }
    const ligne = el(
      'tr',
      { classe: recent === e.patient.id ? 'ligne--modifiee-recemment' : '' },
      el('th', { attributs: { scope: 'row' } }, declencheur),
      el('td', { classe: 'col-nombre', texte: String(e.nbSeances) }),
      el('td', { classe: 'col-nombre', texte: String(e.nbAutres) }),
      el('td', { classe: 'col-montant' }, montant(e.duCentimes)),
      el('td', { classe: 'col-montant' }, montant(e.payeCentimes)),
      parPrestation ? el('td', { classe: 'col-montant col-reste' }, montant(e.resteCentimes, { reste: true })) : null,
      parPrestation ? celluleEtat(e, recap.vue) : null,
      action,
    );
    const ligneDetail = el('tr', { classe: 'ligne-detail', attributs: { id: idDetail(e.patient.id), hidden: !ouvert } }, el('td', { attributs: { colspan: String(nbColonnes) } }, detail(e, recap, options)));
    return el('tbody', { classe: 'patient' }, ligne, ligneDetail);
  });

  const t = recap.total;
  const pied = el(
    'tfoot',
    {},
    el(
      'tr',
      { classe: 'ligne--total' },
      el('th', { texte: `Total (${pluriel(t.nbPatients, 'patient')})`, attributs: { scope: 'row' } }),
      el('td', { classe: 'col-nombre', texte: String(t.nbSeances) }),
      el('td', { classe: 'col-nombre', texte: String(t.nbAutres) }),
      el('td', { classe: 'col-montant' }, montant(t.duCentimes)),
      el('td', { classe: 'col-montant' }, montant(t.payeCentimes)),
      parPrestation ? el('td', { classe: 'col-montant col-reste' }, montant(t.resteCentimes, { reste: true })) : null,
      parPrestation ? celluleEtat(t, recap.vue) : null,
      el('td', { classe: 'col-action' }),
    ),
  );

  return el(
    'table',
    { classe: 'table recap', attributs: { 'data-impression-detail': detailImpression ? 'oui' : null } },
    el('caption', { classe: 'sr-only', texte: `Récapitulatif par patient, ${formatMois(recap.mois)}, ${parPrestation ? 'par date de prestation' : 'par date de versement'}` }),
    el('thead', {}, entete),
    ...corps,
    pied,
  );
}

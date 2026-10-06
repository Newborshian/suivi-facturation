// Graphique en barres empilées en SVG fait maison (docs/design-system.md §6) : légende, motifs, info-bulle, tableau de valeurs.
// Tout est créé par createElementNS / textContent (jamais de HTML construit à partir de données). Les positions viennent de mise-en-page.js (pur).
// Les couleurs et motifs sont portés par le CSS (data-serie) ; seuls les <pattern> et leur référence fill="url(#…)" sont posés ici.
import { el } from '/js/dom.js';
import { DECALAGE_ETIQUETTE, ECART_GRADUATION, INTERLIGNE, disposerColonnes, echelle, etiquettesVisiblesParLargeur, largeurTexte, margesGraphique, positionEtiquette } from '/js/graphiques/mise-en-page.js';
import { svg } from '/js/graphiques/svg.js';

let compteur = 0;
const HAUTEUR_ZONE = { large: 194, etroit: 154 }; // hauteur des barres (la zone garde sa hauteur quelles que soient les marges)

/** Séries à motif : la référence `fill` est posée sur le segment, le CSS colore l'intérieur du motif (data-serie). */
function motifs(idBase) {
  return svg(
    'defs',
    {},
    svg('pattern', { id: `${idBase}-motif-attente`, width: 6, height: 6, patternUnits: 'userSpaceOnUse' }, svg('rect', { class: 'motif__fond', 'data-serie': 'attente', width: 6, height: 6 }), svg('circle', { class: 'motif__trait', cx: 3, cy: 3, r: 1.4 })),
    svg(
      'pattern',
      { id: `${idBase}-motif-a-facturer`, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      svg('rect', { class: 'motif__fond', 'data-serie': 'a-facturer', width: 5, height: 5 }),
      svg('rect', { class: 'motif__trait', width: 5, height: 2 }),
    ),
  );
}

/**
 * Figure complète : titre, légende, SVG redessiné à la largeur réelle, info-bulle, tableau « Voir les chiffres ».
 *  - titre, sousTitre, description : textes (la description résume le graphique pour les lecteurs d'écran)
 *  - niveauTitre : 2 ou 3 ; badge : texte facultatif sous le titre (ex. « Estimation indicative »)
 *  - series : [{ cle: 'paye'|'attente'|'a-facturer'|'neutre'|'prevu', libelle }] du segment du bas à celui du haut
 *  - categories : [{ libelle (axe), annee? (écrite sous l'étiquette), mention? (ex. « (estimé) », écrite sous l'étiquette, avant l'année), libelleLong (info-bulle, tableau), valeurs: [par série], extras: [{ libelle, texte }], courante? }]
 *  - format(valeur) : texte exact d'une valeur ; formatCourt(valeur) : texte compact (axe, dessus des barres) ; pasMin : plus petit pas de l'axe
 *  - largeurValeur : largeur minimale d'une colonne pour écrire sa valeur au-dessus (relevée si la valeur est plus large) ;
 *    largeurEtiquette : place minimale d'une étiquette d'axe (relevée selon la largeur réelle des étiquettes)
 *  - outils : nœud facultatif affiché sous le titre (ex. commutateur de regroupement)
 *  - tableau : { entetes: [...], lignes: [[...]], pied?: [...] }  (cellules de texte ; la première colonne est l'en-tête de ligne)
 */
export function graphiqueBarres({ titre, sousTitre, description, niveauTitre = 2, badge = null, series, categories, format, formatCourt, pasMin = 1, largeurValeur = 54, largeurEtiquette = 44, tableau, nomTotal = 'total', outils }) {
  const idBase = `g${++compteur}`;
  const idTitre = `${idBase}-titre`;
  const idDescription = `${idBase}-desc`;
  const maximum = Math.max(...categories.map((c) => c.valeurs.reduce((s, v) => s + v, 0)), 0);
  const axe = echelle(maximum, { pasMin });

  const legende = el('ul', { classe: 'graphe__legende' }, ...series.map((s) => el('li', { classe: 'legende__item' }, el('span', { classe: 'legende__pastille', attributs: { 'data-serie': s.cle, 'aria-hidden': 'true' } }), s.libelle)));
  const zoneGraphe = el('div', { classe: 'graphe__zone' });
  const bulle = el('div', { classe: 'graphe__bulle', attributs: { hidden: true, 'aria-hidden': 'true' } });
  zoneGraphe.append(bulle);

  const texteColonne = (c) => `${c.libelleLong} : ${[...series.map((s, i) => `${s.libelle.toLowerCase()} ${format(c.valeurs[i])}`), ...(c.extras ?? []).map((e) => `${e.libelle.toLowerCase()} ${e.texte}`)].join(', ')}, ${nomTotal} ${format(c.valeurs.reduce((s, v) => s + v, 0))}`;

  function afficherBulle(c, colonne) {
    const lignes = [...series.map((s, i) => [s.libelle, format(c.valeurs[i])]), ...(c.extras ?? []).map((e) => [e.libelle, e.texte]), [`${nomTotal[0].toUpperCase()}${nomTotal.slice(1)}`, format(c.valeurs.reduce((s, v) => s + v, 0))]];
    bulle.replaceChildren(el('span', { classe: 'graphe__bulle-titre', texte: c.libelleLong }), el('dl', {}, ...lignes.flatMap(([libelle, valeur]) => [el('dt', { texte: libelle }), el('dd', { texte: valeur })])));
    bulle.hidden = false;
    const largeurZone = zoneGraphe.clientWidth;
    const gauche = Math.min(Math.max(colonne.xCentre - bulle.offsetWidth / 2, 0), Math.max(largeurZone - bulle.offsetWidth, 0));
    bulle.style.left = `${Math.round(gauche)}px`; // CSSOM : autorisé par style-src 'self' (jamais d'attribut style)
    bulle.style.top = `${Math.max(Math.round(colonne.yHaut - bulle.offsetHeight - 8), 0)}px`;
  }
  const masquerBulle = () => {
    bulle.hidden = true;
  };

  function dessiner(largeur) {
    // Lignes d'étiquette sous l'axe : le mois, puis « (estimé) » (mention) et/ou l'année. Les marges suivent le texte (14 px) et les graduations.
    const lignesEtiquette = Math.max(1, ...categories.map((c) => 1 + (c.mention ? 1 : 0) + (c.annee ? 1 : 0)));
    const marges = margesGraphique({ graduations: axe.graduations.map(formatCourt), lignes: lignesEtiquette });
    const hauteur = marges.haut + (largeur >= 640 ? HAUTEUR_ZONE.large : HAUTEUR_ZONE.etroit) + marges.bas;
    const { zone, base, colonnes } = disposerColonnes({ largeur, hauteur, marges, valeurs: categories.map((c) => c.valeurs), maxAxe: axe.max });
    // Largeur de chaque étiquette (sa ligne la plus large, au moins `largeurEtiquette` moins l'air) et cadre dans lequel elles tiennent.
    const largeursEtiquettes = categories.map((c) => Math.max(...[c.libelle, c.mention, c.annee].filter(Boolean).map((t) => largeurTexte(t)), largeurEtiquette - 6));
    const cadreEtiquettes = { min: zone.x - 2, max: largeur - 2 };
    const visibles = new Set(etiquettesVisiblesParLargeur(largeursEtiquettes, { x0: zone.x, colonne: colonnes[0]?.largeur ?? zone.largeur, ...cadreEtiquettes }));
    const focalisables = categories.length <= 26; // au-delà (semaines), le tableau de valeurs fait foi : pas de 50 arrêts de tabulation
    const y = (valeur) => base - (valeur / axe.max) * zone.hauteur;

    const grille = svg('g', { class: 'graphe__grille' }, ...axe.graduations.map((v) => svg('line', { x1: zone.x, x2: zone.x + zone.largeur, y1: y(v), y2: y(v) })));
    const graduations = svg('g', { class: 'graphe__axe' }, svg('line', { x1: zone.x, x2: zone.x + zone.largeur, y1: base, y2: base }), ...axe.graduations.map((v) => svg('text', { x: zone.x - ECART_GRADUATION, y: y(v) + 4, 'text-anchor': 'end' }, formatCourt(v))));
    const etiquettes = svg(
      'g',
      { class: 'graphe__axe' },
      ...colonnes.filter((c) => visibles.has(c.index)).map((c) => {
        const categorie = categories[c.index];
        // Toutes les lignes d'une étiquette partagent la même abscisse, ramenée dans le cadre (ni « (estimé) » qui déborde à droite, ni contact avec les graduations).
        const x = positionEtiquette({ xCentre: c.xCentre, largeur: largeursEtiquettes[c.index], ...cadreEtiquettes });
        return svg('text', { class: categorie.courante ? 'graphe__etiquette--forte' : null, x, y: base + DECALAGE_ETIQUETTE, 'text-anchor': 'middle' }, categorie.libelle, categorie.mention ? svg('tspan', { x, dy: INTERLIGNE }, categorie.mention) : null, categorie.annee ? svg('tspan', { class: 'graphe__annee', x, dy: INTERLIGNE }, categorie.annee) : null);
      }),
    );

    const colonnesSvg = colonnes.map((c) => {
      const categorie = categories[c.index];
      const attributs = { class: categorie.courante ? 'graphe__colonne graphe__colonne--courante' : 'graphe__colonne', role: 'group', 'aria-label': texteColonne(categorie), tabindex: focalisables ? 0 : null };
      const g = svg(
        'g',
        attributs,
        svg('rect', { class: 'graphe__focus', x: c.x, y: zone.y - 4, width: c.largeur, height: zone.hauteur + 4 }),
        ...c.segments.map((s) => {
          const serie = series[s.rang].cle;
          return svg('rect', { class: 'graphe__segment', 'data-serie': serie, fill: serie === 'attente' || serie === 'a-facturer' ? `url(#${idBase}-motif-${serie})` : null, x: c.barreX, y: s.y, width: c.barreLargeur, height: s.hauteur });
        }),
        c.total > 0 && c.largeur >= Math.max(largeurValeur, largeurTexte(formatCourt(c.total)) + 6) ? svg('text', { class: 'graphe__valeur', x: c.xCentre, y: c.yHaut - 6, 'text-anchor': 'middle' }, formatCourt(c.total)) : null,
      );
      g.addEventListener('mouseenter', () => afficherBulle(categorie, c));
      g.addEventListener('mouseleave', masquerBulle);
      g.addEventListener('focus', () => afficherBulle(categorie, c));
      g.addEventListener('blur', masquerBulle);
      g.addEventListener('keydown', (evenement) => {
        if (evenement.key === 'Escape') masquerBulle();
      });
      return g;
    });

    return svg(
      'svg',
      { class: 'graphe__svg', role: 'group', 'aria-labelledby': `${idBase}-svg-titre`, 'aria-describedby': idDescription, viewBox: `0 0 ${largeur} ${hauteur}` },
      svg('title', { id: `${idBase}-svg-titre` }, titre),
      svg('desc', { id: idDescription }, description),
      motifs(idBase),
      grille,
      graduations,
      etiquettes,
      ...colonnesSvg,
    );
  }

  let largeurDessinee = 0;
  function actualiser() {
    const largeur = Math.floor(zoneGraphe.clientWidth);
    if (largeur < 120 || largeur === largeurDessinee) return;
    largeurDessinee = largeur;
    masquerBulle();
    zoneGraphe.querySelector('svg')?.remove();
    zoneGraphe.prepend(dessiner(largeur));
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(actualiser).observe(zoneGraphe);
  // Premier dessin dès que la figure est dans la page (le ResizeObserver le fait aussi, ceci couvre l'impression et les navigateurs anciens).
  queueMicrotask(() => zoneGraphe.isConnected && actualiser());

  const tableauHtml = el(
    'div',
    { classe: 'table-wrap', attributs: { role: 'region', 'aria-label': `Valeurs : ${titre}`, tabindex: '0' } },
    el(
      'table',
      { classe: 'table table--dense' },
      el('caption', { classe: 'sr-only', texte: `${titre} : valeurs exactes` }),
      el('thead', {}, el('tr', {}, ...tableau.entetes.map((h, i) => el('th', { texte: h, classe: i === 0 ? '' : 'col-montant', attributs: { scope: 'col' } })))),
      el('tbody', {}, ...tableau.lignes.map((ligne) => el('tr', {}, ...ligne.map((cellule, i) => (i === 0 ? el('th', { texte: cellule, attributs: { scope: 'row' } }) : el('td', { texte: cellule, classe: 'col-montant' })))))),
      tableau.pied ? el('tfoot', {}, el('tr', { classe: 'ligne--total' }, ...tableau.pied.map((cellule, i) => (i === 0 ? el('th', { texte: cellule, attributs: { scope: 'row' } }) : el('td', { texte: cellule, classe: 'col-montant' }))))) : null,
    ),
  );

  const titreNoeud = el(`h${niveauTitre}`, { classe: 'graphe__titre', texte: titre, attributs: { id: idTitre } });
  return el(
    'figure',
    { classe: 'graphe', attributs: { 'aria-labelledby': idTitre } },
    el('figcaption', { classe: 'pile pile--s' }, titreNoeud, badge ? el('p', {}, el('span', { classe: 'graphe__indicatif', texte: badge })) : null, sousTitre ? el('p', { classe: 'graphe__sous-titre', texte: sousTitre }) : null, outils ?? null),
    legende,
    zoneGraphe,
    el('details', { classe: 'depliant graphe__tableau' }, el('summary', { texte: 'Voir les chiffres' }), el('div', { classe: 'depliant__contenu' }, tableauHtml)),
  );
}

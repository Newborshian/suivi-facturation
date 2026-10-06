// Mise en page des graphiques en barres : échelles, positions, étiquettes. Module PUR (aucun accès au DOM) : testé avec node --test.
// Les valeurs (centimes ou entiers) ne sont jamais converties ici ; seules des positions en pixels sont calculées (flottants autorisés,
// ils ne servent qu'au dessin). Les montants exacts sont affichés par le tableau de valeurs.

const NBSP = ' ';
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const groupes = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** 125000 -> « 1 250 € » : euros entiers, pour les étiquettes d'axe et de barre uniquement (le tableau donne les centimes). */
export function formatEurosCourt(centimes) {
  return `${groupes.format(Math.round(centimes / 100))}${NBSP}€`;
}

/** '2026-10' -> 'oct.' ; null si le mois est invalide. */
export function moisCourt(mois) {
  const m = /^(\d{4})-(\d{2})$/.exec(mois ?? '');
  return m && MOIS_COURTS[Number(m[2]) - 1] ? MOIS_COURTS[Number(m[2]) - 1] : null;
}

/** '2026-W40' -> 'S40' ; '2026-W40' + année -> 'S40 2026' (tableau de valeurs). */
export function libelleSemaine(semaine, avecAnnee = false) {
  const m = /^(\d{4})-W(\d{2})$/.exec(semaine ?? '');
  if (!m) return '';
  return avecAnnee ? `S${m[2]} ${m[1]}` : `S${m[2]}`;
}

/**
 * Échelle « jolie » de l'axe vertical : pas de 1, 2, 5 ou 10 × une puissance de 10 (× `pasMin`), environ `cible` graduations.
 * `pasMin` : plus petit pas possible (100 pour des centimes = 1 €, 1 pour des effectifs). Un maximum nul donne une échelle minimale.
 * -> { max, pas, graduations: [0, pas, 2 pas, … max] }
 */
export function echelle(maxValeur, { pasMin = 1, cible = 4 } = {}) {
  const brut = Math.max(maxValeur, 0) / (cible * pasMin);
  let puissance = 1;
  while (puissance * 10 <= brut) puissance *= 10;
  const multiple = [1, 2, 5, 10].find((m) => m * puissance >= brut) ?? 10;
  const pas = Math.max(multiple * puissance, 1) * pasMin;
  const max = Math.max(Math.ceil(maxValeur / pas), 1) * pas;
  const graduations = [];
  for (let v = 0; v <= max; v += pas) graduations.push(v);
  return { max, pas, graduations };
}

/**
 * Position de chaque colonne et de chaque segment empilé. `valeurs` : une liste de nombres par colonne, du segment du bas à celui du haut.
 * Les colonnes se partagent la largeur de la zone ; la barre occupe 70 % de sa colonne (56 px au plus).
 * -> { zone: {x, y, largeur, hauteur}, base, colonnes: [{ index, x, largeur, barreX, barreLargeur, xCentre, total, yHaut, segments: [{ rang, valeur, y, hauteur }] }] }
 */
export function disposerColonnes({ largeur, hauteur, marges, valeurs, maxAxe }) {
  const zone = { x: marges.gauche, y: marges.haut, largeur: Math.max(largeur - marges.gauche - marges.droite, 1), hauteur: Math.max(hauteur - marges.haut - marges.bas, 1) };
  const base = zone.y + zone.hauteur;
  const n = Math.max(valeurs.length, 1);
  const pas = zone.largeur / n;
  const barreLargeur = Math.min(pas * 0.7, 56);
  const colonnes = valeurs.map((serie, index) => {
    let cumul = 0;
    const segments = [];
    serie.forEach((valeur, rang) => {
      if (!(valeur > 0)) return;
      const h = (valeur / maxAxe) * zone.hauteur;
      segments.push({ rang, valeur, y: base - cumul - h, hauteur: h });
      cumul += h;
    });
    const x = zone.x + index * pas;
    return { index, x, largeur: pas, barreX: x + (pas - barreLargeur) / 2, barreLargeur, xCentre: x + pas / 2, total: serie.reduce((s, v) => s + v, 0), yHaut: base - cumul, segments };
  });
  return { zone, base, colonnes };
}

/**
 * Indices des étiquettes d'axe à écrire : une sur `k`, avec k le plus petit entier tel que `k × largeurColonne >= largeurEtiquette`
 * (étiquettes trop serrées sur petit écran ou en vue hebdomadaire). La première est toujours écrite.
 */
export function etiquettesVisibles(nombre, largeurColonne, largeurEtiquette) {
  const k = Math.max(1, Math.ceil(largeurEtiquette / Math.max(largeurColonne, 1)));
  return Array.from({ length: nombre }, (_, i) => i).filter((i) => i % k === 0);
}

// ------------------------------------------------------------------ Texte de l'axe : encombrement et placement

/** Taille du texte des graphiques, en pixels : celle de la feuille de style (`.graphe__svg text`). Le dessin y est calé. */
export const TAILLE_TEXTE = 14;
/** Distance entre deux lignes d'une étiquette d'axe (mois, « (estimé) », année). */
export const INTERLIGNE = 17;
/** Distance entre l'axe horizontal et la ligne de base de la première ligne d'étiquette (laisse de l'air sous le « 0 » de l'axe vertical). */
export const DECALAGE_ETIQUETTE = 22;
/** Écart entre les graduations de l'axe vertical et le trait de l'axe. */
export const ECART_GRADUATION = 8;

const ETROITS = new Set([...'ilrtjf.,:;\'()| ']); // caractères étroits (et espaces, dont l'insécable)
const LARGES = new Set([...'mwMW']);

/**
 * Largeur estimée, en pixels, d'un texte court (étiquette d'axe, valeur) dans la police du graphique. Estimation volontairement simple
 * (la police réelle n'est pas mesurable hors du navigateur) : juste ou légèrement large, à quelques pixels près pour les textes de l'axe.
 */
export function largeurTexte(texte, taille = TAILLE_TEXTE) {
  let em = 0;
  for (const c of String(texte ?? '')) {
    if (c === '€') em += 0.6;
    else if (/\d/.test(c)) em += 0.57;
    else if (ETROITS.has(c) || c.trim() === '') em += 0.3; // espaces, insécables comprises
    else if (LARGES.has(c)) em += 0.8;
    else if (c !== c.toLowerCase()) em += 0.66; // majuscule
    else em += 0.53;
  }
  return Math.ceil(em * taille) + 2;
}

/**
 * Marges du graphique selon son contenu : à gauche la place de la plus large graduation (+ écart au trait + un peu d'air),
 * en bas la place des lignes d'étiquette (`lignes` : 1 = mois seul, 2 avec « (estimé) » ou l'année, 3 avec les deux).
 */
export function margesGraphique({ graduations, lignes, haut = 22, droite = 8 }) {
  const plusLarge = Math.max(0, ...graduations.map((g) => largeurTexte(g)));
  return {
    haut,
    droite,
    gauche: Math.max(36, plusLarge + ECART_GRADUATION + 6),
    bas: DECALAGE_ETIQUETTE + (Math.max(lignes, 1) - 1) * INTERLIGNE + 10,
  };
}

/**
 * Abscisse (centre) d'une étiquette de largeur `largeur` centrée sous sa colonne, ramenée dans [min, max] : la dernière étiquette
 * (« (estimé) » du dernier mois) ne dépasse pas à droite, la première ne touche pas les graduations. Si elle est plus large que
 * l'espace disponible, elle est centrée dans cet espace.
 */
export function positionEtiquette({ xCentre, largeur, min, max }) {
  if (largeur >= max - min) return (min + max) / 2;
  return Math.min(Math.max(xCentre, min + largeur / 2), max - largeur / 2);
}

/**
 * Indices des étiquettes d'axe à écrire quand leurs largeurs diffèrent (`largeurs` : une par colonne) : le plus petit pas k tel que
 * deux étiquettes écrites voisines (indices 0, k, 2k…), placées comme le fait `positionEtiquette` (donc décalées aux bords), laissent
 * `air` pixels entre elles. `x0` : début de la zone des colonnes, `colonne` : largeur d'une colonne, [`min`, `max`] : cadre des étiquettes.
 * La première est toujours écrite.
 */
export function etiquettesVisiblesParLargeur(largeurs, { x0, colonne, min, max, air = 6 }) {
  const largeurColonne = Math.max(colonne, 1);
  const centre = (i) => positionEtiquette({ xCentre: x0 + (i + 0.5) * largeurColonne, largeur: largeurs[i], min, max });
  for (let k = 1; k < largeurs.length; k++) {
    const indices = [];
    for (let i = 0; i < largeurs.length; i += k) indices.push(i);
    const libre = indices.every((i, j) => j === 0 || centre(i) - largeurs[i] / 2 - (centre(indices[j - 1]) + largeurs[indices[j - 1]] / 2) >= air);
    if (libre) return indices;
  }
  return largeurs.length > 0 ? [0] : [];
}

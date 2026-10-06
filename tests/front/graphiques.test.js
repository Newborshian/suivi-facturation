import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DECALAGE_ETIQUETTE,
  INTERLIGNE,
  TAILLE_TEXTE,
  disposerColonnes,
  echelle,
  etiquettesVisibles,
  etiquettesVisiblesParLargeur,
  formatEurosCourt,
  largeurTexte,
  libelleSemaine,
  margesGraphique,
  moisCourt,
  positionEtiquette,
} from '../../public/js/graphiques/mise-en-page.js';
import { RACINE } from '../aides/temp.js';
import { PERIODES, PERIODE_DEFAUT, formaterPlage, plagePeriode } from '../../public/js/periodes.js';
import { formatMois } from '../../public/js/format.js';

test('echelle (centimes, pas minimal 1 €) : maximum rond, graduations de 0 au maximum, pas 1/2/5/10 × 10^k', () => {
  assert.deepEqual(echelle(37500, { pasMin: 100 }), { max: 40000, pas: 10000, graduations: [0, 10000, 20000, 30000, 40000] });
  assert.deepEqual(echelle(185000, { pasMin: 100 }), { max: 200000, pas: 50000, graduations: [0, 50000, 100000, 150000, 200000] });
  assert.deepEqual(echelle(0, { pasMin: 100 }), { max: 100, pas: 100, graduations: [0, 100] });
  assert.deepEqual(echelle(150, { pasMin: 100 }), { max: 200, pas: 100, graduations: [0, 100, 200] });
  for (const max of [1, 99, 100, 4500, 99999, 123456, 7654321]) {
    const e = echelle(max, { pasMin: 100 });
    assert.ok(e.max >= max, `max ${max}`);
    assert.ok(e.graduations.length >= 2 && e.graduations.length <= 6, `${max} -> ${e.graduations.length} graduations`);
    assert.equal(e.pas % 100, 0);
    assert.ok(e.graduations.every((v) => Number.isSafeInteger(v)));
    assert.ok([1, 2, 5, 10].includes(Number(String(e.pas / 100).replace(/0+$/, '') || 1)), `pas ${e.pas}`);
  }
});

test('echelle (effectifs, pas minimal 1) : jamais de graduation fractionnaire', () => {
  assert.deepEqual(echelle(0), { max: 1, pas: 1, graduations: [0, 1] });
  assert.deepEqual(echelle(3), { max: 3, pas: 1, graduations: [0, 1, 2, 3] });
  for (const max of [1, 2, 7, 11, 23, 48, 130]) {
    const e = echelle(max);
    assert.ok(e.graduations.every(Number.isInteger), `max ${max}`);
    assert.ok(e.max >= max);
  }
});

test('disposerColonnes : segments empilés du bas vers le haut, hauteurs proportionnelles, somme des hauteurs = hauteur de la pile', () => {
  const marges = { haut: 20, droite: 10, bas: 40, gauche: 50 };
  const { zone, base, colonnes } = disposerColonnes({ largeur: 450, hauteur: 260, marges, valeurs: [[100, 50, 50], [0, 0, 0], [200, 0, 0]], maxAxe: 200 });
  assert.deepEqual(zone, { x: 50, y: 20, largeur: 390, hauteur: 200 });
  assert.equal(base, 220);
  assert.equal(colonnes.length, 3);
  const [c0, c1, c2] = colonnes;
  assert.deepEqual(c0.segments.map((s) => s.rang), [0, 1, 2]);
  assert.deepEqual(c0.segments.map((s) => s.hauteur), [100, 50, 50]);
  assert.equal(c0.segments[0].y, 120); // le premier segment repose sur l'axe
  assert.equal(c0.segments[1].y, 70);
  assert.equal(c0.segments[2].y, 20);
  assert.equal(c0.yHaut, 20);
  assert.equal(c0.total, 200);
  assert.deepEqual(c1.segments, []); // mois vide : aucune barre
  assert.equal(c1.yHaut, base);
  assert.equal(c2.segments[0].hauteur, 200);
  assert.ok(c1.x > c0.x && c2.x > c1.x);
  for (const c of colonnes) assert.ok(c.barreX >= c.x && c.barreX + c.barreLargeur <= c.x + c.largeur + 1e-9);
  assert.ok(c0.barreLargeur <= 56);
});

test('disposerColonnes : aucune colonne, zone minuscule -> pas de valeur non numérique', () => {
  const r = disposerColonnes({ largeur: 10, hauteur: 10, marges: { haut: 20, droite: 10, bas: 40, gauche: 50 }, valeurs: [], maxAxe: 100 });
  assert.equal(r.colonnes.length, 0);
  assert.ok(r.zone.largeur >= 1 && r.zone.hauteur >= 1);
});

test('etiquettesVisibles : une étiquette sur k selon la place disponible ; la première toujours écrite', () => {
  assert.deepEqual(etiquettesVisibles(12, 58, 44), Array.from({ length: 12 }, (_, i) => i));
  assert.deepEqual(etiquettesVisibles(12, 20, 44), [0, 3, 6, 9]);
  assert.deepEqual(etiquettesVisibles(53, 6, 30), Array.from({ length: 11 }, (_, i) => i * 5));
  assert.deepEqual(etiquettesVisibles(0, 10, 30), []);
  assert.equal(etiquettesVisibles(3, 0, 30)[0], 0);
});

test('formats courts : euros entiers avec espace insécable, mois abrégés, semaines', () => {
  assert.equal(formatEurosCourt(0), '0 €');
  assert.equal(formatEurosCourt(185000), '1 850 €'); // séparateur de milliers de Intl fr-FR : espace fine insécable
  assert.equal(formatEurosCourt(12345678), '123 457 €');
  assert.equal(moisCourt('2026-09'), 'sept.');
  assert.equal(moisCourt('2026-01'), 'janv.');
  assert.equal(moisCourt('2026-13'), null);
  assert.equal(moisCourt(undefined), null);
  assert.equal(libelleSemaine('2026-W40'), 'S40');
  assert.equal(libelleSemaine('2026-W03', true), 'S03 2026');
  assert.equal(libelleSemaine('x'), '');
});

test('plagePeriode : 12 derniers mois par défaut, changement d\'année, année en cours / précédente', () => {
  assert.equal(PERIODE_DEFAUT, '12-mois');
  assert.equal(PERIODES[0].id, PERIODE_DEFAUT);
  assert.deepEqual(plagePeriode('12-mois', '2026-10-02'), { de: '2025-11', a: '2026-10' });
  assert.deepEqual(plagePeriode('inconnu', '2026-10-02'), { de: '2025-11', a: '2026-10' });
  assert.deepEqual(plagePeriode('12-mois', '2026-01-15'), { de: '2025-02', a: '2026-01' });
  assert.deepEqual(plagePeriode('6-mois', '2026-03-31'), { de: '2025-10', a: '2026-03' });
  assert.deepEqual(plagePeriode('3-mois', '2026-02-10'), { de: '2025-12', a: '2026-02' });
  assert.deepEqual(plagePeriode('annee', '2026-10-02'), { de: '2026-01', a: '2026-10' });
  assert.deepEqual(plagePeriode('annee-precedente', '2026-10-02'), { de: '2025-01', a: '2025-12' });
  assert.equal(formaterPlage({ de: '2025-11', a: '2026-10' }, formatMois), 'de novembre 2025 à octobre 2026');
  assert.equal(formaterPlage({ de: '2026-10', a: '2026-10' }, formatMois), 'octobre 2026');
});

// ------------------------------------------------------------------ Texte de 14 px : encombrement, marges, placement des étiquettes

test('largeurTexte : estimation proche des mesures relevées dans le navigateur à 14 px (jamais très en dessous, pas beaucoup au-dessus)', () => {
  // largeurs réelles mesurées (px) à 14 px : [texte, mesure]
  const mesures = [['(estimé)', 48], ['(en partie)', 62], ['janv.', 31], ['S44', 24], ['2027', 31], ['800 €', 34], ['févr.', 26], ['août', 28]];
  for (const [texte, reel] of mesures) {
    const estime = largeurTexte(texte);
    assert.ok(estime >= reel - 1, `${texte} : estimé ${estime} < mesuré ${reel}`);
    assert.ok(estime <= reel + 8, `${texte} : estimé ${estime} >> mesuré ${reel}`);
  }
  assert.equal(largeurTexte(''), 2);
  assert.equal(largeurTexte(undefined), 2);
  assert.ok(largeurTexte('12 500 €') > largeurTexte('500 €'));
  assert.ok(largeurTexte('(estimé)', 28) > largeurTexte('(estimé)'), 'proportionnelle à la taille');
});

test('le texte des graphiques est calé sur 14 px, comme la feuille de style', () => {
  assert.equal(TAILLE_TEXTE, 14);
  const css = fs.readFileSync(path.join(RACINE, 'public', 'css', 'ecrans.css'), 'utf8');
  const regle = /\.graphe__svg text \{([^}]*)\}/.exec(css)?.[1] ?? '';
  const taille = /font-size:\s*([^;]+);/.exec(regle)?.[1].trim();
  assert.ok(taille, 'règle .graphe__svg text introuvable');
  let px = null;
  const direct = /^([\d.]+)(px|rem)$/.exec(taille);
  if (direct) px = Number(direct[1]) * (direct[2] === 'rem' ? 16 : 1);
  const variable = /^var\((--[\w-]+)\)$/.exec(taille);
  if (variable) {
    const jeton = new RegExp(`${variable[1]}:\\s*([\\d.]+)(px|rem)`).exec(fs.readFileSync(path.join(RACINE, 'public', 'css', 'tokens.css'), 'utf8'));
    if (jeton) px = Number(jeton[1]) * (jeton[2] === 'rem' ? 16 : 1);
  }
  assert.equal(px, TAILLE_TEXTE, `font-size de .graphe__svg text : ${taille}`);
});

test('margesGraphique : la marge de gauche suit la graduation la plus large, la marge du bas le nombre de lignes d\'étiquette', () => {
  const courte = margesGraphique({ graduations: ['0 €', '200 €', '800 €'], lignes: 2 });
  const longue = margesGraphique({ graduations: ['0 €', '10 000 €', '20 000 €'], lignes: 2 });
  assert.ok(longue.gauche > courte.gauche, 'plus de chiffres, plus de place');
  assert.ok(courte.gauche >= largeurTexte('800 €') + 8, 'la graduation tient à gauche du trait avec son écart');
  assert.ok(longue.gauche >= largeurTexte('20 000 €') + 8);
  assert.equal(margesGraphique({ graduations: ['0'], lignes: 1 }).gauche, 36, 'minimum');
  const l1 = margesGraphique({ graduations: ['0'], lignes: 1 });
  const l2 = margesGraphique({ graduations: ['0'], lignes: 2 });
  const l3 = margesGraphique({ graduations: ['0'], lignes: 3 });
  assert.equal(l2.bas - l1.bas, INTERLIGNE);
  assert.equal(l3.bas - l2.bas, INTERLIGNE);
  assert.ok(l1.bas >= DECALAGE_ETIQUETTE + 8, 'la première ligne d\'étiquette et ses jambages tiennent');
  assert.deepEqual([courte.haut, courte.droite], [22, 8]);
});

test('positionEtiquette : la dernière étiquette ne dépasse pas à droite, la première ne touche pas les graduations, les autres restent centrées', () => {
  const cadre = { min: 50, max: 480 };
  // dernier mois « (estimé) » : colonne étroite près du bord droit (cas mesuré : l'étiquette dépassait de la figure)
  const w = largeurTexte('(estimé)');
  const droite = positionEtiquette({ xCentre: 475, largeur: w, ...cadre });
  assert.ok(droite + w / 2 <= cadre.max, 'ne dépasse pas à droite');
  assert.ok(droite < 475, 'ramenée vers la gauche');
  // première semaine : le « 0 » de l'axe vertical se termine à gauche de min
  const gauche = positionEtiquette({ xCentre: 55, largeur: 30, ...cadre });
  assert.ok(gauche - 15 >= cadre.min, 'ne passe pas à gauche du cadre');
  assert.equal(positionEtiquette({ xCentre: 200, largeur: 30, ...cadre }), 200, 'au milieu : centrée sous sa colonne');
  assert.equal(positionEtiquette({ xCentre: 100, largeur: 600, ...cadre }), 265, 'plus large que le cadre : centrée dans le cadre');
});

test('etiquettesVisiblesParLargeur : le plus petit pas qui laisse de l\'air, étiquettes de bord comprises ; la première toujours écrite', () => {
  const cadre = { x0: 50, min: 48, max: 498 };
  // 12 colonnes de 37 px : des étiquettes de 30 px passent toutes ; de 60 px, une sur deux serait trop serrée (la première, ramenée
  // dans le cadre, se rapproche de la deuxième) : une sur trois
  assert.deepEqual(etiquettesVisiblesParLargeur(Array(12).fill(30), { colonne: 37, ...cadre }), Array.from({ length: 12 }, (_, i) => i));
  assert.deepEqual(etiquettesVisiblesParLargeur(Array(12).fill(60), { colonne: 37, ...cadre }), [0, 3, 6, 9]);
  assert.deepEqual(etiquettesVisiblesParLargeur([], { colonne: 37, ...cadre }), []);
  assert.deepEqual(etiquettesVisiblesParLargeur([30], { colonne: 5, ...cadre }), [0]);
  // jamais deux étiquettes écrites qui se touchent, même décalées au bord (cas mesuré en vue hebdomadaire sur petit écran)
  for (const colonne of [8, 10, 14, 20, 37, 60]) {
    for (const largeur of [24, 30, 38, 54, 66]) {
      const largeurs = Array(26).fill(largeur);
      const indices = etiquettesVisiblesParLargeur(largeurs, { colonne, x0: 36, min: 34, max: 36 + 26 * colonne + 8 - 2 });
      assert.equal(indices[0], 0);
      const boites = indices.map((i) => {
        const x = positionEtiquette({ xCentre: 36 + (i + 0.5) * colonne, largeur, min: 34, max: 36 + 26 * colonne + 6 });
        return [x - largeur / 2, x + largeur / 2];
      });
      for (let j = 1; j < boites.length; j++) assert.ok(boites[j][0] - boites[j - 1][1] >= 6 - 1e-9, `colonne ${colonne}, largeur ${largeur}, étiquettes ${indices[j - 1]} et ${indices[j]}`);
    }
  }
});

test('graphique (lecture du code) : pas de role="img" autour des colonnes focalisables ; le SVG est un groupe nommé et décrit', () => {
  const source = fs.readFileSync(path.join(RACINE, 'public', 'js', 'graphiques', 'barres-svg.js'), 'utf8');
  assert.doesNotMatch(source, /role: 'img'/, 'un role="img" rend ses enfants présentationnels : les colonnes focalisables y seraient inaccessibles');
  assert.match(source, /role: 'group', 'aria-labelledby': `\${idBase}-svg-titre`, 'aria-describedby': idDescription/);
  assert.match(source, /role: 'group', 'aria-label': texteColonne\(categorie\)/, 'chaque colonne porte son propre nom');
  assert.match(source, /tabindex: focalisables \? 0 : null/);
  assert.match(source, /aria-label': \`Valeurs : \${titre}\`/, 'le tableau de valeurs est la version alternative');
});

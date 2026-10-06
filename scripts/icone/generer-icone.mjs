// Génère logo.svg, logo-512.png et suivi-facturation.ico (aucune dépendance).
// Usage : node scripts/icone/generer-icone.mjs   (résultat reproductible)
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOSSIER = dirname(fileURLToPath(import.meta.url));

// Palette (public/css/tokens.css) : --c-primaire, blanc, --c-ok-texte (thème sombre)
const FOND = [0x1b, 0x5f, 0xa8];
const BARRE = [0xff, 0xff, 0xff];
const COCHE = [0x8f, 0xe0, 0xb4];
// Liseré clair : blanc semi-transparent, à l'intérieur de la tuile (même emprise et même forme)
const LISERE = [0xff, 0xff, 0xff];
const LISERE_OPACITE = 0.6;
const melange = (c, f, a) => c.map((v, i) => Math.round(v * a + f[i] * (1 - a)));
const LISERE_MELANGE = melange(LISERE, FOND, LISERE_OPACITE); // rendu raster (équivalent au trait semi-transparent du SVG)
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// Géométrie sur une grille de 256 (unique source pour le SVG et le raster)
const TUILE = { x: 0, y: 0, w: 256, h: 256, r: 56 };
const BARRES = [
  { x: 40, y: 168, w: 50, h: 50, r: 9 },
  { x: 103, y: 138, w: 50, h: 80, r: 9 },
  { x: 166, y: 108, w: 50, h: 110, r: 9 },
];
const COCHE_PTS = [[170, 66], [187, 83], [214, 48]];
const COCHE_EP = 17; // épaisseur du trait
const LISERE_EP = 5; // ~2 % de 256 (en unités de la grille)

// Variante « calée sur la grille de pixels » pour 16 px (1 px = 16 unités) :
// barres de 3 px séparées par 1 px, pour éviter les bords flous.
const BARRES_16 = [
  { x: 32, y: 160, w: 48, h: 48, r: 6 },
  { x: 96, y: 128, w: 48, h: 80, r: 6 },
  { x: 160, y: 96, w: 48, h: 112, r: 6 },
];
const COCHE_PTS_16 = [[166, 56], [182, 72], [210, 36]];
const COCHE_EP_16 = 28;
const LISERE_EP_16 = 16; // 1 px exactement à 16 px

// --- Raster : couverture par suréchantillonnage ---
function dansRect(px, py, { x, y, w, h, r }) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}
function distSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function dansCoche(px, py, pts, ep) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distSegment(px, py, pts[i], pts[i + 1]) <= ep / 2) return true;
  }
  return false;
}
// Renvoie la couleur (r,g,b) et l'opacité d'un point (dessin de bas en haut)
function echantillon(px, py, petit) {
  if (!dansRect(px, py, TUILE)) return null;
  if (petit ? dansCoche(px, py, COCHE_PTS_16, COCHE_EP_16) : dansCoche(px, py, COCHE_PTS, COCHE_EP)) return COCHE;
  for (const b of petit ? BARRES_16 : BARRES) if (dansRect(px, py, b)) return BARRE;
  const e = petit ? LISERE_EP_16 : LISERE_EP;
  if (!dansRect(px, py, { x: TUILE.x + e, y: TUILE.y + e, w: TUILE.w - 2 * e, h: TUILE.h - 2 * e, r: TUILE.r - e })) return LISERE_MELANGE;
  return FOND;
}
function rendre(taille, ss = 8) {
  const px = Buffer.alloc(taille * taille * 4);
  const k = 256 / taille;
  for (let j = 0; j < taille; j++) {
    for (let i = 0; i < taille; i++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const c = echantillon((i + (si + 0.5) / ss) * k, (j + (sj + 0.5) / ss) * k, taille <= 16);
          if (c) { r += c[0]; g += c[1]; b += c[2]; n++; }
        }
      }
      const o = (j * taille + i) * 4;
      if (n) { px[o] = Math.round(r / n); px[o + 1] = Math.round(g / n); px[o + 2] = Math.round(b / n); }
      px[o + 3] = Math.round((255 * n) / (ss * ss)); // RGB non prémultiplié
    }
  }
  return px;
}

// --- PNG ---
const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const v of buf) c = TABLE_CRC[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function bloc(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(taille) {
  const rgba = rendre(taille);
  const brut = Buffer.alloc((taille * 4 + 1) * taille);
  for (let j = 0; j < taille; j++) {
    brut[j * (taille * 4 + 1)] = 0;
    rgba.copy(brut, j * (taille * 4 + 1) + 1, j * taille * 4, (j + 1) * taille * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut, { level: 9 })), bloc('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO (images PNG) ---
function ico(tailles) {
  const images = tailles.map(png);
  const entete = Buffer.alloc(6 + 16 * tailles.length);
  entete.writeUInt16LE(0, 0); entete.writeUInt16LE(1, 2); entete.writeUInt16LE(tailles.length, 4);
  let offset = entete.length;
  tailles.forEach((t, i) => {
    const o = 6 + 16 * i;
    entete[o] = t === 256 ? 0 : t; entete[o + 1] = t === 256 ? 0 : t;
    entete.writeUInt16LE(1, o + 4); entete.writeUInt16LE(32, o + 6);
    entete.writeUInt32LE(images[i].length, o + 8); entete.writeUInt32LE(offset, o + 12);
    offset += images[i].length;
  });
  return Buffer.concat([entete, ...images]);
}

// --- SVG ---
function svg() {
  const rect = (b, fill) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.r}" fill="${fill}"/>`;
  const pts = COCHE_PTS.map((p) => p.join(' ')).join(' L');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="Suivi de facturation : trois barres ascendantes et une coche">
  ${rect(TUILE, hex(FOND))}
  <rect x="${LISERE_EP / 2}" y="${LISERE_EP / 2}" width="${256 - LISERE_EP}" height="${256 - LISERE_EP}" rx="${TUILE.r - LISERE_EP / 2}" fill="none" stroke="${hex(LISERE)}" stroke-opacity="${LISERE_OPACITE}" stroke-width="${LISERE_EP}"/>
  ${BARRES.map((b) => '  ' + rect(b, hex(BARRE))).join('\n  ').trimStart()}
  <path d="M${pts}" fill="none" stroke="${hex(COCHE)}" stroke-width="${COCHE_EP}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

writeFileSync(join(DOSSIER, 'logo.svg'), svg());
writeFileSync(join(DOSSIER, 'logo-512.png'), png(512));
writeFileSync(join(DOSSIER, 'suivi-facturation.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
console.log('logo.svg, logo-512.png et suivi-facturation.ico écrits dans', DOSSIER);

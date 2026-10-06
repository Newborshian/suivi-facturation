// Serveur statique de public/ : liste blanche d'extensions, refus de tout chemin suspect (path traversal).
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ErreurApp } from '../erreurs.js';

const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const NOMS_RESERVES_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const introuvable = () => new ErreurApp(404, 'INTROUVABLE', 'Page introuvable.');

/**
 * Valide un chemin de requête brut (sans query) et renvoie les segments à joindre à la racine,
 * ou lève 404. Refus : encodage invalide, `..`, antislash, octet nul, segment commençant par `.`,
 * `:` (flux alternatifs NTFS), noms réservés Windows, point ou espace final.
 */
export function segmentsSurs(cheminBrut) {
  if (!cheminBrut.startsWith('/') || cheminBrut.includes('\\')) throw introuvable();
  let decode;
  try {
    decode = decodeURIComponent(cheminBrut);
  } catch {
    throw introuvable();
  }
  if (decode.includes('\0') || decode.includes('\\') || decode.includes('..')) throw introuvable();
  const segments = decode.split('/').slice(1);
  if (segments.length === 1 && segments[0] === '') return ['index.html'];
  for (const segment of segments) {
    if (
      segment === '' ||
      segment.startsWith('.') ||
      segment.includes(':') ||
      /[. ]$/.test(segment) ||
      NOMS_RESERVES_WINDOWS.test(segment.split('.')[0]) ||
      /[\u0000-\u001f]/.test(segment)
    ) {
      throw introuvable();
    }
  }
  return segments;
}

function estDans(parent, enfant) {
  const rel = path.relative(parent, enfant);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Sert un fichier de `racine` (public/). Lève une ErreurApp 404 en cas de refus. */
export async function servirStatique(req, res, cheminBrut, racine, { fs = fsp } = {}) {
  const segments = segmentsSurs(cheminBrut);
  const extension = path.extname(segments[segments.length - 1]).toLowerCase();
  const type = TYPES_MIME[extension];
  if (!type) throw introuvable();

  let reel;
  let racineReelle;
  try {
    racineReelle = await fs.realpath(racine);
    reel = await fs.realpath(path.join(racineReelle, ...segments)); // résout aussi les liens symboliques
  } catch {
    throw introuvable();
  }
  if (!estDans(racineReelle, reel)) throw introuvable();

  let contenu;
  try {
    if (!(await fs.stat(reel)).isFile()) throw introuvable();
    contenu = await fs.readFile(reel);
  } catch {
    throw introuvable();
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Length', contenu.length);
  res.end(req.method === 'HEAD' ? undefined : contenu);
}

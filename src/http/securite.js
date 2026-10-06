// Contrôles Host / Sec-Fetch-Site / Origin et en-têtes de sécurité (architecture §10.1 et §10.2).
import { ErreurApp } from '../erreurs.js';

export const EN_TETES_SECURITE = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

const METHODES_LECTURE = new Set(['GET', 'HEAD']);
export const METHODES_ACCEPTEES = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']);

export function appliquerEntetes(res) {
  for (const [nom, valeur] of Object.entries(EN_TETES_SECURITE)) res.setHeader(nom, valeur);
}

/**
 * Contrôle une requête ; lève une ErreurApp (403 ou 405) si elle doit être refusée.
 * Ordre : Host (anti DNS rebinding), Sec-Fetch-Site, Origin (hors GET/HEAD), méthode.
 */
export function controlerRequete(req, port) {
  const hotes = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const hote = String(req.headers.host ?? '').toLowerCase();
  if (!hotes.has(hote)) {
    throw new ErreurApp(403, 'HOTE_REFUSE', 'Accès refusé : cette application ne répond que depuis cet ordinateur.');
  }

  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    throw new ErreurApp(403, 'ORIGINE_REFUSEE', 'Accès refusé : requête provenant d\'un autre site.');
  }

  if (!METHODES_LECTURE.has(req.method)) {
    const origine = req.headers.origin;
    const origines = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
    if (typeof origine !== 'string' || !origines.has(origine.toLowerCase())) {
      throw new ErreurApp(403, 'ORIGINE_REFUSEE', 'Accès refusé : origine de la requête non autorisée.');
    }
  }

  if (!METHODES_ACCEPTEES.has(req.method)) {
    throw new ErreurApp(405, 'METHODE_REFUSEE', 'Méthode non autorisée.');
  }
}

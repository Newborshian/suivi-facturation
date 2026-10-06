// Réponses JSON, erreurs au format unique (architecture §9.1 et §9.3) et lecture de corps bornée.
import { ErreurApp } from '../erreurs.js';

export const LIMITE_CORPS = 1024 * 1024; // 1 Mo

export function envoyerJson(res, status, corps, { sansCorps = false } = {}) {
  const texte = JSON.stringify(corps);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(texte));
  res.end(sansCorps ? undefined : texte);
}

/** Convertit toute erreur en { status, code, corps } ; les erreurs inattendues deviennent un 500 générique. */
export function enErreurHttp(err) {
  if (err instanceof ErreurApp) {
    const erreur = { code: err.code, message: err.message };
    if (err.champs) erreur.champs = err.champs;
    if (err.details) erreur.details = err.details;
    return { status: err.status, code: err.code, corps: { erreur } };
  }
  return {
    status: 500,
    code: 'ERREUR_INTERNE',
    corps: { erreur: { code: 'ERREUR_INTERNE', message: "Une erreur interne s'est produite. Rien n'a été modifié." } },
  };
}

/**
 * Lit un corps JSON : Content-Type application/json obligatoire (415), 1 Mo maximum (413), JSON valide
 * de type objet (400). Le gestionnaire de route ne reçoit jamais de corps non vérifié.
 */
export async function lireCorpsJson(req, { limite = LIMITE_CORPS, types = ['application/json'] } = {}) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!types.includes(type)) {
    req.resume();
    throw new ErreurApp(415, 'TYPE_CONTENU', 'Le contenu de la requête doit être au format JSON.');
  }
  const annonce = Number(req.headers['content-length']);
  if (Number.isFinite(annonce) && annonce > limite) {
    req.resume();
    throw new ErreurApp(413, 'TROP_VOLUMINEUX', 'La requête est trop volumineuse.');
  }
  // Lecture par événements (et non `for await`) : lever une erreur en cours de route détruirait la
  // connexion avant que la réponse 413 ne soit lue par le client. Ici le corps est toujours vidé.
  const corps = await new Promise((resolve, reject) => {
    const morceaux = [];
    let total = 0;
    let trop = false;
    req.on('data', (morceau) => {
      if (trop) return;
      total += morceau.length;
      if (total > limite) {
        trop = true;
        morceaux.length = 0;
        return;
      }
      morceaux.push(morceau);
    });
    req.on('end', () => (trop ? reject(new ErreurApp(413, 'TROP_VOLUMINEUX', 'La requête est trop volumineuse.')) : resolve(Buffer.concat(morceaux))));
    req.on('error', reject);
  });
  let donnees;
  try {
    donnees = JSON.parse(corps.toString('utf8'));
  } catch {
    throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Le contenu de la requête n\'est pas du JSON valide.');
  }
  if (typeof donnees !== 'object' || donnees === null || Array.isArray(donnees)) {
    throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Le contenu de la requête doit être un objet JSON.');
  }
  return donnees;
}

/**
 * Vide un corps que la route n'attend pas (jamais lu ni conservé) en refusant d'en recevoir plus que `limite` octets :
 * au-delà, la connexion est fermée (un client normal n'envoie rien ou presque rien à ces routes).
 */
export function ignorerCorps(req, limite = LIMITE_CORPS) {
  let total = 0;
  req.on('data', (morceau) => {
    total += morceau.length;
    if (total > limite) req.destroy();
  });
  req.resume();
}

/** Corps JSON facultatif (ex. « Payé en totalité ») : absent = objet vide ; présent = mêmes contrôles que lireCorpsJson. */
export async function lireCorpsOptionnel(req, options) {
  const vide = !req.headers['transfer-encoding'] && Number(req.headers['content-length'] ?? 0) === 0;
  if (vide) {
    req.resume();
    return {};
  }
  return lireCorpsJson(req, options);
}

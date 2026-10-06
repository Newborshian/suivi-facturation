// Client de l'API locale (même origine). Les erreurs portent le code et le message français du serveur.
export class ErreurApi extends Error {
  constructor(status, code, message, champs, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.champs = champs;
    this.details = details;
  }
}

export async function appeler(methode, chemin, corps) {
  const options = { method: methode, headers: {} };
  if (corps !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(corps);
  }
  let reponse;
  try {
    reponse = await fetch(chemin, options);
  } catch {
    throw new ErreurApi(0, 'RESEAU', "L'application ne répond pas. Vérifiez qu'elle est bien lancée.");
  }
  let donnees = null;
  try {
    donnees = await reponse.json();
  } catch {
    // corps vide ou non JSON
  }
  if (!reponse.ok) {
    const e = donnees?.erreur;
    throw new ErreurApi(reponse.status, e?.code ?? 'ERREUR', e?.message ?? 'Une erreur est survenue.', e?.champs, e?.details);
  }
  return donnees;
}

export const lireEtat = () => appeler('GET', '/api/etat');

/**
 * Télécharge un fichier produit par l'API (export) : -> { blob, nom }. Une erreur de l'API (JSON) devient une ErreurApi
 * lisible au lieu d'un fichier d'erreur téléchargé.
 */
export async function telecharger(chemin) {
  let reponse;
  try {
    reponse = await fetch(chemin);
  } catch {
    throw new ErreurApi(0, 'RESEAU', "L'application ne répond pas. Vérifiez qu'elle est bien lancée.");
  }
  if (!reponse.ok) {
    let e = null;
    try {
      e = (await reponse.json()).erreur;
    } catch {
      // corps non JSON
    }
    throw new ErreurApi(reponse.status, e?.code ?? 'ERREUR', e?.message ?? "L'export a échoué.", e?.champs, e?.details);
  }
  const nom = /filename="([^"]+)"/.exec(reponse.headers.get('Content-Disposition') ?? '')?.[1] ?? 'export';
  return { blob: await reponse.blob(), nom };
}

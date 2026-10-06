// Patients : clé de comparaison, liste dérivée des lignes, rattachement et homonymes (architecture §6.3).
// Module pur. Le patient est intégré à chaque ligne ({id, nom, prenom}) ; il n'existe pas de table de patients.
import { ErreurApp } from '../erreurs.js';

/** Espaces de bord retirés, espaces internes réduits à un, NFC. Conserve la casse et les accents saisis. */
export function normaliserTexte(texte) {
  return String(texte).normalize('NFC').trim().replace(/\s+/g, ' ');
}

const cle = (texte) => normaliserTexte(texte).toLocaleLowerCase('fr');

/** Clé de comparaison nom + prénom : insensible à la casse et aux espaces, sensible aux accents. */
export function clePatient(nom, prenom) {
  return `${cle(nom)}\u0000${cle(prenom)}`;
}

const plusRecente = (a, b) => (a.date !== b.date ? a.date > b.date : a.creeLe >= b.creeLe);

/** Patients dérivés des lignes : { id, nom, prenom, dernierePrestation } ; nom affiché = celui de la ligne la plus récente. Tri nom, prénom. */
export function listerPatients(prestations) {
  const parId = new Map();
  for (const ligne of prestations) {
    const courant = parId.get(ligne.patient.id);
    if (!courant || plusRecente(ligne, courant.ligne)) {
      parId.set(ligne.patient.id, { ligne, id: ligne.patient.id });
    }
  }
  return [...parId.values()]
    .map(({ ligne }) => ({ id: ligne.patient.id, nom: ligne.patient.nom, prenom: ligne.patient.prenom, dernierePrestation: ligne.date }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr') || a.id.localeCompare(b.id));
}

/**
 * Détermine le patient d'une ligne. `identite` = { patientId } | { nom, prenom, nouveau? } (déjà validée).
 *  - patientId : doit exister ;
 *  - nouveau : crée un patient distinct, même si la clé existe (homonyme assumé) ;
 *  - 0 patient de même clé : nouveau patient ; 1 : rattachement (avertissement PATIENT_RATTACHE si le texte saisi
 *    diffère de l'écriture existante) ; plusieurs : 409 PATIENTS_HOMONYMES avec les candidats (id + date, sans nom).
 * -> { patient: {id, nom, prenom}, avertissements }
 */
export function resoudrePatient(prestations, identite, nouvelId) {
  const patients = listerPatients(prestations);
  if (identite.patientId !== undefined) {
    const trouve = patients.find((p) => p.id === identite.patientId);
    if (!trouve) throw new ErreurApp(422, 'VALIDATION', 'Ce patient n\'existe pas.', { patientId: 'Ce patient n\'existe pas.' });
    return { patient: { id: trouve.id, nom: trouve.nom, prenom: trouve.prenom }, avertissements: [] };
  }
  const nom = normaliserTexte(identite.nom);
  const prenom = normaliserTexte(identite.prenom);
  if (identite.nouveau) return { patient: { id: nouvelId(), nom, prenom }, avertissements: [] };

  const cleSaisie = clePatient(nom, prenom);
  const candidats = patients.filter((p) => clePatient(p.nom, p.prenom) === cleSaisie);
  if (candidats.length === 0) return { patient: { id: nouvelId(), nom, prenom }, avertissements: [] };
  if (candidats.length > 1) {
    throw new ErreurApp(
      409,
      'PATIENTS_HOMONYMES',
      'Plusieurs patients portent ce nom : choisissez le bon patient, ou créez-en un nouveau.',
      undefined,
      { candidats: candidats.map((p) => ({ id: p.id, dernierePrestation: p.dernierePrestation })) },
    );
  }
  const [existant] = candidats;
  const avertissements = [];
  if (existant.nom !== nom || existant.prenom !== prenom) {
    avertissements.push({ code: 'PATIENT_RATTACHE', message: `Prestation rattachée au patient déjà saisi « ${existant.prenom} ${existant.nom} ».` });
  }
  return { patient: { id: existant.id, nom, prenom }, avertissements };
}

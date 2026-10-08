// Patients : clé de comparaison, registre, rattachement et homonymes (architecture §5 et §6.3).
// Module pur. Le registre `etat.patients` ({ id, nom, prenom, actif }) est la source de vérité de l'identité ; chaque prestation
// garde une copie `patient: { id, nom, prenom }` tenue identique à celle du registre par les fonctions de ce module.
// Les fonctions qui reçoivent `etat` modifient la COPIE de travail fournie par store.muter (jamais l'état gelé en mémoire).
import { ErreurApp } from '../erreurs.js';
import { etatPaiement } from './paiement.js';
import { validerPatientCreation, validerPatientModification } from './validation.js';

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
const estTexteNonVide = (v) => typeof v === 'string' && v.trim() !== '';
const copieDe = (p) => ({ id: p.id, nom: p.nom, prenom: p.prenom });
const comparer = (a, b) => a.nom.localeCompare(b.nom, 'fr') || a.prenom.localeCompare(b.prenom, 'fr') || a.id.localeCompare(b.id);

/** Registre trié nom, prénom (collation `fr`), puis identifiant : sortie déterministe, diffs lisibles. Renvoie un nouveau tableau. */
export function trierRegistre(patients) {
  return [...patients].sort(comparer);
}

/** Date de la dernière prestation (AAAA-MM-JJ) de chaque patient : Map<id, date>. */
function dernieresDates(prestations) {
  const dates = new Map();
  for (const l of prestations) {
    const id = l?.patient?.id;
    if (typeof id !== 'string') continue;
    if (!dates.has(id) || l.date > dates.get(id)) dates.set(id, l.date);
  }
  return dates;
}

/**
 * Reconstruit (ou complète) le registre à partir des prestations : migration 1 -> 2 et réparation. Pure, idempotente.
 *  1. lignes groupées par `patient.id` ; les lignes sans identifiant exploitable sont ignorées (le contrôle de structure les refusera) ;
 *  2. pour un identifiant absent du registre : ligne de référence = la plus récente (date, puis `creeLe`) ; nom et prénom = les siens,
 *     normalisés ; patient créé ACTIF (jamais d'archivage d'office) ; un patient déjà au registre n'est jamais modifié ;
 *  3. copies alignées : toute ligne dont la clé est égale à celle du registre reçoit l'écriture du registre. Une ligne de clé
 *     différente sous le même identifiant n'est pas touchée (elle reste signalée comme copie divergente) ;
 *  4. `modifieLe` des lignes n'est jamais changé (ce n'est pas une saisie).
 * -> { patients (triés), prestations (nouveau tableau, lignes inchangées conservées telles quelles), patientsAjoutes, copiesAlignees }
 */
export function reconstruireRegistre(prestations, registre = []) {
  const parId = new Map(registre.map((p) => [p.id, p]));
  const references = new Map();
  for (const l of prestations) {
    const id = l?.patient?.id;
    if (!estTexteNonVide(id) || parId.has(id)) continue;
    const courante = references.get(id);
    if (!courante || plusRecente(l, courante)) references.set(id, l);
  }
  const ajoutes = [];
  for (const [id, l] of references) {
    const texte = (v) => (typeof v === 'string' ? normaliserTexte(v) : '');
    const patient = { id, nom: texte(l.patient.nom), prenom: texte(l.patient.prenom), actif: true };
    ajoutes.push(patient);
    parId.set(id, patient);
  }
  let copiesAlignees = 0;
  const lignes = prestations.map((l) => {
    const p = parId.get(l?.patient?.id);
    if (!p || clePatient(l.patient.nom ?? '', l.patient.prenom ?? '') !== clePatient(p.nom, p.prenom)) return l;
    if (l.patient.nom === p.nom && l.patient.prenom === p.prenom) return l;
    copiesAlignees += 1;
    return { ...l, patient: copieDe(p) };
  });
  return { patients: trierRegistre([...registre, ...ajoutes]), prestations: lignes, patientsAjoutes: ajoutes.length, copiesAlignees };
}

/**
 * Registre enrichi : { id, nom, prenom, actif, nombrePrestations, dernierePrestation (date | null), homonyme, supprimable }, tri nom, prénom.
 * `utilisesArchives` = { ids: Set d'identifiants présents dans les archives lisibles, illisibles: bool } : un patient n'est supprimable
 * que s'il n'a aucune prestation (fichier actif ou archive) et si aucune archive n'est illisible. « Homonyme » est calculé, jamais stocké.
 */
export function listerPatients(etat, { utilisesArchives = { ids: new Set(), illisibles: false } } = {}) {
  const nombres = new Map();
  for (const l of etat.prestations) nombres.set(l.patient.id, (nombres.get(l.patient.id) ?? 0) + 1);
  const dates = dernieresDates(etat.prestations);
  const effectifs = new Map();
  for (const p of etat.patients) effectifs.set(clePatient(p.nom, p.prenom), (effectifs.get(clePatient(p.nom, p.prenom)) ?? 0) + 1);
  return trierRegistre(etat.patients).map((p) => {
    const nombrePrestations = nombres.get(p.id) ?? 0;
    return {
      id: p.id,
      nom: p.nom,
      prenom: p.prenom,
      actif: p.actif,
      nombrePrestations,
      dernierePrestation: dates.get(p.id) ?? null,
      homonyme: effectifs.get(clePatient(p.nom, p.prenom)) > 1,
      supprimable: nombrePrestations === 0 && !utilisesArchives.ids.has(p.id) && !utilisesArchives.illisibles,
    };
  });
}

const candidatsDe = (etat, patients) => {
  const dates = dernieresDates(etat.prestations);
  return trierRegistre(patients).map((p) => ({ id: p.id, dernierePrestation: dates.get(p.id) ?? null }));
};

const patientExistant = (etat, patients) => new ErreurApp(
  409,
  'PATIENT_EXISTANT',
  'Un patient porte déjà ce nom et ce prénom. Utilisez-le, ou confirmez la création d\'un homonyme.',
  undefined,
  { candidats: candidatsDe(etat, patients) },
);

const introuvable = () => new ErreurApp(404, 'INTROUVABLE', 'Ce patient est introuvable (il a peut-être été supprimé).');

function reactiver(patient, avertissements) {
  if (patient.actif) return;
  patient.actif = true;
  avertissements.push({ code: 'PATIENT_REACTIVE', message: `Le patient « ${patient.prenom} ${patient.nom} » était archivé : il a été réactivé.` });
}

function ajouterAuRegistre(etat, patient) {
  etat.patients.push(patient);
  etat.patients.sort(comparer);
}

/**
 * Détermine le patient d'une ligne, dans le REGISTRE. `identite` = { patientId } | { nom, prenom, nouveau? } (déjà validée).
 *  - patientId : doit exister (sinon 422) ; archivé -> réactivé, avertissement PATIENT_REACTIVE ;
 *  - nouveau : crée un patient distinct, même si la clé existe (homonyme assumé), ajouté au registre ;
 *  - par nom : 0 patient de même clé -> ajouté au registre ; 1 -> rattachement (archivé -> réactivé ; avertissement PATIENT_RATTACHE si
 *    le texte saisi diffère de l'écriture du registre) ; plusieurs -> 409 PATIENTS_HOMONYMES (id + date de dernière prestation, sans nom).
 *    Les patients sans prestation et archivés comptent comme candidats.
 * La copie renvoyée (à poser dans la ligne) est TOUJOURS l'écriture du registre. Modifie `etat.patients` (ajout, réactivation).
 * -> { patient: {id, nom, prenom}, avertissements }
 */
export function resoudrePatient(etat, identite, ctx) {
  const avertissements = [];
  if (identite.patientId !== undefined) {
    const trouve = etat.patients.find((p) => p.id === identite.patientId);
    if (!trouve) throw new ErreurApp(422, 'VALIDATION', 'Ce patient n\'existe pas.', { patientId: 'Ce patient n\'existe pas.' });
    reactiver(trouve, avertissements);
    return { patient: copieDe(trouve), avertissements };
  }
  const nom = normaliserTexte(identite.nom);
  const prenom = normaliserTexte(identite.prenom);
  const creer = () => {
    const patient = { id: ctx.nouvelId(), nom, prenom, actif: true };
    ajouterAuRegistre(etat, patient);
    return { patient: copieDe(patient), avertissements };
  };
  if (identite.nouveau) return creer();

  const cleSaisie = clePatient(nom, prenom);
  const candidats = etat.patients.filter((p) => clePatient(p.nom, p.prenom) === cleSaisie);
  if (candidats.length === 0) return creer();
  if (candidats.length > 1) {
    throw new ErreurApp(
      409,
      'PATIENTS_HOMONYMES',
      'Plusieurs patients portent ce nom : choisissez le bon patient, ou créez-en un nouveau.',
      undefined,
      { candidats: candidatsDe(etat, candidats) },
    );
  }
  const [existant] = candidats;
  if (existant.nom !== nom || existant.prenom !== prenom) {
    avertissements.push({ code: 'PATIENT_RATTACHE', message: `Prestation rattachée au patient déjà saisi « ${existant.prenom} ${existant.nom} ».` });
  }
  reactiver(existant, avertissements);
  return { patient: copieDe(existant), avertissements };
}

/**
 * Renomme un patient du registre et propage le nouveau nom aux lignes du fichier actif dont la copie diffère (leur `modifieLe` est mis à jour).
 * Sans effet si l'écriture est déjà celle du registre. Si un AUTRE patient porte la même clé : 409 PATIENT_EXISTANT, sauf `homonyme`
 * (alors avertissement PATIENT_HOMONYME). Un simple changement de casse ou d'espaces n'est jamais soumis à confirmation.
 * -> { patient, lignesModifiees, avertissements }
 */
export function renommerPatient(etat, id, { nom, prenom }, ctx, { homonyme = false } = {}) {
  const patient = etat.patients.find((p) => p.id === id);
  if (!patient) throw introuvable();
  const nouveauNom = normaliserTexte(nom);
  const nouveauPrenom = normaliserTexte(prenom);
  const avertissements = [];
  const cleChangee = clePatient(nouveauNom, nouveauPrenom) !== clePatient(patient.nom, patient.prenom);
  const autres = !cleChangee ? [] : etat.patients.filter((p) => p.id !== id && clePatient(p.nom, p.prenom) === clePatient(nouveauNom, nouveauPrenom));
  if (autres.length > 0) {
    if (!homonyme) throw patientExistant(etat, autres);
    avertissements.push({ code: 'PATIENT_HOMONYME', message: 'Un autre patient porte déjà ce nom et ce prénom : ils seront à distinguer lors des prochaines saisies.' });
  }
  patient.nom = nouveauNom;
  patient.prenom = nouveauPrenom;
  etat.patients.sort(comparer);
  let lignesModifiees = 0;
  for (const l of etat.prestations) {
    if (l.patient.id !== id || (l.patient.nom === nouveauNom && l.patient.prenom === nouveauPrenom)) continue;
    l.patient = copieDe(patient);
    l.modifieLe = ctx.maintenant;
    lignesModifiees += 1;
  }
  return { patient: { ...patient }, lignesModifiees, avertissements };
}

/** Ligne orpheline (patient absent du registre, état toléré) : l'ajoute au registre, actif, avec l'écriture de la ligne, avant une opération qui en a besoin. */
export function assurerAuRegistre(etat, patient) {
  if (etat.patients.some((p) => p.id === patient.id)) return;
  ajouterAuRegistre(etat, { id: patient.id, nom: normaliserTexte(patient.nom), prenom: normaliserTexte(patient.prenom), actif: true });
}

/** Crée un patient (sans prestation). 409 PATIENT_EXISTANT si la clé existe déjà (actif ou archivé), sauf `homonyme: true`. -> { resultat: patient, avertissements } */
export function creerPatient(etat, corps, ctx) {
  const v = validerPatientCreation(corps);
  const memeCle = etat.patients.filter((p) => clePatient(p.nom, p.prenom) === clePatient(v.nom, v.prenom));
  if (memeCle.length > 0 && !v.homonyme) throw patientExistant(etat, memeCle);
  const patient = { id: ctx.nouvelId(), nom: v.nom, prenom: v.prenom, actif: true };
  ajouterAuRegistre(etat, patient);
  return { resultat: { ...patient }, avertissements: [] };
}

/**
 * Modifie un patient : renommage (propagé aux lignes) et/ou archivage / réactivation (`actif`, idempotent).
 * Archiver un patient qui a des prestations à venir ou un reste à payer : autorisé, avertissement PATIENT_ARCHIVE_EN_COURS avec les nombres.
 * -> { resultat: { patient, lignesModifiees }, avertissements }
 */
export function modifierPatient(etat, id, corps, ctx) {
  const patient = etat.patients.find((p) => p.id === id);
  if (!patient) throw introuvable();
  const v = validerPatientModification(corps);
  const avertissements = [];
  let lignesModifiees = 0;
  if (v.nom !== undefined || v.prenom !== undefined) {
    const r = renommerPatient(etat, id, { nom: v.nom ?? patient.nom, prenom: v.prenom ?? patient.prenom }, ctx, { homonyme: v.homonyme });
    lignesModifiees = r.lignesModifiees;
    avertissements.push(...r.avertissements);
  }
  if (v.actif !== undefined && v.actif !== patient.actif) {
    patient.actif = v.actif;
    if (!v.actif) {
      const siennes = etat.prestations.filter((l) => l.patient.id === id);
      const aVenir = siennes.filter((l) => l.date > ctx.aujourdHui).length;
      const impayees = siennes.filter((l) => etatPaiement(l).resteCentimes > 0).length;
      if (aVenir > 0 || impayees > 0) {
        avertissements.push({
          code: 'PATIENT_ARCHIVE_EN_COURS',
          message: `Ce patient a ${aVenir} prestation${aVenir > 1 ? 's' : ''} à venir et ${impayees} prestation${impayees > 1 ? 's' : ''} avec un reste à payer : elles restent visibles partout.`,
          details: { aVenir, impayees },
        });
      }
    }
  }
  return { resultat: { patient: { ...patient }, lignesModifiees }, avertissements };
}

/**
 * Supprime un patient sans prestation. 404 s'il n'existe pas ; 409 PATIENT_UTILISE si une ligne du fichier actif ou d'une archive lisible
 * le référence, ou si une archive est illisible (on ne peut pas garantir qu'il n'y est pas). `utilisesArchives` : voir listerPatients.
 */
export function supprimerPatient(etat, id, utilisesArchives = { ids: new Set(), illisibles: false }) {
  const i = etat.patients.findIndex((p) => p.id === id);
  if (i < 0) throw introuvable();
  if (etat.prestations.some((l) => l.patient.id === id) || utilisesArchives.ids.has(id) || utilisesArchives.illisibles) {
    throw new ErreurApp(409, 'PATIENT_UTILISE', 'Ce patient a des prestations (ou une archive ne peut pas être lue) : il ne peut pas être supprimé. Archivez-le plutôt.');
  }
  const [supprime] = etat.patients.splice(i, 1);
  return { resultat: { id: supprime.id }, avertissements: [] };
}

/** Réparation : ajoute au registre les patients manquants et aligne les copies (mêmes règles que la migration). Rien à faire = état inchangé. */
export function reparerPatients(etat) {
  const r = reconstruireRegistre(etat.prestations, etat.patients);
  if (r.patientsAjoutes > 0 || r.copiesAlignees > 0) {
    etat.patients = r.patients;
    etat.prestations = r.prestations;
  }
  return { resultat: { patientsAjoutes: r.patientsAjoutes, copiesAlignees: r.copiesAlignees }, avertissements: [] };
}

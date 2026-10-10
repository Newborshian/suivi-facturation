// Schéma JSON versionné : version courante, état initial, migrations, contrôle de structure. Module pur.
import { estDateCivile } from './dates.js';
import { estMontantPrestation, estMontantVersement } from './money.js';
import { reconstruireRegistre } from './patients.js';
import { CARACTERES_INVISIBLES, LONGUEUR_NOM } from './validation.js';

export const FORMAT = 'suivi-facturation';
export const VERSION_COURANTE = 2;
export const CATEGORIES = ['seance', 'bilan', 'autre'];
export const STATUTS = ['a_facturer', 'facture'];
export const MODES_PAIEMENT = ['carte', 'cheque', 'especes', 'virement', 'autre'];

/**
 * Migration 1 -> 2 : crée le registre des patients (un patient actif par identifiant de patient des lignes) et aligne les copies
 * (architecture §5.3). Pure : ni horloge ni E/S ; le champ modifieLe des lignes n'est pas touché. Lève une Error si les prestations manquent.
 */
export function migrerV1VersV2(etat) {
  if (!Array.isArray(etat.prestations)) throw new Error('prestations absentes.');
  const { prestations: lignes, ...reste } = etat;
  const { patients, prestations } = reconstruireRegistre(lignes);
  return { ...reste, patients, prestations };
}

/** Migrations : MIGRATIONS[n] transforme un état de version n en version n+1 (fonction pure). */
export const MIGRATIONS = { 1: migrerV1VersV2 };

/** État d'un fichier créé neuf : catalogue VIDE (l'utilisatrice définit ses prestations dans Paramètres → Tarifs). Les fichiers existants gardent le leur. */
export function creerEtatInitial(maintenant) {
  return {
    format: FORMAT,
    schemaVersion: VERSION_COURANTE,
    revision: 0,
    majLe: maintenant.toISOString(),
    parametres: { sauvegardesConservees: 30, dernierModePaiement: null },
    catalogue: [],
    patients: [],
    prestations: [],
  };
}

/**
 * Applique les migrations successives sur une copie. Lève une Error si une étape manque
 * ou si la version est plus récente que la cible.
 */
export function migrer(etat, migrations = MIGRATIONS, cible = VERSION_COURANTE) {
  if (etat.schemaVersion > cible) throw new Error('Version plus récente que la version connue.');
  let courant = structuredClone(etat);
  while (courant.schemaVersion < cible) {
    const version = courant.schemaVersion;
    const etape = migrations[version];
    if (typeof etape !== 'function') throw new Error(`Aucune migration depuis la version ${version}.`);
    courant = etape(courant);
    courant.schemaVersion = version + 1;
  }
  return courant;
}

const estObjet = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const estTexte = (v) => typeof v === 'string';
const estTexteNonVide = (v) => typeof v === 'string' && v.trim() !== '';
const estEntier = (v) => Number.isSafeInteger(v);

/**
 * Contrôle la structure d'un état de version courante : types, énumérations, unicité des `id`,
 * centimes entiers. Renvoie la liste des problèmes (vide = valide). Les messages ne contiennent
 * aucune valeur issue des données.
 */
export function controlerStructure(etat) {
  const pb = [];
  if (!estObjet(etat)) return ['L\'état n\'est pas un objet.'];
  if (etat.format !== FORMAT) pb.push('format inconnu');
  if (!estEntier(etat.schemaVersion)) pb.push('schemaVersion invalide');
  if (!estEntier(etat.revision) || etat.revision < 0) pb.push('revision invalide');
  if (!estTexte(etat.majLe)) pb.push('majLe invalide');

  const p = etat.parametres;
  if (!estObjet(p)) pb.push('parametres invalide');
  else {
    if (!estEntier(p.sauvegardesConservees) || p.sauvegardesConservees < 1) pb.push('parametres.sauvegardesConservees invalide');
    if (p.dernierModePaiement !== null && !MODES_PAIEMENT.includes(p.dernierModePaiement)) pb.push('parametres.dernierModePaiement invalide');
  }

  const idsCatalogue = new Set();
  if (!Array.isArray(etat.catalogue)) pb.push('catalogue invalide');
  else {
    etat.catalogue.forEach((c, i) => {
      const o = `catalogue[${i}]`;
      if (!estObjet(c)) return pb.push(`${o} invalide`);
      if (!estTexteNonVide(c.id) || idsCatalogue.has(c.id)) pb.push(`${o}.id invalide ou en double`);
      idsCatalogue.add(c.id);
      if (!estTexteNonVide(c.libelle)) pb.push(`${o}.libelle invalide`);
      if (!estMontantPrestation(c.tarifCentimes)) pb.push(`${o}.tarifCentimes invalide`);
      if (!CATEGORIES.includes(c.categorie)) pb.push(`${o}.categorie invalide`);
      if (typeof c.actif !== 'boolean') pb.push(`${o}.actif invalide`);
      if (!estEntier(c.ordre)) pb.push(`${o}.ordre invalide`);
    });
  }

  if (!Array.isArray(etat.patients)) pb.push('patients invalide');
  else {
    const idsPatients = new Set();
    etat.patients.forEach((p, i) => {
      const o = `patients[${i}]`;
      if (!estObjet(p)) return pb.push(`${o} invalide`);
      if (!estTexteNonVide(p.id) || idsPatients.has(p.id)) pb.push(`${o}.id invalide ou en double`);
      idsPatients.add(p.id);
      if (!estTexteNonVide(p.nom)) pb.push(`${o}.nom invalide`);
      if (!estTexteNonVide(p.prenom)) pb.push(`${o}.prenom invalide`);
      if (typeof p.actif !== 'boolean') pb.push(`${o}.actif invalide`);
    });
  }

  if (!Array.isArray(etat.prestations)) pb.push('prestations invalide');
  else {
    const ids = new Set();
    const idsVersements = new Set();
    etat.prestations.forEach((l, i) => {
      const o = `prestations[${i}]`;
      if (!estObjet(l)) return pb.push(`${o} invalide`);
      if (!estTexteNonVide(l.id) || ids.has(l.id)) pb.push(`${o}.id invalide ou en double`);
      ids.add(l.id);
      if (!estObjet(l.patient) || !estTexteNonVide(l.patient.id) || !estTexteNonVide(l.patient.nom) || !estTexteNonVide(l.patient.prenom)) pb.push(`${o}.patient invalide`);
      if (!estDateCivile(l.date)) pb.push(`${o}.date invalide`);
      if (!estTexteNonVide(l.prestationId)) pb.push(`${o}.prestationId invalide`);
      if (!estTexteNonVide(l.libelle)) pb.push(`${o}.libelle invalide`);
      if (!CATEGORIES.includes(l.categorie)) pb.push(`${o}.categorie invalide`);
      if (!estTexte(l.motif)) pb.push(`${o}.motif invalide`);
      if (!estMontantPrestation(l.montantCentimes)) pb.push(`${o}.montantCentimes invalide`);
      if (!STATUTS.includes(l.statut)) pb.push(`${o}.statut invalide`);
      if (l.factureLe !== null && !estDateCivile(l.factureLe)) pb.push(`${o}.factureLe invalide`);
      if (!estTexte(l.creeLe) || !estTexte(l.modifieLe)) pb.push(`${o} horodatages invalides`);
      if (!Array.isArray(l.versements)) pb.push(`${o}.versements invalide`);
      else {
        l.versements.forEach((v, k) => {
          const ov = `${o}.versements[${k}]`;
          if (!estObjet(v)) return pb.push(`${ov} invalide`);
          if (!estTexteNonVide(v.id) || idsVersements.has(v.id)) pb.push(`${ov}.id invalide ou en double`);
          idsVersements.add(v.id);
          if (!estMontantVersement(v.montantCentimes)) pb.push(`${ov}.montantCentimes invalide`);
          if (!estDateCivile(v.date)) pb.push(`${ov}.date invalide`);
          if (!MODES_PAIEMENT.includes(v.mode)) pb.push(`${ov}.mode invalide`);
        });
      }
    });
  }
  return pb;
}

/**
 * Incohérences tolérées mais à signaler : un fichier qui les contient reste lisible et modifiable, rien n'est corrigé en silence.
 * -> { factureSansDate, aFacturerAvecDate } (nombres de prestations concernées).
 */
export function compterIncoherencesStatut(etat) {
  let factureSansDate = 0;
  let aFacturerAvecDate = 0;
  for (const l of Array.isArray(etat?.prestations) ? etat.prestations : []) {
    if (l?.statut === 'facture' && l.factureLe === null) factureSansDate += 1;
    else if (l?.statut === 'a_facturer' && l.factureLe !== null && l.factureLe !== undefined) aFacturerAvecDate += 1;
  }
  return { factureSansDate, aFacturerAvecDate };
}

/**
 * Incohérences entre le registre et les copies des lignes (invariants I1 et I2, architecture §5.2) : tolérées, signalées, jamais corrigées en silence.
 * -> { orphelines (lignes dont le patient n'est pas au registre), copiesDivergentes (lignes dont nom ou prénom diffèrent du registre) }.
 */
export function compterIncoherencesPatients(etat) {
  const registre = new Map((Array.isArray(etat?.patients) ? etat.patients : []).map((p) => [p?.id, p]));
  let orphelines = 0;
  let copiesDivergentes = 0;
  for (const l of Array.isArray(etat?.prestations) ? etat.prestations : []) {
    const p = registre.get(l?.patient?.id);
    if (!p) orphelines += 1;
    else if (l.patient.nom !== p.nom || l.patient.prenom !== p.prenom) copiesDivergentes += 1;
  }
  return { orphelines, copiesDivergentes };
}

const CHAMPS_REGISTRE = ['id', 'nom', 'prenom', 'actif'];
const CHAMPS_COPIE = ['id', 'nom', 'prenom'];
const horsBornes = (texte) => typeof texte === 'string' && (texte.length > LONGUEUR_NOM || CARACTERES_INVISIBLES.test(texte));

/**
 * Anomalies d'identité tolérées mais à signaler (le registre ne doit contenir que id, nom, prénom, actif ; les copies des lignes que id, nom, prénom) :
 * un fichier retouché à la main ou fusionné par un client de synchronisation peut contenir autre chose. Le fichier reste lisible, rien n'est corrigé ni supprimé.
 * -> { champsInconnus (registre + copies avec un champ en trop), nomsHorsBornes (nom ou prénom de plus de 100 caractères ou avec caractère invisible) }.
 */
export function compterAnomaliesRegistre(etat) {
  let champsInconnus = 0;
  let nomsHorsBornes = 0;
  const examiner = (identite, champsAttendus) => {
    if (!estObjet(identite)) return;
    if (Object.keys(identite).some((c) => !champsAttendus.includes(c))) champsInconnus += 1;
    if (horsBornes(identite.nom) || horsBornes(identite.prenom)) nomsHorsBornes += 1;
  };
  for (const p of Array.isArray(etat?.patients) ? etat.patients : []) examiner(p, CHAMPS_REGISTRE);
  for (const l of Array.isArray(etat?.prestations) ? etat.prestations : []) examiner(l?.patient, CHAMPS_COPIE);
  return { champsInconnus, nomsHorsBornes };
}

// Validation des entrées de l'API (architecture §9). Module pur : lève ErreurApp (400 champ inconnu, 422 règle de saisie).
// Les montants arrivent en centimes entiers (la conversion « 45,50 » -> 4550 se fait dans le navigateur).
import { ErreurApp } from '../erreurs.js';
import { ajouterMois, estDateCivile, estMois, moisDe } from './dates.js';
import { GRANULARITES, PERIODE_MAX_MOIS, TRANCHES, VUES_CA, nombreMois } from './indicateurs.js';
import { MONTANT_PRESTATION_MAX, MONTANT_VERSEMENT_MAX, estMontantPrestation, estMontantVersement } from './money.js';
import { normaliserTexte } from './patients.js';
import { VUES } from './recap.js';
import { CATEGORIES, MODES_PAIEMENT, STATUTS } from './schema.js';

export const ETATS_PAIEMENT = ['non_paye', 'partiel', 'paye'];
export const MAX_IDS_GROUPE = 1000;
const LONGUEUR_NOM = 100;
const LONGUEUR_MOTIF = 200;
const CARACTERES_CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;
// Caractères invisibles ou de mise en forme, refusés dans les noms, prénoms, motifs et libellés de tarif (deux patients « identiques à l'écran » resteraient distincts) :
// césure conditionnelle, jonction de graphèmes, marques bidirectionnelles, espaces à largeur nulle, séparateurs de ligne et de paragraphe,
// sélecteurs de variante, caractères de remplissage, BOM, caractères de balisage.
const CARACTERES_INVISIBLES = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e007f}]/u;
const estObjet = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accumule les erreurs par champ, puis les lève toutes ensemble en un 422. */
class Collecteur {
  champs = {};
  ajouter(nom, message) {
    this.champs[nom] ??= message;
  }
  verifier() {
    const noms = Object.keys(this.champs);
    if (noms.length === 0) return;
    const message = noms.length === 1 ? this.champs[noms[0]] : `${noms.length} champs à corriger.`;
    throw new ErreurApp(422, 'VALIDATION', message, this.champs);
  }
}

function refuserChampsInconnus(corps, autorises, contexte = 'La requête') {
  for (const nom of Object.keys(corps)) {
    if (!autorises.includes(nom)) throw new ErreurApp(400, 'REQUETE_INVALIDE', `${contexte} contient un champ inconnu.`);
  }
}

/** Texte court : normalisé (espaces), sans caractère de contrôle, longueur bornée. `genre` : 'm' ou 'f' pour les messages. */
function texte(valeur, { nom, libelle, genre = 'm', max, obligatoire, collecteur, sansInvisibles = false }) {
  const le = genre === 'm' ? 'le' : 'la';
  const Le = genre === 'm' ? 'Le' : 'La';
  if (valeur === undefined || valeur === null || (typeof valeur === 'string' && valeur.trim() === '')) {
    if (obligatoire) collecteur.ajouter(nom, `Indiquez ${le} ${libelle}.`);
    return '';
  }
  if (typeof valeur !== 'string' || CARACTERES_CONTROLE.test(valeur)) {
    collecteur.ajouter(nom, `${Le} ${libelle} contient un caractère non autorisé.`);
    return '';
  }
  if (sansInvisibles && CARACTERES_INVISIBLES.test(valeur)) {
    collecteur.ajouter(nom, `${Le} ${libelle} contient un caractère invisible ou de contrôle, non autorisé. Retapez-le à la main plutôt que de le copier-coller.`);
    return '';
  }
  const propre = normaliserTexte(valeur);
  if (propre.length > max) collecteur.ajouter(nom, `${Le} ${libelle} est trop ${genre === 'm' ? 'long' : 'longue'} (${max} caractères au maximum).`);
  return propre;
}

function dateObligatoire(valeur, { nom, libelle, collecteur }) {
  if (valeur === undefined || valeur === null || valeur === '') {
    collecteur.ajouter(nom, `Indiquez la date ${libelle}.`);
    return null;
  }
  if (!estDateCivile(valeur)) {
    collecteur.ajouter(nom, `La date ${libelle} n'est pas valide (elle doit exister, entre 2000 et 2100).`);
    return null;
  }
  return valeur;
}

function montant(valeur, { suffixe, estValide, max, collecteur }) {
  if (valeur === undefined || valeur === null || valeur === '') {
    collecteur.ajouter('montantCentimes', `Indiquez le montant${suffixe}.`);
    return null;
  }
  if (!Number.isSafeInteger(valeur) || valeur < 0) {
    collecteur.ajouter('montantCentimes', `Le montant${suffixe} doit être un nombre positif, par exemple 45 ou 45,50.`);
    return null;
  }
  if (!estValide(valeur)) {
    collecteur.ajouter('montantCentimes', valeur > max ? `Le montant${suffixe} dépasse 100 000 €.` : `Le montant${suffixe} doit être supérieur à 0.`);
    return null;
  }
  return valeur;
}

const montantPrestation = (valeur, collecteur) => montant(valeur, { suffixe: '', estValide: estMontantPrestation, max: MONTANT_PRESTATION_MAX, collecteur });
const montantVersement = (valeur, collecteur) => montant(valeur, { suffixe: ' du versement', estValide: estMontantVersement, max: MONTANT_VERSEMENT_MAX, collecteur });

function mode(valeur, collecteur) {
  if (valeur === undefined || valeur === null || valeur === '') {
    collecteur.ajouter('mode', 'Choisissez le mode de paiement.');
    return null;
  }
  if (!MODES_PAIEMENT.includes(valeur)) {
    collecteur.ajouter('mode', 'Le mode de paiement doit être : carte bancaire, chèque, espèces, virement ou autre.');
    return null;
  }
  return valeur;
}

function typePrestation(prestationId, catalogue, collecteur, { idActuel } = {}) {
  if (prestationId === undefined || prestationId === null || prestationId === '') {
    collecteur.ajouter('prestationId', 'Choisissez une prestation.');
    return null;
  }
  const type = typeof prestationId === 'string' ? catalogue.find((c) => c.id === prestationId) : undefined;
  // Une ligne existante peut garder un type désactivé ; une création exige un type actif.
  if (!type || (!type.actif && prestationId !== idActuel)) {
    collecteur.ajouter('prestationId', "Cette prestation n'existe pas ou n'est plus proposée.");
    return null;
  }
  return type;
}

/** Identité du patient : { patientId } ou { nom, prenom, nouveau } ; null si absente. `exiger` : obligatoire (création). */
function identitePatient(corps, collecteur, { exiger }) {
  const { patientId, patient, nouveauPatient } = corps;
  if (patientId !== undefined && patient !== undefined) {
    collecteur.ajouter('patientId', 'Indiquez soit un patient existant, soit son nom et son prénom.');
    return null;
  }
  if (nouveauPatient !== undefined && typeof nouveauPatient !== 'boolean') {
    throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Le champ « nouveauPatient » doit être vrai ou faux.');
  }
  if (patientId !== undefined) {
    if (typeof patientId !== 'string' || patientId === '') collecteur.ajouter('patientId', "Le patient choisi n'est pas valide.");
    if (nouveauPatient) collecteur.ajouter('patientId', 'Un nouveau patient se crée à partir de son nom et de son prénom.');
    return typeof patientId === 'string' && patientId !== '' ? { patientId } : null;
  }
  if (patient === undefined) {
    if (exiger) {
      collecteur.ajouter('nom', 'Indiquez le nom du patient.');
      collecteur.ajouter('prenom', 'Indiquez le prénom du patient.');
    }
    return null;
  }
  if (!estObjet(patient)) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Le champ « patient » est invalide.');
  refuserChampsInconnus(patient, ['nom', 'prenom'], 'Le champ « patient »');
  const nom = texte(patient.nom, { nom: 'nom', libelle: 'nom du patient', max: LONGUEUR_NOM, obligatoire: true, collecteur, sansInvisibles: true });
  const prenom = texte(patient.prenom, { nom: 'prenom', libelle: 'prénom du patient', max: LONGUEUR_NOM, obligatoire: true, collecteur, sansInvisibles: true });
  return { nom, prenom, nouveau: nouveauPatient === true };
}

const CHAMPS_LIGNE = ['patientId', 'patient', 'nouveauPatient', 'date', 'prestationId', 'montantCentimes', 'motif'];

/** Création d'une prestation. -> { identite, date, type, montantCentimes, motif } */
export function validerCreation(corps, catalogue) {
  refuserChampsInconnus(corps, CHAMPS_LIGNE);
  const c = new Collecteur();
  const identite = identitePatient(corps, c, { exiger: true });
  const date = dateObligatoire(corps.date, { nom: 'date', libelle: 'de la prestation', collecteur: c });
  const type = typePrestation(corps.prestationId, catalogue, c);
  const montantCentimes = montantPrestation(corps.montantCentimes, c);
  const motif = texte(corps.motif, { nom: 'motif', libelle: 'motif', max: LONGUEUR_MOTIF, obligatoire: false, collecteur: c, sansInvisibles: true });
  c.verifier();
  return { identite, date, type, montantCentimes, motif };
}

/**
 * Modification partielle : seuls les champs présents changent. `modifieLe` (version vue par le client) est obligatoire.
 * -> { modifieLe, identite (ou null), date?, type?, montantCentimes?, motif? }
 */
export function validerModification(corps, catalogue, ligne) {
  refuserChampsInconnus(corps, [...CHAMPS_LIGNE, 'modifieLe', 'renommerPatient', 'detacherLigne']);
  for (const option of ['renommerPatient', 'detacherLigne']) {
    if (corps[option] !== undefined && typeof corps[option] !== 'boolean') throw new ErreurApp(400, 'REQUETE_INVALIDE', `Le champ « ${option} » doit être vrai ou faux.`);
  }
  if (corps.renommerPatient === true && corps.detacherLigne === true) {
    throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Choisissez soit de renommer le patient sur toutes ses lignes, soit de détacher cette ligne.');
  }
  const c = new Collecteur();
  if (typeof corps.modifieLe !== 'string' || corps.modifieLe === '') c.ajouter('modifieLe', 'La version de la prestation affichée est manquante : rechargez la liste.');
  const resultat = {
    modifieLe: corps.modifieLe,
    identite: identitePatient(corps, c, { exiger: false }),
    renommerPatient: corps.renommerPatient === true,
    detacherLigne: corps.detacherLigne === true,
  };
  if ('date' in corps) resultat.date = dateObligatoire(corps.date, { nom: 'date', libelle: 'de la prestation', collecteur: c });
  if ('prestationId' in corps) resultat.type = typePrestation(corps.prestationId, catalogue, c, { idActuel: ligne.prestationId });
  if ('montantCentimes' in corps) resultat.montantCentimes = montantPrestation(corps.montantCentimes, c);
  if ('motif' in corps) resultat.motif = texte(corps.motif, { nom: 'motif', libelle: 'motif', max: LONGUEUR_MOTIF, obligatoire: false, collecteur: c, sansInvisibles: true });
  c.verifier();
  return resultat;
}

/** Versement complet (création) ou partiel (modification). -> { montantCentimes, date, mode } (champs présents seulement si partiel) */
export function validerVersement(corps, { partiel = false } = {}) {
  refuserChampsInconnus(corps, ['montantCentimes', 'date', 'mode']);
  const c = new Collecteur();
  const resultat = {};
  if (!partiel || 'montantCentimes' in corps) resultat.montantCentimes = montantVersement(corps.montantCentimes, c);
  if (!partiel || 'date' in corps) resultat.date = dateObligatoire(corps.date, { nom: 'date', libelle: 'du versement', collecteur: c });
  if (!partiel || 'mode' in corps) resultat.mode = mode(corps.mode, c);
  c.verifier();
  return resultat;
}

/** « Payé en totalité » : date et mode facultatifs. */
export function validerPayerTotalite(corps) {
  refuserChampsInconnus(corps, ['date', 'mode']);
  const c = new Collecteur();
  const resultat = {};
  if ('date' in corps) resultat.date = dateObligatoire(corps.date, { nom: 'date', libelle: 'du versement', collecteur: c });
  if ('mode' in corps) resultat.mode = mode(corps.mode, c);
  c.verifier();
  return resultat;
}

/** Changement de statut groupé : { ids, statut, date? }. */
export function validerStatut(corps) {
  refuserChampsInconnus(corps, ['ids', 'statut', 'date']);
  const c = new Collecteur();
  const { ids } = corps;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS_GROUPE || ids.some((id) => typeof id !== 'string' || id === '')) {
    throw new ErreurApp(400, 'REQUETE_INVALIDE', `« ids » doit être une liste de 1 à ${MAX_IDS_GROUPE} identifiants.`);
  }
  if (!STATUTS.includes(corps.statut)) c.ajouter('statut', 'Le statut doit être « à facturer » ou « facturé ».');
  let date;
  if ('date' in corps) date = dateObligatoire(corps.date, { nom: 'date', libelle: 'de facturation', collecteur: c });
  c.verifier();
  return { ids: [...new Set(ids)], statut: corps.statut, date };
}

/** Filtres de GET /api/prestations (paramètres de requête). Paramètre inconnu ou invalide : 400. */
export function validerFiltres(query) {
  const connus = ['mois', 'de', 'a', 'patientId', 'statut', 'etat', 'aVenir', 'anciennete'];
  for (const nom of query.keys()) {
    if (!connus.includes(nom)) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre de requête inconnu.');
  }
  const invalide = (nom) => new ErreurApp(400, 'REQUETE_INVALIDE', `Paramètre « ${nom} » invalide.`);
  const f = {};
  if (query.has('mois')) {
    if (!estMois(query.get('mois'))) throw invalide('mois');
    f.mois = query.get('mois');
  }
  for (const nom of ['de', 'a']) {
    if (query.has(nom)) {
      if (!estDateCivile(query.get(nom))) throw invalide(nom);
      f[nom] = query.get(nom);
    }
  }
  if (query.has('patientId')) {
    const id = query.get('patientId');
    if (id === '' || id.length > 100) throw invalide('patientId');
    f.patientId = id;
  }
  if (query.has('statut')) {
    if (!STATUTS.includes(query.get('statut'))) throw invalide('statut');
    f.statut = query.get('statut');
  }
  if (query.has('etat')) {
    const etats = query.get('etat').split(',');
    if (etats.some((e) => !ETATS_PAIEMENT.includes(e))) throw invalide('etat');
    f.etats = etats;
  }
  if (query.has('aVenir')) {
    const v = query.get('aVenir');
    if (v !== 'true' && v !== 'false') throw invalide('aVenir');
    f.aVenir = v === 'true';
  }
  if (query.has('anciennete')) {
    if (!TRANCHES.some((t) => t.id === query.get('anciennete'))) throw invalide('anciennete');
    f.anciennete = query.get('anciennete');
  }
  return f;
}

/** Paramètres de GET /api/recap : `mois` (AAAA-MM, défaut = mois en cours) et `vue` ('prestation' par défaut, ou 'versement'). */
export function validerParametresRecap(query, aujourdHui) {
  for (const nom of query.keys()) {
    if (nom !== 'mois' && nom !== 'vue') throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre de requête inconnu.');
  }
  const mois = query.has('mois') ? query.get('mois') : aujourdHui.slice(0, 7);
  if (!estMois(mois)) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre « mois » invalide (format AAAA-MM).');
  const vue = query.has('vue') ? query.get('vue') : 'prestation';
  if (!VUES.includes(vue)) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre « vue » invalide (prestation ou versement).');
  return { mois, vue };
}

// ------------------------------------------------------------------ Catalogue et paramètres

const LONGUEUR_LIBELLE = 120;
export const SAUVEGARDES_MIN = 7; // en dessous, une erreur remarquée le lendemain ne se rattrape plus
export const SAUVEGARDES_MAX = 365;

function categorie(valeur, collecteur) {
  if (!CATEGORIES.includes(valeur)) {
    collecteur.ajouter('categorie', 'Choisissez une catégorie : séance, bilan ou autre.');
    return null;
  }
  return valeur;
}

function libelleCatalogue(valeur, collecteur) {
  return texte(valeur, { nom: 'libelle', libelle: 'nom de la prestation', max: LONGUEUR_LIBELLE, obligatoire: true, collecteur, sansInvisibles: true });
}

function tarif(valeur, collecteur) {
  if (valeur === undefined || valeur === null || valeur === '') {
    collecteur.ajouter('tarifCentimes', 'Indiquez le tarif.');
    return null;
  }
  if (!Number.isSafeInteger(valeur) || valeur < 0) {
    collecteur.ajouter('tarifCentimes', 'Le tarif doit être un nombre positif ou nul, par exemple 45 ou 45,50.');
    return null;
  }
  if (!estMontantPrestation(valeur)) {
    collecteur.ajouter('tarifCentimes', 'Le tarif dépasse 100 000 €.');
    return null;
  }
  return valeur;
}

/** Ajout d'une prestation au catalogue : { libelle, tarifCentimes, categorie }. */
export function validerCatalogueCreation(corps) {
  refuserChampsInconnus(corps, ['libelle', 'tarifCentimes', 'categorie']);
  const c = new Collecteur();
  const resultat = {
    libelle: libelleCatalogue(corps.libelle, c),
    tarifCentimes: tarif(corps.tarifCentimes, c),
    categorie: categorie(corps.categorie, c),
  };
  c.verifier();
  return resultat;
}

/** Modification partielle : seuls les champs présents changent (libelle, tarifCentimes, categorie, actif, ordre). */
export function validerCatalogueModification(corps) {
  refuserChampsInconnus(corps, ['libelle', 'tarifCentimes', 'categorie', 'actif', 'ordre']);
  const c = new Collecteur();
  const resultat = {};
  if ('libelle' in corps) resultat.libelle = libelleCatalogue(corps.libelle, c);
  if ('tarifCentimes' in corps) resultat.tarifCentimes = tarif(corps.tarifCentimes, c);
  if ('categorie' in corps) resultat.categorie = categorie(corps.categorie, c);
  if ('actif' in corps) {
    if (typeof corps.actif !== 'boolean') throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Le champ « actif » doit être vrai ou faux.');
    resultat.actif = corps.actif;
  }
  if ('ordre' in corps) {
    if (!Number.isSafeInteger(corps.ordre) || corps.ordre < 0 || corps.ordre > 100_000) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Le champ « ordre » est invalide.');
    resultat.ordre = corps.ordre;
  }
  c.verifier();
  return resultat;
}

/** PATCH /api/parametres : { sauvegardesConservees } (entier de 7 à 365 : nombre de JOURS d'historique des sauvegardes automatiques). */
export function validerParametres(corps) {
  refuserChampsInconnus(corps, ['sauvegardesConservees']);
  const c = new Collecteur();
  const resultat = {};
  if ('sauvegardesConservees' in corps) {
    const n = corps.sauvegardesConservees;
    if (!Number.isSafeInteger(n) || n < SAUVEGARDES_MIN || n > SAUVEGARDES_MAX) {
      c.ajouter('sauvegardesConservees', `Indiquez un nombre entier de jours d'historique à conserver, entre ${SAUVEGARDES_MIN} et ${SAUVEGARDES_MAX}.`);
    } else {
      resultat.sauvegardesConservees = n;
    }
  }
  if (Object.keys(resultat).length === 0 && Object.keys(c.champs).length === 0) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Aucun paramètre à modifier.');
  c.verifier();
  return resultat;
}

// ------------------------------------------------------------------ Indicateurs du tableau de bord

/**
 * Paramètres de GET /api/indicateurs/* : `de` et `a` (mois AAAA-MM ; défaut = les 12 derniers mois, mois en cours compris), plus
 * `vue` (ca-mensuel) ou `granularite` (seances) selon `extras`. Aucun nom de patient dans l'URL. Période : 60 mois au plus.
 * -> { de, a, vue?, granularite? }
 */
export function validerParametresIndicateurs(query, aujourdHui, extras = []) {
  const autorises = ['de', 'a', ...extras];
  for (const nom of query.keys()) {
    if (!autorises.includes(nom)) throw new ErreurApp(400, 'REQUETE_INVALIDE', 'Paramètre de requête inconnu.');
  }
  const invalide = (nom, detail = 'format AAAA-MM') => new ErreurApp(400, 'REQUETE_INVALIDE', `Paramètre « ${nom} » invalide (${detail}).`);
  const a = query.has('a') ? query.get('a') : moisDe(aujourdHui);
  if (!estMois(a)) throw invalide('a');
  const de = query.has('de') ? query.get('de') : moisDe(ajouterMois(`${a}-01`, -11));
  if (!estMois(de)) throw invalide('de');
  if (de > a) throw invalide('de', 'le début doit précéder la fin');
  if (nombreMois(de, a) > PERIODE_MAX_MOIS) throw invalide('de', `période de ${PERIODE_MAX_MOIS} mois au plus`);
  const r = { de, a };
  if (extras.includes('vue')) {
    r.vue = query.has('vue') ? query.get('vue') : 'prestation';
    if (!VUES_CA.includes(r.vue)) throw invalide('vue', 'prestation ou versement');
  }
  if (extras.includes('granularite')) {
    r.granularite = query.has('granularite') ? query.get('granularite') : 'mois';
    if (!GRANULARITES.includes(r.granularite)) throw invalide('granularite', 'mois ou semaine');
  }
  return r;
}

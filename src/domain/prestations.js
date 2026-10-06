// Opérations sur les prestations, appliquées à une COPIE de travail de l'état (celle que fournit store.muter).
// Fonctions sans E/S : l'horloge et les identifiants arrivent par `ctx` = { aujourdHui, maintenant (ISO), nouvelId }.
// Chaque fonction modifie `etat` et renvoie { resultat, avertissements }.
import { ErreurApp } from '../erreurs.js';
import { formaterDateFr } from './dates.js';
import { ancienneteJours, compteDansImpayes, trancheAnciennete } from './indicateurs.js';
import { formaterCentimes } from './money.js';
import { etatPaiement } from './paiement.js';
import { clePatient, normaliserTexte, resoudrePatient } from './patients.js';
import { validerCreation, validerModification, validerPayerTotalite, validerStatut, validerVersement } from './validation.js';

const euros = (centimes) => `${formaterCentimes(centimes)} €`;
const introuvable = () => new ErreurApp(404, 'INTROUVABLE', 'Cette prestation est introuvable (elle a peut-être été supprimée).');

function trouverLigne(etat, id) {
  const ligne = etat.prestations.find((l) => l.id === id);
  if (!ligne) throw introuvable();
  return ligne;
}

function avertirDateFuture(date, ctx, avertissements) {
  if (date > ctx.aujourdHui) avertissements.push({ code: 'DATE_FUTURE', message: 'Cette prestation est à venir.' });
}

function avertirTropPercu(avant, apres, avertissements, message) {
  const surplus = apres.tropPercuCentimes - avant.tropPercuCentimes;
  if (surplus > 0) avertissements.push({ code: 'TROP_PERCU', message: message(surplus) });
}

/** Crée une prestation (statut à facturer, aucun versement). Libellé et catégorie figés depuis le catalogue. */
export function creerPrestation(etat, corps, ctx) {
  const v = validerCreation(corps, etat.catalogue);
  const { patient, avertissements } = resoudrePatient(etat.prestations, v.identite, ctx.nouvelId);
  const ligne = {
    id: ctx.nouvelId(),
    patient,
    date: v.date,
    prestationId: v.type.id,
    libelle: v.type.libelle,
    categorie: v.type.categorie,
    motif: v.motif,
    montantCentimes: v.montantCentimes,
    statut: 'a_facturer',
    factureLe: null,
    versements: [],
    creeLe: ctx.maintenant,
    modifieLe: ctx.maintenant,
  };
  etat.prestations.push(ligne);
  avertirDateFuture(ligne.date, ctx, avertissements);
  return { resultat: ligne, avertissements };
}

/** Modifie les champs fournis. 409 MODIFIEE_AILLEURS si la version vue par le client n'est plus la bonne. */
export function modifierPrestation(etat, id, corps, ctx) {
  const ligne = trouverLigne(etat, id);
  const v = validerModification(corps, etat.catalogue, ligne);
  if (v.modifieLe !== ligne.modifieLe) {
    throw new ErreurApp(409, 'MODIFIEE_AILLEURS', 'Cette prestation a été modifiée entre-temps. Rechargez-la avant de la modifier.');
  }
  const avertissements = [];
  const avant = etatPaiement(ligne);

  if (v.identite) {
    const parNom = v.identite.nom !== undefined && !v.identite.nouveau;
    const memeNom = parNom && clePatient(v.identite.nom, v.identite.prenom) === clePatient(ligne.patient.nom, ligne.patient.prenom);
    const autresLignes = etat.prestations.filter((l) => l.id !== ligne.id && l.patient.id === ligne.patient.id);
    if (parNom && v.renommerPatient) {
      // Renommage du patient sur toutes ses lignes : l'identifiant est conservé.
      const nom = normaliserTexte(v.identite.nom);
      const prenom = normaliserTexte(v.identite.prenom);
      const cle = clePatient(nom, prenom);
      if (etat.prestations.some((l) => l.patient.id !== ligne.patient.id && clePatient(l.patient.nom, l.patient.prenom) === cle)) {
        avertissements.push({ code: 'PATIENT_HOMONYME', message: 'Un autre patient porte déjà ce nom et ce prénom : ils seront à distinguer lors des prochaines saisies.' });
      }
      for (const l of autresLignes) {
        l.patient = { id: l.patient.id, nom, prenom };
        l.modifieLe = ctx.maintenant;
      }
      ligne.patient = { id: ligne.patient.id, nom, prenom };
    } else if (memeNom) {
      ligne.patient = { id: ligne.patient.id, nom: normaliserTexte(v.identite.nom), prenom: normaliserTexte(v.identite.prenom) }; // simple correction de casse ou d'espaces
    } else {
      if (parNom && autresLignes.length > 0 && !v.detacherLigne) {
        // Jamais de détachement silencieux : le client doit choisir entre renommer toutes les lignes et détacher celle-ci.
        throw new ErreurApp(409, 'RENOMMAGE_PATIENT', 'Ce patient a d\'autres prestations : choisissez de renommer le patient sur toutes ses lignes ou de modifier seulement celle-ci.', undefined, { autresLignes: autresLignes.length });
      }
      const autres = etat.prestations.filter((l) => l.id !== ligne.id);
      const r = resoudrePatient(autres, v.identite, ctx.nouvelId);
      ligne.patient = r.patient;
      avertissements.push(...r.avertissements);
    }
  }
  if (v.date !== undefined) {
    ligne.date = v.date;
    avertirDateFuture(v.date, ctx, avertissements);
  }
  if (v.type !== undefined && v.type.id !== ligne.prestationId) {
    ligne.prestationId = v.type.id;
    ligne.libelle = v.type.libelle; // le libellé et la catégorie sont figés au moment du choix du type
    ligne.categorie = v.type.categorie;
  }
  if (v.montantCentimes !== undefined) ligne.montantCentimes = v.montantCentimes;
  if (v.motif !== undefined) ligne.motif = v.motif;
  ligne.modifieLe = ctx.maintenant;
  avertirTropPercu(avant, etatPaiement(ligne), avertissements, (s) => `Le montant est inférieur au total déjà versé : trop-perçu de ${euros(s)}.`);
  return { resultat: ligne, avertissements };
}

/** Supprime la ligne et ses versements. */
export function supprimerPrestation(etat, id) {
  const ligne = trouverLigne(etat, id);
  etat.prestations.splice(etat.prestations.indexOf(ligne), 1);
  return { resultat: { id, versementsSupprimes: ligne.versements.length }, avertissements: [] };
}

/** Passe plusieurs lignes à `facture` (date de facturation = `date` ou aujourd'hui) ou à `a_facturer` (date effacée). */
export function definirStatut(etat, corps, ctx) {
  const { ids, statut, date } = validerStatut(corps);
  const lignes = ids.map((id) => trouverLigne(etat, id));
  const avertissements = [];
  let modifiees = 0;
  let aVenir = 0;
  let dateFuture = 0;
  let avantPrestation = 0;
  for (const ligne of lignes) {
    if (ligne.statut === statut) continue; // déjà dans l'état demandé : ignorée
    ligne.statut = statut;
    ligne.factureLe = statut === 'facture' ? (date ?? ctx.aujourdHui) : null;
    ligne.modifieLe = ctx.maintenant;
    modifiees += 1;
    if (statut === 'facture' && ligne.date > ctx.aujourdHui) aVenir += 1;
    // Date de facturation choisie explicitement : avertissement non bloquant, l'ancienneté des impayés en dépend.
    if (statut === 'facture' && date !== undefined) {
      if (date > ctx.aujourdHui) dateFuture += 1;
      if (date < ligne.date) avantPrestation += 1;
    }
  }
  if (dateFuture > 0) {
    avertissements.push({ code: 'DATE_FACTURATION_FUTURE', message: `La date de facturation est dans le futur (${formaterDateFr(date)})${dateFuture === 1 ? '' : ` pour ${dateFuture} prestations`}.` });
  }
  if (avantPrestation > 0) {
    avertissements.push({ code: 'DATE_FACTURATION_AVANT_PRESTATION', message: `La date de facturation (${formaterDateFr(date)}) est antérieure à la date de ${avantPrestation === 1 ? 'la prestation' : `${avantPrestation} prestations`}.` });
  }
  if (aVenir > 0) {
    avertissements.push({
      code: 'FACTURATION_DATE_FUTURE',
      message: aVenir === 1 ? 'Cette prestation est à venir.' : `${aVenir} de ces prestations sont à venir.`,
    });
  }
  return { resultat: { modifiees }, avertissements };
}

/** Versement daté dans le futur : avertissement non bloquant (la vue « encaissé » le compterait dans un mois à venir). */
function avertirVersementFutur(date, ctx, avertissements) {
  if (date > ctx.aujourdHui) avertissements.push({ code: 'VERSEMENT_DATE_FUTURE', message: `Ce versement est daté dans le futur (${formaterDateFr(date)}).` });
}

function nouveauVersement(ligne, saisie, ctx, avertissements) {
  const avant = etatPaiement(ligne);
  const versement = { id: ctx.nouvelId(), montantCentimes: saisie.montantCentimes, date: saisie.date, mode: saisie.mode };
  ligne.versements.push(versement);
  ligne.modifieLe = ctx.maintenant;
  if (saisie.date < ligne.date) {
    avertissements.push({ code: 'VERSEMENT_AVANT_PRESTATION', message: `Ce versement est daté avant la prestation (${formaterDateFr(ligne.date)}).` });
  }
  avertirVersementFutur(saisie.date, ctx, avertissements);
  avertirTropPercu(avant, etatPaiement(ligne), avertissements, (s) => `Ce versement dépasse le reste à payer de ${euros(s)}.`);
  return versement;
}

/** Ajoute un versement et mémorise le mode. */
export function ajouterVersement(etat, idPrestation, corps, ctx) {
  const ligne = trouverLigne(etat, idPrestation);
  const saisie = validerVersement(corps);
  const avertissements = [];
  nouveauVersement(ligne, saisie, ctx, avertissements);
  etat.parametres.dernierModePaiement = saisie.mode;
  return { resultat: ligne, avertissements };
}

function trouverVersement(ligne, idVersement) {
  const versement = ligne.versements.find((v) => v.id === idVersement);
  if (!versement) throw new ErreurApp(404, 'INTROUVABLE', 'Ce versement est introuvable (il a peut-être été supprimé).');
  return versement;
}

/** Modifie un versement (champs fournis). */
export function modifierVersement(etat, idPrestation, idVersement, corps, ctx) {
  const ligne = trouverLigne(etat, idPrestation);
  const versement = trouverVersement(ligne, idVersement);
  const saisie = validerVersement(corps, { partiel: true });
  const avertissements = [];
  const avant = etatPaiement(ligne);
  Object.assign(versement, saisie);
  ligne.modifieLe = ctx.maintenant;
  if (saisie.date !== undefined && saisie.date < ligne.date) {
    avertissements.push({ code: 'VERSEMENT_AVANT_PRESTATION', message: `Ce versement est daté avant la prestation (${formaterDateFr(ligne.date)}).` });
  }
  if (saisie.date !== undefined) avertirVersementFutur(saisie.date, ctx, avertissements);
  avertirTropPercu(avant, etatPaiement(ligne), avertissements, (s) => `Le total versé dépasse le montant de ${euros(s)}.`);
  return { resultat: ligne, avertissements };
}

/** Supprime un versement (la confirmation est demandée par l'interface). */
export function supprimerVersement(etat, idPrestation, idVersement, ctx) {
  const ligne = trouverLigne(etat, idPrestation);
  const versement = trouverVersement(ligne, idVersement);
  ligne.versements.splice(ligne.versements.indexOf(versement), 1);
  ligne.modifieLe = ctx.maintenant;
  return { resultat: ligne, avertissements: [] };
}

/**
 * Un versement égal au reste à payer, daté d'aujourd'hui, mode = `mode` ou dernier mode utilisé.
 * 409 DEJA_PAYEE si rien à payer ; 422 MODE_REQUIS si aucun mode n'a jamais été utilisé.
 */
export function payerEnTotalite(etat, idPrestation, corps, ctx) {
  const ligne = trouverLigne(etat, idPrestation);
  const saisie = validerPayerTotalite(corps);
  const { resteCentimes } = etatPaiement(ligne);
  if (resteCentimes === 0) throw new ErreurApp(409, 'DEJA_PAYEE', 'Cette prestation est déjà payée en totalité.');
  const mode = saisie.mode ?? etat.parametres.dernierModePaiement;
  if (!mode) throw new ErreurApp(422, 'MODE_REQUIS', 'Choisissez le mode de paiement : aucun n\'a encore été utilisé.', { mode: 'Choisissez le mode de paiement.' });
  const avertissements = [];
  nouveauVersement(ligne, { montantCentimes: resteCentimes, date: saisie.date ?? ctx.aujourdHui, mode }, ctx, avertissements);
  etat.parametres.dernierModePaiement = mode;
  return { resultat: ligne, avertissements };
}

/** Filtre et trie (date, puis création) les lignes ; `enrichir` est appliqué par l'appelant. */
export function filtrerPrestations(prestations, filtres, aujourdHui, etatDe) {
  const { mois, de, a, patientId, statut, etats, aVenir, anciennete } = filtres;
  return prestations
    .filter((l) => {
      if (mois !== undefined && l.date.slice(0, 7) !== mois) return false;
      if (de !== undefined && l.date < de) return false;
      if (a !== undefined && l.date > a) return false;
      if (patientId !== undefined && l.patient.id !== patientId) return false;
      if (statut !== undefined && l.statut !== statut) return false;
      if (etats !== undefined && !etats.includes(etatDe(l).etat)) return false;
      if (aVenir !== undefined && (l.date > aujourdHui) !== aVenir) return false;
      // Impayés par tranche d'ancienneté : reste à payer > 0, hors prestation à venir non facturée, ancienneté dans la tranche (même règle que le tableau de bord).
      if (anciennete !== undefined && (!compteDansImpayes(l, aujourdHui) || etatDe(l).resteCentimes <= 0 || trancheAnciennete(ancienneteJours(l, aujourdHui)) !== anciennete)) return false;
      return true;
    })
    .sort((x, y) => x.date.localeCompare(y.date) || x.creeLe.localeCompare(y.creeLe) || x.id.localeCompare(y.id));
}

/** Totaux d'une liste de lignes enrichies. */
export function totaliser(lignes) {
  const t = { nombre: lignes.length, montantCentimes: 0, payeCentimes: 0, resteCentimes: 0, tropPercuCentimes: 0 };
  for (const l of lignes) {
    t.montantCentimes += l.montantCentimes;
    t.payeCentimes += l.payeCentimes;
    t.resteCentimes += l.resteCentimes;
    t.tropPercuCentimes += l.tropPercuCentimes;
  }
  return t;
}

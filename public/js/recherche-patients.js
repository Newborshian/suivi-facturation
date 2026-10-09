// Recherche d'un patient enregistré pendant la frappe (saisie assistée et page Patients). Module PUR (aucun accès au DOM) : testé avec node --test.
// Le registre est la liste renvoyée par GET /api/patients : [{ id, nom, prenom, actif, nombrePrestations, dernierePrestation, homonyme, supprimable }].
// Jamais de nom dans une URL ni dans un stockage : tout se passe en mémoire, dans la page.
import { formatDate, normaliserRecherche, pluriel } from './format.js';

export const LIMITE_SUGGESTIONS = 8;

const espaces = (texte) => String(texte ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');

/**
 * Clé de comparaison nom + prénom, IDENTIQUE à celle du serveur (src/domain/patients.js) : insensible à la casse et aux espaces,
 * SENSIBLE aux accents. Sert à savoir si le serveur rattachera la saisie à un patient existant (« Nouveau patient » ou non).
 */
export function clePatient(nom, prenom) {
  return `${espaces(nom).toLocaleLowerCase('fr')}\u0000${espaces(prenom).toLocaleLowerCase('fr')}`;
}

/** Rang d'un patient pour un texte tapé : 0 début du nom, 1 début du prénom, 2 contenu ; null = ne correspond pas. */
function rang(patient, saisie) {
  const q = normaliserRecherche(saisie);
  const nom = normaliserRecherche(patient.nom);
  const prenom = normaliserRecherche(patient.prenom);
  if (`${nom} ${prenom}`.startsWith(q)) return 0;
  if (prenom.startsWith(q) || `${prenom} ${nom}`.startsWith(q)) return 1;
  return [nom, prenom, `${nom} ${prenom}`, `${prenom} ${nom}`].some((cible) => cible.includes(q)) ? 2 : null;
}

/**
 * Patients dont le nom ou le prénom contient ce qui est tapé (accents, casse et espaces de bord ignorés ; « nom prénom » et « prénom nom »
 * acceptés). Les deux champs doivent correspondre quand ils sont remplis. Tri : actifs avant archivés, puis début du nom, début du prénom,
 * contenu, puis nom et prénom. Rien de tapé : tous les patients dans cet ordre (ouverture volontaire de la liste).
 * `repli` ('nom' ou 'prenom') : champ en cours de frappe ; si la combinaison des deux champs ne donne rien (on corrige un nom déjà rempli,
 * l'autre champ garde l'ancienne valeur), la recherche est refaite avec ce seul champ.
 * -> { patients (au plus `limite`), total (avant la limite) }
 */
export function rechercherPatients(registre, saisie = {}, { limite = LIMITE_SUGGESTIONS, repli = null } = {}) {
  const { nom = '', prenom = '' } = saisie;
  const saisies = [nom, prenom].filter((t) => normaliserRecherche(t) !== '');
  const resultat = chercher(registre, saisies, limite);
  if (resultat.total === 0 && saisies.length === 2 && (repli === 'nom' || repli === 'prenom')) return chercher(registre, [saisie[repli]], limite);
  return resultat;
}

function chercher(registre, saisies, limite) {
  const retenus = [];
  for (const patient of Array.isArray(registre) ? registre : []) {
    let pire = 0;
    let correspond = true;
    for (const saisie of saisies) {
      const r = rang(patient, saisie);
      if (r === null) {
        correspond = false;
        break;
      }
      pire = Math.max(pire, r);
    }
    if (correspond) retenus.push({ patient, pire });
  }
  retenus.sort(
    (a, b) =>
      Number(b.patient.actif !== false) - Number(a.patient.actif !== false) ||
      a.pire - b.pire ||
      a.patient.nom.localeCompare(b.patient.nom, 'fr') ||
      a.patient.prenom.localeCompare(b.patient.prenom, 'fr') ||
      String(a.patient.id).localeCompare(String(b.patient.id)),
  );
  return { patients: retenus.slice(0, limite).map((r) => r.patient), total: retenus.length };
}

/** Texte d'une suggestion : { nom: « Lapin Pierre », detail (homonymes seulement), marque (« archivé ») }. */
export function libelleSuggestion(patient) {
  const detail = patient.homonyme ? (patient.dernierePrestation ? `dernière prestation le ${formatDate(patient.dernierePrestation)}` : 'aucune prestation') : '';
  return { nom: `${patient.nom} ${patient.prenom}`, detail, marque: patient.actif === false ? 'archivé' : '' };
}

/** Patients du registre qui ont exactement la même clé que ce qui est tapé (c'est ce que le serveur rattacherait). */
export function patientsDeMemeCle(registre, nom, prenom) {
  const cle = clePatient(nom, prenom);
  return (Array.isArray(registre) ? registre : []).filter((p) => clePatient(p.nom, p.prenom) === cle);
}

/** Aucun patient enregistré ne porte exactement ce nom et ce prénom : la prestation créera un nouveau patient. */
export function estNouveauPatient(registre, nom, prenom) {
  return patientsDeMemeCle(registre, nom, prenom).length === 0;
}

/**
 * Option « Créer le patient … » (toujours la dernière de la liste) ; null si rien n'est tapé ou si un patient porte exactement ce nom.
 * Un seul champ rempli : le texte tapé suivi de « … » (ou précédé).
 */
export function optionCreer(registre, nom, prenom) {
  const n = espaces(nom);
  const p = espaces(prenom);
  if (n === '' && p === '') return null;
  if (n !== '' && p !== '' && !estNouveauPatient(registre, n, p)) return null;
  const nomComplet = n !== '' && p !== '' ? `${n} ${p}` : n !== '' ? `${n} …` : `… ${p}`;
  return { texte: `Créer le patient « ${nomComplet} »` };
}

const TEXTES_INDICATION = {
  enregistre: 'Patient enregistré',
  nouveau: 'Nouveau patient',
  reactive: 'Patient archivé : il sera réactivé avec cette prestation',
};

/**
 * Indication sous les champs patient (data-patient) : -> { type: 'enregistre' | 'nouveau' | 'reactive' | null, texte }.
 *  - patient choisi dans la liste : enregistré (ou réactivé s'il est archivé) ;
 *  - sinon, Nom et Prénom remplis : un seul patient de même clé -> rattaché par le serveur ; aucun -> nouveau ; plusieurs -> pas d'indication
 *    (la question « lequel ? » est posée à la validation) ;
 *  - un seul champ rempli : « Nouveau patient » seulement si l'option « Créer… » a été choisie ; rien tapé : rien.
 */
export function indicationPatient(registre, { nom = '', prenom = '' } = {}, choisi = null, creerChoisi = false) {
  const rien = { type: null, texte: '' };
  const avec = (type) => ({ type, texte: TEXTES_INDICATION[type] });
  if (choisi) return avec(choisi.actif === false ? 'reactive' : 'enregistre');
  const n = espaces(nom);
  const p = espaces(prenom);
  if (n === '' && p === '') return rien;
  if (n === '' || p === '') return creerChoisi ? avec('nouveau') : rien;
  const memeCle = patientsDeMemeCle(registre, n, p);
  if (memeCle.length === 0) return avec('nouveau');
  if (memeCle.length === 1) return avec(memeCle[0].actif === false ? 'reactive' : 'enregistre');
  return rien;
}

/** Annonce pour lecteur d'écran après une frappe : nombre de suggestions, option de création, liste tronquée. */
export function annonceSuggestions({ nombre, total = nombre, creer = false, limite = LIMITE_SUGGESTIONS }) {
  const fin = creer ? ' ; vous pouvez aussi créer un nouveau patient' : '';
  if (nombre === 0) return `Aucun patient enregistré ne correspond${creer ? ' ; vous pouvez créer un nouveau patient' : ''}`;
  const tronque = total > limite ? ` (${limite} au plus : précisez la recherche)` : '';
  return `${pluriel(nombre, 'patient proposé', 'patients proposés')}${fin}${tronque}`;
}

/**
 * Candidats d'un homonyme (409 PATIENT_EXISTANT ou PATIENTS_HOMONYMES : identifiant et date seulement, jamais de nom) retrouvés dans le registre
 * pour être décrits à l'écran. Un candidat absent du registre (liste périmée) garde son identifiant et sa date, sans nom.
 */
export function candidatsAffiches(candidats, registre) {
  const parId = new Map((Array.isArray(registre) ? registre : []).map((p) => [p.id, p]));
  return (Array.isArray(candidats) ? candidats : []).map((c) => {
    const p = parId.get(c.id);
    return {
      id: c.id,
      nom: p?.nom ?? '',
      prenom: p?.prenom ?? '',
      actif: p ? p.actif !== false : true,
      homonyme: p?.homonyme === true,
      nombrePrestations: p?.nombrePrestations ?? null,
      dernierePrestation: c.dernierePrestation ?? p?.dernierePrestation ?? null,
    };
  });
}

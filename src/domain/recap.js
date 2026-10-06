// Facturation du mois : récapitulatif par patient. Module pur, centimes entiers, aucune horloge implicite.
//
// Deux vues du même mois :
//  - 'prestation' (défaut) : les prestations dont la DATE est dans le mois. dû = Σ montants ; payé = Σ part versée
//    (quelle que soit la date des versements) ; reste = dû - payé (trop-perçu à part). Invariant : dû = payé + reste.
//  - 'versement' (trésorerie réelle) : « payé » = Σ des versements DATÉS dans le mois, sur toutes les prestations
//    (y compris celles d'autres mois), trop-perçu compris. « Dû » reste celui des prestations du mois ; reste, trop-perçu
//    et état n'ont pas de sens dans cette vue et valent null.
import { moisDe } from './dates.js';
import { enrichir } from './paiement.js';

export const VUES = ['prestation', 'versement'];
export const VUE_DEFAUT = 'prestation';

/** État d'un patient dérivé de ses totaux : reste 0 -> payé ; rien de payé alors que dû > 0 -> non payé ; sinon partiel. */
export function etatDepuisTotaux({ duCentimes, payeCentimes, resteCentimes }) {
  if (resteCentimes === 0) return 'paye';
  return payeCentimes === 0 && duCentimes > 0 ? 'non_paye' : 'partiel';
}

const compteursVides = () => ({
  nbPrestations: 0,
  nbSeances: 0, // catégorie « seance » uniquement
  nbAutres: 0, // bilans, comptes rendus et autres prestations hors séances
  nbAFacturer: 0,
  nbAVenir: 0,
  duCentimes: 0,
  payeCentimes: 0,
  resteCentimes: 0,
  tropPercuCentimes: 0,
});

/** `a` est-elle plus récente que `b` ? (sert à choisir le nom affiché : celui de la ligne la plus récente) */
const plusRecente = (a, b) => (a.date !== b.date ? a.date > b.date : a.creeLe >= b.creeLe);

function trier(patients) {
  return patients.sort((a, b) => a.patient.nom.localeCompare(b.patient.nom, 'fr') || a.patient.prenom.localeCompare(b.patient.prenom, 'fr') || a.patient.id.localeCompare(b.patient.id));
}

const parDateEtCreation = (x, y) => x.date.localeCompare(y.date) || x.creeLe.localeCompare(y.creeLe) || x.id.localeCompare(y.id);

/**
 * Récapitulatif du mois `mois` (AAAA-MM) pour la vue demandée.
 * -> { mois, vue, patients: [{ patient:{id,nom,prenom}, lignes, versements, nbPrestations, nbSeances, nbAutres, nbAFacturer,
 *      nbAVenir, duCentimes, payeCentimes, resteCentimes, tropPercuCentimes, etat }], total }
 * `lignes` : prestations du mois (enrichies, triées) ; `versements` : versements du mois (vue 'versement' seulement).
 */
export function recapMensuel(prestations, { mois, vue = VUE_DEFAUT, aujourdHui }) {
  if (!VUES.includes(vue)) throw new RangeError(`Vue inconnue : ${vue}`);
  const parId = new Map();
  const entree = (ligne) => {
    let e = parId.get(ligne.patient.id);
    if (!e) {
      e = { patient: { id: ligne.patient.id, nom: ligne.patient.nom, prenom: ligne.patient.prenom }, lignes: [], versements: [], reference: ligne, ...compteursVides() };
      parId.set(ligne.patient.id, e);
    } else if (plusRecente(ligne, e.reference)) {
      e.reference = ligne;
      e.patient = { id: ligne.patient.id, nom: ligne.patient.nom, prenom: ligne.patient.prenom };
    }
    return e;
  };

  for (const prestation of prestations) {
    if (moisDe(prestation.date) === mois) {
      const l = enrichir(prestation, aujourdHui);
      const e = entree(prestation);
      e.lignes.push(l);
      e.nbPrestations += 1;
      if (l.categorie === 'seance') e.nbSeances += 1;
      else e.nbAutres += 1;
      if (l.statut === 'a_facturer') e.nbAFacturer += 1;
      if (l.aVenir) e.nbAVenir += 1;
      e.duCentimes += l.montantCentimes;
      if (vue === 'prestation') {
        e.payeCentimes += l.payeCentimes;
        e.resteCentimes += l.resteCentimes;
        e.tropPercuCentimes += l.tropPercuCentimes;
      }
    }
    if (vue === 'versement') {
      for (const v of prestation.versements) {
        if (moisDe(v.date) !== mois) continue;
        const e = entree(prestation);
        e.payeCentimes += v.montantCentimes;
        e.versements.push({ id: v.id, date: v.date, mode: v.mode, montantCentimes: v.montantCentimes, prestationId: prestation.id, datePrestation: prestation.date, libelle: prestation.libelle });
      }
    }
  }

  const patients = trier(
    [...parId.values()].map(({ reference, ...e }) => {
      e.lignes.sort(parDateEtCreation);
      e.versements.sort((x, y) => x.date.localeCompare(y.date) || x.datePrestation.localeCompare(y.datePrestation) || x.id.localeCompare(y.id));
      if (vue === 'prestation') e.etat = etatDepuisTotaux(e);
      else Object.assign(e, { resteCentimes: null, tropPercuCentimes: null, etat: null });
      return e;
    }),
  );

  const total = { nbPatients: patients.length, ...compteursVides() };
  for (const e of patients) {
    for (const cle of ['nbPrestations', 'nbSeances', 'nbAutres', 'nbAFacturer', 'nbAVenir', 'duCentimes', 'payeCentimes']) total[cle] += e[cle];
    if (vue === 'prestation') {
      total.resteCentimes += e.resteCentimes;
      total.tropPercuCentimes += e.tropPercuCentimes;
    }
  }
  if (vue === 'versement') Object.assign(total, { resteCentimes: null, tropPercuCentimes: null });
  total.etat = vue === 'prestation' ? etatDepuisTotaux(total) : null;
  return { mois, vue, patients, total };
}

/**
 * Prestations encore « à facturer », tous mois confondus. Les prestations à venir (date > aujourd'hui)
 * sont comptées à part (architecture §6.5). Une prestation à 0 € non facturée ne compte pas (aucune somme à facturer) : elle est seulement dénombrée dans `zeroNombre`, à date passée ou à venir, pour que l'écran explique l'écart
 * avec la liste des prestations « à facturer ».
 * -> { nombre, montantCentimes, aVenirNombre, aVenirMontantCentimes, zeroNombre }
 */
export function aFacturerGlobal(prestations, aujourdHui) {
  const r = { nombre: 0, montantCentimes: 0, aVenirNombre: 0, aVenirMontantCentimes: 0, zeroNombre: 0 };
  for (const p of prestations) {
    if (p.statut !== 'a_facturer') continue;
    if (p.montantCentimes === 0) {
      r.zeroNombre += 1;
    } else if (p.date > aujourdHui) {
      r.aVenirNombre += 1;
      r.aVenirMontantCentimes += p.montantCentimes;
    } else {
      r.nombre += 1;
      r.montantCentimes += p.montantCentimes;
    }
  }
  return r;
}

/**
 * Mois proposés par le sélecteur : mois contenant des prestations, mois en cours et mois demandé, du plus ancien au plus récent.
 * Vue « versement » : les mois qui n'ont que des versements datés (prestation d'un autre mois payée plus tard) sont aussi proposés.
 */
export function moisProposes(prestations, aujourdHui, moisDemande, vue = VUE_DEFAUT) {
  const mois = new Set([...prestations.map((p) => moisDe(p.date)), moisDe(aujourdHui), moisDemande]);
  if (vue === 'versement') for (const p of prestations) for (const v of p.versements ?? []) mois.add(moisDe(v.date));
  return [...mois].sort();
}

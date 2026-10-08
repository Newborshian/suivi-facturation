// Générateur déterministe du jeu d'exemple 100 % factice. Même graine + même date de référence
// = même résultat. Noms de personnages, motifs et tarifs entièrement inventés (aucun lien avec un cabinet réel).
// Régénérer config/exemple.json :
//   node --input-type=module -e "import {genererExemple} from './src/exemple.js'; import fs from 'node:fs'; fs.writeFileSync('config/exemple.json', JSON.stringify(genererExemple(), null, 2) + '\n')"
import { ajouterJours, ajouterMois, ecartJours, joursDansMois } from './domain/dates.js';
import { trierRegistre } from './domain/patients.js';
import { FORMAT, VERSION_COURANTE } from './domain/schema.js';

export const GRAINE_DEFAUT = 20261002;
export const DATE_REFERENCE_DEFAUT = '2026-10-02';

// Générateur pseudo-aléatoire à graine (mulberry32).
function creerAlea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Catalogue fictif générique (prix inventés), propre au jeu d'exemple : l'application, elle, démarre avec un catalogue vide.
// Montants en centimes. Catégorie : `seance` (comptée dans le nombre de séances), `bilan`, `autre`.
const CATALOGUE = [
  ['seance-30', 'Séance individuelle 30 min', 4200, 'seance'],
  ['seance-45', 'Séance individuelle 45 min', 5800, 'seance'],
  ['seance-domicile-45', 'Séance à domicile 45 min', 6800, 'seance'],
  ['bilan-initial', 'Bilan initial', 17000, 'bilan'],
  ['compte-rendu', 'Compte rendu', 2800, 'autre'],
  ['reunion-synthese', 'Réunion de synthèse', 5200, 'autre'],
];

/** Copie fraîche du catalogue fictif (identifiants lisibles et stables). */
export function catalogueExemple() {
  return CATALOGUE.map(([id, libelle, tarifCentimes, categorie], i) => ({ id, libelle, tarifCentimes, categorie, actif: true, ordre: i + 1 }));
}

const PATIENTS = [
  ['Lapin', 'Pierre', 'seance-45', 'Graphisme'],
  ['Ours', 'Baloo', 'seance-30', 'Motricité fine'],
  ['Tortue', 'Franklin', 'seance-domicile-45', 'Autonomie'],
  ['Renard', 'Goupil', 'seance-30', 'Écriture'],
  ['Souris', 'Stuart', 'seance-45', 'Organisation'],
  ['Hérisson', 'Sonic', 'seance-30', 'Coordination'],
];

// Patient fictif archivé et sans prestation : montre le registre au-delà des lignes (il n'influe sur aucun chiffre).
const PATIENT_ARCHIVE = ['Cygne', 'Léa'];

const MODES = ['carte', 'cheque', 'virement', 'especes'];
const pad = (n) => String(n).padStart(2, '0');

export function genererExemple({ graine = GRAINE_DEFAUT, dateRef = DATE_REFERENCE_DEFAUT } = {}) {
  const alea = creerAlea(graine);
  const catalogue = catalogueExemple();
  const parId = new Map(catalogue.map((c) => [c.id, c]));
  const patients = PATIENTS.map(([nom, prenom], i) => ({ id: idDeterministe('patient', i), nom, prenom }));
  let compteur = 0;
  const prestations = [];

  function ajouter(indexPatient, date, prestationId, motif, { statut, factureLe, versements } = {}) {
    const type = parId.get(prestationId);
    const ecart = ecartJours(date, dateRef);
    let st = statut;
    let fact = factureLe;
    let vers = versements;
    if (st === undefined) {
      if (ecart > 30) {
        // ancienne prestation : facturée en fin de mois, réglée en totalité
        const finDeMois = `${date.slice(0, 7)}-${pad(joursDansMois(Number(date.slice(0, 4)), Number(date.slice(5, 7))))}`;
        st = 'facture';
        fact = finDeMois > dateRef ? dateRef : finDeMois;
        const dateVersement = ajouterJours(fact, 3 + Math.floor(alea() * 8));
        vers = [{ montantCentimes: type.tarifCentimes, date: dateVersement > dateRef ? dateRef : dateVersement, mode: MODES[Math.floor(alea() * MODES.length)] }];
      } else {
        st = 'a_facturer';
        fact = null;
        vers = ecart >= 0 && alea() < 0.5 && type.tarifCentimes > 0 ? [{ montantCentimes: type.tarifCentimes, date, mode: MODES[Math.floor(alea() * MODES.length)] }] : [];
      }
    }
    compteur += 1;
    prestations.push({
      id: idDeterministe('prestation', compteur),
      patient: { ...patients[indexPatient] },
      date,
      prestationId,
      libelle: type.libelle,
      categorie: type.categorie,
      motif,
      montantCentimes: type.tarifCentimes,
      statut: st,
      factureLe: fact ?? null,
      versements: (vers ?? []).map((v, k) => ({ id: idDeterministe(`versement-${compteur}`, k + 1), ...v })),
      creeLe: `${date}T16:00:00.000Z`,
      modifieLe: `${date}T16:00:00.000Z`,
    });
  }

  // Deux séances par patient et par mois, de 13 mois avant la date de référence jusqu'à son mois.
  const debut = `${ajouterMois(`${dateRef.slice(0, 7)}-01`, -13).slice(0, 7)}`;
  for (let m = 0; m <= 13; m++) {
    const mois = ajouterMois(`${debut}-01`, m).slice(0, 7);
    patients.forEach((_, i) => {
      const [, , prestationId, motif] = PATIENTS[i];
      const j1 = 3 + i + Math.floor(alea() * 3);
      const j2 = 17 + i + Math.floor(alea() * 3);
      for (const j of [j1, j2]) {
        const date = `${mois}-${pad(j)}`;
        if (date <= ajouterJours(dateRef, 14)) ajouter(i, date, prestationId, motif);
      }
    });
  }

  // Autres types de prestation, une fois chacun au moins.
  ajouter(0, '2026-03-12', 'bilan-initial', 'Bilan initial');
  ajouter(1, '2026-04-08', 'bilan-initial', 'Bilan de graphisme');
  ajouter(2, '2026-05-19', 'reunion-synthese', 'Équipe de suivi');
  ajouter(3, '2026-06-02', 'compte-rendu', 'Compte rendu pour l’école');
  ajouter(4, '2026-07-07', 'reunion-synthese', 'Synthèse annuelle');
  ajouter(5, '2025-11-04', 'bilan-initial', 'Bilan de contrôle');

  // Cas particuliers pour les trois états de paiement, les deux statuts, l'avenir et le doublon.
  ajouter(4, '2026-09-14', 'bilan-initial', 'Bilan', {
    statut: 'facture',
    factureLe: '2026-09-30',
    versements: [
      { montantCentimes: 10000, date: '2026-09-30', mode: 'cheque' },
      { montantCentimes: 5000, date: '2026-10-01', mode: 'virement' },
    ],
  }); // partiellement payé, deux versements
  ajouter(5, '2026-06-10', 'seance-30', 'Coordination', { statut: 'facture', factureLe: '2026-06-30', versements: [] }); // facturé, impayé depuis plus de 90 jours
  ajouter(1, '2026-10-20', 'seance-30', 'Motricité fine', { statut: 'a_facturer', factureLe: null, versements: [] }); // date future
  ajouter(0, '2026-09-28', 'seance-30', 'Graphisme', { statut: 'a_facturer', factureLe: null, versements: [] }); // doublon potentiel (1/2)
  ajouter(0, '2026-09-28', 'seance-30', 'Graphisme', { statut: 'a_facturer', factureLe: null, versements: [] }); // doublon potentiel (2/2)

  prestations.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));

  return {
    format: FORMAT,
    schemaVersion: VERSION_COURANTE,
    revision: 1,
    majLe: `${dateRef}T08:00:00.000Z`,
    parametres: { sauvegardesConservees: 30, dernierModePaiement: 'virement' },
    catalogue,
    patients: trierRegistre([
      ...patients.map((p) => ({ ...p, actif: true })),
      { id: idDeterministe('patient', patients.length), nom: PATIENT_ARCHIVE[0], prenom: PATIENT_ARCHIVE[1], actif: false },
    ]),
    prestations,
  };
}

// Identifiants lisibles et stables, de forme UUID (le jeu doit rester identique d'une génération à l'autre).
function idDeterministe(nature, numero) {
  let h = 2166136261;
  for (const c of `${nature}:${numero}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  const a = hex(h);
  const b = hex(Math.imul(h, 2654435761));
  const c2 = hex(Math.imul(h ^ 0x9e3779b9, 40503));
  const d = hex(Math.imul(h + 1013904223, 1664525));
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c2.slice(1, 4)}-${c2.slice(4)}${d}`;
}

// Données factices (aucune donnée réelle) pour les tests de restauration, d'export et de catalogue.
import { etatInitialTest } from './catalogue-test.js';

const PATIENTS = [
  { id: 'patient-lapin', nom: 'Lapin', prenom: 'Pierre' },
  { id: 'patient-ours', nom: 'Ours', prenom: 'Baloo' },
  { id: 'patient-herisson', nom: 'Hérisson', prenom: 'Sonic' },
];

/** Une prestation valide ; `i` rend l'id, la date et le patient distincts. */
export function ligneTest(i, extra = {}) {
  const jour = String((i % 27) + 1).padStart(2, '0');
  return {
    id: `ligne-${i}`,
    patient: PATIENTS[i % PATIENTS.length],
    date: `2026-09-${jour}`,
    prestationId: 'seance-45',
    libelle: 'Séance individuelle 45 min',
    categorie: 'seance',
    motif: 'Graphisme',
    montantCentimes: 4500,
    statut: 'a_facturer',
    factureLe: null,
    versements: [],
    creeLe: '2026-09-01T08:00:00.000Z',
    modifieLe: '2026-09-01T08:00:00.000Z',
    ...extra,
  };
}

/** État valide de version courante avec `n` prestations et la révision demandée. */
export function etatTest(n, { revision = 1, prestations } = {}) {
  const etat = etatInitialTest(new Date('2026-10-01T08:00:00.000Z'));
  etat.revision = revision;
  etat.prestations = prestations ?? Array.from({ length: n }, (_, i) => ligneTest(i));
  return etat;
}

export const texteEtat = (etat) => `${JSON.stringify(etat, null, 2)}\n`;

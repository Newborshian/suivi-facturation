// Aides des tests de recette QA (tests/qa/). Données 100 % factices, générées de façon déterministe (graine fixe).
// Ce fichier n'est pas un test (son nom ne correspond à aucun motif de `node --test`).
import fs from 'node:fs/promises';
import path from 'node:path';
import { catalogueTest } from '../aides/catalogue-test.js';
import { creerEtatInitial } from '../../src/domain/schema.js';
import { ajouterJours, joursDansMois } from '../../src/domain/dates.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { ecrireFichierTest } from '../aides/temp.js';

export const NOM_FICHIER = 'suivi-facturation.json';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function alea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOMS = ['Lapin', 'Ours', 'Hérisson', 'Renard', 'Loup', 'Chouette', 'Castor', 'Blaireau', 'Écureuil', 'Cerf'];
const PRENOMS = ['Pierre', 'Baloo', 'Sonic', 'Roux', 'Alpha', 'Hulotte', 'Noisette', 'Terrier', 'Gland', 'Biche'];
const MODES = ['carte', 'cheque', 'especes', 'virement', 'autre'];

/** Ligne factice valide (même forme que le fichier de données). */
export function ligne(i, extra = {}) {
  return {
    id: `qa-${i}`,
    patient: { id: `pat-${i % 10}`, nom: NOMS[i % 10], prenom: PRENOMS[i % 10] },
    date: '2026-09-15',
    prestationId: 'seance-45',
    libelle: 'Séance individuelle 45 min',
    categorie: 'seance',
    motif: 'Graphisme',
    montantCentimes: 4500,
    statut: 'a_facturer',
    factureLe: null,
    versements: [],
    creeLe: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    modifieLe: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

/**
 * `n` prestations réparties sur [debut, debut + jours[ avec statuts, acomptes, soldes, trop-perçus, montants à 0 €,
 * dates futures, tous types du catalogue. Entièrement déterminé par `graine`.
 */
export function prestationsAleatoires(n, { graine = 1, debut = '2024-01-01', jours = 900, aujourdHui = '2026-06-15' } = {}) {
  const r = alea(graine);
  const catalogue = catalogueTest();
  const lignes = [];
  for (let i = 0; i < n; i++) {
    const type = catalogue[Math.floor(r() * catalogue.length)];
    const date = ajouterJours(debut, Math.floor(r() * jours));
    const tirage = r();
    const montant = tirage < 0.03 ? 0 : tirage < 0.05 ? 10_000_000 : type.tarifCentimes + (r() < 0.2 ? Math.floor(r() * 777) - 50 : 0);
    const montantCentimes = Math.max(0, montant);
    const facture = r() < 0.55;
    const versements = [];
    const nbV = r() < 0.35 ? 0 : r() < 0.8 ? 1 : r() < 0.9 ? 2 : 3;
    for (let k = 0; k < nbV; k++) {
      const part = r() < 0.5 ? montantCentimes : Math.max(1, Math.floor(montantCentimes * r()));
      const surplus = r() < 0.05 ? 1 + Math.floor(r() * 500) : 0; // trop-perçu
      versements.push({
        id: `qa-${i}-v${k}`,
        montantCentimes: Math.max(1, Math.min(10_000_000, part + surplus)),
        date: ajouterJours(date, Math.floor(r() * 60) - (r() < 0.05 ? 10 : 0)), // parfois antérieur à la prestation
        mode: MODES[Math.floor(r() * MODES.length)],
      });
    }
    lignes.push(
      ligne(i, {
        patient: { id: `pat-${Math.floor(r() * 40)}`, nom: NOMS[Math.floor(r() * 10)], prenom: PRENOMS[Math.floor(r() * 10)] },
        date,
        prestationId: type.id,
        libelle: type.libelle,
        categorie: type.categorie,
        montantCentimes,
        statut: facture ? 'facture' : 'a_facturer',
        factureLe: facture ? (date > aujourdHui ? date : ajouterJours(date, Math.floor(r() * 20))) : null,
        versements,
      }),
    );
  }
  // les noms d'un patient doivent être identiques pour un même id : on les aligne sur le premier rencontré
  const vus = new Map();
  for (const l of lignes) {
    if (!vus.has(l.patient.id)) vus.set(l.patient.id, l.patient);
    else l.patient = vus.get(l.patient.id);
  }
  return lignes;
}

/** État de version courante valide avec les prestations données. */
export function etatAvec(prestations, { revision = 1 } = {}) {
  const etat = creerEtatInitial(new Date('2026-06-01T08:00:00.000Z'));
  etat.catalogue = catalogueTest();
  etat.revision = revision;
  etat.prestations = prestations;
  return etat;
}

export const texteJson = (etat) => `${JSON.stringify(etat, null, 2)}\n`;

/** Démarre un serveur de test dont le dossier contient déjà ce fichier de données (texte ou octets). */
export async function serveurAvecFichier(contenu, options = {}) {
  return demarrerServeurTest({
    ...options,
    preparer: async (dossier) => {
      if (contenu !== null) await ecrireFichierTest(path.join(dossier, NOM_FICHIER), contenu);
      if (options.preparer) await options.preparer(dossier);
    },
  });
}

/** Client JSON de l'API (Origin locale sur les écritures). */
export function client(s) {
  const appeler = (methode, chemin, corps, enTetes = {}) =>
    s.requete({
      methode,
      chemin,
      headers: { Origin: `http://127.0.0.1:${s.port}`, ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}), ...enTetes },
      corps: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
  return {
    get: (chemin, enTetes) => s.requete({ chemin, headers: enTetes }),
    post: (chemin, corps, enTetes) => appeler('POST', chemin, corps, enTetes),
    patch: (chemin, corps, enTetes) => appeler('PATCH', chemin, corps, enTetes),
    del: (chemin, enTetes) => appeler('DELETE', chemin, undefined, enTetes),
  };
}

export const lireDisque = async (dossier) => JSON.parse(await fs.readFile(path.join(dossier, NOM_FICHIER), 'utf8'));
export const octetsDisque = (dossier) => fs.readFile(path.join(dossier, NOM_FICHIER));

export const dernierJourDuMois = (annee, mois) => `${annee}-${String(mois).padStart(2, '0')}-${String(joursDansMois(annee, mois)).padStart(2, '0')}`;

/** Saisie valide d'une prestation (corps de POST /api/prestations). */
export const saisie = (extra = {}) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500, motif: 'Graphisme', ...extra });

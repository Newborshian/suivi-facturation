// Archive annuelle abîmée, tronquée ou forgée : ignorée avec un avertissement au journal, jamais d'erreur 500 sur le catalogue,
// la suppression d'un type de prestation ni l'export. Données fictives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { ID_SEANCE_45, ID_BILAN, etatInitialTest } from '../aides/catalogue-test.js';
import { lireArchives } from '../../src/store/archives-lecture.js';
import { creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';

const ligneValide = {
  id: '8f1c2e0a-0000-4000-8000-0000000000a1',
  patient: { id: '3b9d0000-0000-4000-8000-0000000000b1', nom: 'Lapin', prenom: 'Pierre' },
  date: '2022-03-14',
  prestationId: ID_SEANCE_45,
  libelle: 'Séance individuelle 45 min',
  categorie: 'seance',
  motif: 'Graphisme',
  montantCentimes: 5800,
  statut: 'facture',
  factureLe: '2022-03-31',
  versements: [{ id: 'c41a0000-0000-4000-8000-0000000000c1', montantCentimes: 5800, date: '2022-04-02', mode: 'cheque' }],
  creeLe: '2022-03-14T16:02:11.000Z',
  modifieLe: '2022-04-02T08:30:00.000Z',
};
const archive = (prestations) => JSON.stringify({ format: 'suivi-facturation-archive', prestations });
const origine = (s) => ({ Origin: `http://127.0.0.1:${s.port}` });

const archivesDeTest = {
  'archive-2022.json': archive([ligneValide]), // saine
  'archive-2023.json': '{"format":"suivi-facturation-archive","prestations":[{"id":"8f1c2e0a-0000-4000-8000', // tronquée
  'archive-2024.json': archive([null, { id: 'x' }]), // lignes malformées
  'archive-2025.json': archive([{ ...ligneValide, id: 'autre', versements: 'pas un tableau' }]), // structure forgée
  'archive-2021.json': archive([ligneValide, ligneValide]), // identifiants en double
};

function avecArchives(fn, evenements) {
  const lignes = [];
  const journal = { avert: (m) => lignes.push(m), info() {}, erreur: (m) => lignes.push(`ERREUR ${m}`), ...evenements };
  return async () => {
    const s = await demarrerServeurTest({
      evenements: journal,
      preparer: async (dossier) => {
        await fs.writeFile(path.join(dossier, 'suivi-facturation.json'), JSON.stringify(etatInitialTest(), null, 2)); // fichier actif sain
        for (const [nom, contenu] of Object.entries(archivesDeTest)) await fs.writeFile(path.join(dossier, nom), contenu);
      },
    });
    try {
      await fn(s, lignes);
    } finally {
      await s.arreter();
    }
  };
}

test('GET /api/catalogue avec archives abîmées : 200, seule l\'archive saine est comptée, avertissements au journal (noms de fichiers seulement)', avecArchives(async (s, journal) => {
  const r = await s.requete({ chemin: '/api/catalogue' });
  assert.equal(r.status, 200, r.texte);
  assert.equal(r.json.utilisations[ID_SEANCE_45], 1, 'l\'archive saine reste comptée');
  const avertissements = journal.filter((l) => /Archive ignorée/.test(l));
  for (const nom of ['archive-2021.json', 'archive-2023.json', 'archive-2024.json', 'archive-2025.json']) assert.ok(avertissements.some((l) => l.includes(nom)), nom);
  assert.ok(!avertissements.some((l) => l.includes('archive-2022.json')), 'l\'archive saine n\'est pas signalée');
  assert.ok(!journal.some((l) => /ERREUR/.test(l)), 'aucune erreur 5xx');
  for (const l of avertissements) for (const interdit of ['Lapin', 'Pierre', 'Graphisme', '5800']) assert.ok(!l.includes(interdit), 'aucun contenu de l\'archive dans le journal');
}));

test('DELETE /api/catalogue/{id} avec archives abîmées : refus 409 « utilisé » (on ne peut pas garantir le contraire), jamais 500 ; rien n\'est supprimé', avecArchives(async (s) => {
  const r = await s.requete({ methode: 'DELETE', chemin: `/api/catalogue/${ID_BILAN}`, headers: origine(s) });
  assert.equal(r.status, 409, r.texte);
  assert.equal(r.json.erreur.code, 'CATALOGUE_UTILISE');
  const catalogue = await s.requete({ chemin: '/api/catalogue' });
  assert.ok(catalogue.json.catalogue.some((c) => c.id === ID_BILAN));
}));

test('GET /api/export (CSV prestations et versements, JSON) avec archives abîmées : 200, l\'archive saine est exportée, les autres signalées', avecArchives(async (s) => {
  const prestations = await s.requete({ chemin: '/api/export?format=csv&contenu=prestations' });
  assert.equal(prestations.status, 200, prestations.texte);
  assert.ok(prestations.texte.includes('8f1c2e0a-0000-4000-8000-0000000000a1'), 'ligne de l\'archive saine');
  assert.ok(!prestations.texte.includes('autre'), 'ligne de l\'archive forgée absente');
  const versements = await s.requete({ chemin: '/api/export?format=csv&contenu=versements' });
  assert.equal(versements.status, 200, versements.texte);
  assert.ok(versements.texte.includes('8f1c2e0a-0000-4000-8000-0000000000a1'));
  const complet = await s.requete({ chemin: '/api/export?format=json' });
  assert.equal(complet.status, 200);
  assert.deepEqual(Object.keys(complet.json.archives), ['2022']);
  assert.deepEqual(complet.json.archivesIllisibles, ['2021', '2023', '2024', '2025']);
}));

test('lireArchives : classement direct (lisibles / illisibles) et avertissement unique par fichier', async () => {
  const dossier = await creerDossierTemp('archives');
  try {
    for (const [nom, contenu] of Object.entries(archivesDeTest)) await fs.writeFile(path.join(dossier, nom), contenu);
    await fs.writeFile(path.join(dossier, 'archive-2020.json'), archive([])); // archive vide : valide
    const lignes = [];
    const journal = { avert: (m) => lignes.push(m) };
    const r = await lireArchives(dossier, { journal });
    assert.deepEqual(Object.keys(r.archives), ['2020', '2022']);
    assert.deepEqual(r.illisibles, ['2021', '2023', '2024', '2025']);
    assert.equal(lignes.length, 4);
    await lireArchives(dossier, { journal });
    assert.equal(lignes.length, 4, 'pas de répétition à chaque lecture');
  } finally {
    await supprimerDossierTemp(dossier);
  }
});

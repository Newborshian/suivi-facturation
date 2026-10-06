// Points signalés lors des revues de code, depuis corrigés (temporaires de sauvegarde, annulation, incohérences de statut, dates de facturation, ordre des sauvegardes),
// les tests ne sont plus marqués `todo` et doivent passer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { client, etatAvec, ligne, saisie, serveurAvecFichier, texteJson } from './aides-qa.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { listerSauvegardes } from '../../src/store/sauvegardes.js';
import { compterIncoherencesStatut, controlerStructure } from '../../src/domain/schema.js';

test('un fichier temporaire orphelin du dossier sauvegardes/ est nettoyé au démarrage (donnée de santé en clair laissée sur le disque)', async () => {
  const s = await serveurAvecFichier(texteJson(etatAvec([ligne(1)])), {
    preparer: async (d) => {
      await fs.mkdir(path.join(d, 'sauvegardes'));
      await fs.writeFile(path.join(d, 'sauvegardes', 'sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-99-1'), 'contenu interrompu');
    },
  });
  try {
    const restants = (await fs.readdir(path.join(s.dossier, 'sauvegardes'))).filter((n) => n.includes('.tmp-'));
    assert.deepEqual(restants, []);
  } finally {
    await s.arreter();
  }
});

test('annuler une création (suppression de la ligne) est précédé d\'une sauvegarde « avant suppression »', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    const c = await a.post('/api/prestations', saisie());
    await a.post(`/api/annulations/${c.json.annulation}`);
    const noms = await fs.readdir(path.join(s.dossier, 'sauvegardes')).catch(() => []);
    assert.ok(noms.some((n) => n.includes('avant-suppression')));
  } finally {
    await s.arreter();
  }
});

test('un fichier dont une ligne est « facturé » sans date de facturation (ou « à facturer » avec une date) est signalé par un avertissement, sans être bloqué', async () => {
  const etat = etatAvec([ligne(1, { statut: 'facture', factureLe: null }), ligne(2, { statut: 'a_facturer', factureLe: '2026-09-30' })]);
  assert.deepEqual(compterIncoherencesStatut(etat), { factureSansDate: 1, aFacturerAvecDate: 1 });
  assert.deepEqual(controlerStructure(etat), [], 'toujours lisible et modifiable : un avertissement, pas un blocage');
  const s = await serveurAvecFichier(texteJson(etat));
  try {
    const a = client(s);
    const avertissements = (await a.get('/api/etat')).json.avertissements.filter((x) => x.code === 'DONNEES_INCOHERENTES');
    assert.equal(avertissements.length, 1);
    assert.match(avertissements[0].message, /sans date de facturation/);
    assert.match(avertissements[0].message, /alors qu'une date de facturation est enregistrée/);
  } finally {
    await s.arreter();
  }
});

test('une date de facturation dans le futur ou antérieure à la prestation déclenche un avertissement non bloquant', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    const l = (await a.post('/api/prestations', saisie({ date: '2026-09-01' }))).json.donnees;
    const futur = await a.post('/api/prestations/statut', { ids: [l.id], statut: 'facture', date: '2030-01-01' });
    assert.ok(futur.json.avertissements.length > 0, 'date de facturation en 2030 : aucun avertissement');
    await a.post('/api/prestations/statut', { ids: [l.id], statut: 'a_facturer' });
    const avant = await a.post('/api/prestations/statut', { ids: [l.id], statut: 'facture', date: '2026-01-01' });
    assert.ok(avant.json.avertissements.length > 0, 'date de facturation antérieure à la prestation : aucun avertissement');
  } finally {
    await s.arreter();
  }
});

test('deux sauvegardes de la même seconde sont classées dans l\'ordre de leur numéro (la plus récente en dernier)', async () => {
  const s = await demarrerServeurTest();
  try {
    const d = path.join(s.dossier, 'sauvegardes');
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(path.join(d, 'sauvegarde-2026-09-01_08h00m00s_manuelle.json'), '{}');
    await fs.writeFile(path.join(d, 'sauvegarde-2026-09-01_08h00m00s_manuelle-2.json'), '{}');
    const noms = (await listerSauvegardes({ dossier: s.dossier })).map((x) => x.nom);
    assert.deepEqual(noms, ['sauvegarde-2026-09-01_08h00m00s_manuelle.json', 'sauvegarde-2026-09-01_08h00m00s_manuelle-2.json']);
  } finally {
    await s.arreter();
  }
});

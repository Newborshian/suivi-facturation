import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { fsAvecRenameRefuse } from '../aides/fs-defaillant.js';
import { DELAIS_DEFAUT, ecrireAtomique, nettoyerTemporaires } from '../../src/store/fichier-atomique.js';

async function avecDossier(fn) {
  const dossier = await creerDossierTemp('atomique');
  try {
    await fn(dossier);
  } finally {
    await supprimerDossierTemp(dossier);
  }
}
const sansAttente = { attendre: async () => {} };

test('écrit un nouveau fichier et ne laisse aucun temporaire', () =>
  avecDossier(async (d) => {
    const f = path.join(d, 'a.json');
    await ecrireAtomique(f, '{"a":1}\n');
    assert.equal(await fs.readFile(f, 'utf8'), '{"a":1}\n');
    assert.deepEqual(await fs.readdir(d), ['a.json']);
  }));

test('remplace un fichier existant', () =>
  avecDossier(async (d) => {
    const f = path.join(d, 'a.json');
    await fs.writeFile(f, 'ancien');
    await ecrireAtomique(f, 'nouveau');
    assert.equal(await fs.readFile(f, 'utf8'), 'nouveau');
  }));

test('rename refusé 2 fois (EPERM) puis accepté : écriture réussie, attentes croissantes', () =>
  avecDossier(async (d) => {
    const f = path.join(d, 'a.json');
    const { fs: faux, etat } = fsAvecRenameRefuse(2);
    const attentes = [];
    await ecrireAtomique(f, 'ok', { fs: faux, attendre: async (ms) => attentes.push(ms) });
    assert.equal(etat.appels, 3);
    assert.deepEqual(attentes, [50, 100]);
    assert.equal(await fs.readFile(f, 'utf8'), 'ok');
    assert.deepEqual(await fs.readdir(d), ['a.json']);
  }));

test('rename refusé 5 fois puis accepté à la 6e tentative', () =>
  avecDossier(async (d) => {
    const f = path.join(d, 'a.json');
    const { fs: faux, etat } = fsAvecRenameRefuse(5, 'EBUSY');
    await ecrireAtomique(f, 'ok', { fs: faux, ...sansAttente });
    assert.equal(etat.appels, 6);
    assert.equal(await fs.readFile(f, 'utf8'), 'ok');
  }));

test('rename refusé en permanence : FICHIER_VERROUILLE, ancien contenu intact, temporaire supprimé', () =>
  avecDossier(async (d) => {
    const f = path.join(d, 'a.json');
    await fs.writeFile(f, 'ancien');
    const { fs: faux, etat } = fsAvecRenameRefuse(1000, 'EACCES');
    await assert.rejects(ecrireAtomique(f, 'nouveau', { fs: faux, ...sansAttente }), (e) => e.status === 503 && e.code === 'FICHIER_VERROUILLE');
    assert.equal(etat.appels, 1 + DELAIS_DEFAUT.length);
    assert.equal(await fs.readFile(f, 'utf8'), 'ancien');
    assert.deepEqual(await fs.readdir(d), ['a.json']);
  }));

test('autre erreur de rename (ENOSPC) : pas de nouvelle tentative, ECRITURE_ECHOUEE', () =>
  avecDossier(async (d) => {
    const f = path.join(d, 'a.json');
    await fs.writeFile(f, 'ancien');
    const { fs: faux, etat } = fsAvecRenameRefuse(1000, 'ENOSPC');
    await assert.rejects(ecrireAtomique(f, 'x', { fs: faux, ...sansAttente }), (e) => e.code === 'ECRITURE_ECHOUEE');
    assert.equal(etat.appels, 1);
    assert.equal(await fs.readFile(f, 'utf8'), 'ancien');
    assert.deepEqual(await fs.readdir(d), ['a.json']);
  }));

test('nettoyerTemporaires : supprime uniquement les motifs exacts', () =>
  avecDossier(async (d) => {
    for (const nom of ['suivi-facturation.json.tmp-123-1', 'archive-2025.json.tmp-9-2', 'suivi-facturation.json', 'archive-2025.json', 'notes.tmp-1-1', 'suivi-facturation.json.tmp-x-1', 'autre.json.tmp-1-1']) {
      await fs.writeFile(path.join(d, nom), 'x');
    }
    const supprimes = await nettoyerTemporaires(d);
    assert.deepEqual(supprimes.sort(), ['archive-2025.json.tmp-9-2', 'suivi-facturation.json.tmp-123-1']);
    assert.deepEqual((await fs.readdir(d)).sort(), ['archive-2025.json', 'autre.json.tmp-1-1', 'notes.tmp-1-1', 'suivi-facturation.json', 'suivi-facturation.json.tmp-x-1']);
  }));

test('nettoyerTemporaires : dossier absent = rien à faire', async () => {
  assert.deepEqual(await nettoyerTemporaires(path.join(path.sep, 'dossier-inexistant-suivi-facturation')), []);
});

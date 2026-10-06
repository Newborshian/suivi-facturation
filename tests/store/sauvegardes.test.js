import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { horlogeFixe, horlogeReglable } from '../aides/horloge.js';
import { fsAvecRenameRefuse } from '../aides/fs-defaillant.js';
import { catalogueTest } from '../aides/catalogue-test.js';
import { NOM_FICHIER_ACTIF, ouvrirStore } from '../../src/store/store.js';
import { analyserNomSauvegarde, appliquerRotation, creerSauvegarde, listerSauvegardes, nomSauvegarde } from '../../src/store/sauvegardes.js';

async function avecDossier(fn) {
  const dossier = await creerDossierTemp('sauv');
  try {
    await fn(dossier, path.join(dossier, NOM_FICHIER_ACTIF));
  } finally {
    await supprimerDossierTemp(dossier);
  }
}
const noms = async (d) => (await fs.readdir(path.join(d, 'sauvegardes')).catch(() => [])).sort();
const lireJson = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
const corpsPrestation = (extra = {}) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500, ...extra });
const ajouter = (store, extra) =>
  store.muter('t', async (copie) => {
    const { creerPrestation } = await import('../../src/domain/prestations.js');
    if (copie.catalogue.length === 0) copie.catalogue = catalogueTest(); // un fichier créé neuf a un catalogue vide
    return creerPrestation(copie, corpsPrestation(extra), { aujourdHui: '2026-10-02', maintenant: '2026-10-02T09:00:00.000Z', nouvelId: () => `${Math.random()}`.slice(2) });
  });

// --- Module sauvegardes.js ---

test('nom : sauvegarde-AAAA-MM-JJ_HHhMMmSSs_raison, suffixe en cas de collision ; analyse stricte du motif', () => {
  const date = new Date(2026, 9, 2, 9, 14, 3);
  assert.equal(nomSauvegarde(date, 'demarrage'), 'sauvegarde-2026-10-02_09h14m03s_demarrage.json');
  assert.equal(nomSauvegarde(date, 'avant-suppression', 3), 'sauvegarde-2026-10-02_09h14m03s_avant-suppression-3.json');
  assert.deepEqual(analyserNomSauvegarde('sauvegarde-2026-10-02_09h14m03s_demarrage.json'), { nom: 'sauvegarde-2026-10-02_09h14m03s_demarrage.json', jour: '2026-10-02', heure: '09:14:03', raison: 'demarrage', reserve: 'quotidienne' });
  assert.equal(analyserNomSauvegarde('sauvegarde-2026-10-02_09h14m03s_conflit-disque-2.json').reserve, 'conservee');
  assert.equal(analyserNomSauvegarde('sauvegarde-2026-10-02_09h14m03s_avant-restauration.json').reserve, 'conservee');
  assert.equal(analyserNomSauvegarde('sauvegarde-2026-10-02_09h14m03s_avant-suppression.json').reserve, 'operation');
  for (const ko of ['archive-2025.json', 'suivi-facturation.json', 'sauvegarde-2026-10-02_09h14m03s_inconnue.json', 'sauvegarde-2026-10-02_09h14m03s_demarrage.json.bak', '../sauvegarde-2026-10-02_09h14m03s_demarrage.json']) {
    assert.equal(analyserNomSauvegarde(ko), null, ko);
  }
});

test('création : copie octet pour octet, jamais d\'écrasement', () =>
  avecDossier(async (d) => {
    const contenu = Buffer.from('{"a":1}\r\n  octets exacts é');
    const maintenant = new Date(2026, 9, 2, 9, 0, 0);
    const n1 = await creerSauvegarde({ dossier: d, maintenant, raison: 'manuelle', contenu });
    const n2 = await creerSauvegarde({ dossier: d, maintenant, raison: 'manuelle', contenu: 'autre' });
    assert.notEqual(n1, n2);
    assert.deepEqual(await fs.readFile(path.join(d, 'sauvegardes', n1)), contenu);
  }));

test('rotation : plus anciennes supprimées d\'abord, deux réserves indépendantes, archives et autres fichiers jamais touchés', () =>
  avecDossier(async (d) => {
    await fs.mkdir(path.join(d, 'sauvegardes'));
    const ecrire = (nom) => fs.writeFile(path.join(d, 'sauvegardes', nom), '{}');
    for (let j = 1; j <= 5; j++) await ecrire(`sauvegarde-2026-09-0${j}_08h00m00s_demarrage.json`);
    for (let j = 1; j <= 4; j++) await ecrire(`sauvegarde-2026-09-0${j}_09h00m00s_avant-suppression.json`);
    await ecrire('notes-perso.json'); // fichier étranger dans le dossier de sauvegardes
    await fs.writeFile(path.join(d, 'archive-2025.json'), '{}');
    await fs.writeFile(path.join(d, NOM_FICHIER_ACTIF), '{}');

    const supprimes = await appliquerRotation({ dossier: d, joursQuotidiens: 3, limiteOperation: 2 });
    assert.deepEqual(supprimes.sort(), [
      'sauvegarde-2026-09-01_08h00m00s_demarrage.json',
      'sauvegarde-2026-09-01_09h00m00s_avant-suppression.json',
      'sauvegarde-2026-09-02_08h00m00s_demarrage.json',
      'sauvegarde-2026-09-02_09h00m00s_avant-suppression.json',
    ]);
    assert.deepEqual(await noms(d), [
      'notes-perso.json',
      'sauvegarde-2026-09-03_08h00m00s_demarrage.json',
      'sauvegarde-2026-09-03_09h00m00s_avant-suppression.json',
      'sauvegarde-2026-09-04_08h00m00s_demarrage.json',
      'sauvegarde-2026-09-04_09h00m00s_avant-suppression.json',
      'sauvegarde-2026-09-05_08h00m00s_demarrage.json',
    ]);
    assert.ok((await fs.stat(path.join(d, 'archive-2025.json'))).isFile());
    assert.ok((await fs.stat(path.join(d, NOM_FICHIER_ACTIF))).isFile());
  }));

test('rotation : 30 conservées, la 31e supprime la plus ancienne', () =>
  avecDossier(async (d) => {
    await fs.mkdir(path.join(d, 'sauvegardes'));
    for (let j = 1; j <= 31; j++) await fs.writeFile(path.join(d, 'sauvegardes', `sauvegarde-2026-08-${String(j).padStart(2, '0')}_08h00m00s_quotidienne.json`), '{}');
    const supprimes = await appliquerRotation({ dossier: d, joursQuotidiens: 30 });
    assert.deepEqual(supprimes, ['sauvegarde-2026-08-01_08h00m00s_quotidienne.json']);
    assert.equal((await listerSauvegardes({ dossier: d })).length, 30);
  }));

// --- Rotation de la réserve quotidienne, comptée en jours ---

const nomJour = (jour, heure, raison = 'demarrage') => `sauvegarde-${jour}_${heure}_${raison}.json`;
async function rotationSur(d, fichiers, options) {
  await fs.mkdir(path.join(d, 'sauvegardes'), { recursive: true });
  for (const nom of fichiers) await fs.writeFile(path.join(d, 'sauvegardes', nom), '{}');
  const supprimes = await appliquerRotation({ dossier: d, ...options });
  return { supprimes: supprimes.sort(), restantes: (await noms(d)).filter((n) => n.startsWith('sauvegarde-')) };
}

test('rotation par jours : toutes les sauvegardes du jour, puis la dernière de chacun des N-1 jours distincts précédents', () =>
  avecDossier(async (d) => {
    const fichiers = [
      nomJour('2026-10-01', '08h00m00s'), nomJour('2026-10-01', '17h30m00s', 'manuelle'),
      nomJour('2026-10-02', '08h00m00s'), nomJour('2026-10-02', '12h00m00s', 'quotidienne'), nomJour('2026-10-02', '18h00m00s'),
      nomJour('2026-10-03', '09h00m00s'),
      nomJour('2026-10-04', '09h00m00s'), nomJour('2026-10-04', '10h00m00s'), nomJour('2026-10-04', '11h00m00s'),
    ];
    const { restantes } = await rotationSur(d, fichiers, { joursQuotidiens: 3, maintenant: new Date(2026, 9, 4, 12, 0, 0) });
    assert.deepEqual(restantes, [
      nomJour('2026-10-02', '18h00m00s'), // dernière du 2
      nomJour('2026-10-03', '09h00m00s'), // dernière du 3
      nomJour('2026-10-04', '09h00m00s'), nomJour('2026-10-04', '10h00m00s'), nomJour('2026-10-04', '11h00m00s'), // toutes celles du jour
    ]);
  }));

test('rotation par jours : trois lancements par jour ne raccourcissent plus l\'historique (7 jours = 7 jours)', () =>
  avecDossier(async (d) => {
    const fichiers = [];
    for (let j = 1; j <= 10; j++) for (const h of ['08', '13', '18']) fichiers.push(nomJour(`2026-10-${String(j).padStart(2, '0')}`, `${h}h00m00s`));
    const { restantes } = await rotationSur(d, fichiers, { joursQuotidiens: 7, maintenant: new Date(2026, 9, 10, 19, 0, 0) });
    assert.equal(restantes.length, 3 + 6, 'les 3 du jour + la dernière de 6 jours précédents');
    const jours = new Set(restantes.map((n) => n.slice(11, 21)));
    assert.deepEqual([...jours].sort(), ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
  }));

test('rotation par jours : changement de jour (le jour courant est celui de « maintenant », les journées antérieures se réduisent à leur dernière)', () =>
  avecDossier(async (d) => {
    const fichiers = [nomJour('2026-10-03', '08h00m00s'), nomJour('2026-10-03', '16h00m00s'), nomJour('2026-10-04', '09h00m00s'), nomJour('2026-10-04', '10h00m00s')];
    const avant = await rotationSur(d, fichiers, { joursQuotidiens: 7, maintenant: new Date(2026, 9, 4, 12, 0, 0) });
    assert.deepEqual(avant.supprimes, [nomJour('2026-10-03', '08h00m00s')], 'le 3 est un jour précédent : seule sa dernière reste ; le 4 est intact');
    const apres = await appliquerRotation({ dossier: d, joursQuotidiens: 7, maintenant: new Date(2026, 9, 5, 0, 5, 0) }); // minuit passé
    assert.deepEqual(apres, [nomJour('2026-10-04', '09h00m00s')]);
  }));

test('rotation par jours : plafond de 50 sauvegardes pour un même jour, les plus anciennes du jour partent d\'abord', () =>
  avecDossier(async (d) => {
    const fichiers = [];
    for (let i = 0; i < 55; i++) fichiers.push(nomJour('2026-10-04', `${String(Math.floor(i / 60) + 8).padStart(2, '0')}h${String(i % 60).padStart(2, '0')}m00s`));
    const { supprimes, restantes } = await rotationSur(d, fichiers, { joursQuotidiens: 7, maintenant: new Date(2026, 9, 4, 20, 0, 0) });
    assert.equal(restantes.length, 50);
    assert.deepEqual(supprimes, fichiers.slice(0, 5).sort());
  }));

test('rotation par jours : heure d\'été (jour de 23 h ou 25 h) : les jours restent des jours civils distincts', () =>
  avecDossier(async (d) => {
    // Passage à l'heure d'été en Europe : 2026-03-29 (jour de 23 h) ; à l'heure d'hiver : 2026-10-25 (jour de 25 h).
    const fichiers = [
      nomJour('2026-03-28', '23h30m00s'), nomJour('2026-03-29', '00h10m00s'), nomJour('2026-03-29', '03h30m00s'), nomJour('2026-03-30', '00h05m00s'),
      nomJour('2026-10-24', '23h59m00s'), nomJour('2026-10-25', '00h30m00s'), nomJour('2026-10-25', '02h30m00s'), nomJour('2026-10-26', '00h01m00s'),
    ];
    const printemps = await rotationSur(d, fichiers.slice(0, 4), { joursQuotidiens: 3, maintenant: new Date(2026, 2, 30, 8, 0, 0) });
    assert.deepEqual(printemps.restantes, [nomJour('2026-03-28', '23h30m00s'), nomJour('2026-03-29', '03h30m00s'), nomJour('2026-03-30', '00h05m00s')]);
    const automne = await rotationSur(d, fichiers.slice(4), { joursQuotidiens: 3, maintenant: new Date(2026, 9, 26, 8, 0, 0) });
    assert.deepEqual(automne.restantes.filter((n) => n.includes('2026-10-2')), [nomJour('2026-10-24', '23h59m00s'), nomJour('2026-10-25', '02h30m00s'), nomJour('2026-10-26', '00h01m00s')]);
  }));

test('rotation par jours : minimum de 7 jours, et les réserves « opération » et « conservée » ne changent pas', () =>
  avecDossier(async (d) => {
    const fichiers = [];
    for (let j = 1; j <= 9; j++) fichiers.push(nomJour(`2026-10-0${j}`, '08h00m00s'));
    fichiers.push(nomJour('2026-10-01', '09h00m00s', 'avant-suppression'), nomJour('2026-10-01', '09h00m00s', 'avant-restauration'));
    const { restantes } = await rotationSur(d, fichiers, { joursQuotidiens: 7, maintenant: new Date(2026, 9, 9, 12, 0, 0) });
    assert.deepEqual(restantes.filter((n) => n.includes('_demarrage')).map((n) => n.slice(11, 21)), ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
    assert.ok(restantes.includes(nomJour('2026-10-01', '09h00m00s', 'avant-suppression')), 'opération : limite de 30 fichiers, pas de jours');
    assert.ok(restantes.includes(nomJour('2026-10-01', '09h00m00s', 'avant-restauration')), 'conservée : 90 jours');
  }));

test('liste : tri chronologique, taille, fichiers étrangers ignorés ; dossier absent -> liste vide', () =>
  avecDossier(async (d) => {
    assert.deepEqual(await listerSauvegardes({ dossier: d }), []);
    await fs.mkdir(path.join(d, 'sauvegardes'));
    await fs.writeFile(path.join(d, 'sauvegardes', 'sauvegarde-2026-10-02_09h00m00s_quotidienne.json'), '12345');
    await fs.writeFile(path.join(d, 'sauvegardes', 'sauvegarde-2026-10-01_09h00m00s_demarrage.json'), '12');
    await fs.writeFile(path.join(d, 'sauvegardes', 'readme.txt'), 'x');
    const l = await listerSauvegardes({ dossier: d, avecTaille: true });
    assert.deepEqual(l.map((s) => [s.jour, s.raison, s.tailleOctets]), [['2026-10-01', 'demarrage', 2], ['2026-10-02', 'quotidienne', 5]]);
  }));

// --- Intégration au store ---

test('démarrage : sauvegarde du fichier existant (octets identiques) ; aucune sauvegarde à la création du fichier', () =>
  avecDossier(async (d, f) => {
    const horloge = horlogeFixe('2026-10-02', '09:14:03');
    await ouvrirStore({ dossier: d, horloge });
    assert.deepEqual(await noms(d), [], 'premier lancement : rien à sauvegarder');
    await ajouter(await ouvrirStore({ dossier: d, horloge }), {});
    const octets = await fs.readFile(f);
    await ouvrirStore({ dossier: d, horloge: horlogeFixe('2026-10-03', '08:00:00') });
    const liste = (await noms(d)).filter((n) => n.includes('2026-10-03') && n.includes('_demarrage'));
    assert.deepEqual(liste, ['sauvegarde-2026-10-03_08h00m00s_demarrage.json']);
    assert.deepEqual(await fs.readFile(path.join(d, 'sauvegardes', liste[0])), octets);
  }));

test('démarrage : pas de nouvelle sauvegarde si le fichier est identique à la plus récente (la rotation n\'est pas épuisée)', () =>
  avecDossier(async (d) => {
    const horloge = horlogeReglable('2026-10-02');
    await ajouter(await ouvrirStore({ dossier: d, horloge }), {});
    for (let i = 0; i < 5; i++) {
      horloge.regler('2026-10-02', `1${i}:00:00`);
      await ouvrirStore({ dossier: d, horloge });
    }
    assert.equal((await noms(d)).filter((n) => n.includes('_demarrage')).length, 1);
  }));

test('démarrage : fichier illisible ou schéma plus récent -> aucune sauvegarde (rien n\'est modifié, la rotation n\'est pas polluée)', () =>
  avecDossier(async (d, f) => {
    await fs.writeFile(f, '{ pas du json');
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    assert.equal(store.etat().modeDegrade, true);
    assert.deepEqual(await noms(d), []);
    assert.equal(await fs.readFile(f, 'utf8'), '{ pas du json');
  }));

test('quotidienne : une seule fois par jour, avant la première modification ; contient l\'état d\'AVANT', () =>
  avecDossier(async (d, f) => {
    const horloge = horlogeReglable('2026-10-02');
    const store = await ouvrirStore({ dossier: d, horloge });
    assert.deepEqual(await noms(d), []);
    await ajouter(store, {});
    let liste = await noms(d);
    assert.equal(liste.length, 1);
    assert.match(liste[0], /_quotidienne\.json$/);
    assert.equal((await lireJson(path.join(d, 'sauvegardes', liste[0]))).prestations.length, 0, 'état avant la 1re modification');
    await ajouter(store, { patient: { nom: 'Ours', prenom: 'Baloo' } });
    await ajouter(store, { patient: { nom: 'Renard', prenom: 'Goupil' } });
    assert.equal((await noms(d)).length, 1, 'pas de seconde sauvegarde le même jour');

    horloge.regler('2026-10-03', '08:00:00'); // application restée ouverte après minuit
    await ajouter(store, { patient: { nom: 'Souris', prenom: 'Stuart' } });
    liste = await noms(d);
    assert.equal(liste.length, 2);
    assert.equal((await lireJson(path.join(d, 'sauvegardes', liste[1]))).prestations.length, 3, 'état avant la 1re modification du 03/10');
    assert.equal((await lireJson(f)).prestations.length, 4);
  }));

test('quotidienne : la sauvegarde de démarrage du jour couvre la première modification (pas de doublon le même jour)', () =>
  avecDossier(async (d) => {
    const horloge = horlogeReglable('2026-10-02');
    await ajouter(await ouvrirStore({ dossier: d, horloge }), {});
    horloge.regler('2026-10-03', '08:00:00');
    const store = await ouvrirStore({ dossier: d, horloge });
    await ajouter(store, { patient: { nom: 'Ours', prenom: 'Baloo' } });
    assert.deepEqual((await noms(d)).filter((n) => n.startsWith('sauvegarde-2026-10-03')).map((n) => n.split('_')[2]), ['demarrage.json']);
  }));

test('une saisie refusée (validation) ne crée aucune sauvegarde', () =>
  avecDossier(async (d) => {
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    await assert.rejects(ajouter(store, { montantCentimes: -1 }), (e) => e.status === 422);
    assert.deepEqual(await noms(d), []);
  }));

test('avant suppression : sauvegarde « avant-suppression » contenant la ligne, puis suppression', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    const { resultat: ligne } = await ajouter(store, {});
    await store.muter('suppr', async (copie) => {
      const { supprimerPrestation } = await import('../../src/domain/prestations.js');
      return supprimerPrestation(copie, ligne.id);
    }, { sauvegardeAvant: 'avant-suppression' });
    assert.equal((await lireJson(f)).prestations.length, 0);
    const nom = (await noms(d)).find((n) => n.includes('avant-suppression'));
    assert.ok(nom);
    const sauvegarde = await lireJson(path.join(d, 'sauvegardes', nom));
    assert.equal(sauvegarde.prestations.length, 1);
    assert.equal(sauvegarde.prestations[0].id, ligne.id);
  }));

test('avant suppression : si la sauvegarde échoue, l\'opération est annulée et rien n\'est modifié', () =>
  avecDossier(async (d, f) => {
    const horloge = horlogeFixe();
    const sain = await ouvrirStore({ dossier: d, horloge });
    const { resultat: ligne } = await ajouter(sain, {});
    // Un FICHIER nommé « sauvegardes » empêche de créer le dossier de sauvegardes.
    const d2 = await creerDossierTemp('sauv-bloque');
    try {
      await fs.copyFile(f, path.join(d2, NOM_FICHIER_ACTIF));
      await fs.writeFile(path.join(d2, 'sauvegardes'), 'je suis un fichier');
      const store = await ouvrirStore({ dossier: d2, horloge });
      assert.equal(store.etat().avertissements[0]?.code, 'SAUVEGARDE_ECHOUEE', 'échec de la sauvegarde de démarrage : avertissement visible');
      const avant = await fs.readFile(path.join(d2, NOM_FICHIER_ACTIF));
      await assert.rejects(
        store.muter('suppr', async (copie) => {
          const { supprimerPrestation } = await import('../../src/domain/prestations.js');
          return supprimerPrestation(copie, ligne.id);
        }, { sauvegardeAvant: 'avant-suppression' }),
        (e) => e.status === 503 && e.code === 'SAUVEGARDE_ECHOUEE',
      );
      assert.deepEqual(await fs.readFile(path.join(d2, NOM_FICHIER_ACTIF)), avant, 'fichier de données intact');
      assert.equal(store.lire().prestations.length, 1);
    } finally {
      await fs.unlink(path.join(d2, 'sauvegardes')).catch(() => {});
      await supprimerDossierTemp(d2);
    }
  }));

test('échec de sauvegarde quotidienne : avertissement visible, l\'application continue et la modification est enregistrée', () =>
  avecDossier(async (d, f) => {
    await fs.writeFile(path.join(d, 'sauvegardes'), 'je suis un fichier');
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() }); // fichier créé : pas de sauvegarde de démarrage
    assert.deepEqual(store.etat().avertissements, []);
    await ajouter(store, {});
    assert.equal(store.etat().avertissements.length, 1);
    assert.equal(store.etat().avertissements[0].code, 'SAUVEGARDE_ECHOUEE');
    assert.match(store.etat().avertissements[0].message, /sauvegarde automatique/);
    assert.equal((await lireJson(f)).prestations.length, 1);
    await fs.unlink(path.join(d, 'sauvegardes'));
    await ajouter(store, { patient: { nom: 'Ours', prenom: 'Baloo' } }); // dossier de nouveau utilisable : retenté, avertissement levé
    assert.deepEqual(store.etat().avertissements, []);
    assert.equal((await noms(d)).length, 1);
  }));

test('rotation intégrée : le paramètre sauvegardesConservees est respecté après une création de sauvegarde', () =>
  avecDossier(async (d) => {
    const horloge = horlogeReglable('2026-10-01');
    const store = await ouvrirStore({ dossier: d, horloge });
    await store.muter('p', (copie) => { copie.parametres.sauvegardesConservees = 7; });
    for (let j = 2; j <= 10; j++) {
      horloge.regler(`2026-10-${String(j).padStart(2, '0')}`, '08:00:00');
      await ajouter(store, { patient: { nom: `Nom${j}`, prenom: 'X' } }); // 1re modification de chaque jour -> « quotidienne »
    }
    const liste = (await noms(d)).filter((n) => n.includes('quotidienne'));
    assert.equal(liste.length, 7);
    assert.match(liste[0], /2026-10-04/);
    assert.match(liste[6], /2026-10-10/);
  }));

test('une écriture refusée par le disque (rename) n\'efface pas la sauvegarde déjà créée', () =>
  avecDossier(async (d) => {
    const horloge = horlogeFixe();
    await ajouter(await ouvrirStore({ dossier: d, horloge }), {});
    const { fs: bloque } = fsAvecRenameRefuse(1000, 'EIO');
    const store = await ouvrirStore({ dossier: d, horloge, fs: bloque });
    await assert.rejects(ajouter(store, { patient: { nom: 'Ours', prenom: 'Baloo' } }));
    assert.equal(store.lire().prestations.length, 1);
  }));

// --- Annulation de la dernière action (architecture §6.4) ---

test('annulation : restaure la ligne modifiée et le dernier mode de paiement ; un seul jeton valable, une seule fois', () =>
  avecDossier(async (d, f) => {
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    const { resultat: ligne } = await ajouter(store, {});
    const { payerEnTotalite } = await import('../../src/domain/prestations.js');
    const r = await store.muter('payer', (copie) => payerEnTotalite(copie, ligne.id, { mode: 'cheque' }, { aujourdHui: '2026-10-02', maintenant: '2026-10-02T10:00:00.000Z', nouvelId: () => 'v1' }));
    assert.ok(r.annulation);
    assert.equal(store.lire().prestations[0].versements.length, 1);
    assert.equal(store.lire().parametres.dernierModePaiement, 'cheque');

    await store.annuler(r.annulation);
    assert.equal(store.lire().prestations[0].versements.length, 0);
    assert.equal(store.lire().parametres.dernierModePaiement, null);
    assert.equal((await lireJson(f)).prestations[0].versements.length, 0, 'l\'annulation est écrite sur disque');
    await assert.rejects(store.annuler(r.annulation), (e) => e.status === 409 && e.code === 'ANNULATION_IMPOSSIBLE');
  }));

test('annulation : impossible si une autre modification a eu lieu depuis ; jeton inconnu refusé', () =>
  avecDossier(async (d) => {
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    const a = await ajouter(store, {});
    await ajouter(store, { patient: { nom: 'Ours', prenom: 'Baloo' } });
    await assert.rejects(store.annuler(a.annulation), (e) => e.code === 'ANNULATION_IMPOSSIBLE');
    await assert.rejects(store.annuler('inconnu'), (e) => e.code === 'ANNULATION_IMPOSSIBLE');
    assert.equal(store.lire().prestations.length, 2);
  }));

test('annulation d\'une suppression : la ligne et ses versements reviennent', () =>
  avecDossier(async (d) => {
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    const { resultat: ligne } = await ajouter(store, {});
    const { ajouterVersement, supprimerPrestation } = await import('../../src/domain/prestations.js');
    const ctx = { aujourdHui: '2026-10-02', maintenant: '2026-10-02T10:00:00.000Z', nouvelId: () => 'v9' };
    await store.muter('v', (copie) => ajouterVersement(copie, ligne.id, { montantCentimes: 1000, date: '2026-10-02', mode: 'especes' }, ctx));
    const suppr = await store.muter('s', (copie) => supprimerPrestation(copie, ligne.id), { sauvegardeAvant: 'avant-suppression' });
    assert.equal(store.lire().prestations.length, 0);
    await store.annuler(suppr.annulation);
    assert.equal(store.lire().prestations.length, 1);
    assert.equal(store.lire().prestations[0].versements[0].montantCentimes, 1000);
  }));

test('annulation d\'une création : la ligne disparaît', () =>
  avecDossier(async (d) => {
    const store = await ouvrirStore({ dossier: d, horloge: horlogeFixe() });
    const a = await ajouter(store, {});
    await store.annuler(a.annulation);
    assert.equal(store.lire().prestations.length, 0);
  }));

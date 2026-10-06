// Recette QA : fichier JSON corrompu / tronqué / schéma plus récent, sauvegardes et rotation (7 à 365), restauration.
// Tout se passe dans des dossiers temporaires sous .tmp/tests/ (jamais data/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { client, etatAvec, lireDisque, ligne, NOM_FICHIER, octetsDisque, prestationsAleatoires, saisie, serveurAvecFichier, texteJson } from './aides-qa.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { horlogeReglable } from '../aides/horloge.js';
import { ecrireFichierTest } from '../aides/temp.js';

async function avecFichier(contenu, fn, options) {
  const s = await serveurAvecFichier(contenu, options);
  try {
    await fn(s, client(s));
  } finally {
    await s.arreter();
  }
}
const noms = async (s, sous = '') => (await fs.readdir(path.join(s.dossier, sous)).catch(() => [])).sort();
const bonEtat = () => etatAvec([ligne(1), ligne(2, { date: '2026-09-20' })], { revision: 7 });

// ------------------------------------------------------------------ fichier illisible au démarrage

const VARIANTES_ILLISIBLES = () => {
  const bon = texteJson(bonEtat());
  const e = JSON.parse(bon);
  const variante = (modif) => { const c = structuredClone(e); modif(c); return texteJson(c); };
  return [
    ['fichier vide (0 octet)', ''],
    ['espaces seuls', '   \n  '],
    ['octets binaires', Buffer.from([0x00, 0xff, 0xfe, 0x42, 0x80, 0x01])],
    ['JSON tronqué à la moitié', bon.slice(0, Math.floor(bon.length / 2))],
    ['JSON tronqué à 10 octets', bon.slice(0, 10)],
    ['JSON tronqué avant l\'accolade finale', bon.slice(0, bon.lastIndexOf('}'))],
    ['tableau JSON', '[]'],
    ['null', 'null'],
    ['nombre', '42'],
    ['chaîne', '"suivi-facturation"'],
    ['objet vide', '{}'],
    ['autre format', JSON.stringify({ format: 'autre-chose', schemaVersion: 1 })],
    ['schemaVersion texte', variante((c) => { c.schemaVersion = '1'; })],
    ['schemaVersion négatif', variante((c) => { c.schemaVersion = -1; })],
    ['schemaVersion décimal', variante((c) => { c.schemaVersion = 1.5; })],
    ['identifiants de prestation en double', variante((c) => { c.prestations[1].id = c.prestations[0].id; })],
    ['montant décimal', variante((c) => { c.prestations[0].montantCentimes = 45.5; })],
    ['montant négatif', variante((c) => { c.prestations[0].montantCentimes = -1; })],
    ['montant hors borne', variante((c) => { c.prestations[0].montantCentimes = 10_000_001; })],
    ['date impossible', variante((c) => { c.prestations[0].date = '2026-02-30'; })],
    ['statut inconnu', variante((c) => { c.prestations[0].statut = 'paye'; })],
    ['mode de paiement inconnu', variante((c) => { c.prestations[0].versements = [{ id: 'v', montantCentimes: 1, date: '2026-09-01', mode: 'bitcoin' }]; })],
    ['versement à 0 centime', variante((c) => { c.prestations[0].versements = [{ id: 'v', montantCentimes: 0, date: '2026-09-01', mode: 'carte' }]; })],
    ['versements absents', variante((c) => { delete c.prestations[0].versements; })],
    ['catalogue absent', variante((c) => { delete c.catalogue; })],
    ['prestations non tableau', variante((c) => { c.prestations = {}; })],
    ['patient sans nom', variante((c) => { c.prestations[0].patient.nom = ''; })],
  ];
};

test('fichier de données illisible ou incohérent au démarrage : mode dégradé explicite, fichier jamais écrasé (octets identiques), aucune écriture API, restauration proposée', async () => {
  for (const [nom, contenu] of VARIANTES_ILLISIBLES()) {
    await avecFichier(contenu, async (s, a) => {
      const avant = await octetsDisque(s.dossier);
      const etat = (await a.get('/api/etat')).json;
      assert.equal(etat.modeDegrade, true, nom);
      assert.ok(etat.erreur.message.length > 20 && !/undefined|\[object|TypeError|at \S+\.js/.test(etat.erreur.message), `${nom} : message lisible (« ${etat.erreur.message.slice(0, 60)} »)`);
      assert.equal((await a.get('/api/prestations')).status, 503, nom);
      assert.equal((await a.get('/api/recap')).status, 503, nom);
      assert.equal((await a.get('/api/indicateurs/ca-mensuel')).status, 503, nom);
      assert.equal((await a.get('/api/export?format=csv')).status, 503, nom);
      const ecriture = await a.post('/api/prestations', saisie());
      assert.equal(ecriture.status, 503, nom);
      assert.equal(ecriture.json.erreur.code, 'DONNEES_ILLISIBLES', nom);
      assert.equal((await a.post('/api/sauvegardes')).status, 503, nom);
      assert.equal((await a.get('/api/sauvegardes')).status, 200, `${nom} : la liste des sauvegardes reste disponible`);
      assert.ok((await octetsDisque(s.dossier)).equals(avant), `${nom} : le fichier n'a pas été modifié d'un octet`);
      assert.deepEqual((await noms(s)).filter((n) => n !== NOM_FICHIER && n !== 'sauvegardes'), [], `${nom} : aucun fichier parasite`);
    });
  }
});

test('fichier illisible : « Repartir d\'un fichier vide » refusé s\'il existe une sauvegarde restaurable ; accepté sinon, avec copie préalable de l\'abîmé', async () => {
  const abime = texteJson(bonEtat()).slice(0, 200);
  // 1) une sauvegarde saine existe : refus
  await avecFichier(abime, async (s, a) => {
    await fs.mkdir(path.join(s.dossier, 'sauvegardes'), { recursive: true });
    await ecrireFichierTest(path.join(s.dossier, 'sauvegardes', 'sauvegarde-2026-09-30_08h00m00s_quotidienne.json'), texteJson(bonEtat()));
    await a.get('/api/etat'); // relecture éventuelle
    const refus = await a.post('/api/fichier-vide', { confirmer: true });
    assert.equal(refus.status, 409);
    assert.equal(refus.json.erreur.code, 'SAUVEGARDE_RESTAURABLE');
    assert.ok((await octetsDisque(s.dossier)).equals(Buffer.from(abime)));
  });
  // 2) aucune sauvegarde : refus sans confirmation, accepté avec ; l'abîmé est conservé à part
  await avecFichier(abime, async (s, a) => {
    assert.equal((await a.post('/api/fichier-vide', { confirmer: false })).status, 422);
    const ok = await a.post('/api/fichier-vide', { confirmer: true });
    assert.equal(ok.status, 201);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 0);
    const copies = (await noms(s, 'sauvegardes')).filter((n) => n.includes('avant-reinitialisation'));
    assert.equal(copies.length, 1);
    assert.equal(await fs.readFile(path.join(s.dossier, 'sauvegardes', copies[0]), 'utf8'), abime, 'copie brute de l\'abîmé');
    assert.deepEqual((await lireDisque(s.dossier)).catalogue, [], 'repartir d un fichier vide : catalogue vide');
  }, { catalogueVide: true });
});

test('fichier absent : dossier vide = premier démarrage propre (catalogue vide, aucune prestation) ; sauvegardes présentes sans fichier = mode dégradé « absent », rien n\'est créé', async () => {
  await avecFichier(null, async (s, a) => {
    const etat = (await a.get('/api/etat')).json;
    assert.equal(etat.modeDegrade, false);
    assert.equal(etat.nombrePrestations, 0);
    const d = await lireDisque(s.dossier);
    assert.deepEqual(d.catalogue, [], 'premier démarrage : catalogue vide');
    assert.equal(d.prestations.length, 0);
    assert.equal(d.schemaVersion, 1);
    assert.equal(d.parametres.sauvegardesConservees, 30);
    assert.equal((await noms(s, 'sauvegardes')).length, 0, 'rien à sauvegarder sur un fichier tout juste créé');
  }, { catalogueVide: true });
  await avecFichier(null, async (s, a) => {
    assert.equal((await a.get('/api/etat')).json.modeDegrade, false);
  });
  const s = await demarrerServeurTest({
    preparer: async (dossier) => {
      await fs.mkdir(path.join(dossier, 'sauvegardes'));
      await ecrireFichierTest(path.join(dossier, 'sauvegardes', 'sauvegarde-2026-09-30_08h00m00s_quotidienne.json'), texteJson(bonEtat()));
    },
  });
  try {
    const a = client(s);
    const etat = (await a.get('/api/etat')).json;
    assert.equal(etat.modeDegrade, true);
    assert.equal(etat.erreur.raison, 'absent');
    assert.deepEqual((await noms(s)).filter((n) => n === NOM_FICHIER), [], 'aucun fichier fabriqué');
    // le fichier revient : l'état se corrige tout seul à la prochaine vérification, sans rien écraser
    await ecrireFichierTest(path.join(s.dossier, NOM_FICHIER), texteJson(bonEtat()));
    const apres = (await a.get('/api/etat')).json;
    assert.equal(apres.modeDegrade, false);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 2);
  } finally {
    await s.arreter();
  }
});

// ------------------------------------------------------------------ schéma plus récent

test('schéma plus récent : lecture seule, aucune écriture (503 SCHEMA_PLUS_RECENT), fichier intact octet pour octet, pas de sauvegarde de démarrage ni de migration', async () => {
  const futur = { ...bonEtat(), schemaVersion: 2, champFutur: { a: 1 } };
  const texte = texteJson(futur);
  await avecFichier(texte, async (s, a) => {
    const avant = await octetsDisque(s.dossier);
    const etat = (await a.get('/api/etat')).json;
    assert.equal(etat.lectureSeule, true);
    assert.equal(etat.modeDegrade, false);
    for (const [methode, chemin, corps] of [['post', '/api/prestations', saisie()], ['patch', '/api/parametres', { sauvegardesConservees: 10 }], ['post', '/api/catalogue', { libelle: 'x', tarifCentimes: 1, categorie: 'autre' }]]) {
      const r = await a[methode](chemin, corps);
      assert.equal(r.status, 503, chemin);
      assert.equal(r.json.erreur.code, 'SCHEMA_PLUS_RECENT', chemin);
    }
    assert.equal((await a.get('/api/export?format=csv')).status, 503, 'CSV impossible en lecture seule');
    assert.equal((await a.get('/api/export?format=json')).status, 200, 'export complet possible');
    assert.ok((await octetsDisque(s.dossier)).equals(avant));
    assert.deepEqual(await noms(s, 'sauvegardes'), [], 'aucune sauvegarde de démarrage d\'un fichier d\'une version plus récente');
  });
});

test('schéma plus récent dont la structure est inconnue (champs renommés) : message clair (503 SCHEMA_PLUS_RECENT), jamais 500, fichier intact, aucune écriture', async () => {
  const futur = { format: 'suivi-facturation', schemaVersion: 2, revision: 3, majLe: '2026-10-01T00:00:00.000Z', parametres: { sauvegardesConservees: 30, dernierModePaiement: null }, catalogue: [], prestations: [{ identifiant: 'x', quand: '2026-10-01', somme: 12.5 }] };
  await avecFichier(texteJson(futur), async (s, a) => {
    const avant = await octetsDisque(s.dossier);
    for (const chemin of ['/api/etat', '/api/prestations', '/api/recap', '/api/indicateurs/ca-mensuel', '/api/indicateurs/seances', '/api/indicateurs/repartition', '/api/indicateurs/impayes', '/api/indicateurs/prevision', '/api/indicateurs/synthese', '/api/patients', '/api/catalogue']) {
      const r = await a.get(chemin);
      assert.ok(r.status === 200 || r.status === 503, `GET ${chemin} : ${r.status} ${r.texte.slice(0, 100)}`);
      if (r.status === 503) {
        assert.equal(r.json.erreur.code, 'SCHEMA_PLUS_RECENT', chemin);
        assert.match(r.json.erreur.message, /version plus récente/, chemin);
      }
    }
    const etat = (await a.get('/api/etat')).json;
    assert.equal(etat.lectureSeule, true);
    assert.equal(etat.structureInconnue, true);
    assert.equal(etat.modeDegrade, false);
    assert.equal((await a.get('/api/prestations')).status, 503);
    assert.equal((await a.get('/api/export?format=json')).status, 200, 'export complet toujours possible');
    assert.equal((await a.post('/api/prestations', saisie())).json.erreur.code, 'SCHEMA_PLUS_RECENT');
    assert.ok((await octetsDisque(s.dossier)).equals(avant), 'fichier intact octet pour octet');
    assert.deepEqual(await noms(s, 'sauvegardes'), [], 'aucune sauvegarde ni migration');
  });
});

test('fichier avec BOM UTF-8 ou fins de ligne CRLF (éditeur Windows) : lu normalement', async () => {
  const bon = texteJson(bonEtat());
  await avecFichier(`﻿${bon}`, async (s, a) => assert.equal((await a.get('/api/prestations')).json.lignes.length, 2));
  await avecFichier(bon.replaceAll('\n', '\r\n'), async (s, a) => assert.equal((await a.get('/api/prestations')).json.lignes.length, 2));
});

test('migration d\'un fichier plus ancien (schemaVersion 0) : sans migration connue, mode dégradé sans rien écrire (jamais de perte)', async () => {
  const ancien = { ...bonEtat(), schemaVersion: 0 };
  await avecFichier(texteJson(ancien), async (s, a) => {
    const avant = await octetsDisque(s.dossier);
    assert.equal((await a.get('/api/etat')).json.modeDegrade, true);
    assert.ok((await octetsDisque(s.dossier)).equals(avant));
  });
});

test('fichiers temporaires orphelins au démarrage : seuls les motifs exacts sont supprimés ; un fichier de l\'utilisatrice au nom voisin reste', async () => {
  const s = await serveurAvecFichier(texteJson(bonEtat()), {
    preparer: async (dossier) => {
      for (const n of ['suivi-facturation.json.tmp-123-1', 'archive-2025.json.tmp-9-9', 'suivi-facturation.json.tmp-abc', 'notes-perso.txt', 'suivi-facturation.json.bak']) await ecrireFichierTest(path.join(dossier, n), 'x');
    },
  });
  try {
    const restants = await noms(s);
    assert.ok(!restants.includes('suivi-facturation.json.tmp-123-1'));
    assert.ok(!restants.includes('archive-2025.json.tmp-9-9'));
    assert.ok(restants.includes('suivi-facturation.json.tmp-abc'), 'motif non exact : conservé');
    assert.ok(restants.includes('notes-perso.txt'));
    assert.ok(restants.includes('suivi-facturation.json.bak'));
  } finally {
    await s.arreter();
  }
});

// ------------------------------------------------------------------ sauvegardes, rotation

test('réglage « sauvegardes conservées » : 7 et 365 acceptés ; 6, 366, 0, -1, 7.5, « 30 », null, vide refusés (422) ; l\'écriture ne change rien en cas de refus', async () => {
  await avecFichier(null, async (s, a) => {
    for (const bon of [7, 30, 365]) assert.equal((await a.patch('/api/parametres', { sauvegardesConservees: bon })).status, 200, String(bon));
    for (const mauvais of [6, 366, 0, -1, 7.5, '30', null, '', true, [], 1e9]) {
      const r = await a.patch('/api/parametres', { sauvegardesConservees: mauvais });
      assert.equal(r.status, 422, JSON.stringify(mauvais));
    }
    assert.equal((await a.patch('/api/parametres', {})).status, 400);
    assert.equal((await a.patch('/api/parametres', { sauvegardesConservees: 30, autre: 1 })).status, 400);
    assert.equal((await lireDisque(s.dossier)).parametres.sauvegardesConservees, 365);
  });
});

test('rotation : avec le réglage 7, après 20 jours d\'usage il reste exactement 7 sauvegardes quotidiennes (les plus récentes) ; les autres réserves sont intactes', async () => {
  const horloge = horlogeReglable('2026-09-01', '09:00:00');
  const s = await demarrerServeurTest({ horloge });
  const a = client(s);
  try {
    await a.patch('/api/parametres', { sauvegardesConservees: 7 });
    for (let jour = 1; jour <= 20; jour++) {
      horloge.regler(`2026-09-${String(jour).padStart(2, '0')}`, '09:00:00');
      assert.equal((await a.post('/api/prestations', saisie({ date: '2026-09-01', motif: `jour ${jour}` }))).status, 201);
    }
    const quotidiennes = (await noms(s, 'sauvegardes')).filter((n) => /_(quotidienne|demarrage|manuelle)/.test(n));
    assert.equal(quotidiennes.length, 7, quotidiennes.join(', '));
    const jours = quotidiennes.map((n) => n.slice(11, 21));
    assert.deepEqual(jours, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'], 'ce sont les plus récentes qui restent');
    // une suppression crée une sauvegarde « avant-suppression » qui n'est pas comptée dans les 7
    const id = (await a.get('/api/prestations')).json.lignes[0].id;
    await a.del(`/api/prestations/${id}`);
    const apres = await noms(s, 'sauvegardes');
    assert.equal(apres.filter((n) => /_quotidienne/.test(n)).length, 7);
    assert.equal(apres.filter((n) => n.includes('avant-suppression')).length, 1);
    // aucun fichier de données ni archive touché par la rotation
    assert.ok((await noms(s)).includes(NOM_FICHIER));
  } finally {
    await s.arreter();
  }
});

test('rotation : le réglage 365 ne supprime rien en 40 jours ; une sauvegarde manuelle ne remplace jamais le fichier actif', async () => {
  const horloge = horlogeReglable('2026-01-01', '09:00:00');
  const s = await demarrerServeurTest({ horloge });
  const a = client(s);
  try {
    await a.patch('/api/parametres', { sauvegardesConservees: 365 });
    for (let j = 0; j < 40; j++) {
      horloge.regler(new Date(Date.UTC(2026, 0, 1 + j)).toISOString().slice(0, 10), '09:00:00');
      await a.post('/api/prestations', saisie({ motif: `j${j}` }));
    }
    assert.equal((await noms(s, 'sauvegardes')).filter((n) => n.includes('quotidienne') || n.includes('demarrage')).length, 40);
    const m = await a.post('/api/sauvegardes');
    assert.equal(m.status, 201);
    assert.match(m.json.donnees.nom, /manuelle/);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 40);
  } finally {
    await s.arreter();
  }
});

test('une sauvegarde par jour d\'usage : plusieurs modifications le même jour n\'en créent qu\'une ; changement de jour à minuit = nouvelle sauvegarde', async () => {
  const horloge = horlogeReglable('2026-10-02', '23:59:50');
  const s = await demarrerServeurTest({ horloge });
  const a = client(s);
  try {
    for (let i = 0; i < 5; i++) await a.post('/api/prestations', saisie({ motif: `m${i}` }));
    const avant = (await noms(s, 'sauvegardes')).filter((n) => /quotidienne|demarrage/.test(n)).length;
    assert.ok(avant <= 1, `une seule sauvegarde pour la journée (${avant})`);
    horloge.regler('2026-10-03', '00:00:05');
    await a.post('/api/prestations', saisie({ motif: 'après minuit' }));
    await a.post('/api/prestations', saisie({ motif: 'encore' }));
    const apres = (await noms(s, 'sauvegardes')).filter((n) => /quotidienne|demarrage/.test(n));
    assert.equal(apres.length, avant + 1);
    assert.ok(apres.some((n) => n.startsWith('sauvegarde-2026-10-03_')));
  } finally {
    await s.arreter();
  }
});

// ------------------------------------------------------------------ restauration

test('restauration : aperçu dans la liste (date, nombre de prestations), état actuel sauvegardé d\'abord, révision qui ne recule jamais, réglage courant conservé', async () => {
  const horloge = horlogeReglable('2026-10-02', '09:00:00');
  const s = await demarrerServeurTest({ horloge });
  const a = client(s);
  try {
    await a.post('/api/prestations', saisie({ motif: 'une' }));
    const manuelle = (await a.post('/api/sauvegardes')).json.donnees.nom; // 1 prestation
    await a.post('/api/prestations', saisie({ motif: 'deux', date: '2026-10-01' }));
    await a.post('/api/prestations', saisie({ motif: 'trois', date: '2026-09-30' }));
    await a.patch('/api/parametres', { sauvegardesConservees: 12 });
    const revisionAvant = (await lireDisque(s.dossier)).revision;
    const liste = (await a.get('/api/sauvegardes')).json.sauvegardes;
    const cible = liste.find((x) => x.nom === manuelle);
    assert.equal(cible.nombrePrestations, 1);
    assert.equal(cible.restaurable, true);
    assert.equal(cible.raison, 'manuelle');

    assert.equal((await a.post(`/api/sauvegardes/${manuelle}/restaurer`, {})).status, 422, 'confirmation obligatoire');
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 3, 'rien n\'a changé sans confirmation');
    const r = await a.post(`/api/sauvegardes/${manuelle}/restaurer`, { confirmer: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.donnees.nombrePrestations, 1);
    assert.ok(r.json.donnees.sauvegardeAvant.includes('avant-restauration'));
    assert.equal(r.json.donnees.annulable, true);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 1);
    const apres = await lireDisque(s.dossier);
    assert.ok(apres.revision > revisionAvant, 'la révision ne recule jamais');
    assert.equal(apres.parametres.sauvegardesConservees, 12, 'le réglage courant prime sur celui de la sauvegarde');
    // retour en arrière par la copie « avant restauration »
    const retour = await a.post(`/api/sauvegardes/${r.json.donnees.sauvegardeAvant}/restaurer`, { confirmer: true });
    assert.equal(retour.status, 200);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 3, 'les trois prestations sont revenues');
  } finally {
    await s.arreter();
  }
});

test('restauration d\'une sauvegarde abîmée, tronquée, d\'un autre format ou d\'un schéma plus récent : refusée (422), fichier actuel intact octet pour octet, aucune sauvegarde parasite', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    await a.post('/api/prestations', saisie());
    const bon = texteJson(bonEtat());
    const cas = {
      'sauvegarde-2026-01-01_08h00m00s_manuelle.json': bon.slice(0, 120),
      'sauvegarde-2026-01-02_08h00m00s_manuelle.json': '',
      'sauvegarde-2026-01-03_08h00m00s_manuelle.json': JSON.stringify({ format: 'autre' }),
      'sauvegarde-2026-01-04_08h00m00s_manuelle.json': texteJson({ ...bonEtat(), schemaVersion: 2 }),
      'sauvegarde-2026-01-05_08h00m00s_manuelle.json': texteJson((() => { const e = bonEtat(); e.prestations[0].montantCentimes = 1.5; return e; })()),
    };
    for (const [nom, contenu] of Object.entries(cas)) await ecrireFichierTest(path.join(s.dossier, 'sauvegardes', nom), contenu);
    const avant = await octetsDisque(s.dossier);
    const nomsAvant = await noms(s, 'sauvegardes');
    const liste = (await a.get('/api/sauvegardes')).json.sauvegardes;
    for (const nom of Object.keys(cas)) {
      assert.equal(liste.find((x) => x.nom === nom).restaurable, false, nom);
      const r = await a.post(`/api/sauvegardes/${nom}/restaurer`, { confirmer: true });
      assert.equal(r.status, 422, nom);
      assert.equal(r.json.erreur.code, 'SAUVEGARDE_INCOMPATIBLE', nom);
    }
    assert.ok((await octetsDisque(s.dossier)).equals(avant), 'le fichier actuel n\'a pas bougé');
    assert.deepEqual(await noms(s, 'sauvegardes'), nomsAvant, 'aucune copie « avant restauration » créée pour un refus');
  } finally {
    await s.arreter();
  }
});

test('restauration depuis le mode dégradé : fichier abîmé conservé en copie, sauvegarde saine restaurée, application de nouveau utilisable', async () => {
  const abime = texteJson(bonEtat()).slice(0, 300);
  await avecFichier(abime, async (s, a) => {
    await fs.mkdir(path.join(s.dossier, 'sauvegardes'), { recursive: true });
    const sauve = 'sauvegarde-2026-09-30_08h00m00s_quotidienne.json';
    await ecrireFichierTest(path.join(s.dossier, 'sauvegardes', sauve), texteJson(bonEtat()));
    assert.equal((await a.get('/api/etat')).json.modeDegrade, true);
    const r = await a.post(`/api/sauvegardes/${sauve}/restaurer`, { confirmer: true, depuisModeDegrade: true });
    assert.equal(r.status, 200);
    assert.equal((await a.get('/api/etat')).json.modeDegrade, false);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 2);
    const copie = (await noms(s, 'sauvegardes')).find((n) => n.includes('avant-restauration'));
    assert.equal(await fs.readFile(path.join(s.dossier, 'sauvegardes', copie), 'utf8'), abime, 'le fichier abîmé est gardé tel quel');
    assert.equal((await a.post('/api/prestations', saisie())).status, 201);
  });
});

test('restauration : le fichier est revenu lisible entre-temps (synchro terminée) -> refus 409 FICHIER_REVENU, rien n\'est écrasé', async () => {
  const bon = texteJson(bonEtat());
  await avecFichier(bon.slice(0, 100), async (s, a) => {
    await fs.mkdir(path.join(s.dossier, 'sauvegardes'), { recursive: true });
    const sauve = 'sauvegarde-2026-09-01_08h00m00s_quotidienne.json';
    await ecrireFichierTest(path.join(s.dossier, 'sauvegardes', sauve), texteJson(etatAvec([ligne(9)], { revision: 2 })));
    assert.equal((await a.get('/api/etat')).json.modeDegrade, true);
    await ecrireFichierTest(path.join(s.dossier, NOM_FICHIER), bon); // la synchronisation termine
    const r = await a.post(`/api/sauvegardes/${sauve}/restaurer`, { confirmer: true, depuisModeDegrade: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.erreur.code, 'FICHIER_REVENU');
    assert.ok((await octetsDisque(s.dossier)).equals(Buffer.from(bon)));
  });
});

test('conflit : fichier remplacé par un tiers pendant l\'usage -> écriture suspendue (409 CONFLIT_FICHIER), deux copies de conflit, fichier du tiers intact ; restauration résout', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    await a.post('/api/prestations', saisie({ motif: 'ma saisie' }));
    const version = texteJson(etatAvec(prestationsAleatoires(5, { graine: 9 }), { revision: 50 }));
    await ecrireFichierTest(path.join(s.dossier, NOM_FICHIER), version);
    const refus = await a.post('/api/prestations', saisie({ date: '2026-10-01' }));
    assert.equal(refus.status, 409);
    assert.equal(refus.json.erreur.code, 'CONFLIT_FICHIER');
    assert.equal(await fs.readFile(path.join(s.dossier, NOM_FICHIER), 'utf8'), version, 'version du tiers intacte');
    const etat = (await a.get('/api/etat')).json;
    assert.equal(etat.conflit.type, 'modifie');
    assert.equal(etat.conflit.disque.nombrePrestations, 5);
    assert.equal(etat.conflit.application.nombrePrestations, 1);
    const copies = await noms(s, 'sauvegardes');
    assert.ok(copies.some((n) => n.includes('conflit-disque')) && copies.some((n) => n.includes('conflit-memoire')));
    // résolution : garder la version de l'application (restaurer la copie conflit-memoire)
    const memoire = copies.find((n) => n.includes('conflit-memoire'));
    const ok = await a.post(`/api/sauvegardes/${memoire}/restaurer`, { confirmer: true });
    assert.equal(ok.status, 200);
    assert.equal((await a.get('/api/etat')).json.conflit, null);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 1);
    assert.equal((await a.post('/api/prestations', saisie({ date: '2026-10-01' }))).status, 201);
  } finally {
    await s.arreter();
  }
});

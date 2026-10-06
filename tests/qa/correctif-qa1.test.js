// Correctifs issus de la recette (fichier vide, avertissements de date, annulation, nettoyage des temporaires, incohérences de statut,
// ordre des sauvegardes, favicon, libellé accessible, noms de patients) : tests complémentaires de ceux de
// points-connus-ouverts.test.js et fichiers-et-sauvegardes.test.js. Données factices uniquement, dossiers sous .tmp/.
// Les caractères invisibles sont construits avec String.fromCodePoint : rien d'invisible dans le source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { client, etatAvec, ligne, octetsDisque, saisie, serveurAvecFichier, texteJson } from './aides-qa.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { fsSauvegardesBloquees } from '../aides/fs-defaillant.js';
import { RACINE } from '../aides/temp.js';
import { compterIncoherencesStatut } from '../../src/domain/schema.js';
import { validerCreation } from '../../src/domain/validation.js';
import { catalogueTest } from '../aides/catalogue-test.js';
import { listerSauvegardes, nettoyerTemporairesSauvegardes } from '../../src/store/sauvegardes.js';
import { resumePaiement } from '../../public/js/format.js';

const noms = async (dossier, sous) => (await fs.readdir(path.join(dossier, sous)).catch(() => [])).sort();
const car = (...codes) => String.fromCodePoint(...codes);

// ---------------------------------------------------------------- Fichier sans aucune prestation

test('le récapitulatif signale un fichier sans aucune prestation (fichierVide), et plus dès qu\'il y en a une', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    assert.equal((await a.get('/api/recap')).json.fichierVide, true);
    await a.post('/api/prestations', saisie());
    assert.equal((await a.get('/api/recap')).json.fichierVide, false);
  } finally {
    await s.arreter();
  }
});

test('l\'écran Facturation ne construit pas le bandeau « Tout est facturé » quand fichierVide (garde en tête de indicateurAFacturer)', async () => {
  const source = await fs.readFile(path.join(RACINE, 'public', 'js', 'pages', 'facturation.js'), 'utf8');
  const debut = source.indexOf('function indicateurAFacturer(');
  const garde = source.indexOf('recap.fichierVide', debut);
  const bandeau = source.indexOf("'Tout est facturé'", debut);
  assert.ok(debut > 0 && garde > debut && garde < bandeau, 'la garde précède la construction du bandeau');
});

// ---------------------------------------------------------------- Avertissements sur la date de facturation

test('avertissement unique et non bloquant par cas, jamais pour une date correcte ni pour la date du jour par défaut', async () => {
  const s = await demarrerServeurTest(); // aujourd'hui = 2026-10-02
  const a = client(s);
  try {
    const l1 = (await a.post('/api/prestations', saisie({ date: '2026-09-01' }))).json.donnees;
    const l2 = (await a.post('/api/prestations', saisie({ date: '2026-09-02' }))).json.donnees;
    const ok = await a.post('/api/prestations/statut', { ids: [l1.id], statut: 'facture', date: '2026-09-30' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.avertissements, []);
    const deux = await a.post('/api/prestations/statut', { ids: [l2.id], statut: 'facture', date: '2026-08-15' });
    assert.equal(deux.status, 200, 'non bloquant : la date est bien enregistrée');
    assert.deepEqual(deux.json.avertissements.map((x) => x.code), ['DATE_FACTURATION_AVANT_PRESTATION']);
    const etat = (await a.get('/api/prestations')).json.lignes;
    assert.equal(etat.find((x) => x.id === l2.id).factureLe, '2026-08-15');
    // date du jour par défaut (aucune date envoyée) : aucun avertissement de date
    await a.post('/api/prestations/statut', { ids: [l1.id, l2.id], statut: 'a_facturer' });
    const defaut = await a.post('/api/prestations/statut', { ids: [l1.id, l2.id], statut: 'facture' });
    assert.deepEqual(defaut.json.avertissements, []);
  } finally {
    await s.arreter();
  }
});

test('date de facturation future sur plusieurs prestations : un seul message qui les compte', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    const ids = [];
    for (const date of ['2026-09-01', '2026-09-02']) ids.push((await a.post('/api/prestations', saisie({ date }))).json.donnees.id);
    const r = await a.post('/api/prestations/statut', { ids, statut: 'facture', date: '2030-01-01' });
    assert.equal(r.status, 200);
    const futur = r.json.avertissements.filter((x) => x.code === 'DATE_FACTURATION_FUTURE');
    assert.equal(futur.length, 1);
    assert.match(futur[0].message, /2 prestations/);
  } finally {
    await s.arreter();
  }
});

// ---------------------------------------------------------------- Annulation et sauvegarde préalable

test('annuler une création crée d\'abord une sauvegarde « avant-suppression » ; annuler une modification n\'en crée pas', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    const c = await a.post('/api/prestations', saisie());
    const modif = await a.post(`/api/prestations/${c.json.donnees.id}/payer-totalite`, { mode: 'cheque' });
    await a.post(`/api/annulations/${modif.json.annulation}`);
    assert.deepEqual((await noms(s.dossier, 'sauvegardes')).filter((n) => n.includes('avant-suppression')), [], 'annulation d\'un versement : pas de suppression de ligne');
    // la création n'est plus la dernière action : on en refait une
    const c2 = await a.post('/api/prestations', saisie({ patient: { nom: 'Ours', prenom: 'Baloo' } }));
    const r = await a.post(`/api/annulations/${c2.json.annulation}`);
    assert.equal(r.status, 200);
    const avant = (await noms(s.dossier, 'sauvegardes')).filter((n) => n.includes('avant-suppression'));
    assert.equal(avant.length, 1);
    const copie = JSON.parse(await fs.readFile(path.join(s.dossier, 'sauvegardes', avant[0]), 'utf8'));
    assert.equal(copie.prestations.length, 2, 'la copie contient la ligne qui allait disparaître');
  } finally {
    await s.arreter();
  }
});

test('sauvegarde impossible = annulation refusée avec un message honnête, la ligne reste, puis réussite une fois le dossier accessible', async () => {
  const { fs: fsSimule, etat } = fsSauvegardesBloquees();
  const s = await demarrerServeurTest({ fs: fsSimule });
  const a = client(s);
  try {
    const c = await a.post('/api/prestations', saisie());
    etat.bloque = true;
    const refus = await a.post(`/api/annulations/${c.json.annulation}`);
    assert.equal(refus.status, 503);
    assert.equal(refus.json.erreur.code, 'SAUVEGARDE_ECHOUEE');
    assert.match(refus.json.erreur.message, /Rien n'a été modifié/);
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 1, 'la ligne est toujours là');
    etat.bloque = false;
    const ok = await a.post(`/api/annulations/${c.json.annulation}`);
    assert.equal(ok.status, 200, 'le jeton reste valable après un échec');
    assert.equal((await a.get('/api/prestations')).json.lignes.length, 0);
  } finally {
    await s.arreter();
  }
});

// ---------------------------------------------------------------- Nettoyage des temporaires de sauvegarde

test('seuls les temporaires de sauvegardes/ au nom strict sont supprimés, fichier par fichier ; sauvegardes valides, noms voisins et sous-dossiers intacts', async () => {
  const s = await serveurAvecFichier(texteJson(etatAvec([ligne(1)])), {
    preparer: async (dossier) => {
      const d = path.join(dossier, 'sauvegardes');
      await fs.mkdir(d);
      const ecrire = (nom) => fs.writeFile(path.join(d, nom), 'x');
      for (const nom of [
        'sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-99-1',
        'sauvegarde-2026-09-01_08h00m00s_manuelle-2.json.tmp-1234-56',
        'sauvegarde-2026-09-01_08h00m00s_avant-suppression.json.tmp-7-8',
        // à conserver
        'sauvegarde-2026-09-01_08h00m00s_manuelle.json',
        'sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-x-1',
        'sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-1',
        'sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-1-1.bak',
        'notes.json.tmp-1-1',
        'autre.tmp-1-1',
        'copie-sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-1-1',
      ]) await ecrire(nom);
      // un dossier au nom d'un temporaire, contenant un fichier : jamais parcouru ni supprimé
      await fs.mkdir(path.join(d, 'sauvegarde-2026-09-02_08h00m00s_manuelle.json.tmp-5-5'));
      await fs.writeFile(path.join(d, 'sauvegarde-2026-09-02_08h00m00s_manuelle.json.tmp-5-5', 'dedans.txt'), 'x');
    },
  });
  try {
    assert.deepEqual((await noms(s.dossier, 'sauvegardes')).filter((n) => n.endsWith('.tmp-99-1') || n.endsWith('.tmp-1234-56') || n.endsWith('.tmp-7-8')), []);
    const restants = await noms(s.dossier, 'sauvegardes');
    for (const garde of [
      'sauvegarde-2026-09-01_08h00m00s_manuelle.json',
      'sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-x-1',
      'sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-1',
      'sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-1-1.bak',
      'notes.json.tmp-1-1',
      'autre.tmp-1-1',
      'copie-sauvegarde-2026-09-01_08h00m00s_manuelle.json.tmp-1-1',
      'sauvegarde-2026-09-02_08h00m00s_manuelle.json.tmp-5-5',
    ]) assert.ok(restants.includes(garde), `conservé : ${garde}`);
    assert.deepEqual(await noms(path.join(s.dossier, 'sauvegardes'), 'sauvegarde-2026-09-02_08h00m00s_manuelle.json.tmp-5-5'), ['dedans.txt']);
  } finally {
    await s.arreter();
  }
});

test('nettoyerTemporairesSauvegardes sans dossier sauvegardes/ : rien, sans erreur ; renvoie les noms supprimés', async () => {
  const s = await demarrerServeurTest();
  try {
    const vide = path.join(s.dossier, 'inexistant');
    assert.deepEqual(await nettoyerTemporairesSauvegardes(vide), []);
    await fs.mkdir(path.join(s.dossier, 'sauvegardes'), { recursive: true });
    await fs.writeFile(path.join(s.dossier, 'sauvegardes', 'sauvegarde-2026-09-01_08h00m00s_quotidienne.json.tmp-3-4'), 'x');
    assert.deepEqual(await nettoyerTemporairesSauvegardes(s.dossier), ['sauvegarde-2026-09-01_08h00m00s_quotidienne.json.tmp-3-4']);
    assert.deepEqual(await nettoyerTemporairesSauvegardes(s.dossier), []);
  } finally {
    await s.arreter();
  }
});

// ---------------------------------------------------------------- Incohérences de statut

test('compterIncoherencesStatut compte « facturé » sans date et « à facturer » avec date', () => {
  const etat = etatAvec([
    ligne(1, { statut: 'facture', factureLe: null }),
    ligne(2, { statut: 'facture', factureLe: '2026-09-30' }),
    ligne(3, { statut: 'a_facturer', factureLe: '2026-09-30' }),
    ligne(4),
  ]);
  assert.deepEqual(compterIncoherencesStatut(etat), { factureSansDate: 1, aFacturerAvecDate: 1 });
  assert.deepEqual(compterIncoherencesStatut(etatAvec([ligne(1)])), { factureSansDate: 0, aFacturerAvecDate: 0 });
  assert.deepEqual(compterIncoherencesStatut(null), { factureSansDate: 0, aFacturerAvecDate: 0 });
});

test('le fichier incohérent reste ouvert et modifiable, /api/etat porte un avertissement qui le dit, fichier intact', async () => {
  const contenu = texteJson(etatAvec([ligne(1, { statut: 'facture', factureLe: null }), ligne(2)]));
  const s = await serveurAvecFichier(contenu);
  const a = client(s);
  try {
    const avant = await octetsDisque(s.dossier);
    const etat = (await a.get('/api/etat')).json;
    assert.equal(etat.modeDegrade, false);
    assert.equal(etat.lectureSeule, false);
    const av = etat.avertissements.filter((x) => x.code === 'DONNEES_INCOHERENTES');
    assert.equal(av.length, 1);
    assert.match(av[0].message, /1 prestation est marquée « facturée » sans date de facturation/);
    assert.ok((await octetsDisque(s.dossier)).equals(avant), 'rien n\'est corrigé en silence');
    assert.equal((await a.post('/api/prestations', saisie())).status, 201, 'écriture non bloquée');
  } finally {
    await s.arreter();
  }
});

test('fichier cohérent (jeu d\'exemple du dépôt) : aucun avertissement de données', async () => {
  const exemple = await fs.readFile(path.join(RACINE, 'config', 'exemple.json'), 'utf8');
  const s = await serveurAvecFichier(exemple);
  try {
    const etat = (await client(s).get('/api/etat')).json;
    assert.deepEqual(etat.avertissements.filter((x) => x.code === 'DONNEES_INCOHERENTES'), []);
  } finally {
    await s.arreter();
  }
});

// ---------------------------------------------------------------- Ordre des sauvegardes d'une même seconde

test('ordre numérique des suffixes d\'une même seconde (sans suffixe, -2, -10)', async () => {
  const s = await demarrerServeurTest();
  try {
    const d = path.join(s.dossier, 'sauvegardes');
    await fs.mkdir(d, { recursive: true });
    const base = 'sauvegarde-2026-09-01_08h00m00s_manuelle';
    for (const n of [`${base}-10.json`, `${base}-2.json`, `${base}.json`, 'sauvegarde-2026-09-01_08h00m01s_manuelle.json']) await fs.writeFile(path.join(d, n), '{}');
    assert.deepEqual((await listerSauvegardes({ dossier: s.dossier })).map((x) => x.nom), [`${base}.json`, `${base}-2.json`, `${base}-10.json`, 'sauvegarde-2026-09-01_08h00m01s_manuelle.json']);
  } finally {
    await s.arreter();
  }
});

// ---------------------------------------------------------------- Favicon

test('GET et HEAD /favicon.ico répondent 204 sans corps, avec les en-têtes de sécurité ; les contrôles Host et Sec-Fetch-Site restent appliqués', async () => {
  const s = await demarrerServeurTest();
  try {
    for (const methode of ['GET', 'HEAD']) {
      const r = await s.requete({ chemin: '/favicon.ico', methode });
      assert.equal(r.status, 204, methode);
      assert.equal(r.texte, '');
      assert.ok(r.headers['content-security-policy']);
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
    }
    assert.equal((await s.requete({ chemin: '/favicon.ico', hote: 'evil.example:80' })).status, 403);
    assert.equal((await s.requete({ chemin: '/favicon.ico', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await s.requete({ chemin: '/favicon.ico', methode: 'POST', headers: { Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await s.requete({ chemin: '/favicon.ico/x' })).status, 404, 'seul le chemin exact est répondu');
    assert.equal((await s.requete({ chemin: '/favicon.png' })).status, 404);
  } finally {
    await s.arreter();
  }
});

// ---------------------------------------------------------------- Texte accessible du mode « Autre »

test('le texte accessible du mode « Autre » est « un autre mode » (seul, en tête, en fin de liste)', () => {
  const v = (mode, date) => ({ mode, date, montantCentimes: 100 });
  assert.equal(resumePaiement({ etat: 'paye', versements: [v('autre', '2026-10-01')] }).aria, 'Payé en totalité par un autre mode');
  assert.equal(resumePaiement({ etat: 'partiel', versements: [v('autre', '2026-10-01')] }).aria, 'Partiellement payé par un autre mode');
  assert.equal(resumePaiement({ etat: 'paye', versements: [v('especes', '2026-10-01'), v('autre', '2026-10-02')] }).aria, 'Payé en totalité par espèces et un autre mode');
  assert.equal(resumePaiement({ etat: 'paye', versements: [v('autre', '2026-10-01'), v('cheque', '2026-10-02')] }).aria, 'Payé en totalité par un autre mode et chèque');
  assert.equal(resumePaiement({ etat: 'paye', versements: [v('autre', '2026-10-01')] }).modes, 'Autre', 'le libellé affiché ne change pas');
});

// ---------------------------------------------------------------- Noms de patients

const catalogue = catalogueTest();
const creation = (nom, prenom) => validerCreation({ patient: { nom, prenom }, date: '2026-10-02', prestationId: catalogue[0].id, montantCentimes: 4500 }, catalogue);
const refus = (nom, prenom) => {
  try {
    creation(nom, prenom);
  } catch (e) {
    return e;
  }
  return null;
};

const INVISIBLES = [
  ['espace de largeur nulle', car(0x200b)],
  ['antiliant de largeur nulle', car(0x200c)],
  ['liant de largeur nulle', car(0x200d)],
  ['joint de mots', car(0x2060)],
  ['BOM / insécable de largeur nulle', car(0xfeff)],
  ['marque gauche-droite', car(0x200e)],
  ['marque droite-gauche', car(0x200f)],
  ['embedding gauche-droite', car(0x202a)],
  ['embedding droite-gauche', car(0x202b)],
  ['fin de formatage', car(0x202c)],
  ['override gauche-droite', car(0x202d)],
  ['override droite-gauche', car(0x202e)],
  ['isolat gauche-droite', car(0x2066)],
  ['isolat droite-gauche', car(0x2067)],
  ['isolat premier fort', car(0x2068)],
  ['fin d\'isolat', car(0x2069)],
  ['trait d\'union conditionnel', car(0x00ad)],
  ['séparateur de ligne', car(0x2028)],
  ['séparateur de paragraphe', car(0x2029)],
  ['caractère de balisage', car(0xe0041)],
  ['sélecteur de variante', car(0xfe0f)],
  ['remplissage hangul', car(0x3164)],
  ['nul', car(0x00)],
  ['sonnerie', car(0x07)],
  ['tabulation', car(0x09)],
  ['retour à la ligne', car(0x0a)],
  ['suppression', car(0x7f)],
  ['contrôle C1', car(0x85)],
];

test('noms : caractères invisibles ou de contrôle refusés (422 en français) au milieu, au début, à la fin, dans le nom comme dans le prénom', () => {
  for (const [libelle, c] of INVISIBLES) {
    for (const [nom, prenom] of [[`Du${c}pont`, 'Léa'], [`${c}Dupont`, 'Léa'], [`Dupont${c}`, 'Léa'], ['Dupont', `Lé${c}a`], ['Dupont', `${c}Léa`], ['Dupont', `Léa${c}`]]) {
      const e = refus(nom, prenom);
      assert.ok(e, `${libelle} accepté (${JSON.stringify([nom, prenom])})`);
      assert.equal(e.status, 422, libelle);
      assert.equal(e.code, 'VALIDATION', libelle);
      const champ = e.champs.nom ?? e.champs.prenom;
      assert.match(champ, /non autorisé/, libelle);
    }
  }
});

test('noms : un nom fait seulement d\'un caractère invisible est refusé, même quand il ressemble à un champ vide', () => {
  assert.ok(refus(car(0x200b), 'Léa'));
  assert.ok(refus('Dupont', car(0x200b, 0x200b)));
  assert.ok(refus('Dupont', car(0x2060)));
});

test('noms : accents, traits d\'union, apostrophes (droite et typographique), points, lettres non latines conservés', () => {
  for (const [nom, prenom] of [
    ['Lefèvre-Dubois', 'Anne-Sophie'],
    ["D'Arcy", "N'Guyen"],
    [`D${car(0x2019)}Arcy`, 'Zoé'],
    ['de la Fontaine', 'Jean Marie'],
    ['O.Brien', 'Œdipe'],
    ['Çelik', 'Éloïse'],
    ['Müller', 'Björn'],
    ['Ñandú', 'José'],
    ['Nguyễn', 'Văn'],
    ['Иванов', 'Мария'],
  ]) {
    const v = creation(nom, prenom);
    assert.deepEqual(v.identite, { nom, prenom, nouveau: false });
  }
});

test('noms : espaces multiples, en début et en fin normalisés (espaces insécables et fines compris)', () => {
  const v = creation(`  Du   Pont${car(0xa0)}`, `${car(0x2009)}Anne ${car(0xa0)} Sophie `);
  assert.deepEqual(v.identite, { nom: 'Du Pont', prenom: 'Anne Sophie', nouveau: false });
});

test('noms : données existantes du jeu d\'exemple et de la génération factice toujours acceptées', async () => {
  const exemple = JSON.parse(await fs.readFile(path.join(RACINE, 'config', 'exemple.json'), 'utf8'));
  const patients = new Map(exemple.prestations.map((l) => [`${l.patient.nom}|${l.patient.prenom}`, l.patient]));
  assert.ok(patients.size > 0);
  for (const p of patients.values()) assert.equal(creation(p.nom, p.prenom).identite.nom, p.nom);
});

test('noms : refus par l\'API à la création (422 avec le champ) et à la modification ; rien n\'est écrit', async () => {
  const s = await demarrerServeurTest();
  const a = client(s);
  try {
    const c = (await a.post('/api/prestations', saisie())).json.donnees;
    const avant = await octetsDisque(s.dossier);
    const r = await a.post('/api/prestations', saisie({ patient: { nom: `Lap${car(0x200b)}in`, prenom: 'Pierre' } }));
    assert.equal(r.status, 422);
    assert.match(r.json.erreur.champs.nom, /caractère invisible ou de contrôle/);
    const p = await a.patch(`/api/prestations/${c.id}`, { modifieLe: c.modifieLe, patient: { nom: 'Lapin', prenom: `Pie${car(0x202e)}rre` } });
    assert.equal(p.status, 422);
    assert.match(p.json.erreur.champs.prenom, /caractère invisible ou de contrôle/);
    assert.ok((await octetsDisque(s.dossier)).equals(avant), 'fichier inchangé');
    const bon = await a.post('/api/prestations', saisie({ patient: { nom: '  Lapin ', prenom: 'Pierre  ' } }));
    assert.equal(bon.status, 201);
    assert.equal(bon.json.donnees.patient.id, c.patient.id, 'espaces normalisés : même patient');
  } finally {
    await s.arreter();
  }
});

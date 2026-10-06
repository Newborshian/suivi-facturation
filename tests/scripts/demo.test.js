// Mode démonstration (scripts/demo.mjs) : dossier unique par lancement, aucun lien suivi, jamais le dossier de données réel,
// variables imposées au serveur, jeu fictif daté du jour. Les fonctions exportées n'ont aucun effet de bord à l'import ;
// `main` est exercé dans un vrai processus (ports 4980 à 4999, dossier temporaire du système redirigé sous .tmp/tests/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RACINE, creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';
import { requeteBrute } from '../aides/serveur-aide.js';
import { ajouterJours, aujourdHuiLocal, ecartJours, estDateCivile, moisDe } from '../../src/domain/dates.js';
import { controlerStructure } from '../../src/domain/schema.js';
import {
  PREFIXE_DOSSIER_DEMO,
  SOUS_DOSSIERS,
  creerDossierDemo,
  dateReferenceDuJeu,
  demoTouheLesDonneesReelles,
  ecrireJeuDemo,
  estDossierOrdinaire,
  jeuDuJour,
  retirerDossierDemo,
  verifierDossierDemo,
} from '../../scripts/demo.mjs';

const JEU = JSON.parse(fs.readFileSync(path.join(RACINE, 'config', 'exemple.json'), 'utf8'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms).unref()); // unref : une pause restante ne retient pas le processus de test

/** Crée un lien de dossier (jonction sous Windows, lien symbolique ailleurs) ; renvoie false si le système le refuse. */
function creerLienDossier(cible, lien) {
  try {
    fs.symlinkSync(cible, lien, 'junction');
    return true;
  } catch {
    return false;
  }
}
/** Retire le LIEN seul (jamais son contenu). */
function retirerLien(lien) {
  try {
    fs.unlinkSync(lien);
  } catch {
    fs.rmdirSync(lien);
  }
}
async function avecTemp(fn) {
  const tmp = await creerDossierTemp('demo');
  try {
    return await fn(tmp);
  } finally {
    await supprimerDossierTemp(tmp);
  }
}

// ------------------------------------------------------------------ Garde-fou : dossier de données réel

test('garde-fou : refus si le dossier de démonstration est identique au dossier réel, le contient ou est contenu dedans', async () => {
  await avecTemp(async (tmp) => {
    const reel = path.join(tmp, 'reel');
    fs.mkdirSync(path.join(reel, 'sous'), { recursive: true });
    const autre = path.join(tmp, 'autre');
    fs.mkdirSync(autre);
    assert.equal(demoTouheLesDonneesReelles(reel, reel), true, 'identique');
    assert.equal(demoTouheLesDonneesReelles(path.join(reel, 'sous'), reel), true, 'la démonstration est dans le dossier réel');
    assert.equal(demoTouheLesDonneesReelles(tmp, reel), true, 'la démonstration contient le dossier réel');
    assert.equal(demoTouheLesDonneesReelles(autre, reel), false, 'dossiers sans rapport');
    assert.equal(demoTouheLesDonneesReelles(path.join(tmp, 'reel2'), reel), false, 'même début de nom, pas le même dossier');
    assert.equal(demoTouheLesDonneesReelles(path.join(autre, 'absent'), reel), false, 'chemin inexistant sans rapport');
  });
});

test('garde-fou : comparaison sur chemins réels (un lien vers le dossier réel est reconnu comme lui)', async () => {
  await avecTemp(async (tmp) => {
    const reel = path.join(tmp, 'reel');
    fs.mkdirSync(reel);
    const lien = path.join(tmp, 'lien');
    if (!creerLienDossier(reel, lien)) return; // création de lien refusée par le système : le refus des liens est couvert plus bas
    try {
      assert.equal(demoTouheLesDonneesReelles(lien, reel), true);
    } finally {
      retirerLien(lien);
    }
  });
});

// ------------------------------------------------------------------ Dossier unique

test('dossier de démonstration : unique à chaque appel, sous-dossiers ordinaires, préfixe reconnaissable, retiré en entier', async () => {
  await avecTemp(async (tmp) => {
    const a = creerDossierDemo(tmp);
    const b = creerDossierDemo(tmp);
    assert.notEqual(a.base, b.base);
    for (const d of [a, b]) {
      assert.ok(path.basename(d.base).startsWith(PREFIXE_DOSSIER_DEMO));
      assert.equal(path.dirname(d.base), tmp);
      for (const nom of SOUS_DOSSIERS) assert.ok(estDossierOrdinaire(d[nom]), nom);
      assert.doesNotThrow(() => verifierDossierDemo(d));
    }
    assert.deepEqual(SOUS_DOSSIERS, ['donnees', 'logs', 'verrou']);
    assert.deepEqual(retirerDossierDemo(a.base), []);
    assert.deepEqual(retirerDossierDemo(b.base), []);
    assert.equal(fs.existsSync(a.base), false);
    assert.deepEqual(retirerDossierDemo(a.base), [], 'déjà retiré : rien à faire, aucune erreur');
  });
});

test("refus d'un lien ou d'une jonction à la place d'un sous-dossier : rien n'est écrit à travers le lien, rien n'est supprimé", async () => {
  await avecTemp(async (tmp) => {
    const victime = path.join(tmp, 'victime');
    fs.mkdirSync(victime);
    fs.writeFileSync(path.join(victime, 'suivi-facturation.json'), 'données factices à conserver');
    fs.writeFileSync(path.join(victime, 'autre.txt'), 'x');
    const d = creerDossierDemo(tmp);
    fs.rmdirSync(d.donnees); // dossier vide créé ici, remplacé par un lien vers un dossier « réel »
    if (!creerLienDossier(victime, d.donnees)) {
      // Système sans droit de création de lien : on teste au moins la fonction de vérification avec un fichier à la place du dossier.
      fs.writeFileSync(d.donnees, 'pas un dossier');
      assert.throws(() => verifierDossierDemo(d), /Démonstration refusée/);
      fs.unlinkSync(d.donnees);
      fs.mkdirSync(d.donnees);
      assert.deepEqual(retirerDossierDemo(d.base), []);
      return;
    }
    try {
      assert.equal(estDossierOrdinaire(d.donnees), false, "un lien n'est pas un dossier ordinaire");
      assert.throws(() => verifierDossierDemo(d), /Démonstration refusée/);
      assert.throws(() => ecrireJeuDemo(d, '2026-10-05'), /Démonstration refusée/);
      assert.deepEqual(fs.readdirSync(victime).sort(), ['autre.txt', 'suivi-facturation.json'], "rien n'a été écrit à travers le lien");
      const restes = retirerDossierDemo(d.base);
      assert.ok(restes.includes(d.donnees), 'le lien est laissé, non suivi');
      assert.equal(fs.readFileSync(path.join(victime, 'suivi-facturation.json'), 'utf8'), 'données factices à conserver', 'le contenu de la cible est intact');
      assert.ok(fs.existsSync(path.join(victime, 'autre.txt')));
    } finally {
      retirerLien(d.donnees);
      retirerDossierDemo(d.base);
    }
    assert.ok(fs.existsSync(path.join(victime, 'autre.txt')), 'la cible a survécu au retrait du lien');
  });
});

test("refus d'un dossier de base qui est lui-même un lien", async () => {
  await avecTemp(async (tmp) => {
    const cible = path.join(tmp, 'cible');
    fs.mkdirSync(cible);
    for (const nom of SOUS_DOSSIERS) fs.mkdirSync(path.join(cible, nom));
    const lien = path.join(tmp, 'base-lien');
    if (!creerLienDossier(cible, lien)) return;
    try {
      const dossiers = { base: lien, donnees: path.join(lien, 'donnees'), logs: path.join(lien, 'logs'), verrou: path.join(lien, 'verrou') };
      assert.throws(() => verifierDossierDemo(dossiers), /Démonstration refusée/);
      assert.deepEqual(retirerDossierDemo(lien), [lien], "un lien de base n'est pas parcouru");
      assert.ok(fs.existsSync(path.join(cible, 'donnees')));
    } finally {
      retirerLien(lien);
    }
  });
});

test('retrait : fichiers ordinaires supprimés un à un, dossier inattendu laissé avec son contenu (pas de suppression récursive)', async () => {
  await avecTemp(async (tmp) => {
    const d = creerDossierDemo(tmp);
    fs.writeFileSync(path.join(d.logs, 'suivi-facturation.log'), 'x');
    fs.mkdirSync(path.join(d.donnees, 'sauvegardes'));
    fs.writeFileSync(path.join(d.donnees, 'sauvegardes', 's.json'), '{}');
    fs.mkdirSync(path.join(d.donnees, 'inattendu'));
    fs.writeFileSync(path.join(d.donnees, 'inattendu', 'garde.txt'), 'x');
    const restes = retirerDossierDemo(d.base);
    assert.ok(restes.length > 0, 'le dossier inattendu empêche la suppression complète');
    assert.ok(fs.existsSync(path.join(d.donnees, 'inattendu', 'garde.txt')), 'son contenu est intact');
    assert.equal(fs.existsSync(path.join(d.logs, 'suivi-facturation.log')), false);
    assert.equal(fs.existsSync(path.join(d.donnees, 'sauvegardes', 's.json')), false);
    fs.unlinkSync(path.join(d.donnees, 'inattendu', 'garde.txt')); // nettoyage de l'essai, fichier exact
    fs.rmdirSync(path.join(d.donnees, 'inattendu'));
    assert.deepEqual(retirerDossierDemo(d.base), []);
  });
});

// ------------------------------------------------------------------ Jeu daté du jour

test('jeu daté du jour : toutes les dates décalées du même nombre de jours, original intact, mois courant garni, structure valide', () => {
  const avant = JSON.stringify(JEU);
  for (const jour of ['2026-10-05', '2027-03-15', '2028-02-29', '2030-12-31', '2026-10-02']) {
    const jeu = jeuDuJour(JEU, jour);
    const decalage = ecartJours(dateReferenceDuJeu(JEU), jour);
    assert.equal(jeu.majLe.slice(0, 10), jour, "la date de référence devient aujourd'hui");
    JEU.prestations.forEach((p, i) => {
      const nouvelle = jeu.prestations[i];
      assert.equal(ecartJours(p.date, nouvelle.date), decalage, 'date de prestation');
      assert.deepEqual(nouvelle.versements.map((v) => ecartJours(p.versements[nouvelle.versements.indexOf(v)].date, v.date)), nouvelle.versements.map(() => decalage), 'dates de versement');
      for (const date of [nouvelle.date, nouvelle.factureLe, ...nouvelle.versements.map((v) => v.date)]) if (date !== null) assert.ok(estDateCivile(date), date);
    });
    assert.ok(jeu.prestations.filter((p) => moisDe(p.date) === moisDe(jour)).length > 0, `mois courant garni pour ${jour}`);
    assert.ok(jeu.prestations.some((p) => p.date > jour), `prestations à venir pour ${jour}`);
    assert.ok(jeu.prestations.some((p) => p.date <= ajouterJours(jour, -300)), `historique long pour ${jour}`);
    assert.doesNotThrow(() => controlerStructure(jeu), `structure valide pour ${jour}`);
  }
  assert.equal(JSON.stringify(JEU), avant, "le jeu d'origine n'est pas modifié");
  assert.throws(() => jeuDuJour(JEU, '2026-02-30'), /date du jour invalide/);
});

test('jeu de démonstration écrit une seule fois : création exclusive, jamais par-dessus un fichier existant', async () => {
  await avecTemp(async (tmp) => {
    const d = creerDossierDemo(tmp);
    try {
      const aujourdHui = aujourdHuiLocal(new Date());
      const jeu = ecrireJeuDemo(d, aujourdHui);
      const fichier = path.join(d.donnees, 'suivi-facturation.json');
      assert.deepEqual(JSON.parse(fs.readFileSync(fichier, 'utf8')), jeu);
      assert.equal(jeu.majLe.slice(0, 10), aujourdHui);
      assert.throws(() => ecrireJeuDemo(d, '2026-10-05'), (err) => err.code === 'EEXIST');
      assert.deepEqual(JSON.parse(fs.readFileSync(fichier, 'utf8')), jeu, "le fichier existant n'a pas été remplacé");
    } finally {
      retirerDossierDemo(d.base);
    }
  });
});

// ------------------------------------------------------------------ Processus réel (main)

/** Lance `node scripts/demo.mjs` (sans navigateur, ports 4980 à 4999, dossier temporaire du système redirigé). */
async function lancerDemo(tmp, envSupplementaire = {}) {
  const env = {
    ...process.env,
    TMPDIR: tmp,
    TEMP: tmp,
    TMP: tmp,
    ERGO_LANCEUR_SANS_NAVIGATEUR: '1',
    ERGO_DEMO_PORT_MIN: '4980',
    ERGO_DEMO_PORT_MAX: '4999',
    ...envSupplementaire,
  };
  const enfant = spawn(process.execPath, [path.join(RACINE, 'scripts', 'demo.mjs')], { cwd: RACINE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let sortie = '';
  enfant.stdout.on('data', (m) => (sortie += m));
  enfant.stderr.on('data', (m) => (sortie += m));
  const fin = new Promise((resolve) => enfant.on('close', (code) => resolve(code)));
  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    const m = /Adresse : http:\/\/127\.0\.0\.1:(\d+)\//.exec(sortie);
    if (m) {
      const port = Number(m[1]);
      try {
        const r = await requeteBrute({ port, chemin: '/api/sante' });
        if (r.status === 200 && r.json?.pid === enfant.pid) return { enfant, port, fin, sortie: () => sortie };
      } catch {
        /* pas encore prêt */
      }
    }
    if (enfant.exitCode !== null) break;
    await pause(100);
  }
  if (enfant.exitCode === null) enfant.kill(); // processus lancé ici : arrêt par PID
  throw new Error(`La démonstration n'a pas démarré. Sortie : ${sortie}`);
}
async function arreterDemo(d) {
  const r = await requeteBrute({ port: d.port, methode: 'POST', chemin: '/api/arreter', headers: { Origin: `http://127.0.0.1:${d.port}` } });
  assert.equal(r.status, 202);
  const code = await Promise.race([d.fin, pause(20_000).then(() => 'délai dépassé')]);
  if (code === 'délai dépassé' && d.enfant.exitCode === null) d.enfant.kill();
  return code;
}

test('démonstration (processus réel) : variables imposées, dossier unique hors dossier réel, jeu daté du jour, nettoyage à la sortie', async () => {
  await avecTemp(async (tmp) => {
    const faux = path.join(tmp, 'donnees-reelles');
    fs.mkdirSync(faux);
    const d = await lancerDemo(tmp, { ERGO_DATA_DIR: faux, ERGO_LOG_DIR: path.join(tmp, 'logs-reels'), ERGO_PORT: '4781', ERGO_ARRET_AUTO: '0' });
    let base;
    try {
      assert.ok(d.port >= 4980 && d.port <= 4999, `port ${d.port} dans la plage de démonstration, pas celui de l'environnement`);
      const etat = (await requeteBrute({ port: d.port, chemin: '/api/etat' })).json;
      assert.equal(path.basename(etat.dossier), 'donnees');
      base = path.dirname(etat.dossier);
      assert.ok(path.basename(base).startsWith(PREFIXE_DOSSIER_DEMO), 'dossier unique de la démonstration');
      assert.notEqual(path.resolve(etat.dossier), path.resolve(faux), "ERGO_DATA_DIR de l'environnement n'est pas utilisé");
      assert.equal(etat.arretAuto, true, 'arrêt automatique imposé');
      assert.equal(fs.existsSync(path.join(tmp, 'logs-reels')), false, "ERGO_LOG_DIR de l'environnement n'est pas utilisé");
      const aujourdHui = aujourdHuiLocal(new Date());
      assert.equal(etat.aujourdHui, aujourdHui);
      const mois = (await requeteBrute({ port: d.port, chemin: `/api/prestations?mois=${moisDe(aujourdHui)}` })).json;
      assert.ok(mois.lignes.length > 0, 'le mois courant est garni');
      assert.match(d.sortie(), /Mode démonstration : données fictives/);
    } finally {
      const code = await arreterDemo(d);
      assert.equal(code, 0, d.sortie());
    }
    assert.equal(fs.existsSync(base), false, 'le dossier de démonstration est retiré à la sortie');
    assert.deepEqual(fs.readdirSync(faux), [], "le dossier « réel » de l'environnement est resté vide");
  });
});

test('démonstration (processus réel) : deux lancements simultanés ont chacun leur dossier et leur port', async () => {
  await avecTemp(async (tmp) => {
    const a = await lancerDemo(tmp);
    let b;
    try {
      b = await lancerDemo(tmp);
      assert.notEqual(a.port, b.port);
      const da = (await requeteBrute({ port: a.port, chemin: '/api/etat' })).json.dossier;
      const db = (await requeteBrute({ port: b.port, chemin: '/api/etat' })).json.dossier;
      assert.notEqual(path.dirname(da), path.dirname(db));
    } finally {
      for (const d of [a, b]) if (d) assert.equal(await arreterDemo(d), 0);
    }
    assert.deepEqual(fs.readdirSync(tmp), [], 'aucun dossier de démonstration ne reste');
  });
});

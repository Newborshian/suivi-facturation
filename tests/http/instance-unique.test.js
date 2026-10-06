// Instance unique par dossier de données : vrais processus `node src/server.js`, ports dynamiques, dossiers sous .tmp/tests/.
// Codes de sortie : 3 = déjà lancée, 4 = instance bloquée, 2 = configuration. Aucune donnée réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { cheminVerrou, lireVerrou } from '../../src/verrou.js';
import { RACINE } from '../aides/temp.js';
import { requeteBrute } from '../aides/serveur-aide.js';
import { arreterParBouton, attendrePret, avecDossiers, pause, portLibre } from '../aides/instance-aide.js';

const existe = (chemin) => fs.access(chemin).then(() => true, () => false);
const lireJournal = (logs) => fs.readFile(path.join(logs, 'suivi-facturation.log'), 'utf8').catch(() => '');
const vivant = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Liste récursive des noms (pour comparer deux dossiers de données). */
async function arbre(dossier, prefixe = '') {
  const noms = [];
  for (const e of await fs.readdir(dossier, { withFileTypes: true })) {
    noms.push(prefixe + e.name);
    if (e.isDirectory()) noms.push(...(await arbre(path.join(dossier, e.name), `${prefixe}${e.name}/`)));
  }
  return noms.sort();
}

/** Lance n serveurs en même temps (ports donnés) ; attend que n-1 se terminent ; renvoie le survivant et les codes des autres. */
async function course(ctx, ports) {
  const serveurs = ports.map((port) => ctx.lancer({ port }));
  const codes = new Array(serveurs.length).fill(null);
  serveurs.forEach((s, i) => s.fin.then((c) => (codes[i] = c)));
  const limite = Date.now() + 25_000;
  while (codes.filter((c) => c !== null).length < serveurs.length - 1 && Date.now() < limite) await pause(50);
  await pause(300); // laisse un éventuel second survivant se manifester
  const survivants = serveurs.filter((_, i) => codes[i] === null);
  assert.equal(survivants.length, 1, `exactement un serveur actif ; codes : ${JSON.stringify(codes)} ; sorties : ${serveurs.map((s) => s.sortie()).join(' // ')}`);
  const perdants = codes.filter((c) => c !== null);
  assert.deepEqual(perdants, new Array(serveurs.length - 1).fill(3), `les autres sortent avec le code 3 : ${serveurs.map((s) => s.sortie()).join(' // ')}`);
  return survivants[0];
}

test('instance unique : un serveur actif, un second sur un autre port (même dossier) sort avec le code 3, sans toucher aux données ; /api/sante renvoie le pid', () =>
  avecDossiers(async (ctx) => {
    const a = ctx.lancer({ port: await portLibre() });
    const sante = await attendrePret(a);
    assert.equal(sante.pid, a.pid);
    const avant = await arbre(ctx.donnees);
    const b = ctx.lancer({ port: await portLibre() });
    assert.equal(await Promise.race([b.fin, pause(15_000)]), 3, b.sortie());
    assert.match(b.sortie(), new RegExp(`L'application est déjà lancée \\(port ${a.port}\\)\\.`));
    assert.deepEqual(await arbre(ctx.donnees), avant, 'aucun fichier créé ni supprimé par le second');
    const journal = await lireJournal(ctx.logs);
    assert.match(journal, new RegExp(`INFO +Démarrage ignoré : application déjà lancée \\(PID ${a.pid}, port ${a.port}\\)\\.`));
    assert.equal((await requeteBrute({ port: a.port, chemin: '/api/sante' })).status, 200, 'le premier tourne toujours');
    assert.equal(await arreterParBouton(a), 0);
  }));

test('verrou : contenu minimal sans donnée de patient ni chemin des vraies données, jamais dans le dossier de données', () =>
  avecDossiers(async (ctx) => {
    const a = ctx.lancer({ port: await portLibre() });
    await attendrePret(a);
    const chemin = cheminVerrou(ctx.donnees, { env: ctx.env });
    const texte = await fs.readFile(chemin, 'utf8');
    const v = JSON.parse(texte);
    assert.deepEqual(Object.keys(v).sort(), ['demarreLe', 'dossier', 'pid', 'port', 'version']);
    assert.equal(v.pid, a.pid);
    assert.equal(v.port, a.port);
    assert.equal(path.resolve(v.dossier).toLowerCase(), path.resolve(ctx.donnees).toLowerCase());
    assert.ok(!texte.toLowerCase().includes(path.join(RACINE, 'data').toLowerCase()), 'pas le chemin du dossier data/ du projet');
    for (const mot of ['nom', 'prenom', 'patient', 'Lapin']) assert.ok(!texte.includes(mot), mot);
    assert.equal(path.dirname(chemin), ctx.verrous);
    assert.ok(!(await arbre(ctx.donnees)).some((n) => n.endsWith('.verrou')), 'aucun verrou dans le dossier de données');
    assert.equal((await lireVerrou(ctx.donnees, { env: ctx.env })).statut, 'actif');
    await arreterParBouton(a);
  }));

for (const n of [2, 5]) {
  test(`course : ${n} serveurs lancés en même temps, même dossier, ports différents, 20 fois -> un seul reste actif, les autres sortent avec le code 3`, { timeout: 280_000 }, async () => {
    for (let tour = 1; tour <= 20; tour++) {
      await avecDossiers(async (ctx) => {
        const ports = [];
        for (let i = 0; i < n; i++) ports.push(await portLibre());
        const gagnant = await course(ctx, [...new Set(ports)]);
        const sante = await attendrePret(gagnant);
        assert.equal(sante.pid, gagnant.pid, `tour ${tour}`);
        const journal = await lireJournal(ctx.logs);
        assert.equal(journal.split('\n').filter((l) => /INFO +Démarrage : /.test(l)).length, 1, `tour ${tour} : un seul démarrage`);
        assert.equal(journal.split('\n').filter((l) => /Démarrage ignoré/.test(l)).length, n - 1, `tour ${tour}`);
        assert.equal(await arreterParBouton(gagnant), 0);
        assert.equal(await existe(cheminVerrou(ctx.donnees, { env: ctx.env })), false, 'verrou libéré');
        // Le dossier de données ne contient que ce qu'écrit UN démarrage (même contenu qu'un démarrage seul).
      });
    }
  });
}

const sansHorodatage = (noms) => noms.map((n) => n.replace(/\d{4}-\d\d-\d\d_\d\dh\d\dm\d\ds/, 'HORODATAGE'));
async function demarrerSeul(ctx) {
  const s = ctx.lancer({ port: await portLibre() });
  await attendrePret(s);
  assert.equal(await arreterParBouton(s), 0);
}

test("course : les perdants n'écrivent rien dans le dossier de données (même arborescence que deux démarrages séquentiels)", async () => {
  let reference;
  await avecDossiers(async (ctx) => {
    await demarrerSeul(ctx);
    await demarrerSeul(ctx);
    reference = sansHorodatage(await arbre(ctx.donnees));
  });
  assert.equal(reference.length, 3, reference.join(', '));
  await avecDossiers(async (ctx) => {
    await demarrerSeul(ctx); // crée le fichier ; la course suivante est un « second démarrage » à 5 candidats
    const gagnant = await course(ctx, [await portLibre(), await portLibre(), await portLibre(), await portLibre(), await portLibre()]);
    await attendrePret(gagnant);
    await arreterParBouton(gagnant);
    assert.deepEqual(sansHorodatage(await arbre(ctx.donnees)), reference);
  });
});

test('course : 2 puis 5 serveurs sur le MÊME port, 20 fois -> un seul reste, les autres sortent avec le code 3', { timeout: 280_000 }, async () => {
  for (let tour = 1; tour <= 20; tour++) {
    await avecDossiers(async (ctx) => {
      const port = await portLibre();
      const gagnant = await course(ctx, tour % 2 ? [port, port] : [port, port, port, port, port]);
      assert.equal((await attendrePret(gagnant)).pid, gagnant.pid, `tour ${tour}`);
      assert.equal(await arreterParBouton(gagnant), 0);
    });
  }
});

test('verrou périmé : serveur tué de force (PID connu) -> reprise au démarrage suivant avec un AVERT, fichier de données contrôlé', () =>
  avecDossiers(async (ctx) => {
    const a = ctx.lancer({ port: await portLibre() });
    await attendrePret(a);
    const chemin = cheminVerrou(ctx.donnees, { env: ctx.env });
    assert.equal(await existe(chemin), true);
    if (process.platform === 'win32') {
      const r = spawnSync('taskkill', ['/F', '/PID', String(a.pid)]); // arrêt par PID du processus lancé ici
      assert.equal(r.status, 0, String(r.stderr));
    } else {
      process.kill(a.pid, 'SIGKILL');
    }
    await a.fin;
    assert.equal(await existe(chemin), true, 'une fermeture forcée laisse le verrou');
    assert.equal((await lireVerrou(ctx.donnees, { env: ctx.env })).statut, 'perime');
    assert.ok(!(await lireJournal(ctx.logs)).includes("n'était pas normal"));

    const b = ctx.lancer({ port: await portLibre() });
    await attendrePret(b);
    const journal = await lireJournal(ctx.logs);
    assert.match(journal, /AVERT +Le dernier arrêt de l'application n'était pas normal \(processus terminé de force, panne ou coupure\)\. Le fichier de données a été contrôlé : lisible\.\n/);
    assert.equal(JSON.parse(await fs.readFile(chemin, 'utf8')).pid, b.pid, 'verrou repris');
    assert.equal(await arreterParBouton(b), 0);
    // Un démarrage normal ensuite : pas de nouvel avertissement.
    const c = ctx.lancer({ port: await portLibre() });
    await attendrePret(c);
    assert.equal((await lireJournal(ctx.logs)).split('\n').filter((l) => /n'était pas normal/.test(l)).length, 1);
    await arreterParBouton(c);
  }));

test('verrou périmé et fichier de données illisible : repris quand même, AVERT indique le mode dégradé, fichier non modifié', () =>
  avecDossiers(async (ctx) => {
    const donnee = path.join(ctx.donnees, 'suivi-facturation.json');
    await fs.writeFile(donnee, '{illisible');
    const mort = spawn(process.execPath, ['-e', '']);
    await new Promise((r) => mort.on('close', r));
    await fs.writeFile(cheminVerrou(ctx.donnees, { env: ctx.env }), JSON.stringify({ pid: mort.pid, port: 4780, demarreLe: '2020-01-01T00:00:00.000Z', version: '0', dossier: ctx.donnees }));
    const a = ctx.lancer({ port: await portLibre() });
    await attendrePret(a);
    assert.match(await lireJournal(ctx.logs), /AVERT +Le dernier arrêt de l'application n'était pas normal .*contrôlé : mode dégradé \(raison : [^)]+\)\./);
    assert.equal(await fs.readFile(donnee, 'utf8'), '{illisible');
    await arreterParBouton(a);
  }));

test("PID vivant qui ne répond plus (processus inerte, port inoccupé) : sortie 4, processus et verrou conservés, données intactes", () =>
  avecDossiers(async (ctx) => {
    const inerte = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      await pause(200);
      const chemin = cheminVerrou(ctx.donnees, { env: ctx.env });
      const portMort = await portLibre();
      // Verrou écrit après le démarrage du processus (comme l'écrirait cette instance elle-même) : un PID vivant sans réponse reste « bloque ».
      const contenu = JSON.stringify({ pid: inerte.pid, port: portMort, demarreLe: new Date().toISOString(), version: '0', dossier: ctx.donnees });
      await fs.writeFile(chemin, contenu);
      assert.equal((await lireVerrou(ctx.donnees, { env: ctx.env })).statut, 'bloque');
      const b = ctx.lancer({ port: await portLibre() });
      assert.equal(await Promise.race([b.fin, pause(20_000)]), 4, b.sortie());
      assert.match(b.sortie(), new RegExp(`Une ancienne instance \\(PID ${inerte.pid}, port ${portMort}\\) ne répond plus`));
      assert.equal(vivant(inerte.pid), true, "le processus n'a pas été tué");
      assert.equal(await fs.readFile(chemin, 'utf8'), contenu, 'verrou conservé tel quel');
      assert.deepEqual(await arbre(ctx.donnees), [], 'aucun fichier de données touché');
      assert.match(await lireJournal(ctx.logs), new RegExp(`AVERT +Démarrage refusé : Une ancienne instance \\(PID ${inerte.pid}`));
    } finally {
      inerte.kill(); // processus lancé par ce test
      await new Promise((r) => inerte.on('close', r));
    }
  }));

test('PID vivant qui répond (autre instance) : sortie 3 ; verrou récent d\'une instance pas encore à l\'écoute : attente puis sortie 3', () =>
  avecDossiers(async (ctx) => {
    const a = ctx.lancer({ port: await portLibre() });
    await attendrePret(a);
    const b = ctx.lancer({ port: await portLibre() });
    assert.equal(await Promise.race([b.fin, pause(15_000)]), 3, b.sortie());
    await arreterParBouton(a);
  }));

test('verrou libéré après arrêt propre (bouton)', () =>
  avecDossiers(async (ctx) => {
    const a = ctx.lancer({ port: await portLibre() });
    await attendrePret(a);
    assert.equal(await arreterParBouton(a), 0);
    assert.equal(await existe(cheminVerrou(ctx.donnees, { env: ctx.env })), false);
    assert.match(await lireJournal(ctx.logs), /Arrêt propre \(bouton Quitter\)/);
    const b = ctx.lancer({ port: await portLibre() }); // relancement immédiat : pas d'avertissement
    await attendrePret(b);
    assert.ok(!(await lireJournal(ctx.logs)).includes("n'était pas normal"));
    await arreterParBouton(b);
  }));

test('verrou libéré après arrêt automatique', () =>
  avecDossiers(async (ctx) => {
    const a = ctx.lancer({ port: await portLibre(), env: { ERGO_ARRET_AUTO: '1', ERGO_ARRET_DELAI_PREMIERE_PAGE_S: '1' } });
    await attendrePret(a);
    assert.equal(await Promise.race([a.fin, pause(15_000)]), 0, a.sortie());
    assert.equal(await existe(cheminVerrou(ctx.donnees, { env: ctx.env })), false);
    assert.match(await lireJournal(ctx.logs), /Arrêt propre \(arrêt automatique\)/);
  }));

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  // Sous Windows, Node ne peut pas envoyer ces signaux à un autre processus (kill = arrêt brutal) : test possible seulement ailleurs.
  test(`verrou libéré après ${signal} (Linux/macOS)`, { skip: process.platform === 'win32' ? 'signaux non livrables à un processus enfant sous Windows' : false }, () =>
    avecDossiers(async (ctx) => {
      const a = ctx.lancer({ port: await portLibre() });
      await attendrePret(a);
      process.kill(a.pid, signal);
      assert.equal(await Promise.race([a.fin, pause(15_000)]), 0, a.sortie());
      assert.equal(await existe(cheminVerrou(ctx.donnees, { env: ctx.env })), false);
    }));
}

test('verrou libéré après une erreur de configuration (code 2) : dossier inexistant, port occupé par un autre logiciel', () =>
  avecDossiers(async (ctx) => {
    const inexistant = path.join(ctx.donnees, 'nexiste-pas');
    const a = ctx.lancer({ port: await portLibre(), donnees: inexistant });
    assert.equal(await Promise.race([a.fin, pause(15_000)]), 2, a.sortie());
    assert.equal(await existe(cheminVerrou(inexistant, { env: ctx.env })), false, 'dossier inexistant');

    const occupant = http.createServer();
    await new Promise((r) => occupant.listen(0, '127.0.0.1', r));
    try {
      const b = ctx.lancer({ port: occupant.address().port });
      assert.equal(await Promise.race([b.fin, pause(15_000)]), 2, b.sortie());
      assert.match(b.sortie(), /est déjà utilisé/);
      assert.equal(await existe(cheminVerrou(ctx.donnees, { env: ctx.env })), false, 'port occupé');
      assert.deepEqual(await arbre(ctx.donnees), [], 'aucun fichier de données touché');
    } finally {
      await new Promise((r) => occupant.close(r));
    }
    const c = ctx.lancer({ port: 0, env: { ERGO_PORT: 'abc' } }); // valeur invalide : erreur avant le verrou
    assert.equal(await Promise.race([c.fin, pause(15_000)]), 2, c.sortie());
  }));

// Non-régression (défaut du 2026-10-04) : le renommage du port (mettreAJourPort) levait EPERM sous Windows quand un perdant lisait le verrou au même instant,
// ce qui donnait « erreur inattendue (EPERM) » et le code 1. Les perdants doivent TOUJOURS sortir avec le code 3, jamais 1.
test('course : 30 fois 5 serveurs sur le MÊME port -> exactement un reste, tous les autres sortent avec le code 3 (jamais 1, jamais « erreur inattendue »)', { timeout: 280_000 }, async () => {
  for (let tour = 1; tour <= 30; tour++) {
    await avecDossiers(async (ctx) => {
      const port = await portLibre();
      const gagnant = await course(ctx, [port, port, port, port, port]);
      assert.equal((await attendrePret(gagnant)).pid, gagnant.pid, `tour ${tour}`);
      assert.ok(!/inattendue/.test(await lireJournal(ctx.logs)), `tour ${tour} : ${await lireJournal(ctx.logs)}`);
      assert.equal(await arreterParBouton(gagnant), 0);
    });
  }
});

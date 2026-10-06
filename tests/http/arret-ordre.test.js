// Ordre de l'arrêt propre (src/arret.js), avec des dépendances simulées, et refus de liaison au port (src/http/serveur.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { creerArret } from '../../src/arret.js';
import { ErreurConfig } from '../../src/config.js';
import { portEstLibre } from '../../src/http/serveur.js';

function montage({ echecStore = false } = {}) {
  const evenements = [];
  const note = (e) => evenements.push(e);
  let finEcoute;
  const app = {
    cesserEcoute: () => { note('ecoute-fermee'); return new Promise((resolve) => { finEcoute = () => { note('ecoute-terminee'); resolve(); }; }); },
    fermerConnexions: () => { note('connexions-fermees'); finEcoute(); },
  };
  const store = { fermer: async () => { note('file-videe'); if (echecStore) throw new Error('boum'); } };
  const journal = { info: (m) => note(`journal-info ${m}`), avert: (m) => note(`journal-avert ${m}`), erreur: (m) => note('journal-erreur') };
  const sortir = (code) => note(`sortie ${code}`);
  const minuteur = (fn, delai) => { note(`garde-temps ${delai}`); return { fn }; };
  const arreter = creerArret({ app, store, libererVerrou: () => note('verrou-libere'), journal, sortir, minuteur });
  return { arreter, evenements };
}

test('arrêt propre : garde-temps de 5 s armé en premier, plus de nouvelles requêtes, file vidée, connexions fermées, verrou libéré, journal, sortie 0', async () => {
  const { arreter, evenements } = montage();
  await arreter('bouton Quitter');
  assert.deepEqual(evenements, [
    'garde-temps 5000',
    'ecoute-fermee',
    'file-videe',
    'connexions-fermees',
    'ecoute-terminee',
    'verrou-libere',
    'journal-info Arrêt propre (bouton Quitter).',
    'sortie 0',
  ]);
});

test('arrêt propre : un second appel est sans effet', async () => {
  const { arreter, evenements } = montage();
  await Promise.all([arreter('a'), arreter('b')]);
  assert.equal(evenements.filter((e) => e.startsWith('garde-temps')).length, 1);
  assert.equal(evenements.filter((e) => e.startsWith('sortie')).length, 1);
});

test('arrêt en échec (file d\'écriture en erreur) : verrou libéré, sortie 1, la file est tout de même attendue avant les connexions', async () => {
  const { arreter, evenements } = montage({ echecStore: true });
  await arreter('signal SIGTERM');
  assert.deepEqual(evenements, ['garde-temps 5000', 'ecoute-fermee', 'file-videe', 'journal-erreur', 'verrou-libere', 'sortie 1']);
});

test('garde-temps : à l\'échéance, avertissement au journal puis sortie forcée code 0', async () => {
  const evenements = [];
  let echeance;
  const arreter = creerArret({
    app: { cesserEcoute: () => new Promise(() => {}), fermerConnexions: () => {} }, // le serveur ne se ferme jamais
    store: { fermer: async () => {} },
    libererVerrou: () => {},
    journal: { info() {}, erreur() {}, avert: (m) => evenements.push(m) },
    sortir: (code) => evenements.push(`sortie ${code}`),
    minuteur: (fn) => { echeance = fn; },
  });
  arreter('arrêt automatique'); // ne se termine pas
  await new Promise((r) => setImmediate(r));
  echeance();
  assert.deepEqual(evenements, ['Arrêt (arrêt automatique) : délai de 5 s dépassé, sortie forcée.', 'sortie 0']);
});

// ------------------------------------------------------------------ Liaison au port

test('portEstLibre : port occupé -> false ; port libre -> true', async () => {
  const occupant = http.createServer();
  await new Promise((r) => occupant.listen(0, '127.0.0.1', r));
  const port = occupant.address().port;
  try {
    assert.equal(await portEstLibre(port), false);
  } finally {
    await new Promise((r) => occupant.close(r));
  }
  assert.equal(await portEstLibre(port), true);
});

test('portEstLibre : accès refusé ou autre erreur de liaison -> ErreurConfig (code de sortie 2) en français, jamais l\'erreur brute', async () => {
  const creer = http.createServer;
  try {
    for (const code of ['EACCES', 'EADDRNOTAVAIL']) {
      http.createServer = () => {
        const faux = creer.call(http);
        faux.listen = () => { queueMicrotask(() => faux.emit('error', Object.assign(new Error('simulé'), { code }))); return faux; };
        return faux;
      };
      await assert.rejects(portEstLibre(80), (e) => {
        assert.ok(e instanceof ErreurConfig);
        assert.equal(e.codeSortie, 2);
        assert.match(e.message, /^Le port 80 ne peut pas être ouvert sur 127\.0\.0\.1 \(/);
        assert.match(e.message, code === 'EACCES' ? /accès refusé/ : new RegExp(code));
        assert.match(e.message, /Aucun fichier de données n'a été touché\. Changez ERGO_PORT\./);
        return true;
      }, code);
    }
  } finally {
    http.createServer = creer;
  }
});

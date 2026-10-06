// La garde de diagnostic des tests (tests/aides/garde-processus.js) journalise sans changer le comportement du processus :
// pas de process.exit, exceptions et rejets toujours visibles de node:test et de tout autre gestionnaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';

const garde = pathToFileURL(path.join(RACINE, 'tests', 'aides', 'garde-processus.js')).href;
const executer = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(garde)};\n${code}`], { cwd: RACINE, encoding: 'utf8', timeout: 20_000 });

test('garde : un gestionnaire d\'exceptions ajouté ensuite reçoit toujours l\'exception (la garde ne quitte pas avant lui)', () => {
  const r = executer("process.on('uncaughtException', (e) => console.log('RECU ' + e.message)); setTimeout(() => { throw new Error('boum'); }, 5);");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RECU boum/);
});

test('garde : sans gestionnaire, une exception garde le comportement de Node (code 1, message visible) et est journalisée', () => {
  const r = executer("setTimeout(() => { throw new Error('boum-visible'); }, 5);");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /boum-visible/);
  assert.match(r.stderr, /exception non interceptée/);
});

test('garde : un rejet non géré reste fatal (code 1) et n\'est pas avalé', () => {
  const r = executer("Promise.reject(new Error('rejet-visible'));");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rejet-visible/);
});

test('garde : un processus qui se termine normalement reste à 0 et sans bruit', () => {
  const r = executer("console.log('fin');");
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trim(), '');
});

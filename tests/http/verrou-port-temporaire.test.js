// Verrou d'instance : le fichier temporaire de la mise à jour du port est créé en exclusivité (flag « wx ») sous un nom imprévisible,
// donc jamais écrit à travers un lien ou un fichier posé à l'avance sous l'ancien nom prévisible. Dossiers sous .tmp/tests/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquerirVerrou, cheminVerrou, libererVerrou, mettreAJourPort } from '../../src/verrou.js';
import { creerDossierTemp, supprimerDossierTemp } from '../aides/temp.js';

async function avecDossiers(fn) {
  const donnees = await creerDossierTemp('verrou-tmp-donnees');
  const verrous = await creerDossierTemp('verrou-tmp-verrous');
  try {
    return await fn({ donnees, verrous, env: { ERGO_VERROU_DIR: verrous } });
  } finally {
    await supprimerDossierTemp(donnees);
    await supprimerDossierTemp(verrous);
  }
}

test('mise à jour du port : temporaire créé avec « wx » sous un nom imprévisible ; un fichier posé sous l\'ancien nom prévisible n\'est pas touché', () =>
  avecDossiers(async ({ donnees, verrous, env }) => {
    await acquerirVerrou({ dossierDonnees: donnees, port: null, version: 'x', env });
    const chemin = cheminVerrou(donnees, { env });
    const ancienNom = `${chemin}.${process.pid}.tmp`;
    await fs.writeFile(ancienNom, 'contenu étranger à conserver');
    const ecritures = [];
    const fsApi = {
      ...fsSync,
      writeFileSync: (cible, contenu, options) => {
        ecritures.push({ cible, options });
        return fsSync.writeFileSync(cible, contenu, options);
      },
    };
    assert.equal(mettreAJourPort({ dossierDonnees: donnees, port: 5123, env, fsApi }), true);
    assert.equal(ecritures.length, 1);
    assert.equal(ecritures[0].options.flag, 'wx', 'création exclusive');
    assert.equal(ecritures[0].options.mode, 0o600);
    assert.notEqual(ecritures[0].cible, ancienNom, 'le nom n\'est plus prévisible');
    assert.ok(ecritures[0].cible.startsWith(`${chemin}.${process.pid}.`) && ecritures[0].cible.endsWith('.tmp'));
    assert.equal(await fs.readFile(ancienNom, 'utf8'), 'contenu étranger à conserver');
    assert.equal(JSON.parse(await fs.readFile(chemin, 'utf8')).port, 5123);
    assert.deepEqual((await fs.readdir(verrous)).sort(), [path.basename(ancienNom), path.basename(chemin)].sort(), 'aucun temporaire laissé');
    libererVerrou({ dossierDonnees: donnees, env });
  }));

test('mise à jour du port : un temporaire existant sous le même nom fait échouer la création exclusive (aucun écrasement), sans lever', () =>
  avecDossiers(async ({ donnees, env }) => {
    await acquerirVerrou({ dossierDonnees: donnees, port: null, version: 'x', env });
    const chemin = cheminVerrou(donnees, { env });
    const avant = await fs.readFile(chemin, 'utf8');
    const fsApi = {
      ...fsSync,
      writeFileSync: (cible, contenu, options) => {
        fsSync.writeFileSync(cible, 'déjà là', { flag: 'w' }); // quelqu'un a créé ce nom entre-temps
        return fsSync.writeFileSync(cible, contenu, options);
      },
    };
    assert.equal(mettreAJourPort({ dossierDonnees: donnees, port: 5124, env, fsApi }), false);
    assert.equal(await fs.readFile(chemin, 'utf8'), avant, 'verrou intact');
    libererVerrou({ dossierDonnees: donnees, env });
  }));

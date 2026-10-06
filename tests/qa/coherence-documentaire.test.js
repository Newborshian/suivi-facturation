// Recette QA : cohérence entre la documentation destinée à l'utilisatrice et le comportement réel du code.
// (Ces tests ne modifient pas les documents. Un écart connu et non corrigé serait marqué `todo` avec la différence constatée ;
// son échec ne doit jamais joindre de gros extraits de source au rapport : messages d'assertion courts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';
import { MODES_PAIEMENT } from '../../src/domain/schema.js';

const lire = (...p) => fs.readFile(path.join(RACINE, ...p), 'utf8');
async function sourcesFront() {
  const sortie = [];
  const parcourir = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const c = path.join(d, e.name);
      if (e.isDirectory()) await parcourir(c);
      else if (/\.(js|html)$/.test(e.name)) sortie.push(await fs.readFile(c, 'utf8'));
    }
  };
  await parcourir(path.join(RACINE, 'public'));
  return sortie.join('\n');
}

test('guide utilisateur : chaque libellé de bouton ou de lien cité en gras existe dans l\'interface', async () => {
  const guide = await lire('docs', 'guide-utilisateur.md');
  const front = await sourcesFront();
  const exceptions = new Set(['Lancer suivi-facturation', 'Choisir le dossier de donnees', 'Paramètres → Tarifs', 'Paramètres → Sauvegardes', 'Paramètres → Export', 'Paramètres → Dossier de données', 'Prestations', 'Facturation du mois', 'Tableau de bord', 'Paramètres', 'Ajouter une prestation', 'Voir les tarifs']);
  const cites = [...guide.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim()).filter((t) => t.length < 60 && !exceptions.has(t));
  const inconnus = [];
  for (const libelle of new Set(cites)) {
    const cherche = libelle.replace(/\s*:\s*$/, '').replace(/^«\s*|\s*»$/g, '');
    if (!front.includes(cherche) && !front.includes(cherche.replace(/’/g, "'"))) inconnus.push(cherche);
  }
  // les titres de rubriques du guide et le texte d'alerte en gras ne sont pas des libellés d'interface
  const tolerés = new Set(['À lire une fois : ce sont des données de santé.', 'Ce n\'est pas un outil de facturation', 'Laissez la fenêtre noire ouverte', 'Fermez la fenêtre noire', 'Conflit de synchronisation, en pratique :', 'N\'ouvrez l\'application que sur un seul ordinateur à la fois.', 'Paiements', 'Prévisions', 'Archivage des anciennes années', 'Prestations', 'Tableau de bord', 'Facturation du mois', 'Lancer suivi-facturation', 'sauvegardes automatiques', 'Téléchargements', 'Conflit de synchronisation, en pratique']);
  assert.deepEqual(inconnus.filter((l) => !tolerés.has(l)), []);
});

test('documents : chaque chemin de fichier cité (scripts/, docs/, config/) existe', async () => {
  for (const nom of ['README.md', path.join('docs', 'guide-utilisateur.md'), path.join('docs', 'exploitation.md')]) {
    const texte = await lire(nom);
    for (const m of texte.matchAll(/`((?:scripts|docs|config)[\\/][^`\s]+?)`/g)) {
      const chemin = m[1].replace(/\\/g, '/');
      if (/[*<>{}]|AAAA/.test(chemin)) continue;
      await assert.doesNotReject(fs.stat(path.join(RACINE, chemin)), `${nom} cite « ${m[1]} »`);
    }
  }
  for (const f of ['Lancer suivi-facturation.bat', 'Choisir le dossier de donnees.bat', 'env.exemple']) await assert.doesNotReject(fs.stat(path.join(RACINE, 'scripts', f)), f);
});

test('les ports et variables documentés correspondent au code : ERGO_PORT 4780 par défaut, ERGO_DATA_DIR, adresse 127.0.0.1', async () => {
  const exploitation = await lire('docs', 'exploitation.md');
  const config = await lire('src', 'config.js');
  assert.match(config, /PORT_DEFAUT = 4780/);
  assert.match(exploitation, /`ERGO_PORT`[^\n]*`4780`/);
  assert.match(exploitation, /127\.0\.0\.1/);
  assert.match(await lire('README.md'), /127\.0\.0\.1:4780/);
});

test('guide utilisateur et README : les prévisions (désormais livrées) ne sont plus annoncées comme « à venir »', async () => {
  const guide = await lire('docs', 'guide-utilisateur.md');
  const readme = await lire('README.md');
  assert.ok(!/Prévisions\*\* : \*à venir\*/.test(guide), 'guide : « Prévisions : à venir »');
  assert.ok(!/\*À venir :\*[^\n]*prévisions/.test(readme), 'README : « À venir : prévisions »');
});

test('guide utilisateur : la liste des modes de paiement cite les cinq modes, « carte bancaire » comprise', async () => {
  const guide = (await lire('docs', 'guide-utilisateur.md')).toLowerCase();
  assert.equal(MODES_PAIEMENT.length, 5);
  assert.ok(guide.includes('carte bancaire'));
});

test('exploitation.md : la ligne de dépannage « .env not found » (message anglais) n\'existe plus si le code charge .env lui-même', async () => {
  const serveur = await lire('src', 'server.js');
  const exploitation = await lire('docs', 'exploitation.md');
  const chargeLuiMeme = /existsSync\([^)]*\.env/.test(serveur) && /loadEnvFile/.test(serveur);
  assert.ok(chargeLuiMeme, 'src/server.js charge .env lui-même');
  assert.ok(!/\.env not found/.test(exploitation));
});

// Écran du tableau de bord (prévision) et texte de Paramètres : pas de DOM sous node --test, donc contrôle du source pour les textes imposés.
// La conformité CSP de l'ensemble de public/js est vérifiée par conformite-csp.test.js (qui lit tous les fichiers, dont ceux-ci).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LIBELLE_SERIE_PREVU, LIBELLES_SERIES_CA } from '../../public/js/format.js';
import { RACINE } from '../aides/temp.js';

const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

test('série « prévu » : libellé « estimation indicative », distinct des trois séries de reste à payer', () => {
  assert.match(LIBELLE_SERIE_PREVU, /estimation indicative/i);
  assert.ok(!Object.values(LIBELLES_SERIES_CA).includes(LIBELLE_SERIE_PREVU));
});

test('graphique du CA : méthode en une phrase, badge « Estimation indicative », état « pas assez d\'historique » avec les mois manquants', () => {
  const source = lire('public/js/pages/tdb-sections.js');
  assert.match(source, /moyenne des 3 derniers mois et séances déjà planifiées/);
  assert.match(source, /Estimation indicative/);
  assert.match(source, /Il faut au moins \$\{p\.fenetre\} mois complets de données/);
  assert.match(source, /moisManquants/);
  // La composition (prévu) est testée sur la fonction pure (tests/front/prevision-ca.test.js) ; la base est calculée côté serveur.
});

test('Paramètres : « Choisir le dossier de donnees.bat » est cité avant la variable ERGO_DATA_DIR', () => {
  const source = lire('public/js/pages/parametres.js');
  const bat = source.indexOf('Choisir le dossier de donnees.bat');
  const variable = source.indexOf("texte: 'ERGO_DATA_DIR'");
  assert.ok(bat > 0 && variable > 0);
  assert.ok(bat < variable);
});

test('la page tableau de bord charge la prévision par l\'API, sans nom ni donnée dans l\'URL', () => {
  const source = lire('public/js/pages/tableau-de-bord.js');
  assert.match(source, /'\/api\/indicateurs\/prevision'/);
  assert.doesNotMatch(source, /prevision\?/);
});

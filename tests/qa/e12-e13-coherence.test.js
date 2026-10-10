// Recette QA E12 + E13 : cohérence entre la documentation publique (guide, exploitation, architecture, design system) et le code
// (libellés, codes d'erreur, classes CSS). Les écarts relevés à la recette (guide, design system, architecture) sont corrigés : leurs
// tests sont devenus de vrais contrôles. Aucun document privé n'est lu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RACINE } from '../aides/temp.js';

const lire = (...s) => fs.readFile(path.join(RACINE, ...s), 'utf8');
const [guide, exploitation, architecture, design] = await Promise.all(['guide-utilisateur.md', 'exploitation.md', 'architecture.md', 'design-system.md'].map((f) => lire('docs', f)));
const css = (await Promise.all(['composants.css', 'ecrans.css'].map((f) => lire('public', 'css', f)))).join('\n');
const js = async (...s) => lire('public', 'js', ...s);

test('guide : les libellés de la page Patients cités en gras existent dans l\'interface', async () => {
  const page = (await js('pages', 'patients.js')) + (await js('patients-dialogues.js'));
  for (const libelle of ['Ajouter le patient', 'Renommer', 'Archiver', 'Réactiver', 'Supprimer', 'Homonyme', 'Annuler', 'Utiliser ce patient', 'Créer quand même un homonyme']) {
    assert.ok(guide.includes(`**${libelle}**`) || guide.includes(libelle), `guide : « ${libelle} » absent`);
    assert.ok(page.includes(libelle), `interface : « ${libelle} » absent`);
  }
  assert.match(guide, /Un patient porte déjà ce nom/);
  assert.ok(page.includes('Un patient porte déjà ce nom'));
});

test('guide et exploitation : la sauvegarde de migration porte le libellé affiché dans Paramètres', async () => {
  const format = await js('format.js');
  const m = format.match(/'avant-migration': '([^']+)'/);
  assert.ok(m, 'libellé de la raison avant-migration');
  assert.ok(guide.includes(`« ${m[1]} »`), 'guide');
  assert.ok(exploitation.includes(`« ${m[1]} »`), 'exploitation');
});

test('architecture : chaque code d\'erreur ou d\'avertissement du registre et du paiement est documenté ET existe dans le code', async () => {
  const sources = (await Promise.all(['domain/patients.js', 'domain/prestations.js', 'domain/paiement.js'].map((f) => lire('src', ...f.split('/'))))).join('\n');
  for (const code of ['PATIENT_EXISTANT', 'PATIENT_UTILISE', 'PATIENTS_HOMONYMES', 'PATIENT_REACTIVE', 'PATIENT_RATTACHE', 'PATIENT_ARCHIVE_EN_COURS', 'DEJA_PAYEE', 'MODE_REQUIS']) {
    assert.ok(architecture.includes(code), `architecture : ${code} non documenté`);
    assert.ok(sources.includes(code), `code : ${code} introuvable`);
  }
  for (const route of ['GET /api/patients', 'POST /api/patients', 'PATCH /api/patients/{id}', 'DELETE /api/patients/{id}', 'POST /api/prestations/{id}/payer-totalite']) {
    assert.ok(architecture.includes(`\`${route}\``), `architecture : route ${route}`);
  }
});

test('design system §5.14, §8.10, §8.11 : chaque classe documentée existe dans la feuille de style ET est employée par le JavaScript', async () => {
  const front = [await js('paiement-rapide.js'), await js('choix-mode.js'), await js('combobox-patient.js'), await js('pages', 'patients.js'), await js('patients-dialogues.js')].join('\n');
  const classes = [
    'paiement-rapide', 'paiement-rapide__titre', 'paiement-rapide__declencheur', 'paiement-rapide__modes', 'paiement-rapide__mode',
    'choix-mode', 'choix-mode__liste', 'choix-mode__option', 'choix-mode__entree', 'choix-mode__texte', 'choix-mode__note', 'choix-mode--erreur',
    'combo', 'suggestions', 'suggestion', 'suggestion__nom', 'suggestion__detail', 'suggestion__marque', 'suggestion--archive', 'suggestion--creer', 'suggestions__vide', 'indication-patient',
    'table-patients', 'patient__nom', 'patient__prenom', 'patient__badges', 'patient-meta', 'col-detail-patient', 'badge--homonyme', 'badge--archive', 'badge--actif', 'ligne--archivee', 'patients-existants', 'aide-patients',
  ];
  for (const c of classes) {
    assert.ok(design.includes(c), `design system : .${c} non documenté`);
    assert.ok(css.includes(`.${c}`), `CSS : .${c} absent`);
    assert.ok(front.includes(c), `JavaScript : ${c} jamais employé`);
  }
  for (const attribut of ['data-mode', 'data-recent', 'aria-expanded', 'aria-pressed', 'aria-busy']) {
    assert.ok(design.includes(attribut), `design system : ${attribut}`);
  }
});

// ---- Cohérence entre les documents publics et le code après le registre des patients et le paiement en un clic.

test('AN-D1 : le guide décrit le paiement en un clic (cinq boutons « Payer », mode mis en évidence, annulation) et non plus « Payé en totalité »', () => {
  assert.ok(!/\*\*Payé en totalité\*\*/.test(guide), 'le guide présente encore un bouton « Payé en totalité » qui n\'existe plus');
  assert.ok(!/Quel mode de paiement \?/.test(guide), 'le dialogue « Quel mode de paiement ? » n\'est plus sur ce chemin');
  assert.match(guide, /dernier mode utilisé/i);
});

test('AN-D2 : le design system ne contredit pas sa propre §5.14 (plus de « Payé en totalité » dans les maquettes et descriptions des écrans §8.2 et §8.3)', () => {
  const entre = design.slice(design.indexOf('### 8.2'), design.indexOf('### 8.4'));
  assert.ok(entre.length > 1000, 'sections 8.2 et 8.3 trouvées');
  assert.ok(!/\[Payé en totalité\]|\*\*Payé en totalité\*\*/.test(entre), 'les écrans Facturation du mois et Prestations décrivent encore le bouton « Payé en totalité »');
});

test('AN-D3 : l\'architecture (§11) décrit les modules du paiement en un clic (paiement-rapide.js, choix-mode.js, paiement-libelles.js)', () => {
  for (const m of ['paiement-rapide.js', 'choix-mode.js', 'paiement-libelles.js']) assert.ok(architecture.includes(m), `architecture : ${m} absent`);
});

test('AN-D4 : le design system (§8.11) et le message d\'archivage du code disent la même chose (nombres de prestations, pas un montant)', () => {
  assert.ok(!/38,00 € restent à payer/.test(design), 'le design system promet un montant, le serveur renvoie des nombres de prestations');
});

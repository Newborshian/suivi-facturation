// Recherche de patients pendant la frappe (module pur public/js/recherche-patients.js) : accents, casse, espaces, ordre, limite, indications.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITE_SUGGESTIONS,
  annonceSuggestions,
  candidatsAffiches,
  clePatient,
  estNouveauPatient,
  indicationPatient,
  libelleSuggestion,
  optionCreer,
  patientsDeMemeCle,
  rechercherPatients,
} from '../../public/js/recherche-patients.js';
import { clePatient as clePatientServeur } from '../../src/domain/patients.js';

let n = 0;
const p = (nom, prenom, extra = {}) => ({ id: `id-${++n}`, nom, prenom, actif: true, nombrePrestations: 1, dernierePrestation: '2026-10-01', homonyme: false, supprimable: false, ...extra });
const noms = (r) => r.patients.map((x) => `${x.nom} ${x.prenom}`);

const REGISTRE = [
  p('Lapin', 'Pierre'),
  p('Hérisson', 'Sonic'),
  p('Cygne', 'Léa'),
  p('Castor', 'Léandre'),
  p('Ours', 'Baloo', { actif: false }),
  p('Écureuil', 'Noé'),
];

test('accents, casse et espaces de bord ignorés ; nom, prénom, « nom prénom » et « prénom nom »', () => {
  for (const saisie of ['herisson', 'HÉRISSON', '  hérisson  ', 'sonic', 'Sonic Hérisson', 'herisson sonic']) {
    assert.deepEqual(noms(rechercherPatients(REGISTRE, { nom: saisie })), ['Hérisson Sonic'], saisie);
  }
  assert.deepEqual(noms(rechercherPatients(REGISTRE, { nom: 'ecureuil' })), ['Écureuil Noé']);
  assert.deepEqual(noms(rechercherPatients(REGISTRE, { nom: 'lea' })), ['Castor Léandre', 'Cygne Léa']); // « lea » : deux débuts de prénom, départagés par le nom
});

test('deux champs remplis : les deux doivent correspondre', () => {
  assert.deepEqual(noms(rechercherPatients(REGISTRE, { nom: 'lap', prenom: 'pie' })), ['Lapin Pierre']);
  assert.deepEqual(noms(rechercherPatients(REGISTRE, { nom: 'lap', prenom: 'sonic' })), []);
  assert.deepEqual(noms(rechercherPatients(REGISTRE, { prenom: 'pie' })), ['Lapin Pierre']);
});

test('repli : si la combinaison Nom + Prénom ne donne rien, le champ en cours de frappe cherche seul (correction d\'un nom déjà rempli)', () => {
  assert.deepEqual(noms(rechercherPatients(REGISTRE, { nom: 'ours', prenom: 'Goupil' })), []);
  assert.deepEqual(noms(rechercherPatients(REGISTRE, { nom: 'ours', prenom: 'Goupil' }, { repli: 'nom' })), ['Ours Baloo']);
  assert.deepEqual(noms(rechercherPatients(REGISTRE, { nom: 'ours', prenom: 'Goupil' }, { repli: 'prenom' })), []);
  assert.deepEqual(noms(rechercherPatients(REGISTRE, { nom: 'lap', prenom: 'pie' }, { repli: 'nom' })), ['Lapin Pierre']); // la combinaison prime
});

test('ordre : actifs avant archivés ; début du nom, puis début du prénom, puis contenu ; puis nom et prénom', () => {
  const reg = [p('Dupont', 'Marc'), p('Martin', 'Paul'), p('Durand', 'Mara'), p('Mar', 'Zoé', { actif: false }), p('Lemaros', 'Jean'), p('Marchand', 'Éric')];
  assert.deepEqual(noms(rechercherPatients(reg, { nom: 'mar' })), ['Marchand Éric', 'Martin Paul', 'Dupont Marc', 'Durand Mara', 'Lemaros Jean', 'Mar Zoé']);
});

test("limite d'affichage : 8 par défaut, total conservé ; limite personnalisable", () => {
  const reg = Array.from({ length: 12 }, (_, i) => p(`Nom${String(i).padStart(2, '0')}`, 'Test'));
  const r = rechercherPatients(reg, { nom: 'nom' });
  assert.equal(LIMITE_SUGGESTIONS, 8);
  assert.equal(r.patients.length, 8);
  assert.equal(r.total, 12);
  assert.equal(rechercherPatients(reg, { nom: 'nom' }, { limite: 3 }).patients.length, 3);
});

test('rien de tapé : tout le registre, actifs d\'abord ; registre absent : liste vide', () => {
  const r = rechercherPatients(REGISTRE, {});
  assert.equal(r.total, 6);
  assert.equal(r.patients.at(-1).nom, 'Ours');
  assert.deepEqual(rechercherPatients(null, { nom: 'x' }), { patients: [], total: 0 });
});

test('libellé : homonymes avec la date de dernière prestation, archivés avec la mention « archivé »', () => {
  assert.deepEqual(libelleSuggestion(p('Lapin', 'Pierre')), { nom: 'Lapin Pierre', detail: '', marque: '' });
  assert.deepEqual(libelleSuggestion(p('Renard', 'Basile', { homonyme: true, dernierePrestation: '2026-10-17' })), { nom: 'Renard Basile', detail: 'dernière prestation le 17/10/2026', marque: '' });
  assert.equal(libelleSuggestion(p('Renard', 'Basile', { homonyme: true, dernierePrestation: null })).detail, 'aucune prestation');
  assert.equal(libelleSuggestion(p('Ours', 'Baloo', { actif: false })).marque, 'archivé');
});

test('clé de comparaison : la même que celle du serveur (casse, espaces, NFC ; sensible aux accents)', () => {
  const cas = [['Lapin', 'Pierre'], ['  LAPIN ', 'pierre'], ['Cygne', 'Léa'], ['Cygne', 'Lea'], ['Cygne', 'Léa'], ['de  la   Fontaine', 'Jean'], ['', ''], ['Œuf', 'ÉLODIE']];
  for (const [nom, prenom] of cas) assert.equal(clePatient(nom, prenom), clePatientServeur(nom, prenom), JSON.stringify([nom, prenom]));
  assert.notEqual(clePatient('Cygne', 'Léa'), clePatient('Cygne', 'Lea'));
});

test('nouveau patient : seulement si aucun patient n\'a exactement ce nom et ce prénom', () => {
  assert.equal(estNouveauPatient(REGISTRE, 'LAPIN ', ' pierre'), false);
  assert.equal(estNouveauPatient(REGISTRE, 'Cygne', 'Lea'), true); // sans accent : le serveur créerait un autre patient
  assert.equal(estNouveauPatient(REGISTRE, 'Lapin', 'Paul'), true);
  assert.equal(patientsDeMemeCle([p('Renard', 'Basile'), p('renard', 'basile')], 'Renard', 'Basile').length, 2);
});

test('option « Créer… » : texte complet, ou texte tapé suivi de « … » ; absente si rien tapé ou si le patient existe', () => {
  assert.equal(optionCreer(REGISTRE, '  Lapin ', 'Paul').texte, 'Créer le patient « Lapin Paul »');
  assert.equal(optionCreer(REGISTRE, 'Lap', '').texte, 'Créer le patient « Lap … »');
  assert.equal(optionCreer(REGISTRE, '', 'Pie').texte, 'Créer le patient « … Pie »');
  assert.equal(optionCreer(REGISTRE, 'lapin', 'PIERRE'), null);
  assert.equal(optionCreer(REGISTRE, '', ' '), null);
});

test('indication : choisi, rattaché, nouveau, archivé réactivé, homonymes sans indication, un seul champ', () => {
  const ours = REGISTRE[4];
  assert.deepEqual(indicationPatient(REGISTRE, {}, null), { type: null, texte: '' });
  assert.equal(indicationPatient(REGISTRE, { nom: 'Lapin', prenom: 'Pierre' }, REGISTRE[0]).type, 'enregistre');
  assert.equal(indicationPatient(REGISTRE, { nom: 'Ours', prenom: 'Baloo' }, ours).type, 'reactive');
  assert.equal(indicationPatient(REGISTRE, { nom: 'lapin', prenom: 'pierre' }).type, 'enregistre');
  assert.equal(indicationPatient(REGISTRE, { nom: 'ours', prenom: 'baloo' }).type, 'reactive');
  assert.deepEqual(indicationPatient(REGISTRE, { nom: 'Lapin', prenom: 'Paul' }), { type: 'nouveau', texte: 'Nouveau patient' });
  assert.equal(indicationPatient([p('Renard', 'Basile'), p('Renard', 'Basile')], { nom: 'Renard', prenom: 'Basile' }).type, null);
  assert.equal(indicationPatient(REGISTRE, { nom: 'Lap', prenom: '' }).type, null);
  assert.equal(indicationPatient(REGISTRE, { nom: 'Lap', prenom: '' }, null, true).type, 'nouveau');
  assert.match(indicationPatient(REGISTRE, { nom: 'ours', prenom: 'baloo' }).texte, /réactivé/);
});

test('annonce pour lecteur d\'écran : nombre, création possible, liste tronquée', () => {
  assert.equal(annonceSuggestions({ nombre: 3 }), '3 patients proposés');
  assert.equal(annonceSuggestions({ nombre: 1 }), '1 patient proposé');
  assert.equal(annonceSuggestions({ nombre: 0 }), 'Aucun patient enregistré ne correspond');
  assert.equal(annonceSuggestions({ nombre: 2, creer: true }), '2 patients proposés ; vous pouvez aussi créer un nouveau patient');
  assert.equal(annonceSuggestions({ nombre: 0, creer: true }), 'Aucun patient enregistré ne correspond ; vous pouvez créer un nouveau patient');
  assert.equal(annonceSuggestions({ nombre: 8, total: 12 }), '8 patients proposés (8 au plus : précisez la recherche)');
});

test('candidats d\'un homonyme : noms retrouvés dans le registre, candidat inconnu conservé sans nom', () => {
  const a = p('Renard', 'Basile', { homonyme: true, nombrePrestations: 2, dernierePrestation: '2026-10-17' });
  const r = candidatsAffiches([{ id: a.id, dernierePrestation: '2026-10-17' }, { id: 'absent', dernierePrestation: null }], [a]);
  assert.deepEqual(r[0], { id: a.id, nom: 'Renard', prenom: 'Basile', actif: true, homonyme: true, nombrePrestations: 2, dernierePrestation: '2026-10-17' });
  assert.deepEqual(r[1], { id: 'absent', nom: '', prenom: '', actif: true, homonyme: false, nombrePrestations: null, dernierePrestation: null });
  assert.deepEqual(candidatsAffiches(undefined, []), []);
});

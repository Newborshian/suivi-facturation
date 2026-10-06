// Recette QA : export CSV (formules = + - @, guillemets, retours à la ligne, accents, montants à la virgule) et export JSON.
// Le CSV est relu par un analyseur RFC 4180 indépendant (séparateur « ; ») et comparé champ par champ aux données d'origine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, etatAvec, ligne, serveurAvecFichier, texteJson, prestationsAleatoires } from './aides-qa.js';
import { BOM, cellule, csvPrestations, csvVersements } from '../../src/domain/csv.js';
import { etatPaiement } from '../../src/domain/paiement.js';

/** Analyseur CSV RFC 4180 (séparateur « ; », guillemets doublés, CRLF ou LF dans les champs entre guillemets). */
function analyserCsv(texte) {
  assert.ok(texte.startsWith(BOM), 'BOM UTF-8 présent (Excel)');
  const s = texte.slice(1);
  const lignes = [];
  let champ = '';
  let ligneCourante = [];
  let entre = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (entre) {
      if (c === '"') {
        if (s[i + 1] === '"') { champ += '"'; i++; } else entre = false;
      } else champ += c;
    } else if (c === '"' && champ === '') entre = true;
    else if (c === ';') { ligneCourante.push(champ); champ = ''; }
    else if (c === '\r' && s[i + 1] === '\n') { ligneCourante.push(champ); lignes.push(ligneCourante); ligneCourante = []; champ = ''; i++; }
    else champ += c;
  }
  assert.equal(entre, false, 'aucun guillemet resté ouvert');
  assert.equal(champ, '', 'le fichier se termine par une fin de ligne');
  assert.equal(ligneCourante.length, 0);
  return lignes;
}

const PIEGES = [
  '=1+1', '+33 6 00 00 00 00', '-2+3', '@SUM(A1)', '=cmd|\' /C calc\'!A0', '\tTabulation', '\rRetour', '=HYPERLINK("http://x","clic")',
  'Dupont;Martin', 'Dupont "Dédé" Martin', 'a,b', 'ligne 1\nligne 2', 'ligne 1\r\nligne 2', '"', '""', ';', '"=1+1"', '  =espace avant', '=', "'=déjà apostrophe",
  'Éloïse Œuf à Noël', '李 🐰', 'Ünal',
];

test('cellule : toute valeur piège est relue exactement (sauf l\'apostrophe anti-formule) par un analyseur CSV indépendant', () => {
  for (const valeur of PIEGES) {
    const [[relu]] = analyserCsv(`${BOM}${cellule(valeur)}\r\n`);
    const dangereux = /^[=+\-@\t\r]/.test(valeur);
    assert.equal(relu, dangereux ? `'${valeur}` : valeur, JSON.stringify(valeur));
    assert.ok(!/^[=+\-@\t\r]/.test(relu), `une cellule relue ne commence jamais par un caractère de formule : ${JSON.stringify(valeur)}`);
  }
});

test('export CSV des prestations : données pièges (formules, guillemets, retours à la ligne, accents) relues champ par champ, montants à la virgule, dates JJ/MM/AAAA, CRLF', async () => {
  const lignes = PIEGES.map((p, i) => ligne(i, {
    date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
    patient: { id: `p${i}`, nom: p, prenom: i % 2 ? p : 'Prénom' },
    motif: p,
    montantCentimes: 123_456 + i,
    statut: i % 2 ? 'facture' : 'a_facturer',
    factureLe: i % 2 ? '2026-09-30' : null,
    versements: i % 3 === 0 ? [{ id: `v${i}`, montantCentimes: 100_000 + i, date: '2026-10-01', mode: ['carte', 'cheque', 'especes', 'virement', 'autre'][i % 5] }] : [],
  }));
  const s = await serveurAvecFichier(texteJson(etatAvec(lignes, { revision: 3 })));
  const a = client(s);
  try {
    const r = await a.get('/api/export?format=csv&contenu=prestations');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/csv; charset=utf-8/);
    assert.match(r.headers['content-disposition'], /^attachment; filename="suivi-facturation-prestations-2026-10-02\.csv"$/);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.texte));
    assert.ok(r.texte.includes('\r\n'), 'fins de ligne CRLF');
    const table = analyserCsv(r.texte);
    assert.equal(table.length, lignes.length + 1);
    assert.deepEqual(table[0], ['id', 'date', 'nom', 'prenom', 'prestation', 'categorie', 'motif', 'montant', 'statut', 'facture_le', 'verse', 'reste', 'trop_percu', 'etat', 'nb_versements']);
    const parId = new Map(table.slice(1).map((l) => [l[0], l]));
    for (const l of lignes) {
      const c = parId.get(l.id);
      assert.ok(c, l.id);
      const protege = (v) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
      const e = etatPaiement(l);
      const euros = (centimes) => `${Math.trunc(centimes / 100)},${String(centimes % 100).padStart(2, '0')}`;
      assert.equal(c[2], protege(l.patient.nom));
      assert.equal(c[3], protege(l.patient.prenom));
      assert.equal(c[6], protege(l.motif));
      assert.equal(c[7], euros(l.montantCentimes));
      assert.match(c[7], /^\d+,\d{2}$/, 'jamais de séparateur de milliers ni de symbole monétaire');
      assert.equal(c[10], euros(e.verseCentimes));
      assert.equal(c[11], euros(e.resteCentimes));
      assert.equal(c[12], euros(e.tropPercuCentimes));
      assert.equal(c[14], String(l.versements.length));
      assert.equal(c[1], l.date.split('-').reverse().join('/'));
      assert.equal(c[9], l.factureLe ? l.factureLe.split('-').reverse().join('/') : '');
      for (const k of [2, 3, 6]) assert.ok(!/^[=+\-@\t\r]/.test(c[k]), `colonne ${k} sans préfixe de formule : ${JSON.stringify(c[k])}`);
    }
    const v = await a.get('/api/export?format=csv&contenu=versements');
    const tv = analyserCsv(v.texte);
    assert.deepEqual(tv[0], ['prestation_id', 'date_prestation', 'nom', 'prenom', 'date_versement', 'mode', 'montant']);
    assert.equal(tv.length - 1, lignes.filter((l) => l.versements.length > 0).length);
    for (const ligneV of tv.slice(1)) {
      assert.ok(['Carte bancaire', 'Chèque', 'Espèces', 'Virement', 'Autre'].includes(ligneV[5]), `mode en toutes lettres : ${ligneV[5]}`);
      assert.match(ligneV[6], /^\d+,\d{2}$/);
    }
  } finally {
    await s.arreter();
  }
});

test('export CSV : 2 000 lignes aléatoires, autant de lignes que de prestations, somme des montants CSV = somme des montants du fichier (au centime)', async () => {
  const lignes = prestationsAleatoires(2000, { graine: 77 });
  const csv = csvPrestations(lignes);
  const table = analyserCsv(csv);
  assert.equal(table.length, 2001);
  const somme = table.slice(1).reduce((s, c) => { const [e, ct] = c[7].split(','); return s + Number(e) * 100 + Number(ct); }, 0);
  assert.equal(somme, lignes.reduce((s, l) => s + l.montantCentimes, 0));
  const nbV = lignes.reduce((s, l) => s + l.versements.length, 0);
  assert.equal(analyserCsv(csvVersements(lignes)).length - 1, nbV);
  assert.ok(new Set(table.slice(1).map((c) => c[0])).size === 2000, 'identifiants uniques');
});

test('export JSON : fichier daté, objet « suivi-facturation-export » contenant le fichier actif complet ; en-têtes de téléchargement', async () => {
  const lignes = [ligne(1), ligne(2, { versements: [{ id: 'v1', montantCentimes: 500, date: '2026-09-20', mode: 'carte' }] })];
  const s = await serveurAvecFichier(texteJson(etatAvec(lignes, { revision: 4 })));
  const a = client(s);
  try {
    const r = await a.get('/api/export?format=json');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-disposition'], /filename="suivi-facturation-export-2026-10-02\.json"/);
    assert.equal(r.json.format, 'suivi-facturation-export');
    assert.equal(r.json.actif.prestations.length, 2);
    assert.deepEqual(r.json.actif.prestations[1].versements[0], { id: 'v1', montantCentimes: 500, date: '2026-09-20', mode: 'carte' });
    assert.deepEqual(Object.keys(r.json.actif.prestations[0]).filter((k) => ['etat', 'resteCentimes', 'aVenir'].includes(k)), [], 'aucun état calculé dans l\'export brut');
    const head = await s.requete({ methode: 'HEAD', chemin: '/api/export?format=csv' });
    assert.equal(head.status, 200);
    assert.equal(head.texte, '');
  } finally {
    await s.arreter();
  }
});

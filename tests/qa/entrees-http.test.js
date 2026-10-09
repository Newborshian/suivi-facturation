// Recette QA : validation des entrées par l'API (types, tailles, caractères spéciaux, tentative XSS), paramètres d'URL invalides,
// corps trop gros, et contrôles Host / Origin / Sec-Fetch-Site sur TOUTES les routes en écriture (anti DNS rebinding / CSRF).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, lireDisque, octetsDisque, saisie } from './aides-qa.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';

async function avec(fn, options) {
  const s = await demarrerServeurTest(options);
  try {
    await fn(s, client(s));
  } finally {
    await s.arreter();
  }
}
const nbLignes = async (a) => (await a.get('/api/prestations')).json.lignes.length;

test('nom, prénom, motif : limites 100 / 100 / 200 caractères (100 accepté, 101 refusé), champ nommé dans l\'erreur 422', () =>
  avec(async (s, a) => {
    const ok = await a.post('/api/prestations', saisie({ patient: { nom: 'N'.repeat(100), prenom: 'P'.repeat(100) }, motif: 'm'.repeat(200) }));
    assert.equal(ok.status, 201);
    for (const [champ, corps] of [
      ['nom', saisie({ patient: { nom: 'N'.repeat(101), prenom: 'Pierre' } })],
      ['prenom', saisie({ patient: { nom: 'Lapin', prenom: 'P'.repeat(101) } })],
      ['motif', saisie({ motif: 'm'.repeat(201) })],
    ]) {
      const r = await a.post('/api/prestations', corps);
      assert.equal(r.status, 422, champ);
      assert.ok(champ in r.json.erreur.champs, champ);
    }
    assert.equal(await nbLignes(a), 1, 'les refus n\'écrivent rien');
  }));

test('champs obligatoires vides, espaces seuls, null, nombres, tableaux et objets à la place du texte : 422 ou 400, jamais 500, rien d\'enregistré', () =>
  avec(async (s, a) => {
    const mauvais = [
      saisie({ patient: { nom: '', prenom: 'Pierre' } }),
      saisie({ patient: { nom: '   ', prenom: 'Pierre' } }),
      saisie({ patient: { nom: null, prenom: 'Pierre' } }),
      saisie({ patient: { nom: 123, prenom: 'Pierre' } }),
      saisie({ patient: { nom: ['Lapin'], prenom: 'Pierre' } }),
      saisie({ patient: { nom: { a: 1 }, prenom: 'Pierre' } }),
      saisie({ patient: 'Lapin Pierre' }),
      saisie({ patient: ['Lapin', 'Pierre'] }),
      saisie({ patient: null }),
      saisie({ date: '' }),
      saisie({ date: '2026-02-30' }),
      saisie({ date: '02/10/2026' }),
      saisie({ date: 20261002 }),
      saisie({ prestationId: '' }),
      saisie({ prestationId: 'inexistante' }),
      saisie({ prestationId: { $ne: null } }),
      saisie({ prestationId: ['seance-45'] }),
      saisie({ montantCentimes: '4500' }),
      saisie({ montantCentimes: -100 }),
      saisie({ montantCentimes: 1.5 }),
      saisie({ montantCentimes: 1e21 }),
      saisie({ motif: 42 }),
      saisie({ motif: { x: 1 } }),
      saisie({ champInconnu: 1 }),
      { patient: { nom: 'Lapin', prenom: 'Pierre', age: 8 }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500 },
    ];
    for (const corps of mauvais) {
      const r = await a.post('/api/prestations', corps);
      assert.ok(r.status === 422 || r.status === 400, `${r.status} pour ${JSON.stringify(corps).slice(0, 120)}`);
      assert.ok(r.json.erreur.code, 'format d\'erreur unique');
    }
    assert.equal(await nbLignes(a), 0);
  }));

test('caractères de contrôle refusés (NUL, retour à la ligne, tabulation, DEL, C1) ; accents, apostrophes, tirets, emoji et caractères CJK acceptés tels quels', () =>
  avec(async (s, a) => {
    for (const c of ['\u0000', '\n', '\r', '\t', '\u007f', '\u0085', '\u001b']) {
      const r = await a.post('/api/prestations', saisie({ patient: { nom: `Du${c}pont`, prenom: 'Pierre' } }));
      assert.equal(r.status, 422, JSON.stringify(c));
      assert.equal((await a.post('/api/prestations', saisie({ motif: `a${c}b` }))).status, 422, `motif ${JSON.stringify(c)}`);
    }
    for (const nom of ["O'Brien", 'Jean-Pierre', 'Éloïse', 'D’Artagnan', 'Nguyễn', '李', 'Ünal', 'Zoë 🐰', 'Œuf']) {
      const r = await a.post('/api/prestations', saisie({ patient: { nom, prenom: 'Test' }, date: `2026-09-${10 + (nom.length % 10)}` }));
      assert.equal(r.status, 201, nom);
      assert.equal(r.json.donnees.patient.nom, nom.normalize('NFC'), 'conservé tel quel (NFC)');
    }
  }));

test('tentative XSS dans nom, prénom et motif : stocké comme du texte, renvoyé en JSON (nosniff, CSP stricte), jamais interprété ni transformé', () =>
  avec(async (s, a) => {
    const charges = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'; DROP TABLE prestations;--", '<svg/onload=alert(1)>', '{{constructor.constructor("alert(1)")()}}', '${7*7}', 'javascript:alert(1)', '</title><script>1</script>'];
    for (const [i, x] of charges.entries()) {
      const r = await a.post('/api/prestations', saisie({ patient: { nom: x, prenom: x }, motif: x, date: `2026-09-${String(i + 1).padStart(2, '0')}` }));
      assert.equal(r.status, 201, x);
      assert.equal(r.json.donnees.patient.nom, x);
      assert.equal(r.json.donnees.motif, x);
    }
    const liste = await a.get('/api/prestations');
    assert.match(liste.headers['content-type'], /^application\/json/);
    assert.equal(liste.headers['x-content-type-options'], 'nosniff');
    assert.match(liste.headers['content-security-policy'], /script-src 'self'/);
    assert.ok(!liste.headers['content-security-policy'].includes('unsafe-inline'));
    assert.equal(liste.json.lignes.length, charges.length);
    // la page HTML servie ne contient aucune de ces chaînes (aucune donnée n'est injectée côté serveur)
    for (const page of ['/', '/prestations.html', '/patients.html', '/tableau-de-bord.html', '/parametres.html']) {
      const html = (await s.requete({ chemin: page })).texte;
      assert.ok(!html.includes('alert(1)'), page);
    }
    // l'export CSV conserve le texte (apostrophe anti-formule seulement pour = + - @)
    const csv = (await a.get('/api/export?format=csv&contenu=prestations')).texte;
    assert.ok(csv.includes('<script>alert(1)</script>'));
  }));

test('prototype pollution et noms réservés : « __proto__ », « constructor », « prototype » comme clés refusées ; comme valeurs de texte acceptées', () =>
  avec(async (s, a) => {
    for (const corps of [
      '{"__proto__":{"polluted":true},"patient":{"nom":"A","prenom":"B"},"date":"2026-10-02","prestationId":"seance-45","montantCentimes":1}',
      '{"constructor":{"prototype":{"x":1}},"patient":{"nom":"A","prenom":"B"},"date":"2026-10-02","prestationId":"seance-45","montantCentimes":1}',
      '{"patient":{"__proto__":{"nom":"x"},"nom":"A","prenom":"B"},"date":"2026-10-02","prestationId":"seance-45","montantCentimes":1}',
    ]) {
      const r = await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json' }, corps });
      assert.equal(r.status, 400, corps.slice(0, 60));
    }
    assert.equal({}.polluted, undefined);
    const ok = await a.post('/api/prestations', saisie({ patient: { nom: '__proto__', prenom: 'constructor' } }));
    assert.equal(ok.status, 201);
    assert.equal((await a.get('/api/patients')).json.patients[0].nom, '__proto__');
    assert.equal(await nbLignes(a), 1);
  }));

test('corps JSON invalides : vide, tronqué, tableau, nombre, null, profondeur excessive, BOM, texte brut : 400/415, jamais 500', () =>
  avec(async (s, a) => {
    const envoyer = (corps, type = 'application/json') => s.requete({ methode: 'POST', chemin: '/api/prestations', headers: { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': type }, corps });
    for (const corps of ['', '{', '{"patient":', '[]', '123', 'null', '"texte"', 'true', '{"a":1}}', "{'a':1}", `${'['.repeat(100000)}`, `{"a":${'['.repeat(50000)}${']'.repeat(50000)}}`]) {
      const r = await envoyer(corps);
      assert.ok([400, 422].includes(r.status), `${r.status} pour ${corps.slice(0, 30)}`);
    }
    const avecBom = await envoyer(`﻿${JSON.stringify(saisie())}`);
    assert.equal(avecBom.status, 400, 'un BOM n\'est pas du JSON valide : refusé proprement');
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', '', 'application/xml']) {
      const r = await envoyer(JSON.stringify(saisie()), type);
      assert.equal(r.status, 415, `type « ${type} »`);
    }
    assert.equal((await envoyer(JSON.stringify(saisie()), 'application/json; charset=utf-8')).status, 201, 'charset accepté');
    assert.equal(await nbLignes(a), 1);
  }));

test('corps trop gros : 1 Mo exact accepté côté taille (refus de validation seulement), 1 Mo + 1 refusé en 413, par Content-Length et en flux', () =>
  avec(async (s, a) => {
    const entete = { Origin: `http://127.0.0.1:${s.port}`, 'Content-Type': 'application/json' };
    const gros = JSON.stringify(saisie({ motif: 'x'.repeat(1024 * 1024 + 10) }));
    const parLongueur = await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: { ...entete, 'Content-Length': String(Buffer.byteLength(gros)) }, corps: gros, reprises: 5 });
    assert.equal(parLongueur.status, 413);
    const enFlux = await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: entete, corps: gros, reprises: 5 });
    assert.equal(enFlux.status, 413);
    // juste sous la limite : le corps est lu ; il est refusé par la validation (motif > 200), pas par la taille
    const sous = JSON.stringify(saisie({ motif: 'x'.repeat(1024 * 1024 - 400) }));
    assert.ok(Buffer.byteLength(sous) < 1024 * 1024);
    const r = await s.requete({ methode: 'POST', chemin: '/api/prestations', headers: entete, corps: sous, reprises: 5 });
    assert.equal(r.status, 422);
    assert.equal(await nbLignes(a), 0);
  }));

test('paramètres d\'URL invalides : 400 sur tous les endpoints de lecture (mois, vue, dates, statut, état, valeurs répétées), sans écho de la valeur', () =>
  avec(async (s, a) => {
    await a.post('/api/prestations', saisie());
    const mauvais = [
      '/api/prestations?mois=2026-13', '/api/prestations?mois=26-10', '/api/prestations?mois=', '/api/prestations?mois=2026-10-01', '/api/prestations?de=2026-02-30',
      '/api/prestations?statut=pay%C3%A9', '/api/prestations?etat=non_paye,inconnu', '/api/prestations?aVenir=oui', '/api/prestations?anciennete=15', '/api/prestations?patientId=', `/api/prestations?patientId=${'x'.repeat(101)}`,
      '/api/prestations?nom=Lapin', '/api/prestations?patient=Lapin',
      '/api/recap?mois=2026-00', '/api/recap?vue=tresorerie', '/api/recap?nom=Lapin', '/api/recap?mois=1999-12', '/api/recap?mois=2101-01',
      '/api/indicateurs/ca-mensuel?de=2026-10&a=2026-09', '/api/indicateurs/ca-mensuel?de=2020-01&a=2026-12', '/api/indicateurs/ca-mensuel?vue=x', '/api/indicateurs/seances?granularite=jour', '/api/indicateurs/repartition?de=abc',
      '/api/indicateurs/impayes?patient=Lapin', '/api/indicateurs/prevision?x=1', '/api/indicateurs/synthese?de=nimporte', '/api/export?format=xml', '/api/export?format=json&contenu=prestations', '/api/export?format=csv&contenu=tout', '/api/export?nom=Lapin',
    ];
    for (const url of mauvais) {
      const r = await a.get(url);
      assert.equal(r.status, 400, url);
      assert.equal(r.json.erreur.code, 'REQUETE_INVALIDE', url);
      assert.ok(!JSON.stringify(r.json).includes('Lapin'), `aucun écho de la valeur : ${url}`);
    }
    assert.equal(s.journal.filter((l) => l.includes('Lapin')).length, 0, 'aucun nom dans le journal');
  }));

test('paramètres d\'URL répétés (?mois=A&mois=B) : la première valeur est utilisée, aucune erreur 500 (comportement noté)', () =>
  avec(async (s, a) => {
    await a.post('/api/prestations', saisie({ date: '2026-10-02' }));
    const r = await a.get('/api/recap?mois=2026-10&mois=2026-11');
    assert.equal(r.status, 200);
    assert.equal(r.json.mois, '2026-10');
    assert.equal((await a.get('/api/prestations?mois=2026-10&mois=abc')).status, 200);
  }));

test('identifiants de ressource hostiles dans le chemin : 404 propre (jamais 500, jamais de lecture de fichier)', () =>
  avec(async (s, a) => {
    for (const id of ['inconnu', '%00', '..%2f..%2fetc', '%2e%2e', 'a%2Fb', '%E0%A4%A', 'x'.repeat(5000), '__proto__', 'constructor', '%3Cscript%3E']) {
      const r = await a.get(`/api/prestations/${id}`);
      assert.ok([404, 400].includes(r.status), `${r.status} pour ${id.slice(0, 30)}`);
      assert.ok(r.json?.erreur?.code, id.slice(0, 30));
      const d = await a.del(`/api/prestations/${id}`);
      assert.ok([404, 400].includes(d.status), `DELETE ${d.status} pour ${id.slice(0, 30)}`);
    }
    assert.equal((await a.post('/api/sauvegardes/..%2fsuivi-facturation.json/restaurer', { confirmer: true })).status, 404);
    assert.equal((await a.post('/api/sauvegardes/suivi-facturation.json/restaurer', { confirmer: true })).status, 404);
  }));

// ------------------------------------------------------------------ Host / Origin / Sec-Fetch-Site sur toutes les routes d'écriture

const ROUTES_ECRITURE = [
  ['POST', '/api/prestations', saisie()],
  ['POST', '/api/prestations/statut', { ids: ['x'], statut: 'facture' }],
  ['PATCH', '/api/prestations/x', { motif: 'a', modifieLe: 'x' }],
  ['DELETE', '/api/prestations/x'],
  ['POST', '/api/prestations/x/versements', { montantCentimes: 1, date: '2026-10-02', mode: 'carte' }],
  ['PATCH', '/api/prestations/x/versements/y', { montantCentimes: 2 }],
  ['DELETE', '/api/prestations/x/versements/y'],
  ['POST', '/api/prestations/x/payer-totalite', {}],
  ['POST', '/api/annulations/x'],
  ['POST', '/api/catalogue', { libelle: 'Pirate', tarifCentimes: 1, categorie: 'autre' }],
  ['PATCH', '/api/catalogue/seance-45', { tarifCentimes: 1 }],
  ['DELETE', '/api/catalogue/seance-45'],
  ['PATCH', '/api/parametres', { sauvegardesConservees: 7 }],
  ['POST', '/api/sauvegardes'],
  ['POST', '/api/sauvegardes/sauvegarde-2026-10-02_09h14m03s_manuelle.json/restaurer', { confirmer: true }],
  ['POST', '/api/fichier-vide', { confirmer: true }],
];

test('routes d\'écriture : Host étranger, Origin absente / étrangère / « null », Sec-Fetch-Site cross-site : toujours 403, et le fichier de données reste identique octet pour octet', () =>
  avec(async (s, a) => {
    await a.post('/api/prestations', saisie());
    const avant = await octetsDisque(s.dossier);
    const origineOk = `http://127.0.0.1:${s.port}`;
    const variantes = [
      { nom: 'Host étranger (DNS rebinding)', hote: `evil.example:${s.port}`, headers: { Origin: `http://evil.example:${s.port}` } },
      { nom: 'Host étranger avec Origin locale', hote: `evil.example:${s.port}`, headers: { Origin: origineOk } },
      { nom: 'Origin absente', headers: {} },
      { nom: 'Origin étrangère', headers: { Origin: 'https://evil.example' } },
      { nom: 'Origin « null » (iframe sandbox, fichier local)', headers: { Origin: 'null' } },
      { nom: 'Origin localhost sur un autre port', headers: { Origin: `http://localhost:${s.port + 1}` } },
      { nom: 'Origin https locale', headers: { Origin: `https://127.0.0.1:${s.port}` } },
      { nom: 'Sec-Fetch-Site cross-site', headers: { Origin: origineOk, 'Sec-Fetch-Site': 'cross-site' } },
      { nom: 'Sec-Fetch-Site same-site', headers: { Origin: origineOk, 'Sec-Fetch-Site': 'same-site' } },
    ];
    for (const [methode, chemin, corps] of ROUTES_ECRITURE) {
      for (const v of variantes) {
        const r = await s.requete({
          methode,
          chemin,
          hote: v.hote,
          headers: { ...v.headers, ...(corps !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          corps: corps !== undefined ? JSON.stringify(corps) : undefined,
        });
        assert.equal(r.status, 403, `${methode} ${chemin} — ${v.nom}`);
        assert.ok(['HOTE_REFUSE', 'ORIGINE_REFUSEE'].includes(r.json?.erreur?.code), `${methode} ${chemin} — ${v.nom}`);
      }
    }
    assert.ok((await octetsDisque(s.dossier)).equals(avant), 'aucune écriture n\'a eu lieu');
    assert.deepEqual((await lireDisque(s.dossier)).catalogue.map((c) => c.libelle).includes('Pirate'), false);
    // lecture : Host étranger refusé aussi ; Sec-Fetch-Site cross-site refusé sur les exports (téléchargement déclenché depuis un autre site)
    for (const chemin of ['/api/prestations', '/api/export?format=csv', '/api/export?format=json', '/api/sauvegardes', '/api/etat', '/api/recap']) {
      assert.equal((await s.requete({ chemin, hote: `evil.example:${s.port}` })).status, 403, `GET ${chemin} Host étranger`);
      assert.equal((await s.requete({ chemin, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403, `GET ${chemin} cross-site`);
    }
  }));

test('requêtes valides depuis le navigateur : Host 127.0.0.1 / localhost avec Origin correspondante acceptés ; HEAD sans corps ; OPTIONS, TRACE, PUT refusés', () =>
  avec(async (s, a) => {
    const r = await s.requete({ methode: 'POST', chemin: '/api/prestations', hote: `localhost:${s.port}`, headers: { Origin: `http://localhost:${s.port}`, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, corps: JSON.stringify(saisie()) });
    assert.equal(r.status, 201);
    const head = await s.requete({ methode: 'HEAD', chemin: '/api/prestations' });
    assert.equal(head.status, 200);
    assert.equal(head.texte, '');
    for (const methode of ['OPTIONS', 'TRACE', 'PUT', 'PROPFIND']) {
      const x = await s.requete({ methode, chemin: '/api/prestations', headers: { Origin: `http://127.0.0.1:${s.port}` } });
      assert.ok([403, 405].includes(x.status), `${methode} : ${x.status}`);
    }
    assert.equal(await nbLignes(a), 1);
    assert.equal((await a.post('/api/prestations', saisie({ date: '2026-10-01' }), { 'X-HTTP-Method-Override': 'DELETE' })).status, 201, 'en-tête de substitution de méthode ignoré');
  }));

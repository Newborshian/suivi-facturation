// Recette QA de l'épic E13 (choix du mode de paiement en un clic) : contrat de l'API sous le geste (cinq modes, montant = reste réel,
// double clic, annulation et dernier mode, décision D3), puis contrôles statiques du code du navigateur et de la feuille de style
// (le comportement visuel et clavier a été vérifié à la main dans un navigateur). Données factices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { client, lireDisque, saisie } from './aides-qa.js';
import { demarrerServeurTest } from '../aides/serveur-aide.js';
import { RACINE } from '../aides/temp.js';

async function avec(fn) {
  const s = await demarrerServeurTest();
  try {
    await fn(s, client(s));
  } finally {
    await s.arreter();
  }
}
const dernierMode = async (a) => (await a.get('/api/etat')).json.dernierModePaiement;
const creer = async (a, extra = {}) => (await a.post('/api/prestations', saisie(extra))).json.donnees;

// ------------------------------------------------------------------------------------------------ API sous le geste

test('E13-S1 : un clic enregistre le RESTE réel (acompte déjà versé), daté d\'aujourd\'hui, avec le mode du bouton, pour chacun des cinq modes', () =>
  avec(async (s, a) => {
    for (const mode of ['carte', 'cheque', 'especes', 'virement', 'autre']) {
      const l = await creer(a, { patient: { nom: 'Mode', prenom: mode }, montantCentimes: 5800 });
      await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 4000, date: '2026-10-02', mode: mode === 'carte' ? 'especes' : 'carte' });
      const r = await a.post(`/api/prestations/${l.id}/payer-totalite`, { mode });
      assert.equal(r.status, 201, mode);
      const dernier = r.json.donnees.versements.at(-1);
      assert.deepEqual([dernier.mode, dernier.montantCentimes, dernier.date], [mode, 1800, '2026-10-02'], `${mode} : le reste (18,00 €), pas le total`);
      assert.equal(r.json.donnees.etat, 'paye');
      assert.equal(r.json.donnees.resteCentimes, 0);
      assert.equal(await dernierMode(a), mode, 'le mode du clic devient le dernier mode utilisé');
    }
  }));

test('E13-S1 : double clic ou deux onglets simultanés (modes différents) : un seul versement, la seconde requête reçoit 409 DEJA_PAYEE', () =>
  avec(async (s, a) => {
    for (let essai = 0; essai < 5; essai++) {
      const l = await creer(a, { patient: { nom: 'Double', prenom: `Clic${essai}` } });
      const [x, y] = await Promise.all([
        a.post(`/api/prestations/${l.id}/payer-totalite`, { mode: 'cheque' }),
        a.post(`/api/prestations/${l.id}/payer-totalite`, { mode: 'especes' }),
      ]);
      assert.deepEqual([x.status, y.status].sort(), [201, 409], `essai ${essai}`);
      const refus = x.status === 409 ? x : y;
      assert.equal(refus.json.erreur.code, 'DEJA_PAYEE');
      assert.equal((await a.get(`/api/prestations/${l.id}`)).json.donnees.versements.length, 1, 'un seul versement créé');
    }
  }));

test('E13-S1 : prestation à venir (date future) : versement enregistré avec l\'avertissement non bloquant « daté avant la prestation »', () =>
  avec(async (s, a) => {
    const l = await creer(a, { date: '2026-10-20' });
    const r = await a.post(`/api/prestations/${l.id}/payer-totalite`, { mode: 'virement' });
    assert.equal(r.status, 201);
    assert.ok(r.json.avertissements.some((w) => w.code === 'VERSEMENT_AVANT_PRESTATION'));
  }));

test('E13-S1/S3 : mode invalide ou mal typé (422, aucun versement), champ inconnu ou montant imposé (400), mode manquant sans dernier mode (422 MODE_REQUIS)', () =>
  avec(async (s, a) => {
    const l = await creer(a);
    for (const corps of [{ mode: 'bitcoin' }, { mode: 5 }, { mode: null }, { mode: '' }, { mode: ['carte'] }, { mode: 'CARTE' }]) {
      const r = await a.post(`/api/prestations/${l.id}/payer-totalite`, corps);
      assert.equal(r.status, 422, JSON.stringify(corps));
    }
    for (const corps of [{ mode: 'carte', montantCentimes: 1 }, { mode: 'carte', date: '2026-10-02', extra: 1 }]) {
      assert.equal((await a.post(`/api/prestations/${l.id}/payer-totalite`, corps)).status, 400, JSON.stringify(corps));
    }
    assert.equal((await a.post(`/api/prestations/${l.id}/payer-totalite`, {})).json.erreur.code, 'MODE_REQUIS');
    assert.equal((await a.get(`/api/prestations/${l.id}`)).json.donnees.versements.length, 0, 'rien n\'est enregistré');
    assert.equal(await dernierMode(a), null, 'aucun mode mémorisé par un essai refusé');
  }));

test('E13-S2/S5 : l\'annulation d\'un paiement en un clic supprime le versement ET restaure le dernier mode d\'avant ; une annulation périmée est refusée', () =>
  avec(async (s, a) => {
    const l1 = await creer(a, { patient: { nom: 'A', prenom: 'A' } });
    const l2 = await creer(a, { patient: { nom: 'B', prenom: 'B' }, date: '2026-10-01' });
    await a.post(`/api/prestations/${l1.id}/payer-totalite`, { mode: 'virement' });
    assert.equal(await dernierMode(a), 'virement');
    const p = await a.post(`/api/prestations/${l2.id}/payer-totalite`, { mode: 'cheque' });
    assert.equal(await dernierMode(a), 'cheque');
    const an = await a.post(`/api/annulations/${p.json.annulation}`);
    assert.equal(an.status, 200);
    const apres = (await a.get(`/api/prestations/${l2.id}`)).json.donnees;
    assert.deepEqual([apres.versements.length, apres.resteCentimes, apres.etat], [0, 4500, 'non_paye'], 'le reste et l\'état sont retrouvés');
    assert.equal(await dernierMode(a), 'virement', 'dernier mode restauré (S2)');
    assert.equal((await lireDisque(s.dossier)).parametres.dernierModePaiement, 'virement', 'et sur disque');
    assert.equal((await a.post(`/api/annulations/${p.json.annulation}`)).json.erreur.code, 'ANNULATION_IMPOSSIBLE', 'un jeton ne sert qu\'une fois');

    const q = await a.post(`/api/prestations/${l2.id}/payer-totalite`, { mode: 'especes' });
    await a.post(`/api/prestations/${l1.id}/versements`, { montantCentimes: 100, date: '2026-10-02', mode: 'autre' }); // autre modification entre-temps
    const perimee = await a.post(`/api/annulations/${q.json.annulation}`);
    assert.equal(perimee.status, 409, 'l\'annulation ne vaut que pour la dernière action');
    assert.equal(perimee.json.erreur.code, 'ANNULATION_IMPOSSIBLE');
    assert.equal((await a.get(`/api/prestations/${l2.id}`)).json.donnees.versements.length, 1, 'rien n\'est cassé');
  }));

test('E13-S4 + D3 : changer le mode d\'un versement (PATCH {mode} seul) ne touche ni id, ni montant, ni date, ni état, ni le dernier mode ; annulable ; annulation périmée refusée', () =>
  avec(async (s, a) => {
    const l = await creer(a, { montantCentimes: 4000 });
    await a.post(`/api/prestations/${l.id}/versements`, { montantCentimes: 4000, date: '2026-10-01', mode: 'carte' });
    const autre = await creer(a, { patient: { nom: 'Z', prenom: 'Z' } });
    await a.post(`/api/prestations/${autre.id}/payer-totalite`, { mode: 'virement' });
    assert.equal(await dernierMode(a), 'virement');
    const avant = (await a.get(`/api/prestations/${l.id}`)).json.donnees;
    const vid = avant.versements[0].id;
    const r = await a.patch(`/api/prestations/${l.id}/versements/${vid}`, { mode: 'cheque' });
    assert.equal(r.status, 200);
    const apres = r.json.donnees;
    assert.deepEqual({ ...apres.versements[0] }, { ...avant.versements[0], mode: 'cheque' }, 'seul le mode change');
    assert.deepEqual([apres.etat, apres.verseCentimes, apres.resteCentimes], [avant.etat, avant.verseCentimes, avant.resteCentimes]);
    assert.equal(await dernierMode(a), 'virement', 'D3 : corriger n\'est pas payer, le mode « récent » ne change pas');
    assert.equal((await a.post(`/api/annulations/${r.json.annulation}`)).status, 200);
    assert.equal((await a.get(`/api/prestations/${l.id}`)).json.donnees.versements[0].mode, 'carte', 'mode d\'origine restauré');
    assert.equal(await dernierMode(a), 'virement');

    assert.equal((await a.patch(`/api/prestations/${l.id}/versements/${vid}`, { mode: 'bitcoin' })).status, 422);
    assert.equal((await a.patch(`/api/prestations/${l.id}/versements/${vid}`, { mode: 'cheque', montantCentimes: 1 })).status, 200, 'montant et mode ensemble : validation complète du versement');
    assert.equal((await a.patch(`/api/prestations/${l.id}/versements/inconnu`, { mode: 'cheque' })).status, 404);
  }));

// ------------------------------------------------------------------------------------------------ Contrôles statiques du front

const lire = (...segments) => fs.readFile(path.join(RACINE, ...segments), 'utf8');

test('E13 : « Payé en totalité » n\'est plus un bouton de l\'interface ; le groupe de paiement est rendu par les deux écrans ; plus de menu déroulant pour le mode', async () => {
  const fichiers = ['prestations.js', 'facturation.js', 'facturation-tableau.js', 'prestations-dialogues.js'];
  const sources = Object.fromEntries(await Promise.all(fichiers.map(async (f) => [f, await lire('public', 'js', 'pages', f)])));
  const sansCommentaires = (src) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const [f, src] of Object.entries(sources)) assert.ok(!/Payé en totalité/.test(sansCommentaires(src)), `${f} affiche encore « Payé en totalité »`);
  assert.match(sources['prestations.js'], /paiementRapide\(/, 'écran Prestations');
  assert.ok(/paiementRapide\(/.test(sources['facturation.js']) || /paiementRapide\(/.test(sources['facturation-tableau.js']), 'écran Facturation du mois');
  const dialogues = sources['prestations-dialogues.js'];
  assert.match(dialogues, /creerChoixMode\(/, 'dialogue de versement : choix à boutons');
  assert.ok(!/<select|creerSelect\(|el\(\s*'select'/.test(dialogues), 'plus de <select> dans les dialogues de versement');
});

test('E13-S8/S9 : la feuille de style porte la variante compacte (requête de conteneur), des cibles de 36 px (44 px en tactile et en compact) et le contraste forcé ; l\'impression masque la colonne d\'actions', async () => {
  const css = await lire('public', 'css', 'composants.css');
  assert.match(css, /@container tableau \(width < 60rem\)[\s\S]*\.paiement-rapide__declencheur \{ display: inline-flex; \}/, 'déclencheur visible seulement quand le tableau est trop étroit pour les cinq modes');
  assert.match(css, /\.paiement-rapide \{\s+display: inline-flex;\s+flex-wrap: nowrap;/, 'les cinq modes restent sur UNE ligne');
  assert.match(css, /\.paiement-rapide__modes \{\s+display: inline-flex;\s+flex-wrap: nowrap;/, 'les cinq boutons ne passent jamais à la ligne');
  assert.doesNotMatch(css, /\.btn-payer/, 'ancien bouton « Payé en totalité » retiré');
  assert.match(css, /\.paiement-rapide__declencheur \{ display: none; \}/, 'déclencheur masqué au-dessus');
  assert.match(css, /\.paiement-rapide__modes \{ display: none; \}/, 'modes masqués tant que aria-expanded="false" (hors tabulation et arbre d\'accessibilité)');
  assert.match(css, /aria-expanded="true"\]\) > \.paiement-rapide__modes \{ display: inline-flex; \}/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*min-width: var\(--cible\)/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*paiement-rapide__mode/);
  assert.match(css, /choix-mode/);
  const impression = await lire('public', 'css', 'impression.css');
  assert.match(impression, /\.col-action/, 'colonne Actions (donc le groupe de paiement) masquée à l\'impression');
  const tokens = await lire('public', 'css', 'tokens.css');
  assert.match(tokens, /--cible-s:\s*2\.25rem/, '36 px = 2,25 rem');
  assert.match(tokens, /--cible:\s*2\.75rem/, '44 px = 2,75 rem');
});

test('E13-S7 : aucun raccourci clavier propre à l\'application ; aucun tabindex positif ; le groupe n\'impose aucun piège (Échap rend le focus au déclencheur)', async () => {
  const dossier = path.join(RACINE, 'public', 'js');
  const fichiers = [];
  const parcourir = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await parcourir(path.join(d, e.name));
      else if (e.name.endsWith('.js')) fichiers.push(path.join(d, e.name));
    }
  };
  await parcourir(dossier);
  for (const f of fichiers) {
    const src = await fs.readFile(f, 'utf8');
    assert.ok(!/tabindex['"]?\s*[:=,]\s*['"]?[1-9]/i.test(src), `${path.basename(f)} : tabindex positif`);
    assert.ok(!/document\.addEventListener\(\s*['"]key(down|press|up)['"]/.test(src), `${path.basename(f)} : raccourci clavier global`);
  }
  const groupe = await lire('public', 'js', 'paiement-rapide.js');
  assert.match(groupe, /key !== 'Escape'/);
  assert.match(groupe, /bascule\.focus\(\)/, 'Échap : focus rendu au déclencheur');
});

test('confidentialité du front : aucun nom de patient dans le stockage du navigateur (seul le filtre non nominatif de la page Patients est retenu) ni dans l\'URL', async () => {
  const dossier = path.join(RACINE, 'public');
  const appels = [];
  const parcourir = async (d) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await parcourir(path.join(d, e.name));
      else if (/\.(js|html)$/.test(e.name)) {
        const src = await fs.readFile(path.join(d, e.name), 'utf8');
        for (const m of src.matchAll(/(localStorage|sessionStorage|indexedDB|document\.cookie|history\.(?:push|replace)State|location\.(?:search|hash)\s*=)[^\n]*/g)) appels.push(`${e.name}: ${m[0].trim()}`);
        if (e.name.endsWith('.html')) assert.match(src, /<title>(Facturation du mois|Prestations|Patients|Tableau de bord|Paramètres) — suivi-facturation<\/title>/, `${e.name} : titre fixe, sans donnée nominative`);
      }
    }
  };
  await parcourir(dossier);
  const stockage = appels.filter((x) => /(local|session)Storage\.setItem/.test(x));
  const dedans = (nom) => stockage.filter((x) => x.startsWith(nom));
  for (const x of stockage) {
    assert.ok(/CLE_THEME|CLE_STOCKAGE|CLE_FILTRES_PRESTATIONS/.test(x), `écriture de stockage inattendue : ${x}`);
  }
  assert.ok(dedans('combobox-patient.js').length === 0 && dedans('recherche-patients.js').length === 0 && dedans('patients-dialogues.js').length === 0, 'la saisie et les dialogues patients n\'écrivent rien dans le navigateur');
  const url = appels.filter((x) => /history\.|location\.(search|hash)/.test(x));
  assert.ok(url.every((x) => /history\.replaceState\(null, '', window\.location\.pathname\)/.test(x)), `modification de l'URL (seul le retrait de la requête est admis) : ${url.join(' | ')}`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogueTest } from '../aides/catalogue-test.js';
import { etatPaiement } from '../../src/domain/paiement.js';
import {
  ajouterVersement,
  creerPrestation,
  definirStatut,
  filtrerPrestations,
  modifierPrestation,
  modifierVersement,
  payerEnTotalite,
  supprimerPrestation,
  supprimerVersement,
  totaliser,
} from '../../src/domain/prestations.js';
import { creerEtatInitial } from '../../src/domain/schema.js';
import { validerFiltres } from '../../src/domain/validation.js';

let compteur = 0;
const ctx = (aujourdHui = '2026-10-02', maintenant = '2026-10-02T09:14:03.000Z') => ({ aujourdHui, maintenant, nouvelId: () => `id-${++compteur}` });
const etatVide = () => {
  const etat = creerEtatInitial(new Date('2026-10-02T09:00:00Z'));
  etat.catalogue = catalogueTest();
  return etat;
};
const saisie = (extra = {}) => ({ patient: { nom: 'Lapin', prenom: 'Pierre' }, date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500, motif: 'Graphisme', ...extra });
const creer = (etat, extra, c = ctx()) => creerPrestation(etat, saisie(extra), c).resultat;
const erreur = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return assert.fail('aucune erreur levée');
};

test('création : statut à facturer, aucun versement, état non payé, libellé et catégorie figés', () => {
  const etat = etatVide();
  const { resultat: l, avertissements } = creerPrestation(etat, saisie(), ctx());
  assert.equal(l.statut, 'a_facturer');
  assert.equal(l.factureLe, null);
  assert.deepEqual(l.versements, []);
  assert.equal(etatPaiement(l).etat, 'non_paye');
  assert.equal(l.libelle, 'Séance individuelle 45 min');
  assert.equal(l.categorie, 'seance');
  assert.equal(l.montantCentimes, 4500);
  assert.deepEqual(avertissements, []);
  assert.equal(etat.prestations.length, 1);
});

test("création : champs obligatoires vides -> 422 avec un message par champ, rien d'enregistré", () => {
  const etat = etatVide();
  const e = erreur(() => creerPrestation(etat, { motif: 'x' }, ctx()));
  assert.equal(e.status, 422);
  assert.equal(e.code, 'VALIDATION');
  assert.deepEqual(Object.keys(e.champs).sort(), ['date', 'montantCentimes', 'nom', 'prenom', 'prestationId']);
  assert.match(e.champs.nom, /nom du patient/);
  assert.equal(etat.prestations.length, 0);
});

test('création : montant négatif, flottant, texte, trop grand -> refusé ; 0 € accepté', () => {
  for (const m of [-1, 45.5, '45', Number.NaN, 10_000_001]) {
    const e = erreur(() => creerPrestation(etatVide(), saisie({ montantCentimes: m }), ctx()));
    assert.equal(e.status, 422, String(m));
    assert.ok(e.champs.montantCentimes, String(m));
  }
  assert.equal(creerPrestation(etatVide(), saisie({ montantCentimes: 0 }), ctx()).resultat.montantCentimes, 0);
});

test('création : date impossible, prestation inconnue ou désactivée, champ inconnu, motif trop long', () => {
  assert.ok(erreur(() => creerPrestation(etatVide(), saisie({ date: '2026-02-30' }), ctx())).champs.date);
  assert.ok(erreur(() => creerPrestation(etatVide(), saisie({ prestationId: 'nexiste-pas' }), ctx())).champs.prestationId);
  const desactive = etatVide();
  desactive.catalogue.find((c) => c.id === 'reunion-synthese').actif = false;
  assert.ok(erreur(() => creerPrestation(desactive, saisie({ prestationId: 'reunion-synthese' }), ctx())).champs.prestationId);
  assert.equal(erreur(() => creerPrestation(etatVide(), saisie({ inconnu: 1 }), ctx())).status, 400);
  assert.ok(erreur(() => creerPrestation(etatVide(), saisie({ motif: 'x'.repeat(201) }), ctx())).champs.motif);
  assert.ok(erreur(() => creerPrestation(etatVide(), saisie({ patient: { nom: 'a\nb', prenom: 'c' } }), ctx())).champs.nom);
});

test('création : date future -> avertissement DATE_FUTURE sans blocage', () => {
  const { avertissements } = creerPrestation(etatVide(), saisie({ date: '2026-10-20' }), ctx());
  assert.deepEqual(avertissements.map((a) => a.code), ['DATE_FUTURE']);
});

test('libellé figé : renommer le catalogue ne change pas la ligne existante', () => {
  const etat = etatVide();
  const l = creer(etat);
  etat.catalogue.find((c) => c.id === 'seance-45').libelle = 'Autre nom';
  assert.equal(etat.prestations[0].libelle, 'Séance individuelle 45 min');
  assert.equal(l.libelle, 'Séance individuelle 45 min');
  assert.equal(creer(etat).libelle, 'Autre nom', 'une nouvelle ligne reprend le libellé en vigueur');
});

test('rattachement : même patient (casse, espaces) -> même id ; homonyme déjà distingué -> 409', () => {
  const etat = etatVide();
  const a = creer(etat);
  const b = creer(etat, { patient: { nom: ' lapin', prenom: 'PIERRE ' } });
  assert.equal(a.patient.id, b.patient.id);
  creer(etat, { patient: { nom: 'Lapin', prenom: 'Pierre' }, nouveauPatient: true });
  const e = erreur(() => creerPrestation(etat, saisie(), ctx()));
  assert.equal(e.code, 'PATIENTS_HOMONYMES');
  assert.equal(e.details.candidats.length, 2);
  assert.equal(etat.prestations.length, 3);
});

test('modification : champs partiels, modifieLe attendu, libellé refigé si le type change', () => {
  const etat = etatVide();
  const l = creer(etat);
  const r = modifierPrestation(etat, l.id, { modifieLe: l.modifieLe, montantCentimes: 4000, motif: 'Tarif réduit' }, ctx('2026-10-02', '2026-10-03T08:00:00.000Z')).resultat;
  assert.equal(r.montantCentimes, 4000);
  assert.equal(r.motif, 'Tarif réduit');
  assert.equal(r.date, '2026-10-02', 'champ non fourni : inchangé');
  assert.equal(r.modifieLe, '2026-10-03T08:00:00.000Z');
  const t = modifierPrestation(etat, l.id, { modifieLe: r.modifieLe, prestationId: 'reunion-synthese' }, ctx('2026-10-02', '2026-10-04T08:00:00.000Z')).resultat;
  assert.equal(t.libelle, "Réunion de synthèse");
  assert.equal(t.categorie, 'autre');
});

test('modification : version périmée -> 409 MODIFIEE_AILLEURS, ligne inchangée ; modifieLe obligatoire', () => {
  const etat = etatVide();
  const l = creer(etat);
  const e = erreur(() => modifierPrestation(etat, l.id, { modifieLe: '2020-01-01T00:00:00.000Z', montantCentimes: 1 }, ctx()));
  assert.equal(e.status, 409);
  assert.equal(e.code, 'MODIFIEE_AILLEURS');
  assert.equal(etat.prestations[0].montantCentimes, 4500);
  assert.ok(erreur(() => modifierPrestation(etat, l.id, { montantCentimes: 1 }, ctx())).champs.modifieLe);
  assert.equal(erreur(() => modifierPrestation(etat, 'absente', { modifieLe: 'x' }, ctx())).status, 404);
});

test('modification : montant inférieur au total versé -> état payé et trop-perçu signalé', () => {
  const etat = etatVide();
  const l = creer(etat);
  payerEnTotalite(etat, l.id, { mode: 'cheque' }, ctx());
  const { resultat, avertissements } = modifierPrestation(etat, l.id, { modifieLe: etat.prestations[0].modifieLe, montantCentimes: 4000 }, ctx());
  const e = etatPaiement(resultat);
  assert.equal(e.etat, 'paye');
  assert.equal(e.tropPercuCentimes, 500);
  assert.equal(avertissements[0].code, 'TROP_PERCU');
  assert.match(avertissements[0].message, /5,00 €/);
});

test('modification du patient : changement de nom -> autre patient ; simple correction de casse -> même patient', () => {
  const etat = etatVide();
  const a = creer(etat);
  const b = creer(etat, { patient: { nom: 'Ours', prenom: 'Baloo' } });
  const casse = modifierPrestation(etat, a.id, { modifieLe: a.modifieLe, patient: { nom: 'LAPIN', prenom: 'Pierre' } }, ctx()).resultat;
  assert.equal(casse.patient.id, a.patient.id);
  assert.equal(casse.patient.nom, 'LAPIN');
  const autre = modifierPrestation(etat, a.id, { modifieLe: casse.modifieLe, patient: { nom: 'Ours', prenom: 'Baloo' } }, ctx());
  assert.equal(autre.resultat.patient.id, b.patient.id);
});

test('suppression : ligne et versements supprimés, nombre de versements renvoyé ; absente -> 404', () => {
  const etat = etatVide();
  const l = creer(etat);
  ajouterVersement(etat, l.id, { montantCentimes: 1000, date: '2026-10-02', mode: 'cheque' }, ctx());
  ajouterVersement(etat, l.id, { montantCentimes: 500, date: '2026-10-02', mode: 'cheque' }, ctx());
  assert.deepEqual(supprimerPrestation(etat, l.id).resultat, { id: l.id, versementsSupprimes: 2 });
  assert.equal(etat.prestations.length, 0);
  assert.equal(erreur(() => supprimerPrestation(etat, l.id)).status, 404);
});

test('statut : à facturer -> facturé mémorise la date, retour efface ; état de paiement indépendant', () => {
  const etat = etatVide();
  const l = creer(etat);
  const r = definirStatut(etat, { ids: [l.id], statut: 'facture' }, ctx('2026-10-05'));
  assert.equal(r.resultat.modifiees, 1);
  assert.equal(etat.prestations[0].statut, 'facture');
  assert.equal(etat.prestations[0].factureLe, '2026-10-05');
  assert.equal(etatPaiement(etat.prestations[0]).etat, 'non_paye');
  definirStatut(etat, { ids: [l.id], statut: 'a_facturer' }, ctx());
  assert.equal(etat.prestations[0].statut, 'a_facturer');
  assert.equal(etat.prestations[0].factureLe, null);
});

test("statut groupé : lignes déjà dans l'état ignorées, date explicite, absente -> 404 sans rien changer", () => {
  const etat = etatVide();
  const a = creer(etat);
  const b = creer(etat, { patient: { nom: 'Ours', prenom: 'Baloo' } });
  definirStatut(etat, { ids: [a.id], statut: 'facture', date: '2026-09-30' }, ctx());
  const r = definirStatut(etat, { ids: [a.id, b.id, a.id], statut: 'facture' }, ctx('2026-10-02'));
  assert.equal(r.resultat.modifiees, 1);
  assert.equal(etat.prestations[0].factureLe, '2026-09-30', "la date d'une ligne déjà facturée n'est pas écrasée");
  assert.equal(etat.prestations[1].factureLe, '2026-10-02');
  assert.equal(erreur(() => definirStatut(etat, { ids: [a.id, 'absente'], statut: 'a_facturer' }, ctx())).status, 404);
  assert.equal(etat.prestations[0].statut, 'facture');
  assert.equal(erreur(() => definirStatut(etat, { ids: [], statut: 'facture' }, ctx())).status, 400);
  assert.ok(erreur(() => definirStatut(etat, { ids: [a.id], statut: 'perdu' }, ctx())).champs.statut);
});

test('statut : marquer facturé une prestation à venir -> avertissement, pas de blocage', () => {
  const etat = etatVide();
  const l = creer(etat, { date: '2026-10-20' });
  const r = definirStatut(etat, { ids: [l.id], statut: 'facture' }, ctx());
  assert.deepEqual(r.avertissements.map((a) => a.code), ['FACTURATION_DATE_FUTURE']);
  assert.equal(etat.prestations[0].statut, 'facture');
});

test('versement : ajout, état recalculé, dernier mode mémorisé ; montant <= 0, date vide, mode invalide refusés', () => {
  const etat = etatVide();
  const l = creer(etat);
  const r = ajouterVersement(etat, l.id, { montantCentimes: 2000, date: '2026-10-02', mode: 'virement' }, ctx());
  assert.deepEqual(etatPaiement(r.resultat), { verseCentimes: 2000, payeCentimes: 2000, resteCentimes: 2500, tropPercuCentimes: 0, etat: 'partiel' });
  assert.equal(etat.parametres.dernierModePaiement, 'virement');
  const invalides = [
    { montantCentimes: 0, date: '2026-10-02', mode: 'cheque' },
    { montantCentimes: -5, date: '2026-10-02', mode: 'cheque' },
    { montantCentimes: 10.5, date: '2026-10-02', mode: 'cheque' },
    { montantCentimes: 100, date: '', mode: 'cheque' },
    { montantCentimes: 100, date: '2026-10-02', mode: 'bitcoin' },
    { montantCentimes: 100, date: '2026-10-02' },
  ];
  for (const corps of invalides) {
    assert.equal(erreur(() => ajouterVersement(etat, l.id, corps, ctx())).status, 422, JSON.stringify(corps));
  }
  assert.equal(etat.prestations[0].versements.length, 1);
});

test('versement : avant la prestation -> avertissement ; au-delà du reste -> trop-perçu signalé', () => {
  const etat = etatVide();
  const l = creer(etat, { date: '2026-10-10' });
  const r = ajouterVersement(etat, l.id, { montantCentimes: 5000, date: '2026-10-02', mode: 'especes' }, ctx());
  assert.deepEqual(r.avertissements.map((a) => a.code).sort(), ['TROP_PERCU', 'VERSEMENT_AVANT_PRESTATION']);
  assert.match(r.avertissements.find((a) => a.code === 'TROP_PERCU').message, /5,00 €/);
  assert.match(r.avertissements.find((a) => a.code === 'VERSEMENT_AVANT_PRESTATION').message, /10\/10\/2026/);
  assert.equal(etat.prestations[0].versements.length, 1, 'le versement est accepté');
});

test('versement daté dans le futur : avertissement non bloquant (ajout, modification, paiement en totalité), jamais pour aujourd\'hui ni le passé', () => {
  const etat = etatVide();
  const l = creer(etat, { date: '2026-10-01' }); // « aujourd'hui » des tests : 2026-10-02
  const r = ajouterVersement(etat, l.id, { montantCentimes: 1000, date: '2026-10-03', mode: 'cheque' }, ctx());
  assert.deepEqual(r.avertissements.map((a) => a.code), ['VERSEMENT_DATE_FUTURE']);
  assert.match(r.avertissements[0].message, /03\/10\/2026/);
  assert.equal(etat.prestations[0].versements.length, 1, 'le versement est accepté');
  assert.deepEqual(ajouterVersement(etat, l.id, { montantCentimes: 1000, date: '2026-10-02', mode: 'cheque' }, ctx()).avertissements, [], 'aujourd\'hui : rien');
  assert.deepEqual(ajouterVersement(etat, l.id, { montantCentimes: 1000, date: '2026-10-01', mode: 'cheque' }, ctx()).avertissements, [], 'passé : rien');
  const v = etat.prestations[0].versements[2];
  assert.deepEqual(modifierVersement(etat, l.id, v.id, { date: '2026-12-25' }, ctx()).avertissements.map((a) => a.code), ['VERSEMENT_DATE_FUTURE']);
  assert.deepEqual(modifierVersement(etat, l.id, v.id, { montantCentimes: 500 }, ctx()).avertissements, [], 'date non modifiée : rien');
  const l2 = creer(etat, { date: '2026-10-01', patient: { nom: 'Ours', prenom: 'Baloo' } });
  const p = payerEnTotalite(etat, l2.id, { date: '2026-11-01', mode: 'especes' }, ctx());
  assert.deepEqual(p.avertissements.map((a) => a.code), ['VERSEMENT_DATE_FUTURE']);
});

test("versement : modification et suppression recalculent l'état ; absent -> 404", () => {
  const etat = etatVide();
  const l = creer(etat);
  const v = ajouterVersement(etat, l.id, { montantCentimes: 2000, date: '2026-10-02', mode: 'cheque' }, ctx()).resultat.versements[0];
  const m = modifierVersement(etat, l.id, v.id, { montantCentimes: 4500 }, ctx()).resultat;
  assert.equal(etatPaiement(m).etat, 'paye');
  assert.equal(m.versements[0].mode, 'cheque', 'champ non fourni : inchangé');
  const s = supprimerVersement(etat, l.id, v.id, ctx()).resultat;
  assert.equal(etatPaiement(s).etat, 'non_paye');
  assert.equal(erreur(() => supprimerVersement(etat, l.id, v.id, ctx())).status, 404);
});

test('« Payé en totalité » : versement = reste, date du jour, dernier mode ; état payé', () => {
  const etat = etatVide();
  const l = creer(etat);
  ajouterVersement(etat, l.id, { montantCentimes: 2000, date: '2026-10-02', mode: 'cheque' }, ctx());
  const r = payerEnTotalite(etat, l.id, {}, ctx('2026-10-03'));
  const dernier = r.resultat.versements.at(-1);
  assert.deepEqual([dernier.montantCentimes, dernier.date, dernier.mode], [2500, '2026-10-03', 'cheque']);
  assert.equal(etatPaiement(r.resultat).etat, 'paye');
  const e = erreur(() => payerEnTotalite(etat, l.id, {}, ctx()));
  assert.equal(e.code, 'DEJA_PAYEE');
  assert.equal(e.status, 409);
});

test('« Payé en totalité » : mode explicite prioritaire et mémorisé ; aucun mode jamais utilisé -> 422 MODE_REQUIS', () => {
  const etat = etatVide();
  const l = creer(etat);
  const e = erreur(() => payerEnTotalite(etat, l.id, {}, ctx()));
  assert.equal(e.status, 422);
  assert.equal(e.code, 'MODE_REQUIS');
  assert.equal(etat.prestations[0].versements.length, 0);
  payerEnTotalite(etat, l.id, { mode: 'virement' }, ctx());
  assert.equal(etat.parametres.dernierModePaiement, 'virement');
  const l2 = creer(etat, { patient: { nom: 'Ours', prenom: 'Baloo' } });
  assert.equal(payerEnTotalite(etat, l2.id, {}, ctx()).resultat.versements[0].mode, 'virement');
  const l3 = creer(etat, { patient: { nom: 'Renard', prenom: 'Goupil' } });
  payerEnTotalite(etat, l3.id, { mode: 'especes', date: '2026-10-01' }, ctx());
  assert.equal(etat.parametres.dernierModePaiement, 'especes');
});

test('« Payé en totalité » sur un montant de 0 € : déjà payée', () => {
  const etat = etatVide();
  const l = creer(etat, { montantCentimes: 0 });
  assert.equal(erreur(() => payerEnTotalite(etat, l.id, { mode: 'cheque' }, ctx())).code, 'DEJA_PAYEE');
});

test('filtres : mois, patient, statut, état, à venir, plage ; tri par date ; ET entre les filtres', () => {
  const etat = etatVide();
  const a = creer(etat, { date: '2026-09-14' }, ctx('2026-10-02', '2026-09-14T10:00:00.000Z'));
  const b = creer(etat, { date: '2026-10-05', patient: { nom: 'Ours', prenom: 'Baloo' } });
  const c = creer(etat, { date: '2026-10-20' });
  payerEnTotalite(etat, b.id, { mode: 'cheque' }, ctx());
  definirStatut(etat, { ids: [a.id], statut: 'facture' }, ctx());
  const filtrer = (q) => filtrerPrestations(etat.prestations, validerFiltres(new URLSearchParams(q)), '2026-10-02', etatPaiement).map((l) => l.id);
  assert.deepEqual(filtrer(''), [a.id, b.id, c.id]);
  assert.deepEqual(filtrer('mois=2026-10'), [b.id, c.id]);
  assert.deepEqual(filtrer(`patientId=${b.patient.id}`), [b.id]);
  assert.deepEqual(filtrer('statut=facture'), [a.id]);
  assert.deepEqual(filtrer('etat=paye'), [b.id]);
  assert.deepEqual(filtrer('etat=non_paye,partiel'), [a.id, c.id]);
  assert.deepEqual(filtrer('aVenir=true'), [b.id, c.id]);
  assert.deepEqual(filtrer('de=2026-10-01&a=2026-10-10'), [b.id]);
  assert.deepEqual(filtrer('mois=2026-10&statut=a_facturer&etat=non_paye'), [c.id]);
});

test('filtres : paramètre inconnu ou invalide -> 400', () => {
  for (const q of ['x=1', 'mois=2026-13', 'statut=zzz', 'etat=paye,zzz', 'aVenir=oui', 'de=2026-02-30', 'patientId=']) {
    assert.equal(erreur(() => validerFiltres(new URLSearchParams(q))).status, 400, q);
  }
});

test('totaux : somme exacte en centimes (montant = payé + reste)', () => {
  const etat = etatVide();
  const a = creer(etat, { montantCentimes: 4500 });
  creer(etat, { montantCentimes: 3500, patient: { nom: 'Ours', prenom: 'Baloo' } });
  ajouterVersement(etat, a.id, { montantCentimes: 2000, date: '2026-10-02', mode: 'cheque' }, ctx());
  const lignes = etat.prestations.map((l) => ({ ...l, ...etatPaiement(l) }));
  const t = totaliser(lignes);
  assert.deepEqual(t, { nombre: 2, montantCentimes: 8000, payeCentimes: 2000, resteCentimes: 6000, tropPercuCentimes: 0 });
  assert.equal(t.montantCentimes, t.payeCentimes + t.resteCentimes);
});

test("catalogue inchangé par les opérations (aucune mutation du catalogue)", () => {
  const etat = etatVide();
  creer(etat);
  assert.deepEqual(etat.catalogue, catalogueTest());
});

// ---- Registre des patients (schéma version 2) ----

const identiteRegistre = (etat) => etat.prestations.every((l) => {
  const p = etat.patients.find((x) => x.id === l.patient.id);
  return p && p.nom === l.patient.nom && p.prenom === l.patient.prenom;
});

test('registre : la création ajoute le patient au registre dans la même mutation ; la copie de la ligne est celle du registre', () => {
  const etat = etatVide();
  const a = creer(etat);
  assert.deepEqual(etat.patients, [{ id: a.patient.id, nom: 'Lapin', prenom: 'Pierre', actif: true }]);
  const b = creerPrestation(etat, saisie({ patient: { nom: ' lapin', prenom: 'PIERRE' } }), ctx());
  assert.equal(b.resultat.patient.id, a.patient.id);
  assert.deepEqual(b.resultat.patient, { id: a.patient.id, nom: 'Lapin', prenom: 'Pierre' }, "l'écriture du registre, pas celle tapée");
  assert.deepEqual(b.avertissements.map((x) => x.code), ['PATIENT_RATTACHE']);
  assert.equal(etat.patients.length, 1);
  assert.ok(identiteRegistre(etat));
});

test("registre : une saisie refusée (validation) n'ajoute aucun patient", () => {
  const etat = etatVide();
  assert.equal(erreur(() => creerPrestation(etat, saisie({ montantCentimes: -1 }), ctx())).status, 422);
  assert.deepEqual(etat.patients, []);
});

test('registre : par patientId, un patient archivé ou sans prestation est accepté ; archivé -> réactivé avec avertissement', () => {
  const etat = etatVide();
  etat.patients.push({ id: 'p-ours', nom: 'Ours', prenom: 'Baloo', actif: false });
  const r = creerPrestation(etat, { patientId: 'p-ours', date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500 }, ctx());
  assert.equal(r.resultat.patient.id, 'p-ours');
  assert.deepEqual(r.avertissements.map((x) => x.code), ['PATIENT_REACTIVE']);
  assert.equal(etat.patients[0].actif, true);
  assert.equal(erreur(() => creerPrestation(etat, { patientId: 'absent', date: '2026-10-02', prestationId: 'seance-45', montantCentimes: 4500 }, ctx())).status, 422);
});

test('registre : un homonyme sans prestation compte parmi les candidats (409) ; nouveauPatient ajoute un second patient', () => {
  const etat = etatVide();
  etat.patients.push({ id: 'p-vide', nom: 'Lapin', prenom: 'Pierre', actif: true });
  creer(etat, { nouveauPatient: true });
  assert.equal(etat.patients.length, 2);
  const e = erreur(() => creer(etat));
  assert.equal(e.code, 'PATIENTS_HOMONYMES');
  assert.equal(e.details.candidats.length, 2);
  assert.ok(e.details.candidats.some((c) => c.dernierePrestation === null));
});

test('registre : renommer le patient depuis une ligne met à jour le registre et toutes ses lignes, identifiant conservé', () => {
  const etat = etatVide();
  const a = creer(etat, { patient: { nom: 'Lapen', prenom: 'Pierre' } });
  creer(etat, { date: '2026-10-01', patient: { nom: 'Lapen', prenom: 'Pierre' } });
  const autre = creer(etat, { patient: { nom: 'Ours', prenom: 'Baloo' } });
  const e409 = erreur(() => modifierPrestation(etat, a.id, { modifieLe: a.modifieLe, patient: { nom: 'Lapin', prenom: 'Pierre' } }, ctx()));
  assert.equal(e409.code, 'RENOMMAGE_PATIENT', 'jamais de détachement silencieux');
  const r = modifierPrestation(etat, a.id, { modifieLe: a.modifieLe, patient: { nom: 'Lapin', prenom: 'Pierre' }, renommerPatient: true }, ctx());
  assert.equal(r.resultat.patient.id, a.patient.id);
  assert.deepEqual(etat.patients.map((p) => p.nom), ['Lapin', 'Ours']);
  assert.deepEqual(etat.prestations.filter((l) => l.patient.id === a.patient.id).map((l) => l.patient.nom), ['Lapin', 'Lapin']);
  assert.equal(etat.prestations.find((l) => l.id === autre.id).patient.nom, 'Ours');
  assert.ok(identiteRegistre(etat));
});

test("registre : correction de casse sur une ligne d'un patient qui en a d'autres = renommage du patient (la copie ne diverge jamais du registre)", () => {
  const etat = etatVide();
  const a = creer(etat);
  const b = creer(etat, { date: '2026-10-01' });
  modifierPrestation(etat, a.id, { modifieLe: a.modifieLe, patient: { nom: 'LAPIN', prenom: 'Pierre' } }, ctx());
  assert.equal(etat.patients[0].nom, 'LAPIN');
  assert.equal(etat.prestations.find((l) => l.id === b.id).patient.nom, 'LAPIN');
  assert.ok(identiteRegistre(etat));
});

test("registre : détacher une ligne crée un patient au registre (ou rattache à l'existant) et laisse l'ancien intact", () => {
  const etat = etatVide();
  const a = creer(etat);
  const idAvant = a.patient.id; // la ligne renvoyée est celle de l'état : elle change avec la modification
  creer(etat, { date: '2026-10-01' });
  const r = modifierPrestation(etat, a.id, { modifieLe: a.modifieLe, patient: { nom: 'Ours', prenom: 'Baloo' }, detacherLigne: true }, ctx());
  assert.notEqual(r.resultat.patient.id, idAvant);
  assert.deepEqual(etat.patients.map((p) => p.nom), ['Lapin', 'Ours']);
  assert.equal(etat.prestations.filter((l) => l.patient.nom === 'Lapin').length, 1);
  assert.ok(identiteRegistre(etat));
});

test("registre : supprimer la dernière prestation d'un patient ne le retire jamais du registre", () => {
  const etat = etatVide();
  const a = creer(etat);
  supprimerPrestation(etat, a.id);
  assert.equal(etat.prestations.length, 0);
  assert.deepEqual(etat.patients.map((p) => p.id), [a.patient.id]);
});

test('registre : modifier une ligne orpheline (patient absent du registre, état toléré) puis la renommer ajoute le patient au registre', () => {
  const etat = etatVide();
  const a = creer(etat);
  etat.patients.length = 0; // fichier retouché hors de l'application
  modifierPrestation(etat, a.id, { modifieLe: a.modifieLe, patient: { nom: 'LAPIN', prenom: 'Pierre' } }, ctx());
  assert.deepEqual(etat.patients, [{ id: a.patient.id, nom: 'LAPIN', prenom: 'Pierre', actif: true }]);
  assert.ok(identiteRegistre(etat));
});

test('D3 : modifierVersement ne touche jamais au dernier mode utilisé (corriger un versement n\'est pas payer)', () => {
  const etat = etatVide();
  const l = creer(etat);
  const v = ajouterVersement(etat, l.id, { montantCentimes: 1000, date: '2026-10-02', mode: 'carte' }, ctx()).resultat.versements[0];
  assert.equal(etat.parametres.dernierModePaiement, 'carte');
  modifierVersement(etat, l.id, v.id, { mode: 'cheque' }, ctx());
  assert.equal(etat.prestations[0].versements[0].mode, 'cheque');
  assert.equal(etat.parametres.dernierModePaiement, 'carte');
  modifierVersement(etat, l.id, v.id, { montantCentimes: 1100, date: '2026-10-01', mode: 'autre' }, ctx());
  assert.equal(etat.parametres.dernierModePaiement, 'carte');
});

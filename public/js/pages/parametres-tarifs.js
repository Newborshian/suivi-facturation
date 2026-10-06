// Paramètres › Tarifs : modifier, désactiver ou ajouter une prestation du catalogue.
// Un nouveau tarif ne s'applique qu'aux prochaines saisies : les prestations déjà enregistrées gardent libellé, catégorie et montant.
// Une prestation n'est jamais supprimée depuis l'écran : elle se désactive (l'historique la référence).
import { ErreurApi, appeler } from '/js/api.js';
import { CATEGORIE_PAR_DEFAUT, messageTarifsVide } from '/js/catalogue-etat.js';
import { el } from '/js/dom.js';
import { validerParEntree } from '/js/entree.js';
import { LIBELLES_CATEGORIE, formatMontantSaisie, lireMontant } from '/js/format.js';
import { afficherToast, confirmer, creerChamp, creerEntreeMontant } from '/js/ui.js';
import { pluriel } from '/js/format.js';

const MESSAGE_TARIF = 'Le tarif doit être un nombre positif ou nul, par exemple 45 ou 45,50.';
let compteur = 0;

function selectCategorie(valeur, id, nom) {
  return el(
    'select',
    { classe: 'input', attributs: { id, name: nom }, proprietes: {} },
    ...Object.entries(LIBELLES_CATEGORIE).map(([code, libelle]) => el('option', { texte: libelle, attributs: { value: code }, proprietes: { selected: code === valeur } })),
  );
}

const messageErreur = (err) => (err instanceof ErreurApi ? (err.champs ? Object.values(err.champs)[0] : err.message) : 'Une erreur est survenue. Rien n\'a été modifié.');

/** Section « Tarifs ». `ecriture` : faux si les modifications sont impossibles (conflit, lecture seule). */
export function sectionTarifs({ catalogue: initial, utilisations: utilisationsInitiales = {}, ecriture }) {
  let catalogue = initial;
  let utilisations = utilisationsInitiales;
  const corps = el('tbody', {});
  const recharger = async () => {
    const r = await appeler('GET', '/api/catalogue');
    catalogue = r.catalogue;
    utilisations = r.utilisations ?? {};
    remplir();
  };

  function ligne(c) {
    const n = ++compteur;
    const libelle = el('input', { classe: `input${c.actif ? '' : ' nom-prestation'}`, attributs: { id: `tarif-${n}-libelle`, type: 'text', maxlength: '120', 'aria-label': 'Nom de la prestation', autocomplete: 'off', disabled: !ecriture }, proprietes: { value: c.libelle } });
    const categorie = selectCategorie(c.categorie, `tarif-${n}-categorie`, 'categorie');
    categorie.setAttribute('aria-label', 'Catégorie');
    categorie.disabled = !ecriture;
    const entreeTarif = creerEntreeMontant(`tarif-${n}-montant`, formatMontantSaisie(c.tarifCentimes));
    const tarif = entreeTarif.querySelector('input');
    tarif.setAttribute('aria-label', 'Tarif en euros');
    tarif.disabled = !ecriture;
    const actif = el('input', { attributs: { type: 'checkbox', disabled: !ecriture }, proprietes: { checked: c.actif } });
    const erreur = el('p', { classe: 'champ__erreur', attributs: { hidden: true, role: 'alert' } });
    const montrerErreur = (message) => {
      erreur.textContent = message;
      erreur.hidden = false;
    };
    const enregistrer = el('button', {
      classe: 'btn btn--secondaire btn--petit',
      texte: 'Enregistrer',
      attributs: { type: 'button', disabled: !ecriture, 'aria-label': `Enregistrer les modifications de ${c.libelle}` },
      evenements: {
        click: async () => {
          erreur.hidden = true;
          const t = lireMontant(tarif.value);
          if (!t.ok) return montrerErreur(MESSAGE_TARIF);
          // Renommer un type déjà utilisé peut mélanger l'historique dans les statistiques par type (regroupées sous le nom actuel).
          const utilisee = utilisations[c.id] ?? 0;
          if (utilisee > 0 && libelle.value.trim() !== c.libelle) {
            const ok = await confirmer({
              titre: 'Renommer une prestation déjà utilisée ?',
              texte: [
                `« ${c.libelle} » est utilisée dans ${pluriel(utilisee, 'prestation')}. Les prestations déjà saisies gardent leur nom, mais les futures statistiques par type de prestation regrouperont ces séances sous le nouveau nom.`,
                "Pour une prestation différente, ajoutez-en une nouvelle plutôt que de renommer celle-ci : l'historique ne sera pas mélangé.",
              ],
              libelleConfirmer: 'Renommer quand même',
            });
            if (!ok) return;
          }
          enregistrer.setAttribute('aria-busy', 'true');
          try {
            await appeler('PATCH', `/api/catalogue/${encodeURIComponent(c.id)}`, { libelle: libelle.value, tarifCentimes: t.centimes, categorie: categorie.value, actif: actif.checked });
            await recharger();
            afficherToast({ texte: "Prestation enregistrée. Le nouveau tarif s'applique aux prochaines saisies ; l'historique ne change pas." });
          } catch (err) {
            montrerErreur(messageErreur(err));
          } finally {
            enregistrer.removeAttribute('aria-busy');
          }
        },
      },
    });
    const rangee = el(
      'tr',
      { classe: c.actif ? '' : 'ligne--inactive' },
      el('td', { classe: 'col-libelle-tarif' }, libelle, c.actif ? null : el('span', { classe: 'badge', texte: 'Désactivée' }), erreur),
      el('td', {}, categorie),
      el('td', { classe: 'col-tarif' }, entreeTarif),
      el('td', {}, el('label', { classe: 'case' }, actif, el('span', { texte: 'Active' }))),
      el('td', { classe: 'col-action' }, enregistrer),
    );
    validerParEntree(rangee, enregistrer); // Entrée dans le nom ou le tarif = « Enregistrer » de la ligne
    return rangee;
  }

  // État vide : un catalogue neuf ne contient aucune prestation ; le message remplace le tableau et le formulaire d'ajout est mis en avant.
  const videTitre = el('p', { classe: 'etat-vide__titre' });
  const videTexte = el('p', { classe: 'etat-vide__texte' });
  const etatVide = el('div', { classe: 'etat-vide', attributs: { hidden: true, 'data-tarifs-vide': 'oui', role: 'status' } }, videTitre, videTexte);
  const tableau = el(
    'div',
    { classe: 'table-wrap', attributs: { role: 'region', 'aria-label': 'Catalogue des prestations', tabindex: '0' } },
    el(
      'table',
      { classe: 'table' },
      el('caption', { classe: 'sr-only', texte: 'Catalogue des prestations et tarifs' }),
      el('thead', {}, el('tr', {}, ...['Prestation', 'Catégorie', 'Tarif (€)', 'Active', 'Action'].map((t, i) => el('th', { attributs: { scope: 'col' }, classe: i === 0 ? 'col-libelle-tarif' : i === 2 ? 'col-tarif' : i === 4 ? 'col-action' : '', texte: t })))),
      corps,
    ),
  );
  const legendeAjout = el('legend', { texte: 'Ajouter une prestation' });

  function remplir() {
    corps.replaceChildren(...[...catalogue].sort((a, b) => a.ordre - b.ordre).map(ligne));
    const vide = messageTarifsVide(catalogue);
    etatVide.hidden = vide === null;
    videTitre.textContent = vide?.titre ?? '';
    videTexte.textContent = vide?.texte ?? '';
    tableau.hidden = catalogue.length === 0; // catalogue entièrement désactivé : le tableau reste affiché pour pouvoir réactiver
    legendeAjout.textContent = catalogue.length === 0 ? 'Ajouter votre première prestation' : 'Ajouter une prestation';
  }

  // Ajout
  const champLibelle = creerChamp({ label: 'Nom de la prestation', requis: true, large: true, creerEntree: (id) => el('input', { classe: 'input', attributs: { id, type: 'text', maxlength: '120', autocomplete: 'off', name: 'libelle', disabled: !ecriture } }) });
  const champCategorie = creerChamp({ label: 'Catégorie', creerEntree: (id) => selectCategorie(CATEGORIE_PAR_DEFAUT, id, 'categorie') });
  const champTarif = creerChamp({ label: 'Tarif (€)', requis: true, creerEntree: (id) => creerEntreeMontant(id) });
  champCategorie.saisie.disabled = !ecriture;
  champTarif.saisie.disabled = !ecriture;
  const ajouter = el('button', { classe: 'btn btn--primaire', texte: 'Ajouter la prestation', attributs: { type: 'button', disabled: !ecriture } });
  ajouter.addEventListener('click', async () => {
    for (const c of [champLibelle, champTarif]) c.effacerErreur();
    const t = lireMontant(champTarif.saisie.value);
    if (!t.ok) {
      champTarif.erreur(MESSAGE_TARIF);
      return champTarif.saisie.focus();
    }
    ajouter.setAttribute('aria-busy', 'true');
    try {
      await appeler('POST', '/api/catalogue', { libelle: champLibelle.saisie.value, tarifCentimes: t.centimes, categorie: champCategorie.saisie.value });
      champLibelle.saisie.value = '';
      champTarif.saisie.value = '';
      await recharger();
      afficherToast({ texte: 'Prestation ajoutée au catalogue.' });
    } catch (err) {
      const champs = err instanceof ErreurApi ? (err.champs ?? {}) : {};
      if (champs.libelle) champLibelle.erreur(champs.libelle);
      if (champs.tarifCentimes) champTarif.erreur(champs.tarifCentimes);
      if (!champs.libelle && !champs.tarifCentimes) afficherToast({ texte: messageErreur(err), variante: 'erreur' });
    } finally {
      ajouter.removeAttribute('aria-busy');
    }
  });

  const groupeAjout = el('fieldset', { classe: 'groupe' }, legendeAjout, el('div', { classe: 'formulaire-grille' }, champLibelle.racine, champCategorie.racine, champTarif.racine), el('div', { classe: 'groupe-horizontal' }, ajouter));
  validerParEntree(groupeAjout, ajouter); // Entrée dans le nom ou le tarif = « Ajouter la prestation »

  remplir();

  return el(
    'section',
    { classe: 'carte section-param', attributs: { id: 'tarifs', 'aria-labelledby': 'titre-tarifs' } },
    el('div', { classe: 'carte__entete' }, el('h2', { classe: 'carte__titre', texte: 'Tarifs', attributs: { id: 'titre-tarifs' } })),
    el('div', { classe: 'pile' },
      el('p', { texte: "Un nouveau tarif ne s'applique qu'aux prestations saisies ensuite. L'historique ne change pas." }),
      el('p', { classe: 'champ__aide', texte: 'Une prestation déjà utilisée ne se supprime pas : décochez « Active » pour ne plus la proposer à la saisie. Elle reste dans l\'historique.' }),
      el('p', { classe: 'champ__aide', texte: 'Catégorie : les séances sont comptées dans le nombre de séances ; les bilans et les autres prestations sont comptés à part.' }),
      ecriture ? null : el('p', { classe: 'champ__aide', texte: 'Les tarifs ne peuvent pas être modifiés tant que le fichier de données est en lecture seule ou en conflit.' }),
      etatVide,
      tableau,
      groupeAjout,
    ),
  );
}

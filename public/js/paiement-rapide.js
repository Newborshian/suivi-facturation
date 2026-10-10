// Groupe de boutons « Payer » (design system §5.14) : un bouton par mode, un clic enregistre le reste à payer avec ce mode.
// Même HTML à toutes les largeurs : la variante compacte (≤ 768 px) est choisie par le CSS seul ; ici on gère le clic, aria-expanded,
// Échap, le focus et l'état « en cours » (aria-busy + boutons désactivés : un seul versement par clic).
import { el } from './dom.js';
import { iconeMode } from './icones-paiement.js';
import { LIBELLES_MODE } from './format.js';
import { MODES, modeConnu, nomBoutonPaiement, nomChangementMode, nomDeclencheurChangementMode, nomDeclencheurPaiement, nomGroupeChangementMode, nomGroupePaiement, titreBoutonPaiement } from './paiement-libelles.js';

/**
 * Après un échec qui a fait reconstruire la page (conflit au clic, ligne déjà payée), le groupe cliqué n'existe plus et le focus est tombé sur `body` :
 * l'utilisateur au clavier repartirait du début de la page. Le focus est rendu, dans l'ordre : au bouton du même mode du nouveau groupe (s'il est utilisable),
 * au bouton « Versement » de la même ligne, puis au premier message du bandeau (il explique la situation ; un bouton désactivé ne peut pas recevoir le focus).
 */
export function refocaliserApresRechargement({ idGroupe, mode, ligneId }) {
  const utilisable = (noeud) => noeud && !noeud.disabled;
  const bouton = document.getElementById(idGroupe)?.querySelector(`[data-mode="${mode}"]`);
  if (utilisable(bouton)) return bouton.focus();
  const versement = ligneId ? [...document.querySelectorAll('button[data-versement]')].find((b) => b.getAttribute('data-versement') === ligneId) : null;
  if (utilisable(versement)) return versement.focus();
  const message = document.querySelector('#bandeaux [role="alert"], #bandeaux [role="status"]');
  if (message) {
    message.setAttribute('tabindex', '-1');
    message.focus();
  }
}

/**
 * Construit le groupe. `boutons` : [{ mode, nom, titre, recent?, actuel? }] dans l'ordre fixe ; `auChoix(mode)` : promesse (l'enregistrement).
 * `declencheur` : { texte, nom } ; `titre` : mot visible « Payer » (absent pour le changement de mode d'un versement).
 * `desactive` : lecture seule, conflit ou mode dégradé -> boutons désactivés, avec l'explication (infobulle et aria-describedby).
 */
function groupe({ id, ligneId = null, nom, titre, declencheur, boutons, desactive, explication, raisonId, auChoix }) {
  const acces = desactive ? { disabled: true, title: explication, 'aria-describedby': raisonId } : {};
  let racine;
  let bascule;
  let modes;

  const ouvrir = (ouvert) => {
    bascule.setAttribute('aria-expanded', String(ouvert));
    // Variante compacte : les cinq modes dépliés (252 px) peuvent dépasser la largeur du tableau, qui défile alors dans son cadre ; on les amène à l'écran.
    if (ouvert) modes?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  const estOuvert = () => bascule.getAttribute('aria-expanded') === 'true';

  async function choisir(bouton, mode) {
    ouvrir(false);
    const tous = [...racine.querySelectorAll('button')];
    racine.setAttribute('aria-busy', 'true');
    for (const b of tous) b.disabled = true;
    try {
      await auChoix(mode);
    } finally {
      if (racine.isConnected) {
        racine.removeAttribute('aria-busy');
        if (!desactive) for (const b of tous) b.disabled = false;
        if (document.activeElement === document.body) bouton.focus(); // échec : le focus ne reste pas perdu sur la page
      } else if (document.activeElement === document.body) {
        refocaliserApresRechargement({ idGroupe: id, mode, ligneId }); // la page a été reconstruite (conflit, ligne déjà payée…)
      }
    }
  }

  modes = el(
    'span',
    { classe: 'paiement-rapide__modes', attributs: { id } },
    ...boutons.map((b) =>
      el(
        'button',
        {
          classe: 'btn btn--petit paiement-rapide__mode',
          attributs: { type: 'button', 'data-mode': b.mode, 'data-recent': b.recent ? 'oui' : null, 'aria-pressed': b.actuel === undefined ? null : String(b.actuel), title: b.titre, 'aria-label': b.nom, ...acces },
          evenements: { click: (evenement) => (b.actuel ? undefined : choisir(evenement.currentTarget, b.mode)) }, // le mode déjà actif : rien à faire
        },
        iconeMode(b.mode),
      ),
    ),
  );
  bascule = el('button', {
    classe: 'btn btn--petit btn--secondaire paiement-rapide__declencheur',
    texte: declencheur.texte,
    attributs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': declencheur.nom, ...acces },
    evenements: { click: () => ouvrir(!estOuvert()) },
  });
  racine = el('div', { classe: 'paiement-rapide', attributs: { role: 'group', 'aria-label': nom } }, titre ? el('span', { classe: 'paiement-rapide__titre', texte: titre, attributs: { 'aria-hidden': 'true' } }) : null, bascule, modes);

  racine.addEventListener('keydown', (evenement) => {
    if (evenement.key !== 'Escape' || !estOuvert()) return;
    evenement.preventDefault(); // ne ferme pas aussi le dialogue qui contiendrait le groupe
    evenement.stopPropagation();
    ouvrir(false);
    bascule.focus();
  });
  racine.addEventListener('focusout', (evenement) => {
    if (!racine.contains(evenement.relatedTarget)) ouvrir(false); // le focus quitte le groupe : il se referme
  });
  return racine;
}

/**
 * Groupe « Payer » d'une ligne qui a un reste à payer.
 * `ligne` : { id, date, patient (texte affiché), resteCentimes } ; `dernierMode` : mode mis en évidence (jamais appliqué sans clic) ou null.
 */
export function paiementRapide({ ligne, dernierMode, desactive, explication, raisonId, auChoix }) {
  return groupe({
    id: `paiement-rapide-${ligne.id}`,
    ligneId: ligne.id,
    nom: nomGroupePaiement(ligne),
    titre: 'Payer',
    declencheur: { texte: 'Payer', nom: nomDeclencheurPaiement(ligne) },
    boutons: MODES.map((mode) => {
      const recent = mode === dernierMode;
      return { mode, recent, nom: nomBoutonPaiement(ligne, mode, recent), titre: titreBoutonPaiement(mode, recent) };
    }),
    desactive,
    explication,
    raisonId,
    auChoix,
  });
}

/** Changement direct du mode d'un versement existant : mêmes boutons, `aria-pressed` sur le mode actuel. `versement` : { id, date, mode }. */
export function changerModeVersement({ versement, desactive, explication, auChoix }) {
  const actuel = modeConnu(versement.mode) ? versement.mode : 'autre';
  return groupe({
    id: `mode-versement-${versement.id}`,
    nom: nomGroupeChangementMode(versement.date),
    titre: null,
    declencheur: { texte: LIBELLES_MODE[actuel], nom: nomDeclencheurChangementMode(versement.date, actuel) },
    boutons: MODES.map((mode) => ({ mode, actuel: mode === actuel, nom: nomChangementMode(versement.date, mode), titre: LIBELLES_MODE[mode] })),
    desactive,
    explication,
    auChoix,
  });
}

/** Après un paiement, la ligne est reconstruite : le focus passe au bouton « Versement » de la même ligne (il existe toujours). */
export function focaliserVersement(conteneur, idLigne) {
  for (const b of conteneur.querySelectorAll('button[data-versement]')) {
    if (b.getAttribute('data-versement') === idLigne) {
      b.focus();
      return;
    }
  }
}

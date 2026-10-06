// Bandeaux d'état communs à toutes les pages (mode dégradé, lecture seule, conflit, sauvegarde en échec…).
import { ouvrirDialogueConflit } from '/js/conflit.js';
import { el, remplacer } from '/js/dom.js';
import { formatInstant } from '/js/format.js';

/** `actions` : nœuds (boutons, liens) affichés sous le texte. */
export function alerte(variante, titre, texte, role, actions = []) {
  const classe = variante ? `alerte alerte--${variante}` : 'alerte';
  return el(
    'div',
    { classe, attributs: { role } },
    el('div', { classe: 'alerte__corps' }, el('strong', { classe: 'alerte__titre', texte: titre }), el('p', { classe: 'alerte__texte', texte }), actions.length > 0 ? el('div', { classe: 'alerte__actions' }, ...actions) : null),
  );
}

export function bandeauxDepuisEtat(etat) {
  const liste = [];
  if (etat.demonstration === true) liste.push(alerte('exemple', "Données d'exemple", "Démonstration : rien de ce que vous saisissez n'est conservé.", 'status'));
  if (etat.modeDegrade) liste.push(alerte('danger', 'Erreur', `${etat.erreur.message}`, 'alert'));
  if (etat.lectureSeule) {
    const suite = etat.structureInconnue ? " Son contenu n'est pas reconnu par cette version : il ne peut pas être affiché, mais il est conservé tel quel." : '';
    liste.push(alerte('attention', 'Lecture seule', `Ce fichier a été créé par une version plus récente de l'application : aucune modification n'est possible.${suite}`, 'alert'));
  }
  if (etat.conflit) {
    const disparu = etat.conflit.type === 'disparu';
    liste.push(
      alerte(
        'danger',
        'Les données ont été modifiées ailleurs',
        `${disparu ? "Le fichier de données n'est plus dans son dossier." : 'Le fichier de données a été remplacé pendant que l\'application était ouverte (synchronisation ?).'} Vos saisies ne sont pas enregistrées tant que vous n'avez pas choisi la version à garder. Aucune version n'a été supprimée.`,
        'alert',
        [el('button', { classe: 'btn btn--secondaire', texte: 'Choisir la version à garder', attributs: { type: 'button' }, evenements: { click: () => ouvrirDialogueConflit(etat) } })],
      ),
    );
  }
  if (!etat.conflit && etat.conflitNonResolu) {
    liste.push(
      alerte(
        'attention',
        "Un conflit de synchronisation n'a pas été résolu",
        `Le ${formatInstant(etat.conflitNonResolu.detecteLe)}, le fichier de données a été remplacé pendant que l'application était ouverte. Les deux versions ont été conservées dans les sauvegardes ; vous utilisez actuellement la version du disque.`,
        'status',
        [el('button', { classe: 'btn btn--secondaire', texte: 'Choisir la version à garder', attributs: { type: 'button' }, evenements: { click: () => ouvrirDialogueConflit(etat) } })],
      ),
    );
  }
  for (const a of etat.avertissements ?? []) {
    const actions = a.code === 'SAUVEGARDE_ECHOUEE' ? [el('a', { classe: 'btn btn--secondaire', texte: 'Voir les sauvegardes', attributs: { href: '/parametres.html#sauvegardes' } })] : [];
    liste.push(alerte('attention', 'Attention', a.message, 'status', actions));
  }
  return liste;
}

export function afficherBandeaux(conteneur, etat) {
  remplacer(conteneur, ...bandeauxDepuisEtat(etat));
}

// Restauration d'une sauvegarde : tableau de la liste, confirmation avec aperçu, appel de l'API.
// Utilisé par Paramètres (liste complète), par l'écran « fichier illisible ou absent » et par le dialogue de conflit.
import { appeler } from '/js/api.js';
import { el } from '/js/dom.js';
import { LIBELLES_RAISON, formatDate, formatDateHeure, formatInstant, formatTaille, pluriel } from '/js/format.js';
import { confirmer } from '/js/ui.js';

export const chargerSauvegardes = async () => (await appeler('GET', '/api/sauvegardes')).sauvegardes;

export const dateSauvegarde = (s) => formatDateHeure(s.jour, s.heure);

/** Tableau des sauvegardes, la plus récente en premier. `surRestaurer(sauvegarde)` est appelé au clic ; `desactive` grise tous les boutons. */
export function tableauSauvegardes(sauvegardes, { surRestaurer, desactive = false, legende = 'Sauvegardes disponibles' }) {
  const lignes = [...sauvegardes].reverse().map((s) => {
    const restaurable = s.restaurable === true;
    const prestations = restaurable
      ? el('td', { classe: 'col-nombre', texte: String(s.nombrePrestations) })
      : el('td', { classe: 'col-nombre' }, el('span', { classe: 'badge badge--attention', texte: 'Illisible' }), el('div', { classe: 'cellule-double__secondaire', texte: s.raisonRefus || 'Ne peut pas être restaurée' }));
    return el(
      'tr',
      { classe: restaurable ? '' : 'ligne--inactive' },
      el('th', { attributs: { scope: 'row' }, texte: dateSauvegarde(s) }),
      el('td', { texte: LIBELLES_RAISON[s.raison] ?? s.raison }),
      prestations,
      el('td', { classe: 'col-nombre', texte: formatTaille(s.tailleOctets) }),
      el(
        'td',
        { classe: 'col-action' },
        el('button', {
          classe: 'btn btn--secondaire btn--petit',
          texte: 'Restaurer',
          attributs: { type: 'button', 'aria-label': `Restaurer la sauvegarde du ${dateSauvegarde(s)}`, disabled: !restaurable || desactive },
          evenements: { click: () => surRestaurer(s) },
        }),
      ),
    );
  });
  return el(
    'div',
    { classe: 'table-wrap table-wrap--haut', attributs: { role: 'region', 'aria-label': legende, tabindex: '0' } },
    el(
      'table',
      { classe: 'table table--dense' },
      el('caption', { classe: 'sr-only', texte: legende }),
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ...['Date', 'Raison', 'Prestations', 'Taille', 'Action'].map((t, i) => el('th', { attributs: { scope: 'col' }, classe: i === 2 || i === 3 ? 'col-nombre' : i === 4 ? 'col-action' : '', texte: t })),
        ),
      ),
      el('tbody', {}, ...lignes),
    ),
  );
}

/** Phrase qui dit ce qu'il advient de l'état actuel (il est toujours sauvegardé avant d'être remplacé). */
export function texteEtatActuel(etat) {
  if (etat.modeDegrade) {
    if (etat.erreur?.raison === 'absent') return "Il n'y a plus de fichier de données : cette sauvegarde le remplacera.";
    if (etat.erreur?.raison === 'lecture') return "Le fichier actuel n'a pas pu être lu. L'application essaiera d'en garder une copie ; si elle n'y arrive pas, la restauration sera annulée et rien ne sera modifié.";
    if (etat.erreur?.raison === 'migration') return "Le fichier actuel est intact mais n'a pas pu être mis à jour : une copie en sera conservée à part avant la restauration, et la restauration le remplacera.";
    return "Le fichier actuel est abîmé : une copie en sera conservée à part avant la restauration.";
  }
  if (etat.lectureSeule) return "Le fichier actuel vient d'une version plus récente de l'application : il sera mis de côté avant la restauration. Vous ne pourrez pas y revenir depuis cette version de l'application.";
  if (etat.conflit) return "Le fichier actuellement sur le disque sera sauvegardé avant la restauration, ainsi que la version de l'application si elle ne l'est pas déjà.";
  return `L'état actuel (${pluriel(etat.nombrePrestations ?? 0, 'prestation')}) sera sauvegardé avant la restauration. Vous pourrez annuler.`;
}

/**
 * Confirmation avec aperçu (date, raison, révision, nombre de prestations, période) ; focus initial sur « Annuler ».
 * La raison et la révision distinguent les deux versions d'un conflit, créées dans la même seconde. -> Promise<boolean>
 */
export function confirmerRestauration(sauvegarde, texteActuel) {
  const periode = sauvegarde.premiereDate ? `, du ${formatDate(sauvegarde.premiereDate)} au ${formatDate(sauvegarde.derniereDate)}` : '';
  const identite = [LIBELLES_RAISON[sauvegarde.raison] ?? sauvegarde.raison, Number.isInteger(sauvegarde.revision) ? `révision ${sauvegarde.revision}` : null, sauvegarde.majLe ? `dernière modification le ${formatInstant(sauvegarde.majLe)}` : null].filter(Boolean).join(', ');
  return confirmer({
    titre: `Restaurer la sauvegarde du ${dateSauvegarde(sauvegarde)} ?`,
    texte: [`${identite}.`, `Elle contient ${pluriel(sauvegarde.nombrePrestations, 'prestation')}${periode}.`, texteActuel],
    libelleConfirmer: 'Restaurer',
  });
}

/**
 * Restaure (la confirmation a déjà été donnée). -> { restauree, sauvegardeAvant, sauvegardeApplication, annulable, nombrePrestations }
 * `depuisModeDegrade` : décision prise sur l'écran « fichier absent / illisible » ; le serveur refuse (FICHIER_REVENU) si le fichier est revenu.
 */
export async function restaurerSauvegarde(nom, { depuisModeDegrade = false } = {}) {
  const corps = depuisModeDegrade ? { confirmer: true, depuisModeDegrade: true } : { confirmer: true };
  return (await appeler('POST', `/api/sauvegardes/${encodeURIComponent(nom)}/restaurer`, corps)).donnees;
}

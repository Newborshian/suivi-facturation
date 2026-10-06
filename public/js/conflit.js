// Dialogue « Les données ont été modifiées ailleurs » (niveau minimal : la restauration d'une sauvegarde est l'issue proposée).
// Les deux versions ont déjà été sauvegardées par le serveur (conflit-disque, conflit-memoire) : choisir une version revient à
// restaurer la sauvegarde correspondante. Aucune des deux n'est présentée comme la bonne, aucune fusion.
import { ErreurApi } from '/js/api.js';
import { el } from '/js/dom.js';
import { formatInstant, pluriel } from '/js/format.js';
import { restaurerSauvegarde } from '/js/restauration.js';
import { afficherToast, confirmer, creerDialogue } from '/js/ui.js';

function carte({ titre, version, nomSauvegarde, libelleBouton, phrase, ouvrir }) {
  const lisible = version && version.lisible !== false;
  const chiffres = lisible
    ? [el('p', { classe: 'conflit__chiffre', texte: pluriel(version.nombrePrestations ?? 0, 'prestation') }), version.majLe ? el('p', { texte: `Modifiée le ${formatInstant(version.majLe)}` }) : null, version.revision !== null && version.revision !== undefined ? el('p', { texte: `Révision ${version.revision}` }) : null]
    : [el('p', { classe: 'conflit__chiffre', texte: version ? 'Illisible' : 'Absente' }), el('p', { texte: version ? 'Ce fichier ne peut pas être lu.' : 'Le fichier a disparu du dossier de données.' })];
  const possible = lisible && Boolean(nomSauvegarde);
  return el(
    'div',
    { classe: 'conflit__version' },
    el('p', { classe: 'conflit__version-titre', texte: titre }),
    ...chiffres,
    el('button', {
      classe: 'btn btn--secondaire',
      texte: libelleBouton,
      attributs: { type: 'button', disabled: !possible },
      evenements: { click: () => ouvrir({ nomSauvegarde, phrase }) },
    }),
  );
}

/**
 * Ouvre le dialogue de choix. `apres()` est appelé après une restauration réussie (recharger la page).
 * Sert aussi au rappel d'un conflit non résolu au démarrage (`etat.conflitNonResolu`).
 */
export function ouvrirDialogueConflit(etat, { apres = () => location.reload() } = {}) {
  const c = etat.conflit ?? etat.conflitNonResolu;
  const rappel = !etat.conflit;
  const d = creerDialogue({ titre: 'Les données ont été modifiées ailleurs', large: true });
  const zoneErreur = el('div', {});
  const choisir = async ({ nomSauvegarde, phrase }) => {
    const ok = await confirmer({ titre: 'Garder cette version ?', texte: phrase, libelleConfirmer: 'Oui, garder cette version' });
    if (!ok) return;
    try {
      await restaurerSauvegarde(nomSauvegarde);
      d.fermer();
      afficherToast({ texte: 'Version rétablie. La page va se recharger.' });
      apres();
    } catch (err) {
      const message = err instanceof ErreurApi ? err.message : "La restauration a échoué. Rien n'a été modifié.";
      zoneErreur.replaceChildren(
        el('div', { classe: 'alerte alerte--danger', attributs: { role: 'alert' } }, el('div', { classe: 'alerte__corps' }, el('strong', { classe: 'alerte__titre', texte: 'Erreur' }), el('p', { classe: 'alerte__texte', texte: message }))),
      );
    }
  };
  d.corps.append(
    el(
      'div',
      { classe: 'conflit' },
      el('p', {
        texte: rappel
          ? `Un conflit de synchronisation détecté le ${formatInstant(c.detecteLe)} n'a pas été résolu : le fichier de données avait été remplacé pendant que l'application était ouverte. L'application utilise actuellement le fichier du disque ; si vous gardez la version de l'application, ce que vous avez saisi depuis sera remplacé (une copie reste dans les sauvegardes).`
          : "Le fichier de données ne correspond plus à ce que l'application avait chargé. Cela arrive si la synchronisation (Proton Drive) a remplacé le fichier.",
      }),
      el('p', { texte: "Aucune des deux versions n'a été supprimée : elles ont été sauvegardées. Choisissez celle à garder ; l'autre restera dans les sauvegardes." }),
      el(
        'div',
        { classe: 'conflit__versions' },
        carte({
          titre: 'Version sur le disque',
          version: c.disque,
          nomSauvegarde: c.sauvegardes?.disque,
          libelleBouton: 'Garder la version du disque',
          phrase: c.sauvegardes?.application
            ? "Vous gardez la version du disque. La version de l'application reste dans les sauvegardes."
            : "Vous gardez la version du disque. L'application va d'abord mettre de côté sa propre version ; si cette copie est impossible, la restauration est annulée et rien n'est modifié.",
          ouvrir: choisir,
        }),
        carte({
          titre: "Version de l'application",
          version: c.application,
          nomSauvegarde: c.sauvegardes?.application,
          libelleBouton: 'Garder ma version',
          phrase: 'Vous gardez la version de l\'application (celle que vous utilisiez). La version du disque reste dans les sauvegardes.',
          ouvrir: choisir,
        }),
      ),
      zoneErreur,
      el('p', {}, el('a', { texte: 'Voir toutes les sauvegardes', attributs: { href: '/parametres.html#sauvegardes' } })),
    ),
  );
  const fermer = el('button', { classe: 'btn btn--secondaire', texte: 'Fermer', attributs: { type: 'button' }, evenements: { click: () => d.fermer() } });
  d.pied.append(fermer);
  const titre = d.dialogue.querySelector('.dialogue__titre');
  titre.setAttribute('tabindex', '-1');
  d.ouvrir(titre);
}

// Écran affiché à la place du contenu quand le fichier de données est illisible, absent ou occupé (mode dégradé) :
// la restauration d'une sauvegarde est la sortie (le fichier actuel est conservé). Le fichier actuel n'est jamais écrasé sans copie préalable.
// Le fichier est relu à chaque affichage, au clic sur « Réessayer » et juste avant (puis au moment) de restaurer : s'il est revenu
// lisible (synchronisation terminée), on le dit et on propose de le reprendre au lieu de l'écraser.
import { ErreurApi, appeler, lireEtat } from '/js/api.js';
import { alerte } from '/js/bandeaux.js';
import { el, remplacer } from '/js/dom.js';
import { pluriel } from '/js/format.js';
import { chargerSauvegardes, confirmerRestauration, restaurerSauvegarde, tableauSauvegardes, texteEtatActuel } from '/js/restauration.js';
import { confirmer } from '/js/ui.js';

const INTRODUCTIONS = {
  absent: "Le fichier de données est introuvable. Si vous venez de changer d'ordinateur, la synchronisation n'est peut-être pas terminée : cliquez sur « Réessayer » pour relire le fichier. Sinon, choisissez ci-dessous la sauvegarde à remettre en place.",
  lecture: "Le fichier est peut-être utilisé par un autre programme (synchronisation, antivirus). Attendez un instant puis cliquez sur « Réessayer ». Vous pouvez aussi restaurer une sauvegarde ci-dessous.",
};
const INTRODUCTION_DEFAUT = "Le fichier est peut-être en cours de synchronisation : cliquez sur « Réessayer » pour le relire. Sinon, choisissez la sauvegarde à remettre en place ; le fichier abîmé est conservé à part avant la restauration : rien n'est supprimé.";

/** Donne le focus à un message qui vient d'apparaître (le déclencheur a disparu avec le contenu précédent). */
function mettreEnAvant(noeud) {
  noeud.setAttribute('tabindex', '-1');
  noeud.focus();
}

/** Remplace `zone` par la liste des sauvegardes restaurables. `etat` = réponse de GET /api/etat (mode dégradé). */
export async function afficherEcranDegrade(zone, etat) {
  const contenu = el('div', { classe: 'ecran-bloquant' });
  remplacer(zone, contenu);
  const intro = el('p', { texte: INTRODUCTIONS[etat.erreur?.raison] ?? INTRODUCTION_DEFAUT });
  const zoneStatut = el('div', { attributs: { role: 'status' } });
  const zoneErreur = el('div', {});
  const zoneListe = el('div', {}, el('p', { classe: 'chargement', attributs: { role: 'status' }, texte: 'Chargement des sauvegardes…' }));
  const zoneVide = el('div', {});
  const reessayer = el('button', { classe: 'btn btn--secondaire', texte: 'Réessayer la lecture du fichier', attributs: { type: 'button' } });
  remplacer(contenu, el('h2', { texte: 'Restaurer une sauvegarde' }), intro, el('div', {}, reessayer), zoneStatut, zoneErreur, zoneListe, zoneVide);

  const finir = (titre, texte) => {
    document.getElementById('bandeaux')?.replaceChildren(); // le bandeau d'erreur n'a plus lieu d'être
    const message = alerte('succes', titre, texte, 'status');
    remplacer(contenu, message, el('div', {}, el('button', { classe: 'btn btn--primaire', texte: "Ouvrir l'application", attributs: { type: 'button' }, evenements: { click: () => location.reload() } })));
    mettreEnAvant(message);
  };
  const revenu = (texte = "Il est de nouveau lisible (la synchronisation est terminée). L'application l'a repris tel quel : aucune sauvegarde n'a été restaurée et rien n'a été remplacé.") => finir('Le fichier de données est revenu', texte);

  /** Relit le fichier côté serveur (GET /api/etat). Revenu lisible : le dit et propose de le reprendre. -> l'état frais, ou null s'il est revenu. */
  const relire = async () => {
    const frais = await lireEtat();
    if (frais.modeDegrade) return frais;
    revenu();
    return null;
  };

  reessayer.addEventListener('click', async () => {
    zoneErreur.replaceChildren();
    zoneStatut.replaceChildren();
    try {
      const frais = await relire();
      if (frais) zoneStatut.append(el('p', { texte: 'Le fichier de données n\'est toujours pas lisible. Réessayez dans quelques instants, ou choisissez une sauvegarde.' }));
    } catch (err) {
      zoneErreur.replaceChildren(alerte('danger', 'Erreur', err instanceof ErreurApi ? err.message : 'La lecture a échoué.', 'alert'));
    }
  });

  const apresRestauration = (r) => {
    const copie = r.sauvegardeAvant
      ? "Une copie du fichier précédent a été conservée à part (Paramètres › Sauvegardes, raison « Avant une restauration »)."
      : "Il n'y avait pas de fichier précédent à conserver.";
    finir('Sauvegarde restaurée', `Vos données sont de retour (${pluriel(r.nombrePrestations, 'prestation')}). ${copie}`);
  };

  const surRestaurer = async (s) => {
    zoneErreur.replaceChildren();
    try {
      const frais = await relire(); // avant d'afficher le choix
      if (!frais) return;
      if (!(await confirmerRestauration(s, texteEtatActuel(frais)))) return;
      apresRestauration(await restaurerSauvegarde(s.nom, { depuisModeDegrade: true })); // le serveur relit encore au moment d'écrire
    } catch (err) {
      if (err instanceof ErreurApi && err.code === 'FICHIER_REVENU') {
        revenu(err.message);
        return;
      }
      zoneErreur.replaceChildren(alerte('danger', 'Erreur', err instanceof ErreurApi ? err.message : "La restauration a échoué. Rien n'a été modifié.", 'alert'));
    }
  };

  // En dernier recours, seulement quand aucune sauvegarde n'est restaurable (et que le fichier est absent ou abîmé).
  const proposerFichierVide = () => {
    if (etat.erreur?.raison !== 'absent' && etat.erreur?.raison !== 'illisible') return;
    const bouton = el('button', { classe: 'btn btn--danger', texte: "Repartir d'un fichier vide", attributs: { type: 'button' } });
    bouton.addEventListener('click', async () => {
      zoneErreur.replaceChildren();
      try {
        const frais = await relire();
        if (!frais) return;
        const abime = frais.erreur?.raison === 'illisible';
        const ok = await confirmer({
          titre: "Repartir d'un fichier vide ?",
          texte: [
            "Aucune sauvegarde ne peut être restaurée. L'application va créer un nouveau fichier de données vide, avec un catalogue de prestations vide (à redéfinir dans Paramètres → Tarifs). Les prestations enregistrées avant ne seront pas dans ce nouveau fichier.",
            abime ? "Le fichier actuel (abîmé) est d'abord copié à part ; si cette copie est impossible, rien n'est fait." : "Il n'y a pas de fichier actuel à conserver.",
            'Cette action ne peut pas être annulée depuis l\'application.',
          ],
          libelleConfirmer: "Oui, repartir d'un fichier vide",
          danger: true,
        });
        if (!ok) return;
        const r = (await appeler('POST', '/api/fichier-vide', { confirmer: true })).donnees;
        finir('Nouveau fichier créé', `Le fichier de données est vide. ${r.sauvegardeAvant ? "Une copie du fichier précédent a été conservée à part (Paramètres › Sauvegardes, raison « Avant un fichier vide »)." : "Il n'y avait pas de fichier précédent à conserver."}`);
      } catch (err) {
        if (err instanceof ErreurApi && err.code === 'FICHIER_REVENU') return revenu(err.message);
        zoneErreur.replaceChildren(alerte('danger', 'Erreur', err instanceof ErreurApi ? err.message : "L'opération a échoué. Rien n'a été modifié.", 'alert'));
      }
    });
    zoneVide.replaceChildren(
      el('h3', { texte: "Dernier recours : repartir d'un fichier vide" }),
      el('p', { texte: "Aucune sauvegarde ne peut être restaurée. Vous pouvez créer un nouveau fichier de données vide ; le fichier actuel, s'il existe, est conservé à part avant." }),
      el('div', {}, bouton),
    );
  };

  try {
    const sauvegardes = await chargerSauvegardes();
    if (sauvegardes.length === 0) {
      zoneListe.replaceChildren(
        el(
          'div',
          { classe: 'etat-vide' },
          el('p', { classe: 'etat-vide__titre', texte: 'Aucune sauvegarde disponible' }),
          el('p', { classe: 'etat-vide__texte', texte: `Il n'y a pas de sauvegarde dans le dossier de données (${etat.dossier}). Si les fichiers sont synchronisés depuis un autre ordinateur, attendez la fin de la synchronisation puis cliquez sur « Réessayer ».` }),
        ),
      );
    } else {
      zoneListe.replaceChildren(tableauSauvegardes(sauvegardes, { surRestaurer }));
    }
    if (!sauvegardes.some((s) => s.restaurable)) proposerFichierVide();
  } catch (err) {
    zoneListe.replaceChildren(alerte('danger', 'Erreur', err instanceof ErreurApi ? err.message : 'La liste des sauvegardes ne peut pas être affichée.', 'alert'));
  }
}

// Écran « Paramètres » : tarifs, sauvegardes et restauration, export, dossier de données (lecture seule), apparence.
// Le serveur calcule et décide ; ici on affiche. Aucune donnée nominative dans l'URL ni dans le stockage du navigateur.
import { ErreurApi, appeler, lireEtat, telecharger } from '/js/api.js';
import { afficherBandeaux, alerte } from '/js/bandeaux.js';
import { el, remplacer } from '/js/dom.js';
import { afficherEcranDegrade } from '/js/ecran-degrade.js';
import { ecritureAutorisee } from '/js/ecriture.js';
import { validerParEntree } from '/js/entree.js';
import { LIBELLES_RAISON, formatTaille, pluriel } from '/js/format.js';
import { sectionTarifs } from '/js/pages/parametres-tarifs.js';
import { arreterPresence } from '/js/presence.js';
import { chargerSauvegardes, confirmerRestauration, dateSauvegarde, restaurerSauvegarde, tableauSauvegardes, texteEtatActuel } from '/js/restauration.js';
import { choisirTheme, lireTheme } from '/js/theme.js';
import { afficherToast, confirmer, creerChamp } from '/js/ui.js';

const zone = {};
const page = { etat: null, arretee: false };

const messageErreur = (err) => (err instanceof ErreurApi ? (err.champs ? Object.values(err.champs)[0] : err.message) : "Une erreur est survenue. Rien n'a été modifié.");
const erreurToast = (err) => afficherToast({ texte: messageErreur(err), variante: 'erreur' });

function enregistrerFichier({ blob, nom }) {
  const url = URL.createObjectURL(blob);
  const lien = el('a', { attributs: { href: url, download: nom } });
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function section(id, titre, ...contenu) {
  return el('section', { classe: 'carte section-param', attributs: { id, 'aria-labelledby': `titre-${id}` } }, el('div', { classe: 'carte__entete' }, el('h2', { classe: 'carte__titre', texte: titre, attributs: { id: `titre-${id}` } })), el('div', { classe: 'pile' }, ...contenu));
}

// ------------------------------------------------------------ Sauvegardes

async function sectionSauvegardes(sauvegardes) {
  const { etat } = page;
  const ecriture = ecritureAutorisee(etat); // lecture seule, conflit : mêmes contrôles d'écriture désactivés que les tarifs
  const derniere = sauvegardes[sauvegardes.length - 1];

  const champNombre = creerChamp({
    label: "Nombre de jours d'historique à conserver",
    aide: "Les sauvegardes automatiques de la journée sont toutes gardées, puis la dernière de chacun des jours précédents. Les jours les plus anciens sont supprimés en premier. Entre 7 et 365.",
    creerEntree: (id) => el('input', { classe: 'input', attributs: { id, type: 'number', min: '7', max: '365', step: '1', inputmode: 'numeric', name: 'sauvegardesConservees', disabled: !ecriture }, proprietes: { value: String(etat.sauvegardesConservees ?? 30) } }),
  });
  const enregistrer = el('button', { classe: 'btn btn--secondaire', texte: 'Enregistrer', attributs: { type: 'button', disabled: !ecriture } });
  validerParEntree(champNombre.racine, enregistrer);
  enregistrer.addEventListener('click', async () => {
    champNombre.effacerErreur();
    const texte = champNombre.saisie.value.trim();
    const n = /^\d{1,4}$/.test(texte) ? Number(texte) : NaN;
    if (!Number.isInteger(n) || n < 7 || n > 365) {
      champNombre.erreur("Indiquez un nombre entier de jours d'historique à conserver, entre 7 et 365.");
      return champNombre.saisie.focus();
    }
    const joursActuels = new Set(sauvegardes.filter((s) => s.reserve === 'quotidienne').map((s) => s.jour)).size;
    if (n < joursActuels) {
      const ok = await confirmer({
        titre: "Conserver moins de jours d'historique ?",
        texte: [`Vos sauvegardes automatiques couvrent ${pluriel(joursActuels, 'jour')}. Avec ${n}, les plus anciennes seront supprimées à la prochaine sauvegarde.`],
        libelleConfirmer: "Conserver moins de jours d'historique",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await appeler('PATCH', '/api/parametres', { sauvegardesConservees: n });
      page.etat.sauvegardesConservees = n;
      afficherToast({ texte: `Les sauvegardes des ${n} derniers jours seront conservées.` });
    } catch (err) {
      champNombre.erreur(messageErreur(err));
    }
  });

  const maintenant = el('button', { classe: 'btn btn--primaire', texte: 'Sauvegarder maintenant', attributs: { type: 'button' } });
  maintenant.addEventListener('click', async () => {
    maintenant.setAttribute('aria-busy', 'true');
    try {
      await appeler('POST', '/api/sauvegardes');
      afficherToast({ texte: page.etat.conflit ? "Sauvegarde créée : copie du fichier actuellement sur le disque (pas de la version de l'application)." : 'Sauvegarde créée.' });
      await rendreSauvegardes();
    } catch (err) {
      erreurToast(err);
    } finally {
      maintenant.removeAttribute('aria-busy');
    }
  });

  const liste =
    sauvegardes.length === 0
      ? el('div', { classe: 'etat-vide' }, el('p', { classe: 'etat-vide__titre', texte: 'Aucune sauvegarde pour le moment' }), el('p', { classe: 'etat-vide__texte', texte: 'Une sauvegarde est créée automatiquement au démarrage et à la première modification de chaque jour.' }))
      : tableauSauvegardes(sauvegardes, { surRestaurer: restaurer });

  return section(
    'sauvegardes',
    'Sauvegardes',
    el(
      'dl',
      { classe: 'infos' },
      el('dt', { texte: 'Dernière sauvegarde' }),
      el('dd', { texte: derniere ? `${dateSauvegarde(derniere)} (${(LIBELLES_RAISON[derniere.raison] ?? derniere.raison).toLowerCase()})` : 'Aucune' }),
      el('dt', { texte: 'Sauvegardes enregistrées' }),
      el('dd', { texte: String(sauvegardes.length) }),
    ),
    el('div', { classe: 'groupe-horizontal groupe-horizontal--bas' }, champNombre.racine, enregistrer),
    el('div', { classe: 'groupe-horizontal' }, maintenant),
    liste,
  );
}

/** Après un rechargement complet de la page : le déclencheur a disparu, le focus va au titre de la section Sauvegardes. */
function focusSauvegardes() {
  const titre = document.getElementById('titre-sauvegardes');
  if (!titre) return;
  titre.setAttribute('tabindex', '-1');
  titre.focus();
}

async function restaurer(s) {
  if (!(await confirmerRestauration(s, texteEtatActuel(page.etat)))) return;
  try {
    const r = await restaurerSauvegarde(s.nom);
    await charger();
    focusSauvegardes();
    afficherToast({
      texte: `Sauvegarde du ${dateSauvegarde(s)} restaurée (${pluriel(r.nombrePrestations, 'prestation')}).${r.sauvegardeApplication ? " La version de l'application a aussi été mise de côté." : ''}`,
      action: r.annulable
        ? {
            libelle: 'Annuler la restauration',
            auClic: async () => {
              try {
                await restaurerSauvegarde(r.sauvegardeAvant);
                await charger();
                focusSauvegardes();
                afficherToast({ texte: 'Restauration annulée : vos données sont revenues à leur état précédent.' });
              } catch (err) {
                erreurToast(err);
              }
            },
          }
        : undefined,
    });
  } catch (err) {
    erreurToast(err);
  }
}

async function rendreSauvegardes() {
  const sauvegardes = await chargerSauvegardes();
  const neuve = await sectionSauvegardes(sauvegardes);
  const ancienne = document.getElementById('sauvegardes');
  if (ancienne) ancienne.replaceWith(neuve);
  return neuve;
}

// ------------------------------------------------------------------ Export

function sectionExport() {
  const bouton = (libelle, chemin, description) => {
    const b = el('button', { classe: 'btn btn--secondaire', texte: libelle, attributs: { type: 'button' } });
    b.addEventListener('click', async () => {
      b.setAttribute('aria-busy', 'true');
      try {
        const fichier = await telecharger(chemin);
        enregistrerFichier(fichier);
        afficherToast({ texte: `${description} : ${fichier.nom}. Ce fichier contient des données de santé en clair.`, variante: 'attention' });
      } catch (err) {
        erreurToast(err);
      } finally {
        b.removeAttribute('aria-busy');
      }
    });
    return b;
  };
  return section(
    'export',
    'Export',
    alerte('attention', 'Données de santé', 'Ces fichiers contiennent des données de santé en clair. Rangez-les dans un endroit sûr.', 'status'),
    el('p', { texte: "Le fichier est créé sur votre ordinateur : rien n'est envoyé sur Internet. Les fichiers CSV s'ouvrent dans Excel ou LibreOffice ; l'export complet (JSON) sert à garder une copie ou à dépanner ; l'application ne sait pas le restaurer. Pour revenir en arrière, utilisez les sauvegardes ci-dessus." }),
    el(
      'div',
      { classe: 'groupe-horizontal' },
      bouton('Exporter tout (JSON)', '/api/export?format=json', 'Export complet téléchargé'),
      bouton('Prestations (CSV)', '/api/export?format=csv&contenu=prestations', 'Prestations téléchargées'),
      bouton('Versements (CSV)', '/api/export?format=csv&contenu=versements', 'Versements téléchargés'),
    ),
  );
}

// -------------------------------------------------- Dossier de données

function sectionDossier() {
  const { etat } = page;
  return section(
    'dossier',
    'Dossier de données',
    el(
      'dl',
      { classe: 'infos' },
      el('dt', { texte: 'Dossier' }),
      el('dd', {}, el('span', { classe: 'code', texte: etat.dossier })),
      el('dt', { texte: 'Fichier de données' }),
      el('dd', { texte: etat.tailleOctets === null ? '—' : formatTaille(etat.tailleOctets) }),
      el('dt', { texte: 'Prestations enregistrées' }),
      el('dd', { texte: etat.nombrePrestations === null ? '—' : String(etat.nombrePrestations) }),
    ),
    el('p', {}, 'Pour changer de dossier, double-cliquez sur « Choisir le dossier de donnees.bat » (dans le dossier scripts de l\'application) ; la variable ', el('span', { classe: 'code', texte: 'ERGO_DATA_DIR' }), " du fichier .env fait la même chose pour un usage avancé. Le dossier ne se change pas depuis cette page."),
    el('p', { classe: 'champ__aide', texte: "Si ce dossier est synchronisé (Proton Drive, par exemple), n'ouvrez l'application que sur un seul ordinateur à la fois." }),
  );
}

// -------------------------------------------------------------- Apparence

function sectionApparence() {
  const courant = lireTheme();
  const choix = [
    ['auto', 'Automatique', 'suit le réglage de Windows'],
    ['light', 'Clair', ''],
    ['dark', 'Sombre', ''],
  ];
  const radios = choix.map(([valeur, libelle, precision]) =>
    el(
      'label',
      { classe: 'case' },
      el('input', {
        attributs: { type: 'radio', name: 'theme', value: valeur },
        proprietes: { checked: valeur === courant },
        evenements: {
          change: () => {
            const memorise = choisirTheme(valeur);
            afficherToast(memorise ? { texte: 'Apparence enregistrée.' } : { texte: "L'apparence est appliquée à cette page, mais n'a pas pu être mémorisée sur cet ordinateur.", variante: 'attention' });
          },
        },
      }),
      el('span', { texte: precision ? `${libelle} (${precision})` : libelle }),
    ),
  );
  return section('apparence', 'Apparence', el('fieldset', { classe: 'groupe' }, el('legend', { texte: 'Thème de l\'application' }), el('div', { classe: 'pile pile--s' }, ...radios)));
}

// ------------------------------------------------------------ Application

/** Après l'arrêt : plus rien à interroger. L'écran est remplacé par un message ; aucun appel réseau n'est plus lancé depuis cette page. */
function afficherArretee() {
  page.arretee = true;
  arreterPresence(); // plus aucun battement ni signal de fermeture
  remplacer(document.getElementById('bandeaux'));
  remplacer(
    zone.contenu,
    el('div', { classe: 'etat-vide', attributs: { role: 'status' } }, el('p', { classe: 'etat-vide__titre', texte: "L'application est arrêtée." }), el('p', { classe: 'etat-vide__texte', texte: 'Vous pouvez fermer cet onglet.' })),
  );
}

async function quitter(bouton) {
  if (page.arretee) return;
  const ok = await confirmer({
    titre: "Quitter l'application ?",
    texte: ['Vos données sont enregistrées.', 'Pour la rouvrir, utilisez le raccourci Suivi Facturation.'],
    libelleConfirmer: "Quitter l'application",
  });
  if (!ok) return;
  bouton.setAttribute('aria-busy', 'true');
  try {
    await appeler('POST', '/api/arreter');
    afficherArretee();
  } catch (err) {
    bouton.removeAttribute('aria-busy');
    erreurToast(err);
  }
}

function sectionApplication() {
  const bouton = el('button', { classe: 'btn btn--secondaire', texte: "Quitter l'application", attributs: { type: 'button' } });
  bouton.addEventListener('click', () => quitter(bouton));
  return section('application', 'Application', el('p', { texte: "Ferme l'application proprement : vos données sont enregistrées. Pour la rouvrir, utilisez le raccourci Suivi Facturation." }), el('div', { classe: 'groupe-horizontal' }, bouton));
}

// ------------------------------------------------------------- Démarrage

async function charger() {
  page.etat = await lireEtat();
  afficherBandeaux(document.getElementById('bandeaux'), page.etat);
  if (page.etat.modeDegrade) {
    await afficherEcranDegrade(zone.contenu, page.etat);
    return;
  }
  const ecriture = ecritureAutorisee(page.etat);
  const { catalogue, utilisations } = await appeler('GET', '/api/catalogue');
  const sauvegardes = await chargerSauvegardes();
  const sommaire = el(
    'nav',
    { classe: 'sommaire', attributs: { 'aria-label': 'Sections des paramètres' } },
    el('ul', {}, ...[['tarifs', 'Tarifs'], ['sauvegardes', 'Sauvegardes'], ['export', 'Export'], ['dossier', 'Dossier de données'], ['apparence', 'Apparence'], ['application', 'Application']].map(([id, texte]) => el('li', {}, el('a', { texte, attributs: { href: `#${id}` } })))),
  );
  remplacer(
    zone.contenu,
    el('div', { classe: 'parametres-mise-en-page' }, sommaire, el('div', { classe: 'pile pile--l' }, sectionTarifs({ catalogue, utilisations, ecriture }), await sectionSauvegardes(sauvegardes), sectionExport(), sectionDossier(), sectionApparence(), sectionApplication())),
  );
}

async function demarrer() {
  zone.contenu = document.getElementById('zone');
  try {
    await charger();
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  } catch (err) {
    remplacer(document.getElementById('bandeaux'), alerte('danger', 'Erreur', err.message, 'alert'));
    remplacer(zone.contenu);
  }
}

demarrer();

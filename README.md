<p align="center"><img src="scripts/icone/logo-512.png" alt="Logo de suivi-facturation" width="128"></p>

# suivi-facturation

Application web **locale** de suivi d'activité pour un praticien ou une praticienne libérale de santé travaillant seul(e) : séances par patient, statut de facturation, paiements (partiels possibles), chiffre d'affaires mensuel prévu/encaissé. Conçu d'abord pour une ergothérapeute libérale ; utilisable par d'autres professions de santé libérales après avoir défini ses prestations.

**Ce que ce n'est pas.** Ce n'est ni un logiciel de facturation (il ne produit pas de facture : il prépare un récapitulatif mensuel copiable ou imprimable, à recopier dans l'outil de facturation habituel), ni un logiciel de comptabilité certifié, ni un dossier patient. Il n'apporte aucune garantie de conformité réglementaire.

**Vos données de santé restent sous votre responsabilité.** Les noms, motifs et montants saisis sont des données de santé, stockés **en clair** dans un fichier sur votre ordinateur (et dans le dossier synchronisé de votre choix, si vous en configurez un). Choisir l'endroit où elles sont hébergées (disque local, cloud personnel comme Proton Drive, sauvegarde externe) et vérifier que ce choix respecte vos obligations (ordre professionnel, CNIL, hébergement de données de santé) est de **votre ressort** : ce projet ne l'affirme pas et ne le garantit pas.

- Fonctionne sur **un seul ordinateur**, sans compte (aucune authentification, voir l'avertissement ci-dessous), **hors ligne**. Le serveur n'écoute que sur `127.0.0.1` ; aucun appel réseau sortant, aucune télémétrie, aucune police ou script externe. Windows 11 est le système vérifié ; les lanceurs et scripts **Linux et macOS sont expérimentaux, non testés sur un vrai système** (voir plus bas).
- Aucune dépendance : Node.js 24 seulement, JavaScript pur, pas d'étape de build.
- Données dans **un seul fichier JSON**, avec sauvegardes automatiques (réglage : nombre de **jours** d'historique à conserver), restauration et export (JSON, CSV).
- Dossier de données configurable pour être **synchronisé par le client de bureau Proton Drive** (ou un autre) : le projet ne manipule aucun identifiant cloud.
- **Une seule application active par dossier de données** (verrou local à l'ordinateur) : lancer deux fois n'ouvre que la page, sans erreur. Ce verrou ne protège pas entre deux ordinateurs.
- Interface et documentation en français.

## À utiliser seul sur son ordinateur

> **Avertissement de sécurité.** À utiliser sur un ordinateur où **une seule personne a un compte**. L'application n'a **aucune authentification locale** : tout autre programme ou compte de la même machine peut accéder à son adresse locale (`127.0.0.1`) et lire ou modifier les données. Ne l'utilisez pas sur un poste partagé (famille, cabinet à plusieurs, session à distance) et ne l'exposez pas sur un réseau. Piste prévue en feuille de route, **non livrée** : un jeton secret par lancement.

Détails : [SECURITY.md](SECURITY.md) et [docs/exploitation.md](docs/exploitation.md).

## Fonctions disponibles

Facturation du mois (récapitulatif par patient, copie, impression), saisie et liste des prestations, paiements en un clic ou en plusieurs versements (modes : carte bancaire, chèque, espèces, virement, autre ; la liste des prestations les montre par de petites icônes avec une bulle au survol), tableau de bord (CA par mois, impayés, séances, répartition), catalogue de prestations et tarifs que vous définissez vous-même, sauvegardes, restauration, export.

**Prévisions :** le graphique du chiffre d'affaires par mois peut afficher, pour le mois en cours et les 3 suivants, une *estimation indicative* (moyenne des 3 derniers mois complets et séances déjà planifiées). Elle n'apparaît qu'avec au moins 3 mois complets de données ; un mois sans prestation compte pour 0.

*À venir :* archivage à 12 mois, détection automatique des copies de conflit du cloud, aide à la saisie, avertissement de doublon, patients actifs.

## Premier lancement : le catalogue est vide

L'application démarre **sans aucune prestation ni tarif** : les prestations et leurs prix varient d'une profession de santé à l'autre, aucune liste n'est donc fournie par défaut. Au premier lancement, l'accueil explique deux étapes : (1) définir vos prestations et leurs tarifs dans **Paramètres → Tarifs** (nom, catégorie « Séance », « Bilan » ou « Autre », tarif ; « Séance » est présélectionnée) ; (2) saisir ensuite vos prestations. Tant que le catalogue est vide (ou entièrement désactivé), le formulaire de saisie est désactivé. Le nombre de séances se calcule d'après la **catégorie**, pas d'après la durée. Les fichiers de données existants gardent leur catalogue ; « Repartir d'un fichier vide » donne aussi un catalogue vide.

Exemple **fictif**, inventé pour illustrer : « Séance individuelle 30 min, 40 € », catégorie Séance.

## Installation en 3 commandes

Prérequis : [Node.js 24](https://nodejs.org) (et git).

```
git clone https://github.com/Newborshian/suivi-facturation.git suivi-facturation
cd suivi-facturation
npm start
```

Puis ouvrir <http://127.0.0.1:4780>. Il n'y a rien à installer d'autre (pas d'`npm install`). `npm start` lance le serveur au premier plan, dans le terminal (Ctrl+C pour l'arrêter).

## Essayer l'application

```
npm run demo
```

Lance l'application sur des **données fictives** (une copie du jeu d'exemple, **datée d'aujourd'hui**, dans un dossier temporaire du système, **différent à chaque lancement**) et ouvre le navigateur. Rien n'est conservé : à chaque lancement, tout repart du jeu d'exemple, et vos vraies données ne sont jamais utilisées. Le dossier temporaire est supprimé à la fermeture (fichier par fichier, sans suivre aucun lien). La démonstration se ferme avec la page du navigateur, ou par Ctrl+C dans le terminal.

## Lancement par système

Le même point d'entrée existe partout, en terminal : `node scripts/suivi.mjs lancer`, `arreter`, `raccourci`, `diagnostic` ou `aide`. Il détecte le système tout seul. Dans tous les cas, l'application démarre en arrière-plan, le navigateur s'ouvre, et lancer une seconde fois ne fait qu'ouvrir la page. Si le port habituel (4780) est pris par un autre logiciel, un autre port est choisi tout seul (4781 à 4799) ; si une ancienne copie ne répond plus, une boîte propose de l'arrêter puis de relancer.

### Windows (vérifié)

Une seule fois : double-cliquer sur `scripts\Creer le raccourci Bureau.vbs` (ou `node scripts/creer-raccourci.mjs`) pour créer le raccourci « Suivi Facturation » (avec son icône) sur le Bureau (nom affiché ; le nom technique du projet reste `suivi-facturation`). Si un ancien raccourci « Suivi-facturation » existe, une question Oui/Non propose de le remplacer : jamais deux raccourcis. Sous l'icône, Windows peut écrire le nom sur deux lignes, selon la taille d'icône choisie. Ensuite, double-cliquer sur ce raccourci : **aucune fenêtre ne s'ouvre**, l'application démarre en arrière-plan et le navigateur s'ouvre sur la page. L'application s'arrête toute seule quelques secondes après la fermeture de la dernière page du navigateur (désactivable avec `ERGO_ARRET_AUTO=0`) ; le bouton « Quitter l'application » de l'écran Paramètres et `scripts\Arreter suivi-facturation.vbs` restent disponibles. Si le projet est déplacé, relancer `Creer le raccourci Bureau.vbs`.

Le journal est `logs\suivi-facturation.log` (ni nom de patient ni montant). Le mode diagnostic, avec fenêtre visible, reste disponible : `scripts\Lancer suivi-facturation.bat`.

### Linux (expérimental, non testé sur un vrai système)

Ces lanceurs ont été écrits et relus mais n'ont jamais été exécutés sur un vrai Linux ; la suite de tests automatiques (CI) en exerce une partie, pas les boîtes graphiques ni les raccourcis. Prérequis : Node.js 24. Rendre les scripts exécutables une fois : `chmod +x scripts/*.sh`. Puis `sh scripts/Suivi-facturation.sh` (ou `node scripts/suivi.mjs lancer`) lance l'application ; `node scripts/creer-raccourci.mjs` crée `Suivi-facturation.desktop` (`Name=Suivi Facturation`) sur le Bureau et dans le menu des applications. Arrêt : `scripts/Arreter suivi-facturation.sh` ou `node scripts/suivi.mjs arreter`.

### macOS (expérimental, non testé sur un vrai système)

Même réserve que pour Linux : la suite de tests automatiques (CI) n'exerce pas l'application `.app` ni les boîtes de dialogue. Prérequis : Node.js 24. Mêmes commandes qu'ailleurs ; `node scripts/creer-raccourci.mjs` crée `Suivi Facturation.app` sur le Bureau (icône produite à partir du logo du projet). Au premier lancement, macOS peut demander une confirmation (clic droit, Ouvrir).

Détails (fonctionnement, instance unique, port, instance bloquée, réserve sur VBScript, dépannage) : [docs/exploitation.md](docs/exploitation.md). Utilisation quotidienne : [docs/guide-utilisateur.md](docs/guide-utilisateur.md).

## Configuration

Variables facultatives, dans un fichier `.env` (modèle : `scripts/env.exemple`) : `ERGO_DATA_DIR` (dossier des données, par défaut `data/`) et `ERGO_PORT` (par défaut `4780`). Les dossiers choisis (`ERGO_DATA_DIR`, et pour les essais `ERGO_LOG_DIR` et `ERGO_VERROU_DIR`) sont contrôlés sur leur chemin réel : un lien symbolique ou une jonction qui mènerait dans le projet est refusé (code de sortie 2). Détails, autres variables et sauvegardes dans [docs/exploitation.md](docs/exploitation.md).

## Données de santé et dépôt public

Ce dépôt est public et **ne contient aucune donnée réelle** : ni nom, ni motif, ni montant de patient. Les tests et le jeu d'exemple (`config/exemple.json`, généré par `src/exemple.js`) utilisent uniquement des données **fictives et génériques**, avec un catalogue de prestations inventé : ce jeu sert aux tests, démonstrations et captures, jamais de valeur par défaut.

Les données saisies dans l'application sont des données de santé : elles restent dans le dossier de données (`data/` par défaut, ignoré par git), en clair sur le disque, de même que les sauvegardes et les exports. **Ne jamais les ajouter au dépôt ni les publier** (captures d'écran comprises). Le fichier `.env` est aussi ignoré par git.

## Alternatives

suivi-facturation fait peu de choses, volontairement : il suit l'activité d'une personne seule, en local, et ne facture pas. Selon vos besoins, d'autres projets libres peuvent mieux convenir (liste non exhaustive, état au 2026-10-04) :

- **[my-practice](https://github.com/dholbach/my-practice)** (AGPL-3.0) : gestion de cabinet auto-hébergée pour thérapeutes et coachs : séances, factures PDF, notes chiffrées. Demande Docker et PostgreSQL ; interface en allemand et en anglais ; en pré-version.
- **[Physiocab / Kalinka](https://codeberg.org/Allium_SAS/kireht)** (AGPL-3.0) : gestion de cabinet pour kinésithérapeutes francophones, avec planning, bilans et facturation. Demande un serveur et PostgreSQL ; en version bêta.
- **[InvoiceShelf](https://github.com/InvoiceShelf/InvoiceShelf)** (AGPL-3.0) et **[Dolibarr](https://github.com/Dolibarr/dolibarr)** (GPL-3.0) : si vous avez besoin de produire de vraies factures ou une comptabilité. Auto-hébergés.
- **[Kimai](https://github.com/kimai/kimai)** et **[solidtime](https://github.com/solidtime-io/solidtime)** (AGPL-3.0) : suivi de temps avec facturation, pour des activités facturées à l'heure.
- **[Actual Budget](https://github.com/actualbudget/actual)** (MIT) et **[Firefly III](https://github.com/firefly-iii/firefly-iii)** (AGPL-3.0) : suivi de budget personnel.

Pour un dossier patient complet, regardez aussi [OpenEMR](https://github.com/openemr/openemr) ou [GNUmed](https://www.gnumed.de/documentation/). Ces projets n'ont pas été testés par les auteurs de suivi-facturation ; vérifiez leur licence, leur maintenance et leur conformité à vos obligations avant tout usage.

## Tests

```
npm test
```

La suite (`node:test`, sans dépendance) lance de vrais serveurs locaux sur des dossiers temporaires et ne touche jamais à `data/`..

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE).

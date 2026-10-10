# Guide du développeur

> Pour qui veut **modifier le code** de suivi-facturation : corriger un défaut, ajouter un champ, adapter une règle pour un autre cabinet.
> La description complète et qui fait foi est dans [`architecture.md`](architecture.md) ; ce guide est la porte d'entrée : où regarder, dans quel ordre, et ce qu'il ne faut pas casser.
> Chaque fichier du code commence par un en-tête qui dit son rôle, qui l'appelle et ce qu'il ne faut pas casser : lisez-le avant de modifier le fichier.

## 1. En une minute

- Un seul processus Node.js 24 (`src/server.js`), qui écoute **uniquement** sur `127.0.0.1` et sert à la fois l'API (`/api/...`) et les pages (`public/`).
- Les données sont **un fichier JSON** (`suivi-facturation.json`) dans le dossier de données. Il est réécrit en entier à chaque modification, de façon atomique, par une **file d'écriture unique**.
- **Le serveur calcule, le navigateur affiche.** Toutes les règles (paiement, récapitulatif, indicateurs, prévisions, patients) sont dans `src/domain/`, en fonctions pures testées.
- **Argent en centimes entiers**, partout : `4550` = 45,50 €. Jamais de nombre à virgule dans un calcul.
- Aucune dépendance, aucun build, aucun appel réseau sortant.

## 2. Carte des modules

```
public/                         NAVIGATEUR (n'importe jamais src/)
  *.html                        5 pages : index (Facturation du mois), prestations, patients, tableau-de-bord, parametres
  js/pages/<écran>.js           un module par écran : charge l'état, appelle l'API, construit le DOM
  js/api.js                     SEUL point d'appel du serveur (fetch même origine)
  js/dom.js, ui.js              construction du DOM (textContent uniquement), messages, dialogues
  js/format.js                  formats français, lecture d'un montant saisi -> centimes
  js/*.js (purs)                règles d'affichage testées sous Node : ecriture, selection, recherche-patients, paiement-libelles…
        │  JSON sur 127.0.0.1
        ▼
src/http/                       HTTP
  serveur.js                    en-têtes de sécurité -> contrôles (Host, Origin…) -> routeur | fichiers statiques
  api/<ressource>.js            une route = lire la requête, valider, appeler le domaine via le store, répondre
  api/commun.js                 contexte d'écriture (date du jour, horodatage, identifiants) et forme des réponses
  reponses.js, routeur.js       lecture bornée des corps, format des erreurs, table des routes
src/domain/                     RÈGLES MÉTIER (pures : ni disque, ni horloge implicite)
  validation.js                 tout ce qui entre dans l'API est contrôlé ici (400 / 422)
  prestations.js, patients.js   opérations d'écriture (sur une COPIE de l'état)
  paiement.js, recap.js,        calculs : état de paiement, Facturation du mois, tableau de bord, estimation
  indicateurs.js, previsions.js
  schema.js                     format du fichier, version, migrations, contrôle de structure
  csv.js, dates.js, money.js, tri.js, catalogue.js
src/store/                      SEUL accès au fichier de données
  store.js                      état en mémoire + file d'écriture + annulation + restauration
  fichier-atomique.js           écriture temporaire -> fsync -> renommage
  sauvegardes.js, restauration.js, conflit.js, archives-lecture.js, json.js
src/ (racine)                   server.js (démarrage), config.js (variables ERGO_*), verrou.js (une instance par dossier),
                                arret.js (arrêt propre), presence.js (arrêt automatique), journal.js, horloge.js, erreurs.js
scripts/                        lanceurs (Windows .vbs/.bat, Linux/macOS .sh), démonstration, arrêt de secours, raccourci
tests/                          domain, store, http, front, journal, scripts, qa ; aides communes dans tests/aides
```

Règle d'imports : `domain/` n'importe que `domain/` et `erreurs.js` ; `store/` importe `domain/` ; `http/` importe `store/` et `domain/` ; `public/js/` n'importe jamais `src/`.

## 3. Une écriture de bout en bout

Exemple : sur l'écran Prestations, un clic sur « Payer par chèque » d'une ligne.

1. **Clic** (`public/js/paiement-rapide.js`) : le bouton appelle `auChoix('cheque')`, que l'écran (`pages/prestations.js`) enveloppe dans `proteger(...)` : une seule action à la fois, toute erreur devient un message.
2. **Appel** (`public/js/api.js`) : `POST /api/prestations/<id>/payer-totalite` avec `{ "mode": "cheque" }`. Le navigateur n'envoie **pas** le montant : c'est le serveur qui le calcule.
3. **Contrôles HTTP** (`src/http/serveur.js`, `securite.js`) : `Host` = `127.0.0.1:<port>`, `Origin` de la même adresse, méthode connue ; corps JSON d'au plus 1 Mo (`reponses.js`).
4. **Route** (`src/http/api/prestations.js`) : `store.muter('payer-totalite', (copie) => payerEnTotalite(copie, id, corps, contexte()))`.
5. **File d'écriture** (`src/store/store.js`, `executer`) : l'écriture attend la fin de la précédente, puis :
   1. refus si le fichier n'est pas modifiable (mode dégradé, lecture seule, fichier modifié ailleurs) ;
   2. **copie** de l'état, puis la fonction du domaine travaille sur cette copie ;
   3. `controlerStructure` : un état invalide n'est jamais écrit ;
   4. sauvegarde quotidienne (première écriture du jour) et, pour une suppression, sauvegarde préalable obligatoire ;
   5. **écriture atomique** du fichier (`fichier-atomique.js`) ;
   6. seulement alors, le nouvel état devient l'état en mémoire, et un **jeton d'annulation** est retenu.
6. **Domaine** (`src/domain/prestations.js`, `payerEnTotalite`) : versement égal au reste à payer, daté d'aujourd'hui, mode choisi ; avertissements non bloquants (`TROP_PERCU`…) ; `dernierModePaiement` mis à jour.
7. **Réponse** : `201 { donnees: <ligne enrichie>, avertissements: [...], annulation: "<jeton>" }`.
8. **Affichage** : l'écran annonce « 58,00 € enregistrés par chèque. » d'après le versement renvoyé, propose « Annuler » (`POST /api/annulations/<jeton>`), puis recharge la liste.

Toute autre écriture suit le même chemin ; seule la fonction du domaine change.

## 4. Où sont les règles métier

| Règle | Fichier | Architecture |
|---|---|---|
| Payé, partiel, non payé ; reste ; trop-perçu | `src/domain/paiement.js` | §6.2 |
| Patient d'une prestation, homonymes, renommage, archivage | `src/domain/patients.js` | §6.3 |
| Création, modification, statut, versements, « payer » | `src/domain/prestations.js` | §6.4 |
| Facturation du mois (deux vues) | `src/domain/recap.js` | §6.5 |
| CA, séances, répartition, impayés et ancienneté | `src/domain/indicateurs.js` | §6.6 |
| Estimation des mois à venir | `src/domain/previsions.js` | §6.7 |
| Export CSV | `src/domain/csv.js` | §6.8 |
| Ce qui est accepté en entrée (montants, dates, textes, caractères refusés) | `src/domain/validation.js` | §6.3, §9.1 |
| Format du fichier, migrations | `src/domain/schema.js` | §5 |
| Sauvegardes et leur rotation | `src/store/sauvegardes.js` | §7.3 |
| Écriture possible ou non (interface) | `public/js/ecriture.js` | §11 |

## 5. Lancer et tester

```
npm start                        # http://127.0.0.1:4780, sur le dossier de données configuré (data/ par défaut)
npm run demo                     # copie temporaire du jeu d'exemple FICTIF, ports 4790 à 4799 ; rien n'est conservé
npm test                         # toute la suite (quelques minutes) ; détail dans derniers-tests.log
node --test tests/domain/recap.test.js   # un seul fichier, pendant le travail
```

- Pour essayer sans toucher aux vraies données : `npm run demo`, ou `ERGO_DATA_DIR`, `ERGO_LOG_DIR`, `ERGO_VERROU_DIR` vers des dossiers de `.tmp/` et un `ERGO_PORT` d'essai.
- Les tests n'utilisent que des dossiers temporaires sous `.tmp/tests/` et des données fictives ; ils ne lisent jamais `data/`.
- Toute fonction qui touche aux montants, aux dates, au stockage ou aux patients doit avoir un test.

## 6. Comment modifier…

**Ajouter un mode de paiement** : `MODES_PAIEMENT` (`src/domain/schema.js`) ; message de `mode` (`src/domain/validation.js`) ; `LIBELLES_MODE` dans `src/domain/csv.js` **et** `public/js/format.js` ; `PAR_MODE` et `EN_MODE` (`public/js/paiement-libelles.js`) ; une icône (`public/js/icones-paiement.js`) ; les styles ; les tests qui listent les modes. Le format du fichier ne change pas (une nouvelle valeur permise).

**Ajouter un champ à une prestation** : contrôle dans `controlerStructure` (`schema.js`) ; s'il devient obligatoire, **nouvelle version de schéma et migration** (ci-dessous) ; `CHAMPS_LIGNE` et la validation (`validation.js`) ; `creerPrestation` / `modifierPrestation` (`prestations.js`) ; l'export CSV si besoin ; le formulaire (`public/js/pages/prestations-formulaire.js`) ; les tests.

**Changer une règle de calcul** : la fonction du domaine (tableau §4), ses tests dans `tests/domain/`, les tests de cohérence entre écrans (`tests/qa/coherence.test.js`) et le paragraphe correspondant de l'architecture. Rester en centimes entiers ; pour une division, utiliser `diviserArrondi` (`previsions.js`).

**Changer le format du fichier** : `VERSION_COURANTE + 1` et une fonction pure `MIGRATIONS[ancienne]` dans `schema.js` (sur le modèle de `migrerV1VersV2`), des tests de migration, puis l'architecture §5.3. Le store fait seul la sauvegarde `avant-migration` et l'écriture. Un fichier d'une version plus récente reste en lecture seule : tous les postes qui partagent un dossier doivent avoir la même version.

**Ajouter une route** : un fichier `src/http/api/<ressource>.js` qui exporte `routes<Ressource>(routeur, ctx)`, enregistré dans `src/http/api/index.js` ; toute écriture passe par `store.muter` ; paramètres d'URL contrôlés par `refuserParametresInconnus` ; jamais de nom de patient dans une URL.

**Ajouter une page** : voir l'en-tête de `public/js/pages/tableau-de-bord.js` (copie d'une page HTML, navigation identique sur toutes les pages, pas de script ni de style en ligne : la politique de sécurité du contenu les bloque).

## 7. Pièges connus

- **Ne jamais écrire le fichier de données autrement que par `store.muter`** : une écriture hors de la file peut écraser une autre écriture ou contourner les sauvegardes.
- **Le nom du patient est copié dans chaque prestation** (`patient: { id, nom, prenom }`) en plus du registre. Seules les fonctions de `src/domain/patients.js` doivent toucher à ces copies, sinon le registre et les lignes divergent (avertissement « données incohérentes »).
- **Libellés en double** : les libellés des statuts, états, catégories et modes existent côté serveur (`csv.js`, export) et côté navigateur (`format.js`). Modifier les deux.
- **Ordres de tri** : ils sont centralisés dans `src/domain/tri.js` ; l'ordre du registre est aussi l'ordre d'écriture dans le fichier.
- **Caractères invisibles** : dans le code, écrire ` `, `﻿`… plutôt que le caractère lui-même (invisible à l'écran).
- **Date du jour** : toujours celle de l'horloge injectée (`horloge.aujourdHui()` ou `ctx.aujourdHui`), jamais `new Date()` dans le domaine.
- **Windows, tests** : un fichier de test s'arrête parfois brutalement sans détail (« test failed ») ; relancer `npm test` avant de conclure à une régression (la dernière exécution est dans `derniers-tests.log`).
- **Windows, PowerShell lent** : la lecture de l'heure de démarrage d'un processus (verrou d'instance) peut prendre plusieurs secondes ; un démarrage lent n'est pas forcément un défaut.
- **Arrêter un processus** : toujours par son PID (ou `POST /api/arreter`), jamais par son nom : l'utilisatrice peut avoir d'autres programmes Node ouverts.

## 8. Avant de livrer une modification sur l'ordinateur d'un client

1. **Sauvegarder le dossier de données** (copie du dossier entier, sauvegardes comprises) avant tout changement de version.
2. Vérifier la **version de Node.js** de la machine : `node --version` doit donner une version 24.
3. **Arrêter l'application** (bouton « Quitter l'application » de Paramètres, ou « Arreter suivi-facturation ») et vérifier qu'elle est bien arrêtée avant de remplacer les fichiers.
4. `npm test` vert sur la machine de développement (et, si possible, sur la machine du client avec une copie du projet, jamais sur ses données).
5. Si le format du fichier change : essayer la migration sur une **copie** du fichier du client, vérifier la sauvegarde « Avant une mise à jour du fichier ».
6. Relancer l'application et vérifier à la main : Facturation du mois du mois en cours, liste des prestations, page Patients, Paramètres › Sauvegardes (une sauvegarde de démarrage du jour), un paiement puis « Annuler », un export CSV ouvert dans le tableur.
7. Vérifier l'absence d'avertissement dans les bandeaux et lire la fin du journal (`logs/suivi-facturation.log`).

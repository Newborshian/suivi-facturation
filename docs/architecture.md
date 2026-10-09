# Architecture — suivi-facturation

> Description technique de l'application **telle qu'elle est implémentée**. Chaque point important renvoie au fichier source qui fait foi ; en cas de doute, le code a raison.
> Tous les exemples sont fictifs. Les points qui n'ont pas pu être vérifiés sont signalés « non vérifié » (voir aussi §15).

## Sommaire
1. Objectifs et non-objectifs
2. Contraintes techniques
3. Vue d'ensemble
4. Arborescence
5. Modèle de données
6. Règles du domaine
7. Stockage
8. Cycle de vie du processus
9. API HTTP
10. Sécurité et confidentialité
11. Interface (front)
12. Scripts et distribution
13. Configuration
14. Tests
15. Limites connues et points non vérifiés
16. Feuille de route

---

## 1. Objectifs et non-objectifs

**Objectifs**
- Suivre, sur un seul ordinateur, l'activité d'une ergothérapeute libérale : registre des patients (nom et prénom seulement), prestations par patient, statut de facturation (« à facturer » / « facturé »), versements (paiements partiels possibles), reste à encaisser.
- Préparer la facturation du mois : récapitulatif par patient, copiable et imprimable.
- Piloter l'activité : chiffre d'affaires mensuel, séances, répartition par type de prestation, impayés par ancienneté, estimation indicative des mois à venir.
- Protéger les données : un fichier JSON lisible, écrit de façon atomique, sauvegardes datées, restauration, détection d'une modification extérieure du fichier (synchronisation cloud).

**Non-objectifs**
- Ce n'est **pas** un logiciel de facturation ni de comptabilité : il ne produit ni facture, ni numérotation, ni télétransmission.
- Ce n'est **pas** un dossier patient : le registre ne contient ni date de naissance, ni coordonnées, ni motif, ni note (§5.2).
- Aucun usage en réseau, aucun compte utilisateur, aucun accès multi-poste simultané. L'application est prévue pour un ordinateur où une seule personne a un compte : il n'y a pas d'authentification locale entre comptes d'une même machine.
- Aucune intégration à un service cloud : la synchronisation éventuelle est faite par un client de bureau, hors de l'application ; aucun jeton n'est manipulé.
- Aucune fusion automatique de versions en conflit ; aucune suppression automatique de données (seules les sauvegardes et les temporaires de l'application sont supprimés, selon des règles strictes).

## 2. Contraintes techniques

- **Node.js 24** (`package.json` : `"engines": { "node": ">=24 <25" }`), **JavaScript pur en modules ES** (`"type": "module"`), sans TypeScript ni étape de build.
- **Zéro dépendance** : aucune entrée `dependencies` / `devDependencies`, pas de `node_modules`. Uniquement les modules natifs (`node:http`, `node:fs`, `node:crypto`, `node:test`…). Les graphiques sont dessinés en SVG par du code maison.
- **Écoute sur `127.0.0.1` uniquement**, en dur (`src/http/serveur.js`, `ADRESSE_ECOUTE`) : l'adresse n'est pas configurable.
- **Aucun appel réseau sortant**, aucun CDN. Les seules requêtes émises par le code visent `127.0.0.1` (sonde de l'instance, lanceurs).
- **Application locale** : le stockage est un fichier JSON dans un dossier de données configurable ; l'interface est servie par le même processus.
- Interface et messages en français.

## 3. Vue d'ensemble

```
 Navigateur (pages HTML + modules ES de public/js)
     │  fetch same-origin, JSON ; battements de présence (POST /api/presence)
     ▼
 node src/server.js  ── un seul processus, 127.0.0.1:<port>
 ├─ http/serveur.js      en-têtes de sécurité → controlerRequete (Host, Sec-Fetch-Site, Origin, méthode)
 │                        → /api/* : routeur → http/api/<ressource>.js      → autres GET/HEAD : http/statique.js (public/)
 ├─ domain/*             règles métier PURES (aucune E/S, aucune horloge implicite) : registre des patients, état de paiement,
 │                        récap, indicateurs, prévisions, validation, CSV, schéma et migrations
 ├─ store/*              seul accès au fichier de données : état en mémoire, file d'écriture unique,
 │                        écriture atomique, sauvegardes, restauration, empreinte (conflit)
 ├─ verrou.js            verrou d'instance par dossier de données (fichier local, hors dossier synchronisé)
 ├─ presence.js          arrêt automatique quand plus aucune page n'est ouverte (si activé)
 ├─ arret.js             ordre de l'arrêt propre (garde-temps, requêtes, file d'écriture, connexions, verrou)
 └─ journal.js           journal d'événements (logs/suivi-facturation.log), sans donnée de patient
     │
     ▼
 Dossier de données (ERGO_DATA_DIR) : suivi-facturation.json, sauvegardes/, archive-AAAA.json (lecture seule)
```

Principes :
- **Le serveur calcule, le navigateur affiche.** États de paiement, totaux, récapitulatif, indicateurs, prévisions et tranches d'ancienneté sont définis et calculés par `src/domain/` ; le front met en forme, filtre localement et dessine.
- **Rien n'est stocké s'il peut être calculé** : état de paiement, reste, trop-perçu, « à venir », ancienneté.
- **Argent en centimes entiers** partout (stockage, API, calculs) ; conversion en euros à l'affichage et à l'export seulement.
- **Horloge injectable** (`src/horloge.js`) : les fonctions du domaine reçoivent « aujourd'hui » en paramètre.
- Règle d'imports : `domain/` n'importe que `domain/` et `erreurs.js` ; `store/` importe `domain/` ; `http/` importe `store/` et `domain/` ; `public/js/` n'importe jamais `src/`.

## 4. Arborescence

```
suivi-facturation/
├─ package.json            "type":"module", engines node 24, scripts start/test/lancer/arreter/raccourci/demo, aucune dépendance
├─ .env                    facultatif, ignoré par git (modèle : scripts/env.exemple)
├─ src/
│  ├─ server.js            point d'entrée : .env → journal → configuration → verrou → port → dossier → stockage → écoute
│  ├─ config.js            variables ERGO_* (dossier, port, journal, arrêt automatique), contrôle du dossier de données,
│  │                        refuserEmplacementInterdit (journal, verrous) et cheminReel
│  ├─ droits.js            droits des fichiers (0600) et dossiers (0700) créés par l'application
│  ├─ arret.js             arrêt propre : ordre des étapes, garde-temps de 5 s (dépendances injectables)
│  ├─ journal.js           journal d'événements, rotation à 1 Mo
│  ├─ verrou.js            verrou d'instance (fichier local par dossier de données), heure de démarrage des processus
│  ├─ presence.js          logique pure de l'arrêt automatique (minuteurs injectables)
│  ├─ horloge.js           horloge réelle { maintenant(), aujourdHui() }
│  ├─ erreurs.js           ErreurApp (statut HTTP, code stable, message français, champs, détails)
│  ├─ exemple.js           générateur déterministe du jeu fictif (config/exemple.json)
│  ├─ domain/              PUR : schema, money, dates, paiement, patients, catalogue, prestations, validation,
│  │                        recap, indicateurs, previsions, csv
│  ├─ store/               store.js (état + file), fichier-atomique.js, sauvegardes.js, restauration.js,
│  │                        conflit.js (empreinte, conflit non résolu), archives-lecture.js (lecture seule)
│  └─ http/                serveur.js, securite.js, statique.js, routeur.js, reponses.js,
│     └─ api/               sante, etat, catalogue, patients, prestations, recap, indicateurs, sauvegardes, export,
│                           parametres, arret, presence (+ index.js qui les enregistre)
├─ public/
│  ├─ index.html           Facturation du mois (accueil)
│  ├─ prestations.html     saisie et liste
│  ├─ patients.html        registre des patients
│  ├─ tableau-de-bord.html
│  ├─ parametres.html
│  ├─ css/                 tokens, base, composants, ecrans, impression
│  └─ js/                  api, dom, ui, format, bandeaux, presence, theme(-init), conflit, restauration, ecran-degrade,
│                           accueil-vide, catalogue-etat, recap-texte, recap-regles, periodes, icones-paiement,
│                           ecriture, selection, accessibilite, entree,
│                           recherche-patients, combobox-patient, patients-dialogues,
│                           graphiques/ (mise-en-page, barres-svg, barres-h, prevision-ca, svg), pages/ (un module par écran)
├─ config/exemple.json     instantané du jeu fictif (schéma version 2 : catalogue de six prestations, registre de sept patients
│                           fictifs dont un archivé sans prestation)
├─ scripts/                lanceurs (Windows .vbs/.bat, Linux/macOS .sh), suivi.mjs, lancer-silencieux.mjs, arreter.mjs,
│                           demo.mjs, creer-raccourci.mjs, choisir-dossier.mjs, lib-lanceur.mjs, outils-lanceur.mjs,
│                           lib-boites.sh, env.exemple, icone/ (logo, .ico, générateur)
├─ tests/                  domain/, store/, http/, front/, journal/, scripts/, qa/, aides/, fixtures/ (vide)
├─ .github/workflows/tests.yml   npm test sur Linux, macOS et Windows
└─ docs/
```

Fichiers non versionnés (`.gitignore`) : `data/`, `logs/`, `.tmp/`, `.env` et ses variantes, `*.bak`, `*.log`, `*.verrou`, `*.reprise`, `node_modules/`, `derniers-tests.log`, exports téléchargés (`suivi-facturation-export-*.json`, `suivi-facturation-prestations-*.csv`, `suivi-facturation-versements-*.csv`).

## 5. Modèle de données

### 5.1 Dossier de données

```
<ERGO_DATA_DIR>/                       (par défaut <projet>/data, créé en 0700 s'il manque)
├─ suivi-facturation.json              fichier actif
├─ sauvegardes/
│  └─ sauvegarde-2026-10-02_09h14m03s_demarrage.json
├─ archive-AAAA.json                   facultatif, lu seulement (aucune écriture par l'application, §16)
└─ (transitoire) suivi-facturation.json.tmp-<pid>-<n>
```

### 5.2 Fichier actif, schéma version 2

Défini par `src/domain/schema.js` (`FORMAT = 'suivi-facturation'`, `VERSION_COURANTE = 2`). Exemple fictif :

```json
{
  "format": "suivi-facturation",
  "schemaVersion": 2,
  "revision": 129,
  "majLe": "2026-10-02T07:14:03.120Z",
  "parametres": { "sauvegardesConservees": 30, "dernierModePaiement": "cheque" },
  "catalogue": [
    { "id": "seance-30",          "libelle": "Séance individuelle 30 min", "tarifCentimes": 4200,  "categorie": "seance", "actif": true, "ordre": 1 },
    { "id": "seance-45",          "libelle": "Séance individuelle 45 min", "tarifCentimes": 5800,  "categorie": "seance", "actif": true, "ordre": 2 },
    { "id": "seance-domicile-45", "libelle": "Séance à domicile 45 min",   "tarifCentimes": 6800,  "categorie": "seance", "actif": true, "ordre": 3 },
    { "id": "bilan-initial",      "libelle": "Bilan initial",              "tarifCentimes": 17000, "categorie": "bilan",  "actif": true, "ordre": 4 },
    { "id": "compte-rendu",       "libelle": "Compte rendu",               "tarifCentimes": 2800,  "categorie": "autre",  "actif": true, "ordre": 5 },
    { "id": "reunion-synthese",   "libelle": "Réunion de synthèse",        "tarifCentimes": 5200,  "categorie": "autre",  "actif": true, "ordre": 6 }
  ],
  "patients": [
    { "id": "3b9d0000-0000-4000-8000-000000000002", "nom": "Lapin", "prenom": "Pierre", "actif": true },
    { "id": "3b9d0000-0000-4000-8000-000000000007", "nom": "Cygne", "prenom": "Léa",    "actif": false }
  ],
  "prestations": [
    {
      "id": "8f1c2e0a-0000-4000-8000-000000000001",
      "patient": { "id": "3b9d0000-0000-4000-8000-000000000002", "nom": "Lapin", "prenom": "Pierre" },
      "date": "2026-09-14",
      "prestationId": "seance-45",
      "libelle": "Séance individuelle 45 min",
      "categorie": "seance",
      "motif": "Graphisme",
      "montantCentimes": 5800,
      "statut": "facture",
      "factureLe": "2026-09-30",
      "versements": [
        { "id": "c41a0000-0000-4000-8000-000000000003", "montantCentimes": 2000, "date": "2026-10-01", "mode": "cheque" }
      ],
      "creeLe": "2026-09-14T16:02:11.000Z",
      "modifieLe": "2026-10-01T08:30:00.000Z"
    }
  ]
}
```

| Champ | Contrainte (contrôlée par `controlerStructure`) |
|---|---|
| `format`, `schemaVersion` | `"suivi-facturation"`, entier |
| `revision` | entier ≥ 0, incrémenté à chaque écriture |
| `majLe`, `creeLe`, `modifieLe` | horodatages ISO (UTC) ; métadonnées techniques |
| `parametres.sauvegardesConservees` | entier ≥ 1 dans le fichier ; nombre de **jours** d'historique de la réserve quotidienne ; l'API n'accepte que 7 à 365 (§7.3) |
| `parametres.dernierModePaiement` | `null` ou un mode de paiement |
| `catalogue[]` | `id` unique non vide, `libelle` non vide, `tarifCentimes` 0 à 10 000 000, `categorie`, `actif` booléen, `ordre` entier |
| `patients` | tableau obligatoire (peut être vide) |
| `patients[]` | `id` unique non vide, `nom` et `prenom` non vides, `actif` booléen |
| `prestations[].patient` | `{ id, nom, prenom }` non vides |
| `prestations[].date`, `factureLe`, `versements[].date` | date civile `AAAA-MM-JJ` réelle, années 2000 à 2100 (`src/domain/dates.js`) ; `factureLe` peut être `null` |
| `prestations[].montantCentimes` | entier 0 à 10 000 000 (100 000 €) |
| `versements[].montantCentimes` | entier 1 à 10 000 000 |
| `statut` | `a_facturer` \| `facture` |
| `categorie` | `seance` \| `bilan` \| `autre` |
| `mode` | `carte` \| `cheque` \| `especes` \| `virement` \| `autre` (`MODES_PAIEMENT`) |
| `id` des prestations et versements | uniques dans le fichier (`crypto.randomUUID()` à la création) |

Règles :
- **Catalogue vide par défaut** : `creerEtatInitial` crée un fichier sans aucune prestation au catalogue ; les prestations proposées se définissent dans Paramètres › Tarifs. Le catalogue ci-dessus est celui du jeu d'exemple fictif (`src/exemple.js`), jamais injecté dans un fichier réel. Les identifiants créés par l'interface sont des UUID ; les identifiants lisibles ci-dessus sont propres au jeu d'exemple.
- **Registre des patients + copie du nom dans chaque prestation** : `patients[]` est la source de vérité de l'identité et de l'écriture du nom ; chaque prestation garde une copie `patient: { id, nom, prenom }` que le domaine tient identique au registre (`src/domain/patients.js`). Grâce à cette copie, le récapitulatif, les indicateurs, les prévisions, l'export CSV, le tri et les archives annuelles lisent les lignes sans consulter le registre. Invariants que les opérations de l'application ne violent jamais (vérifiés par un test qui enchaîne des centaines d'opérations tirées d'une graine fixe) :
  - **I1** : chaque `prestations[].patient.id` existe dans `patients[]` ;
  - **I2** : `prestations[].patient.nom` et `prenom` sont exactement ceux du registre ;
  - **I3** : identifiants du registre uniques ; un patient peut n'avoir aucune prestation.
  I1 et I2 ne sont **pas** des règles de structure : un fichier qui les viole (retouche à la main, fusion par un client de synchronisation) reste lisible et modifiable ; les écarts sont comptés par `compterIncoherencesPatients` (`orphelines`, `copiesDivergentes`) et signalés par l'avertissement `DONNEES_INCOHERENTES` de `/api/etat`, sans rien corriger (§15).
- **Contenu du registre** : `id` (UUID créé par l'application), `nom`, `prenom`, `actif` (faux = patient **archivé** : moins mis en avant à la saisie, toujours présent partout ailleurs). Aucun horodatage ni aucune autre donnée. Ordre dans le fichier : nom, prénom (collation `fr`), puis identifiant. Les champs inconnus d'un patient sont tolérés par le contrôle de structure.
- **Archivé ≠ archives** : le drapeau `actif` du registre n'a aucun rapport avec les archives annuelles de prestations (§5.4) ; aucun calcul (récapitulatif, indicateurs, prévisions, exports) n'en dépend.
- **Libellé et catégorie figés** dans la ligne au choix du type ; `prestationId` garde le lien avec le catalogue. Modifier un tarif, un libellé ou désactiver un type n'a aucun effet rétroactif.
- **Catégories** : seule `seance` compte comme « séance » ; `bilan` et `autre` sont comptées à part.
- **Non stockés** : état de paiement, total versé, reste, trop-perçu, « à venir ».
- Écriture : JSON indenté (2 espaces) suivi d'un saut de ligne, UTF-8. Un BOM éventuel est toléré à la lecture.
- **Incohérences tolérées** : une ligne « facturé » sans `factureLe`, ou « à facturer » avec une `factureLe` (`compterIncoherencesStatut`), une ligne dont le patient manque au registre ou dont la copie du nom diffère du registre (`compterIncoherencesPatients`) ne bloquent pas le fichier ; elles sont signalées par l'avertissement `DONNEES_INCOHERENTES` de `/api/etat`, qui donne leur nombre.

### 5.3 Versions de schéma

| Version | Contenu |
|---|---|
| 1 | catalogue, paramètres, prestations ; le patient n'existe que par la copie `patient` de chaque ligne |
| 2 (courante) | ajoute le registre `patients[]` (§5.2) ; le format des prestations est inchangé |

- `MIGRATIONS` (table `n → n+1`, fonctions pures, `src/domain/schema.js`) contient une étape : `MIGRATIONS[1] = migrerV1VersV2`, qui reconstruit le registre depuis les prestations (`reconstruireRegistre`, détail et cas limites au §7.4). `migrer` applique les étapes sur une copie et pose `schemaVersion` ; une étape manquante ou une version plus récente que la cible lève une erreur.
- Fichier de version **inférieure** : migré au chargement, avec la sauvegarde `avant-migration` du fichier d'origine ; en cas d'échec, mode dégradé sans aucune écriture (§7.4, §7.5).
- Version **supérieure** : **lecture seule** (`SCHEMA_PLUS_RECENT`, 503 sur toute écriture), ni migration ni sauvegarde. Si la structure n'est pas reconnue, les écrans de lecture répondent aussi 503 ; seul l'export JSON complet reste possible. Conséquence : une version de l'application antérieure au registre (schéma 1) ouvre un fichier de version 2 en lecture seule ; tous les postes qui partagent un dossier de données doivent être mis à jour.
- Sauvegardes de version inférieure : migrées en mémoire pour la liste des sauvegardes et au moment de la restauration (§7.4).

### 5.4 Archives

Le format `archive-AAAA.json` (`{ "format": "suivi-facturation-archive", "prestations": [...] }`) est **lu** s'il est présent (`src/store/archives-lecture.js`, `lireArchives`) : export complet et CSV (dédupliqués par `id`, la version active l'emportant), comptage des utilisations du catalogue, refus de supprimer un type de prestation ou un patient encore référencé. **L'application ne crée pas d'archive** : l'archivage annuel est prévu (§16). Les indicateurs et prévisions ne lisent que le fichier actif.

**Archives et registre des patients** : le format d'archive n'a pas de version et **n'est ni migré ni réécrit** ; ses lignes gardent leur propre copie `patient: { id, nom, prenom }`. Pour être contrôlées, elles sont placées dans un état factice de version courante dont le registre est vide (`patients: []`, `structureValide`) : une ligne d'archive n'a donc pas besoin que son patient figure au registre. Conséquences :
- un patient présent **seulement** dans des archives n'est pas ajouté au registre ;
- renommer un patient ne modifie pas ses lignes archivées, qui gardent l'ancien nom (l'export CSV peut alors montrer deux écritures pour un même identifiant) ;
- la présence d'un patient dans une archive lisible, ou l'existence d'une archive illisible, empêche de le supprimer (§6.3).

**Archive abîmée** : une archive illisible, tronquée, d'un autre format ou dont les lignes n'ont pas la structure d'une prestation (même contrôle `controlerStructure` que le fichier actif) est **ignorée**, jamais source d'erreur pour l'appelant. Elle est listée dans `illisibles` (années) et signalée une seule fois par lancement au journal, par son seul nom de fichier (« Archive ignorée »), jamais par son contenu. Conséquences :
- export JSON : champ `archivesIllisibles` (liste des années) ajouté à l'export s'il y en a ;
- export CSV et compte des utilisations du catalogue : archives lisibles seulement ;
- suppression d'un type du catalogue : refusée (409 `CATALOGUE_UTILISE`) tant qu'une archive est illisible, puisqu'on ne peut pas garantir que le type n'y est pas référencé ; même règle pour la suppression d'un patient (409 `PATIENT_UTILISE`, `supprimable: false` dans `GET /api/patients`).

## 6. Règles du domaine

### 6.1 Montants et dates
- Montants : entiers `Number.isSafeInteger` (`src/domain/money.js`). La saisie « 1 250,50 » est convertie en centimes dans le navigateur (`public/js/format.js`, `lireMontant`) ; le serveur ne reçoit que des entiers.
- Texte d'export : `formaterCentimes` → `1250,50` (sans séparateur de milliers). Affichage : `Intl.NumberFormat('fr-FR')`.
- Dates civiles sans fuseau ; « aujourd'hui » = date locale du PC (`aujourdHuiLocal`), fournie au front par `/api/etat` et par chaque réponse de calcul. Écarts en jours calculés en UTC (insensibles à l'heure d'été). Semaine ISO 8601 `AAAA-Www`. Ajout de mois avec jour borné au dernier jour du mois.

### 6.2 État de paiement (par prestation, `src/domain/paiement.js`)
```
verse      = Σ versements.montantCentimes
paye       = min(verse, montant)
reste      = montant − paye                    (≥ 0)
tropPercu  = max(0, verse − montant)            (accepté, signalé par l'avertissement TROP_PERCU)
etat       = verse ≥ montant ? "paye" : verse = 0 ? "non_paye" : "partiel"
aVenir     = date > aujourd'hui
```
Une prestation à 0 € est « payée » d'office. Le trop-perçu reste attaché à sa ligne : il ne compense jamais le reste d'une autre prestation.

### 6.3 Registre des patients et textes saisis (`src/domain/patients.js`, `src/domain/validation.js`)
- **Normalisation** (`normaliserTexte`) : NFC, espaces de bord retirés, espaces internes réduits à un ; casse et accents conservés. C'est l'écriture enregistrée.
- **Clé de comparaison** (`clePatient`) : nom et prénom normalisés puis en minuscules (`fr`). **Insensible à la casse et aux espaces, sensible aux accents** : « LAPIN  pierre » et « Lapin Pierre » ont la même clé, « Cygne Lea » et « Cygne Léa » non. Le navigateur utilise exactement la même clé (`public/js/recherche-patients.js`, test croisé) ; seules les **suggestions** de saisie ignorent les accents (§11).
- **Homonymes** : plusieurs patients du registre de même clé. Ils ne sont jamais fusionnés ; la mention « homonyme » est **calculée** à la lecture (`listerPatients`), jamais stockée. Ils se distinguent par la date de leur dernière prestation ; les erreurs qui les concernent ne décrivent les candidats que par `{ id, dernierePrestation }`, sans nom.
- **Caractères refusés** (422 `VALIDATION`) : les caractères de contrôle sont refusés dans tous les textes ; les caractères **invisibles ou de mise en forme** (`CARACTERES_INVISIBLES` : césure conditionnelle, espaces et liants de largeur nulle, marques et isolats bidirectionnels, séparateurs de ligne et de paragraphe, sélecteurs de variante, caractères de remplissage, BOM, caractères de balisage) sont refusés dans le **nom** et le **prénom** du patient, le **motif** d'une prestation (création et modification) et le **libellé d'un tarif** du catalogue (ajout et modification). Deux textes « identiques à l'écran » ne peuvent donc pas différer par un caractère invisible, et un texte bidirectionnel ne peut pas brouiller l'affichage ni l'export.
- **Nom et prénom** : tous deux obligatoires, 100 caractères au plus après normalisation, mêmes refus de caractères que ci-dessus (422 `VALIDATION` avec `champs`).

**Patient d'une prestation** (`resoudrePatient(etat, identite, ctx)`, appelée par la création et la modification d'une prestation ; elle travaille sur le **registre** et peut l'enrichir dans la même écriture) :
- `patientId` : le patient doit exister au registre (sinon 422 `VALIDATION` sur `patientId`) ; s'il est archivé, il est **réactivé** (avertissement `PATIENT_REACTIVE`) ;
- `patient: { nom, prenom }` avec `nouveauPatient: true` : nouveau patient ajouté au registre, même si la clé existe (homonyme assumé) ;
- `patient: { nom, prenom }` seul : aucun patient de même clé → nouveau patient ajouté au registre ; **un seul** → rattachement (archivé → réactivé avec `PATIENT_REACTIVE` ; avertissement `PATIENT_RATTACHE` si le texte tapé diffère de l'écriture du registre) ; **plusieurs** → 409 `PATIENTS_HOMONYMES` (candidats sans nom). Les patients sans prestation et les patients archivés comptent comme candidats ;
- la copie posée dans la ligne est **toujours l'écriture du registre**, jamais le texte tapé.

**Opérations sur le registre** (`creerPatient`, `modifierPatient`, `supprimerPatient`, appelées par `/api/patients`, §9.2) :
- **Création** : patient actif sans prestation. Même clé qu'un patient existant, actif ou archivé → 409 `PATIENT_EXISTANT` avec `details.candidats` (sans nom), sauf `homonyme: true`. Deux requêtes simultanées (double clic) passent l'une après l'autre dans la file d'écriture : la seconde reçoit `PATIENT_EXISTANT`.
- **Renommage** (`renommerPatient`) : identifiant conservé ; nom et prénom normalisés ; un simple changement de casse ou d'espaces (même clé) est appliqué sans confirmation ; même clé qu'un **autre** patient → 409 `PATIENT_EXISTANT`, sauf `homonyme: true` (alors avertissement `PATIENT_HOMONYME`). Le nouveau nom est propagé à **toutes** les lignes du fichier actif de ce patient dont la copie diffère (leur `modifieLe` est mis à jour : un dialogue ouvert ailleurs sur l'une d'elles reçoit ensuite 409 `MODIFIEE_AILLEURS`) ; résultat `{ patient, lignesModifiees }`. Les archives ne sont pas touchées (§5.4). Aucune fusion de patients n'existe.
- **Archiver / réactiver** (`actif`) : sans effet si le patient est déjà dans l'état demandé (idempotent). Archiver un patient qui a des prestations à venir ou un reste à payer est autorisé, avec l'avertissement `PATIENT_ARCHIVE_EN_COURS` et ses nombres (`details: { aVenir, impayees }`). Les prestations d'un patient archivé restent partout (listes, récapitulatif, tableau de bord, exports, sauvegardes).
- **Suppression** : seulement pour un patient sans aucune prestation, ni dans le fichier actif, ni dans une archive lisible, et si aucune archive n'est illisible ; sinon 409 `PATIENT_UTILISE`. Sauvegarde `avant-suppression` préalable. Supprimer une prestation ne supprime jamais son patient, qui reste au registre (éventuellement sans prestation).

**Nom modifié depuis une prestation** (`PATCH /api/prestations/{id}`, `modifierPrestation`) :
- correction de même clé (casse, espaces) : c'est un **renommage du patient** dans le registre et sur toutes ses lignes, appliqué directement (une ligne ne peut pas garder une écriture différente de celle du registre) ;
- autre nom, sur une ligne d'un patient qui a d'autres lignes : 409 `RENOMMAGE_PATIENT` ; le client choisit `renommerPatient: true` (renommage du patient, toutes ses lignes ; un homonyme est alors accepté avec l'avertissement `PATIENT_HOMONYME`, sans confirmation) ou `detacherLigne: true` (la ligne seule est rattachée par `resoudrePatient` au patient correspondant au nouveau nom, ou à un nouveau patient) ; l'ancien patient reste au registre ;
- autre nom sur la seule ligne du patient, ou `patientId` : la ligne est rattachée par `resoudrePatient`.
- Une ligne dont le patient manque au registre (ligne orpheline) y est ajoutée, avec l'écriture de la ligne, avant un renommage depuis la prestation (`assurerAuRegistre`).

**Annulation** : la création, le renommage, l'archivage, la réactivation et la suppression d'un patient sont annulables comme les écritures de prestations (§6.4) ; annuler la création d'une prestation qui a créé un patient retire aussi ce patient, et annuler une prestation qui a réactivé un patient le rend de nouveau archivé.

**Réparation** : `reparerPatients` (ajout au registre des patients manquants, alignement des copies de même clé, mêmes règles que la migration, rien d'écrit s'il n'y a rien à faire) existe dans le domaine et est testée, mais **n'est exposée ni par l'API ni par l'interface** (§15, §16).

### 6.4 Opérations sur les prestations (`src/domain/prestations.js`)
- Création : statut `a_facturer`, aucun versement ; type exigé **actif**. Avertissement `DATE_FUTURE` si la date est postérieure à aujourd'hui.
- Modification partielle avec `modifieLe` attendu : 409 `MODIFIEE_AILLEURS` s'il a changé (deux onglets). Une ligne peut garder un type désactivé.
- Statut groupé (`ids` : 1 à 1 000) : `facture` pose `factureLe` (date fournie ou aujourd'hui), `a_facturer` l'efface ; les lignes déjà dans l'état demandé sont ignorées. Avertissements `DATE_FACTURATION_FUTURE`, `DATE_FACTURATION_AVANT_PRESTATION`, `FACTURATION_DATE_FUTURE`.
- Versement (ajout, modification de sa date, « Payé en totalité ») : avertissements non bloquants `VERSEMENT_AVANT_PRESTATION` (versement daté avant la prestation), **`VERSEMENT_DATE_FUTURE`** (versement daté après aujourd'hui : il serait compté dans un mois à venir par la vue « encaissé ») et `TROP_PERCU` ; le versement est enregistré. Le mode est mémorisé dans `dernierModePaiement`.
- « Payé en totalité » : un versement égal au reste, daté d'aujourd'hui (ou de la date fournie), mode fourni ou dernier mode utilisé ; 409 `DEJA_PAYEE` si le reste est nul ; 422 `MODE_REQUIS` si aucun mode n'a jamais été utilisé.
- **Annulation** de la dernière action (`store.annuler`) : le store retient les lignes touchées, les paramètres d'avant et le **registre des patients d'avant** (`patientsAvant`, restauré tel quel) ; possible tant qu'aucune autre écriture n'a eu lieu (même `revision`), perdue au redémarrage, sinon 409 `ANNULATION_IMPOSSIBLE`. Annuler une création de prestation est une suppression : sauvegarde `avant-suppression` préalable. Sont annulables les écritures des prestations, des versements et du registre des patients ; celles du catalogue et des paramètres ne le sont pas et effacent le jeton en cours.
- Il n'existe **pas** de détection de doublon de prestation (même patient, même date, même type ; prévue, §16).

### 6.5 Récapitulatif du mois et double vue (`src/domain/recap.js`)
`GET /api/recap?mois=AAAA-MM&vue=prestation|versement` regroupe par `patient.id` (tri nom, prénom, identifiant).
- **Vue `prestation`** (défaut) : lignes dont la **date** est dans le mois, tous statuts, à venir comprises. Par patient et au total : `nbPrestations`, `nbSeances` (catégorie `seance`), `nbAutres`, `nbAFacturer`, `nbAVenir`, `du = Σ montant`, `paye = Σ paye`, `reste = Σ reste`, `tropPercu = Σ tropPercu`. Invariant : `du = paye + reste`. État du groupe (`etatDepuisTotaux`) : `reste = 0` → payé ; `paye = 0` et `du > 0` → non payé ; sinon partiel.
- **Vue `versement`** (trésorerie) : `paye` = Σ des versements **datés** dans le mois, toutes prestations confondues (y compris d'autres mois), trop-perçu compris ; `du` reste celui des prestations du mois ; `reste`, `tropPercu` et `etat` valent `null`.
- **Mois proposés** (`moisDisponibles`, `moisProposes`) : mois contenant des prestations, mois en cours et mois demandé, du plus ancien au plus récent. En vue `versement`, les mois qui n'ont **que des versements** (prestation d'un autre mois payée plus tard) sont aussi proposés.
- `aFacturer` (global, tous mois) : lignes `a_facturer` de montant > 0 et de date ≤ aujourd'hui ; les lignes à venir sont comptées à part (`aVenirNombre`, `aVenirMontantCentimes`) ; les lignes à 0 € non facturées sont seulement dénombrées (`zeroNombre`).

### 6.6 Indicateurs (`src/domain/indicateurs.js`)
Période : mois `de` à `a` (défaut : les 12 derniers mois, mois en cours compris ; 60 mois au plus). Calculés sur le **fichier actif uniquement**.

**CA par mois, vue `prestation`** (lignes dont la date est dans le mois) :
```
payeCentimes      = Σ paye                               (quelle que soit la date du versement)
attenteCentimes   = Σ reste des lignes « facturé »        (y compris une prestation à venir déjà facturée)
aFacturerCentimes = Σ reste des lignes « à facturer » de date ≤ aujourd'hui
aVenirCentimes    = Σ reste des lignes « à facturer » de date > aujourd'hui
totalCentimes     = Σ montant = paye + attente + aFacturer + aVenir      (invariant)
tropPercuCentimes = Σ tropPercu                           (information, hors total)
```
**CA par mois, vue `versement`** : `encaisseCentimes` = Σ des versements datés dans le mois, trop-perçu compris.

**Séances** (`granularite=mois|semaine`) : lignes de catégorie `seance`, séparées en `realisees` (date ≤ aujourd'hui) et `aVenir` ; les autres catégories dans `autres`. Par semaine : semaines ISO, une semaine à cheval sur deux mois n'est comptée qu'une fois ; les semaines des bords sont marquées `partielle`.

**Répartition par type** : groupement par `prestationId`, `caCentimes = Σ montant` (CA dû), libellé = libellé actuel du catalogue, à défaut celui de la ligne la plus récente ; tri par CA décroissant, puis libellé. Part en **pour-mille** (`partPourMille`, entier) calculée en entiers par la **méthode du plus fort reste** :
```
part_i  = floor(ca_i × 1000 / total)          reste_i = (ca_i × 1000) mod total
manque  = 1000 − Σ part_i
les `manque` types de plus fort reste reçoivent +1 (à reste égal, le premier dans le tri l'emporte)
```
Les parts somment **exactement 1000** (toutes à 0 si le total est nul) ; les montants somment exactement au total.

**Reste à encaisser et ancienneté** : une ligne compte si `reste > 0` **et** (date ≤ aujourd'hui **ou** statut « facturé ») ; une prestation à venir non facturée n'est pas un impayé.
- Ancienneté = jours depuis `factureLe` (ligne facturée avec date), sinon depuis la date de prestation ; jamais négative.
- Tranches (`TRANCHES`, définies une seule fois côté serveur et transmises à l'interface par `/api/etat`, §9.2) : `0-29`, `30-59`, `60-89`, `90-plus` (30 jours pile → `30-59`).
- Sortie : `totalResteCentimes`, `nombre`, `resteFactureCentimes`, `resteNonFactureCentimes`, `factures[]` et `nonFactures[]` par tranche. Le même critère sert au filtre `anciennete` de `GET /api/prestations`.

**Synthèse** (`/api/indicateurs/synthese`) : toujours le mois en cours — reste à encaisser, à facturer global, CA du mois (vue prestation), séances du mois.

### 6.7 Prévisions (`src/domain/previsions.js`)
Grandeur prévue : le **CA dû** (Σ des montants, par date de prestation, tous statuts) ; les versements n'interviennent pas. `M` = mois en cours, `A` = aujourd'hui, fenêtre = 3 mois, horizon = 3 mois.

1. **Historique minimal** : nombre de mois **complets** entre la plus ancienne prestation et `M−1`. Le mois de la plus ancienne prestation ne compte que si elle est datée du 1er. Moins de 3 mois complets → `suffisant: false`, `base: null`, `mois: []`, `moisManquants` et `premiereEstimationLe` (1er jour du mois où l'estimation deviendra possible).
2. **Base** : `B = arrondi((CA(M−1) + CA(M−2) + CA(M−3)) / 3)`, un mois sans activité comptant 0.
3. **Mois en cours** : `R` = Σ montants de `M` avec date ≤ `A` ; `P` = Σ montants de `M` avec date > `A` ; `joursRestants = joursDuMois − jour(A)` (le jour même est considéré comme vécu) ; `Bf = arrondi(B × joursRestants / joursDuMois)` ; `estimation = R + max(P, Bf)`.
4. **Mois `M+1` à `M+3`** : `estimation = R + max(P, B)` (en pratique `R = 0`).
5. Sortie par mois : `{ mois, courant, realiseCentimes, planifieCentimes, complementEstimeCentimes = estimation − R − P, estimationCentimes }`.

Arrondi : `diviserArrondi(n, d) = floor((2n + d) / (2d))`, division entière, moitiés vers le haut, sans flottant.
Pourquoi `max` et non une somme : `B` représente un mois complet « typique », séances planifiées comprises ; additionner `P` et `B` compterait deux fois ce qui est déjà saisi. Limites : aucune saisonnalité, prorata en jours calendaires.

Exemple de contrôle (fictif) : `A = 2026-10-10`, CA juillet 120 000, août 60 000, septembre 150 000 (centimes) → `B = 110 000`. Octobre : `R = 40 000`, `P = 30 000`, 21 jours restants sur 31 → `Bf = 74 516`, estimation 114 516. Novembre planifié 20 000 → 110 000 ; janvier planifié 150 000 → 150 000.

### 6.8 Export CSV (`src/domain/csv.js`)
Séparateur `;`, décimale virgule sans séparateur de milliers, dates `JJ/MM/AAAA`, UTF-8 avec BOM, fins de ligne CRLF, guillemets doublés. Toute cellule commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot est préfixée d'une apostrophe (anti-injection de formule). Colonnes :
- prestations : `id;date;nom;prenom;prestation;categorie;motif;montant;statut;facture_le;verse;reste;trop_percu;etat;nb_versements` ;
- versements : `prestation_id;date_prestation;nom;prenom;date_versement;mode;montant`.

## 7. Stockage

### 7.1 État en mémoire et file d'écriture (`src/store/store.js`)
```
ouvrirStore({ dossier, horloge, journal, fs?, migrations?, etatInitial? }) → Store
store.lire({ brut? })              instantané gelé (Object.freeze récursif) ; 503 en mode dégradé
store.muter(raison, fn, options)   écriture sérialisée → { etat, avertissements, resultat, annulation }
store.annuler(jeton)               annulation de la dernière écriture
store.sauvegardes()                liste détaillée des sauvegardes
store.sauvegarderMaintenant()      sauvegarde manuelle
store.restaurer(nom, options)      restauration d'une sauvegarde
store.repartirDeZero()             fichier vide (seulement en mode dégradé, sans sauvegarde restaurable)
store.verifierFichier()            contrôle d'empreinte, ou relecture en mode dégradé
store.etat()                       drapeaux pour /api/etat
store.fermer()                     attend la fin de la file (5 s au plus)
```
Toutes les opérations qui écrivent passent par **une file unique** (chaîne de promesses) ; une tâche en échec n'interrompt pas la file. Déroulé d'une mutation (`executer`) :
1. refus si mode dégradé (503 `DONNEES_ILLISIBLES`) ou lecture seule (503 `SCHEMA_PLUS_RECENT`) ;
2. contrôle d'empreinte (§7.6) ; conflit → 409 `CONFLIT_FICHIER` ;
3. copie de travail (`structuredClone`), application de `fn` (fonction du domaine), `revision + 1`, `majLe`, `controlerStructure` (échec → 500 sans écriture) ;
4. sauvegarde quotidienne si c'est la première modification du jour, puis sauvegarde préalable si l'option `sauvegardeAvant` est donnée (son échec annule l'opération : 503 `SAUVEGARDE_ECHOUEE`) ;
5. écriture atomique ; **seulement après succès**, nouvel état en mémoire, puis nouvelle empreinte (`memoriser`), puis jeton d'annulation. L'état est posé **avant** la relecture de la date et de la taille du fichier : un échec de cette relecture ne laisse jamais la mémoire en retard sur le disque.

Une saisie refusée par la validation ne crée aucune sauvegarde. Le verrou d'instance (§8.2) garantit qu'un seul processus écrit dans un dossier de données sur cette machine ; la file en mémoire suffit donc.

### 7.2 Écriture atomique (`src/store/fichier-atomique.js`)
1. écriture dans `<fichier>.tmp-<pid>-<n>` dans le même dossier (ouverture exclusive `wx`, droits `0600` : le renommage les conserve, le fichier final est donc en `0600` sous Linux et macOS) ;
2. `sync()` puis fermeture ;
3. `rename` de remplacement ;
4. sur `EPERM`, `EBUSY`, `EACCES` (fichier tenu par un client de synchronisation ou un antivirus sous Windows) : nouvelles tentatives après 50, 100, 200, 400 et 800 ms ; échec final → 503 `FICHIER_VERROUILLE` ; toute autre erreur → 503 `ECRITURE_ECHOUEE`. Le temporaire est supprimé, l'état en mémoire reste inchangé.

Au démarrage, les temporaires orphelins sont supprimés, uniquement s'ils correspondent exactement aux motifs `suivi-facturation.json.tmp-<pid>-<n>`, `archive-AAAA.json.tmp-<pid>-<n>` et, dans `sauvegardes/`, `sauvegarde-…json.tmp-<pid>-<n>`. Le `fsync` du dossier n'est pas utilisé.

Le temporaire du **verrou d'instance** suit une autre règle (§8.2).

### 7.3 Sauvegardes (`src/store/sauvegardes.js`)
- Nom : `sauvegarde-AAAA-MM-JJ_HHhMMmSSs_<raison>[-n].json` (heure locale ; suffixe `-2`, `-3`… dans la même seconde, jamais d'écrasement). Contenu : copie octet pour octet du fichier sur le disque (ou, pour `conflit-memoire`, la version en mémoire sérialisée). Écriture atomique (fichier en `0600`) ; dossier `sauvegardes/` créé en `0700`.
- Trois réserves de rotation :

| Réserve | Raisons | Conservation |
|---|---|---|
| quotidienne | `demarrage`, `quotidienne`, `manuelle` | réglage `sauvegardesConservees` = nombre de **jours** d'historique, ramené entre 7 et 365 (détail ci-dessous) |
| opération | `avant-suppression`, `avant-migration` (et `avant-archivage`, reconnue mais non produite aujourd'hui : réservée à l'archivage prévu) | 30 dernières |
| conservée | `avant-restauration`, `avant-reinitialisation`, `conflit-disque`, `conflit-memoire` | supprimées après 90 jours |

- **Rotation quotidienne en jours** (`rotationParJours`) : le réglage « Nombre de jours d'historique à conserver » (Paramètres) compte des **jours civils** (heure locale, d'après le nom des fichiers), pas des fichiers. Sont gardées :
  1. **toutes** les sauvegardes quotidiennes du **jour courant**, avec un plafond de sécurité de 50 (`MAX_PAR_JOUR` ; au-delà, les plus anciennes du jour partent d'abord) ;
  2. puis la **dernière** sauvegarde de chacun des **N − 1 jours précédents** ayant au moins une sauvegarde (les jours sans sauvegarde ne comptent pas).
  Jour courant = jour de l'horloge ; un jour postérieur (horloge reculée) est traité comme le jour courant. Le réglage utilisé est toujours le réglage courant du fichier (7 à 365), jamais celui d'une sauvegarde restaurée ni une valeur par défaut ; tant qu'aucun fichier n'a été lu, la réserve quotidienne n'est pas touchée.
- **Démarrage** : sauvegarde du fichier, sauf s'il est identique (SHA-256) à la plus récente sauvegarde de la réserve quotidienne ; elle compte comme sauvegarde du jour.
- **Quotidienne** : avant la première modification de chaque jour civil (jour retenu en mémoire).
- **Avant opération** : suppression d'une prestation, d'un versement, d'un type du catalogue ou d'un patient, annulation d'une création de prestation (`avant-suppression`) ; migration d'un fichier de version antérieure (`avant-migration`, §7.4).
- **Échec** d'une sauvegarde de démarrage ou quotidienne : avertissement persistant `SAUVEGARDE_ECHOUEE` (dans `/api/etat` et dans les réponses de mutation), l'application continue, l'échec est journalisé.
- **Rotation** après chaque sauvegarde créée : uniquement les fichiers de `sauvegardes/` dont le nom correspond exactement au motif. Aucune rotation en mode dégradé, pendant une restauration ou une remise à zéro. Une suppression impossible (fichier occupé) est retentée à la rotation suivante et journalisée (nombre de fichiers et code d'erreur) ; une rotation en échec ne compromet jamais la sauvegarde qui vient d'être créée.

### 7.4 Restauration et migration de schéma (`src/store/restauration.js`, `src/store/store.js`, `src/domain/schema.js`)

**Restauration** (`store.restaurer`)
- `GET /api/sauvegardes` lit et contrôle chaque fichier : taille, lisibilité, restaurable, raison du refus, version de schéma, nombre de prestations et de patients, première et dernière date, révision, `majLe`. Le nombre de patients est la taille du registre (patients sans prestation compris) ; pour une sauvegarde de version 1, le registre est reconstruit en mémoire par la migration, sans rien écrire.
- Restauration (dans la file, possible dans tous les modes : normal, dégradé, conflit, lecture seule) :
  1. nom contrôlé par le motif strict des sauvegardes (jamais un chemin), sinon 404 ;
  2. en mode dégradé, relecture du fichier actif ; s'il est redevenu lisible et que la décision vient de l'écran dégradé (`depuisModeDegrade`), refus 409 `FICHIER_REVENU` ;
  3. contrôle de la sauvegarde (format, version ≤ courante, migration, structure) ; sinon 422 `SAUVEGARDE_INCOMPATIBLE`, rien n'est touché ;
  4. si le disque a changé sans avoir été vu, conflit déclaré et version en mémoire copiée (`conflit-memoire`) ; échec de cette copie → annulation ;
  5. sauvegarde `avant-restauration` du fichier actuel tel qu'il est sur le disque (même illisible) ; échec → annulation ;
  6. `revision = max(révisions connues) + 1`, réglage `sauvegardesConservees` courant conservé, écriture atomique, puis rechargement de l'état et de l'empreinte ; tous les drapeaux d'anomalie sont levés.
- **Repartir d'un fichier vide** (`POST /api/fichier-vide`) : seulement en mode dégradé `absent` ou `illisible` et si aucune sauvegarde n'est restaurable (sinon 409 `SAUVEGARDE_RESTAURABLE`) ; le fichier existant est d'abord copié (`avant-reinitialisation`).
- La restauration ne concerne que le fichier actif. L'export JSON complet (§9.2) est une copie de dépannage : l'application ne sait pas le restaurer.
- **Sauvegarde de version 1** : elle est migrée en mémoire (étape 3) puis écrite **en version courante**, registre reconstruit comme pour un fichier actif ; la sauvegarde elle-même n'est pas modifiée. Une sauvegarde de version plus récente est refusée (422 `SAUVEGARDE_INCOMPATIBLE`).

**Migration 1 → 2 au chargement** (`charger` dans `store.js`, `migrerV1VersV2` et `reconstruireRegistre`, fonctions pures sans horloge)
1. Le fichier lu est de format reconnu et de version 1 (une version plus récente que la version courante n'est jamais migrée : lecture seule, §5.3).
2. Migration **en mémoire**, sur une copie :
   - les lignes sont groupées par `patient.id` ; pour chaque identifiant, la ligne de référence est la **plus récente** (date, puis `creeLe`) ; le patient est créé avec son nom et son prénom normalisés, **actif** (aucun patient n'est archivé d'office, même sans activité récente) ;
   - les copies sont **alignées** : une ligne dont la clé est celle du patient reçoit l'écriture du registre (« dupont » devient « Dupont » si la ligne la plus récente porte « Dupont ») ; une ligne de clé **différente** sous le même identifiant n'est pas modifiée (elle reste signalée comme copie divergente, §5.2) ;
   - `modifieLe` des lignes n'est jamais changé (ce n'est pas une saisie) ; le registre est trié ; `schemaVersion` passe à 2. Les champs inconnus du niveau supérieur sont conservés ; un champ `patients` déjà présent dans un fichier de version 1 est reconstruit.
3. Contrôle de structure du résultat (§5.2).
4. Sauvegarde `avant-migration` : copie **octet pour octet** du fichier d'origine (réserve « opération », §7.3), créée **avant** toute écriture.
5. Écriture atomique du fichier migré, puis empreinte ; la sauvegarde de démarrage habituelle suit (fichier migré). Une ouverture suivante ne migre plus rien.

Cas limites (vérifiés par les tests) :

| Cas | Résultat |
|---|---|
| fichier sans prestation | registre vide |
| homonymes (deux identifiants, même clé) | deux patients distincts, mention « homonyme » calculée à l'affichage |
| même identifiant, casse ou espaces différents | un patient, écriture de la ligne la plus récente, copies alignées |
| même identifiant, clés différentes (fichier retouché) | un patient (l'identifiant fait foi), nom de la ligne la plus récente ; les autres copies sont laissées et signalées |
| ligne sans nom ou sans prénom, ligne sans patient | migration refusée par le contrôle de structure : mode dégradé |

**Échec** (structure invalide après migration, sauvegarde `avant-migration` impossible, écriture refusée par le disque ou un verrou) : le fichier d'origine n'est **pas modifié** et l'application passe en mode dégradé `illisible` (« La mise à jour du fichier de données vers la version actuelle a échoué ») ; la restauration d'une sauvegarde reste possible (§7.5).

**Retour arrière** : la sauvegarde `avant-migration` est un fichier de version 1 ; une version de l'application antérieure au registre sait la restaurer. La version actuelle, elle, la migrerait de nouveau à la restauration.

### 7.5 Modes dégradés
| Situation au chargement | Comportement |
|---|---|
| fichier absent, dossier sans archive ni sauvegarde | fichier créé (catalogue vide) |
| fichier absent, archives ou sauvegardes présentes | **rien n'est créé** ; mode dégradé `absent` (synchronisation pas terminée, nouveau PC) |
| fichier absent et dossier des sauvegardes illisible | **rien n'est créé** ; mode dégradé `lecture` |
| lecture impossible (accès refusé, verrouillé) | mode dégradé `lecture` |
| JSON illisible, format inconnu, structure incohérente, migration en échec | mode dégradé `illisible` ; le fichier n'est **jamais** écrasé |
| version de schéma plus récente | lecture seule (§5.3) |

Pour décider s'il existe des sauvegardes, un dossier absent (`ENOENT`) ou un fichier qui occupe la place du dossier (`ENOTDIR`) signifie « rien ici » ; toute autre erreur de lecture empêche la création d'un fichier vide.

En mode dégradé, le serveur démarre quand même ; seules répondent utilement `/api/sante`, `/api/etat`, `GET /api/sauvegardes`, la restauration, `/api/fichier-vide`, `/api/arreter` et `/api/presence` ; les autres lectures répondent 503. Chaque `GET /api/etat` relit le fichier : s'il est revenu lisible (synchronisation terminée), l'application sort du mode dégradé sans rien écraser, puis fait la sauvegarde de démarrage.

### 7.6 Détection de conflit de synchronisation (niveau minimal, `src/store/conflit.js`)
- Empreinte `{ mtimeMs, taille, sha256 }` mémorisée après chaque lecture et écriture.
- Contrôle avant chaque écriture et à chaque `GET /api/etat` : `mtime` et taille inchangés → rien ; sinon lecture et SHA-256 : identique → seule la date a changé ; différent → conflit `modifie` ; fichier disparu → conflit `disparu`.
- En conflit : deux sauvegardes `conflit-disque` (version du disque) et `conflit-memoire` (version de l'application), événement journalisé, écritures refusées (409 `CONFLIT_FICHIER`). `/api/etat` expose les chiffres de chaque version (nombre de prestations, révision, `majLe`).
- Résolution : l'interface propose de **garder une version**, ce qui revient à restaurer la sauvegarde correspondante (§7.4). Aucune fusion, aucune version présentée comme la bonne.
- Rappel au démarrage (`conflitNonResolu`) : si la dernière copie `conflit-memoire` est plus récente (date du fichier) que le fichier actif, le conflit est considéré comme non résolu et rappelé.
- Ce niveau ne détecte **pas** les copies de conflit créées par un client de synchronisation dans le dossier de données (prévu, §16), ni l'ouverture simultanée sur deux ordinateurs (le verrou d'instance est local à la machine).

## 8. Cycle de vie du processus

### 8.1 Ordre de démarrage (`src/server.js`)
1. Chargement de `.env` s'il existe (`process.loadEnvFile`), sauf si `ERGO_SANS_ENV=1` ; une variable déjà définie n'est jamais remplacée.
2. Dossier du journal (`ERGO_LOG_DIR` ou `logs/`, contrôlé par `resoudreDossierJournal`, §13.1) et ouverture du journal ; un `ERGO_LOG_DIR` refusé est écrit dans le journal par défaut puis le démarrage s'arrête (code 2).
3. Lecture de la configuration (`lireConfig` : port, arrêt automatique) et de la version (`package.json`).
4. **Verrou d'instance** (§8.2), avant tout accès au dossier de données : déjà lancée → code 3 ; ancienne instance bloquée → code 4 ; verrou impossible à créer, dossier des verrous refusé → code 2.
5. Sonde du port sur `127.0.0.1` (`portEstLibre`) : occupé, ou impossible à ouvrir (port réservé par le système, accès refusé, adresse indisponible) → code 2, aucun fichier de données touché.
6. Contrôle du dossier de données (`verifierDossierDonnees`, §13.2).
7. Ouverture du stockage : nettoyage des temporaires, chargement (§7.5), sauvegarde de démarrage et rotation, recherche d'un conflit non résolu.
8. Si le verrou repris était périmé : avertissement « dernier arrêt anormal » avec le résultat du contrôle du fichier.
9. Création de l'arrêt propre (§8.5), de la présence et du serveur, `listen(port, '127.0.0.1')` (un échec de liaison à ce moment donne aussi le code 2), port inscrit dans le verrou, démarrage de la surveillance de présence, ligne « Démarrage » dans le journal et adresse affichée en console.
10. À partir de là, un signal déclenche l'arrêt propre.

### 8.2 Verrou d'instance (`src/verrou.js`)
- Une seule instance par **dossier de données**, quel que soit le port. Fichier `suivi-facturation-<16 caractères hexadécimaux du SHA-256 du chemin réel>.verrou` (chemin en minuscules sous Windows), jamais dans le dossier de données, qui peut être synchronisé (refus, code 2). Contenu : `{ pid, port, demarreLe, version, dossier }`, aucune donnée de patient.
- **Dossier des verrous** :
  - `ERGO_VERROU_DIR` s'il est défini (contrôlé comme les autres dossiers configurables, §13.1) ;
  - sinon un dossier **propre à l'utilisateur**, créé en `0700` : sous Windows et macOS, sous-dossier `suivi-facturation-verrous` du dossier temporaire de l'utilisateur ; sous Linux, `$XDG_RUNTIME_DIR/suivi-facturation`, à défaut `~/.local/state/suivi-facturation/verrous`.
  - Là où le système expose les propriétaires (`process.getuid`, donc Linux et macOS), ce dossier par défaut est **refusé** (code 2, l'application ne démarre pas) s'il n'est pas un dossier ordinaire (lien, fichier), s'il n'appartient pas à l'utilisateur courant ou s'il est modifiable par le groupe ou les autres ; un fichier verrou appartenant à un autre utilisateur est refusé de la même façon, sans être touché. Sous Windows, les droits viennent du profil de l'utilisateur.
- Création exclusive (`wx`, droits `0600`). États lus : `absent` ; `perime` (PID mort, contenu illisible, ou PID réutilisé, voir ci-dessous) ; `actif` (PID vivant **et** `GET /api/sante` répond `application: "suivi-facturation"`, délai 1,5 s) ; `bloque` (PID vivant sans réponse valide, ou fichier présent mais impossible à ouvrir).
- **PID réutilisé** (le verrou a survécu à un redémarrage de l'ordinateur et son PID désigne un autre processus) : l'heure de démarrage du processus de ce PID est comparée à l'heure `demarreLe` du verrou ; s'il a démarré plus de 5 s après, le verrou est jugé `perime`. Lecture de l'heure : PowerShell (`Get-Process`, sans fenêtre) sous Windows, `/proc/<pid>/stat` sous Linux (repli sur `ps`), `ps -o lstart=` sous macOS ; commande bornée à 5 s, une seule lecture par PID et par opération. Heure inconnue : la règle `bloque` est conservée et un avertissement est écrit une fois au journal.
- Un verrou `bloque` de moins de 15 s est traité comme un démarrage en cours : attente, sans agir. Un verrou périmé est repris sous un mutex `<verrou>.reprise` (un seul processus le supprime ; mutex lui-même jugé périmé après 10 s).
- Réessais sur `EPERM`/`EBUSY`/`EACCES` et contenu incomplet : attente aléatoire de 10 à 60 ms pendant 2 s au plus ; chaque série épuisée est journalisée.
- **Port d'écoute** : inscrit une fois le serveur à l'écoute (`mettreAJourPort`), seulement si le verrou porte encore le PID du processus. Réécriture atomique : temporaire `<verrou>.<pid>.<uuid>.tmp` (nom imprévisible, création exclusive `wx`, droits `0600` : jamais d'écriture à travers un fichier ou un lien existant), puis renommage sur le verrou. Un échec est journalisé sans arrêter le serveur (une autre instance conclura alors « bloquée » au lieu de « déjà lancée »).
- Le verrou est libéré à tout arrêt, seulement s'il porte encore le PID du processus (réessais réduits à 0,5 s, car synchrones). Un verrou `bloque` n'est jamais supprimé ni son processus arrêté automatiquement.
- Le verrou ne protège pas contre deux ordinateurs ouvrant le même dossier synchronisé.

### 8.3 Codes de sortie du serveur
| Code | Signification |
|---|---|
| 0 | arrêt propre (bouton, signal, arrêt automatique), y compris sortie forcée par le garde-temps |
| 1 | erreur inattendue au démarrage, exception ou rejet non géré, échec de l'arrêt propre |
| 2 | configuration refusée : variable invalide, dossier de données, du journal ou des verrous refusé, port occupé ou impossible à ouvrir, verrou impossible à créer |
| 3 | application déjà lancée sur ce dossier de données |
| 4 | une ancienne instance est présente mais ne répond plus (rien n'est arrêté, rien n'est touché) |

### 8.4 Journal (`src/journal.js`)
- Fichier `suivi-facturation.log` dans `logs/` (ou `ERGO_LOG_DIR`), une ligne par **événement** : horodatage local ISO avec décalage, niveau `INFO`/`AVERT`/`ERREUR`, message sur une ligne. Écriture synchrone (la ligne est sur le disque avant un `process.exit`). Fichier créé en `0600`, dossier en `0700`.
- Rotation : au-delà de 1 Mo, le fichier devient `suivi-facturation.log.1` (un seul fichier précédent conservé).
- Contenu : démarrage (version, port, chemin du dossier de données), arrêts et leur origine, mode dégradé, conflit, échecs de sauvegarde et de rotation, archives ignorées (nom du fichier), verrou, erreurs HTTP 5xx (une fois par minute pour une même erreur), lignes « Lanceur : » des scripts. **Jamais** de requête normale, de nom, de motif, de montant ni de message d'erreur : `decrireErreur` ne garde que le nom, le code et trois lignes de pile.
- Un échec d'écriture ne fait jamais planter l'application : repli sur la sortie d'erreur.
- La console reçoit en plus une ligne par requête (méthode, chemin **sans** paramètres, statut, code d'erreur), hors battements de présence.

### 8.5 Arrêt propre, garde-temps, signaux (`src/arret.js`)
`creerArret` renvoie la fonction `arreter(origine)` ; un second appel est sans effet. Ordre :
1. **garde-temps** de 5 s armé en premier, jamais désarmé : à l'échéance, sortie forcée avec le code 0 (avertissement au journal ; verrou libéré par le gestionnaire `exit`) ;
2. **plus de nouvelles requêtes** : l'écoute est fermée (`cesserEcoute`), les connexions déjà ouvertes finissent leur travail ;
3. **file d'écriture vidée** (`store.fermer`) ;
4. **connexions restantes fermées** (`fermerConnexions`), puis attente de la fermeture complète de l'écoute ;
5. **verrou libéré**, ligne « Arrêt propre (<origine>) » au journal, sortie 0.

Une erreur pendant ces étapes est écrite au journal (sans message), le verrou est libéré et le processus sort avec le code 1.
- Origines : `POST /api/arreter` (bouton « Quitter l'application », scripts d'arrêt ; la réponse 202 est envoyée avant l'arrêt), arrêt automatique, signaux `SIGINT`, `SIGTERM`, `SIGBREAK` (Windows), `SIGHUP` (fermeture d'un terminal Linux/macOS). Avant la fin du démarrage, un signal libère simplement le verrou et sort.
- Exception ou rejet non géré : écrit au journal (sans message), verrou libéré, sortie 1.
- **Fermeture anormale** (processus tué, coupure de courant) : le fichier de données reste entier grâce à l'écriture atomique ; le verrou reste sur le disque, il est jugé périmé et repris au démarrage suivant avec un avertissement.

### 8.6 Présence et arrêt automatique (`src/presence.js`, `public/js/presence.js`)
- Activé par `ERGO_ARRET_AUTO=1` (désactivé par défaut pour `npm start` ; le lanceur silencieux et la démonstration l'activent, §12). Désactivé, les signaux sont validés puis ignorés.
- Chaque page envoie `{ id, etat: "ouverte" }` toutes les 15 s, et `{ id, etat: "fermee" }` par `navigator.sendBeacon` à l'événement `pagehide` ; un retour depuis le cache avant/arrière (`pageshow` persistant) renvoie aussitôt un battement.
- `id` est un identifiant **par chargement de page** (`crypto.randomUUID()`), jamais stocké : un onglet dupliqué, qui recopie le stockage de session, a donc le sien et sa fermeture n'arrête pas l'application tant que l'autre onglet est ouvert. Une navigation ou un rechargement change d'identifiant ; le délai de grâce couvre ce passage. Motif `[A-Za-z0-9-]{8,64}`, 50 identifiants au plus retenus par le serveur.
- Le serveur contrôle toutes les 5 s : une page sans battement depuis `ERGO_ARRET_DELAI_PULSATION_S` (600 s) est oubliée ; quand la dernière page disparaît, délai de grâce de `ERGO_ARRET_DELAI_FERMETURE_S` (10 s), annulé par toute page qui se signale ; aucune page connectée `ERGO_ARRET_DELAI_PREMIERE_PAGE_S` (300 s) après le démarrage → arrêt. Un écart de plus de 60 s entre deux contrôles (mise en veille) remet les compteurs à zéro sans rien déclencher.
- L'arrêt automatique est l'arrêt propre (§8.5), avec sa raison dans le journal. Côté page, deux échecs de battement consécutifs affichent une seule fois « L'application est arrêtée » et plus rien n'est envoyé.

## 9. API HTTP

### 9.1 Conventions (`src/http/`)
- Préfixe `/api`, JSON UTF-8, `Cache-Control: no-store`. `HEAD` est accepté partout où `GET` l'est.
- Corps de requête : `Content-Type: application/json` obligatoire (415 `TYPE_CONTENU`), 1 Mo au plus (413 `TROP_VOLUMINEUX`), objet JSON valide (400), champs inconnus refusés (400 `REQUETE_INVALIDE`). Exception : `/api/presence` accepte aussi `text/plain` (format envoyé par `sendBeacon`), 512 octets au plus. Le corps est toujours lu jusqu'au bout pour que la réponse d'erreur parvienne au client.
- **Corps non attendus** : les routes qui n'en attendent pas (les `DELETE`, `POST /api/arreter`, `POST /api/sauvegardes`, `POST /api/annulations/{jeton}`) le vident sans le lire ni le conserver (`ignorerCorps`), avec une **borne de 1 Mo** : au-delà, la connexion est fermée. « Payé en totalité » accepte un corps absent (objet vide) ou un corps JSON soumis aux contrôles ordinaires (`lireCorpsOptionnel`).
- Montants en `…Centimes`, dates `AAAA-MM-JJ`, mois `AAAA-MM`. Paramètres de requête inconnus refusés (400).
- Réponse de mutation : `{ donnees, avertissements: [{ code, message, details? }], annulation }` (jeton pour les prestations, les versements et le registre des patients ; `null` pour le catalogue et les paramètres).
- Lignes renvoyées « enrichies » : ligne stockée + `verseCentimes`, `payeCentimes`, `resteCentimes`, `tropPercuCentimes`, `etat`, `aVenir`.
- **Aucune donnée nominative dans les URL** : le filtre par nom est appliqué dans le navigateur ; les URL ne portent au plus qu'un identifiant de patient opaque (`patientId`, `/api/patients/{id}`).
- Erreur : `{ "erreur": { "code", "message", "champs"?, "details"? } }`, message français, jamais de pile. Toute erreur non prévue devient 500 `ERREUR_INTERNE` avec un message générique.
- Chemin connu avec une autre méthode : 405 `METHODE_REFUSEE` ; chemin inconnu : 404 `INTROUVABLE`.

### 9.2 Routes
| Méthode et chemin | Rôle | Erreurs propres |
|---|---|---|
| `GET /api/sante` | `{ ok, application: "suivi-facturation", version, pid }` (sondes du verrou et des lanceurs) | — |
| `GET /api/etat` | contrôle d'empreinte ou relecture, puis : `version`, `aujourdHui`, `dossier`, `tailleOctets`, `nombrePrestations`, `sauvegardesConservees`, `modeDegrade`, `erreur`, `lectureSeule`, `structureInconnue`, `conflit`, `conflitNonResolu`, `avertissements`, `derniereSauvegarde`, `dernierModePaiement`, `arretAuto`, `demonstration` (vrai seulement pour `npm run demo`), `tranchesAnciennete` (`[{ id, libelle }]`, tranches d'ancienneté des impayés, §6.6) | — |
| `GET /api/catalogue` | catalogue complet + `utilisations` par type (fichier actif et archives lisibles) | 503 |
| `POST /api/catalogue` | ajout `{ libelle, tarifCentimes, categorie }` (actif, placé en dernier) → 201 | 422 |
| `PATCH /api/catalogue/{id}` | `libelle`, `tarifCentimes`, `categorie`, `actif`, `ordre` ; sans effet rétroactif | 404, 422 |
| `DELETE /api/catalogue/{id}` | seulement si jamais utilisé ; sauvegarde `avant-suppression` | 409 `CATALOGUE_UTILISE` (y compris si une archive est illisible) |
| `PATCH /api/parametres` | `{ sauvegardesConservees }` (entier 7 à 365, en jours) | 400, 422 |
| `GET /api/patients` | registre complet (actifs et archivés, filtrés dans le navigateur), trié nom, prénom : `{ patients: [{ id, nom, prenom, actif, nombrePrestations, dernierePrestation, homonyme, supprimable }] }`. `nombrePrestations` et `dernierePrestation` (date ou `null`) portent sur le fichier actif ; `homonyme` = un autre patient a la même clé ; `supprimable` = aucune prestation dans le fichier actif ni dans une archive lisible, et aucune archive illisible. Aucun paramètre accepté | 400, 503 |
| `POST /api/patients` | `{ nom, prenom, homonyme? }` → 201 `{ donnees: { id, nom, prenom, actif: true }, avertissements, annulation }` | 400, 409 `PATIENT_EXISTANT`, 422 `VALIDATION` |
| `PATCH /api/patients/{id}` | `{ nom?, prenom?, actif?, homonyme? }` (au moins un de `nom`, `prenom`, `actif`) : renommage propagé aux lignes et/ou archivage, réactivation → `{ donnees: { patient, lignesModifiees }, avertissements, annulation }` | 400, 404, 409 `PATIENT_EXISTANT`, 422 |
| `DELETE /api/patients/{id}` | patient sans prestation ; sauvegarde `avant-suppression` → `{ donnees: { id }, avertissements, annulation }` | 404, 409 `PATIENT_UTILISE`, 503 `SAUVEGARDE_ECHOUEE` |
| `GET /api/prestations` | filtres `mois`, `de`, `a`, `patientId`, `statut`, `etat` (liste `non_paye,partiel,paye`), `aVenir`, `anciennete` ; → `{ lignes, total, moisDisponibles }` (mois contenant des prestations), tri par date puis création | 400 |
| `GET /api/prestations/{id}` | une ligne enrichie | 404 |
| `POST /api/prestations` | `{ patientId \| patient:{nom,prenom}, nouveauPatient?, date, prestationId, montantCentimes, motif? }` → 201 ; le patient est pris dans le registre, ou ajouté au registre dans la même écriture (§6.3) | 422, 409 `PATIENTS_HOMONYMES` |
| `POST /api/prestations/statut` | `{ ids, statut, date? }` → `{ modifiees }` | 400, 404, 422 |
| `PATCH /api/prestations/{id}` | champs partiels + `modifieLe` ; `renommerPatient?`, `detacherLigne?` | 409 `MODIFIEE_AILLEURS`, `RENOMMAGE_PATIENT`, `PATIENTS_HOMONYMES` |
| `DELETE /api/prestations/{id}` | supprime la ligne et ses versements ; sauvegarde `avant-suppression` | 404, 503 `SAUVEGARDE_ECHOUEE` |
| `POST /api/prestations/{id}/versements` | `{ montantCentimes, date, mode }` → 201 | 404, 422 |
| `PATCH /api/prestations/{id}/versements/{vid}` | champs partiels | 404, 422 |
| `DELETE /api/prestations/{id}/versements/{vid}` | sauvegarde `avant-suppression` | 404 |
| `POST /api/prestations/{id}/payer-totalite` | corps facultatif `{ date?, mode? }` → 201 | 409 `DEJA_PAYEE`, 422 `MODE_REQUIS` |
| `POST /api/annulations/{jeton}` | annule la dernière écriture | 409 `ANNULATION_IMPOSSIBLE` |
| `GET /api/recap` | `mois`, `vue` → récapitulatif (§6.5) + `aujourdHui`, `moisDisponibles` (selon la vue), `aFacturer`, `fichierVide` | 400 |
| `GET /api/indicateurs/synthese` | indicateurs de tête du mois en cours | 400 |
| `GET /api/indicateurs/ca-mensuel` | `de`, `a`, `vue=prestation\|versement` | 400 |
| `GET /api/indicateurs/seances` | `de`, `a`, `granularite=mois\|semaine` | 400 |
| `GET /api/indicateurs/repartition` | `de`, `a` ; parts en pour-mille (§6.6) | 400 |
| `GET /api/indicateurs/impayes` | `de`, `a` acceptés mais sans effet (toutes les lignes) | 400 |
| `GET /api/indicateurs/prevision` | aucun paramètre ; historique insuffisant = 200 avec `suffisant: false` | 400 |
| `GET /api/sauvegardes` | liste détaillée (§7.4) | — |
| `POST /api/sauvegardes` | sauvegarde manuelle → 201 `{ nom }` | 409 `FICHIER_ABSENT`, 503 |
| `POST /api/sauvegardes/{nom}/restaurer` | `{ confirmer: true, depuisModeDegrade? }` | 404, 409 `FICHIER_REVENU`, 422 `SAUVEGARDE_INCOMPATIBLE`, 503 |
| `POST /api/fichier-vide` | `{ confirmer: true }` → 201 | 409 `FICHIER_REVENU`, `SAUVEGARDE_RESTAURABLE`, `REINITIALISATION_REFUSEE` |
| `GET /api/export` | `format=json` (défaut) : `{ format: "suivi-facturation-export", exporteLe, actif, archives, archivesIllisibles? }` ; `format=csv&contenu=prestations\|versements` (actif + archives lisibles) ; `Content-Disposition: attachment`, nom daté | 400, 503 (CSV impossible en lecture seule) |
| `POST /api/arreter` | arrêt propre → 202 `{ arret: true }`, puis arrêt | — |
| `POST /api/presence` | `{ id, etat: "ouverte"\|"fermee" }` → 204 | 400 |

Les écritures du registre des patients suivent les règles communes de `store.muter` (§7.1) : file unique, 409 `CONFLIT_FICHIER`, 503 en mode dégradé (`DONNEES_ILLISIBLES`) et en lecture seule (`SCHEMA_PLUS_RECENT`), où la liste reste lisible. Aucune route de réparation des incohérences n'existe (§15). `GET /api/export?format=json` contient le registre dans `actif.patients` ; l'export CSV est inchangé (il lit les copies des lignes).

Les sections du tableau de bord sont des routes séparées pour qu'une section en erreur n'empêche pas l'affichage des autres. Une archive abîmée n'est jamais une erreur de route (§5.4). `GET /favicon.ico` répond 204 (aucune icône servie).

### 9.3 Codes d'erreur
| HTTP | Codes |
|---|---|
| 400 | `REQUETE_INVALIDE` |
| 403 | `HOTE_REFUSE`, `ORIGINE_REFUSEE` |
| 404 | `INTROUVABLE` |
| 405 | `METHODE_REFUSEE` |
| 409 | `PATIENTS_HOMONYMES`, `PATIENT_EXISTANT`, `PATIENT_UTILISE`, `RENOMMAGE_PATIENT`, `MODIFIEE_AILLEURS`, `ANNULATION_IMPOSSIBLE`, `CATALOGUE_UTILISE`, `DEJA_PAYEE`, `CONFLIT_FICHIER`, `FICHIER_ABSENT`, `FICHIER_REVENU`, `SAUVEGARDE_RESTAURABLE`, `REINITIALISATION_REFUSEE` |
| 413 / 415 | `TROP_VOLUMINEUX` / `TYPE_CONTENU` |
| 422 | `VALIDATION` (avec `champs`), `MODE_REQUIS`, `SAUVEGARDE_INCOMPATIBLE` |
| 503 | `DONNEES_ILLISIBLES`, `SCHEMA_PLUS_RECENT`, `FICHIER_VERROUILLE`, `ECRITURE_ECHOUEE`, `SAUVEGARDE_ECHOUEE` |
| 500 | `ERREUR_INTERNE` |

Avertissements non bloquants (dans `avertissements` des réponses de mutation) : `DATE_FUTURE`, `DATE_FACTURATION_FUTURE`, `DATE_FACTURATION_AVANT_PRESTATION`, `FACTURATION_DATE_FUTURE`, `VERSEMENT_AVANT_PRESTATION`, `VERSEMENT_DATE_FUTURE`, `TROP_PERCU`, `PATIENT_RATTACHE` (prestation rattachée à un patient enregistré dont l'écriture diffère du texte tapé), `PATIENT_REACTIVE` (patient archivé réactivé par une prestation), `PATIENT_HOMONYME` (renommage vers le nom d'un autre patient, confirmé), `PATIENT_ARCHIVE_EN_COURS` (patient archivé qui a des prestations à venir ou un reste à payer ; `details: { aVenir, impayees }`), `SAUVEGARDE_ECHOUEE`. Avertissements de lecture de `/api/etat` : `SAUVEGARDE_ECHOUEE`, `DONNEES_INCOHERENTES` (statuts, lignes orphelines, copies divergentes, §5.2).

## 10. Sécurité et confidentialité

### 10.1 Contrôle des requêtes (`src/http/securite.js`)
Sur **toutes** les requêtes, dans cet ordre :
1. `Host` doit valoir `127.0.0.1:<port>` ou `localhost:<port>` → sinon 403 `HOTE_REFUSE` (parade au DNS rebinding) ;
2. `Sec-Fetch-Site`, s'il est présent, doit valoir `same-origin` ou `none` → sinon 403 `ORIGINE_REFUSEE` ;
3. hors `GET`/`HEAD`, `Origin` est obligatoire et doit valoir `http://127.0.0.1:<port>` ou `http://localhost:<port>` → sinon 403 ;
4. méthodes acceptées : `GET`, `HEAD`, `POST`, `PATCH`, `DELETE` → sinon 405. Aucune réponse CORS, aucun `OPTIONS`.

Les scripts d'arrêt envoient donc `Host` et `Origin` corrects (`scripts/lib-lanceur.mjs`, `demanderArret`). Ces contrôles protègent contre les pages web ouvertes dans le navigateur, pas contre un autre compte de la même machine (aucune authentification locale, §1).

Corps de requête bornés : 1 Mo pour les corps attendus comme pour les corps ignorés, 512 octets pour la présence (§9.1).

### 10.2 En-têtes sur toutes les réponses
```
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self';
  font-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```
Conséquences : aucun script ni style en ligne, aucun attribut `style` ni gestionnaire `on…` dans le HTML ; les styles dynamiques passent par des classes ou le CSSOM (`setProperty`).

### 10.3 XSS
Le DOM est construit par `document.createElement` / `createElementNS` et `textContent` (`public/js/dom.js`, `public/js/graphiques/svg.js`). Aucun `innerHTML`, `insertAdjacentHTML` ni `eval` dans `public/js/` (vérifié par des tests statiques).

### 10.4 Serveur statique (`src/http/statique.js`)
Racine `public/` uniquement, `/` → `index.html`. Refus (404) : encodage invalide, `..`, antislash, octet nul, segment commençant par `.`, `:` (flux NTFS), noms réservés Windows, segment finissant par un point ou une espace, caractère de contrôle ; puis `realpath` et vérification que le fichier est **dans** `public/` (liens symboliques compris). Liste blanche : `.html`, `.js`, `.css`, `.svg`, `.png`, `.ico`. Pas de listage. `Cache-Control: no-cache`.

### 10.5 Réseau
- Écoute `127.0.0.1` en dur ; aucun appel sortant. Les seules requêtes émises par le code sont des sondes `GET /api/sante` vers `127.0.0.1` (`src/verrou.js`, `scripts/lib-lanceur.mjs`) et `POST /api/arreter` (scripts).
- La sonde de port (`portEstLibre`) ouvre et referme une écoute sur `127.0.0.1` sans trafic.

### 10.6 Données de santé
- Le fichier de données, les sauvegardes et les exports contiennent des données de santé **en clair** ; ils ne sont pas chiffrés par l'application. L'interface le rappelle avant un export.
- **Droits restreints** (`src/droits.js`) : les fichiers créés par l'application (fichier actif, sauvegardes, journal, verrou) le sont en `0600`, ses dossiers (dossier de données par défaut, `sauvegardes/`, journal, dossier des verrous) en `0700`. Effectif sous Linux et macOS, sous réserve du masque `umask` ; sans effet sous Windows, où les droits viennent du profil de l'utilisateur. Un dossier configuré et déjà existant garde ses droits.
- Le dossier de données ne peut pas être dans `public/` ni `src/`, ni ailleurs dans le projet hors `data/` et `.tmp/` (ignorés par git), comparaison faite sur les chemins réels (§13.2). Les dossiers du journal et des verrous suivent la même règle (§13.1).
- Le journal et la console ne contiennent ni nom, ni motif, ni montant (§8.4). Le journal contient en revanche le chemin du dossier de données.
- Navigateur : aucune donnée nominative dans l'URL, le titre de page ou le stockage du navigateur. `sessionStorage` retient seulement des filtres non nominatifs (mois, statut, état ; filtre Actifs / Archivés / Tous de la page Patients) ; la recherche de patient n'est jamais mémorisée ; `localStorage` ne retient que le thème. L'identifiant de présence n'est stocké nulle part (§8.6).
- **Registre des patients** : `id`, `nom`, `prenom`, `actif` seulement ; aucune date de naissance, coordonnée, motif, pathologie ni note. Il conserve aussi des patients sans prestation, sans durée de conservation gérée par l'application ; seul un patient sans aucune prestation peut être supprimé (§6.3).
- Le verrou d'instance ne contient que PID, port, date, version et chemin.
- Les messages `PATIENT_RATTACHE` et `PATIENT_REACTIVE` renvoyés à l'interface contiennent le nom du patient (réponse locale, jamais journalisée). Les erreurs `PATIENTS_HOMONYMES` et `PATIENT_EXISTANT` ne décrivent les candidats que par identifiant et date ; les noms affichés viennent du registre déjà chargé par la page.
- Textes saisis : caractères de contrôle, invisibles et bidirectionnels refusés dans les noms, motifs et libellés de tarif (§6.3).

## 11. Interface (front)

- **Cinq pages** HTML natives, sans routeur client, avec la même navigation à cinq entrées dans cet ordre : Facturation du mois (`index.html`), Prestations, Patients (`patients.html`), Tableau de bord, Paramètres (`aria-current="page"` sur l'entrée courante). Chaque page charge `theme-init.js` (script classique, avant affichage), son module `js/pages/<écran>.js` et `presence.js`.
- **Modules** : `api.js` (client `fetch`, erreurs typées, téléchargement des exports) ; `dom.js`, `ui.js` (toasts, dialogues `<dialog>` natifs, champs de formulaire) ; `bandeaux.js` (mode dégradé, lecture seule, conflit, sauvegarde en échec, incohérences) ; `ecran-degrade.js` (restauration ou fichier vide quand le fichier est absent ou illisible) ; `conflit.js` (choix de la version à garder) ; `restauration.js` ; `accueil-vide.js` et `catalogue-etat.js` (premier démarrage : définir les tarifs, puis saisir ; saisie impossible tant qu'aucun type n'est actif) ; `format.js` (formats français, `lireMontant`, libellés, libellés des tranches d'ancienneté reçus de `/api/etat`) ; `recap-texte.js` (texte tabulé du récapitulatif pour le presse-papiers, seul endroit à adapter pour le format de copie) ; `recap-regles.js` ; `periodes.js` (12, 6, 3 derniers mois, année en cours, année précédente) ; `icones-paiement.js` (icônes des cinq modes, tracées en SVG).
- **Modules purs** (sans DOM, testés sous Node) :
  - `entree.js` : `entreeValide` et `validerParEntree`, la touche Entrée valide l'ajout d'une prestation, l'enregistrement d'un tarif et le champ « nombre de jours » (ignorée pour les listes, cases, boutons, pendant une composition de texte, ou si le bouton est désactivé).
  - `ecriture.js` : **règle unique** d'écriture, partagée par les quatre écrans qui modifient des données (Facturation du mois, Prestations, Patients, Paramètres). `ecritureAutorisee(etat)` est faux en lecture seule, en conflit non résolu ou en mode dégradé ; les boutons et champs d'écriture sont alors désactivés, avec une explication courte (`explicationEcritureImpossible`), au lieu de laisser un clic échouer.
  - `selection.js` : sélection multiple de la liste des prestations (ajout et retrait, « Tout sélectionner », texte de la barre de sélection). Cocher une case ne redessine que la ligne et la barre, pas toute la liste.
  - `accessibilite.js` : `descriptionChamp` calcule l'`aria-describedby` d'un champ (texte d'aide, puis message d'erreur quand le champ est en erreur ; attribut retiré s'il n'y a rien à relier), utilisé par `ui.js`.
  - `recherche-patients.js` : recherche dans le registre (liste de `GET /api/patients`) pendant la frappe. `rechercherPatients` : accents, casse et espaces de bord ignorés (`normaliserRecherche` de `format.js`), recherche sur le nom, le prénom, « nom prénom » et « prénom nom », les deux champs devant correspondre quand ils sont remplis (avec repli sur le champ en cours de frappe si la combinaison ne donne rien) ; tri : actifs avant archivés, puis début du nom, début du prénom, contenu, puis nom et prénom ; 8 suggestions au plus (`LIMITE_SUGGESTIONS`). Aussi : `clePatient` (identique à celle du serveur), `libelleSuggestion` (date de dernière prestation pour les homonymes, mention « archivé »), `estNouveauPatient`, `optionCreer` (option « Créer le patient … » en fin de liste), `indicationPatient` (« Patient enregistré », « Nouveau patient », « Patient archivé : il sera réactivé avec cette prestation »), `annonceSuggestions` (texte pour lecteur d'écran), `candidatsAffiches` (retrouve dans le registre chargé les noms des candidats d'une erreur d'homonyme, qui n'en contient pas).
- **Composants patients** (DOM construit par `el()` et `textContent` uniquement) :
  - `combobox-patient.js` (`creerSelecteurPatient`) : les champs Nom et Prénom de la saisie d'une prestation (ajout et dialogue de modification, `pages/prestations-formulaire.js`) deviennent deux combobox sur le même registre, motif ARIA 1.2 « combobox avec liste » (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, liste `role="listbox"`, annonce du nombre de suggestions dans une région `role="status"` après une pause de frappe). Flèches pour parcourir, Entrée pour choisir une option active (sinon Entrée valide le formulaire), Échap pour fermer sans fermer le dialogue parent, Tab ferme sans choisir. Choisir un patient remplit les deux champs et envoie son `patientId` ; toute frappe ensuite abandonne ce choix (retour à la saisie libre `patient: { nom, prenom }`, que le serveur rattache ou transforme en nouveau patient). L'option « Créer… » ne crée rien elle-même : le patient naît avec la prestation. Une indication unique sous les deux champs dit ce qui se passera.
  - `patients-dialogues.js` : dialogue « Un patient porte déjà ce nom » (409 `PATIENT_EXISTANT`) commun à l'ajout (Annuler, Créer quand même un homonyme, Utiliser ce patient) et au renommage (Annuler, Renommer quand même) de la page Patients ; focus initial sur Annuler. Le choix entre homonymes à la saisie d'une prestation (409 `PATIENTS_HOMONYMES`) et le choix « renommer le patient / modifier cette ligne seulement » (409 `RENOMMAGE_PATIENT`) restent dans `pages/prestations-dialogues.js`.
- **Écran Prestations** : charge le registre au démarrage, après chaque ajout, modification ou annulation (l'annulation d'une création peut retirer le patient créé avec elle) et au retour sur l'onglet ; le message d'ajout indique « Nouveau patient enregistré » quand la prestation a créé le patient. Un échec de chargement du registre laisse la saisie libre possible. Le filtre texte « Patient » de la liste reste local.
- **Écran Patients** (`pages/patients.js`) : formulaire « Ajouter un patient » (deux champs simples, sans combobox ; sous les champs, la liste informative des patients enregistrés qui ressemblent à ce qui est tapé, 5 au plus) ; aide courte « Actif, archivé, archives annuelles : quelle différence ? » ; recherche locale (jamais mémorisée) et filtre Actifs (défaut) / Archivés / Tous ; tableau trié par nom avec badges « Homonyme » et « Actif / Archivé », date de dernière prestation et nombre de prestations ; actions Renommer (dialogue, nombre de prestations mises à jour), Archiver / Réactiver (sans dialogue), Supprimer (seulement si `supprimable`, après confirmation) ; messages avec bouton « Annuler ». Contrôles d'écriture désactivés avec leur explication en lecture seule, en conflit ou en mode dégradé (`ecriture.js`) ; écran de mode dégradé commun ; liste relue au retour sur l'onglet.
- **Graphiques SVG maison** (`public/js/graphiques/`) : `mise-en-page.js` (échelles et positions, pur et testé), `barres-svg.js` (barres empilées : légende, motifs, info-bulle, tableau « Voir les chiffres »), `barres-h.js` (barres horizontales HTML/CSS pour répartition et impayés, largeur par variable CSS), `prevision-ca.js` (série « Prévu (estimation indicative) » posée sur les barres du CA). Aucune bibliothèque.
- **Thème** : clair, sombre ou automatique (`prefers-color-scheme`), choisi dans Paramètres › Apparence ; jetons de couleur dans `public/css/tokens.css`.
- **Accessibilité** : lien d'évitement, `aria-current` sur la navigation, régions `aria-live` pour bandeaux et toasts, aides et erreurs de champ reliées par `aria-describedby`. Graphiques : le SVG est un `role="group"` nommé (`aria-labelledby`) et décrit (`aria-describedby`) ; chaque colonne est un groupe nommé par son texte (mois et valeurs), focalisable au clavier tant que le graphique compte au plus 26 colonnes (au-delà, par exemple en semaines, le tableau de valeurs fait foi) ; tableau de valeurs pour chaque graphique, motifs en plus des couleurs. Combobox des patients : motif ARIA 1.2, rôles et attributs contrôlés par un test statique ; usage réel au clavier et avec un lecteur d'écran **non vérifié** par un test automatique. Conformité à un référentiel : non vérifiée.
- **Impression** : `public/css/impression.css` (`media="print"`) ; boutons « Imprimer » (`window.print()`) sur la facturation du mois et le tableau de bord.
- **Copie** : `navigator.clipboard.writeText` (127.0.0.1 est un contexte sécurisé).
- **Quitter** : Paramètres propose « Quitter l'application » (`POST /api/arreter`, arrêt des battements de présence).

## 12. Scripts et distribution

Distribution actuelle : le dépôt lui-même, avec Node.js 24 installé sur la machine. Aucune installation de paquet.

| Script | Rôle |
|---|---|
| `npm start` | `node src/server.js` au premier plan (sans arrêt automatique, sauf `ERGO_ARRET_AUTO=1`) |
| `scripts/suivi.mjs` | point d'entrée multi-OS : `lancer`, `arreter [--forcer]`, `raccourci`, `diagnostic`, `demo`, `aide` (scripts npm `lancer`, `arreter`, `raccourci`, `demo`) |
| `scripts/lancer-silencieux.mjs` | lanceur sans fenêtre (§12.1) |
| `scripts/arreter.mjs` | arrêt de secours (§12.2) |
| `scripts/demo.mjs` | démonstration sur données fictives (§12.3) |
| `scripts/creer-raccourci.mjs` | raccourci du système (§12.4) |
| `scripts/choisir-dossier.mjs` | écrit `ERGO_DATA_DIR` dans `.env` après contrôle du dossier (copie préalable `.env.bak`, confirmation, autres lignes conservées) |
| `scripts/outils-lanceur.mjs` | état et ouverture du navigateur pour le mode diagnostic |
| Windows : `Suivi-facturation.vbs`, `Arreter suivi-facturation.vbs`, `Creer le raccourci Bureau.vbs`, `Lancer suivi-facturation.bat` (diagnostic, fenêtre visible), `Choisir le dossier de donnees.bat` | enveloppes double-cliquables |
| Linux/macOS : `Suivi-facturation.sh`, `Arreter suivi-facturation.sh`, `lib-boites.sh` | enveloppes POSIX `sh` (boîtes graphiques si disponibles) |
| `scripts/icone/generer-icone.mjs` | génère `logo.svg`, `logo-512.png`, `suivi-facturation.ico` (Node seul, reproductible) |

### 12.1 Lanceur silencieux
1. Vérifie Node ≥ 24 **avant** tout le reste (le chargement de `.env` en dépend), puis charge `.env`, ouvre le journal (lignes « Lanceur : ») et active `ERGO_ARRET_AUTO=1` sauf choix explicite.
2. Prend un **verrou de lancement** (dossier `<verrou>.lancement` créé par `mkdir`, périmé après 60 s ou PID mort) : deux lanceurs simultanés ne démarrent pas deux serveurs.
3. Lit le verrou d'instance : application active → ouvre le navigateur sur le port **du verrou** ; verrou bloqué récent → attente ; bloqué → code 20 et message.
4. Choix du port : `ERGO_PORT` s'il est défini (occupé → message, pas de repli) ; sinon 4780, ou **le premier port libre de 4781 à 4799** si 4780 est pris.
5. Démarre `src/server.js` **détaché**, attend jusqu'à 20 s que `/api/sante` réponde avec le PID lancé, puis ouvre le navigateur (`start`, `open`, `xdg-open`/`gio open`/`sensible-browser`). Un serveur sorti avec le code 3 est un succès ; code 2 → message reprenant les erreurs du journal ; délai dépassé → arrêt du PID lancé.
6. En cas d'échec, message en français dans `logs/message-lanceur.txt` (affiché par l'enveloppe). Codes : 0, 1, 20.

### 12.2 Arrêt
`scripts/arreter.mjs` envoie `POST /api/arreter` au port trouvé dans le verrou (sinon `ERGO_PORT`/4780) et attend la libération du port (10 s). Avec `--forcer`, réservé à une instance bloquée et après confirmation par l'enveloppe : arrêt propre tenté 3 s, relecture du verrou, puis arrêt du **seul PID du verrou** et seulement si ce processus est bien `node` (vérifié par PID avec `tasklist` ou `ps`). Jamais d'arrêt par nom de processus. Codes : 0 arrêtée, 10 non lancée, 11 port pris par autre chose, 12 `ERGO_PORT` invalide, 20 bloquée, 21 PID qui n'est pas `node`, 1 échec.

### 12.3 Démonstration
`npm run demo` crée à chaque lancement un dossier **unique** `<dossier temporaire du système>/suivi-facturation-demo-XXXXXX` (`mkdtemp`, `0700` là où le système gère les droits) avec `donnees/`, `logs/` et `verrou/` en dossiers frères ; deux démonstrations simultanées ont chacune leur dossier et leur port. Il y écrit une copie de `config/exemple.json` **datée du jour** (toutes les dates décalées du même nombre de jours, chaque date produite revérifiée), puis **impose** `ERGO_DATA_DIR`, `ERGO_LOG_DIR`, `ERGO_VERROU_DIR`, `ERGO_PORT` (premier libre de 4790 à 4799, sinon un port choisi par le système) et l'arrêt automatique, et démarre le serveur dans le même processus.
- Aucun lien symbolique ni point de jonction n'est suivi : chaque dossier est vérifié (`lstat`, chemin réel attendu) ; le seul fichier écrit est le jeu de données, par création exclusive.
- Refus si le dossier de démonstration est, contient ou est contenu dans le dossier de données réel configuré ou `data/` ; le `.env` n'est que lu.
- À la sortie, les fichiers ordinaires du dossier unique sont supprimés un par un, puis ses dossiers vides en remontant (jamais de suppression récursive) ; si une suppression échoue, le dossier est laissé en place. Après un arrêt brutal, le dossier temporaire reste (données fictives) ; il n'est pas nettoyé au lancement suivant.

### 12.4 Raccourci et icône
Windows : « Suivi Facturation.lnk » sur le Bureau (via le `.vbs`). Linux : `Suivi-facturation.desktop` sur le Bureau et dans `~/.local/share/applications/`. macOS : « Suivi Facturation.app » sur le Bureau, avec une icône `.icns` produite en Node à partir des images de `scripts/icone/`. Un ancien raccourci de l'application est remplacé après confirmation ; un fichier qui n'est pas le sien n'est jamais écrasé. Le raccourci contient le chemin absolu du projet.

### 12.5 Multi-OS
Le code serveur et les scripts Node détectent `process.platform`. Les lanceurs, le raccourci et l'arrêt forcé sous **Linux et macOS sont expérimentaux : non vérifiés sur un système réel** (développés et essayés sous Windows) ; un workflow `npm test` existe pour les trois systèmes (§14).

## 13. Configuration

### 13.1 Variables
Lues dans l'environnement, éventuellement depuis `.env` à la racine (chargé par le serveur et les scripts ; jamais d'écrasement d'une variable déjà définie). Modèle commenté : `scripts/env.exemple`.

| Variable | Défaut | Validation |
|---|---|---|
| `ERGO_DATA_DIR` | `<projet>/data` (créé en `0700` s'il manque) | relatif = relatif au projet ; doit exister, être un dossier inscriptible, hors `public/`, `src/` et hors du projet sauf `data/` et `.tmp/` (chemins réels) ; sinon code 2 |
| `ERGO_PORT` | `4780` | entier 1 à 65535 ; sinon code 2 |
| `ERGO_LOG_DIR` | `<projet>/logs` | relatif = relatif au projet ; hors `public/`, `src/`, et hors du projet sauf `logs/` et `.tmp/`, contrôlé sur le chemin écrit **puis** sur le chemin réel ; sinon code 2 |
| `ERGO_VERROU_DIR` | dossier propre à l'utilisateur (§8.2) | relatif = relatif au projet ; hors `public/`, `src/`, et hors du projet sauf `.tmp/`, contrôlé sur le chemin écrit **puis** sur le chemin réel ; jamais dans le dossier de données ; sinon code 2 |
| `ERGO_ARRET_AUTO` | vide (désactivé) | `0`, `1` ou vide ; sinon code 2 |
| `ERGO_ARRET_DELAI_FERMETURE_S` | `10` | entier 1 à 86 400 |
| `ERGO_ARRET_DELAI_PULSATION_S` | `600` | entier 1 à 86 400 |
| `ERGO_ARRET_DELAI_PREMIERE_PAGE_S` | `300` | entier 1 à 86 400 |
| `ERGO_MODE_DEMO` | vide | `1` : posée par `scripts/demo.mjs` seulement (ne jamais la renseigner) ; `/api/etat` renvoie alors `demonstration` et les pages affichent le bandeau « Données d'exemple » |
| `ERGO_SANS_ENV` | vide | `1` : le serveur ne charge pas `.env` (posée par les aides de test, pour que le `.env` d'un poste de développement ne change pas leurs résultats) |

**Emplacements contrôlés de la même façon** : `ERGO_LOG_DIR` et `ERGO_VERROU_DIR` passent par `refuserEmplacementInterdit` (`src/config.js`), qui applique la règle au chemin écrit puis au chemin réel (`cheminReel` : ancêtre existant résolu, liens et jonctions suivis, même si la fin du chemin n'existe pas encore). Un lien symbolique ou une jonction ne peut donc pas détourner le journal ou les verrous vers `public/`, `src/` ou le reste du projet ; un sous-dossier admis (`logs/`, `.tmp/`) lui-même détourné n'est plus admis. C'est la même règle que pour `ERGO_DATA_DIR` (§13.2).

Variables d'essai des scripts (sans effet sur les données) : `ERGO_LANCEUR_SANS_NAVIGATEUR`, `ERGO_LANCEUR_MESSAGE`, `ERGO_LANCEUR_SANS_BOITE`, `ERGO_DEMO_PORT_MIN`, `ERGO_DEMO_PORT_MAX` (plage de ports de la démonstration, réservées aux tests), `SUIVI_FORCER_OUI`, `SUIVI_CONFIRMER_OUI`, `SUIVI_RACCOURCI_DOSSIER`, `SUIVI_PLATEFORME_FORCE`. Variable de test : `ERGO_TEST_PANNE` (préchargement `tests/aides/panne-arret.mjs`).

Le nombre de jours d'historique des sauvegardes quotidiennes n'est pas une variable : c'est `parametres.sauvegardesConservees` dans le fichier de données (Paramètres, 7 à 365, §7.3).

### 13.2 Contrôle du dossier de données (`verifierDossierDonnees`)
Création seulement pour le dossier par défaut (en `0700`) ; sinon existence, type dossier, chemin réel hors des zones interdites (comparaison sur chemins réels : un lien ou un `data/../x` ne contourne pas la règle), puis sonde d'écriture `.test-ecriture-<pid>` créée puis supprimée. Les refus portent un conseil renvoyant à « Choisir le dossier de donnees.bat ». Le chemin actif est affiché dans Paramètres et renvoyé par `/api/etat`.

## 14. Tests

- `npm test` : `node --test` sur tout le dossier `tests/`, rapport `spec` à l'écran et dans `derniers-tests.log` (ignoré par git). Aucune dépendance (`node:test`, `node:assert/strict`).
- **Organisation** (fichiers nommés d'après ce qu'ils vérifient) :
  - `tests/domain/` : règles pures (paiement, récap, indicateurs, prévisions, dates, CSV, schéma, catalogue vierge, caractères invisibles dans les textes saisis…) ; registre des patients : `patients.test.js` (clé, liste, résolution, création, renommage, archivage, suppression, réparation), `patients-registre.test.js` (reconstruction du registre et ses cas limites, incohérences comptées, **invariant** I1/I2 après des centaines d'opérations tirées d'une graine fixe), `migration-v1-v2.test.js` (récapitulatif, indicateurs et exports CSV identiques avant et après migration ; cas limites) ;
  - `tests/store/` : disque (écriture atomique, sauvegardes et rotation en jours, restauration, conflit, configuration, emplacements détournés par lien ou jonction, droits et robustesse) ; `migration-patients.test.js` : migration d'un fichier version 1 au démarrage (sauvegarde `avant-migration` identique octet pour octet, pas de seconde migration), échecs sans perte (structure, écriture, sauvegarde impossible), fichier plus récent, restauration d'une sauvegarde version 1, `nombrePatients`, annulation des opérations du registre, incohérences signalées ;
  - `tests/http/` : serveur réel sur `127.0.0.1`, port 0 (API, sécurité, statique, corps ignorés, archives abîmées, verrou et son temporaire, PID réutilisé, instance unique, ordre de l'arrêt, arrêt, présence, démarrage) ; `patients.test.js` : chaque route et code des patients (dont `PATIENT_EXISTANT` puis `homonyme: true`, double clic, `PATIENT_UTILISE` avec ligne active, archive lisible ou illisible, réactivation par une prestation, annulation, mode dégradé, lecture seule, conflit, aucun nom au journal, registre dans l'export JSON) ;
  - `tests/front/` : modules purs de `public/js` (écriture, sélection, accessibilité, formats, graphiques, présence, recherche de patients `recherche-patients.test.js`…) et conformité CSP (dont `patients.html`, navigation à cinq entrées identique sur les cinq pages, attributs ARIA de la combobox, aucun `innerHTML` dans les modules patients) ;
  - `tests/journal/` ;
  - `tests/scripts/` : démonstration (`demo.test.js` : dossier unique, aucun lien suivi, refus du dossier réel, variables imposées, jeu daté du jour, `main` exercé dans un vrai processus) et bibliothèque des lanceurs ;
  - `tests/qa/` : recette (parcours HTTP, entrées hostiles, robustesse réseau, confidentialité statique, volumétrie à 20 000 prestations, `GET /api/patients` compris, cohérence documentaire du guide, du README et du document d'exploitation).
- **Aides** (`tests/aides/`) : dossiers temporaires sous `<projet>/.tmp/tests/` nettoyés fichier par fichier puis `rmdir` (jamais de suppression récursive, jamais `data/`) ; `ERGO_SANS_ENV=1` posé par `temp.js` et transmis aux serveurs lancés (tests hermétiques) ; états de test en version courante, registre reconstruit depuis les lignes, et leurs équivalents en version 1 pour les tests de migration (`donnees.js` : `etatTest`, `avecRegistre`, `etatV1`, `enV1`) ; horloge fixe ; `fs` défaillant simulé (`EPERM` sur `rename`, dossier de sauvegardes inaccessible) ; minuteurs simulés pour la présence ; catalogue de test (celui du jeu d'exemple, l'application démarrant avec un catalogue vide) ; serveur de test ; `instance-aide.js` pour lancer de **vrais processus** `node src/server.js` (arrêtés par PID uniquement) ; `panne-arret.mjs` (pannes simulées pendant l'arrêt) ; `course-stress.js` (outil de mesure des courses de démarrage, hors suite).
- **Tests de processus réels** : instance unique et courses de démarrage, verrou périmé ou bloqué, codes de sortie, arrêt propre et garde-temps, arrêt automatique. Les tests de signaux et de droits POSIX sont ignorés sous Windows.
- **Instabilité connue** : sous Windows, un processus de fichier de test s'arrête parfois brutalement sans rendre ses résultats (de l'ordre d'une exécution complète sur 400). Cause non démontrée ; aucune trace JS n'a été observée. `tests/aides/garde-processus.js` est une garde de diagnostic qui **ne change pas le comportement** du processus pour les erreurs : exceptions et rejets non gérés sont seulement notés (`uncaughtExceptionMonitor`, sur la sortie d'erreur et dans `.tmp/diagnostic-tests/<pid>.log`), jamais interceptés ni suivis d'une sortie, pour que `node:test` les rattache au test fautif ; une sortie non nulle et un signal reçu sont aussi notés. Traitement : relancer avant de conclure à une régression.
- **Intégration continue** : `.github/workflows/tests.yml` exécute `npm test` sous Ubuntu, macOS et Windows avec Node 24 (`fail-fast: false`), sur `push` vers `main`, sur les demandes de fusion et à la demande, sans secret ni installation de paquet ; en cas d'échec, la sortie des tests et les traces de diagnostic sont conservées 7 jours.

## 15. Limites connues et points non vérifiés

**Limites connues**
- Fenêtre active non bornée : sans archivage, toutes les prestations restent dans le fichier actif, réécrit en entier à chaque modification (mesure de recette : 20 000 prestations, ≈ 13 Mo, temps jugés acceptables sur la machine de développement).
- Indicateurs et prévisions ignorent les archives éventuelles ; une archive abîmée est ignorée (§5.4).
- Conflit de synchronisation au niveau minimal : pas de détection des copies créées par le client de synchronisation, pas de protection entre deux ordinateurs, pas de fusion.
- Pas de détection de doublon de prestation à la saisie.
- **Incohérences du registre signalées, non réparables depuis l'application** : une ligne orpheline ou une copie de nom divergente (fichier retouché à la main, fusion par un client de synchronisation) est comptée dans l'avertissement `DONNEES_INCOHERENTES`, mais aucune route ni aucun bouton « Réparer » n'existe ; la fonction du domaine `reparerPatients` n'est pas exposée. Correction possible aujourd'hui : restaurer une sauvegarde cohérente.
- **Une écriture du nom par patient** : une ligne ne peut pas garder une écriture différente de celle du registre ; corriger la casse ou les espaces du nom sur une seule prestation renomme le patient partout, et un autre nom sur une seule ligne d'un patient qui en a d'autres impose de choisir entre renommer le patient et détacher la ligne. Les lignes des archives annuelles, elles, gardent l'ancien nom après un renommage. Pas de fusion de deux patients.
- Rattachement automatique par nom : une prestation saisie avec le nom et le prénom d'un seul patient enregistré (actif ou archivé) lui est rattachée ; deux personnes réelles de même nom dont une seule est enregistrée sont confondues. Les suggestions et l'indication sous les champs réduisent ce risque sans l'éliminer.
- Un patient présent seulement dans des archives annuelles n'est pas dans le registre.
- Pas d'authentification locale : un autre compte de la même machine peut joindre l'application sur `127.0.0.1` ; à utiliser sur un ordinateur où une seule personne a un compte.
- Données en clair sur le disque (fichier, sauvegardes, exports) : la protection repose sur la session, les droits des fichiers et le chiffrement du disque de l'ordinateur.
- La prévision n'a aucune saisonnalité et proratise en jours calendaires.
- `sendBeacon` à la fermeture n'est pas garanti par les navigateurs ; le délai sans battement (10 min par défaut) sert de filet.
- Heure de démarrage d'un processus inconnue (commande indisponible ou trop lente) : un verrou dont le PID a été réutilisé reste jugé « bloqué » (code 4) ; l'arrêt forcé (§12.2) n'agit que si ce PID est un processus `node`.

**Non vérifié**
- Comportement réel des clients de synchronisation (copies de conflit, verrouillage pendant l'envoi, fichiers « en ligne uniquement », effet d'un `rename` de remplacement dans un dossier synchronisé).
- Atomicité de `rename` sous Windows/NTFS en cas de coupure de courant ; les délais de réessai sont des valeurs de départ, non mesurées sur une machine chargée.
- Lanceurs, raccourcis, arrêt forcé, signaux et droits POSIX sous Linux et macOS sur un système réel ; résultats du workflow d'intégration continue sur ces systèmes.
- Détection d'un PID réutilisé en conditions réelles (redémarrage, démarrage rapide de Windows) et durée de la lecture par PowerShell.
- Migration 1 → 2 sur un fichier réel : testée sur des données fictives seulement ; durée de la migration et du renommage d'un patient à forte volumétrie non mesurées (la recette de volumétrie couvre la lecture, dont `GET /api/patients`).
- Conformité de l'interface à un référentiel d'accessibilité, usage avec un lecteur d'écran (dont la combobox des patients et ses annonces) ; rendu d'impression selon les navigateurs.
- Cause de l'arrêt brutal intermittent d'un processus de test sous Windows.

## 16. Feuille de route

Prévu, sans ordre ni date :
- archivage annuel des prestations soldées au-delà de 12 mois (`archive-AAAA.json`), avec relecture par les graphiques ;
- détection des copies de conflit créées par un client de synchronisation dans le dossier de données ;
- réparation des incohérences du registre des patients (bouton « Réparer » du bandeau, sauvegarde préalable, mêmes règles que la migration) ;
- séries de séances (quantité, rythme) rattachées à un patient du registre : elles passeront par une nouvelle version de schéma (3), avec sa migration ; leurs prestations seront créées par les mêmes règles de rattachement (`resoudrePatient`) ;
- détection des doublons de prestation ;
- indicateur des patients vus sur une période (« patients actifs », sans rapport avec le drapeau `actif` du registre) et comparaison annuelle ;
- import depuis un tableur ;
- distribution sans installation préalable de Node.js ;
- jeton secret par lancement (authentification locale entre comptes d'une même machine).

# Design system — suivi-facturation

> Ce document décrit l'interface telle qu'elle est livrée : jetons, composants, écrans, accessibilité, impression.
> Il complète `docs/architecture.md` (API, sécurité, architecture du front). Les feuilles de style sont dans `public/css/`, le HTML et le JavaScript dans `public/`.
> Tous les exemples sont fictifs (noms inventés, catalogue de démonstration, montants choisis pour que chaque maquette soit arithmétiquement cohérente).
> Ce qui n'a pas été vérifié (rendu, lecteurs d'écran, impression…) et ce que l'interface ne propose pas figure au §15.

## Sommaire
1. Principes
2. Fichiers CSS, ordre de chargement, squelette de page
3. Jetons : couleurs (contrastes WCAG AA), typographie, espacements, rayons, ombres, thèmes
4. Palette des états et des graphiques
5. Composants
6. Graphiques SVG et barres horizontales
7. Contrat de classes et d'attributs
8. Écrans et maquettes
9. Accessibilité
10. Responsive
11. Impression
12. Compatibilité CSP et hors ligne
13. Messages et libellés (français)
14. Choix de conception
15. Limites et points non vérifiés
16. Logo et icône

---

## 1. Principes

L'utilisatrice est une praticienne libérale de santé, **non technique**, seule sur un PC Windows. Elle saisit entre deux patients et prépare ses factures en fin de mois : l'interface vise d'abord le gain de temps.

1. **Clavier d'abord.** Tout se fait sans souris : Tab suit l'ordre visuel, Entrée valide, Échap ferme. Après un ajout de prestation, le focus revient au premier champ pour enchaîner.
2. **Les montants se lisent d'un coup d'œil.** Chiffres tabulaires, alignés à droite, toujours avec deux décimales et « € » (espace insécable), jamais coupés en fin de ligne. Le **reste à payer** est en gras.
3. **Jamais la couleur seule.** Chaque état a un mot, un symbole et/ou une forme de bordure (pointillé, double, tirets) en plus de sa couleur. Les graphiques ont des motifs, une légende textuelle et un tableau de valeurs.
4. **Un clic pour l'essentiel.** Le statut de facturation et le paiement (un bouton par mode) sont des boutons placés directement dans la ligne. Toute action rare ou destructive passe par une confirmation en français clair, avec la conséquence nommée.
5. **Pas de surprise.** Rien n'est supprimé sans confirmation. Les actions courantes (changer un statut, payer en totalité, enregistrer un versement, supprimer une prestation, marquer une période facturée) proposent « Annuler » dans un message éphémère ; une restauration de sauvegarde propose « Annuler la restauration ».
6. **Sobriété.** Peu de couleurs, pas d'animation décorative. Les symboles d'état sont des caractères Unicode, pas des images ; les seules icônes dessinées sont celles des modes de paiement (§5.13). Un mode sombre est fourni.
7. **Hors ligne et CSP stricte.** Aucune police, image ni feuille externe ; aucun style en ligne ; polices système uniquement.
8. **Vocabulaire du métier.** Les mots du métier sont repris tels quels : prestation, séance, bilan, facturé, versement, reste à payer.

## 2. Fichiers CSS, ordre de chargement, squelette de page

| Fichier | Rôle |
|---|---|
| `public/css/tokens.css` | Jetons (variables CSS) : couleurs clair/sombre, typographie, espacements, rayons, ombres, dimensions |
| `public/css/base.css` | Réinitialisation, typographie, focus visible, utilitaires (`.sr-only`, `.pile`, `.groupe-horizontal`), en-tête, navigation, zone `.page` |
| `public/css/composants.css` | Boutons, champs, tableaux, badges, alertes, dialogues, toasts, état vide, dépliants, cartes, indicateurs |
| `public/css/ecrans.css` | Mises en page par écran, icônes des modes de paiement, graphiques SVG et barres horizontales |
| `public/css/impression.css` | Règles `@media print` (récapitulatif et impression simple des autres écrans) |

**Ordre obligatoire** dans le `<head>` de chaque page (chemins absolus depuis la racine de `public/`) :

```html
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/composants.css">
<link rel="stylesheet" href="/css/ecrans.css">
<link rel="stylesheet" href="/css/impression.css" media="print">
<script src="/js/theme-init.js"></script>                          <!-- script classique : applique le thème avant l'affichage -->
<script type="module" src="/js/pages/facturation.js"></script>     <!-- script de l'écran -->
<script type="module" src="/js/presence.js"></script>              <!-- présence de l'onglet (arrêt automatique) -->
```

Aucun `@import`, aucune `url()` dans les feuilles, aucun attribut `style="…"` dans le HTML (§12).

### Pages

| Page | Fichier | Classe de `<main>` | Script |
|---|---|---|---|
| Facturation du mois (accueil) | `index.html` | `ecran-facturation` | `js/pages/facturation.js` |
| Prestations | `prestations.html` | `ecran-prestations` | `js/pages/prestations.js` |
| Patients | `patients.html` | `ecran-patients` | `js/pages/patients.js` (spécifié §8.11 ; page à écrire) |
| Tableau de bord | `tableau-de-bord.html` | `ecran-tdb` | `js/pages/tableau-de-bord.js` |
| Paramètres | `parametres.html` | `ecran-parametres` | `js/pages/parametres.js` |

### Squelette commun

```html
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Facturation du mois — suivi-facturation</title>   <!-- jamais de nom de patient dans le titre -->
  ... les liens et scripts ci-dessus ...
</head>
<body>
  <a class="skip-link" href="#contenu">Aller au contenu</a>
  <header class="entete-site">
    <div class="entete-site__interieur">
      <a class="marque" href="/">suivi-facturation</a>
      <nav class="nav-principale" aria-label="Navigation principale">
        <ul>
          <li><a href="/" aria-current="page">Facturation du mois</a></li>
          <li><a href="/prestations.html">Prestations</a></li>
          <li><a href="/patients.html">Patients</a></li>            <!-- page spécifiée §8.11, à ajouter dans les cinq pages -->
          <li><a href="/tableau-de-bord.html">Tableau de bord</a></li>
          <li><a href="/parametres.html">Paramètres</a></li>
        </ul>
      </nav>
    </div>
  </header>
  <main id="contenu" class="page ecran-facturation" tabindex="-1">
    <div class="bandeaux" id="bandeaux" aria-live="polite"></div>
    <div class="page-titre"><h1>Facturation du mois</h1></div>
    <noscript> … .alerte--danger « Cette application nécessite JavaScript. » … </noscript>
    <div id="zone"><p class="chargement" role="status">Chargement…</p></div>
  </main>
  <div id="annonce-facturer" class="sr-only" role="status" aria-live="polite"></div>   <!-- index.html seulement -->
  <div class="toasts" role="status" aria-live="polite"></div>
</body>
```

Le contenu de chaque écran est construit dans `#zone` par le JavaScript de la page. L'élément `<noscript>` est présent sur les quatre pages. Le tableau de bord donne à `#zone` la classe `pile`.

## 3. Jetons

Tous les jetons sont dans `tokens.css`. **Le CSS des composants et des écrans ne contient aucune couleur en dur** (hors la valeur de repli du fond de `::backdrop`) : tout passe par les variables, ce qui rend le mode sombre complet. `impression.css` fixe volontairement des couleurs (§11).

### 3.1 Couleurs — thème clair (contrastes calculés)

Les ratios sont calculés avec la formule WCAG 2.x (luminance relative). Seuils AA : 4,5:1 pour le texte normal, 3:1 pour le texte large et les éléments d'interface (bordures de champ, focus, graphiques).

| Jeton | Valeur | Usage | Contraste calculé |
|---|---|---|---|
| `--c-fond` | `#f4f6f8` | fond de page | texte `#17212b` dessus : **15,04** |
| `--c-surface` | `#ffffff` | cartes, champs, tableaux | texte dessus : **16,29** |
| `--c-surface-alt` | `#eceff3` | en-têtes de tableau, pieds, blocs secondaires | texte dessus : **14,13** |
| `--c-texte` | `#17212b` | texte courant | — |
| `--c-texte-doux` | `#4a5764` | aide, légendes, montants à zéro | sur surface **7,40** ; sur fond **6,83** ; sur surface-alt **6,41** |
| `--c-bordure` | `#c5ced8` | séparateurs décoratifs (non porteurs d'information) | — |
| `--c-bordure-champ` | `#6f7c8a` | bordure de champ, de bouton secondaire, de segment | sur surface **4,26** ; sur fond **3,94** (≥ 3:1) |
| `--c-survol-ligne` | `#eef3f9` | survol d'une ligne de tableau, d'une suggestion | texte dessus : **14,60** |
| `--c-selection` | `#dbe8f8` | ligne sélectionnée, option active, surbrillance d'une ligne modifiée | texte dessus : **13,12** |
| `--c-voile` | `rgba(10, 18, 28, 0.5)` | fond derrière un dialogue | — |
| `--c-primaire` | `#1b5fa8` | bouton principal, lien actif | texte blanc dessus **6,46** |
| `--c-primaire-survol` | `#154a85` | survol du bouton principal | blanc dessus **8,94** |
| `--c-sur-primaire` | `#ffffff` | texte sur fond primaire | — |
| `--c-lien` | `#1b5fa8` | liens | sur surface **6,46** ; sur surface-alt **5,60** |
| `--c-focus` | `#1a56c4` | anneau de focus (3 px, décalé de 2 px) | sur surface **6,62** ; sur fond **6,11** ; sur surface-alt **5,74** |
| `--c-danger-bouton` | `#b3261e` | bouton « Supprimer » plein | blanc (`--c-sur-danger-bouton`) dessus **6,54** ; survol (`--c-danger-bouton-survol`) `#8f1d17` : **8,91** |

Couleurs sémantiques (texte sur son propre fond ; bordure testée comme élément d'interface, ≥ 3:1 sur son fond) :

| Famille | Fond | Texte | Bordure | Texte/fond | Bordure/fond |
|---|---|---|---|---|---|
| ok (payé, succès) | `#e2f3ea` | `#0b5a37` | `#2e8b5e` | **7,21** | **3,67** |
| att (partiel, attention) | `#fff0d1` | `#6e4200` | `#b36b00` | **7,63** | **3,71** |
| dan (non payé, erreur) | `#fce6e4` | `#911a1a` | `#c0392b` | **7,43** | **4,55** |
| inf (facturé, information) | `#e5eefa` | `#17467f` | `#2f6fb8` | **8,09** | **4,39** |
| neu (neutre, à venir) | `#eceff3` | `#3b4753` | `#6f7c8a` | **8,23** | **3,70** |

Les jetons correspondants sont `--c-ok-fond`, `--c-ok-texte`, `--c-ok-bord`, puis les mêmes trois suffixes pour `att`, `dan`, `inf` et `neu` (par exemple `--c-att-fond`, `--c-dan-texte`, `--c-neu-bord`).

### 3.2 Couleurs — thème sombre (contrastes calculés)

| Jeton | Valeur | Contraste calculé |
|---|---|---|
| `--c-fond` / `--c-surface` / `--c-surface-alt` | `#12171d` / `#1a212a` / `#232c37` | texte `#e8edf2` dessus : **15,29** / **13,77** / **11,99** |
| `--c-texte-doux` | `#aab6c3` | sur fond **8,74** ; surface **7,87** ; surface-alt **6,85** |
| `--c-bordure` / `--c-bordure-champ` | `#3a4654` / `#8593a1` | bordure de champ sur surface **5,16** ; sur fond **5,73** |
| `--c-survol-ligne` / `--c-selection` | `#212a35` / `#23364d` | texte dessus : **12,32** / **10,45** |
| `--c-primaire` (bouton) | `#7db2f0` avec texte `#0b1a2b` | **7,94** ; survol `#9cc4f5` : **9,72** |
| `--c-lien` | `#8fbcf3` | sur surface **8,23** ; surface-alt **7,17** |
| `--c-focus` | `#9cc4f5` | sur surface **8,98** ; surface-alt **7,82** |
| `--c-danger-bouton` | `#f2b8b5` avec texte `#601410` | **7,66** ; survol `#f7cfcc` |
| ok | fond `#12301f`, texte `#8fe0b4`, bord `#3fae78` | **9,19** ; bord **5,13** |
| att | fond `#3a2a08`, texte `#f5c76a`, bord `#d19a2e` | **8,75** ; bord **5,53** |
| dan | fond `#3d1717`, texte `#ffaaa3`, bord `#e0675c` | **8,65** ; bord **4,70** |
| inf | fond `#14263f`, texte `#a9cdf7`, bord `#5b9be0` | **9,26** ; bord **5,23** |
| neu | fond `#232c37`, texte `#c3ccd6`, bord `#8593a1` | **8,69** ; bord **4,50** |

### 3.3 Basculement clair / sombre

- **Automatique** : `prefers-color-scheme: dark` (réglage de Windows) active le thème sombre, sauf si `<html data-theme="light">`.
- **Forcé** : `<html data-theme="dark">` ou `data-theme="light"`. Le réglage « Apparence : Automatique / Clair / Sombre » de Paramètres (§8.4) pose l'attribut (`js/theme.js`) et le mémorise dans `localStorage` sous la clé `suivi-facturation.theme` (donnée non nominative, convenance personnelle ; chaque accès est protégé par `try/catch`). Le script classique `js/theme-init.js` relit cette clé dès le chargement de chaque page, avant l'affichage, pour éviter un flash. Absent ou « Automatique » : l'attribut est retiré.
- `color-scheme` est déclaré : les contrôles natifs (cases, listes déroulantes, barres de défilement) suivent le thème.
- À l'impression, les jetons sont **forcés en clair, noir sur blanc** (§11).

### 3.4 Typographie

Polices système uniquement : `--police: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` (Segoe UI sous Windows 11). Chiffres : `font-variant-numeric: tabular-nums` pour les montants, dates et compteurs. Police à chasse fixe (`--police-mono`) uniquement pour les chemins de dossier et noms de fichier (`.code`).

| Jeton | Taille | Usage |
|---|---|---|
| `--t-s` | 0,875 rem (14 px) | aide, légendes, en-têtes de tableau, badges |
| `--t-m` | 1 rem (16 px) | texte courant, cellules, champs |
| `--t-l` | 1,125 rem | titres de carte, montants mis en avant |
| `--t-xl` | 1,375 rem | h2, titres de dialogue |
| `--t-xxl` | 1,75 rem | h1 |
| `--t-montant-kpi` | 1,75 rem | grands chiffres des indicateurs |

Interligne 1,5 (1,25 pour les titres). Graisses : 400 courant, 500-600 libellés et boutons, 650-700 titres et totaux, 800 pour le reste à payer. Les tailles sont en `rem` : elles suivent le réglage de taille de texte du navigateur. Le texte des graphiques SVG utilise lui aussi `--t-s` (14 px au réglage par défaut, comme les autres petits textes) ; en revanche les marges et interlignes du SVG sont calculés en pixels fixes (§6.4).

### 3.5 Espacements, rayons, ombres, dimensions

| Jeton | Valeur |
|---|---|
| `--e-1` … `--e-7` | `--e-1` 0,25 rem · `--e-2` 0,5 · `--e-3` 0,75 · `--e-4` 1 · `--e-5` 1,5 · `--e-6` 2 · `--e-7` 3 (base 4 px) |
| `--r-s` / `--r-m` / `--r-l` / `--r-pill` | 4 px / 8 px / 12 px / 999 px |
| `--ombre-1` | élévation légère des cartes ; `--ombre-2` : dialogues, toasts, suggestions, info-bulles |
| `--cible` | 2,75 rem (44 px) : hauteur des boutons, champs, liens de navigation |
| `--cible-s` | 2,25 rem (36 px) : actions compactes dans les lignes de tableau (jamais en dessous de 24 px, seuil WCAG 2.5.8) |
| `--largeur-page` | 76 rem ; `--largeur-texte` : 42 rem (lignes de texte longues) |
| `--focus-largeur` / `--focus-decalage` | 3 px / 2 px |
| `--duree` | 120 ms ; 0 si l'utilisatrice demande moins de mouvement |
| `--interligne` / `--interligne-serre` | 1,5 / 1,25 |

Largeurs de dialogue : 34 rem (`.dialogue`), 50 rem (`.dialogue--large`), plafonnées à la largeur de la fenêtre moins 1,5 rem. Largeur maximale d'un toast : 36 rem.

### 3.6 Anneau de focus

Règle : l'anneau de focus doit atteindre **3:1 contre chaque couleur adjacente** (WCAG 2.2, indicateur de focus non textuel), dans les deux thèmes. Aucune couleur n'a été ajoutée : les anneaux utilisent `--c-focus` et `--c-surface`.

**Cas général (tous les éléments focalisables sauf les boutons de segment).** Anneau extérieur `outline: 3px solid var(--c-focus)` décalé de 2 px (`base.css`). L'écart de 2 px laisse voir le fond du parent : l'anneau ne touche jamais le fond de l'élément focalisé (bouton primaire, bouton « Supprimer », badge cliquable…), seulement le fond qui l'entoure. Contrastes `--c-focus` contre les fonds possibles du parent :

| Fond du parent | Clair | Sombre |
|---|---|---|
| `--c-fond` | 6,11 | 9,97 |
| `--c-surface` | 6,62 | 8,98 |
| `--c-surface-alt` | 5,74 | 7,82 |
| `--c-survol-ligne` | 5,93 | 8,03 |
| `--c-selection` | 5,33 | 6,81 |
| fonds ok / att / dan / inf / neu (alertes, badges) | 5,54 à 5,88 | 7,68 à 8,72 |

**Boutons de segment (`.segment__bouton`).** Le conteneur `.segment` rogne ce qui déborde : l'anneau est donc dessiné à l'intérieur du bouton et touche, d'un côté la bordure du segment (`--c-bordure-champ`), de l'autre le fond du bouton. Un anneau d'une seule couleur ne peut pas atteindre 3:1 contre les deux. Règle retenue :

- **Option non active** : anneau à deux bandes. Bande extérieure de 2 px en `--c-surface` (`outline`, décalé de -2 px), bande intérieure de 2 px en `--c-focus` (`box-shadow: inset 0 0 0 4px`).
- **Option active** (fond `--c-primaire`) : une seule bande de 4 px en `--c-surface` (`outline` de 4 px décalé de -4 px, sans `box-shadow`). Le rendu est un cadre clair à l'intérieur du segment ; l'anneau bleu ne peut pas servir ici, il se confond avec le fond primaire.
- Les coins extérieurs du segment sont arrondis (`--r-m` moins l'épaisseur de la bordure) pour que l'anneau épouse le conteneur.

| Paire | Avant (clair / sombre) | Après (clair / sombre) |
|---|---|---|
| Anneau contre le fond de l'option active (`--c-primaire`) | `--c-focus` : 1,02 / 1,22 | `--c-surface` : 6,46 / 7,34 |
| Anneau contre la bordure du segment (`--c-bordure-champ`), option active | `--c-focus` : 1,55 / 1,74 | `--c-surface` : 4,26 / 5,16 |
| Bande extérieure contre la bordure, option non active | `--c-focus` : 1,55 / 1,74 | `--c-surface` : 4,26 / 5,16 |
| Bande intérieure contre le fond de l'option non active (`--c-surface`) | 6,62 / 8,98 | `--c-focus` : 6,62 / 8,98 |
| Bande intérieure contre le fond au survol (`--c-surface-alt`) | 5,74 / 7,82 | `--c-focus` : 5,74 / 7,82 |
| Bande extérieure contre bande intérieure | sans objet | `--c-surface` / `--c-focus` : 6,62 / 8,98 |

**Contraste forcé (`forced-colors`).** Les ombres sont ignorées dans ce mode : le bouton de segment reçoit un anneau de 3 px en `Highlight` (décalé de -3 px), et en `HighlightText` sur l'option active, dont le fond est `Highlight`.

**Éléments examinés** : boutons primaire, secondaire, discret, danger, danger discret, petit et boutons de mode de paiement ; badges cliquables de statut ; liens et lien d'évitement ; onglet actif de la navigation ; champs, listes, cases ; résumés de dépliants ; boutons de dépliage de ligne ; boutons d'un toast ; conteneurs de tableau focalisables ; lignes sélectionnées ; colonnes de graphique (anneau tracé en SVG, 3 px en `--c-focus`, entre le fond de survol `--c-survol-ligne` et la surface : 5,93 / 8,03 et 6,62 / 8,98, sans toucher les barres, qui sont en retrait du rectangle de focus). Aucun autre composant n'a d'anneau en contact avec un fond coloré.

## 4. Palette des états et des graphiques

### 4.1 État de paiement (calculé) et statut de facturation

Le sens est porté par **mot + symbole + forme** ; la couleur n'est qu'un renfort. Les valeurs de `data-etat` / `data-statut` sont **les codes de l'API** (`paye`, `partiel`, `non_paye`, `a_facturer`, `facture`).

| Valeur | Texte affiché | Symbole | Bordure | Couleur |
|---|---|---|---|---|
| `data-etat="paye"` | Payé | ✓ | pleine | ok (vert) |
| `data-etat="partiel"` | Partiellement payé | ◐ | pleine | att (ambre) |
| `data-etat="non_paye"` | Non payé | ○ | pleine | dan (rouge) |
| `data-statut="a_facturer"` | À facturer | ◇ (vide) | **pointillée** (tirets) | neutre sur fond de surface |
| `data-statut="facture"` | Facturé | ◆ (plein) | pleine | inf (bleu) |
| `.badge--a-venir` | À venir | » | **pointillée** (points) | neu (gris) |
| `.badge--attention` | « Trop-perçu 5,00 € », « Illisible » | ! | pleine | att |

Le texte est **toujours présent dans le HTML** ; le symbole est un pseudo-élément décoratif (`content: "✓" / ""` avec une déclaration de repli : le texte alternatif vide évite l'annonce du symbole par les lecteurs d'écran qui le gèrent).

### 4.2 Séries des graphiques

Les couleurs des séries sont les jetons `--serie-paye`, `--serie-attente`, `--serie-a-facturer` et `--serie-prevu`. Les séries ont un ordre de pile fixe (de bas en haut) et un **motif propre** ; la couleur seule ne les distingue pas (les quatre teintes ont des luminances proches, ratios entre elles ≈ 1,0 à 1,3 : c'est volontaire, le motif et la légende font le travail).

| Série | `data-serie` | Sens | Clair / sombre | Motif |
|---|---|---|---|---|
| Payé | `paye` | part versée (ou « Encaissé » dans la vue par date de versement) | `#1f8a5b` / `#3fb883` | **plein** |
| Facturé en attente | `attente` | reste à payer des prestations facturées | `#b86e00` / `#e0a032` | **points** |
| À facturer | `a-facturer` | reste à payer des prestations non facturées | `#2f6fb8` / `#6aa5ee` | **hachures diagonales** |
| Prévu | `prevu` | complément estimé (prévision) ; « séances à venir » dans le graphique des séances | `#6f7c8a` / `#98a5b3` | **contour en tirets, fond vide** |
| Neutre | `neutre` | barres qui ne sont pas des montants par état (séances réalisées) | couleur `--c-primaire` | **plein** |

Contrastes de chaque série contre la surface (élément graphique, ≥ 3:1) : clair **4,33 / 3,99 / 5,14 / 4,26** (payé, attente, à facturer, prévu) ; sombre **6,48 / 7,14 / 6,36 / 6,46**. Les motifs « points » et « hachures » ont un liseré de leur couleur : la forme de la barre reste ≥ 3:1 même si le motif laisse voir la surface.

## 5. Composants

Les noms de classes sont le **contrat** (§7). Les états sont décrits par attributs ARIA quand ils existent (`aria-pressed`, `aria-expanded`, `aria-current`, `aria-invalid`, `aria-busy`, `disabled`).

### 5.1 Boutons — `.btn`
- Variantes : `.btn--primaire` (action principale de la zone, **une seule par zone**), `.btn--secondaire` (bordure), `.btn--discret` (lien-bouton), `.btn--danger` (plein, suppression définitive ou action sans retour), `.btn--danger-discret` (contour rouge, déclencheur d'une confirmation). Tailles : défaut 44 px, `.btn--petit` 36 px. Un `<a>` peut porter `.btn` (liens d'action : « Définir mes prestations et tarifs », « Voir la liste »).
- Paiement : il n'y a plus de bouton « Payé en totalité ». Dans les lignes de prestations, le paiement se fait par le groupe de paiement en un clic `.paiement-rapide` (§5.14), absent (non rendu) si le reste à payer est 0.
- `.btn-statut` + `.badge` + `data-statut` : bouton de statut en un clic (§5.4).
- `.btn-deplier` + `aria-expanded` : dépliage de la ligne patient (chevron en bordures CSS).
- Désactivé : `disabled` (opacité 0,55, curseur « interdit »). En cours d'action : `aria-busy="true"` (curseur « en cours »).
- Le libellé est un **verbe d'action précis** : « Ajouter la prestation », « Marquer facturé », « Enregistrer le versement ». Pas de « OK ».
- Les boutons d'une ligne de tableau portent un `aria-label` qui nomme la prestation et le patient (« Modifier la prestation du 07/10/2026 de Lapin Pierre »).

### 5.2 Champs de formulaire — `.champ`
Structure (label toujours visible, jamais remplacé par un placeholder) :

```html
<div class="champ champ--erreur">                       <!-- champ--erreur seulement en cas d'erreur -->
  <label class="champ__label" for="champ-1">Nom <span class="champ__requis"> (obligatoire)</span></label>
  <input class="input" id="champ-1" name="nom" autocomplete="off" aria-describedby="champ-1-erreur" aria-invalid="true">
  <p class="champ__erreur" id="champ-1-erreur">Indiquez le nom du patient.</p>   <!-- hidden tant qu'il n'y a pas d'erreur -->
</div>
```

- « Obligatoire » est écrit en toutes lettres (pas un astérisque seul).
- Montant : `<div class="champ-montant"><input class="input" inputmode="decimal" autocomplete="off" …><span class="champ-montant__unite" aria-hidden="true">€</span></div>`, `type="text"` (pas `number` : on accepte « 1 250,50 »), aligné à droite. Le label contient « (€) ». Au focus, le texte du montant est sélectionné pour être remplacé d'une frappe.
- Date : `<input type="date">` natif (clavier : jj/mm/aaaa, calendrier du navigateur). Valeur par défaut = « aujourd'hui » fourni par le serveur (`GET /api/etat`).
- Liste : `<select class="input">` natif ; la frappe d'une lettre saute à l'option. La première option d'une liste obligatoire est un invite (« Choisir une prestation »). Le mode de paiement n'est plus une liste : c'est un choix à boutons (`.choix-mode`, §5.14).
- Case à cocher / radio : `.case` (libellé cliquable, zone ≥ 36 px).
- Groupes : `fieldset.groupe` + `legend`.
- Messages d'erreur : texte précédé de « ! » (pseudo-élément), bordure du champ **épaissie à 3 px** (pas seulement rouge), liés par `aria-describedby` et `aria-invalid`. Un **résumé** `.alerte--danger` (`role="alert"`, titre « N champ(s) à corriger ») avec un lien vers chaque champ en erreur apparaît en haut du formulaire à la soumission ; le focus va au premier champ en erreur.
- Grille adaptative : `.formulaire-grille` (colonnes `auto-fit` de 11 rem min, sans media query ; `.champ--large` occupe 2 colonnes, une seule sous 40 em).
- Filtres : `.filtres` (flex, retour à la ligne), regroupés dans un `role="group"` nommé. Sélecteur de mois : `.selecteur-mois`. Commutateur de vue : `.segment` + `.segment__bouton[aria-pressed]` (l'option active affiche aussi un ✓).
- Les champs nominatifs (nom, prénom, motif, filtre patient) portent `autocomplete="off"` : le navigateur ne mémorise pas de noms de patients.
- Nom et Prénom de la saisie d'une prestation sont des **combobox** avec liste de patients enregistrés (`.champ--combo`, `.suggestions`) : §8.10.

### 5.3 Tableaux — `.table`
- `<div class="table-wrap" role="region" aria-label="…" tabindex="0"> <table class="table">…` : conteneur défilant au clavier sur petit écran.
- `<caption>` (souvent `.sr-only`) obligatoire ; `<th scope="col">` pour les en-têtes ; `<th scope="row">` pour la cellule qui sert de titre de ligne (patient, date de sauvegarde).
- Colonnes : `.col-nombre` (droite, tabulaire), `.col-montant` (idem, gras), `.col-action` (droite, sans retour à la ligne), `.col-case` (cases de sélection), `.col-reste`, `.col-etat-paiement`, `.col-tarif`, `.col-libelle-tarif`. Définies mais non utilisées par les tableaux actuels : `.col-centre`, `.col-secondaire` (masquée sous 48 em), `.col-prestation`.
- En-tête collant (`thead th` sticky) ; `.table-wrap--haut` limite la hauteur à 70 vh (liste des prestations, liste des sauvegardes).
- Pas de bandes zébrées : séparateurs fins + survol. Ligne sélectionnée : `.ligne--selectionnee`. Ligne à venir : `.ligne--a-venir` (bande grise à gauche + texte en italique, hors montants et contrôles) avec un badge « À venir ». Ligne désactivée : `.ligne--inactive` (texte atténué ; les champs de la ligne aussi). Ligne qui vient d'être modifiée : `.ligne--modifiee-recemment` (surbrillance douce de 1,6 s, désactivée si mouvement réduit).
- Totaux : `<tfoot>` ou `tr.ligne--total` : **gras + double filet**.
- Cellule à deux lignes : `.cellule-double__secondaire` (ex. prestation + motif en dessous, « versé X · reste Y »).
- Colonne Paiement de l'écran Prestations : dans le `div[role="group"]` de `.col-etat-paiement`, le mode de paiement est affiché **en ligne** après le badge d'état. Contrat de structure : `<span class="cellule-double__secondaire modes-paiement">` contenant un `<span class="mode-paiement">` par mode, séparés par un simple espace ; **aucun « + » ni « · » dans le DOM** (le CSS les ajoute en `::before`, donc invisibles pour les lecteurs d'écran, qui ont déjà l'`aria-label` du groupe). Le premier mode reçoit « · », chacun des suivants « + » ; chaque `.mode-paiement` est en `white-space: nowrap` : le retour à la ligne se fait **entre** deux modes, le séparateur partant avec le mode qu'il précède. Quand le mode contient une icône SVG plutôt que du texte, voir §5.13.
- Ligne de détail : `tbody.patient` regroupe le `<tr>` patient et `<tr class="ligne-detail" hidden>` ; `.ligne-detail__contenu` à l'intérieur de la seule cellule `colspan`. Le contenu du détail ne peut pas élargir le tableau parent (`contain: inline-size`) : son propre tableau défile dans son cadre.
- Montant : classe `.montant` sur tout élément affichant des euros ; `.montant--zero` (0,00 € atténué), `.montant--reste` (gras renforcé), `.montant--fort` (défini, non utilisé).

### 5.4 Statut de facturation en un clic — `.btn-statut`

```html
<button type="button" class="badge btn-statut" data-statut="a_facturer"
        aria-label="Statut de facturation : à facturer. Marquer comme facturé.">À facturer</button>
```
- Le bouton **affiche l'état courant** (texte + symbole ◇/◆ + forme de bordure) ; le symbole ↻ en fin indique qu'il est cliquable. Au clic : bascule `a_facturer` ⇄ `facture`, message « Marqué facturé. » ou « Remis à facturer. » avec « Annuler », et `aria-label` à jour (dans le récapitulatif, il nomme aussi la prestation et le patient).
- Pour les lignes **à date future**, le clic ne bloque pas : le serveur peut renvoyer un avertissement, affiché dans le message.

### 5.5 Badges — `.badge`
Voir §4.1. Un badge est un `<span>` (information) ou un `<button class="badge btn-statut">` (action). Jamais de badge sans texte. `.badge--info` (bleu) est défini mais non utilisé par les pages actuelles.

### 5.6 Barre de navigation — `.entete-site` / `.nav-principale`
Barre horizontale collante en haut ; 5 entrées une fois la page Patients livrée (Facturation du mois, Prestations, Patients, Tableau de bord, Paramètres ; 4 aujourd'hui, sans Patients) ; la marque « suivi-facturation » (texte, lien vers l'accueil) est à gauche. Entrée courante : `aria-current="page"` → **fond bleu pâle + texte gras + trait de 3 px en dessous** (pas la couleur seule). Sous 40 em, les liens se répartissent sur toute la largeur et passent à la ligne (pas de menu « hamburger », donc aucun JS). Lien d'évitement `.skip-link` (« Aller au contenu ») en premier.

### 5.7 Boîtes de dialogue — `dialog.dialogue`
- Élément **`<dialog>` natif** ouvert avec `showModal()` : piège à focus, Échap et inertie du reste de la page fournis par le navigateur. `.dialogue--large` pour les écrans riches (modification de prestation, conflit, copie manuelle).
- Structure : `.dialogue__entete` (`h2.dialogue__titre`, référencé par `aria-labelledby`), `.dialogue__corps`, `.dialogue__pied` (boutons, alignés à droite ; pleine largeur sous 40 em, la feuille se colle en bas de l'écran). Le dialogue est retiré du DOM à sa fermeture.
- **Focus initial** : sur le premier champ pour un formulaire ; sur **le bouton « Annuler »** pour une confirmation (une frappe accidentelle sur Entrée ne détruit rien) ; sur le titre pour le dialogue de conflit. À la fermeture, le focus retourne à l'élément déclencheur.
- Confirmation : titre = la question (« Supprimer cette prestation ? »), corps = la conséquence, pied = [Annuler] [verbe de l'action]. Le bouton de confirmation est `.btn--danger` pour une action destructive, `.btn--primaire` sinon, et reprend le verbe (« Supprimer la prestation », « Marquer facturé »).
- Dialogues présents : confirmations (suppression d'une prestation ou d'un versement, marquer facturé, restauration, quitter l'application, nombre de sauvegardes réduit, renommage d'une prestation du catalogue, repartir d'un fichier vide), ajout / modification d'un versement, choix du mode de paiement, choix d'un homonyme, renommage d'un patient, modification d'une prestation, copie manuelle, choix de version en cas de conflit ; page Patients (§8.11) : renommer, « Un patient porte déjà ce nom », supprimer un patient.
- Pas de bouton de fermeture « × » : « Annuler » et Échap suffisent.

### 5.8 Messages éphémères (toasts) — `.toasts` / `.toast`
- Conteneur unique `<div class="toasts" role="status" aria-live="polite">` **présent dès le chargement** (sinon l'annonce n'est pas lue), fixé en bas, centré. Un toast d'erreur reçoit `role="alert"`.
- Contenu : `.toast__texte` + éventuel `.toast__action` (« Annuler ») + `.toast__fermer` (« × », `aria-label="Fermer"`). Variantes : défaut (succès ✓), `.toast--attention` (!), `.toast--erreur` (✕).
- Durées : succès simple 6 s ; avec « Annuler » **12 s** ; avertissement 10 s ; **erreur : reste jusqu'à fermeture**. La minuterie se **met en pause** au survol et au focus (WCAG 2.2.1).
- Un seul message à la fois : un nouveau toast remplace le précédent. L'annulation proposée ne vaut que pour la dernière action.

### 5.9 Alertes, bandeaux, avertissements — `.alerte`
- Variantes : défaut (information, « i »), `--succes` (✓), `--attention` (!), `--danger` (✕). Chaque alerte a un **symbole + un titre `.alerte__titre` en toutes lettres** (« Attention », « Erreur », « Lecture seule »…), une barre de 8 px à gauche, un texte `.alerte__texte`, et peut porter des `.alerte__actions` (boutons ou liens `.btn`). `.alerte--exemple` (bordure en tirets, compacte) porte le bandeau « Données d'exemple » affiché sur toutes les pages pendant `npm run demo`, jamais en usage normal.
- Structure : `.alerte > .alerte__corps > strong.alerte__titre + p.alerte__texte (+ .alerte__actions)`.
- ARIA : `role="alert"` pour les erreurs bloquantes et conflits ; `role="status"` pour les informations ; les bandeaux de page sont regroupés dans `.bandeaux` (`aria-live="polite"`, masqué quand vide).
- Avertissements non bloquants d'un formulaire (versement avant la prestation, trop-perçu) : `.avertissements` contenant des `.alerte--attention` ; ils n'empêchent pas l'enregistrement.
- Liste des bandeaux d'état : §8.6.

### 5.10 État vide — `.etat-vide`
Bloc centré à bordure en tirets : `.etat-vide__titre` (ce qui manque), `.etat-vide__texte` (quoi faire), `.etat-vide__actions` (boutons). Variante positive `.etat-vide--positif` (« Aucun impayé »). Libellés en place : « Aucune prestation ce mois-ci », « Aucune prestation ni versement ce mois-ci » (vue par date de versement), « Aucune prestation » (filtre sans résultat), « Aucune sauvegarde disponible », « Pas encore de données à afficher » (tableau de bord). Jamais de tableau ou de graphique vide muet. Les accueils de premier démarrage (catalogue vide, fichier sans prestation) sont décrits au §8.7.

### 5.11 Cartes et indicateurs — `.carte`, `.kpi`
`.carte` (+ `__entete`, `__titre`, `__note`) ; `.grille-cartes` (colonnes `auto-fit` de 14 rem). `.kpi` : `.kpi__libelle`, `.kpi__valeur` (1,75 rem, gras, tabulaire, sans retour à la ligne), `.kpi__detail` ; `data-serie` ajoute un trait gauche de 6 px dont **le style varie** (plein, double pour `a-facturer`, tirets pour `prevu`) en plus de la couleur. `data-serie="neutre"` (indicateur des séances) n'a pas de règle de couleur : le trait garde la couleur de bordure par défaut.

### 5.12 Autres
- Dépliant « Voir les chiffres » : `details.depliant > summary` + `.depliant__contenu` (chevron CSS).
- Barre de sélection multiple : `.barre-selection` (collante en bas, `hidden` tant qu'aucune ligne n'est cochée) : « 3 prestations sélectionnées [Marquer facturé] [Tout désélectionner] ». Son texte est une région `role="status"`.
- Liste clé/valeur : `dl.infos` (Paramètres : sauvegardes, dossier de données).
- `.chargement` : texte « Chargement… » (`role="status"`) ; pas de squelette animé.
- `.code` : bloc à chasse fixe, sélectionnable d'un clic (chemin de dossier).
- Région live masquée `#annonce-facturer` (`index.html`) : annonce la synthèse « À facturer » quand elle change.

### 5.13 Icônes des modes de paiement

> Les modes de paiement ont des icônes dans deux usages. La colonne « Paiement » de la liste des prestations les affiche **seules** (le nom est dans l'`aria-label` du groupe). Les boutons de paiement en un clic et le choix du mode des dialogues (§5.14) les emploient aussi, **avec le nom complet du mode** (texte visible ou `aria-label`). Partout ailleurs (détail du versement, exports, récapitulatif) le mode reste écrit en toutes lettres.

**Principes.** Cinq icônes SVG dessinées à la main, tracés au trait, monochromes (`currentColor`), sans émoji, sans fichier ni police externe. Elles sont construites en JavaScript avec `createElementNS` (`js/icones-paiement.js`). Grille 24 × 24, tracés dans une marge de 2 unités ; épaisseur 1,75 ; extrémités et jointures arrondies. Affichées à **20 px** (1,25 rem, suit le zoom du navigateur).

**Attributs de présentation.** Posés par le CSS (`.icone-mode` : `fill:none; stroke:currentColor; stroke-width:1.75; stroke-linecap:round; stroke-linejoin:round`). Aucun attribut `style`.

**Éléments exacts** (contenu de l'`<svg viewBox="0 0 24 24">`) :

| Mode (code UI) | Classe | Contenu |
|---|---|---|
| Carte bancaire | `icone-mode--carte` | `<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><line x1="2.5" y1="10" x2="21.5" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>` |
| Chèque | `icone-mode--cheque` | `<rect x="2.5" y="5" width="19" height="14" rx="2"/><line x1="6" y1="9" x2="13" y2="9"/><line x1="6" y1="12.5" x2="10" y2="12.5"/><path d="M12.5 16.5c1.2-2.7 2.2-2.7 2.8-.7.5 1.5 1.6 1.5 2.7-1"/>` |
| Espèces | `icone-mode--especes` | `<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.75"/>` |
| Virement | `icone-mode--virement` | `<path d="M4 8h16"/><path d="M16 4l4 4-4 4"/><path d="M20 16H4"/><path d="M8 12l-4 4 4 4"/>` |
| Autre | `icone-mode--autre` | `<circle cx="5" cy="12" r="0.75"/><circle cx="12" cy="12" r="0.75"/><circle cx="19" cy="12" r="0.75"/>` |

**Justification des pictogrammes.**
- **Carte bancaire** : rectangle arrondi (format carte) avec une bande horizontale en haut et un court trait en bas (numéro) : le pictogramme usuel de la carte.
- **Chèque** : rectangle, deux lignes en haut à gauche (ordre et montant) et une signature ondulée en bas à droite. Se distingue de la carte par l'absence de bande pleine largeur et par la signature.
- **Espèces** : billet (rectangle plus plat que la carte) avec un cercle central.
- **Virement** : deux flèches horizontales opposées (l'une vers la droite en haut, l'autre vers la gauche en bas). Une façade de banque à colonnes a été écartée : trop de détails pour rester lisible à 20 px.
- **Autre** : trois points alignés (« … »), le symbole de « plus d'options ». Un point est un cercle de rayon 0,75 tracé (diamètre visuel ≈ 3 unités avec le trait).

**Ordre d'affichage.** Celui des modes dans la donnée des versements (ordre chronologique du premier versement de chaque mode), sans doublon, comme dans l'`aria-label` du groupe. Aucun tri n'est imposé par le CSS. Un mode inconnu reçoit l'icône « Autre ».

**Contrat de structure.**

```html
<div role="group" aria-label="Payé en totalité par virement et chèque">
  <span class="badge" data-etat="paye">Payé</span>
  <span class="cellule-double__secondaire modes-paiement">
    <span class="mode-paiement" title="Virement"><svg class="icone-mode icone-mode--virement" viewBox="0 0 24 24" aria-hidden="true" focusable="false"> … </svg></span>
    <span class="mode-paiement" title="Chèque"><svg class="icone-mode icone-mode--cheque" viewBox="0 0 24 24" aria-hidden="true" focusable="false"> … </svg></span>
  </span>
</div>
<div class="cellule-double__secondaire">versé 58,00 € · reste 0,00 €</div>
```

- Un `<span class="mode-paiement" title="Libellé du mode">` **par mode**, séparés par **un espace** (le DOM, pas le CSS, fournit l'espace entre deux icônes). `title` = libellé complet (bulle au survol ; imprimé à côté de l'icône, voir ci-dessous).
- `<svg>` : `aria-hidden="true"`, `focusable="false"`, **pas de `<title>`** (sinon double annonce et double bulle). La source accessible est l'`aria-label` du `div[role="group"]` (« Payé en totalité par virement et chèque », « Partiellement payé par espèces », « Non payé »…). La bulle `title` n'est pas accessible au clavier : le libellé est dans l'`aria-label`, et le mode reste lisible en toutes lettres dans le dialogue de modification.
- **Aucun texte « + » ni « · » dans le DOM.** Le « · » entre le badge et la première icône est un `::before` CSS du premier `.mode-paiement` ; il n'y a pas de « + » entre icônes.
- Le rendu texte (`.mode-paiement` contenant le libellé, sans `<svg>`) reste valable : les règles d'icônes ne s'activent que si le mode contient un `.icone-mode` (sélecteur `:has`).

**Règles CSS (`ecrans.css` et `impression.css`).**
- Taille : `width`/`height` 1,25 rem, alignées au milieu du badge (`vertical-align: middle`).
- Couleur : `--c-texte-doux` (survol : `--c-texte`). **Contrastes calculés (≥ 3:1 exigé pour un élément graphique)** : thème clair 7,40:1 sur la surface, 6,63:1 sur le survol de ligne, 5,96:1 sur la ligne sélectionnée, 6,41:1 sur `--c-surface-alt` ; thème sombre 7,87:1 sur la surface, 7,04:1 au survol de ligne, 5,97:1 sur la sélection, 6,85:1 sur `--c-surface-alt`. Survol de l'icône : texte plein, 14,60:1 (clair) et 12,32:1 (sombre) sur le survol de ligne.
- Retour à la ligne : seulement **entre** deux icônes (chaque `.mode-paiement` est insécable) ; interligne 1 pour un groupe compact.
- Contraste forcé (Windows) : trait en `CanvasText`.
- **Impression** : icônes en noir, 4,2 mm, et le **nom du mode est écrit à côté** (`::after { content: " " attr(title) }`), car la bulle n'existe pas sur papier. D'où l'obligation de renseigner `title`.
- Rien n'est cliquable : `cursor: help` seulement ; pas de `tabindex`.

### 5.14 Paiement en un clic et choix du mode

> Deux composants servent à choisir le mode de paiement avec le moins de gestes possible : le **groupe de paiement** `.paiement-rapide` (dans la ligne d'une prestation) et le **choix du mode** `.choix-mode` (dans les dialogues). Tous deux réutilisent les cinq icônes de §5.13, **toujours accompagnées du nom complet du mode** (dans `aria-label` et `title` pour les icônes seules, en texte visible dans les dialogues).

#### Groupe de paiement — `.paiement-rapide`

Où : colonne « Actions » de l'écran Prestations et détail de l'écran Facturation du mois, **uniquement quand le reste à payer est supérieur à 0** (sinon le groupe n'est pas rendu). Il a remplacé l'ancien bouton « Payé en totalité » (supprimé, ainsi que son style). Un clic sur un mode enregistre **le reste à payer, daté d'aujourd'hui, avec ce mode**, sans dialogue.

```html
<div class="paiement-rapide" role="group"
     aria-label="Payer le reste de la prestation du 07/10/2026 de Lapin Pierre : 58,00 €">
  <span class="paiement-rapide__titre" aria-hidden="true">Payer</span>
  <button type="button" class="btn btn--petit btn--secondaire paiement-rapide__declencheur"
          aria-expanded="false" aria-controls="paiement-rapide-ID"
          aria-label="Payer 58,00 € : choisir le mode de paiement (prestation du 07/10/2026 de Lapin Pierre)">Payer</button>
  <span class="paiement-rapide__modes" id="paiement-rapide-ID">
    <button type="button" class="btn btn--petit paiement-rapide__mode" data-mode="carte" data-recent="oui"
            title="Carte bancaire (dernier mode utilisé)"
            aria-label="Payer 58,00 € par carte bancaire, dernier mode utilisé : prestation du 07/10/2026 de Lapin Pierre">
      <svg class="icone-mode icone-mode--carte" viewBox="0 0 24 24" aria-hidden="true" focusable="false"> … </svg>
    </button>
    <button type="button" class="btn btn--petit paiement-rapide__mode" data-mode="cheque" title="Chèque"
            aria-label="Payer 58,00 € par chèque : prestation du 07/10/2026 de Lapin Pierre"> <svg …/> </button>
    <!-- espèces, virement, autre : même structure, toujours dans cet ordre -->
  </span>
</div>
```

- **Ordre fixe** : carte bancaire, chèque, espèces, virement, autre (celui de `LIBELLES_MODE`). Les boutons ne changent jamais de place : le geste reste le même d'une ligne à l'autre. Le mode récent est signalé, pas déplacé.
- **Nom accessible** : chaque bouton annonce le verbe, **le montant exact** et **le nom complet du mode**, puis la prestation concernée (« Payer 58,00 € par chèque : prestation du … de … »). Le montant est celui affiché au moment du rendu ; le message qui suit l'enregistrement annonce le montant réellement enregistré (le serveur utilise le reste à payer à cet instant). Le groupe a son propre `aria-label` ; son texte visible « Payer » (`__titre`) est masqué aux lecteurs d'écran (il répéterait le nom du groupe).
- **Mode récent** (`data-recent="oui"`, au plus un bouton) : le dernier mode utilisé, pris dans `dernierModePaiement` fourni par `GET /api/etat`. C'est **une mise en évidence seule** : aucun enregistrement n'a lieu sans clic. Signes cumulés, jamais la couleur seule : bordure de 2 px en couleur primaire (6,46:1 sur la surface en clair, 7,34:1 en sombre), fond `--c-selection` (texte dessus 13,12:1 en clair, 10,45:1 en sombre), pastille pleine en coin, et la mention « dernier mode utilisé » dans `title` et `aria-label`. Aucun mode récent (jamais de versement) : aucun bouton n'est mis en évidence.
- **Mode actuel** (variante « changer le mode d'un versement », plus bas) : `aria-pressed="true"` au lieu de `data-recent` ; fond plein `--c-primaire`, texte `--c-sur-primaire` (6,46:1 / 7,94:1) et double filet intérieur.
- **Taille** : 36 × 36 px (`--cible-s`) à la souris ; **44 × 44 px** (`--cible`) sur écran tactile (`pointer: coarse`) et dans la variante compacte. Icône de 20 px (§5.13). Écart de 8 px entre deux boutons, donc cibles distinctes (WCAG 2.5.8). Largeur du groupe déployé : titre + 5 × 36 + 4 × 8 + filet, soit environ 264 px (mesuré), sur **une seule ligne** : les cinq boutons ne passent jamais à la ligne et ne s'empilent jamais en colonne.
- **Contrastes** (calculés) : bordure de bouton `--c-bordure-champ` sur la surface 4,26:1 (clair) / 5,16:1 (sombre) ; icône `--c-texte` sur la surface 16,29:1 / 13,77:1 ; au survol (`--c-surface-alt`) 14,13:1 / 11,99:1. Tous les éléments graphiques dépassent 3:1.
- **Texte** : « Payer » et toute note à 14 px (`--t-s`) au minimum.
- **États** : `disabled` (opacité 0,55) en lecture seule, en conflit de fichier et en mode dégradé, **avec la raison** déjà liée à la page par `aria-describedby` (même mécanisme que les autres contrôles d'écriture) ; `aria-busy="true"` sur le groupe et `disabled` sur les cinq boutons pendant l'enregistrement, ce qui évite un second versement par double clic.
- **Après l'enregistrement** : message éphémère avec « Annuler » (§5.8), du type « 58,00 € enregistrés par carte bancaire. » ; la ligne est mise en surbrillance (`.ligne--modifiee-recemment`), puis le reste à payer passe à 0 et le groupe disparaît de la ligne. Le focus doit passer à un élément qui existe encore (le bouton « Versement » de la même ligne), pas retomber sur `body`.

**Variante compacte**, choisie seulement quand les cinq boutons ne tiennent plus. Le groupe ne montre plus que le déclencheur « Payer ▾ » (chevron CSS) ; les cinq modes sont masqués (`display: none`, donc hors de l'ordre de tabulation et de l'arbre d'accessibilité) tant que `aria-expanded="false"`. Le déclencheur bascule `aria-expanded` ; à `true`, les cinq boutons de 44 px apparaissent **sous** le déclencheur, **sur une seule ligne** (252 px de large), et le tableau les amène à l'écran (`scrollIntoView`). Échap referme et rend le focus au déclencheur ; un clic sur un mode enregistre et referme ; la fermeture au départ du focus est laissée au JavaScript. Le HTML est le même dans les deux variantes ; le choix est **uniquement CSS**, par une **requête de conteneur** sur le cadre du tableau qui porte le groupe (`.table-wrap--modes`, conteneur nommé `tableau`), et non par la largeur de l'écran : ce qui compte est la place réellement disponible pour la colonne « Actions ».

Seuils, mesurés dans le navigateur (largeur minimale du tableau pour que les cinq boutons tiennent sans défilement horizontal : liste des prestations environ 949 px, détail de la Facturation du mois environ 929 px, liste des versements d'un dialogue environ 670 px) :

| Tableau | Conteneur | Cinq modes visibles à partir de |
|---|---|---|
| Liste des prestations, détail de la Facturation du mois | `tableau` | 60 rem (960 px) |
| Versements d'un dialogue (`.table-wrap--modes-dialogue`) | `versements` | 42 rem (672 px) |

```
largeur du tableau ≥ seuil :  Payer  [carte][chèque][espèces][virement][…]  | Versement  Modifier
largeur du tableau < seuil :  [Payer ▾]  Versement  Modifier   (déplié : une ligne de cinq boutons de 44 px sous le déclencheur)
```
Le schéma est indicatif : les icônes réelles sont celles de §5.13. Vérifié à 1 024, 900, 768 et 375 px : à 1 024 px, le tableau de la liste des prestations mesure 960 px (cinq modes visibles, une ligne, sans défilement) et celui du détail de la Facturation du mois 899 px (variante compacte) ; à 900, 768 et 375 px, c'est la variante compacte. Déplié, le groupe occupe 252 px au plus : il tient dans la largeur de l'écran à 375 px. Quand il dépasse le cadre du tableau, c'est le cadre qui défile (jamais la page), comme pour le reste de la colonne « Actions ». Les deux requêtes de conteneur de `composants.css` (`tableau`, `versements`) portent le même bloc de règles, une requête ne pouvant viser qu'un seul conteneur nommé.

#### Choix du mode dans un dialogue — `.choix-mode`

Remplace le menu déroulant « Mode de paiement » du dialogue d'ajout ou de modification d'un versement et du dialogue de choix du mode. Les cinq modes sont des **boutons à choix unique** : de vrais `<input type="radio">` (masqués visuellement mais focalisables) enveloppés dans des `<label>`. On obtient sans JavaScript un seul arrêt de tabulation pour tout le groupe, les flèches pour passer d'un mode à l'autre, l'annonce « 2 sur 5 » par les lecteurs d'écran et la sélection au clic sur toute la surface.

```html
<fieldset class="groupe choix-mode" aria-describedby="mode-aide mode-erreur">
  <legend>Mode de paiement <span class="champ__requis"> (obligatoire)</span></legend>
  <div class="choix-mode__liste">
    <label class="choix-mode__option" data-recent="oui">
      <input class="choix-mode__entree" type="radio" name="mode" value="carte" checked>
      <svg class="icone-mode icone-mode--carte" viewBox="0 0 24 24" aria-hidden="true" focusable="false"> … </svg>
      <span class="choix-mode__texte">Carte bancaire</span>
      <span class="choix-mode__note">Dernier mode utilisé</span>
    </label>
    <label class="choix-mode__option"> … Chèque … </label>   <!-- espèces, virement, autre -->
  </div>
  <p class="champ__erreur" id="mode-erreur" hidden>Choisissez le mode de paiement.</p>
</fieldset>
```

- Chaque option montre **l'icône et le nom en toutes lettres** (texte de 16 px, graisse 600). Hauteur minimale 44 px ; grille `auto-fit` de 10 rem minimum : trois colonnes dans un dialogue large, **deux colonnes à 375 px** (la cinquième option seule sur sa ligne).
- **Option choisie** : fond plein `--c-primaire`, texte `--c-sur-primaire`, coche « ✓ » devant le nom et double filet intérieur. **Option récente** (`data-recent="oui"`, à l'ajout seulement) : bordure primaire et mention texte « Dernier mode utilisé » (14 px). À l'ajout d'un versement, le mode récent est **présélectionné** ; à la modification, c'est le mode du versement qui l'est et aucune mention « récent » n'apparaît. Sans mode récent, rien n'est présélectionné.
- **Focus** : anneau de 3 px `--c-focus` décalé de 2 px **autour** de l'option (`:has(> input:focus-visible)`), donc sur la surface du dialogue, sans conflit avec le fond plein de l'option choisie. Focus initial : le champ « Montant » (formulaire de versement) ; l'option choisie ou, à défaut, la première (dialogue de choix du mode).
- **Erreur** : si aucun mode n'est choisi à l'envoi, `.choix-mode--erreur` épaissit la bordure de chaque option à 3 px, `.champ__erreur` (texte précédé de « ! ») s'affiche, et le résumé d'erreurs du formulaire (§5.2) pointe vers le groupe ; le focus va à la première option.
- **Désactivé** : `disabled` sur chaque radio, options à 0,55 d'opacité.

**Variante « changer le mode d'un versement existant »** (liste des versements du dialogue de modification d'une prestation) : même `.paiement-rapide` dans la cellule « Mode », mais les cinq boutons portent `aria-pressed` (« vrai » pour le mode actuel). Un clic sur un autre mode **enregistre aussitôt** la modification, sans toucher au montant ni à la date ; un clic sur le mode déjà actif ne fait rien. Nom accessible : « Passer le versement du 07/10/2026 en espèces ». Le bouton « Modifier » du versement reste disponible pour changer aussi le montant ou la date ; son dialogue utilise `.choix-mode`.

#### Compatibilité et impression
- Contraste forcé (Windows) : cadres en `ButtonText`, mode choisi ou actuel en `Highlight` / `HighlightText`, mode récent à bordure de 3 px et pastille en `ButtonText`, anneau de focus du choix de mode en `Highlight`.
- Impression : le groupe est dans la colonne « Actions », masquée à l'impression avec les boutons ; rien à ajouter.
- Aucun style en ligne : la présentation relève du CSS seul ; le JavaScript gère le clic, le dépliage et `aria-expanded`.

## 6. Graphiques SVG et barres horizontales

Les barres empilées sont des **SVG faits maison**, uniquement des barres, créés avec `createElementNS` (`js/graphiques/barres-svg.js`, positions calculées par `js/graphiques/mise-en-page.js`), sans style en ligne. Les classements (répartition, impayés) sont des barres horizontales HTML/CSS (§6.5). Cette section fixe ce que le CSS attend.

### 6.1 Structure d'un graphique

```html
<figure class="graphe" aria-labelledby="g1-titre">
  <figcaption class="pile pile--s">
    <h2 class="graphe__titre" id="g1-titre">Chiffre d'affaires par mois</h2>
    <p><span class="graphe__indicatif">Estimation indicative</span></p>      <!-- facultatif -->
    <p class="graphe__sous-titre">Par date de prestation, de novembre 2025 à octobre 2026. Montants en euros. …</p>
    <div class="tdb-outils"> … </div>                                            <!-- facultatif : commutateur de regroupement -->
  </figcaption>
  <ul class="graphe__legende">
    <li class="legende__item"><span class="legende__pastille" data-serie="paye" aria-hidden="true"></span>Payé</li>
    <li class="legende__item"><span class="legende__pastille" data-serie="attente" aria-hidden="true"></span>Facturé en attente (reste à payer)</li>
    <li class="legende__item"><span class="legende__pastille" data-serie="a-facturer" aria-hidden="true"></span>À facturer (reste à payer)</li>
  </ul>
  <div class="graphe__zone">
    <svg class="graphe__svg" role="group" aria-labelledby="g1-svg-titre" aria-describedby="g1-desc" viewBox="0 0 W H">
      <title id="g1-svg-titre">Chiffre d'affaires par mois</title><desc id="g1-desc">Résumé en une phrase (total, mois le plus élevé…)</desc>
      <defs> … motifs (§6.2) … </defs>
      <g class="graphe__grille"> <line …/> </g>
      <g class="graphe__axe"> <line …/> <text …>200 €</text> </g>             <!-- ligne de base et graduations verticales -->
      <g class="graphe__axe"> <text …>oct.<tspan>(estimé)</tspan><tspan class="graphe__annee">2026</tspan></text> </g>   <!-- étiquettes du bas -->
      <g class="graphe__colonne" tabindex="0" role="group" aria-label="octobre 2026 : payé 290,00 €, facturé en attente (reste à payer) 222,00 €, à facturer (reste à payer) 184,00 €, total 696,00 €">
        <rect class="graphe__focus" …/>
        <rect class="graphe__segment" data-serie="paye" …/>
        <rect class="graphe__segment" data-serie="attente" fill="url(#g1-motif-attente)" …/>
        <rect class="graphe__segment" data-serie="a-facturer" fill="url(#g1-motif-a-facturer)" …/>
        <text class="graphe__valeur" …>696 €</text>
      </g>
    </svg>
    <div class="graphe__bulle" hidden aria-hidden="true"> … </div>
  </div>
  <details class="depliant graphe__tableau">
    <summary>Voir les chiffres</summary>
    <div class="depliant__contenu"><div class="table-wrap" role="region" aria-label="Valeurs : Chiffre d'affaires par mois" tabindex="0"><table class="table table--dense"><caption class="sr-only">… : valeurs exactes</caption>…</table></div></div>
  </details>
</figure>
```

Le titre du graphique est un `h2` par défaut (niveau paramétrable). Le mois (ou la semaine) courant est écrit en gras (`.graphe__colonne--courante`, `.graphe__etiquette--forte`).

**Nom et description accessibles.**
- La `<figure>` est nommée par son titre (`aria-labelledby` vers le `h2`).
- Le `<svg>` porte `role="group"` : il est **nommé** par son `<title>` (`aria-labelledby`) et **décrit** par son `<desc>` (`aria-describedby`), qui résume le graphique en une phrase (période, total, mois le plus élevé, présence d'une estimation). Il n'a **pas** `role="img"` : ce rôle rendrait ses enfants présentationnels et les colonnes ne seraient plus atteignables par un lecteur d'écran.
- Chaque colonne est un `<g role="group">` dont l'`aria-label` dit tout : libellé de la période, valeur de chaque série, lignes supplémentaires éventuelles (« dont séances déjà planifiées », « à venir, non facturé (hors barres) »), puis le total. Les colonnes sont focalisables (`tabindex="0"`) tant qu'il y en a 26 au plus ; au-delà, elles gardent leur nom mais ne sont plus des arrêts de tabulation (§6.3, point 6).
- Les éléments purement graphiques (grille, axes, segments, valeurs écrites au-dessus des barres) ne portent aucun nom ni rôle propres : l'`aria-label` de la colonne et le tableau « Voir les chiffres » portent l'information. Ce que chaque lecteur d'écran fait des textes SVG laissés dans le groupe (graduations, valeurs) n'a pas été vérifié (§15.2).
- Le tableau de valeurs est une région nommée (« Valeurs : » suivi du titre), focalisable pour défiler au clavier, avec une légende `.sr-only` (« … : valeurs exactes »).

### 6.2 Motifs (dans le `<defs>` de chaque SVG)

Les motifs sont référencés par **l'attribut `fill="url(#…)"`** sur le segment (pas par le CSS). Le CSS colore l'intérieur des motifs via `data-serie`. Chaque SVG définit les deux motifs, sous des identifiants préfixés par un compteur (`g1-motif-attente`, `g2-motif-a-facturer`…) : les identifiants sont **uniques par page**.

```html
<pattern id="g1-motif-attente" width="6" height="6" patternUnits="userSpaceOnUse">
  <rect class="motif__fond" data-serie="attente" width="6" height="6"/>
  <circle class="motif__trait" cx="3" cy="3" r="1.4"/>
</pattern>
<pattern id="g1-motif-a-facturer" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
  <rect class="motif__fond" data-serie="a-facturer" width="5" height="5"/>
  <rect class="motif__trait" width="5" height="2"/>
</pattern>
```
Séries `paye` et `neutre` : rien (fond plein par CSS). Série `prevu` : rien (fond de surface, contour en tirets par CSS).

### 6.3 Règles de lecture
1. **Ordre de pile fixe** : payé (bas) → facturé en attente → à facturer → prévu (haut).
2. Valeur du total **écrite** au-dessus de chaque barre (`.graphe__valeur`, en euros entiers) quand la colonne est assez large : au moins 54 px (22 px pour les séances) et au moins la largeur estimée du texte plus 6 px ; sinon seules les valeurs écrites sur les barres sont omises, jamais le tableau. Les étiquettes de l'axe horizontal sont espacées d'autant que nécessaire : une sur *k*, avec le plus petit *k* qui laisse 6 px d'air entre deux étiquettes voisines, la première étant toujours écrite.
3. **Légende textuelle** et pastilles aux motifs toujours présentes.
4. **Tableau « Voir les chiffres »** pour chaque graphique (montants exacts par catégorie, ligne de total en pied). Il est l'équivalent textuel intégral du graphique : il sert aux lecteurs d'écran, à l'impression et à ceux qui préfèrent les chiffres.
5. Info-bulle `.graphe__bulle` : s'affiche au survol **et au focus clavier** d'une colonne, se ferme par Échap ; positionnée en JS via `element.style.left/top` (CSSOM, compatible CSP) ; contient le libellé de la période, les montants par catégorie, les lignes supplémentaires éventuelles et le total (`dl`). Elle est `aria-hidden` : elle ne porte aucune information absente de l'`aria-label` de la colonne et du tableau.
6. **Colonnes nommées, focalisables jusqu'à 26.** Chaque colonne est un `role="group"` avec un `aria-label` complet (§6.1). Elle reçoit `tabindex="0"` tant que le graphique compte 26 colonnes au plus ; au-delà (par exemple en vue hebdomadaire sur une longue période), elle garde son nom mais n'est plus un arrêt de tabulation, pour ne pas imposer des dizaines de tabulations : le tableau de valeurs fait foi. Le rectangle `.graphe__focus` matérialise le survol et le focus (l'`outline` sur un `<g>` SVG n'étant pas fiable) : trait de 3 px en `--c-focus` sur fond `--c-survol-ligne`, et traits des segments épaissis.
7. État vide : pas de SVG, un `.etat-vide` (« Aucune prestation sur cette période », « Aucun versement sur cette période », « Aucune séance sur cette période »).
8. Section en erreur : `.carte.tdb-section-erreur` (bordure en tirets) avec un titre et une `.alerte--attention` (« Section non affichée ») ; les autres sections s'affichent.
9. Prévision (graphique du chiffre d'affaires, vue par date de prestation seulement) : barres « réel » (séries habituelles) + complément estimé en série `prevu` sur le mois en cours et les trois suivants, **et** le badge `.graphe__indicatif` « Estimation indicative » sous le titre ; les mois estimés ont la mention « (estimé) » (« (en partie) » pour le mois en cours) sous leur étiquette d'axe et dans le tableau. Historique insuffisant : aucune barre estimée, un `.etat-vide` « Estimation indicative : pas assez d'historique pour le moment » explique le nombre de mois manquants.

### 6.4 Dimensions
Le SVG est **redessiné à la largeur réelle** de `.graphe__zone` (`ResizeObserver`, pas en dessous de 120 px de large), avec `viewBox="0 0 largeur hauteur"` en pixels : une unité = un pixel.

**Texte à 14 px.** Le texte du graphique (graduations, étiquettes, valeurs) est en `--t-s`, soit 14 px au réglage par défaut du navigateur, comme les autres petits textes de l'interface. Le dessin est calé sur cette valeur : `public/js/graphiques/mise-en-page.js` en garde la copie (`TAILLE_TEXTE = 14`, interligne des étiquettes `INTERLIGNE = 17`).

**Marges internes en pixels fixes.** Elles sont calculées en pixels à partir de ces 14 px, pas en `rem` :
- haut : 22 px (valeurs au-dessus des barres) ; droite : 8 px ;
- gauche : la largeur estimée de la plus large graduation de l'axe des montants, plus 14 px (écart au trait et un peu d'air), 36 px au minimum ;
- bas : 32 px pour une ligne d'étiquette (le mois), puis 17 px de plus par ligne ajoutée : une mention comme « (estimé) » ou « (en partie) », l'année (49 px avec l'une, 66 px avec les deux).

La zone des barres a une hauteur fixe de 194 px (zone d'au moins 640 px de large) ou 154 px (plus étroit) : la hauteur totale du SVG s'obtient en ajoutant les marges, et la zone des barres garde sa hauteur quand l'axe a une ligne de plus. Les largeurs de texte sont estimées par un calcul simple (la police réelle n'est pas mesurable en dehors du navigateur) : légèrement larges plutôt que justes. Conséquence : si l'utilisatrice agrandit **seulement la taille du texte** dans le navigateur (et non le zoom de page), le texte des graphiques grandit mais ses marges restent les mêmes ; étiquettes et graduations peuvent alors se serrer ou déborder. Limite non vérifiée : §15.2.

La barre occupe 70 % de sa colonne, 56 px au plus. L'échelle de l'axe vertical a un pas de 1, 2, 5 ou 10 × une puissance de 10 (au moins 1 € pour les montants, 1 pour les effectifs), pour environ quatre graduations. Pas de `style=` : toutes les formes sont dimensionnées par attributs (`x`, `y`, `width`, `height`).

### 6.5 Barres horizontales HTML/CSS (répartition par prestation, impayés)

```html
<ul class="barres-h">
  <li><a class="barre-h" href="/prestations.html?statut=facture&anciennete=0-29" aria-label="Facturées, moins de 30 jours : reste à payer 222,00 €, 5 prestations. Voir la liste.">
    <span class="barre-h__libelle">Moins de 30 jours</span>
    <span class="barre-h__piste" aria-hidden="true"><span class="barre-h__rempli" data-serie="attente"></span></span>   <!-- largeur : el.style.setProperty('--part','100%') -->
    <span class="barre-h__valeur">222,00 €<small>5 prestations</small></span>
  </a></li>
</ul>
```
Un élément avec lien est un `<a class="barre-h">`, sinon un `<div class="barre-h">`. `data-serie` sur `.barre-h__rempli` : `attente` (ambre) ou `a-facturer` (hachures) ; sans attribut la barre est en couleur primaire (répartition). La largeur passe par la variable CSS `--part` posée en JS (CSSOM). Le texte (libellé, montant, pourcentage ou nombre de prestations) porte l'information ; la barre est un renfort, masquée aux lecteurs d'écran. Sous 40 em, une ligne se met sur deux rangées (libellé + valeur, puis piste).

## 7. Contrat de classes et d'attributs

Récapitulatif des classes définies dans `public/css/`. Les classes absentes de ce tableau n'existent pas.

### 7.1 Structure
| Classe / attribut | Où | Rôle |
|---|---|---|
| `.skip-link` | 1er enfant de `<body>` | lien d'évitement vers `#contenu` |
| `.entete-site`, `.entete-site__interieur`, `.marque` | en-tête | barre collante |
| `.nav-principale` (`ul > li > a`), `a[aria-current="page"]` | nav | navigation |
| `main.page.ecran-<nom>` | contenu | `ecran-facturation`, `ecran-prestations`, `ecran-tdb`, `ecran-parametres` ; `id="contenu"`, `tabindex="-1"` |
| `.bandeaux` | début de `main` | pile d'`.alerte` (vide = masquée) |
| `.page-titre`, `.page-actions` | h1 + actions | titre de page (le tableau de bord y ajoute « Imprimer ») |
| `.pile`, `.pile--s`, `.pile--l`, `.groupe-horizontal`, `.groupe-horizontal--bas` | utilitaires | empilement / alignement |
| `.sr-only`, `.no-print` | utilitaires | accessibilité, impression |
| `[hidden]` | partout | masque l'élément (prioritaire) |
| `.texte-doux`, `.texte-petit` | utilitaires | définies, non utilisées par les pages actuelles |
| `.cacher-petit-ecran`, `.print-only`, `.pied-page`, `.page-titre__sous-titre`, `.groupe-horizontal--fin` | utilitaires / structure | définies, non utilisées par les pages actuelles |

### 7.2 Composants
| Famille | Classes |
|---|---|
| Boutons | `.btn` + `.btn--primaire / --secondaire / --discret / --danger / --danger-discret`, `.btn--petit`, `.btn-statut`, `.btn-deplier` ; paiement en un clic (§5.14) : `.paiement-rapide`, `.paiement-rapide__titre / __declencheur / __modes / __mode` (+ `[data-recent="oui"]`, `[aria-pressed="true"]`), `.table-wrap--modes` (+ `--modes-dialogue`) : cadre de tableau qui sert de conteneur à la requête de la variante compacte, `.choix-mode`, `.choix-mode__liste / __option / __entree / __texte / __note` (+ `[data-recent="oui"]`, `.choix-mode--erreur`) ; définis, non utilisés : `.btn--bloc`, `.icone` (icône SVG en ligne, calée sur le texte) |
| Champs | `.champ`, `.champ__label`, `.champ__requis`, `.champ__aide`, `.champ__erreur`, `.champ--erreur`, `.champ--large`, `.input`, `.input--recherche`, `.champ-montant`, `.champ-montant__unite`, `.case`, `fieldset.groupe`, `.formulaire-grille`, `.filtres`, `.selecteur-mois`, `.segment`, `.segment__bouton` ; combobox de patient (§8.10, spécifiée, pas encore branchée par le JS) : `.champ--combo`, `.combo`, `.suggestions`, `.suggestion` (+ `--archive`, `--creer`), `.suggestion__nom`, `.suggestion__detail`, `.suggestion__marque`, `.suggestions__vide`, `.indication-patient` |
| Cartes | `.carte`, `.carte__entete`, `.carte__titre`, `.carte__note`, `.grille-cartes`, `.kpi`, `.kpi__libelle`, `.kpi__valeur`, `.kpi__detail`, `.kpi[data-serie]` |
| Tableaux | `.table-wrap`, `.table-wrap--haut`, `.table`, `.table--dense`, `.col-nombre / -montant / -action / -case / -reste / -etat-paiement / -tarif`, `.col-libelle-tarif`, `.cellule-double__secondaire`, `.modes-paiement`, `.mode-paiement`, `.icone-mode` (+ `--carte / --cheque / --especes / --virement / --autre`, §5.13), `.ligne--selectionnee / --a-venir / --modifiee-recemment / --total / --inactive`, `.ligne-detail`, `.ligne-detail__contenu`, `tbody.patient`, `.montant`, `.montant--zero / --reste`, `.nom-prestation` (libellé barré d'une prestation désactivée) ; définis, non utilisés : `.col-centre`, `.col-secondaire`, `.col-prestation`, `.montant--fort` |
| Badges | `.badge`, `[data-etat]` (`paye`, `partiel`, `non_paye`), `[data-statut]` (`a_facturer`, `facture`), `.badge--a-venir`, `.badge--attention`, `.badge--actif`, `.badge--archive`, `.badge--homonyme` (patients, §8.11) ; défini, non utilisé : `.badge--info` |
| Messages | `.alerte` (+ `--succes / --attention / --danger`), `.alerte__corps`, `.alerte__titre`, `.alerte__texte`, `.alerte__actions`, `.avertissements`, `.toasts`, `.toast` (+ `--attention / --erreur`), `.toast__texte`, `.toast__action`, `.toast__fermer`  ; `.alerte--exemple` (bandeau de démonstration) |
| Dialogues | `dialog.dialogue` (+ `.dialogue--large`), `.dialogue__entete`, `.dialogue__titre`, `.dialogue__corps`, `.dialogue__pied` |
| Divers | `.etat-vide` (+ `--positif`), `.etat-vide__titre / __texte / __actions`, `.chargement`, `details.depliant`, `.depliant__contenu`, `.barre-selection`, `.barre-selection__texte`, `dl.infos`, `.code` |
| Graphiques | `.graphe`, `.graphe__titre`, `.graphe__sous-titre`, `.graphe__indicatif`, `.graphe__legende`, `.legende__item`, `.legende__pastille[data-serie]`, `.graphe__zone`, `.graphe__svg`, `.graphe__grille`, `.graphe__axe`, `.graphe__annee`, `.graphe__colonne`, `.graphe__colonne--courante`, `.graphe__focus`, `.graphe__segment[data-serie]`, `.graphe__valeur`, `.graphe__etiquette--forte`, `.graphe__bulle`, `.graphe__bulle-titre`, `.graphe__tableau`, `.motif__fond[data-serie]`, `.motif__trait`, `.barres-h`, `.barre-h`, `.barre-h__libelle / __piste / __rempli / __valeur` |

### 7.3 Écrans
| Écran | Classes spécifiques |
|---|---|
| Facturation du mois | `.recap` (table), `.recap__outils`, `.recap__actions`, `.recap__note-vue`, `.recap__titre-impression`, `.recap__pied-impression`, `.patient-nom`, attribut `data-impression-detail="oui"` (sur `.recap`) |
| Prestations | `.ajout-rapide` (+ `__actions`, `__astuce`), `.resume-liste`, `.actions-ligne`, `.versements-liste`, `.patient-nom` |
| Patients (§8.11, spécifiés, pas encore branchés par le JS) | `main.ecran-patients`, `.aide-patients`, `.aide-patients__titre`, `.table-patients`, `.patient__nom`, `.patient__prenom`, `.patient__badges`, `.patient-meta`, `.col-detail-patient`, `.ligne--archivee`, `.patients-existants` ; réutilisés : `.ajout-rapide` (+ `__actions`, `__astuce`), `.resume-liste`, `.actions-ligne`, `dl.infos`, `.filtres`, `.segment` |
| Tableau de bord | `.tdb-grille`, `.tdb-moitie`, `.tdb-outils`, `.tdb-section-erreur` ; défini, non utilisé : `.patients-liste` |
| Paramètres | `.parametres-mise-en-page`, `.sommaire`, `.section-param`, `.col-libelle-tarif`, `.col-tarif` |
| Conflit | `.conflit`, `.conflit__versions`, `.conflit__version`, `.conflit__version-titre`, `.conflit__chiffre` ; définis, non utilisés : `.conflit__choix`, `.conflit__copies` |
| Fichier illisible ou absent | `.ecran-bloquant` |
| Archivage, archives | définis, non utilisés : `.apercu-archivage`, `.ecran-archives`, `.lecture-seule-marque` |

### 7.4 Valeurs d'attributs `data-*`
| Attribut | Valeurs | Origine / rôle |
|---|---|---|
| `data-etat` | `paye`, `partiel`, `non_paye` | champ `etat` de l'API |
| `data-statut` | `a_facturer`, `facture` | champ `statut` de l'API |
| `data-serie` | `paye`, `attente`, `a-facturer`, `prevu`, `neutre` | séries des graphiques et indicateurs (tiret, pas de soulignement) ; `neutre` = barres hors état de paiement (séances), couleur primaire |
| `data-patient` | `enregistre`, `nouveau`, `reactive` | sur `.indication-patient` : patient choisi dans la liste, nouveau patient, patient archivé qui sera réactivé (§8.10) |
| `data-theme` | `light`, `dark` (absent = automatique) | sur `<html>` |
| `data-impression-detail` | `oui` | sur `.recap` : inclure le détail à l'impression |
| `data-accueil-vide`, `data-catalogue` | `oui` ; `vide`, `inactif` | accueil de premier démarrage (§8.7), repères pour les tests ; sans règle CSS |
| `data-ajout-desactive` | `oui` | sur la carte du formulaire d'ajout désactivé (§8.7) ; sans règle CSS |
| `data-tarifs-vide` | `oui` | sur l'état vide de Paramètres › Tarifs ; sans règle CSS |
| `data-mode` | `carte`, `cheque`, `especes`, `virement`, `autre` | sur `.paiement-rapide__mode` : repère pour les tests ; sans règle CSS |
| `data-recent` | `oui` | sur un bouton de mode (`.paiement-rapide__mode`, `.choix-mode__option`) : dernier mode utilisé (§5.14) |
| `data-vue-ca` | `prestation`, `versement` | boutons du commutateur de vue du chiffre d'affaires ; sans règle CSS |

### 7.5 Règles d'implémentation
- Tout texte de donnée via `textContent` (`el()` dans `js/dom.js`) ; jamais `innerHTML` avec des données. Un test automatique du front vérifie l'absence d'`innerHTML`, de style en ligne et de ressource externe.
- Largeurs dynamiques uniquement par attributs SVG, `element.style.setProperty('--x', …)` ou propriétés CSSOM (`style.left`, `style.top`). **Jamais** d'attribut `style` en HTML ni `setAttribute('style', …)` (bloqué par la CSP).
- L'état (payé, facturé…) est exprimé par `data-*`/`aria-*` ; ne pas ajouter de classes d'état inventées.

## 8. Écrans et maquettes

Légende des maquettes : `[Bouton]` = bouton ; `[ champ ]` = champ ; `(•)` option active ; `▾` liste déroulante ; `☐ ☑` cases ; `{…}` = contenu dynamique ; `(i)` / `(!)` = alerte d'information / d'attention ; `…` = texte abrégé ou lignes omises. Les montants sont affichés `1 250,00 €`. Les textes sont abrégés quand ils sont longs ; les libellés exacts sont dans le code.

### Jeu de données des maquettes

Les maquettes des §8.1 à §8.3 et §8.8 reposent sur un même jeu fictif : le mois d'octobre 2026, la date du jour étant le 21/10/2026. Catalogue de prestations fictif :

| Prestation | Catégorie | Tarif |
|---|---|---|
| Séance individuelle 30 min | Séance | 42,00 € |
| Séance individuelle 45 min | Séance | 58,00 € |
| Séance à domicile 45 min | Séance | 68,00 € |
| Bilan initial | Bilan | 170,00 € |
| Compte rendu | Autre | 28,00 € |
| Réunion de synthèse | Autre | 52,00 € |

Les 12 prestations d'octobre 2026 :

| # | Date | Patient | Prestation | Montant | Statut | Versé | Reste |
|---|---|---|---|---|---|---|---|
| 1 | 02/10 | Lapin Pierre | Bilan initial | 170,00 € | Facturé | 170,00 € | 0,00 € |
| 2 | 03/10 | Ours Baloo | Séance individuelle 45 min | 58,00 € | Facturé | 58,00 € | 0,00 € |
| 3 | 06/10 | Tortue Franklin | Séance individuelle 30 min | 42,00 € | Facturé | 42,00 € | 0,00 € |
| 4 | 07/10 | Lapin Pierre | Séance individuelle 45 min | 58,00 € | Facturé | 20,00 € | 38,00 € |
| 5 | 09/10 | Ours Baloo | Séance individuelle 45 min | 58,00 € | Facturé | 0,00 € | 58,00 € |
| 6 | 10/10 | Tortue Franklin | Séance individuelle 30 min | 42,00 € | Facturé | 0,00 € | 42,00 € |
| 7 | 13/10 | Renard Basile | Séance individuelle 30 min | 42,00 € | Facturé | 0,00 € | 42,00 € |
| 8 | 14/10 | Souris Stuart | Séance individuelle 30 min | 42,00 € | Facturé | 0,00 € | 42,00 € |
| 9 | 16/10 | Ours Baloo | Séance individuelle 45 min | 58,00 € | À facturer | 0,00 € | 58,00 € |
| 10 | 17/10 | Renard Basile | Séance individuelle 30 min | 42,00 € | À facturer | 0,00 € | 42,00 € |
| 11 | 20/10 | Tortue Franklin | Séance individuelle 30 min | 42,00 € | À facturer | 0,00 € | 42,00 € |
| 12 | 21/10 | Souris Stuart | Séance individuelle 30 min | 42,00 € | À facturer | 0,00 € | 42,00 € |

Contrôles :
- **Dû** : 4 séances à 58,00 € + 7 séances à 42,00 € + 1 bilan à 170,00 € = 232 + 294 + 170 = **696,00 €**.
- **Versé** : 170 + 58 + 42 + 20 = **290,00 €**.
- **Reste à payer** : 696 − 290 = **406,00 €**. Par statut : 222,00 € sur des prestations facturées (lignes 4 à 8 : 38 + 58 + 42 + 42 + 42) et 184,00 € sur des prestations à facturer (lignes 9 à 12 : 58 + 42 + 42 + 42) ; 222 + 184 = 406.
- Une prestation de 42,00 € est de plus prévue le 04/11/2026 (hors octobre, à facturer, à venir).

### 8.1 Facturation du mois (`index.html`, accueil)

But : en fin de mois, voir par patient ce qui est dû, payé, restant, puis copier ou imprimer pour recopier dans l'outil de facturation.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ suivi-facturation      [Facturation du mois]   Prestations   Tableau de bord   Paramètres                       │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ {bandeaux d'état éventuels}                                                                                     │
│ Facturation du mois                                                                                             │
│ [◀ Mois précédent] [ octobre 2026 ▾ ] [Mois suivant ▶] [Mois en cours]                                          │
│       (•) Par date de prestation  ( ) Par date de versement                                                     │
│                                                                                                                 │
│ (i) À facturer, tous mois confondus                                                      [Voir la liste]        │
│     4 prestations · 184,00 € — 1 prestation à venir (42,00 €) sera à facturer plus tard.                        │
│                                                                                                                 │
│ [Copier le récapitulatif] [Imprimer] [Marquer tout le mois facturé]       ☐ Inclure le détail à l'impression    │
│ Vue par date de prestation : prestations datées de ce mois ; « Payé » compte tout ce qui a été versé sur elles… │
│                                                                                                                 │
│ Patient            Séances  Autres        Dû      Payé  Reste à payer  État                  Actions            │
│ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────  │
│ ▸ Lapin Pierre            1       1  228,00 €  190,00 €        38,00 €  ◐ Partiellement payé                    │
│ ▾ Ours Baloo              3       0  174,00 €   58,00 €       116,00 €  ◐ Partiellement payé  [Marquer facturé] │
│ ▸ Renard Basile           2       0   84,00 €    0,00 €        84,00 €  ○ Non payé            [Marquer facturé] │
│ ▸ Souris Stuart           2       0   84,00 €    0,00 €        84,00 €  ○ Non payé            [Marquer facturé] │
│ ▸ Tortue Franklin         3       0  126,00 €   42,00 €        84,00 €  ◐ Partiellement payé  [Marquer facturé] │
│ ══════════════════════════════════════════════════════════════════════════════════════════════════════════════  │
│ Total (5 patients)       11       1  696,00 €  290,00 €       406,00 €  ◐ Partiellement payé                    │
│                                                                                                                 │
│ Séances = prestations de catégorie « Séance » ; les autres catégories (bilan, autre) sont dans « Autres ».      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Détail déplié d'un patient (ligne `tr.ligne-detail`, ici Ours Baloo : trois prestations de 58,00 €, soit 174,00 € dû, 58,00 € payé, 116,00 € de reste, comme dans le tableau ci-dessus) :

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▾ Ours Baloo   (ligne de détail sous la ligne patient)                                                             │
│                                                                                                                    │
│ Date   Prestation                  Montant  Facturation       Paiement                      Actions                │
│ ────────────────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ 03/10  Séance individuelle 45 min  58,00 €  [◆ Facturé ↻]     ✓ Payé                                               │
│                                                               versé 58,00 € · reste 0,00 €  [Versement] [Modifier] │
│ 09/10  Séance individuelle 45 min  58,00 €  [◆ Facturé ↻]     ○ Non payé                    Payer ▢ ▭ ▣ ⇄ …       │
│                                                               versé 0,00 € · reste 58,00 €  [Versement] [Modifier] │
│ 16/10  Séance individuelle 45 min  58,00 €  [◇ À facturer ↻]  ○ Non payé                    Payer ▢ ▭ ▣ ⇄ …       │
│                                                               versé 0,00 € · reste 58,00 €  [Versement] [Modifier] │
│                                                                                                                    │
│ [Copier le détail]                                                                                                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Dans le détail, le statut de facturation et l'état de paiement sont **indépendants** : une prestation peut être facturée sans être payée (lignes du 09/10), payée sans avoir été facturée, ou ni l'un ni l'autre. Le groupe « Payer » (cinq boutons à icône, §5.14, abrégés dans ce schéma) n'apparaît que si le reste à payer est positif.

Spécification :
- **Sélecteur de mois** `.selecteur-mois` (`role="group"`, « Choix du mois ») : boutons « ◀ Mois précédent » / « Mois suivant ▶ » (`aria-label` avec le nom du mois visé, désactivés aux bornes), liste déroulante des mois qui contiennent des prestations (plus le mois en cours), « Mois en cours » (désactivé quand il est affiché). Le mois choisi explicitement est retenu dans `sessionStorage` (non nominatif) ; la vue n'est jamais retenue.
- **Commutateur de vue** `.segment` : « Par date de prestation » (par défaut) ou « Par date de versement ». La vue par date de versement remplace « Payé » par « Encaissé », n'a ni « Reste à payer » ni « État », et désactive « Marquer tout le mois facturé » ; une note `.recap__note-vue` explique chaque vue.
- **Table `.recap`** : une `tbody.patient` par patient (tri nom, prénom). Ligne patient : bouton `.btn-deplier` (`aria-expanded`, `aria-controls` = id de la ligne de détail) contenant le nom ; colonnes Séances, Autres (`.col-nombre`), Dû, Payé, Reste à payer (`.col-montant`, reste en `.montant--reste` s'il est > 0, `.montant--zero` sinon), État, Actions. Ligne de total en pied (`tr.ligne--total`, « Total (5 patients) »).
- **État par patient** : badge `data-etat` dérivé des totaux (reste = 0 → `paye` ; rien de payé alors que le dû est positif → `non_paye` ; sinon `partiel`). Un trop-perçu est signalé par un `.badge--attention` « Trop-perçu 5,00 € » à côté de l'état, sans compenser d'autres lignes.
- **Action par patient** « Marquer facturé » (`.btn--petit`) : visible s'il reste des prestations à facturer **échues** ; ouvre une confirmation (« Marquer 1 prestation de Ours Baloo comme facturée ? » ; les prestations à venir restent à facturer et la confirmation le dit) ; suivie d'un message « 1 prestation marquée facturée. [Annuler] ». « Marquer tout le mois facturé » : même schéma, au niveau du mois (ici 4 prestations : lignes 9 à 12).
- **Détail** (`tr.ligne-detail[hidden]`) : tableau dense (date, prestation + motif, montant, `.btn-statut`, badge d'état + « versé X · reste Y », actions) avec le groupe « Payer » (un bouton par mode, §5.14) et les boutons « Versement » et « Modifier » ouvrant les dialogues de §8.2 **sans quitter l'écran**, et « Copier le détail ». Après modification, les totaux se mettent à jour et la ligne reçoit `.ligne--modifiee-recemment`.
- **Copier** : place le texte tabulé dans le presse-papiers, bouton « Copié ✓ » pendant 2 s et message « Récapitulatif par date de prestation, octobre 2026, copié (5 patients). ». Le texte copié est toujours celui de la vue par date de prestation, même si la vue par date de versement est affichée. Si le presse-papiers est refusé, un dialogue « Copie automatique impossible » propose le texte sélectionné à copier avec Ctrl+C. Les colonnes copiées sont définies dans `js/recap-texte.js` (patient, séances, montant dû, payé, reste à payer ; la colonne « Autres prestations » est disponible).
- **Imprimer** : `window.print()` ; voir §11. La case « Inclure le détail à l'impression » pose `data-impression-detail="oui"` sur `.recap` ; elle est décochée par défaut.
- **Indicateur « À facturer »** : `.alerte` information (nombre, montant, « N prestations à venir (…) seront à facturer plus tard », mention des prestations à 0 € non comptées) avec le bouton « Voir la liste » vers `prestations.html` (filtres « tous les mois, à facturer » posés dans `sessionStorage`) ; s'il n'y a plus rien à facturer : `.alerte--succes` « Tout est facturé ». Quand des prestations à venir ou à 0 € s'ajoutent à la liste, une seconde ligne précise le nombre de lignes affichées par « Voir la liste ». Absent quand le fichier ne contient aucune prestation.
- **États** : mois vide → `.etat-vide` « Aucune prestation ce mois-ci » + « Ajouter une prestation » (ou « Définir mes prestations et tarifs » si le catalogue est inutilisable, §8.7) ; chargement → `.chargement` ; erreur de chargement → `.alerte--danger` avec « Réessayer » ; fichier sans aucune prestation → accueil guidé (§8.7).
- **Lecture seule, conflit, mode dégradé** : les boutons d'action (statut, boutons du groupe « Payer », « Versement », « Modifier », « Marquer facturé », « Marquer tout le mois facturé ») sont désactivés et un bandeau explique la situation (§8.6).
- Pas de graphique ici.

### 8.2 Saisie / liste des prestations (`prestations.html`)

But : saisir en quelques secondes ; retrouver, contrôler, corriger. Exemple : liste d'octobre 2026 (12 prestations du jeu de données, trois lignes cochées).

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Prestations                                                                                                                                │
│                                                                                                                                            │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐                                       │
│ │ Ajouter une prestation                                                                           │                                       │
│ │ Nom (obligatoire)   Prénom (obligatoire)   Date (obligatoire)   Prestation (obligatoire)         │                                       │
│ │ [ Renard ]          [ Basile ]             [ 21/10/2026 ]       [ Séance individuelle 30 min ▾ ] │                                       │
│ │ Montant (€) (obligatoire)   Motif                                                                │                                       │
│ │ [          42,00 € ]        [ Graphisme                 ]                                        │                                       │
│ │ [Ajouter la prestation]   Entrée pour valider · Tab pour passer au champ suivant                 │                                       │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────┘                                       │
│                                                                                                                                            │
│ Mois [octobre 2026 ▾]  Patient [ Nom ou prénom ]  Facturation [Tous ▾]  Paiement [Tous ▾]  [Effacer les filtres]                           │
│ 12 prestations   Montant 696,00 €   Payé 290,00 €   Reste 406,00 €                                                                         │
│                                                                                                                                            │
│ ☐  Date   Patient et prestation                         Montant  Facturation       Paiement                         Actions                │
│ ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── │
│ ☐  02/10  Lapin Pierre                                 170,00 €  [◆ Facturé ↻]     ✓ Payé · (carte)                                        │
│           Bilan initial · Premier bilan                                            versé 170,00 € · reste 0,00 €    [Versement] [Modifier] │
│ ☐  07/10  Lapin Pierre                                  58,00 €  [◆ Facturé ↻]     ◐ Partiellement payé · (chèque)  Payer ▢ ▭ ▣ ⇄ …       │
│           Séance individuelle 45 min · Graphisme                                   versé 20,00 € · reste 38,00 €    [Versement] [Modifier] │
│ …                                                                                                                                          │
│ ☑  17/10  Renard Basile                                 42,00 €  [◇ À facturer ↻]  ○ Non payé                       Payer ▢ ▭ ▣ ⇄ …       │
│           Séance individuelle 30 min                                               versé 0,00 € · reste 42,00 €     [Versement] [Modifier] │
│ ☑  20/10  Tortue Franklin                               42,00 €  [◇ À facturer ↻]  ○ Non payé                       Payer ▢ ▭ ▣ ⇄ …       │
│           Séance individuelle 30 min                                               versé 0,00 € · reste 42,00 €     [Versement] [Modifier] │
│ ☑  21/10  Souris Stuart                                 42,00 €  [◇ À facturer ↻]  ○ Non payé                       Payer ▢ ▭ ▣ ⇄ …       │
│           Séance individuelle 30 min · Motricité fine                              versé 0,00 € · reste 42,00 €     [Versement] [Modifier] │
│                                                                                                                                            │
│ ── barre collante, visible dès qu'une ligne est cochée ───────────────────────────────────────                                             │
│ 3 prestations sélectionnées   [Marquer facturé]   [Tout désélectionner]                                                                    │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Formulaire d'ajout rapide** (`.ajout-rapide`, carte toujours visible en haut, pas de dialogue) :
- **Ordre de tabulation = ordre visuel** : Nom → Prénom → Date → Prestation → Montant → Motif → [Ajouter]. Le patient et la prestation, qui changent le plus souvent, viennent d'abord ; le motif, facultatif, est en dernier (`.champ--large`, deux colonnes).
- Choix d'une prestation : le **montant se préremplit** (tarif du catalogue) et reste modifiable ; Tab y arrive avec le texte sélectionné pour le remplacer d'une frappe. Seules les prestations actives du catalogue sont proposées. Dans le dialogue de modification, le montant n'est jamais écrasé ; le tarif de la prestation choisie est rappelé en aide (« Tarif : 42,00 € »).
- **Date** : aujourd'hui par défaut (relue auprès du serveur si la page reste ouverte après minuit). Une date future est acceptée ; la ligne affiche alors « À venir ».
- Le patient est saisi par **deux champs** (Nom, Prénom) qui sont des combobox de recherche dans les patients enregistrés (§8.10). Tant qu'aucune suggestion n'est choisie, la saisie reste libre et Entrée valide le formulaire. *(Description de la cible : le code actuel a encore deux champs texte libres, sans liste.)*
- **Après un ajout réussi** : message « Prestation ajoutée pour Basile Renard. », nom / prénom / motif vidés, **date et prestation conservées**, montant remis au tarif de la prestation, **focus renvoyé au champ Nom** ; la nouvelle ligne apparaît dans la liste avec `.ligne--modifiee-recemment`. Si le mois de la prestation n'est pas celui du filtre, le message l'indique.
- **Erreurs** (422) : résumé `.alerte--danger` « 2 champs à corriger » avec liens vers « Nom », « Montant » ; message sous chaque champ ; focus sur le premier champ en erreur. Exemples : « Indiquez le nom du patient. », « Le montant doit être un nombre positif, par exemple 45 ou 45,50. ».
- **Homonyme** (409 `PATIENTS_HOMONYMES`) : dialogue « Plusieurs patients portent ce nom » avec une liste de boutons radio (« Basile Renard — dernière prestation le 17/10/2026 », « Nouveau patient (même nom) »), puis [Annuler] [Continuer].
- **Catalogue vide ou entièrement désactivé** : le formulaire reste affiché mais désactivé, avec une alerte et un lien vers Paramètres › Tarifs (§8.7).

**Lecture seule, conflit, mode dégradé** : comme sur la Facturation du mois, l'écran ne laisse pas un clic échouer. Les champs et boutons du formulaire d'ajout, les cases de sélection (dont « Tout sélectionner »), les boutons de statut, les boutons du groupe « Payer », « Versement » et « Modifier » sont désactivés ; la sélection en cours est vidée. L'explication (« Modification impossible : … ») est donnée en infobulle (`title`) des boutons et reliée à chaque contrôle désactivé par `aria-describedby`, vers un paragraphe `.sr-only` de la page ; le bandeau de §8.6 reste en tête. Les filtres et la lecture de la liste restent disponibles.

**Filtres** (`.filtres`, `role="group"` « Filtres de la liste ») : Mois (liste : « Tous les mois » + mois ; le mois en cours par défaut), Patient (texte, filtre local, insensible à la casse et aux accents, **jamais dans l'URL ni dans le stockage**), Facturation (Tous / À facturer / Facturé), Paiement (Tous / Non payé / Partiellement payé / Payé), « Effacer les filtres ». Mois, facturation et paiement sont retenus dans `sessionStorage` (jamais le patient). Résumé `.resume-liste` toujours visible (`aria-live="polite"`) : nombre, montant, payé, reste des lignes filtrées. Aucun résultat → `.etat-vide` « Aucune prestation » + « Effacer les filtres ».

**Arrivée depuis le tableau de bord** : un clic sur une tranche d'impayés ouvre `prestations.html?statut=…&anciennete=…` ; une `.alerte` d'information (« Impayés facturés » ou « Impayés à facturer ») dit ce que montre la liste et propose « Voir toutes les prestations ». Un lien non reconnu produit une `.alerte--attention` « Lien non reconnu » et la liste habituelle.

**Liste** (`.table`, triée par date croissante) :
- Colonnes : case de sélection, Date (`jj/mm`, avec l'année si elle diffère de l'année en cours), Patient et prestation (cellule double : prénom et nom en ligne 1, avec le badge « À venir » pour une date future ; « prestation · motif » en ligne 2), Montant, Facturation (`.btn-statut`), Paiement (`.badge[data-etat]` + icônes des modes de paiement, §5.13, + ligne secondaire « versé X · reste Y » + éventuel « Trop-perçu »), Actions.
- **Actions de ligne** : le groupe « Payer » (`.paiement-rapide`, §5.14, absent si reste = 0), `[Versement]`, `[Modifier]` (`.btn--petit`). Les actions restent visibles à toutes les largeurs ; les cinq modes tiennent sur une seule ligne et ne sont remplacés par le déclencheur « Payer ▾ » que lorsque le tableau est plus étroit que 60 rem (§5.14) ; le tableau défile dans son cadre quand la place manque (§10).
- **Payer** : un clic sur l'un des cinq boutons de mode crée le versement du reste, daté d'aujourd'hui, avec ce mode ; message « 42,00 € enregistrés par chèque. [Annuler] ». Le dernier mode utilisé est seulement mis en évidence, jamais appliqué sans clic ; il n'y a plus de dialogue sur ce chemin (le serveur répondrait 422 `MODE_REQUIS` à une requête sans mode, que l'écran n'envoie jamais).
- **Dialogue « Ajouter un versement »** : champs Montant (prérempli avec le reste), Date du versement (aujourd'hui), Mode de paiement (cinq boutons à choix unique, §5.14, dernier mode utilisé présélectionné) ; avertissements non bloquants (versement dépassant le reste : « Ce versement dépasse le reste à payer de 5,00 €. Il sera enregistré tel quel. » ; versement daté avant la prestation) ; [Annuler] [Enregistrer le versement]. « Modifier le versement » est identique avec [Enregistrer les modifications].
- **Dialogue « Modifier la prestation »** (`.dialogue--large`) : mêmes champs que l'ajout ; section « Versements » (récapitulatif d'état, tableau `.versements-liste` : date, mode (groupe de cinq boutons dont le mode actuel est `aria-pressed` : un clic le change aussitôt, avec un message et [Annuler] dans la fenêtre), montant, [Modifier] [Supprimer] avec confirmation, bouton « Ajouter un versement ») ; pied : `.btn--danger-discret` « Supprimer cette prestation » (confirmation « Supprimer cette prestation ? », qui rappelle le nombre de versements supprimés avec elle, la sauvegarde préalable et la possibilité d'annuler juste après), [Annuler], [Enregistrer]. Conflit d'édition (409 `MODIFIEE_AILLEURS`) : `.alerte--attention` « Cette prestation a été modifiée entre-temps. » avec [Recharger]. Si le nom d'un patient qui a d'autres prestations est modifié, dialogue « Renommer ce patient ? » : [Annuler] [Modifier seulement cette ligne] [Renommer sur toutes les prestations]. Quand la prestation est la seule du patient et que le nouveau nom ne correspond à aucun autre patient, c'est le patient lui-même qui est renommé (identifiant conservé), sans dialogue. Si le nouveau nom est celui d'un autre patient, 409 `PATIENT_EXISTANT` : même dialogue « Un patient porte déjà ce nom » que sur la page Patients (§8.11, mode renommage : [Annuler] [Renommer quand même (homonyme)]) ; rien n'est modifié tant que le choix n'est pas fait, puis la demande repart avec `homonyme: true`.
- **Sélection multiple** : case d'en-tête (« Tout sélectionner », `aria-label`) ; la `.barre-selection` apparaît dès 1 ligne cochée (« N prestations sélectionnées » + « Marquer facturé » + « Tout désélectionner ») ; le focus n'est pas volé à l'apparition ; le nombre est annoncé (`role="status"`). « Marquer facturé » applique la même règle que partout : les prestations à venir restent à facturer, et un message le dit.

### 8.3 Tableau de bord (`tableau-de-bord.html`)

Exemple : activité commencée en octobre 2026 (période « 12 derniers mois », seul le mois en cours contient des prestations ; l'estimation indicative est donc indisponible faute d'historique). Les chiffres sont ceux du jeu de données.

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Tableau de bord                                                                                              [Imprimer]       │
│ Période [12 derniers mois ▾]    Vue du chiffre d'affaires  (•) Dû par date de prestation  ( ) Encaissé par date de versement  │
│                                                                                                                               │
│ ┌─────────────────────────┐ ┌──────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐              │
│ │ Reste à encaisser       │ │ À facturer : montant à   │ │ CA du mois (dû)         │ │ Séances du mois         │              │
│ │ 406,00 €                │ │ mettre sur les factures  │ │ 696,00 €                │ │ 11                      │              │
│ │ 9 prestations, dont     │ │ 184,00 €                 │ │ octobre 2026            │ │ octobre 2026            │              │
│ │ 184,00 € pas encore     │ │ 4 prestations, acomptes  │ │ dont payé : 290,00 €    │ │ + 1 autre prestation    │              │
│ │ facturés                │ │ compris · 1 à venir en + │ │                         │ │ (bilan et autre)        │              │
│ └─────────────────────────┘ └──────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘              │
│                                                                                                                               │
│ ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Chiffre d'affaires par mois                                                                                               │ │
│ │ Par date de prestation, de novembre 2025 à octobre 2026. Montants en euros…                                               │ │
│ │ ■ Payé   ▩ Facturé en attente (reste à payer)   ▨ À facturer (reste à payer)                                              │ │
│ │                                                                                                                           │ │
│ │   800 € ┤                                                                                         696 €                   │ │
│ │         │                                                                                          ▨▨▨▨                   │ │
│ │   600 € ┤                                                                                          ▨▨▨▨                   │ │
│ │         │                                                                                          ▩▩▩▩                   │ │
│ │   400 € ┤                                                                                          ▩▩▩▩                   │ │
│ │         │                                                                                          ■■■■                   │ │
│ │   200 € ┤                                                                                          ■■■■                   │ │
│ │         │                                                                                          ■■■■                   │ │
│ │     0 € └  nov.    déc.   janv.   févr.    mars    avr.    mai     juin   juil.    août   sept.    oct.                   │ │
│ │                                                                                                                           │ │
│ │ ▸ Voir les chiffres                                                                                                       │ │
│ │                                                                                                                           │ │
│ │ (i) Estimation indicative : pas assez d'historique pour le moment. Il faut au moins 3 mois complets de données…           │ │
│ │     3 mois manquants. Aucun chiffre n'est avancé tant que l'historique est trop court.                                    │ │
│ └───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────────┐ ┌────────────────────────────────────────────────────────────┐ │
│ │ Séances                                                    │ │ Reste à encaisser par ancienneté                           │ │
│ │ [Par mois | Par semaine]                                   │ │ 406,00 €                                                   │ │
│ │ ■ Séances réalisées   ▭ Séances à venir                    │ │ 9 prestations échues non soldées…                          │ │
│ │                                                            │ │ Facturées, à relancer : 222,00 € (reste à payer)           │ │
│ │ barre « oct. » : 11 séances réalisées                      │ │ Moins de 30 jours  ██████████  222,00 €  5 prestations     │ │
│ │                                                            │ │ 30 à 59 jours                    0,00 €  0 prestation      │ │
│ │ ▸ Voir les chiffres                                        │ │ …                                                          │ │
│ └────────────────────────────────────────────────────────────┘ │ À facturer, pas encore relançable : 184,00 €               │ │
│                                                                │ Moins de 30 jours  ████████░░  184,00 €  4 prestations     │ │
│                                                                │ 30 à 59 jours                    0,00 €  0 prestation      │ │
│                                                                │ …                                                          │ │
│                                                                └────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────────────────┐                                                        │
│ │ Répartition du chiffre d'affaires par prestation                   │                                                        │
│ │ Chiffre d'affaires dû par date de prestation…                      │                                                        │
│ │ Séance individuelle 30 min  ██████░░░░  294,00 €  42,2 %  7 prest. │                                                        │
│ │ Séance individuelle 45 min  █████░░░░░  232,00 €  33,3 %  4 prest. │                                                        │
│ │ Bilan initial               ████░░░░░░  170,00 €  24,4 %  1 prest. │                                                        │
│ │ Total : 696,00 € (12 prestations).                                 │                                                        │
│ └────────────────────────────────────────────────────────────────────┘                                                        │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Vérifications arithmétiques de la maquette : les trois segments de la barre d'octobre (payé 290,00 € + facturé en attente 222,00 € + à facturer 184,00 €) font 696,00 €, le dû du mois ; le reste à encaisser (406,00 €) = 222,00 € + 184,00 € ; les parts de la répartition valent 294 / 696 = 42,2 %, 232 / 696 = 33,3 % et 170 / 696 = 24,4 % (chacune arrondie une fois à 0,1 %, la somme affichée peut donc différer de 100 % de 0,1 point) ; 7 + 4 = 11 séances, plus 1 bilan.

Spécification :
- **Structure** : `.tdb-outils` (période + vue du CA), puis une `.grille-cartes` de quatre `.kpi`, puis une grille 12 colonnes `.tdb-grille` contenant, dans l'ordre du DOM : le graphique du chiffre d'affaires (pleine largeur), les séances, les impayés par ancienneté, la répartition (cartes `.tdb-moitie`, côte à côte dès 62 em, empilées sinon). Un bouton « Imprimer » est ajouté à `.page-actions`. Chaque section se charge seule : une section en erreur n'empêche pas les autres.
- **Indicateurs** (`.grille-cartes` de `.kpi`) : *Reste à encaisser* (`data-serie="attente"`, reste à payer facturé ou non, avec « dont X pas encore facturés »), *À facturer : montant à mettre sur les factures* (`a-facturer`, montant des lignes à facturer, acomptes compris, « N prestations à venir (…) en plus »), *CA du mois (dû)* (`paye`, avec « dont payé » et « dont à venir » s'il y en a), *Séances du mois* (`neutre`, séances de la catégorie « Séance », « + N autres prestations (catégories bilan et autre) » ; « + N à venir » s'il y en a). Chaque indicateur porte son libellé en texte ; le trait de couleur n'est qu'un renfort. « À facturer » (montant des factures à émettre) et « Reste à encaisser » (reste à payer, acomptes déduits) sont deux notions distinctes et jamais désignées par le même mot.
- **Outils** (`.tdb-outils`) : période (liste : 12 derniers mois, 6 derniers mois, 3 derniers mois, année en cours, année précédente) et, pour le graphique du CA, `.segment` « Dû par date de prestation / Encaissé par date de versement » (date de prestation par défaut). **Le choix de la vue change le titre et le sous-titre du graphique** (« Encaissé par date de versement : ne se compare pas au CA dû. »). La vue « encaissé » est une série unique (palette payé), sans estimation, avec une note qui l'explique.
- **CA par mois** (pleine largeur) : barres empilées payé / facturé en attente / à facturer, légende, tableau de valeurs, info-bulle ; **la somme des trois segments = total des prestations du mois (hors prestations à venir non facturées, qui figurent dans le tableau et l'info-bulle)**. Un versement compte comme « payé » pour sa part, même sur une prestation future.
- **Prévision** : intégrée au graphique du CA (pas de carte séparée), vue par date de prestation et période incluant le mois en cours ; le mois en cours et les 3 suivants reçoivent une barre « prévu » (contour en tirets) jusqu'à l'estimation, avec le badge `.graphe__indicatif` « Estimation indicative » et une note sur la méthode (moyenne des 3 derniers mois complets ; un mois sans prestation compte pour 0). Historique insuffisant (moins de 3 mois complets) : aucune barre estimée, `.etat-vide` « Estimation indicative : pas assez d'historique pour le moment » qui indique les mois manquants et, si connue, la date de la première estimation. Aucun chiffre n'est avancé dans ce cas.
- **Séances** (`.tdb-moitie`) : `.segment` « Par mois / Par semaine » ; barres simples en couleur primaire (série `neutre`, réalisées) + série `prevu` (à venir, contour en tirets) ; semaine ISO indiquée « S40 » sur l'axe et « S40 2026 » dans le tableau ; les semaines des bords de la période sont signalées partielles.
- **Répartition par prestation** : `.barres-h`, montant + part en % (1 décimale) + nombre de prestations, tri décroissant ; la somme des montants = total de la période. Les colonnes (nom, barre, montant, part) sont partagées par toutes les lignes d'une même liste (grille imbriquée `subgrid`) : les pistes des barres ont la même longueur.
- **Reste à encaisser par ancienneté** : total en tête, puis deux groupes `.barres-h` — « Facturées, à relancer » (ancienneté depuis la date de facturation) et « À facturer, pas encore relançable » (depuis la date de prestation) — chacun avec les tranches « Moins de 30 jours », « 30 à 59 jours », « 60 à 89 jours », « 90 jours et plus ». Chaque tranche non vide est un lien (`a.barre-h`) vers `prestations.html` filtrée ; la longueur des barres est proportionnelle à la plus grande tranche des deux groupes. Aucun impayé → `.etat-vide--positif` « Aucun impayé ».
- **États** : fichier sans aucune prestation → `.etat-vide` « Pas encore de données à afficher » avec « Ajouter une prestation » (aucune carte) ; une section en erreur → carte à bordure en tirets + `.alerte--attention` « Section non affichée ».

### 8.4 Paramètres (`parametres.html`)

Mise en page : à gauche un **sommaire** (`nav.sommaire`, liens d'ancre, collant), à droite des sections `.carte.section-param` ; sous 62 em le sommaire passe au-dessus, en ligne. Sections, dans l'ordre : Tarifs, Sauvegardes, Export, Dossier de données, Apparence, Application.

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Paramètres                                                                                                             │
│ Sommaire : Tarifs · Sauvegardes · Export · Dossier de données · Apparence · Application   (colonne à gauche dès 62 em) │
│                                                                                                                        │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│ │ Tarifs                                                                                                       │       │
│ │ Un nouveau tarif ne s'applique qu'aux prestations saisies ensuite. L'historique ne change pas.               │       │
│ │ Prestation                      Catégorie   Tarif (€)  Active    Action                                      │       │
│ │ ──────────────────────────────────────────────────────────────────────────────                               │       │
│ │ [ Séance individuelle 30 min ]  [Séance ▾]    42,00 €  ☑ Active  [Enregistrer]                               │       │
│ │ [ Séance individuelle 45 min ]  [Séance ▾]    58,00 €  ☑ Active  [Enregistrer]                               │       │
│ │ [ Séance à domicile 45 min   ]  [Séance ▾]    68,00 €  ☑ Active  [Enregistrer]                               │       │
│ │ [ Bilan initial              ]  [Bilan ▾]    170,00 €  ☑ Active  [Enregistrer]                               │       │
│ │ [ Compte rendu               ]  [Autre ▾]     28,00 €  ☑ Active  [Enregistrer]                               │       │
│ │ [ Réunion de synthèse        ]  [Autre ▾]     52,00 €  ☑ Active  [Enregistrer]                               │       │
│ │ Ajouter une prestation : Nom [          ] Catégorie [Séance ▾] Tarif (€) [      ]   [Ajouter la prestation]  │       │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│ │ Sauvegardes                                                                                                  │       │
│ │ Dernière sauvegarde : 21/10/2026 à 08:42 (quotidienne) · Sauvegardes enregistrées : 14                       │       │
│ │ Nombre de jours d'historique à conserver [ 30 ]  [Enregistrer]      [Sauvegarder maintenant]                 │       │
│ │ (tableau Date · Raison · Prestations · Taille · Action, voir §8.8)                                           │       │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│ │ Export                                                                                                       │       │
│ │ (!) Données de santé : ces fichiers contiennent des données de santé en clair…                               │       │
│ │ [Exporter tout (JSON)] [Prestations (CSV)] [Versements (CSV)]                                                │       │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│ │ Dossier de données                                                                                           │       │
│ │ Dossier {chemin}   Fichier de données 4,2 Ko   Prestations enregistrées 12                                   │       │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│ │ Apparence                                                                                                    │       │
│ │ Thème de l'application : (•) Automatique (suit le réglage de Windows)  ( ) Clair  ( ) Sombre                 │       │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐       │
│ │ Application                                                                                                  │       │
│ │ Ferme l'application proprement : vos données sont enregistrées…      [Quitter l'application]                 │       │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘       │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Tarifs** (`#tarifs`) — tableau `.table` : Prestation (champ libellé), Catégorie (liste : Séance / Bilan / Autre), Tarif (€), Active (case), Action ([Enregistrer] par ligne). Textes d'aide : « Un nouveau tarif ne s'applique qu'aux prestations saisies ensuite. L'historique ne change pas. », « Une prestation déjà utilisée ne se supprime pas : décochez « Active » pour ne plus la proposer à la saisie. Elle reste dans l'historique. », et le rôle des catégories (les séances sont comptées dans le nombre de séances ; les bilans et les autres prestations à part). Ligne inactive : `.ligne--inactive` (texte atténué, libellé barré, mot « Désactivée » en badge neutre). Renommer une prestation déjà utilisée demande confirmation (« Renommer une prestation déjà utilisée ? »). Formulaire d'ajout dans un `fieldset.groupe` sous le tableau (Nom de la prestation, Catégorie — « Séance » présélectionnée —, Tarif (€), [Ajouter la prestation]). Validation : libellé non vide, tarif positif ou nul ; erreurs sous le champ concerné. Catalogue vide : état vide « Aucune prestation définie », tableau masqué, légende « Ajouter votre première prestation ». Catalogue entièrement désactivé : état vide « Aucune prestation active », tableau conservé pour pouvoir réactiver. Fichier en lecture seule ou en conflit : champs et boutons désactivés, avec une phrase d'explication.
2. **Sauvegardes** (`#sauvegardes`) — `dl.infos` : dernière sauvegarde (date, heure, raison), nombre de sauvegardes enregistrées. Champ « Nombre de jours d'historique à conserver » (nombre entier de 7 à 365, avec l'aide : « Les sauvegardes automatiques de la journée sont toutes gardées, puis la dernière de chacun des jours précédents… ») + [Enregistrer] ; message « Les sauvegardes des 30 derniers jours seront conservées. ». Réduire ce nombre sous le nombre de jours que couvrent les sauvegardes automatiques existantes demande confirmation (« Conserver moins de jours d'historique ? »). [Sauvegarder maintenant] (`.btn--primaire`, `aria-busy` pendant l'opération). Tableau (§8.8) : Date, Raison (Démarrage, Quotidienne, Manuelle, Avant une suppression, Avant un archivage, Avant une restauration, Avant un fichier vide, Avant une mise à jour du fichier, Version du disque (conflit), Version de l'application (conflit)), Prestations, Taille, [Restaurer]. **Restaurer** → dialogue de confirmation : « Restaurer la sauvegarde du 20/10/2026 à 18:05 ? » ; corps : « Manuelle, révision 41, dernière modification le 20/10/2026 18:05. » / « Elle contient 11 prestations, du 02/10/2026 au 20/10/2026. » / « L'état actuel (12 prestations) sera sauvegardé avant la restauration. Vous pourrez annuler. » ; [Annuler] (focus) [Restaurer]. Après restauration : message « Sauvegarde du … restaurée (11 prestations). » avec [Annuler la restauration]. Sauvegarde illisible : ligne `.ligne--inactive`, badge « Illisible », motif du refus et bouton désactivé. Aucune sauvegarde : état vide « Aucune sauvegarde pour le moment ».
3. **Export** (`#export`) — `.alerte--attention` permanente (« Données de santé : ces fichiers contiennent des données de santé en clair. Rangez-les dans un endroit sûr. »), une phrase qui précise que le fichier est créé sur l'ordinateur et que l'export complet n'est pas restaurable par l'application, puis trois boutons secondaires : « Exporter tout (JSON) », « Prestations (CSV) », « Versements (CSV) ». Après téléchargement : message d'attention rappelant que le fichier contient des données de santé en clair.
4. **Dossier de données** (`#dossier`) — lecture seule : `dl.infos` avec le chemin (`.code`), la taille du fichier, le nombre de prestations. Texte : comment changer de dossier (script du dossier `scripts`, variable `ERGO_DATA_DIR` pour un usage avancé ; le dossier ne se change pas depuis cette page). Rappel : si le dossier est synchronisé, n'ouvrir l'application que sur un seul ordinateur à la fois.
5. **Apparence** (`#apparence`) — `fieldset.groupe` « Thème de l'application » : radios `.case` « Automatique (suit le réglage de Windows) », « Clair », « Sombre » ; message « Apparence enregistrée. » (ou avertissement si le choix n'a pas pu être mémorisé).
6. **Application** (`#application`) — texte : « Ferme l'application proprement : vos données sont enregistrées. Pour la rouvrir, utilisez le raccourci Suivi Facturation. » et le bouton secondaire « Quitter l'application ». Au clic : dialogue « Quitter l'application ? » (« Vos données sont enregistrées. » / « Pour la rouvrir, utilisez le raccourci Suivi Facturation. »), [Annuler] (focus) [Quitter l'application] (primaire). Après confirmation : le bouton passe en `aria-busy`, l'application s'arrête, l'écran est remplacé par un `.etat-vide` `role="status"` « L'application est arrêtée. / Vous pouvez fermer cet onglet. », les bandeaux sont vidés et la page n'envoie plus aucune requête. Échec : message d'erreur et bouton réactivé.

Chaque enregistrement affiche un message de confirmation ; chaque erreur un `.champ__erreur` ou un message d'erreur.

### 8.5 Conflit de synchronisation

Déclencheurs : le fichier de données a été remplacé ou a disparu pendant que l'application était ouverte (synchronisation). Composition : un **bandeau `.alerte--danger`** (`role="alert"`) en tête de toutes les pages, « Les données ont été modifiées ailleurs », avec le texte « Le fichier de données a été remplacé pendant que l'application était ouverte (synchronisation ?). Vos saisies ne sont pas enregistrées tant que vous n'avez pas choisi la version à garder. Aucune version n'a été supprimée. » (ou « Le fichier de données n'est plus dans son dossier. » s'il a disparu) et le bouton **[Choisir la version à garder]** ; ce bouton ouvre un **dialogue `.dialogue--large`** (il ne s'ouvre pas tout seul). Échap ferme le dialogue sans rien décider : le bandeau reste, l'écriture reste suspendue.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Les données ont été modifiées ailleurs                                                               │
│                                                                                                      │
│ Le fichier de données ne correspond plus à ce que l'application avait chargé. Cela arrive si la      │
│ synchronisation (Proton Drive) a remplacé le fichier.                                                │
│ Aucune des deux versions n'a été supprimée : elles ont été sauvegardées. Choisissez celle à garder ; │
│ l'autre restera dans les sauvegardes.                                                                │
│                                                                                                      │
│ ┌────────────────────────────────────┐  ┌────────────────────────────────────┐                       │
│ │ Version sur le disque              │  │ Version de l'application           │                       │
│ │ 12 prestations                     │  │ 11 prestations                     │                       │
│ │ Modifiée le 21/10/2026 08:55       │  │ Modifiée le 21/10/2026 09:14       │                       │
│ │ Révision 129                       │  │ Révision 128                       │                       │
│ │                                    │  │                                    │                       │
│ │ [Garder la version du disque]      │  │ [Garder ma version]                │                       │
│ └────────────────────────────────────┘  └────────────────────────────────────┘                       │
│                                                                                                      │
│ Voir toutes les sauvegardes                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          [Fermer]    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Règles :
- **Aucune version n'est présentée comme la bonne** : deux cartes de même poids (`.conflit__version`), deux boutons de même style (`.btn--secondaire`), aucune couleur recommandée, aucune valeur par défaut, aucune fusion. Focus initial sur le titre du dialogue.
- La comparaison est **chiffrée** (nombre de prestations, date de modification, révision), pas ligne à ligne. Une version illisible ou absente est présentée comme telle (« Illisible », « Absente ») et son bouton est désactivé.
- Chaque choix demande une **confirmation** : « Garder cette version ? » avec une phrase qui dit laquelle est conservée et où reste l'autre (« Vous gardez la version du disque. La version de l'application reste dans les sauvegardes. »), [Annuler] (focus) [Oui, garder cette version]. Après restauration : message « Version rétablie. La page va se recharger. », puis rechargement. Un échec affiche une `.alerte--danger` dans le dialogue.
- **Conflit non résolu au démarrage** : bandeau `.alerte--attention` « Un conflit de synchronisation n'a pas été résolu » (date de détection ; les deux versions sont dans les sauvegardes ; l'application utilise la version du disque) avec le même bouton ; le dialogue adapte son texte d'introduction.
- Fichier verrouillé ou occupé : message d'erreur du serveur dans un toast ; rien n'est perdu.

### 8.6 Autres états globaux et bandeaux

Les bandeaux sont construits à partir de l'état de l'application (`js/bandeaux.js`) et affichés dans `#bandeaux`, en tête de chaque page.

| Situation | Alerte | Titre | Contenu / action |
|---|---|---|---|
| Fichier illisible, absent ou occupé (mode dégradé) | `--danger`, `role="alert"` | Erreur | message du serveur ; le contenu de la page est remplacé par l'écran « Restaurer une sauvegarde » (§8.8) |
| Fichier créé par une version plus récente | `--attention`, `role="alert"` | Lecture seule | « … aucune modification n'est possible. » (+ « Son contenu n'est pas reconnu par cette version… » le cas échéant) ; boutons d'écriture désactivés |
| Conflit de synchronisation | `--danger`, `role="alert"` | Les données ont été modifiées ailleurs | [Choisir la version à garder] (§8.5) |
| Conflit détecté puis non résolu | `--attention`, `role="status"` | Un conflit de synchronisation n'a pas été résolu | [Choisir la version à garder] |
| Sauvegarde automatique en échec | `--attention`, `role="status"` | Attention | message du serveur + lien « Voir les sauvegardes » (`parametres.html#sauvegardes`) ; persiste jusqu'à la prochaine sauvegarde réussie |
| Incohérences de données détectées | `--attention`, `role="status"` | Attention | message du serveur |
| Serveur arrêté (plus de réponse) | `--attention`, `role="alert"` | L'application est arrêtée. | « Pour la relancer, utilisez le raccourci Suivi Facturation du Bureau, puis rechargez cette page. » (voir §8.9) |
| Erreur de chargement d'une page | `--danger`, `role="alert"` | Erreur | message d'erreur ; la zone de contenu est vidée |
| JavaScript indisponible | `--danger`, `role="alert"` (`<noscript>`) | Erreur | « Cette application nécessite JavaScript. » |

### 8.7 Premier démarrage et catalogue vide (accueil guidé)

Un fichier de données neuf a un **catalogue vide** : rien ne peut être saisi tant qu'aucune prestation active n'est définie. Les écrans le disent et guident vers Paramètres › Tarifs (`/parametres.html#tarifs`). Logique pure dans `js/catalogue-etat.js`, états : `vide` (aucune prestation définie), `inactif` (toutes désactivées), `utilisable`.

- **Facturation du mois** et **Prestations**, fichier sans aucune prestation, catalogue `vide` : `.etat-vide[data-accueil-vide][data-catalogue="vide"]`, titre « Bienvenue : commencez par définir vos prestations », deux étapes en paragraphes (« 1. Définissez vos prestations et leurs tarifs (Paramètres → Tarifs). » / « 2. Saisissez ensuite vos prestations. »), bouton primaire « Définir mes prestations et tarifs ».
- Catalogue `inactif` : même structure, titre « Aucune prestation n'est active dans votre catalogue », une phrase d'explication, bouton « Ouvrir Paramètres → Tarifs ».
- Catalogue utilisable, fichier sans prestation : titre « Bienvenue : aucune prestation n'est encore enregistrée ». Sur Facturation : « Ajoutez votre première prestation : le récapitulatif du mois apparaîtra ici. » + boutons « Ajouter une prestation » (primaire) et « Voir les tarifs » (secondaire). Sur Prestations : « Ajoutez votre première prestation avec le formulaire ci-dessus. » + « Voir les tarifs ».
- **Prestations, catalogue inutilisable** : la carte « Ajouter une prestation » reste affichée avec `data-ajout-desactive="oui"`, `aria-disabled="true"` sur le formulaire, tous ses champs et boutons `disabled`, et une `.alerte--attention` « Saisie impossible pour le moment » (catalogue vide, ou toutes prestations désactivées) avec un bouton primaire vers Paramètres › Tarifs. L'état vide de la liste n'y répète pas la consigne (titre « Aucune prestation » seulement). Le formulaire redevient utilisable au retour sur l'onglet si le catalogue a changé dans un autre onglet.
- **Facturation du mois**, mois sans prestation avec un catalogue inutilisable : le bouton de l'état vide devient « Définir mes prestations et tarifs ».
- **Paramètres › Tarifs** : états vides décrits au §8.4.
- **Tableau de bord** sans aucune prestation : `.etat-vide` « Pas encore de données à afficher » (§8.3).

### 8.8 Écran « Restaurer une sauvegarde » (fichier absent ou illisible)

Quand le fichier de données est illisible, absent ou occupé, le contenu de la page (`#zone`) est remplacé par `.ecran-bloquant` ; le bandeau `.alerte--danger` reste en tête. Le fichier est relu à l'affichage, au clic sur « Réessayer » et juste avant (puis au moment) de restaurer : s'il est revenu lisible (synchronisation terminée), l'écran le dit et propose de le reprendre au lieu de l'écraser. Le même écran sert sur les quatre pages.

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ (!) Erreur   {message du serveur sur l'état du fichier}                      ← bandeau d’erreur en tête de page       │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Restaurer une sauvegarde                                                                                              │
│ Le fichier est peut-être en cours de synchronisation : cliquez sur « Réessayer » pour le relire. Sinon, choisissez la │
│ sauvegarde à remettre en place ; le fichier abîmé est conservé à part avant la restauration : rien n'est supprimé.    │
│ [Réessayer la lecture du fichier]                                                                                     │
│                                                                                                                       │
│ Date                Raison             Prestations   Taille  Action                                                   │
│ ────────────────────────────────────────────────────────────────────────────────────                                  │
│ 21/10/2026 à 08:42  Quotidienne                 12   4,2 Ko  [Restaurer]                                              │
│ 20/10/2026 à 18:05  Manuelle                    11   4,0 Ko  [Restaurer]                                              │
│ 20/10/2026 à 08:30  Démarrage                   11   4,0 Ko  [Restaurer]                                              │
│ 19/10/2026 à 08:31  Quotidienne        [Illisible]  0 octet  [Restaurer] (désactivé)                                  │
│                                  {raison du refus}                                                                    │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Titre `h2` « Restaurer une sauvegarde » ; texte d'introduction selon la cause (fichier introuvable, fichier occupé par un autre programme, ou illisible / en cours de synchronisation) ; [Réessayer la lecture du fichier] (`.btn--secondaire`) ; une zone `role="status"` pour « Le fichier de données n'est toujours pas lisible… ».
- Tableau des sauvegardes (le même que dans Paramètres › Sauvegardes) : la plus récente en premier ; une sauvegarde non restaurable est une ligne `.ligne--inactive` avec le badge « Illisible », le motif du refus et un bouton désactivé. Aucune sauvegarde : `.etat-vide` « Aucune sauvegarde disponible » (avec le dossier concerné).
- Restaurer : dialogue de confirmation avec aperçu (§8.4, point 2) ; le texte de l'état actuel dit ce qu'il advient du fichier abîmé (copie conservée à part).
- **Dernier recours** : seulement si aucune sauvegarde n'est restaurable et que le fichier est absent ou illisible, un bloc « Dernier recours : repartir d'un fichier vide » avec un bouton `.btn--danger` ; confirmation « Repartir d'un fichier vide ? » (créer un nouveau fichier de données vide, copie du fichier abîmé conservée à part, action non annulable depuis l'application ; le texte actuel de la confirmation parle d'un « catalogue de prestations par défaut », voir §15.5), [Annuler] (focus) [Oui, repartir d'un fichier vide].
- Issues : l'écran est remplacé par une `.alerte--succes` (« Sauvegarde restaurée », « Nouveau fichier créé » ou « Le fichier de données est revenu ») et un bouton primaire « Ouvrir l'application » (rechargement) ; le focus est placé sur le message.

### 8.9 Arrêt de l'application

- Arrêt demandé depuis Paramètres › Application : voir §8.4, point 6.
- Arrêt constaté par la page (le serveur ne répond plus à deux signaux de présence consécutifs, `js/presence.js`) : la page cesse tout envoi et affiche, en tête de `<main>`, un bandeau `.alerte--attention` `role="alert"` « L'application est arrêtée. » — « Pour la relancer, utilisez le raccourci Suivi Facturation du Bureau, puis rechargez cette page. ». Le nom « Suivi Facturation » est celui du raccourci créé sur le Bureau.

### 8.10 Combobox de recherche de patient (saisie d'une prestation)

But : retrouver un patient déjà enregistré pendant qu'on tape son nom, sans quitter le clavier, et savoir avant de valider si la prestation ira à un patient existant ou à un nouveau. La liste **propose**, elle ne décide pas : Entrée valide le formulaire tant qu'aucune suggestion n'a été choisie.

**Où.** Les champs Nom et Prénom du formulaire d'ajout rapide (§8.2) et du dialogue « Modifier la prestation ». Chaque champ est une combobox ; les deux cherchent dans le même registre (nom, prénom, « nom prénom » ou « prénom nom », sans tenir compte des accents, de la casse ni des espaces de bord). Le choix d'une suggestion remplit **les deux** champs.

**Structure DOM** (à construire par `el()` / `textContent`, jamais `innerHTML`) :

```html
<div class="champ champ--combo">
  <label class="champ__label" for="p-nom">Nom <span class="champ__requis"> (obligatoire)</span></label>
  <div class="combo">
    <input class="input" id="p-nom" name="nom" type="text" autocomplete="off"
           role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
           aria-expanded="false" aria-controls="p-nom-liste"
           aria-describedby="p-nom-aide p-nom-annonce">          <!-- + id de l'erreur, + id de l'indication (voir plus bas) -->
    <ul class="suggestions" id="p-nom-liste" role="listbox" aria-label="Patients enregistrés" hidden>
      <li class="suggestion" role="option" id="p-nom-opt-0" aria-selected="false">
        <span class="suggestion__nom">Lapin Pierre</span>
        <span class="suggestion__detail">dernière prestation le 17/10/2026</span>      <!-- homonymes seulement -->
      </li>
      <li class="suggestion suggestion--archive" role="option" id="p-nom-opt-1" aria-selected="false">
        <span class="suggestion__nom">Ours Baloo</span>
        <span class="suggestion__marque">archivé</span>
      </li>
      <li class="suggestion suggestion--creer" role="option" id="p-nom-opt-2" aria-selected="false">
        Créer le patient « Lapin Pierre »
      </li>
    </ul>
    <p class="suggestions__vide" id="p-nom-vide" hidden>Aucun patient enregistré ne correspond.</p>
  </div>
  <p class="champ__aide" id="p-nom-aide">Tapez pour chercher un patient enregistré.</p>
  <p class="champ__erreur" id="p-nom-erreur" hidden>…</p>
  <div class="sr-only" id="p-nom-annonce" role="status" aria-live="polite"></div>   <!-- nombre de résultats -->
</div>
```

L'indication du patient (« Patient enregistré », « Nouveau patient »…) est **un seul** élément pour les deux champs :

```html
<p class="indication-patient" id="indication-patient" role="status" data-patient="enregistre">Patient enregistré</p>
```

- `data-patient` : `enregistre` (✓, vert), `nouveau` (+, bleu, bordure en tirets), `reactive` (!, ambre : « Patient archivé : il sera réactivé avec cette prestation »). Pas de valeur = pas d'indication : l'élément reste dans le DOM, **vide** (le CSS le rend invisible mais le garde dans l'arbre d'accessibilité, ce qui permet l'annonce).
- Emplacement : dans le formulaire d'ajout rapide, dans `.ajout-rapide__actions`, avant l'astuce (aucun décalage des champs) ; dans le dialogue de modification, sous la grille de champs. Son `id` est ajouté à `aria-describedby` des deux champs.
- Aucune indication tant que Nom et Prénom sont vides.

**Règles de contenu de la liste**
- 8 suggestions au plus. Ordre : patients actifs d'abord, puis archivés. L'option « Créer… » est **toujours la dernière**.
- Une suggestion montre `Nom Prénom` (graisse 650). Un **homonyme** ajoute `.suggestion__detail` « dernière prestation le jj/mm/aaaa » (« aucune prestation » le cas échéant). Un patient archivé ajoute `.suggestion__marque` « archivé » ; l'option porte `.suggestion--archive`, et un filet sépare le premier archivé du dernier actif.
- « Créer le patient « Nom Prénom » » : présente quand le texte tapé ne correspond exactement (même clé) à aucun patient. Si un seul champ est rempli, l'option affiche ce qui est tapé suivi de « … » (« Créer le patient « Lapin … » »). La choisir **ne crée rien** : elle ferme la liste, laisse le texte tel quel et affiche l'indication « Nouveau patient » ; le patient est créé avec la prestation.
- Aucune suggestion et rien à créer (champ vide, registre vide) : `p.suggestions__vide` à la place de la liste (« Aucun patient enregistré pour le moment. Tapez un nom pour en créer un. » ou « Aucun patient enregistré ne correspond. »). Le `<ul>` reste `hidden` : un `listbox` ne contient que des options.

**Clavier** (motif ARIA « combobox avec liste » ; le focus ne quitte jamais le champ) :

| Touche | Effet |
|---|---|
| Frappe | filtre et ouvre la liste ; **aucune option n'est active par défaut** (`aria-activedescendant` vidé) |
| ↓ | liste fermée : l'ouvre ; sinon passe à l'option suivante (la dernière ramène à la première) |
| ↑ | option précédente (la première ramène à la dernière) |
| Entrée | option active : la choisit (et n'envoie pas le formulaire) ; sinon : comportement normal du formulaire |
| Échap | liste ouverte : la ferme (et n'agit pas sur un dialogue parent) ; liste fermée : comportement normal |
| Tab | ferme la liste **sans rien choisir** et passe au champ suivant |
| Clic ou toucher sur une option | la choisit ; le focus revient dans le champ |

Une option choisie remplit Nom et Prénom, ferme la liste (`aria-expanded="false"`), place le focus sur le champ suivant du formulaire (Date) et pose l'indication. Modifier ensuite Nom ou Prénom à la main abandonne le choix (retour à « Nouveau patient » ou à l'absence d'indication).

**Attributs ARIA tenus à jour**
- `aria-expanded` : `true` quand la liste est visible. `aria-activedescendant` : `id` de l'option active ; l'option active porte `aria-selected="true"`, les autres `aria-selected="false"`.
- `aria-controls` pointe vers le `listbox` même quand il est caché.
- **Annonce** (`role="status"`, `.sr-only`, texte remplacé après une courte attente de frappe pour ne pas lire chaque lettre) : « 3 patients proposés », « 1 patient proposé », « Aucun patient enregistré ne correspond », avec « ; vous pouvez aussi créer un nouveau patient » si l'option est présente, et « (8 au plus : précisez la recherche) » quand la liste est tronquée. La navigation aux flèches est annoncée par le lecteur d'écran lui-même (nom de l'option active) : ne rien ajouter.
- Le nom accessible d'une option est son texte : « Ours Baloo archivé » ; « Lapin Pierre dernière prestation le 17/10/2026 ».

**États visuels**

| État | Rendu |
|---|---|
| Fermée | champ `.input` ordinaire |
| Ouverte | cadre `--c-bordure-champ` 1,5 px, ombre `--ombre-2`, ancré sous le champ (pas sous l'aide ni l'erreur), 20 rem de haut au plus (50 % de la hauteur de la fenêtre au plus), défilement interne |
| Survol | fond `--c-survol-ligne` |
| Active (clavier) | fond `--c-selection` + **barre gauche de 4 px** `--c-primaire` + nom en gras renforcé : l'état n'est pas porté par la couleur seule |
| Archivé | mention « archivé » dans une pastille à bordure **en tirets** avec « ▪ » |
| Créer | « + » en tête, texte `--c-lien`, filet en tirets au-dessus |
| Vide | cadre identique, texte `--c-texte-doux` |
| Erreur de champ | inchangé (§5.2) : bordure épaissie à 3 px, message sous le champ |
| Lecture seule, conflit, mode dégradé | champ `disabled` comme les autres champs de l'écran (§8.2) ; la liste ne s'ouvre pas |
| Dialogue | la liste n'est plus flottante (`position: static`) : elle pousse le contenu, pour ne pas être rognée par le défilement du dialogue |
| Contraste forcé | cadre en `ButtonText`, option active en `Highlight` / `HighlightText` |

**Contrastes calculés** (formule WCAG ; non mesurés à l'écran). Clair / sombre :
- texte `--c-texte` sur option active `--c-selection` : 13,12 / 10,45 ; sur survol `--c-survol-ligne` : 14,60 / 12,32.
- précisions `--c-texte-doux` sur option active : **5,96 / 5,97** ; sur survol : **6,63 / 7,04** ; sur la liste `--c-surface` : 7,40 / 7,87.
- « Créer… » (`--c-lien`) sur surface : 6,46 / 8,23 ; sur option active : **5,20 / 6,24** ; sur survol : 5,79 / 7,36.
- barre de l'option active (`--c-primaire`) sur option active : 5,20 / 5,57 (élément graphique, ≥ 3:1) ; cadre de la liste (`--c-bordure-champ`) sur surface : 4,26 / 5,16.
- pastille « archivé » et indications : paires `neu`, `ok`, `inf`, `att` du §3 (texte ≥ 7,2:1).

**Cibles et petit écran.** Option : 44 px de haut au moins (`--cible`) ; précisions à la ligne sous le nom à 375 px (pas de coupe, `overflow-wrap`) ; texte à 14 px au minimum. La liste a la largeur du champ. Le clavier virtuel d'un téléphone peut en masquer le bas : non vérifié (§15).

### 8.11 Page Patients (`patients.html`)

But : voir, ajouter, renommer, archiver et supprimer ses patients sans passer par une prestation. La page ne contient que des noms de patients et des compteurs : aucun nom dans l'URL, le titre de la page ni le stockage du navigateur (le filtre Actifs / Archivés / Tous, non nominatif, peut être retenu dans `sessionStorage`).

`<main class="page ecran-patients">`, titre `h1` « Patients », `#zone` de classe `pile`. Entrée « Patients » dans la navigation, entre « Prestations » et « Tableau de bord » (cinq entrées).

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Patients                                                                                             │
│                                                                                                      │
│ ┌ Ajouter un patient ──────────────────────────────────────────────────────────────────────────────┐ │
│ │ Nom (obligatoire)         Prénom (obligatoire)                                                   │ │
│ │ [ Cygne      ]            [ Lea         ]                                                        │ │
│ │ (i) Un patient enregistré ressemble à ce nom : Cygne Léa (aucune prestation)                     │ │
│ │ [Ajouter le patient]   Entrée pour valider                                                       │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                                      │
│ ┃ Actif, archivé, archives annuelles : quelle différence ?                                           │
│ ┃ Patient actif      Proposé en premier quand vous saisissez une prestation.                         │
│ ┃ Patient archivé    Rangé hors de la saisie ; ses prestations, ses chiffres et ses exports restent. │
│ ┃ Archives annuelles Anciennes prestations rangées par année, en lecture seule : sans rapport.       │
│                                                                                                      │
│ Recherche [ nom ou prénom ]    Afficher ( ) Actifs  ( ) Archivés  (•) Tous                           │
│ 5 patients affichés                                                                                  │
│                                                                                                      │
│ Patient                               État        Prestations   Actions                              │
│ ─────────────────────────────────────────────────────────────────────────────────────────────────── │
│ Lapin Pierre                          ● Actif               2   [Renommer] [Archiver]                │
│   dernière prestation le 07/10/2026                                                                  │
│ Ours Baloo                            ▪ Archivé             3   [Renommer] [Réactiver]               │
│   dernière prestation le 16/10/2026                                                                  │
│ Renard Basile  ≈ Homonyme             ● Actif               2   [Renommer] [Archiver]                │
│   dernière prestation le 17/10/2026                                                                  │
│ Renard Basile  ≈ Homonyme             ● Actif               1   [Renommer] [Archiver]                │
│   dernière prestation le 05/09/2026                                                                  │
│ Cygne Léa                             ● Actif               0   [Renommer] [Archiver] [Supprimer]    │
│   aucune prestation                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

(Exemple fictif : second « Renard Basile » et « Cygne Léa » ajoutés au jeu de données ; les compteurs sont ceux de l'exemple, tous mois confondus.)

**Structure DOM de `#zone`** (dans cet ordre) :
1. **Formulaire d'ajout** : `section.carte.ajout-rapide` (`h2.carte__titre` « Ajouter un patient »), `form > .formulaire-grille` avec deux `.champ` (Nom, Prénom, `autocomplete="off"`, « obligatoire » en toutes lettres, erreurs §5.2), puis `.ajout-rapide__actions` : `button.btn.btn--primaire` « Ajouter le patient » + `.ajout-rapide__astuce`. Sous la grille, `div.pile.pile--s[role="status"][aria-live="polite"]` : quand un patient existant ressemble à ce qui est tapé, un paragraphe d'introduction (« Un patient enregistré ressemble à ce nom : ») suivi de `ul.patients-existants` (§ ci-dessous). Informatif : n'empêche rien. Pas de combobox ici : le focus et Entrée restent à ceux d'un formulaire.
2. **Aide** : `aside.aide-patients` > `h2.aide-patients__titre` « Actif, archivé, archives annuelles : quelle différence ? » + `dl.infos` à trois paires (dt : « Patient actif », « Patient archivé », « Archives annuelles »). Texte court, toujours visible (pas de dépliant). Libellés proposés :
   - Patient actif : « Proposé en premier quand vous saisissez une prestation. »
   - Patient archivé : « N'est plus proposé en premier à la saisie. Ses prestations, ses chiffres, ses exports et ses sauvegardes ne changent pas. Vous pouvez le réactiver à tout moment. »
   - Archives annuelles : « Anciennes prestations rangées par année, en lecture seule (Paramètres). Archiver un patient n'a aucun rapport avec elles. »
3. **Filtres** : `.filtres[role="group"][aria-label="Filtres de la liste des patients"]` : `.champ` « Recherche » (`input.input.input--recherche`, `autocomplete="off"`, filtre local sans accents ni casse, **jamais dans l'URL ni dans le stockage**) ; `.champ` « Afficher » avec `.segment[role="group"][aria-label="Patients à afficher"]` de trois `.segment__bouton[aria-pressed]` (Actifs par défaut, Archivés, Tous).
4. **Résumé** : `.resume-liste[aria-live="polite"]` : « <strong>5</strong> patients affichés ».
5. **Liste** : `.table-wrap[role="region"][aria-label="Liste des patients"][tabindex="0"] > table.table.table-patients`, `caption.sr-only` « Patients enregistrés », colonnes ci-dessous. Aucun patient / aucun résultat : `.etat-vide` (ci-dessous).

**Colonnes et lignes**

| Colonne | Classes | Contenu |
|---|---|---|
| Patient | `th[scope="row"]` | `span.patient__nom` (nom) + `span.patient__prenom` (prénom) ; `span.patient__badges` pour « Homonyme » ; `span.cellule-double__secondaire` « dernière prestation le jj/mm/aaaa » ou « aucune prestation » ; `span.patient-meta` (voir 375 px) |
| État | `.col-detail-patient` | `span.badge.badge--actif` « Actif » ou `span.badge.badge--archive` « Archivé » |
| Prestations | `.col-detail-patient.col-nombre` | nombre de prestations du fichier actif (`1`, `0`…) |
| Actions | `.col-action` | `span.actions-ligne` de boutons `.btn.btn--petit` |

- Tri par nom puis prénom. Ligne d'un patient archivé : `tr.ligne--archivee` (texte adouci ; le mot « Archivé » porte l'information).
- Badge d'homonyme : `span.badge.badge--homonyme` « Homonyme » (« ≈ » + bordure en pointillés) dans `.patient__badges`, **toujours accompagné** de la date de dernière prestation pour les distinguer.
- Actions, avec un `aria-label` qui nomme le patient (« Renommer le patient Lapin Pierre ») :
  - `[Renommer]` : `.btn--secondaire.btn--petit`, ouvre le dialogue de renommage.
  - `[Archiver]` (patient actif) ou `[Réactiver]` (archivé) : `.btn--secondaire.btn--petit`, **sans confirmation**, message avec « Annuler » (§5.8).
  - `[Supprimer]` : `.btn--danger-discret.btn--petit`, **rendu uniquement si le patient n'a aucune prestation** (fichier actif et archives annuelles lisibles) ; sinon absent, pas désactivé : « Archiver » est la seule proposition.

**375 px (< 40 em).** Le tableau garde sa structure (`th scope`, en-têtes) mais passe à deux colonnes, **Patient** et **Actions** : les colonnes État et Prestations (`.col-detail-patient`) sont retirées, et `span.patient-meta` apparaît dans la cellule Patient avec la même information (« Archivé · 12 prestations »). À chaque largeur, une seule des deux versions existe pour un lecteur d'écran : `.patient-meta` est en `display: none` au-dessus de 40 em, `.col-detail-patient` en dessous. Le HTML doit donc contenir les deux. Les boutons d'action s'empilent en colonne, 44 px de haut. Les filtres passent à la largeur du champ. Pas de défilement horizontal attendu à 375 px.

**Dialogues** (`dialog.dialogue`, §5.7)
- **Renommer le patient** : titre « Renommer le patient » ; champs Nom et Prénom préremplis ; aide : « N prestations seront mises à jour. » (« Aucune prestation à mettre à jour. » à 0) ; s'il y a des archives annuelles concernées : `.champ__aide` « Les prestations rangées dans les archives annuelles gardent l'ancien nom. » ; pied [Annuler] [Renommer]. Un simple changement de casse ou d'espaces s'applique sans confirmation supplémentaire. Après renommage : message « Lapin Pierre renommé en Lapin Pierre-Louis. 12 prestations mises à jour. [Annuler] ».
- **Un patient porte déjà ce nom** (ajout ou renommage vers un nom existant) : `.alerte--attention` en tête du corps (« Rien n'est créé tant que vous n'avez pas choisi. »), puis `ul.patients-existants` : un `li` par patient existant (`span.patient__nom`, `span.patient__prenom`, badges « Archivé » / « Homonyme » le cas échéant, « N prestations », `span.cellule-double__secondaire` « dernière prestation le jj/mm/aaaa »). Pied, focus initial sur **Annuler** : [Annuler] [Créer quand même un homonyme] (`.btn--secondaire`) et, **à l'ajout seulement**, [Utiliser ce patient] (`.btn--primaire`). Au renommage, il n'y a pas de fusion : seuls Annuler et « Renommer quand même (homonyme) » existent.
- **Supprimer ce patient ?** : confirmation `.btn--danger` « Supprimer le patient », focus sur Annuler ; corps : « Lapin Pierre n'a aucune prestation. Une sauvegarde est faite juste avant. » ; message avec « Annuler » ensuite.
- **Archiver** n'ouvre pas de dialogue. Si le patient a des prestations à venir ou un reste à payer, le message l'indique (`toast--attention`) : « Cygne Léa archivé. Ce patient a 1 prestation à venir et 2 prestations avec un reste à payer : elles restent visibles partout. [Annuler] » (le message donne des **nombres de prestations**, pas un montant).

**États**
- Aucun patient : `.etat-vide` « Aucun patient enregistré », texte « Les patients se créent ici ou directement quand vous saisissez une prestation. », boutons « Ajouter un patient » (remet le focus dans Nom) et « Saisir une prestation » (lien vers `prestations.html`).
- Filtre sans résultat : `.etat-vide` « Aucun patient » + « Effacer les filtres » ; filtre « Archivés » vide : « Aucun patient archivé ».
- Chargement (`.chargement`), erreur de chargement (`.alerte--danger` + « Réessayer ») : comme §8.1.
- **Lecture seule, conflit de synchronisation, mode dégradé** : comme §8.2. Le formulaire d'ajout (`aria-disabled="true"`, champs et bouton `disabled`) et tous les boutons Renommer / Archiver / Réactiver / Supprimer sont désactivés ; l'explication « Modification impossible : … » est dans le `title` et reliée par `aria-describedby` à un paragraphe `.sr-only` ; le bandeau (§8.6) reste en tête ; recherche, filtre et lecture de la liste restent disponibles. En mode dégradé, `#zone` est remplacé par l'écran de restauration (§8.8).
- Opération en cours : le bouton reçoit `aria-busy="true"` et `disabled` (un double clic ne crée qu'un seul patient).

**Libellés** : « Patient », « Ajouter le patient », « Renommer », « Archiver », « Réactiver », « Supprimer », « Archivé », « Actif », « Homonyme ». Le mot « archivé » ne s'emploie que pour un patient ; les « archives annuelles » ne s'appellent jamais « archives de patients ».

## 9. Accessibilité (WCAG 2.2 AA visé)

1. **Contrastes** : texte ≥ 4,5:1, éléments d'interface et graphiques ≥ 3:1 dans les deux thèmes (§3). Les paires listées sont calculées ; toute nouvelle paire doit être vérifiée. Voir §15 pour les cas non couverts.
2. **Pas de couleur seule** : voir §4. États = mot + symbole + forme ; liens soulignés ; page courante soulignée et en gras ; erreurs avec texte et bordure épaisse ; séries de graphiques avec motifs et tableau.
3. **Focus visible** : anneau de 3 px (`--c-focus`) décalé de 2 px sur **tout** élément focalisable, jamais supprimé (`:focus-visible` ; l'anneau n'apparaît pas au clic souris). L'anneau fait au moins 3:1 contre chaque couleur adjacente dans les deux thèmes ; dans les boutons de segment, où il est rentré à l'intérieur du bouton, il est à deux bandes (option active : bande claire `--c-surface` sur le fond primaire). Valeurs et règle : §3.6.
4. **Clavier** :
   - Ordre de tabulation = ordre du DOM = ordre visuel ; pas de `tabindex` positif ; pas de piège (sauf dialogues modaux, voulus).
   - Entrée valide un formulaire ; Échap ferme un dialogue ou une info-bulle ; Espace/Entrée activent boutons et cases.
   - Lien d'évitement « Aller au contenu » ; `main` focalisable (`tabindex="-1"`).
   - Aucun raccourci clavier propre à l'application (les touches simples seraient contraires à WCAG 2.1.4).
   - Les conteneurs de tableaux défilants ont `tabindex="0"` et un `role="region"` + `aria-label`.
5. **Structure** : `lang="fr"` ; un seul `h1` par page, titres hiérarchisés (le titre d'un dialogue est un `h2`) ; repères `header`, `nav` (nommé), `main` ; `title` de page unique, **sans donnée nominative** ; tableaux avec `caption` et `th scope`.
6. **Formulaires** : label visible lié (`for`/`id`) pour chaque champ ; `autocomplete="off"` sur les champs nominatifs ; erreurs liées par `aria-describedby` et `aria-invalid` (la valeur de `aria-describedby` est composée par `js/accessibilite.js` : texte d'aide, puis message d'erreur quand le champ est en erreur) ; résumé d'erreurs avec liens et focus.
7. **ARIA dynamique** : toasts et bandeaux dans une région `aria-live` présente au chargement ; `role="alert"` pour les erreurs et conflits ; compteur de sélection annoncé ; résumé de liste (`aria-live="polite"`) ; chargement annoncé (`role="status"`). `aria-expanded` sur les dépliages, `aria-pressed` sur les commutateurs, `aria-current="page"` sur la navigation, `aria-busy` pendant une action.
8. **Graphiques** : le SVG est un `role="group"` nommé (`<title>`, `aria-labelledby`) et décrit (`<desc>`, `aria-describedby`) ; chaque colonne est un `role="group"` avec un `aria-label` complet (période, valeur de chaque série, total) et reçoit le focus clavier tant qu'il y en a 26 au plus (au-delà, elle garde son nom, le tableau fait foi) ; le tableau de valeurs (« Voir les chiffres ») est l'équivalent textuel intégral ; l'info-bulle, qui ne répète que ces informations, est masquée aux lecteurs d'écran. Texte du graphique à 14 px (§6.4). Détail : §6.1 et §6.3.
9. **Cibles** : 44 px par défaut, 36 px minimum en tableau (≥ 24 px exigés par WCAG 2.5.8) ; espacement ≥ 4 px entre actions voisines.
10. **Zoom et texte** : tailles en `rem`, mise en page fluide ; les tableaux défilent dans leur conteneur ; l'espacement du texte peut être augmenté sans perte de contenu (non testé, §15).
11. **Mouvement** : transitions ≤ 120 ms ; surbrillance de ligne et transitions désactivées si `prefers-reduced-motion`. Aucune animation automatique.
12. **Contraste forcé Windows** (`forced-colors`) : bordures des boutons, champs, badges, alertes, toasts, cartes et indicateurs forcées en `ButtonText` ; boutons principaux et option de segment active en `Highlight` (anneau de focus des segments en `Highlight`, ou `HighlightText` sur l'option active) ; page courante cerclée ; trait des icônes de paiement en `CanvasText`.
13. **Délais** : les toasts avec action restent 12 s et se mettent en pause au survol et au focus ; les erreurs restent jusqu'à fermeture.
14. **Combobox de patient** (§8.10) : motif ARIA « combobox avec liste » (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `listbox` / `option`) ; le focus reste dans le champ ; nombre de résultats annoncé par une région `role="status"` ; état de l'option active porté par une barre et la graisse, pas par la couleur seule ; options de 44 px.

## 10. Responsive

Application de bureau d'abord ; **utilisable jusqu'à un téléphone**. Points de rupture (em) : 40 (≈ 640 px), 48 (≈ 768 px), 62 (≈ 992 px).

| Largeur | Comportement |
|---|---|
| ≥ 62 em | Tableau de bord : cartes `.tdb-moitie` côte à côte ; Paramètres avec sommaire collant à gauche (14 rem) ; page de 76 rem maximum, centrée |
| 48 – 62 em | Une colonne ; les tableaux défilent horizontalement dans leur conteneur si besoin |
| < 48 em | Les colonnes `.col-secondaire` seraient masquées, mais aucun tableau actuel n'en utilise : tous les tableaux gardent leurs colonnes et défilent dans leur cadre |
| tableau < 60 rem (versements d'un dialogue : < 42 rem) | Paiement en un clic : seul le déclencheur « Payer ▾ » est visible, il déplie les cinq modes sur une ligne en boutons de 44 px (§5.14). Seuil de **conteneur** (largeur du tableau), pas de largeur d'écran |
| < 40 em | Page Patients : tableau à deux colonnes (Patient, Actions), boutons d'action empilés (§8.11) ; combobox : options sur deux lignes si besoin. Marges de page réduites, `h1` plus petit ; navigation sur toute la largeur ; dialogues en feuille collée en bas, boutons pleine largeur ; barres horizontales sur 2 lignes (libellé + valeur, puis piste) ; `.champ--large` sur une colonne ; `dl.infos` sur une colonne ; versions du conflit empilées ; commutateurs du tableau de bord à options empilées |

Le formulaire d'ajout garde le même ordre de champs quelle que soit la largeur (grille `auto-fit`). Aucun `overflow: hidden` sur un contenu porteur d'information (les pistes de barres et les dialogues rognent seulement leurs bords arrondis).

## 11. Impression

Cible principale : « Facturation du mois » (`.ecran-facturation`). Fichier : `impression.css` (page A4 portrait, marges 15 / 12 mm déclarées par `@page` ; toutes les autres règles dans `@media print`).

| Règle | Détail |
|---|---|
| Thème | **Noir sur blanc**, jetons forcés en clair même si l'écran est en sombre. Les bordures de famille sont noires : l'information ne dépend pas des fonds |
| Masqué | en-tête, lien d'évitement, bandeaux, toasts, boutons (`.btn`), chevrons, pied de page, outils et sélecteur de mois, commutateurs de vue, filtres, colonnes d'actions et de cases, barre de sélection, dialogues, `.no-print` |
| Titre | le `h1` d'écran (`.page-titre`) est masqué sur la Facturation ; `.recap__titre-impression` s'affiche : « Facturation — octobre 2026 » + « Récapitulatif par patient (par date de prestation) · imprimé le 21/10/2026 » |
| Tableau | `border-collapse`, filets fins gris, en-tête **répété sur chaque page** (`table-header-group`), police 10 pt, colonnes secondaires affichées, lignes **jamais coupées** (`break-inside: avoid` ; un patient et son détail restent ensemble) |
| Totaux | ligne de total en gras avec filet épais, `tfoot` répété en bas du tableau |
| Détail | masqué par défaut ; affiché si `.recap[data-impression-detail="oui"]` (même si la ligne est repliée à l'écran) |
| Badges | texte + symbole + bordure noire (tirets pour « à facturer », points pour « à venir ») : l'information survit à l'impression monochrome |
| Icônes de paiement | noires, 4,2 mm, nom du mode écrit à côté (§5.13) |
| Liens | pas de soulignement ; **aucune URL** imprimée entre parenthèses |
| Pied | `.recap__pied-impression` : « Séances = prestations de catégorie « Séance » ; les autres catégories… » ; la pagination est laissée au navigateur |
| Graphiques | couleurs et motifs conservés (`print-color-adjust: exact`), un graphique par bloc non coupé, tableau de valeurs affiché (les dépliants sont ouverts le temps de l'impression, `beforeprint`/`afterprint`), info-bulle masquée, cartes du tableau de bord sur une seule colonne |

Autres écrans : impression simple (sans navigation ni boutons). L'impression contient des **données de santé nominatives** : rien à ajouter côté interface, mais la documentation utilisateur peut le rappeler.

## 12. Compatibilité CSP et hors ligne

Politique de sécurité du contenu appliquée par le serveur : `default-src 'none'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self'`, `font-src 'self'`, `connect-src 'self'`.
- Feuilles servies depuis `/css/` (même origine) : conforme. Aucun `<style>`, aucun attribut `style`.
- Aucune police : pile système. Aucune image : tous les symboles sont des caractères Unicode, des formes CSS (chevrons en bordures, motifs en dégradés) ou des SVG construits en JavaScript.
- `url()` : aucune dans les feuilles. Les motifs de graphiques sont référencés par l'attribut SVG `fill="url(#…)"` dans le document.
- Les dégradés, `::before`, `calc()`, variables CSS, `<dialog>`, `:focus-visible`, `:has()`, `print-color-adjust`, `color-scheme` sont du CSS/HTML standard sans ressource externe.
- Largeurs dynamiques : `element.style.setProperty('--part', …)` et propriétés CSSOM (`style.left`, `style.top`), autorisées sous `style-src 'self'`.
- Tout fonctionne hors ligne (aucun appel réseau dans les feuilles ; les pages ne parlent qu'au serveur local de l'application).

## 13. Messages et libellés (français)

- **Vouvoiement** neutre et court. Pas de jargon technique (« JSON » n'apparaît que sur le bouton d'export) ; on dit « fichier de données », « sauvegarde ».
- Formats : dates `12/10/2026` (ou « octobre 2026 » en toutes lettres dans les titres) ; montants `1 250,00 €` (espace insécable, virgule) ; pourcentages `42,2 %`.
- Une erreur dit **quoi** corriger et **comment** (« Le montant doit être un nombre positif, par exemple 45 ou 45,50. »).
- Une confirmation nomme **l'objet et la conséquence**, le bouton répète le verbe.
- Termes figés : « À facturer », « Facturé », « Non payé », « Partiellement payé », « Payé », « Reste à payer », « Facturé en attente (reste à payer) » (série de graphique), « Prévu (estimation indicative) », « À venir » (date future), « Encaissé » (vue par date de versement).
- Modes de paiement : Carte bancaire, Chèque, Espèces, Virement, Autre. Catégories de prestation : Séance, Bilan, Autre.

## 14. Choix de conception

Décisions prises pour l'interface livrée, et leurs raisons.

1. **Thème clair / sombre** : le thème suit par défaut le réglage de Windows ; un réglage « Apparence » (Automatique, Clair, Sombre) dans Paramètres permet de le forcer. Le choix est mémorisé localement et appliqué avant l'affichage pour éviter un flash.
2. **État de paiement par patient** : le récapitulatif affiche un badge dérivé des totaux du patient (payé si le reste est nul, non payé si rien n'est payé alors que le dû est positif, partiellement payé sinon). Un trop-perçu est un badge distinct, sans compensation avec d'autres prestations.
3. **Impression** : le détail des prestations n'est pas imprimé par défaut ; la case « Inclure le détail à l'impression » l'ajoute. Un titre (mois, vue, date d'impression) et un pied de page (« Séances = … ») sont imprimés.
4. **Saisie** : l'ordre des champs est Nom, Prénom, Date, Prestation, Montant, Motif (les champs qui changent le plus d'abord, le motif facultatif en dernier). Après un ajout, la date et la prestation sont conservées, le montant revient au tarif, les champs patient et motif sont vidés et le focus revient sur Nom.
5. **Conflit de synchronisation** : un bandeau signale le conflit sur toutes les pages ; le dialogue de choix s'ouvre à la demande, par un bouton, et non automatiquement. Les deux versions sont présentées sans recommandation et chaque choix demande une confirmation.
6. **Raccourcis clavier** : l'application n'en définit pas. Les touches simples sont exclues par accessibilité (WCAG 2.1.4) et les combinaisons à modificateur risquent d'entrer en conflit avec le navigateur ou les lecteurs d'écran.
7. **Taille de texte** : 16 px de base, en `rem`, donc ajustable par le réglage du navigateur.
8. **Colonnes du récapitulatif** : Patient, Séances, Autres, Dû, Payé, Reste à payer, État, Actions. Le texte copié est produit par un module unique (`js/recap-texte.js`) où les colonnes, leurs titres et leur ordre se règlent ; il s'aligne sur le récapitulatif par date de prestation.
9. **Barres horizontales en HTML/CSS** pour les classements (répartition, impayés) : plus simple et plus accessible que du SVG ; les barres empilées du chiffre d'affaires et des séances sont en SVG.
10. **Sens de « à facturer » et de « prévu »** : « À facturer » désigne le reste à payer des prestations non facturées (dans les graphiques) ou le montant des lignes à facturer (indicateur de tête, acomptes compris). « Prévu » est une série distincte, réservée à l'estimation indicative et aux séances à venir.
11. **Homonymes** : la distinction se fait dans un dialogue de choix qui affiche « dernière prestation le jj/mm/aaaa ». Avec le registre des patients (§8.10, §8.11), les homonymes portent en plus un badge « Homonyme » dans la liste des patients et la date de dernière prestation dans les suggestions.
12. **Symboles** : les symboles d'état (✓ ◐ ○ ◇ ◆ » ↻) sont des caractères Unicode, pas des icônes dessinées. Seuls les modes de paiement ont des icônes SVG (liste des prestations, boutons de paiement en un clic, choix du mode).
13. **Icône « Virement » sans libellé** : dans la colonne « Paiement », l'icône est affichée seule ; le libellé est dans l'`aria-label` du groupe, dans la bulle `title` et à l'impression. Les boutons de paiement en un clic sont aussi des icônes seules, mais ce sont des **actions** : leur nom complet (mode et montant) est dans leur `aria-label`, et la bulle `title` le répète au survol.
14. **Navigation** : quatre entrées fixes aujourd'hui (Facturation du mois, Prestations, Tableau de bord, Paramètres) ; une cinquième, « Patients », est spécifiée au §8.11.
15. **Quitter l'application** : un bouton explicite dans Paramètres, avec confirmation, plutôt qu'un arrêt silencieux ; la page cesse alors toute requête.
16. **Payer en un clic** : un bouton par mode sur la ligne plutôt qu'un « Payé en totalité » qui réutilise en silence le dernier mode ; le dernier mode est mis en évidence, jamais appliqué sans clic. L'ordre des cinq boutons est fixe, pour que la position d'un mode ne change pas d'une ligne à l'autre. Quand le tableau est trop étroit pour les cinq boutons, un seul déclencheur « Payer ▾ » les déplie sur une ligne (§5.14).

## 15. Limites et points non vérifiés

### 15.1 Ce qui a été relu et ce qui ne l'a pas été
- Ce document a été rédigé en relisant les feuilles de style (`public/css/`), les pages HTML et le JavaScript des pages (`public/js/`). Les classes, jetons, attributs `data-*`, libellés et structures décrits y ont été retrouvés. **Aucun rendu navigateur n'a été refait pour cette version du document**, hormis le focus clavier (§3.6) : les parties sur l'accessibilité des graphiques (§6.1, §6.3, §6.4, §9) et sur l'écran Prestations en lecture seule (§8.2) ont été vérifiées dans le code, pas à l'écran, ni avec un lecteur d'écran. La syntaxe CSS n'a pas été validée par un analyseur.
- Les maquettes sont des schémas textuels, **non testés auprès de l'utilisatrice**. Largeurs de colonnes, longueurs de libellés, hauteur réelle du formulaire d'ajout, comportement sur petit écran : à confirmer à l'écran.
- Des tests automatiques couvrent la conformité CSP du front (pas d'`innerHTML`, de style en ligne, de ressource externe), la structure des icônes de paiement et plusieurs règles pures du front ; aucun test ne rend ni ne mesure l'apparence.

### 15.2 Accessibilité
- **Contrastes** : calculés par la formule WCAG sur les paires listées aux §3, §4 et §5.13 (recalculés lors de la rédaction de ce document), **jamais mesurés à l'écran**. Les paires non listées ne sont pas toutes calculées. L'opacité 0,55 des contrôles désactivés n'est pas évaluée (les contrôles désactivés sont exemptés par WCAG).
- **Focus des boutons de segment** : contrastes calculés (§3.6) et styles calculés relevés dans un navigateur (thèmes clair et sombre, fenêtre large et étroite) ; l'aspect de l'anneau en contraste forcé Windows réel n'a pas été vérifié, et sur l'option active il prend la forme d'un cadre clair à l'intérieur du segment, moins marqué qu'un anneau coloré.
- **Texte des graphiques à taille de texte agrandie** : le texte des graphiques est à 14 px par défaut et suit le réglage de taille de texte du navigateur (unité `rem`), mais ses marges et interlignes sont calculés en pixels fixes à partir de 14 px (§3.4, §6.4). Avec une taille de texte agrandie (sans zoom de page), étiquettes, graduations et valeurs risquent de se serrer, de se chevaucher ou de déborder du cadre ; le comportement n'a pas été vérifié. Le zoom de page, lui, met tout à l'échelle, marges comprises (non vérifié non plus).
- **Daltonisme** : les quatre couleurs de séries ont des luminances proches ; l'interface s'appuie sur les motifs, la légende et le tableau. Aucune simulation de daltonisme n'a été faite.
- **Lecteurs d'écran** (NVDA, Narrateur…) : aucun test. Les patrons ARIA utilisés (régions `aria-live`, groupes nommés et décrits pour les graphiques SVG, colonnes `role="group"` avec un `aria-label` complet et focalisables jusqu'à 26, groupes nommés pour les modes de paiement, dialogues natifs) sont ceux de la documentation, non éprouvés ici. Pour les graphiques, on ne sait pas encore comment les lecteurs annoncent un groupe SVG, ses colonnes (nom, rôle, ordre de lecture) ni les textes SVG laissés dans le groupe (graduations, valeurs) ; le tableau « Voir les chiffres » reste l'équivalent de référence.
- **Clavier** : l'ordre de tabulation et le retour du focus ont été déduits du code, pas testés manuellement sur toutes les pages.
- **Zoom 200 % et largeur 320 px** : visés par la conception, non testés.
- **Bulle `title` des icônes de paiement** : inaccessible au clavier ; l'information équivalente est dans l'`aria-label` du groupe.
- **Combobox et page Patients** : règles et contrastes (§8.10, §8.11) établis par le calcul et la lecture du CSS, **jamais rendus à l'écran** (ni à 375 px, ni en thème sombre, ni en contraste forcé). Annonce du nombre de résultats, navigation par `aria-activedescendant` et nom accessible des options : aucun lecteur d'écran essayé. Clavier virtuel d'un téléphone masquant le bas de la liste : non vérifié. Annonce répétée de l'indication « Nouveau patient » pendant la frappe : à observer. Symboles « ● ▪ ≈ » : présence dans la police système supposée.
- **Lisibilité des icônes de paiement à 20 px**, en particulier « Virement » et « Chèque » : non éprouvée auprès de l'utilisatrice.

### 15.3 Rendu, navigateurs, impression
- **Motifs SVG** (`<pattern>` + `patternTransform`) et références `fill="url(#…)"` : non testés dans tous les navigateurs ni à l'impression. Un identifiant de motif dupliqué dans une page casserait le rendu : les identifiants sont préfixés par un compteur.
- **Glyphes Unicode** (✓ ◐ ○ ◇ ◆ » ↻) : présence dans Segoe UI / Segoe UI Symbol sous Windows 11 supposée, non vérifiée. La syntaxe `content: "x" / ""` (texte alternatif vide) est doublée d'une déclaration de repli ; un lecteur d'écran qui l'ignore pourrait annoncer le symbole.
- **Fonctions CSS et HTML récentes** (`<dialog>`, `:focus-visible`, `:has()`, `contain: inline-size`, `color-scheme`, `print-color-adjust`, `::backdrop` avec variables) : supposées disponibles dans les navigateurs récents ; la version du navigateur de l'utilisatrice n'est pas connue. `:has()` conditionne l'affichage des icônes de paiement et de leurs séparateurs.
- **Impression** : en-tête de tableau répété, `break-inside`, nombre de pages réel, format A4, impression d'un `<dialog>` ouvert ; rien de tout cela n'a été imprimé pour ce document.

### 15.4 Ce que l'interface ne propose pas
Ces éléments n'existent pas dans les pages actuelles ; les feuilles de style en contiennent parfois les classes (§7).
- Aucun écran d'archivage ni de consultation d'archives, aucun lien « Archives » dans la navigation, aucun rappel d'archivage.
- Combobox de patient et page Patients (§8.10, §8.11) : **spécifiées et stylées, pas encore branchées par le JavaScript** ; tant que ce n'est pas fait, la saisie reste en deux champs texte libres, sans liste ni détection de doublon à l'ajout.
- Le bandeau « Données d'exemple » de la démonstration fait 92 px de haut à 375 px.
- Aucune comparaison annuelle ni liste de patients actifs dans le tableau de bord.
- Aucune icône de favicon : le serveur répond 204 à `/favicon.ico`.
- Aucun raccourci clavier propre à l'application.
- Aucune version imprimable dédiée du tableau de bord ou de Prestations au-delà de l'impression simple (§11).

### 15.5 Autres écarts relevés
- Le trait gauche de l'indicateur « Séances du mois » (`data-serie="neutre"`) n'a pas de règle de couleur dédiée : il garde la couleur de bordure par défaut.
- Sur grand écran, la carte « Répartition » du tableau de bord se place seule sur la dernière rangée, dans la colonne de gauche.
- **Écart de texte à corriger (JavaScript, hors du périmètre de ce document)** : la confirmation « Repartir d'un fichier vide ? » (`public/js/ecran-degrade.js`) annonce un nouveau fichier « avec le catalogue de prestations par défaut ». Or un fichier neuf a un catalogue **vide** (§8.7) : la phrase est à corriger, le comportement est le bon.
- Le commentaire d'en-tête de `public/css/composants.css` sur le focus des boutons de segment renvoie à « design-system §9 et §3.6 » ; le détail et les contrastes sont au §3.6 (le §9 en donne le principe, point 3).
- Des classes utilitaires et de composants sont définies sans usage actuel (§7.1 à §7.3) ; elles sont conservées dans les feuilles.

## 16. Logo et icône

> Fichiers et procédure de génération : `scripts/icone/` (voir son README).

- **Concept** : icône générique, sans nom ni identité de cabinet. Carré arrondi, trois barres ascendantes (suivi du chiffre d'affaires), la plus haute coiffée d'une coche (facturé / payé). Style plat, aucun texte, aucun dégradé, aucune ombre.
- **Liseré** : trait clair fin à l'intérieur du bord de la tuile, pour la détacher d'une barre des tâches sombre. Blanc `#ffffff` à 60 % d'opacité (rendu `#a4bfdc` sur le fond), épaisseur 5/256 (environ 2 %) ; 1 px à 16 px ; barres et coche inchangées.
- **Couleurs** (3, issues de `tokens.css`) : fond `#1b5fa8` (`--c-primaire` clair), barres `#ffffff`, coche `#8fe0b4` (`--c-ok-texte` sombre). Contrastes calculés : barres sur fond 6,46:1 ; coche sur fond 4,15:1 ; bord de la tuile contre une barre des tâches sombre (`#12171d`) : 2,79:1 avant liseré (fond bleu), 9,49:1 avec le liseré (`#a4bfdc`) ; contre un fond clair (`#f4f6f8`) : 5,97:1 avant, 1,75:1 pour le liseré lui-même (le bord reste lisible par le fond bleu, à 3,41:1 du liseré, mais la tuile paraît cerclée d'un halo pâle). L'icône est la même dans les deux thèmes (elle porte son propre fond).
- **Tailles livrées** : ICO 16, 24, 32, 48, 64, 128, 256 px ; PNG 512 px ; SVG source. Variante calée sur la grille de pixels à 16 px.
- **Usages** : icône du raccourci « Suivi Facturation » créé sur le Bureau, image d'en-tête du README. Le favicon n'est pas encore branché (le serveur répond 204 à `/favicon.ico`).

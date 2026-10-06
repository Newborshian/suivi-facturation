# Logo et icône

Icône **générique** (aucune référence à un cabinet ni à une marque) : carré arrondi bleu, trois barres blanches ascendantes (suivi du chiffre d'affaires), la plus haute coiffée d'une coche verte (facturé / payé), le tout cerclé d'un liseré clair fin qui détache la tuile d'une barre des tâches sombre. Couleurs tirées de `public/css/tokens.css` : `#1b5fa8` (primaire), `#ffffff`, `#8fe0b4` (vert « ok » du thème sombre). Liseré : blanc `#ffffff` à 60 % d'opacité (soit `#a4bfdc` sur le fond bleu), épaisseur 5 unités sur 256 (environ 2 %), tracé à l'intérieur de la tuile (emprise 256 x 256 et forme inchangées) ; 1 px exactement dans la variante 16 px.

## Fichiers

- `logo.svg` : source (viewBox 256 x 256, sans dépendance externe).
- `suivi-facturation.ico` : 16, 24, 32, 48, 64, 128 et 256 px (images PNG 32 bits).
- `logo-512.png` : pour le README et un éventuel favicon.
- `generer-icone.mjs` : génère les trois fichiers ci-dessus.

## Régénérer

```
node scripts/icone/generer-icone.mjs
```

Le script est autonome (Node seul : `zlib`, pas de dépendance, pas de réseau). La géométrie est définie une seule fois dans le script et sert au SVG comme au rendu raster (suréchantillonnage 8 x 8 pour l'antialiasing) ; le résultat est reproductible. Pour 16 px, une variante calée sur la grille de pixels (barres de 3 px, liseré de 1 px) évite les bords flous. Pour changer le dessin, modifier les constantes en tête du script, puis relancer.

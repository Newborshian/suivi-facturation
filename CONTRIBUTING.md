# Contribuer à suivi-facturation

Merci de votre intérêt. Le projet est personnel et volontairement petit ; les contributions sont les bienvenues si elles respectent les règles ci-dessous.

## Règles non négociables

- **Aucune donnée réelle** (nom, prénom, motif, montant de patient) dans le code, les tests, les captures, les tickets ou les messages de commit. Utilisez les données factices de `config/exemple.json`.
- Le serveur écoute sur **127.0.0.1 uniquement** ; aucun appel réseau sortant, aucun CDN, aucune télémétrie.
- **Node.js 24, JavaScript pur (ESM)**, pas de TypeScript, pas d'étape de build.
- **Dépendances au minimum** : modules natifs d'abord (`node:http`, `node:test`, `fetch`). Toute dépendance doit être justifiée par écrit et acceptée avant d'être ajoutée (embarquée localement, pas de CDN).
- Interface et documentation en **français**.
- `data/`, `.env`, `*.bak` et `.tmp/` ne sont jamais commités.

## Mise en route

```
git clone https://github.com/Newborshian/suivi-facturation.git suivi-facturation
cd suivi-facturation
npm start      # http://127.0.0.1:4780
npm test       # tests node:test
```

Les tests utilisent des dossiers temporaires sous `.tmp/` et ne touchent jamais à `data/` ; ils posent `ERGO_SANS_ENV=1` pour que le `.env` de votre poste ne change pas leur résultat. Ils sont rangés par thème (`tests/domain`, `tests/store`, `tests/http`, `tests/front`, `tests/scripts`, `tests/qa`), avec des aides communes dans `tests/aides`. La sortie complète de la dernière exécution est écrite dans `derniers-tests.log` (ignoré par git).. Un fichier de test peut parfois s'arrêter brutalement sous Windows sans détail (cause non démontrée) : relancez avant de conclure à une régression. Pour essayer l'interface ou faire des captures sur des données fictives : `npm run demo` (copie temporaire du jeu d'exemple, jamais `data/` ni le dossier d'un `.env`, rien n'est conservé).

## Scripts de lancement (dossier `scripts/`)

- Toute la logique (détection du système, verrous, port, ouverture du navigateur) est en **Node** (`scripts/*.mjs`) ; les enveloppes par système restent minces : `.vbs` et `.bat` (Windows), `.sh` en POSIX `sh` sans bashisme (Linux, macOS). Pas de dépendance.
- Les lanceurs Linux et macOS sont **expérimentaux, non testés sur un vrai système** : si vous les essayez, dites ce qui marche ou non.
- Pour essayer un lanceur sans toucher à vos vraies données ni à votre application en cours : définissez `ERGO_DATA_DIR`, `ERGO_LOG_DIR` et `ERGO_VERROU_DIR` vers des dossiers temporaires (sous `.tmp/` ; ces trois dossiers sont contrôlés sur leur chemin réel : un lien symbolique ou une jonction menant dans le projet est refusé, code de sortie 2), un `ERGO_PORT` d'essai, `ERGO_LANCEUR_SANS_NAVIGATEUR=1` et `ERGO_LANCEUR_SANS_BOITE=1`. N'arrêtez que les processus que vous avez lancés, par leur PID (jamais par nom).
- Les fichiers `.vbs` sont enregistrés en ASCII pur (accents par `ChrW`) ; le `.bat` en UTF-8 sans BOM ; tous avec fins de ligne Windows. Les `.sh` : fins de ligne Unix.

## Proposer un changement

1. Ouvrir un ticket décrivant le besoin avant un gros changement.
2. Faire une branche, de petits commits clairs, et ajouter ou adapter les tests.
3. Vérifier que `npm test` passe et que l'interface reste utilisable au clavier et sans réseau.
4. Mettre à jour la documentation concernée (`docs/`, `README.md`).
5. Ouvrir une demande de fusion en décrivant ce qui change et comment vous l'avez vérifié.

La conception du projet est décrite dans `docs/architecture.md` (modules, format des données, API) et `docs/design-system.md` (interface).

## Sécurité

Pour signaler un problème de sécurité ou de confidentialité, n'ouvrez pas de ticket public contenant des détails exploitables : suivez [SECURITY.md](SECURITY.md).

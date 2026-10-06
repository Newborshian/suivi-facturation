> **Aucune donnée réelle** (nom, prénom, motif ou montant de patient) dans le code, les tests, les captures, la description ou les messages de commit. Utilisez `config/exemple.json` ou `npm run demo`.

## Ce qui change

<!-- Résumé en quelques lignes ; lien vers le ticket s'il existe. -->

## Comment je l'ai vérifié

- [ ] `npm test` passe (système : Windows / Linux / macOS)
- [ ] Essai dans l'interface avec les données fictives (`npm run demo`), au clavier et sans réseau
- [ ] Tests ajoutés ou adaptés pour ce qui touche au stockage, aux montants ou aux dates

## Règles du projet

- [ ] Aucune dépendance ajoutée (ou justification écrite acceptée avant)
- [ ] Aucun appel réseau sortant, aucun CDN, écoute sur `127.0.0.1` uniquement
- [ ] Interface et documentation en français ; documentation mise à jour (`README.md`, `docs/`)
- [ ] Ni `data/`, ni `.env`, ni `*.bak`, ni `.tmp/`, ni `logs/` dans le commit

## Ce qui n'a pas été vérifié

<!-- Systèmes non essayés, cas non couverts… -->

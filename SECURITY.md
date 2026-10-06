# Sécurité

suivi-facturation est une application **locale** : le serveur n'écoute que sur `127.0.0.1`, sans compte, sans appel réseau sortant. Elle manipule pourtant des **données de santé** (noms de patients, motifs, montants). Les problèmes de sécurité et de confidentialité sont donc pris au sérieux.

## Modèle d'usage et limites connues

À utiliser sur un ordinateur où **une seule personne a un compte**. L'application n'a **aucune authentification locale** : tout autre programme ou compte de la même machine peut accéder à son adresse locale (`127.0.0.1`) et lire ou modifier les données. Ne l'utilisez pas sur un poste partagé (famille, cabinet à plusieurs, session à distance) et ne l'exposez pas sur un réseau. Piste prévue en feuille de route, **non livrée** : un jeton secret par lancement.

Concrètement : le serveur n'accepte que des requêtes dont les en-têtes `Host` et `Origin` sont ceux de `127.0.0.1`, ce qui protège contre un site web ouvert dans le navigateur, mais **pas** contre un autre programme ou un autre compte de la machine, qui choisit librement ces en-têtes. Les données de santé sont stockées en clair dans le dossier de données.

Mesures en place, dans ces limites : le fichier de données, les sauvegardes et le journal sont créés avec les droits `0600`/`0700` sous Linux et macOS (sans effet sous Windows, où les droits viennent du profil de l'utilisateur) ; le verrou d'instance est rangé dans un dossier propre à l'utilisateur dont le propriétaire et les droits sont contrôlés ; les dossiers choisis par `ERGO_DATA_DIR`, `ERGO_LOG_DIR` et `ERGO_VERROU_DIR` sont vérifiés sur leur chemin réel, et un lien symbolique ou une jonction qui les ferait aboutir dans le projet est refusé (code de sortie 2). Windows 11 est le système vérifié ; les lanceurs Linux et macOS sont expérimentaux, non testés sur un vrai système.

## Versions suivies

Seule la dernière version de la branche principale reçoit des correctifs.

## Signaler une faille

- **N'ouvrez pas de ticket public** pour une faille exploitable (fuite de données, accès depuis un autre ordinateur ou un site web, exécution de code, contournement des contrôles `Host`/`Origin`, lecture de fichiers hors du dossier prévu…).
- Écrivez d'abord, en privé, à : `<contact-securite>` (ou utilisez le signalement privé de vulnérabilité de la plateforme qui héberge `<adresse-du-depot>`, s'il est activé).
- Décrivez : la version ou le commit, le système (Windows, Linux, macOS) et la version de Node.js, les étapes pour reproduire, l'effet observé et l'effet attendu.

## Aucune donnée de santé dans un signalement

**Ne joignez jamais de donnée réelle** : ni nom ou prénom de patient, ni motif, ni montant réel, ni fichier de données (`suivi-facturation.json`), ni sauvegarde, ni export CSV/JSON, ni journal, ni capture d'écran d'un vrai dossier. Reproduisez le problème avec les données fictives : `npm run demo` ou `config/exemple.json`.

## Ce qui se passe ensuite

La personne qui maintient le projet accuse réception dès que possible, confirme ou non le problème, puis prépare un correctif. Le signalement est rendu public une fois le correctif disponible, avec votre accord pour vous citer ou non.

## Hors du périmètre

- L'hébergement des données choisi par l'utilisatrice ou l'utilisateur (disque, dossier synchronisé dans un cloud, sauvegarde externe) et sa conformité aux obligations professionnelles : voir le README.
- Un attaquant qui contrôle déjà la session de l'ordinateur, ou tout autre compte ou programme de la même machine : l'application n'a pas d'authentification locale et stocke les données en clair, par conception (voir « Modèle d'usage et limites connues » ci-dessus et `docs/exploitation.md`). Un jeton secret par lancement est prévu en feuille de route, non livré.

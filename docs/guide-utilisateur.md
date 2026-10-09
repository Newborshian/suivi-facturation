# Guide d'utilisation de suivi-facturation

Ce guide s'adresse à la personne qui utilise l'application au quotidien. Aucune connaissance technique n'est nécessaire.

suivi-facturation vous aide à suivre vos séances, ce qui est facturé et ce qui est payé. **Ce n'est pas un outil de facturation** : il ne produit pas de facture. Il prépare le récapitulatif que vous recopiez dans votre outil habituel. Ce n'est pas non plus un logiciel de comptabilité certifié ni un dossier patient : la liste des patients qu'il tient ne contient que le nom, le prénom et un état actif ou archivé. Il est pensé pour un praticien ou une praticienne libérale de santé travaillant seul(e).

> **À lire une fois : ce sont des données de santé.**
> Les noms de vos patients, les motifs et les montants sont des données de santé. Ils restent sur votre ordinateur (et dans votre dossier Proton Drive si vous l'avez choisi). Les sauvegardes et les exports contiennent ces mêmes informations **en clair**. Rangez-les dans un endroit sûr, ne les envoyez pas par messagerie ordinaire et ne les copiez pas sur une clé USB laissée sans protection. Le choix de l'endroit où sont stockées ces données (disque de l'ordinateur, cloud personnel, sauvegarde externe) et leur conformité à vos obligations professionnelles et légales restent de votre responsabilité : cet outil n'apporte aucune garantie de conformité et ne fixe aucune durée de conservation.

---

## 1. Démarrer l'application

1. Double-cliquez sur le raccourci « Suivi Facturation » de votre Bureau (la personne qui a installé l'application l'a créé : voir `docs/exploitation.md`, rubrique « Raccourci sur le Bureau »). Sous l'icône, Windows peut écrire le nom sur deux lignes (« Suivi » puis « Facturation ») : c'est normal, cela dépend de la taille des icônes choisie dans Windows.

   Si vous aviez un ancien raccourci nommé « Suivi-facturation » (avec un tiret), recréez le raccourci en double-cliquant sur `scripts\Creer le raccourci Bureau.vbs` : une boîte propose de remplacer l'ancien par « Suivi Facturation ». Répondez **Oui** : il n'y aura qu'un seul raccourci. Répondre **Non** ne change rien (l'ancien reste, aucun nouveau n'est créé).
2. Aucune fenêtre noire ne s'ouvre. Au bout de quelques secondes, le navigateur (Edge, Chrome, Firefox…) s'ouvre tout seul sur l'application.
3. L'application tourne alors en arrière-plan, sans fenêtre. Elle s'arrête toute seule quand vous fermez la page (voir « Arrêter l'application » ci-dessous).

Ce que vous voyez dans le navigateur : en haut, un bandeau avec le nom de l'application et cinq onglets : **Facturation du mois**, **Prestations**, **Patients**, **Tableau de bord**, **Paramètres**.

Si vous double-cliquez alors que l'application est déjà lancée (même deux fois de suite, très vite), rien de mal n'arrive et aucun message d'erreur n'apparaît : le navigateur s'ouvre simplement sur l'application qui tourne déjà, et une seule copie de l'application fonctionne. C'est aussi la façon de rouvrir l'application après l'avoir fermée.

L'application ne fonctionne que sur votre ordinateur, sans Internet : elle n'est pas accessible depuis un autre ordinateur. Elle n'a ni mot de passe ni identifiant : elle est faite pour un ordinateur où vous êtes la seule personne à avoir un compte. Sur un ordinateur partagé (famille, cabinet à plusieurs, session à distance), un autre compte de la même machine pourrait accéder à vos données : ne l'utilisez pas dans ce cas.

## 2. Arrêter l'application

En général, vous n'avez rien à faire : l'application s'arrête toute seule quelques secondes après la fermeture de la dernière page (onglet ou fenêtre du navigateur). Le bouton « Quitter » n'est plus nécessaire dans ce cas. Pour la rouvrir, double-cliquez sur le raccourci « Suivi Facturation » du Bureau.

- Passer d'un écran à l'autre ou recharger la page n'arrête pas l'application. Si plusieurs onglets sont ouverts, elle ne s'arrête qu'à la fermeture du dernier.
- Si un onglet reste ouvert alors que l'application est arrêtée, il affiche : « L'application est arrêtée. Pour la relancer, utilisez le raccourci Suivi Facturation du Bureau, puis rechargez cette page. »
- Si un onglet est resté très longtemps en veille (ordinateur fermé, onglet endormi par le navigateur), l'application a pu s'arrêter pendant ce temps. Vous ne perdez aucune donnée : chaque enregistrement est écrit avant l'arrêt.
- Si le navigateur ne s'est jamais ouvert, l'application s'arrête aussi toute seule au bout de 5 minutes.

Deux autres façons d'arrêter l'application restent disponibles :

- Bouton **Quitter l'application** : dans l'application, onglet **Paramètres**, puis confirmez. L'application se ferme proprement.
- Méthode de secours (si la page ne répond plus ou n'est plus ouverte) : dans le dossier `scripts` du projet, double-cliquez sur `Arreter suivi-facturation.vbs`. Une petite boîte vous dit « L'application est arrêtée. » (ou « L'application n'était pas lancée. »).

Vos données sont enregistrées à chaque modification : il n'y a pas de bouton « Enregistrer » et vous ne perdez rien en quittant. Éteindre l'ordinateur arrête aussi l'application ; au prochain démarrage, double-cliquez de nouveau sur le raccourci.

Si l'application s'arrête alors que vous l'utilisez encore, ou ne s'arrête jamais, voir `docs/exploitation.md` (rubrique « Arrêt automatique »).

## 2 bis. Si une boîte de message apparaît au lancement

C'est le seul cas où une fenêtre s'affiche : l'application n'a pas pu démarrer. La boîte explique le problème en français (par exemple : Node.js n'est pas installé, un autre logiciel utilise le même port, le dossier de données est introuvable) et propose d'ouvrir le journal. Répondez « Oui » si vous voulez le montrer à la personne qui vous aide : il s'ouvre dans le Bloc-notes. Aucune donnée n'est modifiée dans ces situations.

- Le journal est le fichier `suivi-facturation.log` dans le dossier `logs` du projet. Il note ce qui se passe (démarrage, arrêt, erreurs) ; il ne contient ni nom de patient ni montant.
- Si rien ne se passe du tout quand vous double-cliquez : attendez 20 secondes, puis recommencez. Si cela ne change rien, utilisez le mode diagnostic : double-cliquez sur `Lancer suivi-facturation.bat` (dossier `scripts`). Il fonctionne comme avant, avec une fenêtre noire qui affiche les messages en direct ; dans ce mode, fermer la fenêtre arrête l'application.

## 2 ter. Si l'application ne répond plus, ou si le port habituel est pris

- Si une ancienne copie de l'application est restée bloquée (la page ne répond plus et un nouveau lancement ne fait rien), le raccourci affiche une boîte : « L'application ne répond plus… L'arrêter et la relancer ? ». Répondez « Oui » : l'application bloquée est arrêtée, puis relancée. Vos données ne sont pas touchées (elles sont enregistrées à chaque modification). Répondre « Non » ne change rien. La même question est posée par `Arreter suivi-facturation.vbs`.
- Si un autre logiciel de l'ordinateur utilise déjà l'adresse habituelle de l'application (le port 4780), l'application choisit toute seule une autre adresse libre : vous n'avez rien à faire, la page s'ouvre au bon endroit. Seul le numéro après « 127.0.0.1: » dans la barre d'adresse change.
- Si vous avez demandé un port précis dans le fichier `.env` (`ERGO_PORT`) et qu'il est pris, l'application ne change pas de port : une boîte vous l'explique.
- L'application ne peut tourner qu'une fois à la fois pour un même dossier de données, sur un même ordinateur. Elle ne vous empêche pas de l'ouvrir sur un second ordinateur qui partagerait le même dossier Proton Drive : ne le faites pas (voir plus bas, « Conflit de synchronisation »).

## 3. Première utilisation (application vide)

Au tout premier lancement, l'application part de zéro, sans aucune prestation ni tarif : les prestations et leurs prix varient d'une profession de santé à l'autre, aucune liste n'est fournie par défaut. L'accueil (« Bienvenue : commencez par définir vos prestations ») vous guide en deux étapes :

1. Définir vos prestations et leurs tarifs : bouton **Définir mes prestations et tarifs**, ou **Paramètres → Tarifs**. Pour chaque prestation, indiquez son nom, sa **catégorie** (**Séance**, **Bilan** ou **Autre**) et son tarif en euros, puis **Ajouter la prestation**. La catégorie « Séance » est déjà sélectionnée : changez-la seulement pour un bilan ou autre chose. Le nombre de séances du tableau de bord se calcule d'après cette **catégorie** (et non d'après la durée) : une prestation classée « Bilan » ou « Autre » est comptée à part.
   *Exemple inventé, uniquement pour illustrer :* nom « Séance individuelle 30 min », catégorie Séance, tarif 40 €. Les vôtres sont à vous de définir.
2. Saisir vos prestations : onglet **Prestations**, remplissez le formulaire (nom, prénom, date, prestation, montant, motif) et cliquez sur **Ajouter la prestation**. Le nom et le prénom se choisissent dans la liste de vos patients, ou se tapent pour créer un nouveau patient (voir « La saisie avec recherche de patient » plus bas). Le montant se remplit tout seul d'après le tarif, vous pouvez le modifier. Les noms, prénoms, motifs et noms de prestation n'acceptent pas les caractères invisibles ou de contrôle que l'on copie parfois par erreur depuis un autre document : si l'application signale un « caractère invisible », retapez le texte à la main au lieu de le coller.

Tant que le catalogue est vide (ou que toutes ses prestations sont désactivées), le formulaire de saisie est désactivé et un message vous renvoie vers **Paramètres → Tarifs**. Si un fichier de données existait déjà, il garde son catalogue : rien n'est changé. De même, « Repartir d'un fichier vide » (écran de restauration, dernier recours) donne un catalogue vide.

Une ligne = une prestation : un bilan est une seule ligne. Une prestation déjà utilisée ne se supprime pas : décochez « Active » pour ne plus la proposer. Un nouveau tarif ne s'applique qu'aux prestations saisies ensuite.

## 4. Le suivi au quotidien

- **Prestations** : la liste de toutes les lignes, avec des filtres (mois, patient, statut). On y modifie une ligne, on la supprime (l'application fait une sauvegarde juste avant), et on y enregistre les paiements.
- **Patients** : la liste de vos patients, que l'on tient à jour sans passer par une prestation (voir la rubrique « 4 bis. La page Patients »).
- **Facturation du mois** : un patient par ligne, avec le nombre de séances, ce qui est dû, ce qui est payé et ce qui reste à payer. Le bouton **Copier le récapitulatif** place le tableau dans le presse-papiers pour le coller dans votre outil de facturation ; **Imprimer** l'envoie à l'imprimante. **Marquer facturé** change le statut d'un patient (ou de tout le mois) une fois la facture faite.
- **Paiements** : sur une prestation, **Payé en totalité** enregistre le paiement du reste à payer, daté d'aujourd'hui. La toute première fois, l'application demande « Quel mode de paiement ? » (carte bancaire, chèque, espèces, virement ou autre). Ensuite, un clic suffit : elle reprend le dernier mode de paiement utilisé (par « Payé en totalité » ou par un versement). Pour payer avec un autre mode, utilisez **Versement**, où vous choisissez le mode, le montant et la date. L'état « non payé / partiellement payé / payé » se calcule tout seul. Si vous datez un versement dans le futur, l'application l'enregistre quand même mais vous prévient (« Ce versement est daté dans le futur ») : vérifiez la date, car un versement futur est compté dans un mois à venir.
- Mode de paiement dans la liste : dans l'onglet **Prestations**, la colonne **Paiement** indique l'état (« Payé », « Partiellement payé »…) et, à côté, le mode de chaque versement par une petite icône (carte bancaire, chèque, espèces, virement, autre). Placez la souris sur l'icône : une bulle affiche le nom du mode. Dans les fenêtres de saisie, le détail d'un versement et les exports, le mode est écrit en toutes lettres.
- **Tableau de bord** : le chiffre d'affaires par mois (payé, facturé en attente, à facturer), le reste à encaisser, le nombre de séances et la répartition par type de prestation. Il se remplit dès qu'il y a des prestations.
- **Prévisions** : sous le graphique du chiffre d'affaires par mois, l'application ajoute (en tirets) une **estimation indicative** pour le mois en cours et les 3 mois suivants. Elle repose sur la moyenne des 3 derniers mois complets et sur les séances déjà planifiées, et ne s'affiche que dans la vue « Dû par date de prestation » d'une période qui inclut le mois en cours. Quelques précisions : elle n'apparaît qu'avec au moins 3 mois complets de données (au début, un message explique à partir de quand elle sera possible) ; un mois sans aucune prestation compte pour 0 (des vacances font donc baisser l'estimation) ; pour le mois en cours, elle suppose que les séances déjà réalisées sont saisies. C'est un ordre de grandeur, pas un engagement.
- À venir (pas encore disponible) : l'archivage des anciennes années (à 12 mois), la détection automatique des copies de conflit du cloud et l'avertissement de doublon de prestation. Aucune prestation n'est supprimée automatiquement.

Si vous vous trompez : un message en bas de l'écran propose souvent d'**annuler** l'action que vous venez de faire.

## 4 bis. La page Patients

L'onglet **Patients** tient la liste de vos patients. Elle ne contient que le nom, le prénom et un état (actif ou archivé) : pas d'adresse, pas de téléphone, pas de date de naissance, pas de note de santé. Ce n'est pas un dossier patient.

Chaque ligne indique le nom, la date de la dernière prestation, le nombre de prestations et l'état. Au-dessus de la liste, un champ **Recherche** (nom ou prénom, sans tenir compte des accents ni des majuscules) et trois boutons pour choisir ce qui est affiché : **Actifs**, **Archivés**, **Tous**. Le choix est retenu le temps de la session du navigateur.

*Ajouter un patient.* Remplissez le nom et le prénom, puis cliquez sur **Ajouter le patient**. Vous pouvez le faire avant la première séance. Si des patients déjà enregistrés ressemblent à ce que vous tapez, ils sont listés sous les champs, à titre d'information.

*Renommer.* **Renommer** sur la ligne ouvre une fenêtre avec le nom et le prénom. Le nouveau nom est appliqué à toutes les prestations de ce patient (la fenêtre indique combien). Les prestations rangées dans des archives annuelles, quand cette fonction existera, garderont l'ancien nom.

*Archiver et réactiver.* **Archiver** retire un patient de la liste proposée en premier, sans toucher à rien d'autre ; **Réactiver** le remet. Aucune confirmation n'est demandée, et un message en bas de l'écran propose d'**annuler**. Archiver un patient qui a encore des séances prévues ou un reste à payer est permis ; l'application vous le rappelle.

*Supprimer.* **Supprimer** n'apparaît que pour un patient qui n'a **aucune prestation** (par exemple un patient ajouté par erreur). Une confirmation est demandée et l'application fait une sauvegarde juste avant. Un patient qui a des prestations ne se supprime pas : archivez-le.

*Homonymes.* Deux personnes peuvent porter le même nom et le même prénom. Si vous ajoutez ou renommez un patient vers un nom déjà pris, une fenêtre « Un patient porte déjà ce nom » s'ouvre et rien n'est fait tant que vous n'avez pas choisi : **Annuler**, **Utiliser ce patient** (l'existant sert, rien n'est créé) ou **Créer quand même un homonyme**. Les homonymes sont repérés par la mention **Homonyme**, avec la date de leur dernière prestation pour les distinguer.

### Actif, archivé, archives annuelles : quelle différence ?

L'écran Patients rappelle ces trois notions dans un encadré d'aide :

- **Patient actif** : proposé en premier quand vous saisissez une prestation.
- **Patient archivé** : n'est plus proposé en premier à la saisie. Ses prestations, ses chiffres, ses exports et ses sauvegardes ne changent pas. Vous pouvez le réactiver à tout moment.
- **Archives annuelles** : les anciennes prestations rangées par année, en lecture seule. Cette fonction n'est pas encore disponible. Archiver un patient n'a aucun rapport avec elles.

### La saisie avec recherche de patient

Dans l'onglet **Prestations**, les champs Nom et Prénom proposent vos patients au fil de la frappe (huit au plus, sans tenir compte des accents ni des majuscules). Cliquez sur une proposition, ou parcourez-les avec les flèches du clavier puis Entrée : le nom et le prénom se remplissent. Les patients archivés viennent après les actifs, avec la mention « archivé ». Si deux patients portent le même nom, la date de leur dernière prestation les distingue.

Une indication s'affiche sous les champs :

- **Patient enregistré** : la prestation sera rattachée à ce patient ;
- **Nouveau patient** : le patient sera créé en même temps que la prestation. C'est la création rapide : il n'est pas nécessaire de passer par la page Patients. Quand vous ne tapez qu'un des deux champs, la dernière proposition de la liste, « Créer le patient … », permet de créer le patient quand même ;
- **Patient archivé : il sera réactivé avec cette prestation** : saisir une prestation pour un patient archivé le réactive, et l'application le signale.

Si plusieurs patients portent exactement le nom tapé, une fenêtre « Plusieurs patients portent ce nom » demande lequel choisir (avec la date de leur dernière prestation), ou **Nouveau patient (même nom)**. Si vous changez le nom d'un patient depuis une prestation, l'application demande si le changement doit s'appliquer à toutes ses prestations ou à cette seule ligne.

### Mise à jour d'un ancien fichier

Si votre fichier de données date d'une version de l'application sans liste de patients, il est mis à jour **automatiquement** au premier lancement : la liste des patients est construite d'après les prestations existantes (tous actifs), sans rien modifier d'autre. Juste avant, l'application garde une copie exacte de l'ancien fichier, visible dans **Paramètres → Sauvegardes** sous la mention « Avant une mise à jour du fichier ». Il n'y a rien à faire. Si la mise à jour échouait, l'application ouvrirait l'écran de restauration sans modifier le fichier. Pour revenir à l'état d'avant, voir « Restaurer une sauvegarde » plus bas et `docs/exploitation.md`.

## 5. Les sauvegardes

L'application fait des **sauvegardes automatiques** : à chaque démarrage et à la première modification de chaque jour. Elle en fait aussi une juste avant une opération risquée (suppression d'une prestation ou d'un versement, restauration…).

Combien de temps sont-elles gardées ? Le réglage **Nombre de jours d'historique à conserver** (Paramètres → Sauvegardes ; 30 par défaut, entre 7 et 365) compte des jours, pas des fichiers :

- toutes les sauvegardes de la journée en cours sont gardées (50 au plus ; au-delà, les plus anciennes de la journée partent d'abord) ;
- pour chacun des jours précédents, seule la dernière sauvegarde du jour est gardée, sur les N − 1 jours précédents où il en existe une (N étant le nombre choisi) ;
- les plus anciennes sont supprimées en premier. Si vous baissez le nombre, l'application demande confirmation avant de supprimer des sauvegardes.

Les copies faites avant une restauration ou lors d'un conflit de synchronisation sont gardées 90 jours en plus, et les copies faites avant une suppression sont limitées aux 30 dernières : elles ne comptent pas dans ce réglage.

Où les voir : **Paramètres → Sauvegardes**. Vous y trouvez la date de la dernière sauvegarde, la liste, et le bouton **Sauvegarder maintenant** si vous voulez en faire une à la main (par exemple avant une grosse saisie).

Les sauvegardes sont de simples fichiers dans le sous-dossier `sauvegardes` de votre dossier de données.

## 6. Restaurer une sauvegarde

1. Allez dans **Paramètres → Sauvegardes**.
2. Dans la liste, repérez la sauvegarde voulue (date, raison, nombre de prestations) et cliquez sur **Restaurer** à droite de la ligne.
3. Une fenêtre vous montre ce que contient la sauvegarde et rappelle l'état actuel. Confirmez avec **Restaurer**.
4. L'état actuel est d'abord sauvegardé, puis remplacé. Un message en bas de l'écran propose **Annuler la restauration** pendant quelques instants ; ensuite, la liste garde une sauvegarde « Avant une restauration » qui permet de revenir en arrière.

Une sauvegarde marquée « Illisible » ne peut pas être restaurée : choisissez-en une autre.

Une sauvegarde faite avant l'arrivée de la liste des patients se restaure normalement : la liste est reconstruite à partir de ses prestations au moment de la restauration.

## 7. Exporter vos données

**Paramètres → Export** propose :

- **Exporter tout (JSON)** : une copie complète de vos données ;
- **Prestations (CSV)** et **Versements (CSV)** : des tableaux que vous ouvrez dans Excel ou LibreOffice.

Les fichiers sont téléchargés par le navigateur, en général dans le dossier **Téléchargements**. Ils contiennent des données de santé en clair : supprimez-les quand vous n'en avez plus besoin, et ne les laissez pas traîner.

## 8. Messages d'erreur et situations inhabituelles

| Ce que vous voyez | Ce que cela veut dire | Que faire |
|---|---|---|
| Boîte de message : « Node.js 24 n'est pas installé… » | Le logiciel qui fait tourner l'application manque | Suivez les instructions affichées (installation de Node.js 24, une seule fois), puis relancez |
| Boîte de message : « le port … est déjà pris par un AUTRE logiciel » | Un autre programme utilise l'adresse de l'application | Redémarrez l'ordinateur et relancez ; sinon demandez de l'aide |
| Boîte de message : « Le dossier de données choisi n'existe pas… » | Le dossier de données choisi n'existe plus ou n'est pas accessible (disque débranché, dossier renommé…) | Vérifiez le dossier ; sinon relancez « Choisir le dossier de donnees » (dossier `scripts`). Aucune donnée n'est touchée |
| Bandeau rouge : « Les données ont été modifiées ailleurs » | Le fichier de données a été remplacé pendant que l'application tournait (en général par la synchronisation du cloud) | Cliquez sur **Choisir la version à garder** : l'écran montre les deux versions (nombre de prestations, date). Aucune n'est supprimée, les deux sont sauvegardées. En cas de doute, gardez la plus complète et demandez conseil |
| Écran « Restaurer une sauvegarde » à l'ouverture | Le fichier de données est illisible ou absent (par exemple la synchronisation n'est pas terminée) | Patientez un peu et cliquez sur **Réessayer la lecture du fichier**. Sinon choisissez une sauvegarde à restaurer. **Repartir d'un fichier vide** est le tout dernier recours |
| Bandeau « Attention » : la sauvegarde automatique a échoué | La copie de sécurité n'a pas pu être écrite (disque plein, dossier verrouillé…) | Cliquez sur **Voir les sauvegardes**, faites **Sauvegarder maintenant**, et vérifiez la place disponible |
| « Lecture seule » | Le fichier a été créé par une version plus récente de l'application | Ne modifiez rien et demandez de l'aide pour mettre l'application à jour |
| Le navigateur affiche « Impossible de se connecter » | L'application a été quittée (ou l'ordinateur redémarré) | Double-cliquez sur le raccourci du Bureau pour la relancer (étape 1) |
| Bandeau « L'application est arrêtée. Pour la relancer, utilisez le raccourci Suivi Facturation du Bureau… » | L'application s'est arrêtée alors que cet onglet restait ouvert | Double-cliquez sur le raccourci du Bureau, puis rechargez la page. Aucune donnée n'est perdue |
| Une boîte indique que le port est pris alors que vous n'avez rien lancé d'autre | Un autre logiciel utilise le port que vous avez demandé dans `.env` (sinon, l'application en prendrait un autre toute seule) | Essayez `Arreter suivi-facturation.vbs` (dossier `scripts`), puis relancez ; sinon redémarrez l'ordinateur |
| Boîte « L'application ne répond plus… L'arrêter et la relancer ? » | Une ancienne copie est bloquée | Répondez « Oui » (voir la rubrique 2 ter). Rien n'est perdu |

**Conflit de synchronisation, en pratique :** il apparaît surtout si l'application est ouverte sur deux ordinateurs, ou si la synchronisation du cloud remplace le fichier pendant que vous travaillez. **N'ouvrez l'application que sur un seul ordinateur à la fois.**

Si vous avez un doute, ne supprimez rien : les sauvegardes permettent de revenir en arrière.

## 9. Où sont mes données ?

Dans un dossier appelé « dossier de données » : le fichier `suivi-facturation.json` et le sous-dossier `sauvegardes`. Par défaut c'est le dossier `data` du projet ; si votre dossier a été placé dans Proton Drive, c'est celui-là. Le chemin exact est affiché dans **Paramètres → Dossier de données**. Pour le changer, voir `docs/exploitation.md`.

## 10. Linux et macOS (expérimental, non testé)

Les lanceurs pour Linux et macOS sont expérimentaux, non testés sur un vrai système : l'application a été essayée sous Windows. Il faut installer Node.js 24 (https://nodejs.org). Dans le dossier `scripts` du projet :

- pour démarrer : `Suivi-facturation.sh` (double-clic si votre gestionnaire de fichiers le permet, sinon dans un terminal : `sh scripts/Suivi-facturation.sh`). La première fois, il peut falloir le rendre exécutable : `chmod +x scripts/*.sh` ;
- pour arrêter en secours : `Arreter suivi-facturation.sh` ;
- pour créer un raccourci : `node scripts/creer-raccourci.mjs` (Linux : un fichier `.desktop` sur le Bureau ; macOS : une application `Suivi Facturation.app` sur le Bureau). Si un ancien raccourci « Suivi-facturation » existe, le script propose de le remplacer.

Tout le reste de ce guide s'applique de la même façon : lancer deux fois ouvre simplement la page, un autre port est choisi si 4780 est pris, et l'application bloquée peut être arrêtée sur confirmation. Détails : `docs/exploitation.md`.

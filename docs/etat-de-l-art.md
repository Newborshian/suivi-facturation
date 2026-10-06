# État de l'art : logiciels libres proches de suivi-facturation

> Recherche réalisée le **2026-10-04**. Document de recherche du projet suivi-facturation. Ce n'est ni un avis juridique ni une décision produit.
> Méthode : recherches web courtes (français et anglais), puis ouverture des dépôts ou pages officielles. Les dates d'activité viennent, quand c'est possible, de l'API publique de GitHub / Codeberg (champ « dernière poussée » ou « dernière version »).
> Légende de fiabilité : **[V]** = vérifié sur la source (dépôt, page officielle, API) ; **[E]** = lu seulement dans un extrait de recherche ou un article tiers ; **[?]** = non vérifié ou contradictoire.
> Limites de la méthode : les pages ont été lues par un outil qui en produit un résumé automatique, et le moteur de recherche est orienté États-Unis. Un résumé peut être inexact : les points importants sont à revérifier sur la source. Les nombres d'étoiles et les dates sont ceux du 2026-10-04 et évoluent.

## 1. Le projet

suivi-facturation est une application web **locale** (Node.js, aucune base de données, aucun compte, aucun serveur à héberger) pour **un praticien libéral seul** : séances et prestations par patient, statut de facturation, paiements partiels et modes de paiement, récapitulatif mensuel par patient (copiable, imprimable), tableau de bord (CA payé, facturé, à facturer ; impayés par ancienneté ; séances), prévisions simples, sauvegardes et restauration, dossier de données synchronisable par un client cloud de bureau. Licence MIT. **Ce n'est pas un logiciel de facturation** : pas de facture PDF numérotée, pas de comptabilité, pas de dossier clinique.

## 2. Projets examinés

Nombre de projets et outils cités : 26. Consultés sur leur dépôt ou leur page officielle : 20 (fiches 2.1 à 2.4). Cités sans consultation directe : Logr, Ytems, GnuCash, OpenConcerto, plugin WordPress de livre de recettes, modules Odoo (section 2.5).

### 2.1 Les plus proches du besoin (praticiens, séances, paiements)

#### my-practice (Dirk Holbach)
- URL : <https://github.com/dholbach/my-practice> [V]
- Licence : AGPL-3.0 [V, API]. Pile : Django 6, Python 3.14, PostgreSQL, Docker Compose [V, README].
- Hébergement requis : **oui** (Docker, base PostgreSQL, à héberger soi-même) [V].
- Activité : dépôt créé le 2026-06-16, dernière poussée le 2026-10-01, version v0.7.1 du 2026-09-23 [V, API et page des versions]. 7 étoiles [V]. Statut « pré-version » ; l'auteur indique l'avoir testé sur une seule configuration (Allemagne, une banque, un praticien seul) et ne promet ni API stable ni support [V, README].
- Langue : allemand (par défaut) et anglais ; pas de français [V].
- Public : thérapeutes, coachs, praticiens somatiques en cabinet privé [V].
- Fonctions utiles : fiches clients et séances, facturation par lots avec PDF, suivi du statut de paiement, import CSV des relevés bancaires avec rapprochement, analyses financières avec comparaison annuelle, notes cliniques chiffrées, calendrier, documents [V, README].
- Bonnes pratiques visibles : SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, UPGRADING.md, guide de sécurité des données cliniques, modèle d'analyse d'impact (AIPD), registre des traitements, guide de sauvegarde [V, liste des fichiers du dépôt ; contenu de ces documents non relu en détail].
- Non lu dans le README consulté : paiements partiels, modes de paiement par versement, prévisions, export CSV/JSON [?, absence de mention dans un résumé, pas preuve d'absence].
- Proximité : **la plus proche par l'esprit** (praticien seul, données de santé, auto-hébergé, séances + argent). Plus lourd (serveur, base, Docker), pensé pour le droit et les usages allemands, et il **fait de la facturation PDF**, ce que suivi-facturation ne fait pas.

#### Physiocab, dépôt « kireht » (Allium SAS, communauté Kalinka)
- URL : <https://codeberg.org/Allium_SAS/kireht> [V pour l'existence et l'API] ; présentation : <https://linuxfr.org/news/physiocab-un-logiciel-libre-de-gestion-pour-kinesitherapeutes> (2026-02-19) [V].
- Licence : AGPL v3 annoncée par la dépêche et la page du dépôt [V, résumé] ; le champ licence de l'API Codeberg est vide [?].
- Pile : Python (Flask) et JavaScript, PostgreSQL, Node.js, Rust/Cargo ; application web progressive hors ligne pour tablette [V, résumé de la page du dépôt]. Hébergement requis : **oui** (serveur et base PostgreSQL).
- Activité : dépôt créé le 2025-09-11 ; mise à jour de l'API le 2026-09-04 ; dernier commit lu sur la page : 2026-08-13 [V]. Étoiles : 0 [V].
- Langue : français [V]. Public : kinésithérapeutes francophones, avec un usage décrit en établissements (EHPAD) [E].
- Fonctions : planning, dossiers patients, bilans diagnostiques, suivi de séances, **facturation** des séances, PDF, transmission automatisée vers des logiciels de soins, journal d'accès conforme RGPD, chiffrement au repos [V, résumé].
- Non établi : suivi de chiffre d'affaires par mois, paiements partiels, modes de paiement [?, non lus].
- Proximité : francophone et libre, **mais** orienté dossier clinique et facturation pour les kinés, bien plus lourd. Beta publique (v0.9) à la date de la dépêche.

#### TimeVic
- URL : <https://github.com/TimeVic/Main> [V]. Licence Apache-2.0 ; .NET 10, Blazor, PostgreSQL ; 0 étoile ; 2 252 commits [V].
- Il met en avant « ce qui est gagné, payé, impayé » par client, à partir de temps saisis [V]. Public : freelances et consultants, pas la santé. Hébergement non précisé dans le dépôt [?]. Anglais.
- Proximité : le **concept « argent payé / impayé par client »** est voisin, mais c'est du suivi de temps et de projets, avec une pile lourde.

### 2.2 Gestion de rendez-vous, facturation, suivi de temps (généralistes)

| Projet | Licence | Pile / hébergement | Activité (source) | Remarque |
|---|---|---|---|---|
| **Easy!Appointments** <https://github.com/alextselegidis/easyappointments> [V] | GPL-3.0 | PHP 8.2+, MySQL, serveur web ; 4 407 étoiles | Version 1.6.0 du 2026-05-27, dernière poussée 2026-10-01 | Prise de rendez-vous en ligne, interface multilingue. Aucune gestion de paiements ni de CA lue. |
| **InvoiceShelf** <https://github.com/InvoiceShelf/InvoiceShelf> [V] | AGPL-3.0 | PHP 8.4, Laravel, SQLite, MySQL ou PostgreSQL ; Docker possible ; environ 1 800 étoiles | Stable 2.4.6 du 2026-09-25 ; version 3 en alpha | Factures, devis, suivi des paiements, rapports ; traduction française communautaire. Paiements partiels non confirmés [?]. C'est un outil de **facturation**. |
| **Invoice Ninja** <https://github.com/invoiceninja/invoiceninja> [V] | Licence personnalisée (« Elastic », source disponible) : **pas open source au sens strict** [V, API : licence non reconnue ; résumé du README] | PHP Laravel, React, MySQL ; 10 213 étoiles | v5.13.43 du 2026-09-18 | Facturation en ligne, paiements Stripe, projets. |
| **Dolibarr** <https://github.com/Dolibarr/dolibarr> [V] | GPL-3.0 | PHP, MariaDB/MySQL/PostgreSQL ; 7 683 étoiles | 24.0.1 du 2026-09-07 | ERP/CRM complet, français, factures et paiements. Très au-delà du besoin. |
| **Kimai** <https://github.com/kimai/kimai> [V] | AGPL-3.0 | PHP 8.2+, Symfony, MariaDB/MySQL ; 5,1 k étoiles | 2.67.0 du 2026-09-13 | Suivi de temps avec facturation, plus de 30 traductions. Multi-utilisateur. |
| **solidtime** <https://github.com/solidtime-io/solidtime> [V] | AGPL-3.0 | PHP Laravel, Vue ; 8 960 étoiles | Dernière poussée 2026-10-02 | Suivi de temps, clients, facturation. |
| **Bigcapital** <https://github.com/bigcapitalhq/bigcapital> [V, API] | AGPL-3.0 | TypeScript ; 3 921 étoiles | Dernière mise à jour 2026-09-28 | Comptabilité (alternative à QuickBooks/Xero). Hors besoin. |
| **Akaunting** <https://github.com/akaunting/akaunting> [V, API] | « Autre » (non reconnue par l'API ; licence exacte non vérifiée) [?] | PHP Laravel ; 10 161 étoiles | 3.2.4 du 2026-09-17 | Comptabilité en ligne. Hors besoin. |
| **Paheko** <https://paheko.cloud/> [V, page d'accueil seulement] | « logiciel libre » (licence non lue sur la page) [?] | Pile non lue sur la page [?] ; service hébergé ou auto-hébergé | Non lue | Gestion d'associations, comptabilité en partie double, interface française. Pas pensé pour un praticien. |

### 2.3 Finances personnelles et comptabilité

| Projet | Licence | Pile | Activité | Remarque |
|---|---|---|---|---|
| **Firefly III** <https://github.com/firefly-iii/firefly-iii> [V] | AGPL-3.0 | PHP, base de données ; 24 817 étoiles | v6.7.7 du 2026-10-03 | Finances personnelles ; pas de notion de patient ni de prestation. |
| **Actual Budget** <https://github.com/actualbudget/actual> [V] | MIT | TypeScript ; 29 302 étoiles ; application de bureau et serveur | v26.10.0 du 2026-10-02 | Budget personnel « local-first ». Même licence que suivi-facturation et philosophie voisine, mais un autre métier. |

### 2.4 Dossiers de santé libres (hors besoin de suivi de CA)

| Projet | Licence | Activité | Remarque |
|---|---|---|---|
| **OpenEMR** <https://github.com/openemr/openemr> [V, API] | GPL-3.0 | Poussée 2026-10-04 ; 5 490 étoiles | Dossier médical et gestion de cabinet complets, facturation intégrée [E]. Serveur PHP. Très au-delà du besoin. |
| **GNUmed** <https://www.gnumed.de/documentation/> [V, résumé] | Libre (licence précise non lue) [?] | Version 1.8.25 du 2026-09-06 | Dossier médical ; cite explicitement les ergothérapeutes parmi ses publics. Dossier clinique, pas de suivi de CA. |
| **GNU Health** <https://www.gnuhealth.org/> [V, page d'accueil] | Non lue [?] | Non lue | Système d'information de santé pour hôpitaux, ONG, ministères. Hors échelle. |
| **OpenMRS** <https://github.com/openmrs/openmrs-core> [V, API] | Non reconnue par l'API [?] | Poussée 2026-10-02 ; 1 935 étoiles | Dossier patient pour systèmes de santé. Hors échelle. |
| **Open Dentist** <https://github.com/clawnify/open-dentist> [V] | MIT | 20 étoiles | Cabinet dentaire, factures « ouvert / payé / annulé », hébergé sur Cloudflare Workers (cloud). Pas local. |
| **Psychologist Center** <https://github.com/arthursvpb/psychologist-center> [V] | MIT | **Archivé le 2026-09-03** ; 2 étoiles | Dossiers et rendez-vous de psychologues ; Node, MySQL, Docker. Pas de paiements lus. |

### 2.5 Cités sans consultation directe
- **Logr** (suivi de temps libre, AGPL-3.0, auto-hébergeable sur Supabase) : [E], extrait de recherche seulement.
- **Ytems** : présenté comme « open source » et utilisé par des cabinets comptables pour les comptes BNC [E, article de blog d'un tiers ; licence et code source non vérifiés] <https://copeps.fr/actualites/open-source-comptabilite-bnc/>.
- **GnuCash**, **OpenConcerto** : cités par cet article et par un fil du forum LinuxFR comme options de comptabilité pour libéral [E]. Non consultés.
- **Plugin WordPress « Livre de Recettes »** : tient un livre de recettes chronologique dans un tableau de bord WordPress [E].
- **Modules Odoo de kinésithérapie** (forfaits de séances, factures) : modules d'une plateforme ERP, apparemment payants sur le catalogue Odoo [E].

### 2.6 Recherches sans résultat
Parmi les projets ci-dessus, aucun projet libre n'a été trouvé qui soit à la fois : local sans serveur ni base ; francophone ; centré sur séances + paiements partiels + modes de paiement + CA mensuel d'un praticien libéral. Cela ne prouve pas leur absence : le moteur est orienté États-Unis, la recherche porte sur quelques dizaines de requêtes, et des outils personnels peu référencés (tableurs, petits dépôts) échappent facilement à ce type de recherche. Pour les livres de recettes de professions libérales, les résultats sont surtout des modèles de tableur et des services en ligne payants, pas des dépôts libres.

## 3. Solutions propriétaires françaises (contexte seulement)

Prix publics lus dans des comparatifs de tiers [E] : à confirmer sur les sites des éditeurs.
- **Kinésithérapeutes (conventionnés, télétransmission SESAM-Vitale)** : VEGA (à partir d'environ 45 € par mois sur devis), Topaze (environ 45 à 80 €), Maddie Doctor (environ 29 à 49 €), Doctolib Pro (environ 69 à 99 €). Agenda, dossier, facturation et télétransmission. Source : <https://www.indy.fr/guide/logiciel-kine-comparatif/>.
- **Ergothérapeutes libéraux** : les comparatifs lus indiquent qu'ils n'ont pas de télétransmission à gérer ; ils s'appuient sur des outils de facturation et de pré-comptabilité : Tiime (gratuit à environ 25 € HT par mois), Abby (gratuit à environ 39 €), Swapn (comptabilité en ligne dès 29 € HT par mois), un expert-comptable en ligne (environ 39 à 69 € HT par mois). Source : <https://www.l-expert-comptable.com/a/logiciel-comptable-ergotherapeute-liberal.html>.
- **Prise de rendez-vous** : Doctolib est cité comme outil d'agenda sans télétransmission [E].
- Aucune de ces solutions n'a été testée par les auteurs.

## 4. Points de vigilance : données de santé en France

Ce qui est dit par les sources. Ce n'est pas un conseil juridique : à faire vérifier auprès de l'ordre ou de l'organisation professionnelle concernée, de la CNIL ou d'un comptable.

**Conservation du dossier patient**
- La CNIL a publié le 28 juillet 2020 un référentiel de gestion des cabinets médicaux et paramédicaux (professionnels libéraux), non obligatoire : on peut s'en écarter en le justifiant [V, page CNIL] <https://www.cnil.fr/fr/la-cnil-publie-trois-referentiels-pour-le-secteur-de-la-sante>.
- Des sources secondaires reprenant ces référentiels indiquent une conservation de **20 ans après la dernière prise en charge**, prolongée jusqu'aux 28 ans d'un patient mineur [E]. Une extraction automatique du PDF du référentiel de santé a donné une valeur différente (5 ans) : **contradiction non résolue [?]**, il faut lire le référentiel soi-même. Pour une patientèle d'enfants, la durée est plus longue.
- Le projet ne tient pas de dossier clinique ; il contient pourtant un nom de patient, un motif court et des montants : ce sont des données de santé au sens du RGPD, et leur durée de conservation est à qualifier (dossier ou donnée comptable ?). Le projet ne promet aucune durée de conservation.

**Données comptables**
- Micro-BNC : l'obligation se limite à un livre des recettes chronologique (date, montant, moyen de règlement, identité du client, référence de la pièce) [E, sites de conseil] ; un modèle est publié par l'administration <https://www.service-public.fr/professionnels-entreprises/vosdroits/R18563> [non ouvert].
- Durée de conservation des documents comptables : 10 ans selon l'article L123-22 du Code de commerce, d'après plusieurs sites [E] ; la CNIL cite aussi dix ans pour la facturation au titre du droit commercial [V, résumé de <https://www.cnil.fr/fr/les-durees-de-conservation-des-donnees>]. Le régime fiscal exact (micro-BNC ou déclaration contrôlée) relève de chaque praticien ; **suivi-facturation n'est pas un livre des recettes**, et rien n'indique qu'il remplirait cette obligation.

**Hébergement de données de santé (HDS)**
- L'article L1111-8 du Code de la santé publique impose un hébergeur certifié à qui héberge des données de santé « pour le compte » de professionnels ou de patients [E, texte repris par plusieurs sources] ; l'Agence du numérique en santé (ANS) publie la certification <https://esante.gouv.fr/labels-certifications/hebergement-des-donnees-de-sante> (page non lisible avec l'outil de lecture utilisé : [?]).
- Une note du ministère de la Santé sur le champ d'application (copie hébergée sur un site d'hôpital) indique, d'après le résumé obtenu, qu'un professionnel qui conserve lui-même ses données n'a pas besoin d'hébergeur certifié, mais que l'externalisation sur un cloud ou une sauvegarde distante passe par un prestataire d'hébergement dûment qualifié [V partiel] <https://affairesjuridiques.aphp.fr/textes/note-explicitation-du-champ-dapplication-du-cadre-juridique-de-lhebergement-de-donnees-de-sante-ministere-de-la-sante-represente-par-la-delegation-la-strategie-des-s/telecharger/629195>.
- **Zone floue à faire vérifier** : un dossier de données placé dans un client de bureau Proton Drive est-il « hébergé pour le compte » du praticien ? Proton est en Suisse et chiffre de bout en bout ; sa page produit lue ne mentionne **aucune certification HDS française** (elle cite HIPAA) [V] <https://proton.me/drive>. La certification HDS impose en outre un stockage dans l'Union européenne ou l'EEE, ce que la Suisse n'est pas [E, exigence 28 du référentiel cité par un résumé]. Le choix d'un dossier synchronisé appartient à l'utilisateur ; la question juridique reste à confirmer, et le projet n'affirme aucune conformité.
- Le RGPD continue de s'appliquer dans tous les cas : information des patients, registre des traitements, sécurité, analyse d'impact selon les cas [E].
- Aucun organisme professionnel d'ergothérapeutes publiant un guide spécifique sur ce sujet n'a été trouvé ; l'ANFE (association) a des documents sur le RGPD [E, non lus]. L'ordre ou l'organisme dont relève le praticien est à consulter.

## 5. Synthèse

### 5.1 Tableau comparatif

| Projet | Licence | Pile | Hébergement | Activité | Français | Séances / paiements / prévisions | Ce qui manque par rapport au besoin | Proximité |
|---|---|---|---|---|---|---|---|---|
| **suivi-facturation** | MIT | Node, JS pur, fichier JSON | Aucun serveur, local | Projet en cours | Oui | Oui / oui, partiels et modes / oui, simples | Facture PDF, compta, dossier clinique (voulu) | n/a |
| my-practice | AGPL-3.0 | Django, PostgreSQL | Docker + base | Poussée 2026-10-01 ; v0.7.1 | Non (DE/EN) | Séances oui / suivi du statut, rapprochement bancaire / non lu | Local sans serveur ; français ; paiements partiels non lus | Forte (esprit), moyenne (technique) |
| Physiocab (kireht) | AGPL-3.0 | Flask, PostgreSQL, JS | Serveur + base | Dernier commit 2026-08-13 | Oui | Séances oui / facturation oui / non lu | Simplicité ; centré kinés et dossier clinique | Moyenne |
| TimeVic | Apache-2.0 | .NET, PostgreSQL | Non précisé | 2 252 commits | Non | Temps / payé-impayé / rapports | Santé, séances, français | Moyenne (concept) |
| InvoiceShelf | AGPL-3.0 | Laravel, SQLite possible | Serveur PHP | Stable 2026-09-25 | Traduction communautaire | Factures, paiements / non | Récap par patient, séances | Faible à moyenne |
| Kimai / solidtime | AGPL-3.0 | PHP (+ base) | Serveur | 2026-09 / 2026-10 | Kimai oui | Temps, factures | Notion de patient ; santé | Faible |
| Easy!Appointments | GPL-3.0 | PHP, MySQL | Serveur | 1.6.0 (2026-05-27) | Multilingue | Rendez-vous seulement | Paiements, CA | Faible |
| Invoice Ninja | Licence propre (Elastic) | Laravel, React | Serveur | 2026-09-18 | Multilingue [?] | Factures, paiements en ligne | Hors besoin, pas open source strict | Faible |
| Dolibarr, Akaunting, Bigcapital | GPL-3.0 / autre / AGPL-3.0 | PHP / TypeScript | Serveur + base | Actifs 2026-09/10 | Dolibarr oui | ERP, compta | Très au-delà du besoin | Très faible |
| Firefly III, Actual Budget | AGPL-3.0, MIT | PHP ; TypeScript | Serveur ou bureau | Actifs 2026-10 | Multilingue | Budget personnel | Notion de prestation | Très faible |
| OpenEMR, GNUmed, GNU Health, OpenMRS | GPL-3.0 et autres | PHP, Python, Java… | Serveur / bureau | Actifs | Variable | Dossier clinique | Suivi de CA | Très faible (autre périmètre) |
| Paheko | Libre | non lue | Hébergé ou auto-hébergé | non lue | Oui | Compta d'association | Praticien libéral | Très faible |

### 5.2 Existe-t-il un équivalent direct ?
**Partiel, pas d'équivalent direct trouvé.** Parmi 26 projets et outils cités (20 consultés à la source), aucun ne réunit : fonctionnement local sans serveur ni base, interface française, et suivi de séances, paiements partiels, modes de paiement, impayés par ancienneté et prévisions pour un praticien libéral seul. Les plus proches sont plus lourds à installer et font de la facturation (my-practice, Physiocab) ou ne visent pas le soin (TimeVic). L'existence d'un outil plus modeste (petit dépôt, tableur partagé) non indexé ne peut pas être exclue.

### 5.3 Positionnement du projet
suivi-facturation est un petit outil **local et hors ligne**, destiné à un praticien libéral seul, pour suivre ses séances, ses paiements (partiels compris) et son chiffre d'affaires, et préparer un récapitulatif mensuel avant de facturer. Il n'a besoin ni de serveur, ni de base de données, ni de compte : un seul fichier de données, sur l'ordinateur de l'utilisateur. Ce n'est ni un logiciel de facturation certifié ni un dossier patient. Le projet ne promet aucune conformité réglementaire ni aucune durée de conservation.

### 5.4 Alternatives

```markdown
## Alternatives

suivi-facturation fait peu de choses, volontairement : il suit l'activité d'une personne seule, en local, et ne facture pas. Selon vos besoins, d'autres projets libres peuvent mieux convenir (liste non exhaustive, état au 2026-10-04) :

- **[my-practice](https://github.com/dholbach/my-practice)** (AGPL-3.0) : gestion de cabinet auto-hébergée pour thérapeutes et coachs : séances, factures PDF, notes chiffrées. Demande Docker et PostgreSQL ; interface en allemand et en anglais ; en pré-version.
- **[Physiocab / Kalinka](https://codeberg.org/Allium_SAS/kireht)** (AGPL-3.0) : gestion de cabinet pour kinésithérapeutes francophones, avec planning, bilans et facturation. Demande un serveur et PostgreSQL ; en version bêta.
- **[InvoiceShelf](https://github.com/InvoiceShelf/InvoiceShelf)** (AGPL-3.0) et **[Dolibarr](https://github.com/Dolibarr/dolibarr)** (GPL-3.0) : si vous avez besoin de produire de vraies factures ou une comptabilité. Auto-hébergés.
- **[Kimai](https://github.com/kimai/kimai)** et **[solidtime](https://github.com/solidtime-io/solidtime)** (AGPL-3.0) : suivi de temps avec facturation, pour des activités facturées à l'heure.
- **[Actual Budget](https://github.com/actualbudget/actual)** (MIT) et **[Firefly III](https://github.com/firefly-iii/firefly-iii)** (AGPL-3.0) : suivi de budget personnel.

Pour un dossier patient complet, regardez aussi [OpenEMR](https://github.com/openemr/openemr) ou [GNUmed](https://www.gnumed.de/documentation/). Ces projets n'ont pas été testés par les auteurs de suivi-facturation ; vérifiez leur licence, leur maintenance et leur conformité à vos obligations avant tout usage.
```

### 5.5 Risques et limites du projet
- **Maintenance par une personne** et usage par un seul praticien : les projets comparables sont eux aussi petits (0 à 7 étoiles pour les plus proches), signe d'un domaine peu couvert mais aussi d'une faible mutualisation.
- **Données de santé** : fichier JSON, sauvegardes et exports **en clair** sur le disque ; la protection repose sur le chiffrement du disque et du cloud. Les copies de sauvegarde se multiplient dans le dossier synchronisé. Pas de journal d'accès ni de chiffrement des notes (fonctions que proposent Physiocab et my-practice) : le projet n'a ni notes ni accès multiple.
- **Cloud et HDS** : voir la zone floue du §4. Le projet n'affirme pas que l'usage d'un cloud donné (Proton Drive, par exemple) est conforme.
- **Pas une facturation certifiée** : aucune numérotation légale de factures, aucun livre de recettes garanti conforme. L'outil ne couvre pas les obligations comptables.
- **Prévisions** : une moyenne simple, présentée comme « estimation indicative », pas comme une prévision fiable.
- **Windows d'abord** : le lanceur silencieux est vérifié sous Windows seulement ; Linux et macOS sont décrits comme non vérifiés dans la documentation.
- **Licence MIT** : elle exclut toute garantie ; l'utilisateur reste responsable de ses sauvegardes. Elle permet aussi la reprise du code dans un produit fermé, alors que les projets de santé proches choisissent plutôt l'AGPL.

### 5.6 Ce qui n'a pas pu être vérifié
- Les pages officielles de l'ANS (HDS) n'ont pas pu être lues avec l'outil utilisé ; l'article L1111-8 et le champ d'application HDS sont connus par des extraits et par une note ministérielle copiée sur un site tiers, résumée automatiquement.
- La durée de conservation du dossier patient en libéral : valeur de 20 ans lue dans des sources secondaires, contredite par une extraction automatique d'un PDF de la CNIL ; **à lire dans le référentiel original**.
- Les licences et piles exactes de Paheko, GNU Health, GNUmed, OpenMRS et Akaunting ; les fonctions de paiement partiel d'InvoiceShelf, de my-practice et de Physiocab ; la présence réelle de dépôts publics pour Ytems, GnuCash/OpenConcerto en tant que solutions de livre de recettes, et de Logr.
- Le dépôt Codeberg de Physiocab a été lu par son résumé de page et son API (la page README affichait un avertissement anti-robots sans contenu exploitable).
- Les prix des solutions propriétaires proviennent de comparatifs de tiers.
- Tout ce qui est antérieur à 2026 (histoire, anciens projets abandonnés) : non cherché. Les projets archivés ou non indexés par le moteur n'apparaissent pas.
- Les nombres d'étoiles et les dates sont ceux du 2026-10-04 et évoluent.

## 6. Sources

Projets (dépôts et pages officielles)
- my-practice : <https://github.com/dholbach/my-practice> ; <https://api.github.com/repos/dholbach/my-practice> ; <https://github.com/dholbach/my-practice/releases>
- Physiocab : <https://linuxfr.org/news/physiocab-un-logiciel-libre-de-gestion-pour-kinesitherapeutes> ; <https://codeberg.org/Allium_SAS/kireht> ; <https://codeberg.org/api/v1/repos/Allium_SAS/kireht>
- TimeVic : <https://github.com/TimeVic/Main>
- Easy!Appointments : <https://github.com/alextselegidis/easyappointments> ; <https://api.github.com/repos/alextselegidis/easyappointments/releases/latest>
- InvoiceShelf : <https://github.com/InvoiceShelf/InvoiceShelf> ; <https://api.github.com/repos/InvoiceShelf/InvoiceShelf/releases/latest>
- Invoice Ninja : <https://github.com/invoiceninja/invoiceninja> ; <https://api.github.com/repos/invoiceninja/invoiceninja>
- Dolibarr : <https://github.com/Dolibarr/dolibarr> ; <https://api.github.com/repos/Dolibarr/dolibarr/releases/latest>
- Kimai : <https://github.com/kimai/kimai> ; <https://api.github.com/repos/kimai/kimai/releases/latest>
- solidtime : <https://api.github.com/repos/solidtime-io/solidtime>
- Bigcapital : <https://api.github.com/repos/bigcapitalhq/bigcapital>
- Akaunting : <https://api.github.com/repos/akaunting/akaunting>
- Firefly III : <https://api.github.com/repos/firefly-iii/firefly-iii>
- Actual Budget : <https://api.github.com/repos/actualbudget/actual>
- Paheko : <https://paheko.cloud/>
- OpenEMR : <https://api.github.com/repos/openemr/openemr>
- GNUmed : <https://www.gnumed.de/documentation/>
- GNU Health : <https://www.gnuhealth.org/>
- OpenMRS : <https://api.github.com/repos/openmrs/openmrs-core>
- Open Dentist : <https://github.com/clawnify/open-dentist>
- Psychologist Center : <https://github.com/arthursvpb/psychologist-center>
- Ytems, GnuCash, OpenConcerto (extraits) : <https://copeps.fr/actualites/open-source-comptabilite-bnc/> ; <https://linuxfr.org/forums/general-cherche-logiciel/posts/logiciel-de-comptabilite-pour-micro-entreprise-bnc-liberal>

Solutions propriétaires et contexte
- <https://www.indy.fr/guide/logiciel-kine-comparatif/>
- <https://www.l-expert-comptable.com/a/logiciel-comptable-ergotherapeute-liberal.html>

Sources officielles et réglementaires
- CNIL, trois référentiels santé (2020) : <https://www.cnil.fr/fr/la-cnil-publie-trois-referentiels-pour-le-secteur-de-la-sante>
- CNIL, durées de conservation : <https://www.cnil.fr/fr/les-durees-de-conservation-des-donnees>
- CNIL, référentiel « traitements dans le domaine de la santé hors recherches » : <https://www.cnil.fr/sites/cnil/files/atoms/files/referentiel_-_traitements_dans_le_domaine_de_la_sante_hors_recherches.pdf>
- CNIL, référentiel cabinets médicaux et paramédicaux (copie du Conseil national de l'Ordre des médecins, non lue : délai dépassé) : <https://www.conseil-national.medecin.fr/sites/default/files/cnil_referentiel_cabinets_med.pdf>
- ANS, hébergement des données de santé : <https://esante.gouv.fr/labels-certifications/hebergement-des-donnees-de-sante> ; FAQ champ d'application : <https://esante.gouv.fr/faq/quel-est-le-champ-dapplication-de-la-legislation-relative-lhebergement-de-donnees-de-sante-caractere-personnel> (pages non lisibles avec l'outil de lecture utilisé)
- Ministère de la Santé, note sur le champ d'application de l'hébergement (copie APHP) : <https://affairesjuridiques.aphp.fr/textes/note-explicitation-du-champ-dapplication-du-cadre-juridique-de-lhebergement-de-donnees-de-sante-ministere-de-la-sante-represente-par-la-delegation-la-strategie-des-s/telecharger/629195>
- Livre des recettes, modèle officiel : <https://www.service-public.fr/professionnels-entreprises/vosdroits/R18563> (non ouvert)
- Proton Drive : <https://proton.me/drive>
- Articles de conseil sur le micro-BNC (extraits) : <https://www.lecoindesentrepreneurs.fr/comptabilite-des-bnc-micro-bnc-et-declaration-controlee/> ; <https://www.justice.fr/fiche/obligations-comptables-micro-entrepreneur>

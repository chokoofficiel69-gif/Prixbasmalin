# Prix Malin — audit de préparation à la cession (6 mois)

**Date :** 3 novembre 2026  
**Branche auditée :** `main`  
**Commit observé :** `f8e52e9a6bc5c31987ffb07c0b1dd341d550c1e7`  
**Périmètre :** dépôt GitHub, fichiers de données, workflows et pages HTML du site.  
**Important :** cet audit technique ne remplace pas une mesure réelle de trafic, une revue juridique, une vérification commerciale des annonceurs ou des tests sur appareils physiques.

## 1. Conclusion exécutive

Prix Malin possède déjà une base technique exploitable : domaine personnalisé, hébergement GitHub Pages, catalogue de découverte, pages thématiques, collecte d'historique, contrôle de déploiement et automatisations GitHub Actions.

En revanche, **le dépôt ne prouve pas encore qu'il existe un comparateur de prix actif et rentable**. Le blocage principal est l'absence de flux marchand autorisé et de partenariats acceptés. Il faut distinguer clairement :
- une fiche de découverte (un produit qu'un visiteur peut rechercher chez un marchand) ;
- une offre vérifiée (prix, variante, vendeur, livraison, disponibilité, URL et date de collecte confirmés) ;
- une comparaison (au moins deux offres récentes portant sur la même identité produit).

Aucune de ces catégories ne doit être présentée comme une autre. C'est essentiel pour convaincre les visiteurs, les annonceurs et un acheteur potentiel.

**Avis au 3 novembre :** actif numérique en phase de construction, pas encore prêt à être vendu comme entreprise rentable. Le jalon réaliste des six prochains mois est de construire des preuves de fonctionnement, de trafic, de revenus et de procédures transférables. La vente elle-même dépendra des résultats et du marché.

## 2. État technique vérifié dans le dépôt

| Élément | Constat vérifié | Conséquence |
|---|---|---|
| Domaine et hébergement | `prixbasmalin.fr`, GitHub Pages activé, CNAME présent | Bonne base de publication |
| Dernier déploiement contrôlé | Build Pages et contrôle de production réussis sur le commit audité | Le site répond aux contrôles automatisés existants |
| Contrôles de production | Accueil, catalogue, historique, flux JSON, Worker d'attribution | Contrôles de disponibilité utiles, mais pas de test visuel complet |
| Catalogue | 341 fiches dans `catalogue.html` | Le volume de fiches ne prouve pas l'existence d'offres |
| Images catalogue | 316 des 341 fiches intégrées utilisent une image Unsplash générique | Priorité élevée : remplacer par des images produit autorisées, exactes et cohérentes |
| Prix vérifiés | `data/prices.json` contient 0 produit et 0 offre | Le moteur de comparaison n'a pas de flux de prix actif |
| Offres normalisées | `data/merchant-offers.json` contient 0 offre | Aucun comparatif marchand exploitable dans ce flux |
| Configuration de collecte | `price-engine/products.json` contient 0 produit suivi | La collecte classique n'a pas de catalogue de suivi actif |
| Flux Awin | `data/awin-products.json` contient 0 produit et indique qu'il attend le premier flux autorisé | Dépend d'un accès valide et d'annonceurs accessibles |
| Historique PrixTracker | Fichiers d'historique présents et utilisés par les contrôles | À présenter comme historique/référence, pas comme prix en direct |
| Sélections manuelles | `data/featured-prices.json` contient 3 observations du 25 octobre 2026 | Ces observations sont anciennes au 3 novembre ; elles ne doivent pas être présentées comme des prix actuels sans nouveau contrôle |
| SEO technique | `robots.txt` référence `sitemap.xml` ; 13 URL y sont listées | Fondations présentes |
| Métadonnées | Les pages thématiques contrôlées ont des titres, descriptions et URL canoniques | Bonne base, à compléter sur les pages utilitaires |
| Page d'accueil | Aucun élément `<h1>` trouvé dans `index.html` ; données structurées de type `WebSite` seulement | À corriger sans dénaturer la bannière |
| Taille catalogue | Le HTML de catalogue fait environ 337 Ko, avec un gros tableau de produits intégré | À découpler progressivement pour faciliter maintenance et chargement |
| Légalité/confiance | Une page confidentialité existe ; aucune page `mentions-legales.html` n'existe sur `main` au moment de l'audit | Dossier légal public incomplet |
| README | Le README actuel ne contient qu'un titre et une courte description | Documentation de reprise insuffisante |

### Sources de données et partenaires

Le fichier `data/partners.json` contient 7 demandes enregistrées comme envoyées et toutes en attente de confirmation. Le propriétaire indique séparément avoir envoyé 10 demandes, sans acceptation à ce jour, dont 2 ont été examinées et refusées avec des remarques sur l'état opérationnel et la visibilité du site. Il faut réconcilier ce registre interne avec les 10 demandes réelles ; ne jamais annoncer un partenariat sans preuve d'acceptation.

Au dernier contrôle Awin, le workflow s'exécutait sans détruire le cache existant, mais le jeton Publisher renvoyait HTTP 401 et la clé de flux produits distincte n'était pas configurée. Le workflow peut donc finir avec succès technique tout en n'important aucun produit : **succès de workflow ne veut pas dire succès commercial ni catalogue rempli**.

## 3. Risques à traiter en priorité

### P0 — Exactitude des prix et des produits
1. Obtenir au moins un flux ou accès marchand officiellement autorisé.
2. Confirmer l'identité exacte des produits (GTIN/EAN en priorité, sinon ASIN ou MPN + marque).
3. Enregistrer le prix, la devise, les frais de livraison, la disponibilité, la variante, le marchand, l'URL exacte et l'heure réelle de collecte.
4. Écarter automatiquement les offres trop anciennes, incomplètes, redirigées vers une mauvaise fiche ou sans correspondance exacte.
5. Tant que ces conditions ne sont pas remplies, nommer le bloc comme « produits à découvrir » ou « prix à vérifier », jamais « meilleur prix garanti ».

### P0 — Partenariats
1. Maintenir une liste privée des 10 demandes avec date, programme, statut exact et motif de refus/réponse.
2. Corriger les raisons invoquées par les deux annonceurs : opérationnalité du parcours, qualité du catalogue, visibilité, transparence éditoriale et pages de confiance.
3. Ne pas renvoyer massivement de candidatures avant d'avoir au moins un parcours de comparaison crédible et des preuves d'audience.
4. Pour chaque annonceur, vérifier les conditions d'utilisation des images, logos, prix et flux.

### P0 — Confiance et informations légales
1. Compléter les mentions légales avec les informations exactes de l'éditeur, l'hébergeur et le contact, après validation par le propriétaire.
2. Compléter la confidentialité avec les finalités, prestataires, durées, droits, contact et description réelle des traitements.
3. Vérifier le paramétrage de consentement pour chaque script d'audience/publicité, et la conformité des cookies publicitaires.
4. Identifier clairement les liens affiliés et la nature éditoriale ou commerciale des contenus.
5. Ne publier aucune adresse ou donnée personnelle dans un changement automatisé sans confirmation expresse.

### P1 — Référencement et visibilité
1. Ajouter un vrai titre H1 sémantique à la page d'accueil sans modifier le visuel principal.
2. Consolider les pages thématiques avec des contenus utiles, originaux, comparatifs ou explicatifs, pas uniquement des liens de recherche.
3. Relier les pages avec des liens HTML `<a href>` clairs ; ne pas compter uniquement sur une recherche exécutée en JavaScript.
4. Contrôler l'indexation, les erreurs et les requêtes dans Google Search Console.
5. Ne pas utiliser de données structurées `Product/Offer` pour faire croire que Prix Malin vend le produit lui-même ou propose un prix actuel lorsque la page ne fait que rediriger vers un marchand. Vérifier les règles Google page par page avant ajout.

### P1 — Expérience et performance
1. Réduire la duplication CSS et JS au fil des corrections, sans refonte visuelle non demandée.
2. Extraire progressivement le tableau de produits du gros HTML vers un JSON versionné, avec fallback et tests.
3. Charger les images avec tailles et formats adaptés, lazy-loading hors écran et textes alternatifs précis.
4. Tester la recherche, filtres, menus, favoris, alertes, liens marchands et bandeau cookies sur petit Android, grand Android, iPhone/Safari et ordinateur.
5. Les smoke tests actuels ne sont pas des captures visuelles multi-appareils : conserver une vérification réelle avant toute validation visuelle.

## 4. Correction technique apportée dans cette branche d'audit

Les pages `partenaires.html` et `publicite.html` contenaient chacune un chargement direct du beacon Cloudflare Web Analytics dans le HTML, alors que ces pages chargent aussi `js/cookie-consent.js`. Le script de consentement charge déjà le beacon lorsque la mesure d'audience est acceptée.

Dans cette branche, les insertions directes sont supprimées afin d'éviter un chargement redondant et prématuré avant le choix du visiteur. Le chargement conditionnel centralisé reste en place. Ce changement ne prouve pas à lui seul la conformité globale : les scripts publicitaires, le paramétrage Google et les pratiques réelles côté serveur doivent encore être audités.

Aucun logo, couleur, parcours de navigation, prix ou source produit n'a été modifié dans cette branche.

## 5. Plan de travail sur six mois

### Mois 1 — Assainir et rendre vérifiable
- Finaliser les pages légales et les informations de contact (avec validation du propriétaire).
- Corriger les incohérences du catalogue et séparer découverte / offres / comparaisons.
- Obtenir un premier flux marchand autorisé ou documenter précisément la dépendance qui bloque.
- Corriger les prix manuels devenus anciens et les libellés ambigus.
- Installer/valider Search Console et une mesure d'audience consentie.
- Construire une fiche de tests manuels ordinateur / Android / iPhone.

**Jalon :** aucun prix ancien présenté comme une offre actuelle ; toutes les pages publiques de confiance sont accessibles ; un flux autorisé fonctionne ou le blocage est formellement identifié.

### Mois 2 — Prouver le comparateur
- Importer un premier lot réduit mais de qualité.
- Comparer au moins deux vendeurs pour les mêmes références exactes.
- Ajouter date de vérification et coût total livré quand il est connu.
- Publier des pages détaillées réellement utiles sur les références les plus recherchées.
- Recontacter les programmes adaptés seulement après correction de leurs retours.

**Jalon :** premières comparaisons réelles, reproductibles et traçables.

### Mois 3 — Acquérir du trafic qualifié
- Publier des guides originaux et répondre aux requêtes précises.
- Construire une présence sociale régulière avec suivi UTM.
- Proposer des collaborations éditoriales transparentes à des blogs et communautés pertinents.
- Mesurer les clics marchands, la conversion affiliée et les pages qui apportent de la valeur.

**Jalon :** premières sources d'acquisition documentées et trafic qualifié mesurable.

### Mois 4 — Monétiser et fidéliser
- Améliorer les liens affiliés autorisés et leur attribution.
- Tester favoris et alertes de baisse si les données de prix sont assez fiables.
- Mesurer revenu par clic, taux de clic marchand et revenu par visiteur.
- Arrêter les pages qui n'apportent ni utilité ni trafic.

**Jalon :** revenus vérifiables et tableau de bord mensuel.

### Mois 5 — Rendre l'exploitation transférable
- Documenter les tâches automatiques, les secrets nécessaires (sans les valeurs), les fournisseurs et les dépendances.
- Écrire une procédure de reprise technique.
- Mesurer le temps de travail hebdomadaire nécessaire au fonctionnement.
- Documenter les risques d'approvisionnement, les contrats, les règles d'affiliation et la propriété des visuels.
- Préparer l'architecture commune du futur site et de l'application native, sans détourner les ressources du comparateur.

**Jalon :** une autre personne peut comprendre comment exploiter et maintenir le site.

### Mois 6 — Évaluer la cession
- Calculer les revenus, charges et bénéfices nets mensuels.
- Préparer les preuves de trafic, de revenus, de dépenses, de propriété et d'accès.
- Estimer une valeur réaliste selon les résultats, dépendances et risques.
- Décider : conserver, améliorer, vendre ou céder seulement une partie des actifs.

**Jalon :** dossier d'information acheteur prêt, même si la décision raisonnable est de poursuivre l'exploitation plutôt que vendre immédiatement.

## 6. Indicateurs mensuels à suivre

| KPI | Définition | Preuve |
|---|---|---|
| Visiteurs organiques | Utilisateurs venant des moteurs de recherche | Google Search Console / Analytics consenti |
| Visiteurs totaux | Visiteurs et sessions selon une définition stable | Outil d'audience |
| Pages indexées | Pages reconnues et indexées | Search Console |
| Produits validés | Références avec identité exacte et contenu image autorisé | Catalogue validé |
| Offres fraîches | Offres avec prix, marchand, disponibilité et date admissibles | Flux de données |
| Comparaisons actives | Produits ayant au moins deux offres valides | Rapport moteur |
| Clics marchands | Clics sortants attribués | Worker / rapport affilié |
| Revenus | Commissions effectivement confirmées, non simples estimations | Réseaux / relevés |
| Bénéfice net | Revenus encaissés moins charges liées au site | Tableau financier |
| Temps d'exploitation | Heures de travail hebdomadaires | Journal de suivi |
| Partenariats actifs | Programmes explicitement acceptés et utilisables | Interface réseau / contrat |

## 7. Seuils de vente : repères, pas promesses

- DotMarket indique dans son formulaire de pré-vente qu'un site sous **400 € de bénéfice mensuel** et sous **3 000 visiteurs mensuels** ne peut pas être listé sur sa marketplace. La plateforme demande des preuves de trafic, de revenus et de charges.
- Flippa distingue les actifs sans revenus vérifiés, les projets/concepts et les entreprises qui génèrent des revenus. Les plafonds et justificatifs varient selon la catégorie. Un actif sans revenus vérifiés est plafonné à 9 999 USD en prix demandé/réserve dans sa politique de listing.
- Flippa indique également qu'une entreprise avec historique de revenus régulier et données cohérentes est bien plus facilement évaluée qu'un projet nouvellement lancé.

Ces seuils sont des règles de plateformes consultées au 3 novembre 2026, pas une estimation de la valeur actuelle de Prix Malin. Une vente à six mois peut être trop tôt pour une valorisation fondée sur une longue série financière ; il faut conserver une option de prolonger le développement si les preuves sont encore insuffisantes.

## 8. Conditions avant d'affirmer que Prix Malin est prêt à vendre

- [ ] Partenariat(s) accepté(s), contrat(s) et droits d'utilisation des flux documentés.
- [ ] Comparaisons réelles avec au moins deux offres valides sur un lot de produits.
- [ ] Politique de fraîcheur appliquée et offres périmées clairement retirées/étiquetées.
- [ ] Images et contenus utilisés avec droits établis.
- [ ] Mentions légales, confidentialité, cookies et affiliation relus.
- [ ] Données de trafic disponibles sur plusieurs mois.
- [ ] Revenus, charges et bénéfice vérifiables.
- [ ] Aucun secret dans le dépôt Git ou dans le navigateur.
- [ ] Procédure de transfert du domaine, du code, des services et des données documentée.
- [ ] Parcours testé sur ordinateur, Android et iPhone/Safari.
- [ ] Documentation technique et commerciale à jour.

## 9. Liens de contrôle

- Site : https://prixbasmalin.fr/
- Dépôt : https://github.com/chokoofficiel69-gif/Prixbasmalin
- Actions : https://github.com/chokoofficiel69-gif/Prixbasmalin/actions
- Catalogue : https://prixbasmalin.fr/catalogue.html
- Sitemap : https://prixbasmalin.fr/sitemap.xml
- Google Search Central : https://developers.google.com/search/docs
- DotMarket — critères de prévente : https://app.dotmarket.eu/formulaire-vente
- Flippa — règles de prix : https://support.flippa.com/hc/en-us/articles/12856932906767-Listing-sale-pricing

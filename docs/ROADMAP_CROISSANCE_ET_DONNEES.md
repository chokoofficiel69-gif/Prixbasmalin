# Feuille de route — données, partenaires et acquisition

État vérifié le 21 octobre 2026 depuis le dépôt public Prixbasmalin.

## État actuel observé

- Le site est une application HTML/CSS/JavaScript statique publiée via GitHub Pages.
- La page d'accueil présente un catalogue prédéfini et une recherche locale dans ce catalogue.
- Les fiches renvoient principalement vers des recherches Amazon ; elles n'affichent pas de prix marchands vérifiés en direct.
- Le tri actuel est par nom, pas par prix.
- Le code indique lui-même que les flux de prix ne sont pas encore connectés.
- Les pages catalogue, grossistes et partenaires existent déjà : ne pas repartir de zéro.

## Objectif MVP

Permettre à un visiteur de rechercher un produit, voir des offres réelles datées, comparer prix + livraison + état du produit, puis cliquer vers le marchand avec un lien correctement attribué quand un programme d'affiliation l'autorise.

Ne jamais inventer un prix, une disponibilité, une économie ou un classement « moins cher ». Afficher la date/heure de mise à jour et signaler les offres expirées ou indisponibles.

## Priorités techniques

1. **Données réelles avant embellissements** : identifier une source qui autorise explicitement l'affichage des offres et les usages commerciaux.
2. **Prototype limité à une catégorie** (high-tech en premier) et à un petit nombre de marchands ; vérifier la qualité avant d'élargir.
3. **Normalisation** : titre, marque, modèle/EAN si disponible, prix, frais de livraison, état, marchand, URL, date de mise à jour et source.
4. **Tri fiable** : prix total livré uniquement quand tous les champs nécessaires sont connus ; sinon distinguer « prix affiché » et « livraison à confirmer ».
5. **Monétisation transparente** : lien affilié uniquement après acceptation au programme correspondant ; mention claire de l'affiliation.
6. **Mesure** : événements de recherche, zéro résultat, clic marchand et clic affilié, sans collecter inutilement de données personnelles.
7. **Mobile, accessibilité, SEO** : garder la simplicité mobile ; tester clavier, lecteur d'écran, liens, performance et pages indexables.

## Pistes de partenaires à valider (aucun partenariat n'est encore acquis)

- **eBay Partner Network** : son inscription affiliée est annoncée comme gratuite. Les flux de données/API de catalogue peuvent toutefois exiger un compte développeur, une demande et une approbation. Démarrer par l'affiliation autorisée, puis demander l'accès aux données adaptées au comparateur.
- **Awin** : réseau à étudier pour obtenir des flux produits marchands et liens profonds. Les pages publiques annoncent une inscription éditeur gratuite, mais la FAQ mentionne un dépôt de garantie à l'inscription. Ne pas l'utiliser comme solution « 0 € » avant d'avoir confirmé par écrit le coût exact applicable au compte.
- **Amazon Partenaires** : liens de recherche simples déjà présents dans le site, mais ils ne constituent pas un comparateur de prix. Vérifier les conditions du programme et les critères d'accès à toute API/flux avant d'afficher des prix ou des données produit.
- **Marchands indépendants** : contacter directement des boutiques françaises et grossistes pour demander un flux CSV/XML public ou une autorisation écrite d'afficher leurs offres. Aucun coût ni accès n'est présumé.

## Règles d'intégration

- Pas de scraping de pages marchandes sans autorisation.
- Pas de clés API dans le JavaScript public du navigateur ; si une clé secrète est nécessaire, utiliser un service côté serveur avec une offre gratuite vérifiée et des limites d'usage.
- Ne pas dépendre d'un service payant ni activer d'abonnement.
- Ne pas publier de fausses économies, d'avis fictifs ou de promesses de « meilleur prix garanti ».
- Ne pas déployer une nouvelle source de prix tant que les conditions d'utilisation et la fraîcheur des données ne sont pas vérifiées.

## Recrutement bénévole

Le dépôt public peut solliciter des retours et contributions ponctuelles, sans promettre de rémunération. Les demandes doivent être limitées et concrètes :
- revue du code et des liens cassés ;
- aide à une première intégration de flux autorisé ;
- tests mobiles/accessibilité ;
- conseils sur la normalisation de catalogue et les données produit.

Un contributeur bénévole n'est pas un partenaire acquis : attendre une réponse et vérifier toute contribution avant de l'intégrer.

## Mesures de réussite

- taux de recherches donnant au moins une offre vérifiable ;
- taux de clics vers les marchands ;
- part d'offres dont le prix total livré est connu ;
- erreurs de liens / offres expirées ;
- temps de chargement mobile ;
- commissions réellement validées, séparées des clics et des ventes estimées.

## Prochaine action

Obtenir une source de données autorisée pour une seule catégorie, puis construire un petit adaptateur isolé et testable. Garder le site public actuel stable jusqu'à validation du prototype.

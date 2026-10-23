# Diagnostic et branchement des sources marchandes

## État mesuré du catalogue

Le catalogue contient des fiches de recherche/catégorie, pas nécessairement des références de produits uniques. Une fiche comme « écouteurs sans fil » ne suffit pas à comparer un modèle précis entre vendeurs.

Le script `scripts/audit_catalogue_identity.py` mesure le nombre de fiches disposant d'un identifiant exact enregistré dans `data/catalogue-identities.json`. Les identifiants admis sont :
- GTIN/EAN/UPC confirmé par une source fiable ;
- ASIN confirmé pour une fiche Amazon ;
- référence fabricant (MPN) accompagnée de la marque.

Le rapport ne fabrique aucune identité. Les fiches sans identité restent non comparables et ne doivent pas afficher de « meilleur prix ».

## Ordre d'intégration conseillé

### 1. Flux produit d'un réseau d'affiliation (priorité)

Si le compte éditeur est approuvé et qu'un annonceur fournit un flux produit, commencer par ce flux : il peut contenir prix, URL produit, marque, identifiants, disponibilité et lien profond d'affiliation. Awin documente le téléchargement CSV et l'outil Create-a-Feed :
- [Awin — accès aux flux produit](https://success.awin.com/articles/fr/Knowledge/How-can-I-access-a-Product-Feed)
- [Awin — guide des flux produit](https://help.awin.com/developers/docs/product-feed-publisher-guide-intro)

Le flux ne doit être téléchargé que via l'accès officiel du compte autorisé. La clé/API URL ne doit jamais être commise dans le dépôt public. À réception d'un export, on peut créer un adaptateur CSV qui transforme les colonnes confirmées en `data/merchant-offers.json`.

### 2. Amazon Creators API

La documentation officielle exige un compte Amazon Associates accepté et l'accès API autorisé ; la documentation indique également des critères d'éligibilité liés aux ventes qualifiées. Il faut donc confirmer l'accès dans Associates Central avant de développer la connexion en production :
- [Amazon Creators API — onboarding](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding)
- [Amazon — inscription à Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api)

Les clés doivent être conservées comme secrets de déploiement, jamais dans le code ou les fichiers JSON suivis par Git.

### 3. eBay

La Browse API permet notamment la recherche par GTIN, mais l'accès en production et l'usage affilié dépendent des règles et autorisations applicables au compte et à l'API choisie :
- [eBay Browse API](https://developer.ebay.com/develop/api/buy/browse_api)
- [eBay — exigences des Buy APIs](https://developer.ebay.com/api-docs/buy/buy-requirements.html)

Ne pas considérer l'accès sandbox comme une autorisation de publier des prix en production.

## Contrat d'entrée du moteur

Les offres normalisées sont écrites dans `data/merchant-offers.json`. Le moteur existant vérifie l'identité exacte, la fraîcheur, les prix et les frais de livraison connus. Il ne scrape pas les boutiques et ne transforme pas une recherche générique en prix vérifié.

Avant d'afficher un prix :
1. l'offre doit provenir d'une source autorisée ;
2. son identifiant doit correspondre à une fiche catalogue précise ;
3. l'identité doit être exacte et compatible avec les autres offres comparées ;
4. le prix et les frais de livraison doivent être connus ;
5. l'horodatage doit être réel et assez récent ;
6. le lien marchand ou affilié doit provenir de la source autorisée.

## Prochaine étape technique

Obtenir un premier export réel depuis un programme marchand autorisé, repérer les colonnes disponibles (GTIN/ASIN/MPN, prix, livraison, disponibilité, URL, date de mise à jour), puis développer et tester un adaptateur spécifique à ce format. Tant que cet export ou des identifiants exacts confirmés ne sont pas disponibles, le nombre d'offres vérifiées doit rester à zéro plutôt que d'inventer des prix.

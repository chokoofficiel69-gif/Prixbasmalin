# Prix Malin — audit et plan d'amélioration

Date de l'audit : 2026-10-28  
Branche : `audit/plan-catalogue-prix-seo-2026-10`  
Périmètre : catalogue, alimentation des prix, fiabilité et SEO. Aucun déploiement ni changement de production dans cette étape.

## État constaté

### 1. Catalogue et données de prix
- `catalogue.html` contient 83 fiches dans `productData` et un composant de comparaison des offres vérifiées.
- `price-engine/products.json` ne configure qu'un produit suivi : Apple AirPods 4 USB-C.
- La seule source configurée est une page Fnac, qui répondait HTTP 403 lors du dernier relevé observé.
- `data/prices.json` contient actuellement zéro produit et zéro offre vérifiée.
- `data/merchant-offers.json` et `data/catalogue-identities.json` sont vides.
- Le générateur `scripts/build_prices_feed.py` refuse les offres sans identité exacte commune, source autorisée, prix explicite et frais de livraison connus. Cette règle doit être conservée.
- Le catalogue peut présenter des produits de découverte et des recherches marchands, mais ces éléments ne doivent pas être présentés comme des prix comparés en direct.

### 2. Fiabilité de la collecte
- `price-engine/refresh.mjs` refuse les URLs marchandes non sûres et suit les redirections de manière contrôlée.
- Si toutes les sources échouent, le script conserve le relevé précédent et renvoie une erreur au lieu de fabriquer des prix.
- Le workflow de collecte a échoué sur la source Fnac lors du dernier contrôle disponible, tandis que les tests unitaires ont réussi (20/20).
- Le workflow de flux autorisé valide le flux et produit un artefact pour revue. Sa publication automatique ne doit pas recevoir de données non vérifiées.

### 3. SEO et accessibilité publique
- `robots.txt` autorise l'exploration et référence `https://prixbasmalin.fr/sitemap.xml`.
- `sitemap.xml` répertorie la page d'accueil, le catalogue et plusieurs pages thématiques/guides.
- La page d'accueil et le guide smartphone possèdent déjà une description et une URL canonique. Avant les modifications de cette branche, trois pages du sitemap (high-tech, mode et offres) n'avaient pas de meta description ; sept pages listées dans le sitemap n'avaient pas de lien canonique.
- Les pages thématiques sont pour l'instant surtout des pages de découverte avec des liens de recherche marchande, pas nécessairement des comparaisons de prix vérifiés.

## Changements préparés dans cette branche
- Ajout d'une meta description aux pages `high-tech.html`, `mode.html` et `offres.html`, en formulant leur rôle comme pages de découverte/recherche et sans prétendre afficher des prix vérifiés en direct.
- Ajout d'un lien canonique à `catalogue.html`, `grossistes.html`, `high-tech.html`, `mode.html`, `offres.html`, `partenaires.html` et `publicite.html`.
- Aucun changement de style, logo, couleur, contenu produit ou source de prix n'a été effectué.
- Ces modifications restent dans la branche de revue ; elles n'ont pas été déployées.

## Plan d'exécution proposé

### Étape A — Débloquer les sources autorisées
1. Vérifier la disponibilité du premier lot du catalogue produit Rakuten annoncé par le support.
2. Vérifier les permissions et les annonceurs réellement rejoints/validés avant de traiter un flux.
3. Conserver les identifiants FTP/API exclusivement dans les secrets GitHub Actions ; jamais dans les fichiers versionnés ni dans le navigateur.
4. Importer seulement les données autorisées et normaliser les offres dans `data/merchant-offers.json`.
5. Vérifier GTIN/ASIN/MPN, prix, devise, frais de livraison, URL produit et date réelle de collecte avant publication.
6. Si aucun flux autorisé n'est disponible, ne pas fabriquer de prix : conserver l'état vide/historique et signaler le blocage.

### Étape B — Élargir le catalogue sans créer de fausses offres
1. Auditer le nombre réel de fiches et les doublons de `productData`.
2. Prioriser les catégories déjà présentes et les produits avec identifiants confirmables depuis une source autorisée.
3. Ajouter les produits par petits lots ; chaque fiche doit avoir un identifiant stable et un état clair : découverte, identité confirmée, ou offres vérifiées.
4. Ne jamais déduire un GTIN, ASIN ou MPN du seul nom, d'une photo ou d'une recherche web approximative.
5. Ne pas afficher de prix comme « meilleur prix » tant qu'une offre fraîche et vérifiée n'existe pas.

### Étape C — Fiabiliser la mise à jour
1. Garder les tests actuels et exécuter les tests de flux et de syntaxe après chaque changement.
2. Ajouter des tests de non-régression pour le cas « aucune source disponible » et pour la conservation des données valides précédentes.
3. Vérifier qu'une génération vide ne remplace jamais un flux utile sans diagnostic explicite.
4. Ajouter des contrôles de fraîcheur et un état lisible des offres périmées.
5. Vérifier les workflows GitHub Actions et leurs permissions avant d'activer toute publication.

### Étape D — SEO et expérience mobile
1. Contrôler les titres et descriptions de chaque URL du sitemap.
2. Vérifier les liens canoniques, les balises robots, les titres H1 uniques et les liens internes.
3. Confirmer que les URLs du sitemap répondent correctement et ne pointent pas vers des pages absentes ou redirigées.
4. Vérifier le parcours mobile : recherche, filtres, ouverture des fiches, liens marchands, affichage des prix et mentions de fraîcheur.
5. N'ajouter des données structurées de type Product/Offer que lorsque les prix sont réellement vérifiés ; ne pas baliser une offre fictive.

## Critères de validation avant fusion
- Tests unitaires et vérifications de syntaxe réussis.
- Aucun secret ni identifiant sensible ajouté au dépôt.
- Aucun prix inventé ni source non autorisée.
- Aucun changement involontaire de logo, couleurs ou parcours existant.
- Les offres historiques restent clairement distinguées des offres fraîches.
- Le diff est relu dans une pull request avant toute fusion ; aucun déploiement automatique n'est déclenché depuis cette branche.

## Prochaine action concrète
Dès que le flux produit Rakuten est accessible et qu'au moins un annonceur autorisé fournit des offres utilisables, réaliser un premier import limité, lancer les tests, examiner l'artefact généré puis proposer les changements dans une pull request. En attendant, améliorer les métadonnées SEO et le catalogue doit se faire dans des changements séparés, testables et réversibles.

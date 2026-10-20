# Prixbasmalin — plan du vrai comparateur

## Objectif
Afficher plusieurs offres pour un même produit, provenant de marchands partenaires, et les classer par coût total vérifiable. Ne jamais présenter une suggestion de recherche comme un prix vérifié.

## État actuel
- Site statique hébergé sur GitHub Pages.
- Catalogue de suggestions et liens de recherche affiliés : ce n'est pas encore un flux de prix en direct.
- Les filtres d'interface peuvent être améliorés côté navigateur.
- Un site statique ne doit pas exposer de clé API, de mot de passe de flux ni de jeton partenaire.

## Modèle de données cible
Chaque ligne d'offre importée doit contenir, lorsque le partenaire fournit l'information :
- `source` : réseau ou marchand
- `source_product_id` : identifiant de l'offre chez la source
- `gtin` / `ean`, `brand`, `mpn` : identifiants pour rapprocher les mêmes produits
- `title`, `description`, `category`, `image_url`
- `price`, `currency`, `shipping_price`, `availability`
- `product_url` : lien marchand, avec attribution affiliée si fournie par le réseau
- `last_updated` : date de la dernière actualisation du flux
- `attributes` : attributs propres à la catégorie (taille, couleur, capacité, autonomie, etc.)

## Règles de comparaison
1. Regrouper les offres d'un même produit en priorité avec GTIN/EAN, puis marque + référence fabricant (MPN).
2. Ne pas fusionner des variantes différentes (taille, capacité, couleur ou modèle).
3. Trier par prix total = prix produit + livraison connue.
4. Si la livraison est inconnue, l'indiquer et ne pas prétendre que le prix total est le moins cher.
5. Montrer la source et la date d'actualisation.
6. Ne pas fabriquer de prix, disponibilité, avis ou historique.
7. N'afficher les images et données d'un partenaire que selon sa licence et ses règles.

## Première source envisagée : Awin
Awin documente des flux produits pour les éditeurs contenant notamment liens profonds, noms, descriptions, prix, frais de livraison, images et attributs. L'accès réel dépend des annonceurs et des flux disponibles dans le compte éditeur. Après acceptation, sélectionner les programmes pertinents et vérifier les autorisations de chaque flux.
Documentation : https://success.awin.com/articles/fr/Knowledge/How-can-I-access-a-Product-Feed

## Amazon
Ne pas réutiliser automatiquement les données et images Amazon dans un comparateur multi-marchands. L'API et le contenu Amazon sont soumis à une licence spécifique, à des conditions d'éligibilité et à des restrictions d'utilisation. Vérifier l'autorisation avant toute intégration.
Documentation : https://partenaires.amazon.fr/help/operating/license

## Plan de réalisation
1. Faire accepter le compte éditeur et rejoindre les programmes marchands.
2. Récupérer un premier flux autorisé, idéalement dans une seule catégorie pour commencer.
3. Importer et normaliser les données hors du navigateur, sans exposer les secrets.
4. Alimenter une base de données ou un fichier public généré automatiquement ne contenant que les données autorisées.
5. Construire la page de résultats : offres du même produit, tri par coût total, filtres de catégorie, date de mise à jour.
6. Ajouter les autres catégories et sources après validation des résultats.

## Contraintes de coût
Priorité aux offres gratuites, aux outils déjà disponibles et aux quotas gratuits. Aucun abonnement ou service payant ne doit être activé sans accord explicite.

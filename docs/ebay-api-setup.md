# Intégration eBay Browse API — activation sécurisée

Cette intégration utilise l'API officielle eBay Browse, pas le HTML d'une page marchande. Elle n'est pas activée dans le relevé automatique tant que les secrets et l'accès API ne sont pas configurés et testés.

## Prérequis

1. Créer/ouvrir une application dans le [portail eBay Developers](https://developer.ebay.com/my/keys).
2. Vérifier que Browse API est autorisée pour l'application et l'environnement Production.
3. Ajouter les secrets dans GitHub : dépôt → Settings → Secrets and variables → Actions → New repository secret.
   - `EBAY_CLIENT_ID` : App ID / Client ID de Production.
   - `EBAY_CLIENT_SECRET` : Cert ID / Client Secret de Production.
4. Pour des liens affiliés, s'inscrire à eBay Partner Network puis ajouter la variable `EBAY_AFFILIATE_CAMPAIGN_ID` (10 chiffres) dans Settings → Secrets and variables → Actions → Variables. Sans cette variable, l'API ne garantit pas de lien affilié.

Ne jamais publier le secret dans le code, un fichier JSON, une capture d'écran ou un message.

## Ce que fait le module

- Récupère un jeton OAuth avec le flux client credentials.
- Recherche par GTIN sur la marketplace française.
- Normalise prix et frais de livraison uniquement si la devise EUR est explicite.
- Rejette les prix invalides et les liens non HTTPS.
- Marque la source comme `verified_ebay_api` : cela atteste que les champs viennent de l'API, pas que toutes les annonces correspondent automatiquement à la variante exacte.

## Important : validation de la variante

Les résultats par GTIN doivent encore être contrôlés pour le titre, l'état (neuf/occasion/reconditionné), la variante et la disponibilité. Ne pas fusionner automatiquement toutes les annonces dans le meilleur prix du produit sans ce contrôle. Le module renvoie des candidats normalisés ; il n'est pas encore relié à `data/prices.json`.

## Tests

`node --test price-engine/ebay-api.test.mjs`

Documentation officielle : [Browse API](https://developer.ebay.com/api-docs/buy/static/api-browse.html), [OAuth credentials](https://developer.ebay.com/api-docs/static/oauth-credentials.html).

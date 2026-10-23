# Flux de prix autorisé — Prix Malin

## État actuel

Le flux source `data/merchant-offers.json` est volontairement vide. Aucun prix ne sera créé tant qu'une source autorisée n'aura pas fourni des offres réelles. Le générateur ne fait aucun appel réseau et ne scrape aucune boutique.

## Ajouter une offre

Chaque entrée de `offers` doit contenir :
- `offer_id` : identifiant stable de l'offre
- `catalog_product_id` : identifiant exact du produit dans `catalogue.html`
- `product_name`, `merchant_name`, `source`
- `product_url` : URL produit HTTPS officielle
- `price`, `shipping_price` : nombres en euros, livraison connue (0 si gratuite)
- `currency` : `EUR`
- `checked_at` : heure réelle du relevé, ISO 8601 avec fuseau
- `tracking_url` : facultatif, uniquement si fourni par le programme d'affiliation autorisé

Ne jamais utiliser un prix estimé, un prix promotionnel non vérifié, ni un lien d'affiliation fabriqué. Les relevés âgés de plus de 48 heures, futurs, incomplets ou sans frais de livraison connus sont écartés.

## Génération

Lancer localement :

```sh
python3 scripts/build_prices_feed.py
```

Le workflow GitHub Actions exécute aussi ce générateur lorsqu'un changement est poussé dans le fichier source sur `main), puis met à jour `data/prices.json` si le résultat change. Le workflow ne collecte pas les prix sur Internet et ne tourne pas selon un horaire fixe : il transforme uniquement les données sources fournies.

## Correspondance catalogue

`catalog_product_id` doit être identique à un identifiant de produit du tableau `productData` dans `catalogue.html`. Le générateur extrait les identifiants de `productData` dans `catalogue.html` et rejette toute offre dont `catalog_product_id` ne correspond pas exactement à un identifiant existant. Les offres admissibles qui réutilisent un même `offer_id` sont également rejetées. Les offres ne sont jamais rapprochées automatiquement par nom approximatif afin d'éviter de comparer des variantes différentes.

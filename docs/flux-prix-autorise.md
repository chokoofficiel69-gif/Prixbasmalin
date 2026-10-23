# Flux de prix autorisé — Prix Malin

## État actuel

Le flux source `data/merchant-offers.json` est volontairement vide. Aucun prix ne sera créé tant qu'une source autorisée n'aura pas fourni des offres réelles. Le générateur ne fait aucun appel réseau et ne scrape aucune boutique.

## Ajouter une offre

Chaque entrée de `offers` doit contenir :
- `offer_id` : identifiant stable de l'offre
- `catalog_product_id` : identifiant de fiche dans `catalogue.html`
- `identity_type` et `identity_value` : identité exacte commune à toutes les offres comparées (`gtin`, `asin` ou `mpn`)
- `brand` : obligatoire pour `identity_type: "mpn"`
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

Le workflow GitHub Actions exécute aussi ce générateur lorsqu'un changement est poussé dans le fichier source sur `main`, puis met à jour `data/prices.json` si le résultat change. Le workflow ne collecte pas les prix sur Internet et ne tourne pas selon un horaire fixe : il transforme uniquement les données sources fournies.

## Correspondance catalogue

`catalog_product_id` doit correspondre à un identifiant existant du tableau `productData` dans `catalogue.html`. Le générateur rejette les identifiants inconnus et les `offer_id` dupliqués. Les GTIN sont contrôlés (longueur et clé de contrôle), les ASIN doivent contenir 10 caractères alphanumériques et les MPN exigent une marque. Toutes les offres publiées sous une même fiche catalogue doivent avoir exactement la même identité normalisée. Si deux offres valides d'une fiche ont des identités différentes, toutes les offres de cette fiche sont écartées. Les offres ne sont jamais rapprochées automatiquement par nom approximatif afin d'éviter de comparer des variantes différentes.

## Exemple d'identité exacte

Pour une référence EAN/GTIN :

```json
{
  "identity_type": "gtin",
  "identity_value": "4006381333931"
}
```

Pour une référence fabricant, fournir également la marque :

```json
{
  "identity_type": "mpn",
  "identity_value": "MODEL-123",
  "brand": "Marque fabricant"
}
```

L'exemple GTIN ci-dessus illustre uniquement le format du champ. Il ne constitue pas une offre commerciale ni une correspondance avec un produit du catalogue. Une identité exacte doit être confirmée à partir des données du marchand.

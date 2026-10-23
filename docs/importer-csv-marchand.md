# Préparer un import CSV marchand autorisé

Le script `scripts/import_partner_csv.py` transforme un export CSV fourni par un programme marchand auquel le compte éditeur a accès. Il n'ouvre aucun site marchand, ne fait aucune requête réseau et ne collecte rien automatiquement.

## Modèle de colonnes

Télécharger le fichier vide [`data/merchant-offers-template.csv`](../data/merchant-offers-template.csv) ou utiliser exactement ces en-têtes :

- `offer_id` : identifiant unique de l'offre dans le fichier ;
- `catalog_product_id` : identifiant exact d'une fiche dans `catalogue.html` ;
- `product_name`, `merchant_name`, `source` : noms provenant de la source ;
- `identity_type` : `gtin`, `asin` ou `mpn` ;
- `identity_value` : identifiant exact confirmé par la source ;
- `brand` : obligatoire pour `mpn` ;
- `price`, `shipping_price`, `currency` : prix en EUR et livraison connue (mettre 0 uniquement si la source confirme la livraison gratuite) ;
- `product_url` : URL HTTPS de l'offre ;
- `tracking_url` : facultative, uniquement si fournie par le programme autorisé ;
- `checked_at` : date réelle ISO 8601 avec fuseau, par exemple `2026-10-23T14:00:00+02:00`.

Si une valeur est absente, une URL n'est pas HTTPS, une date est invalide ou une ligne contient une erreur, l'import est interrompu sans produire de JSON partiel. Les prix doivent ensuite être encore validés par le moteur existant, qui écarte notamment les offres âgées de plus de 48 heures et les identités contradictoires.

## Exécution

Depuis la racine du dépôt :

```bash
python3 scripts/import_partner_csv.py export-partenaire.csv --output data/merchant-offers-import-review.json
```

La sortie est volontairement créée dans un fichier de revue séparé : elle ne remplace pas `data/merchant-offers.json` et ne publie rien automatiquement. Vérifier que chaque `catalog_product_id` existe et que les identifiants produit sont exacts avant d'intégrer des offres au flux autorisé.

Ne jamais committer de clé API, mot de passe, cookie, lien de flux privé ou données confidentielles du compte partenaire dans le dépôt public.

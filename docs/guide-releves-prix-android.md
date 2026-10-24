# Saisir un relevé de prix depuis Android

Ce processus n'utilise ni Awin, ni clé API, ni scraping. Saisir uniquement les offres issues d'un flux/export que vous êtes autorisé à utiliser. Ne pas inventer les prix, les frais ou les identifiants.

## 1. Trouver le GTIN / code-barres

1. Sur Android, ouvrez l'application appareil photo ou une application de lecture de code-barres fiable.
2. Scannez le code-barres EAN/UPC sur l'emballage. Le GTIN est le numéro de 8, 12, 13 ou 14 chiffres associé au code-barres.
3. Si le code n'est pas lisible, recopiez les chiffres imprimés sous les barres. Gardez les zéros au début.
4. Ne confondez pas le GTIN avec la référence modèle du fabricant (MPN) ou l'ASIN d'Amazon.
5. Comparez avec le produit exact : variante, taille, couleur et capacité doivent correspondre. Si vous ne pouvez pas confirmer l'identité, ne créez pas de relevé.

## 2. Préparer le relevé

1. Ouvrez le dépôt GitHub Prixbasmalin dans Chrome et connectez-vous.
2. Ouvrez `data/inbox/releves.csv`. Le fichier ne contient que la ligne d'en-tête.
3. Utilisez l'édition du fichier sur GitHub pour ajouter une ligne sous l'en-tête, uniquement lorsque vous avez une offre réellement observée et une source autorisée. Sinon, laissez le fichier avec son seul en-tête.
4. Respectez exactement l'ordre et les noms des colonnes. Utilisez une virgule comme séparateur CSV. Si une valeur contient une virgule, entourez-la de guillemets doubles.
5. N'ajoutez ni mot de passe, ni cookie, ni clé API, ni donnée personnelle.

## 3. Colonnes à remplir

- `offer_id` : identifiant unique que vous créez, par exemple `releve-20261025-001`.
- `catalog_product_id` : identifiant exact d'un produit existant dans `catalogue.html`.
- `product_name` : nom exact de la variante observée.
- `merchant_name` : nom du marchand.
- `source` : nom et référence de la source autorisée (pas une supposition).
- `identity_type` : `gtin`, `asin` ou `mpn`.
- `identity_value` : identifiant exact; pour un GTIN, chiffres uniquement, zéros initiaux conservés.
- `brand` : marque; obligatoire pour une identité `mpn`.
- `price` : prix du produit, montant numérique, par exemple `19.99`.
- `shipping_price` : livraison connue, par exemple `0` si gratuite. Ne pas laisser vide ni deviner.
- `currency` : `EUR`.
- `product_url` : URL HTTPS directe de la fiche produit.
- `tracking_url` : laisser vide sauf si une URL de suivi autorisée est fournie.
- `checked_at` : date/heure réelle du relevé, ISO 8601 avec fuseau horaire.

## 4. Format exact de date et fuseau

Exemple pour la France en heure d'été : `2026-10-25T14:35:00+01:00` (en octobre, vérifiez le décalage réel à la date choisie). En UTC, utilisez par exemple `2026-10-25T13:35:00Z`.

Le format est `AAAA-MM-JJTHH:MM:SS+HH:MM` ou la même heure en UTC terminée par `Z`. Ne mettez pas seulement `25/10/2026`, et n'ajoutez jamais un fuseau au hasard : notez l'heure où le prix a été réellement vérifié.

## 5. Lancer la préparation en brouillon

Un mainteneur lance GitHub → Actions → « Préparer les relevés marchands (brouillon) » → Run workflow, en choisissant impérativement la branche `main`. Le workflow teste, importe et construit le flux sur une branche datée puis ouvre une PR en brouillon. Il ne fusionne pas et ne déploie pas.

Si le CSV ne contient que l'en-tête, le résultat attendu est zéro offre, pas une offre fictive. Lisez le résumé d'exécution et corrigez les erreurs signalées avant toute revue.

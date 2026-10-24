# Relever une offre depuis un téléphone Android

Ce guide sert à saisir manuellement une offre visible sur une source marchande que vous êtes autorisé à utiliser. Aucun scraping, compte partenaire, clé API ou cookie n'est requis. Ne saisissez pas une offre que vous ne pouvez pas vérifier.

## 1. Ouvrir le fichier CSV

1. Ouvrez le dépôt GitHub dans Chrome sur Android : `chokoofficiel69-gif/Prixbasmalin`.
2. Ouvrez `data/inbox/releves.csv`, puis le crayon **Edit**. Vous pouvez aussi télécharger le fichier et l'ouvrir dans Google Sheets.
3. Gardez la première ligne intacte. Ajoutez une offre par ligne, sans supprimer ni renommer les colonnes. Si vous utilisez Sheets, exportez/téléchargez ensuite en **CSV** et conservez le nom `releves.csv`.

## 2. Trouver l'identité exacte du produit

- **GTIN/EAN** : cherchez le code-barres sur l'emballage, sous les barres, généralement 8, 12, 13 ou 14 chiffres. Recopiez tous les chiffres, sans espaces. Pour une fiche en ligne, utilisez uniquement le GTIN affiché explicitement par le fabricant ou le marchand.
- **ASIN** : uniquement pour un article Amazon, repérez le champ « ASIN » dans les détails techniques ou l'URL produit (souvent après `/dp/`). Il fait 10 caractères alphanumériques. Ne le devinez pas.
- **MPN** : référence fabricant, à copier depuis la fiche technique officielle; indiquez aussi `brand`.
- Ne confondez pas le SKU interne du marchand avec un GTIN. Si l'identité n'est pas confirmée, ne soumettez pas cette offre.

## 3. Remplir les colonnes

- `offer_id` : identifiant unique simple, par exemple `marchand-modele-20261025`.
- `catalog_product_id` : identifiant exact déjà présent dans `catalogue.html` (pas le nom affiché).
- `product_name`, `merchant_name` : noms visibles sur la fiche.
- `source` : source autorisée, par exemple `fiche_marchand_publique`.
- `identity_type` : `gtin`, `asin` ou `mpn`; `identity_value` : identifiant exact.
- `brand` : marque (obligatoire pour `mpn`, sinon facultative).
- `price` : prix affiché en euros, nombre seul, par exemple `129,99`.
- `shipping_price` : frais de livraison en euros; mettre `0` uniquement si la livraison est gratuite ou retrait gratuit vérifié. Sinon ne pas inventer.
- `currency` : `EUR`.
- `product_url` : URL HTTPS de la fiche produit.
- `tracking_url` : laisser vide sauf si vous disposez d'un lien de suivi/affiliation explicitement autorisé. Ne jamais ajouter de jeton secret.
- `checked_at` : date et heure réelles du relevé en ISO 8601 **avec fuseau**. Exemple France en été : `2026-10-25T14:30:00+02:00` seulement si ce décalage est correct à cette date; en octobre après le changement d'heure, la France métropolitaine est généralement `+01:00`. Le format UTC `2026-10-25T13:30:00Z` est aussi valide si l'heure correspond à UTC. Ne pas saisir une date approximative.

Dans un CSV, les champs contenant une virgule doivent être entre guillemets selon les règles CSV; plus simple : utiliser un point décimal (`129.99`) ou un tableur qui exporte correctement le CSV. Le script accepte aussi la virgule décimale dans un champ prix.

## 4. Envoyer sans publier automatiquement

1. Vérifiez l'identité, le prix total (prix + livraison), l'URL et l'heure.
2. Enregistrez le fichier sur une branche dédiée, jamais directement sur `main`.
3. Le workflow de préparation exécute les tests, importe le CSV, reconstruit le flux sur une branche de données et ouvre une PR en brouillon. Le brouillon doit être relu; il ne fusionne ni ne déploie rien.

Une fiche produit peut être écartée si le GTIN/ASIN/MPN ne correspond pas exactement entre offres, si le prix ou les frais sont inconnus, ou si le relevé dépasse la fenêtre de fraîcheur configurée.

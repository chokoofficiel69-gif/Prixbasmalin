# Relever une offre depuis un téléphone Android

Ce guide sert à saisir manuellement une offre visible sur une source marchande que vous êtes autorisé à utiliser. Aucun scraping, compte partenaire, clé API ou cookie n'est requis. Ne saisissez pas une offre que vous ne pouvez pas vérifier.

## 1. Ouvrir le fichier CSV

1. Ouvrez le dépôt GitHub dans Chrome sur Android : `chokoofficiel69-gif/Prixbasmalin`.
2. Ouvrez `data/inbox/releves.csv`, puis le crayon **Edit**. Vous pouvez aussi télécharger le fichier et l'ouvrir dans Google Sheets.
3. Gardez la première ligne intacte. Ajoutez une offre par ligne, sans supprimer ni renommer les colonnes. Si vous utilisez Sheets, exportez/téléchargez ensuite en **CSV** et conservez le nom `releves.csv`.

## 1 bis. Choisir comment transmettre le CSV

**Option A — recommandée sur téléphone : modifier le CSV directement sur `main`.** Le propriétaire enregistre `data/inbox/releves.csv` sur `main` depuis GitHub. Ce fichier est un fichier de staging : son commit ne publie aucun prix sur le site. Ensuite, le propriétaire lance manuellement **Actions → Prepare manual price relevés** depuis `main`. Le workflow lit le CSV sur `main`, reconstruit les fichiers de données sur une branche dédiée et ouvre une PR en brouillon; il ne fusionne ni ne déploie.

**Option B — tout faire par PR :** créer une première PR qui modifie le CSV, la faire relire et fusionner; puis lancer le workflow depuis `main` et relire la seconde PR contenant les données générées. C'est plus prudent si chaque modification du CSV doit elle-même être approuvée, mais cela ajoute une étape et retarde le relevé.

Ne lancez pas le workflow avant que le CSV soit présent sur `main` : il fait volontairement un checkout de `main`, pas de la branche de votre PR de staging.

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
- `checked_at` : date et heure réelles du relevé en ISO 8601 **avec fuseau**. Exemple en UTC : `2026-10-25T13:30:00Z`. Le suffixe `Z` signifie UTC; en France métropolitaine, le 25 octobre 2026 après le passage à l'heure d'hiver, 13:30 UTC correspond à 14:30 heure locale (`+01:00`). Saisissez l'heure réelle et convertissez-la correctement en UTC; ne recopiez pas l'exemple si l'heure réelle est différente.

Dans un CSV, les champs contenant une virgule doivent être entre guillemets selon les règles CSV; plus simple : utiliser un point décimal (`129.99`) ou un tableur qui exporte correctement le CSV. Le script accepte aussi la virgule décimale dans un champ prix.

## 4. Envoyer sans publier automatiquement

1. Vérifiez l'identité, le prix total (prix + livraison), l'URL et l'heure.
2. Suivez l'option A recommandée ci-dessus : enregistrez le CSV de staging sur `main`. Ce commit ne modifie pas directement le flux de prix publié.
3. Lancez **Actions → Prepare manual price relevés** depuis `main`. Le workflow importe le CSV et ouvre une PR en brouillon pour les fichiers de données générés; cette seconde PR doit être relue et fusionnée manuellement.
4. **Faites relire puis fusionner la PR de données le jour même du relevé**, si possible : les offres doivent encore être dans la fenêtre de fraîcheur de 48 heures au moment de la reconstruction. Si la PR attend, refaites les relevés et mettez à jour `checked_at` uniquement après une nouvelle vérification réelle du prix.

**Important : le CSV remplace toutes les offres à chaque lancement, il ne s'agit pas d'un ajout cumulatif.** `data/merchant-offers.json` est reconstruit à partir des seules lignes présentes dans `data/inbox/releves.csv`. Gardez donc dans le CSV toutes les offres que vous souhaitez conserver, et pas uniquement la nouvelle offre du jour.

Le flux de prix écarte les relevés de plus de **48 heures**. Si toutes les lignes du CSV sont périmées au moment de la reconstruction, la PR peut aboutir à un flux contenant **zéro prix publié**. C'est préférable à afficher un prix ancien comme s'il était actuel : refaites les vérifications des offres et actualisez `checked_at` uniquement après un contrôle réel, puis relancez la préparation.

Une fiche produit peut être écartée si le GTIN/ASIN/MPN ne correspond pas exactement entre offres, si le prix ou les frais sont inconnus, ou si le relevé dépasse la fenêtre de fraîcheur configurée.

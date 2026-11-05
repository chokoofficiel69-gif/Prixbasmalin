# État des sources partenaires Prix Malin — 05/11/2026

## Awin — flux direct accessible, comparaisons bloquées

Contrôles GitHub Actions du 05/11/2026 :
- Le flux direct a été reçu et parsé : 17 005 lignes lues, 7 488 offres importées, 7 marchands.
- 4 211 offres ont un coût de livraison renseigné.
- Les colonnes marque, GTIN/EAN/UPC et MPN sont absentes du fichier source : aucune comparaison multi-marchand exacte ne peut être construite.
- La vérification de l'API éditeur répond HTTP 200, mais la relation programmes reste à 0 rejoint et 6 en attente. Une demande en attente n'est pas une autorisation.
- Les 7 marchands présents dans le flux ne doivent pas être présentés comme des partenariats approuvés ni comme commissionnables sans contrôle du statut de chaque programme.

Action utile : régénérer le flux direct existant depuis Awin avec les colonnes `brand_name`, `ean`, `upc`, `mpn`, `product_GTIN`, `model_number`, `merchant_product_id`, `merchant_id`, `merchant_name`, `search_price`, `delivery_cost`, `in_stock`, `last_updated` et les champs image. Remplacer ensuite la valeur du secret GitHub existant `AWIN_PRODUCT_DATA_FEED_URL` par le nouveau lien, sans publier le lien ni sa clé.

La documentation Awin indique que la liste de flux peut exposer le statut d'adhésion et les colonnes disponibles ; la clé de téléchargement de cette liste est distincte du jeton API éditeur :
- https://help.awin.com/developers/docs/product-feed-list-download
- https://help.awin.com/developers/docs/hosting-feeds

## Rakuten / Decathlon — fichiers XML fournis et analysés, pas encore publiés

Les deux archives ci-dessous ont été fournies dans les conversations de l'utilisateur et analysées localement. Elles n'ont pas été téléchargées par cet agent depuis le serveur SFTP.

### Decathlon — `44806_4768926_mp.xml.gz`
- 68 636 produits ; le trailer annonce 68 636 : intégrité structurelle cohérente.
- 68 636 prix en EUR.
- 65 352 frais de livraison en EUR ; les autres frais sont absents.
- 68 636 états de disponibilité `in-stock` dans le fichier.
- 68 636 URLs d'image HTTPS et 68 636 liens produits HTTPS LinkSynergy.
- 68 634 lignes ont un UPC avec chiffre de contrôle GTIN valide ; 68 614 GTIN uniques.
- Trois images Decathlon échantillonnées ont été ouvertes et correspondent aux produits. Cela ne constitue pas une vérification exhaustive des 68 636 images.
- En-tête `createdOn` : `05/11/2026 0:13:11`.

### Nicchia Luxury — `54306_4768926_1_cmp.xml.gz`
- 6 036 produits ; 6 036 prix en EUR, frais de livraison EUR et états `in-stock`.
- 6 036 URLs image HTTPS et 6 036 liens produits HTTPS LinkSynergy.
- 5 498 lignes ont un UPC avec chiffre de contrôle GTIN valide ; 6 035 références fabricant `part_number`.
- Le fichier ne contient pas de trailer : le nombre de produits annoncé ne peut pas être contrôlé. Il s'agit d'un fichier de catégorie, pas d'un flux complet validé ; il n'est pas publié.
- Aucun GTIN valide n'est commun entre les deux fichiers : zéro comparaison exacte Decathlon/Nicchia.

### Blocages avant publication automatique
1. La documentation technique Rakuten décrit par défaut le format de date `MM/DD/YYYY`, mais ce format peut être modifié dans le compte. `05/11/2026` signifie donc le 11 mai 2026 avec le format par défaut (flux périmé de plus de 48 h), ou le 5 novembre 2026 en `DD/MM/YYYY`. Le paramètre du compte n'est pas confirmé ; aucun import ne doit choisir arbitrairement.
2. Le message support confirme l'activation du compte AFTP et l'envoi des identifiants, mais ne fournit pas d'empreinte de clé hôte SSH. Aucune connexion SFTP n'a été tentée. Le workflow doit vérifier la clé hôte avant tout téléchargement.
3. La documentation XML décrit le prix retail et la livraison, mais ne confirme pas que le prix est TTC. Le site ne doit pas étiqueter ces montants TTC tant que le traitement de TVA n'est pas confirmé.
4. Le fichier Nicchia fourni n'est pas complet et ne doit pas remplacer un snapshot valide.

Le workflow d'import a été durci pour ignorer les sources absentes, ambiguës, périmées ou sans trailer cohérent ; il ne doit pas écraser le dernier snapshot valide en cas d'échec. Il attend une clé hôte SFTP vérifiée (`RAKUTEN_SFTP_KNOWN_HOSTS`) et le format de date explicite (`RAKUTEN_DATE_FORMAT`). Les identifiants restent des secrets GitHub et ne sont jamais affichés. Le statut TVA reste `unspecified` par défaut ; les comparaisons Rakuten ne sont activées que si le statut est confirmé comme inclus.

Documentation Rakuten :
- https://pubhelp.rakutenadvertising.com/hc/en-us/articles/360014647652-Product-Catalog-Technical-Specifications

## Autres sources et données

- PrixTracker : 12 434 observations historiques, 86 produits, 63 marchands au dernier cycle vérifié. Ces données sont historiques ; elles ne sont pas utilisées comme prix actuels.
- `data/prices.json`, `data/merchant-offers.json` et `data/catalogue-identities.json` ne contiennent actuellement aucune offre vérifiée publiable.
- Le Worker d'attribution et la base D1 Prix Malin servent au suivi des clics/attributions, pas à l'import des prix. Aucun binding de flux Awin/Rakuten n'a été trouvé dans les Workers Prix Malin.
- Le projet Supabase accessible dans le connecteur ne contient pas de tables de prix Prix Malin ; aucune modification n'y a été faite.
- L'adaptateur eBay du PR #25 n'est pas fusionné et ne dispose pas d'une connexion/clé vérifiée : il n'est pas une source active.
- Aucun prix historique, lien de recherche Amazon ou simple URL image n'est compté comme offre actuelle vérifiée.

## État public et interface

- Le catalogue public n'a pas de fichier `data/rakuten-products.json` validé ; aucune offre Rakuten n'est donc encore visible publiquement.
- Le chargeur Rakuten ne doit plus afficher aux visiteurs des messages techniques d'import, de nombre de produits ou d'état SFTP.
- La rotation des visuels d'accueil est déjà réglée sur 48 heures et le thème Noël est actif en novembre, tout en conservant le fond noir, l'orange et la structure Prix Malin.
- L'ancienne image Apple Watch Series 11 renvoyait HTTP 404 ; elle a été remplacée par un visuel Apple Newsroom vérifié, avec provenance enregistrée.

## Contrôle indépendant

- Rôle développeur : revue du parseur, du workflow SFTP et du rendu des fiches.
- Rôle contrôleur : analyse indépendante des deux XML réels, validation des trailers, dates, GTIN, devises, frais de livraison et chevauchement exact des GTIN.
- Claude/Anthropic n'a pas été consulté : aucune connexion Claude autorisée n'est disponible dans les outils de cette exécution.

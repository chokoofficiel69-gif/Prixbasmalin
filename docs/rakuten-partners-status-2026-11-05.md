# Rakuten — état des nouveaux partenaires

Date de vérification : 5 novembre 2026.

## Decathlon National

- Acceptation du programme confirmée le 4 novembre 2026.
- Le support Rakuten confirme le 5 novembre que l'accès AFTP Product Catalog est activé.
- MID Decathlon confirmé dans le tableau de bord : `44806`.
- Hôte : `aftp.linksynergy.com`.
- Protocole recommandé : **SFTP** (la documentation technique Rakuten recommande SFTP ; FTP simple est seulement toléré et doit être évité).
- Nom attendu du flux complet XML compressé avec MID 44806 et SID 4768926 : `44806_4768926_mp.xml.gz`.
- Nom attendu du flux différentiel : `44806_4768926_mp_delta.xml.gz`.
- SID éditeur affiché dans le tableau de bord : `4768926` (l'identifiant AFTP communiqué par e-mail est `rkp_4768926`).
- Les fichiers sont compressés ; Rakuten demande un transfert en mode binaire.
- Formats de nom annoncés : `MID_SID_mp.xml.gz` et `MID_SID_mp_delta.xml.gz`.

La capture du tableau de bord confirme également un lien affilié individuel Decathlon pour le produit « Trophée T511 argent/bleu 31 cm », avec son identifiant de lien affiché dans Rakuten. Cela prouve que des liens trackés peuvent être récupérés depuis le compte, mais ne remplace pas le flux catalogue complet.

La documentation technique Rakuten confirme que le flux est récupéré par SFTP et que les fichiers produits comprennent un en-tête, des enregistrements produit et un pied de fichier. Les champs documentés incluent notamment SKU, catégorie, URL produit, URL image, URL affiliée d'achat (optionnelle), descriptions, prix de vente et prix catalogue. Le flux ne garantit pas un EAN ni des frais de livraison : ils devront être vérifiés dans le fichier réel. Le catalogue comporte un fichier complet et un fichier delta (ajouts, modifications et suppressions). Le MID est désormais connu : 44806.

À obtenir avant import : confirmer que le dossier/fichier Decathlon est effectivement visible dans le compte SFTP, télécharger un échantillon réel, puis valider le mapping XML et la présence des champs nécessaires.

## Nicchia Luxury

- Acceptation du programme confirmée le 5 novembre 2026.
- Le message renvoie vers les liens disponibles dans le tableau de bord Rakuten.
- Aucun flux catalogue, MID ou accès Product Catalog n'est confirmé dans les e-mails examinés.

À vérifier dans le tableau de bord : présence d'un catalogue produit ou disponibilité de simples liens de tracking.

## Intégration Prix Malin

Le pipeline Awin existant doit rester séparé. Le moteur direct `price-engine/products.json` et `data/merchant-offers.json` sont actuellement vides. Ne pas inventer de produits, de prix ou d'identifiants.

L'import Rakuten devra normaliser les offres uniquement après inspection d'un véritable export, privilégier EAN/GTIN, conserver marchand, prix EUR, URL produit, image, disponibilité et date de collecte, et écarter les offres incomplètes ou trop anciennes.

Les accès AFTP doivent être renouvelés puis stockés exclusivement dans les secrets GitHub Actions. Aucun catalogue brut ni identifiant privé ne doit être publié dans le site. Aucun déploiement ne doit être déclenché avant validation du parseur et des données réelles.


## Premier lien affilié Decathlon récupéré depuis le tableau de bord

- Produit affiché : kit durite de frein hydraulique Tektro M530, 1800 mm.
- SKU affiché : `342967`.
- Prix affiché dans l'interface Rakuten au moment de la capture : 11,99 € (prix à revalider avant publication).
- Identifiant du lien Rakuten : `448063907004039373605027`.
- URL affiliée fournie par le compte Prix Malin :
  `https://click.linksynergy.com/link?id=GnFjGr9kD3Y&offerid=2079203.448063907004039373605027&type=2&murl=https%3a%2f%2fwww.decathlon.fr%2fp%2fkit-durite-de-frein-hydraulique-tektro-m-530-1800mm-olive%2f342967%2fm8767652`

Ce lien est une destination affiliée individuelle. Il ne prouve pas à lui seul que le produit existe déjà comme fiche dans le catalogue Prix Malin, ni qu'il est présent dans le flux XML. Ne pas créer une comparaison de prix ni publier le prix de 11,99 € sans date de collecte, frais de livraison et identité produit validée. Il peut servir de CTA « Acheter chez Decathlon » lorsqu'une fiche produit exacte et son image autorisée seront intégrées.


## Précisions issues de la documentation technique officielle Rakuten

- Le Product Catalog utilise un compte SFTP sur `aftp.linksynergy.com`. Le mode binaire est requis pour les archives compressées ; Rakuten recommande SFTP plutôt que FTP simple.
- Les fichiers ont trois parties : en-tête, données produits, pied de fichier (nombre d'articles).
- Le fichier XML complet attendu pour nos identifiants est `44806_4768926_mp.xml.gz`; le différentiel est `44806_4768926_mp_delta.xml.gz`. Les noms sont déduits de la convention documentée et restent à confirmer dans le répertoire réel.
- Les données Rakuten comprennent notamment le SKU, nom, catégories, URL produit, URL image, URL d'achat affiliée (si fournie), descriptions, prix catalogue et prix soldé. Le GTIN/EAN et les frais de port ne sont pas garantis par la liste de champs documentée.
- Les fichiers différentiels peuvent inclure des suppressions ; un import devra traiter explicitement les enregistrements supprimés et refaire régulièrement un téléchargement complet.
- Les liens XML contenant `&amp;` doivent être décodés en `&` avant utilisation.
- La documentation indique une limite de cinq connexions simultanées maximum au serveur.

Source : documentation technique officielle « Product Catalog Data Feed — Implementation Guidelines for Publishers », liée à l'article Rakuten « Aperçu du catalogue de produits ».

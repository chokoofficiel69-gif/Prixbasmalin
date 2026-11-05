# Rakuten — état des nouveaux partenaires

Date de vérification : 5 novembre 2026.

## Decathlon National

- Acceptation du programme confirmée le 4 novembre 2026.
- Le support Rakuten confirme le 5 novembre que l'accès AFTP Product Catalog est activé.
- Hôte : `aftp.linksynergy.com`.
- Identifiant éditeur AFTP : `rkp_4768926`.
- Les fichiers sont compressés ; Rakuten demande un transfert en mode binaire.
- Formats de nom annoncés : `MID_SID_mp.xml.gz` et `MID_SID_mp_delta.xml.gz`.

À obtenir avant import : MID Decathlon exact, nom du fichier disponible sur le serveur, échantillon du format XML/TXT et champs réellement fournis (EAN, prix, image, URL, disponibilité, livraison).

## Nicchia Luxury

- Acceptation du programme confirmée le 5 novembre 2026.
- Le message renvoie vers les liens disponibles dans le tableau de bord Rakuten.
- Aucun flux catalogue, MID ou accès Product Catalog n'est confirmé dans les e-mails examinés.

À vérifier dans le tableau de bord : présence d'un catalogue produit ou disponibilité de simples liens de tracking.

## Intégration Prix Malin

Le pipeline Awin existant doit rester séparé. Le moteur direct `price-engine/products.json` et `data/merchant-offers.json` sont actuellement vides. Ne pas inventer de produits, de prix ou d'identifiants.

L'import Rakuten devra normaliser les offres uniquement après inspection d'un véritable export, privilégier EAN/GTIN, conserver marchand, prix EUR, URL produit, image, disponibilité et date de collecte, et écarter les offres incomplètes ou trop anciennes.

Les accès AFTP doivent être renouvelés puis stockés exclusivement dans les secrets GitHub Actions. Aucun catalogue brut ni identifiant privé ne doit être publié dans le site. Aucun déploiement ne doit être déclenché avant validation du parseur et des données réelles.

# Rakuten — état des partenaires et du catalogue produits

Date de vérification : 5 novembre 2026.

## Decathlon National

- L'acceptation du programme a été confirmée le 4 novembre 2026.
- Le support Rakuten a répondu le 5 novembre 2026 à 09:02 UTC : le compte AFTP Product Catalog est déjà activé et les informations de connexion ont été transmises par e-mail.
- Hôte confirmé par le support : `aftp.linksynergy.com`.
- Protocole à utiliser : **SFTP**, pas FTP simple.
- Les archives sont compressées ; le transfert doit être effectué en mode binaire.
- Rakuten indique une limite de cinq connexions simultanées maximum.
- Convention de nommage documentée : `MID_SID_mp.xml.gz` pour le catalogue complet et `MID_SID_mp_delta.xml.gz` pour le différentiel. Le chemin et les noms réellement présents restent à confirmer par un listing SFTP.

**État réel : accès activé par Rakuten, mais aucun listing ni téléchargement SFTP n'a encore été exécuté par Prix Malin.** Aucun échantillon XML réel n'a été inspecté ; aucun produit Decathlon n'est donc importé ou présenté comme une offre de catalogue.

Les consignes Rakuten décrivent un fichier avec en-tête, enregistrements produits et pied de fichier. Les champs documentés comprennent notamment SKU, catégorie, URL produit, URL image, URL d'achat affiliée lorsqu'elle est fournie, descriptions, prix de vente et prix catalogue. La présence d'un EAN/GTIN, des frais de livraison ou de la disponibilité doit être vérifiée dans le fichier réel ; elle ne doit pas être supposée.

Un lien affilié individuel est visible dans le tableau de bord Rakuten. Cela prouve que le compte peut produire des liens trackés, mais ne prouve ni que le produit est présent dans le flux XML, ni qu'une comparaison exacte est possible. Les détails du lien et les identifiants de suivi restent dans le compte Rakuten et ne sont pas recopiés dans le dépôt.

### Blocage avant import

Le support a fourni les identifiants par e-mail. Ils ne doivent jamais être copiés dans le dépôt, les logs ou le site public. Les workflows consultés ne contiennent pas encore d'étape d'import SFTP ni de configuration Rakuten documentée. L'existence éventuelle de secrets dans les paramètres GitHub n'est pas vérifiable avec l'accès actuel ; aucune connexion SFTP n'a donc été tentée.

Pour automatiser le téléchargement, le propriétaire devra, s'il le souhaite, ajouter les valeurs reçues du support dans les secrets GitHub Actions sous les noms :
- `RAKUTEN_SFTP_HOST`
- `RAKUTEN_SFTP_USER`
- `RAKUTEN_SFTP_PASSWORD`

Les identifiants du marchand et de l'éditeur peuvent être conservés comme variables de configuration non secrètes. Après cette configuration seulement, l'intégration devra :
1. lister le répertoire sans afficher d'identifiants ;
2. télécharger un échantillon en mode binaire ;
3. vérifier l'archive gzip et le XML ;
4. identifier les champs réellement présents et leurs règles de mise à jour/suppression ;
5. tester le parseur sur un échantillon avant tout import public ;
6. vérifier les images, les prix EUR, les liens, la fraîcheur et les variantes exactes.

Aucun prix ne doit être publié sans source, date, devise, variante exacte et frais de livraison connus ou clairement signalés.

## Nicchia Luxury

- L'acceptation du programme a été confirmée le 5 novembre 2026.
- Le message d'acceptation renvoie vers les liens disponibles dans le tableau de bord.
- Aucun flux catalogue, identifiant de catalogue ou accès Product Catalog n'est confirmé dans les e-mails examinés.

À ce stade, Nicchia Luxury peut fournir des liens affiliés individuels, mais aucun produit ni prix ne doit être importé sans fiche et source vérifiables.

## Séparation des sources

Le pipeline Awin existant reste séparé de Rakuten. Un flux Awin direct accessible n'est pas une preuve d'adhésion à chacun des programmes marchands présents dans le fichier. Les demandes en attente ne sont pas des partenariats approuvés.

Les fichiers de prix directs du moteur Prix Malin sont actuellement vides. Les données PrixTracker restent des références historiques et ne doivent jamais être présentées comme des prix actuels. Aucun produit, prix, GTIN ou frais de livraison ne doit être inventé.

## Règle de déploiement

Aucun secret, identifiant de connexion, fichier brut ou mot de passe ne doit être publié dans le dépôt ou le site. Aucun déploiement d'offres Rakuten ne doit être effectué avant réception d'un vrai fichier, validation du parseur, tests de non-régression et vérification publique des données.

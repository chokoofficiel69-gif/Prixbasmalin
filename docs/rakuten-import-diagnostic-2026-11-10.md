# Import Rakuten : diagnostic du 10/11/2026

Branche : `claude/rakuten-import-fix-2026-11-10`. Toutes les connexions ont été faites depuis GitHub Actions.

## Ce qui bloque l'import (cause externe)

L'import s'arrête à la vérification de la clé hôte SSH, **avant tout envoi d'identifiant**. Aucune clé présentée par le serveur ne correspond aux empreintes reçues de Rakuten.

Empreintes reçues de Rakuten (mail du 10/11/2026) :

| Algorithme | Valeur |
|---|---|
| SHA256 | `6854993e0f41078a1f007d677d298c2a4f7d5f898de149f53e27d3159e4b2bdc` |
| SHA1 | `d98a0cdd102177804f99a3534a4a04c6b31ce816` |

Sur `main`, la constante `EXPECTED_SHA256_A` faisait 62 caractères : c'était la SHA1 suivie de caractères parasites. Elle ne pouvait correspondre à aucune clé.

Ce qu'expose réellement `aftp.linksynergy.com` :

- DNS (zone `linksynergy.com` signée DNSSEC) : `aftp.linksynergy.com` → `products.linksynergy.com` → `sftp-rakuten.feedonomics.com` (34.33.1.120). Pas d'enregistrement SSHFP.
- Port 22 : `SSH-2.0-SFTPGo_2.0.4`.
- Port 21 : `220 SFTPGo 2.0.4 ready`. `AUTH TLS` est refusé : `550 Cannot get a TLS config: no TLS certificate configured`. Il n'existe donc aucun certificat FTPS auquel ces empreintes pourraient correspondre.
- Ports 990 et 2222 : fermés.

Les clés hôtes présentées sont identiques le 07/11 (run 42370253103) et le 10/11 (runs 42860110126 et 42859360073). `sftp.feedonomics.com` présente les mêmes clés :

| Type | Empreinte OpenSSH | SHA256 hex du blob |
|---|---|---|
| ssh-ed25519 | `SHA256:QbQhypSndH2izYkW3A+GKPpHSQBIVlytVv3SAt3a5v0` | `41b421ca94a7747da2cd8916dc0f8628fa47490048565cad56fdd202dddae6fd` |
| ecdsa-sha2-nistp256 | `SHA256:/Ri+c21QskX03RuYUj9HGH2TaxYoqkhZn73FxcFcXqc` | `fd18be736d50b245f4dd1b98523f47187d936b1628aa48599fbdc5c5c15c5ea7` |
| ssh-rsa | `SHA256:wWZeMuzbB3rxrFJF4slAJNRA4qcJzwOFXakUjjkPzE0` | `c1665e32ecdb077af1ac5245e2c94024d440e2a709cf03855da9148e390fcc4d` |

Les empreintes officielles ont été comparées, sans aucune correspondance, aux formes suivantes :

- blob SSH, ligne OpenSSH, texte base64, SPKI DER/PEM et PKCS#1, en SHA256 / SHA1 / MD5 ;
- les clés de `ftp.linksynergy.com` et de `mftp.linksynergy.com`.

Ces clés observées ne sont **pas** épinglées tant que Rakuten ne les a pas confirmées par écrit.

## Pour débloquer (une seule action, sans modifier le code)

1. Demander à Rakuten (support Product Catalog / AFTP) de confirmer l'empreinte de la clé hôte SFTP de `aftp.linksynergy.com`, désormais servi par `sftp-rakuten.feedonomics.com`. Joindre le tableau ci-dessus et préciser que l'empreinte transmise le 10/11 (`6854993e…2bdc`) ne correspond à aucune clé du serveur.
2. Une fois l'empreinte confirmée, l'enregistrer dans la **variable de dépôt** `RAKUTEN_SSH_HOST_SHA256`. Plusieurs valeurs sont acceptées, séparées par des espaces, au format `SHA256:…` ou en hexadécimal sur 64 caractères.
3. Relancer `Importer les catalogues Rakuten autorisés` (workflow_dispatch).

## Autres défauts corrigés sur la branche

- **Date `createdOn`** : l'en-tête réel est `07/11/2026 0:11:13` (jour en premier). Le défaut `MM/DD/YYYY` rejetait chaque flux comme périmé. Le nouveau défaut `AUTO` lit les deux formats et ne garde que la lecture qui tombe dans la fenêtre de fraîcheur de 48 h. Si les deux lectures sont fraîches, ou si aucune ne l'est, le flux est rejeté.
- **Transfert incomplet** (`curl: (18) … bytes missing`, 07/11) : le téléchargement reprend après une interruption (`--continue-at -`, 5 tentatives), avec un contrôle `gzip -t` (CRC + longueur) avant de remplacer le fichier.
- **Variantes Decathlon** : les variantes partagent `product_id`/`sku`, et seul le GTIN les distingue. Sur 1 500 fiches publiées, 679 avaient un `id` déjà utilisé, et le catalogue ne montrait que la première variante. L'`id` inclut désormais le GTIN.
- **Doublons** : un même couple (product_id, GTIN/MPN) n'est importé qu'une fois. Un même GTIN n'apparaît qu'une fois par marchand, avec l'offre la moins chère.
- **Snapshot partiel** : un import qui perd un marchand, ou plus de la moitié d'un flux brut, est refusé et le fichier précédent reste intact.
- **TVA** : sur l'accueil, le bloc « Prix TTC et prix barré » exige maintenant `priceTaxStatusVerified === true`, comme le catalogue.

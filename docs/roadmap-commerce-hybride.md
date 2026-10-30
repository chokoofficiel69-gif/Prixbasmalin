# Feuille de route — Prix Malin, comparateur et commerce sans stock

## Décision produit

Faire évoluer Prix Malin progressivement vers une plateforme hybride :
1. comparateur multi-marchands alimenté par des flux/API explicitement autorisés ;
2. catalogue de fournisseurs sans stockage physique par Prix Malin ;
3. à terme, commande et paiement sur Prix Malin uniquement pour les fournisseurs qui autorisent contractuellement ce modèle (dropshipping / expédition directe).

Le site actuel, son identité visuelle, son domaine et son architecture statique doivent être préservés. Aucun remplacement complet.

## Règles non négociables

- Budget initial : 0 €. Ne souscrire à aucun abonnement, API payante ou service de paiement sans validation expresse du propriétaire.
- Aucun scraping non autorisé, contournement anti-bot ou collecte derrière authentification.
- Aucun prix, stock, délai, remise, avis ou économie inventés.
- Aucun secret, jeton, cookie ou identifiant privé dans le navigateur ou le dépôt.
- Ne jamais confondre un lien affilié avec un flux de prix.
- Chaque offre doit avoir une source autorisée, un identifiant produit exact, un prix/devise, une URL, une date de relevé et un statut de fraîcheur. Le coût total doit inclure la livraison lorsqu'elle est connue ; sinon l'indiquer clairement.
- Aucune activation en production, fusion ou déploiement sans validation expresse du propriétaire.

## État technique vérifié au 31 octobre 2026

- `price-engine/products.json` contient un tableau `products` vide.
- `data/prices.json` contient des tableaux `products` et `offers` vides.
- `data/merchant-offers.json` contient un tableau `offers` vide.
- `price-engine/refresh.mjs` sait lire des pages marchandes publiques et extraire des offres JSON-LD, mais ce mécanisme n'est pas un connecteur universel et ne remplace pas un flux marchand autorisé.
- Le workflow horaire `.github/workflows/refresh-prices.yml` ne collecte rien tant qu'aucune source autorisée n'est configurée.
- L'issue #51 suit déjà l'étude d'un comparateur partenaire (piste Affilizz). L'issue #8 couvre les flux/API partenaires. Ces travaux doivent être poursuivis, pas dupliqués.
- Aucun paiement, panier marchand, gestion de commande, remboursement ou synchronisation de stock fournisseur n'est considéré comme opérationnel à ce stade.

## Architecture cible

### A. Comparateur affilié (première priorité)

Intégrer un partenaire de comparaison ou des flux affiliés autorisés. Normaliser les données dans un modèle commun :
- `product_id`, EAN/GTIN/ASIN/MPN et marque/référence ;
- nom, variante exacte, image autorisée ;
- marchand, prix, devise, frais de livraison, coût total ;
- disponibilité, URL affiliée, source et date de mise à jour ;
- statut : frais, périmé, indisponible ou rejeté.

Les adaptateurs doivent être isolés par fournisseur. Les identifiants privés restent côté serveur/edge. Les données sont mises en cache conformément aux contrats et limites du fournisseur.

### B. Catalogue fournisseurs sans stock (deuxième priorité)

Pour chaque fournisseur, vérifier avant intégration :
- identité légale et zone de livraison France ;
- autorisation écrite de revente/dropshipping et d'utilisation des images/descriptions ;
- possibilité d'import CSV/XML/JSON/API et fréquence de mise à jour ;
- prix d'achat, TVA, frais de port, frais cachés, minimum de commande ;
- disponibilité, délais, suivi colis, gestion des ruptures ;
- adresse de retour, SAV, garantie, retours et remboursements ;
- règles de marque, contrefaçon, produits réglementés et restrictions marketplace.

Ne publier un produit qu'après validation des conditions commerciales, des droits sur le contenu et de la fiabilité des données. Commencer par un petit lot pilote dans une seule catégorie.

### C. Vente et paiement sur Prix Malin (troisième priorité, bloquée par prérequis)

Ne développer le checkout qu'après avoir obtenu :
- un contrat fournisseur autorisant explicitement la vente par Prix Malin et l'expédition directe au client ;
- une clarification écrite du rôle de vendeur, de la facturation, de la TVA, des garanties, des retours, du SAV et des remboursements ;
- un prestataire de paiement et ses coûts validés par le propriétaire ;
- un processus sécurisé de commandes, confirmation fournisseur, suivi, annulation et remboursement ;
- les pages légales et informations consommateur adaptées.

Le paiement sur le site n'est pas la même chose qu'un lien affilié. Ne pas présenter cette fonctionnalité comme disponible avant sa réalisation et ses tests.

## Plan d'exécution

1. Continuer l'issue #51 : vérifier l'éligibilité France, les conditions, le modèle économique et l'accès réel à un widget/flux Affilizz. Ne pas supposer que le compte gratuit autorise toutes les fonctions.
2. Obtenir au moins une source autorisée exploitable et tester un seul produit avec identité exacte, prix daté et URL.
3. Valider l'affichage mobile, la fraîcheur et les états sans offre avant d'élargir le catalogue.
4. En parallèle, évaluer un seul fournisseur dropshipping sans frais initiaux ; demander les conditions écrites et un échantillon de flux avant toute intégration.
5. Ajouter un adaptateur fournisseur isolé et un catalogue pilote, sans modifier les pages existantes inutilement.
6. Étudier checkout et paiement seulement après validation commerciale, juridique et budgétaire.

## Critères de réussite du premier pilote

- Une source française autorisée et réellement accessible.
- Au moins un produit identifié sans ambiguïté.
- Une offre avec prix réel, marchand, URL et horodatage.
- La livraison est intégrée au total ou signalée comme inconnue.
- Aucun secret côté client.
- Les données périmées ou absentes ne sont pas présentées comme actuelles.
- Tests automatisés réussis et affichage mobile vérifié.
- Aucun changement de production avant accord du propriétaire.

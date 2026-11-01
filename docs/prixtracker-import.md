# Import indépendant des relevés PrixTracker

Ce module prépare un instantané historique séparé. Il ne modifie pas `data/prices.json`, `price-engine/products.json`, le catalogue ou le workflow horaire.

## Utilisation

Télécharger le CSV depuis la source officielle puis lancer :

```bash
node price-engine/import-prixtracker.mjs --input /chemin/vers/prix-par-marchand.csv
```

Le fichier produit est `data/prixtracker-prices.json`. Pour choisir un autre emplacement :

```bash
node price-engine/import-prixtracker.mjs --input ./prix-par-marchand.csv --output ./tmp/prixtracker-preview.json
```

## Garde-fous

- Les dix colonnes attendues sont contrôlées.
- Les lignes avec date, identité produit, marchand, prix ou nombre de relevés invalides sont rejetées et comptabilisées.
- Le prix minimum et maximum TTC sont conservés séparément.
- Les relevés restent datés et sont explicitement marqués comme historiques.
- Aucun lien marchand, stock, frais de livraison ou disponibilité n'est inventé.
- La sortie est indépendante du moteur de prix actuel.
- La source et l'attribution sont conservées dans le JSON.

## Limite importante

Le CSV contient des observations historiques. Un prix relevé n'est pas une offre actuelle vérifiée et ne doit pas être présenté comme tel. Avant affichage public, filtrer les produits/marchands et afficher la date du relevé ainsi que la mention « Source : PrixTracker ». La réutilisation doit respecter la Licence Ouverte 2.0 et ses obligations d'attribution.

Aucun déploiement ni branchement au catalogue public n'est effectué par ce module.

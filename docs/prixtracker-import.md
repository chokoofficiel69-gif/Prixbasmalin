# Import indépendant des relevés historiques PrixTracker

Deux CSV distincts peuvent être importés sans modifier le moteur de prix actuel ni le catalogue public.

## 1. Prix par marchand

```bash
node price-engine/import-prixtracker.mjs --input /chemin/prix-par-marchand.csv
```

Sortie par défaut : `data/prixtracker-prices.json`.

## 2. Meilleur prix du jour

```bash
node price-engine/import-prixtracker-best-daily.mjs --input /chemin/meilleur-prix-du-jour.csv
```

Sortie par défaut : `data/prixtracker-best-daily.json`.

Les deux outils acceptent `--output /chemin/fichier.json` pour choisir une autre destination.

## Garde-fous

- Les colonnes attendues sont contrôlées.
- Les dates, identités produit, prix et champs marchands sont validés.
- Les données sont triées par produit puis par date décroissante.
- Les deux jeux de données restent séparés : le premier décrit les relevés par marchand, le second le meilleur prix observé par jour.
- Les relevés sont explicitement marqués comme historiques.
- Aucun lien marchand, stock, disponibilité ou frais de livraison n'est inventé.
- La source et l'attribution PrixTracker sont conservées sous Licence Ouverte 2.0.
- Aucune modification de `data/prices.json`, `price-engine/products.json`, du catalogue public, du workflow horaire ou du site en production.

## Limites

Le CSV « meilleur prix du jour » contient un seul marchand gagnant par produit et par date : il ne permet pas, à lui seul, de comparer simultanément plusieurs marchands pour une date donnée. Pour cette comparaison, utiliser le CSV « prix par marchand ». Les prix historiques ne doivent jamais être présentés comme des offres actuelles disponibles.

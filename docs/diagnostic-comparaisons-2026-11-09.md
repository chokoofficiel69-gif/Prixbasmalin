# Diagnostic — pourquoi le site n'affiche pas encore de vraies comparaisons (09/11/2026)

Mesures faites sur `main` (commit 5223c58), à partir des fichiers du dépôt. Aucune requête payante.

## Awin (`data/awin-products.json`, synchro du 09/11 00:25 UTC)

| Indicateur | Valeur |
|---|---:|
| Produits | 18 565 |
| Marchands | 13 |
| Produits avec GTIN valide | 6 762 |
| GTIN présents chez **2 marchands ou plus** | **0** |
| Marque + MPN présents chez 2 marchands ou plus | 0 |
| Offres avec TVA confirmée (`included`) | 0 |
| Offres datées de moins de 48 h | 0 |
| Offres sans date marchande | 12 935 |

Cause principale : les 13 marchands n'ont aucun produit en commun (chaussettes, parfums, puériculture, magasin de sport **canadien**, etc.). Même avec des données parfaites, Awin ne peut produire aucune comparaison aujourd'hui. Il faut des marchands qui vendent les mêmes références (high-tech, électroménager…).

Défaut corrigé dans cette branche : 165 fiches regroupaient plusieurs offres **du même marchand** (même GTIN, fiches dupliquées). Elles auraient pu s'afficher comme « 4 offres comparées ». Désormais : une seule offre par marchand (la moins chère), dans le moteur et dans la page catalogue.

Points à décider (non modifiés ici) :
- `Sportdirect.ca (Canada)` (3 000 produits) et `SODEAL CH` : livraison en France et prix TTC non prouvés.
- Les flux Awin ne donnent pas la TVA : aucune offre n'entre dans un tableau « TTC vérifié ». Toute règle « TTC présumé pour un marchand français B2C » est une décision du propriétaire.
- Date : `last_updated` absent sur 70 % des offres.

## Source qui compare déjà réellement : PrixTracker

`data/fiches-produits.json` : 90 produits high-tech, jusqu'à 24 marchands par produit, relevés datés (le plus souvent J-1 à J-3), Licence Ouverte 2.0. Pas d'URL marchande ni de frais de port : affiché comme « relevés », pas comme offres actuelles. C'est la meilleure base pour les premières comparaisons publiques.

## PricesAPI (test AirPods 4 du 09/11)

Rapport récupéré dans le journal de l'exécution GitHub 42598871937 — aucune nouvelle requête. Évaluation hors ligne : `docs/pilote-pricesapi-airpods4.md` (outil : `scripts/evaluate_pilot_offers.py`). Non publiable : pas de date de relevé, URL non conservées, TVA non indiquée.

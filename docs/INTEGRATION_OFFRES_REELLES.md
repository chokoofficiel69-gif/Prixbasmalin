# Intégration des offres Prix Malin

Cette branche prépare le format et l'affichage d'offres issues de sources autorisées. Elle ne connecte aucun marchand et ne contient aucun prix de démonstration.

## Fichiers
- `data/offres-exemple.json` : fichier public vide tant qu'aucun flux réel n'est autorisé.
- `data/offer.schema.json` : structure normalisée des offres.
- `js/offres.js` : lecteur front-end, validation minimale, fraîcheur, regroupement par `product_group_id` et classement du coût total uniquement lorsque celui-ci est connu.
- `.github/workflows/validate-offer-feed.yml` : validation JSON à chaque push/PR.

## Étape suivante
Quand un réseau ou un marchand accepte Prix Malin et que ses conditions autorisent l'affichage sur un comparateur, écrire un adaptateur de flux côté CI (GitHub Actions) utilisant des secrets de dépôt si nécessaire. Le fichier généré ne doit contenir aucune clé ni URL privée. Ne jamais remplacer le fichier vide avec des données simulées.

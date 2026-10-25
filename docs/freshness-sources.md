# Fenêtre de fraîcheur des offres

Le générateur de prix lit `data/source-freshness.json` pour décider combien de temps un relevé reste admissible.

- `default_max_age_hours` s'applique à toute source qui n'a pas d'entrée dédiée. La valeur initiale reste de 48 heures.
- `sources` permet de définir une durée propre à une source. La clé doit correspondre exactement au champ `source` de l'offre normalisée, après retrait des espaces au début et à la fin.
- Chaque durée doit être un nombre entier d'heures compris entre 1 et 720. Une configuration invalide bloque la génération au lieu de désactiver silencieusement les contrôles.
- Un relevé daté dans le futur reste rejeté. La durée ne remplace ni la vérification de l'identité produit, ni celle du prix, des frais de livraison, de l'URL ou de la source autorisée.

Exemple de réglage pour une source nommée exactement `Flux partenaire A` :

```json
{
  "schema_version": 1,
  "default_max_age_hours": 48,
  "sources": {
    "Flux partenaire A": 24,
    "Flux officiel carburants": 6
  }
}
```

Les noms de cet exemple ne sont pas des sources activées ni validées ; ils illustrent uniquement le format. La configuration du dépôt commence avec `sources: {}`, sans présumer de la fraîcheur appropriée à une source réelle.

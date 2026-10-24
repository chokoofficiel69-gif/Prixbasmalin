# PrixBasMalin

**PrixBasMalin.fr** est un projet de comparaison de prix et de bons plans qui privilégie la vérifiabilité des offres, la transparence et une expérience mobile claire.

## Principes du projet

- Pas de prix inventé ni de fausse promotion.
- Les offres doivent provenir d'une source autorisée et identifier exactement le produit.
- Les classements utilisent le prix total, frais de livraison connus inclus.
- Une offre doit posséder une date de relevé valide et ne pas dépasser la fenêtre de fraîcheur de 48 heures.
- Les clics sortants ne sont pas assimilés à des ventes confirmées.
- Les liens affiliés et placements sponsorisés doivent être clairement signalés.

## État du projet

Le catalogue contient des fiches statiques. La présence d'une fiche ne signifie pas qu'une offre actuelle est disponible. Le flux de prix peut être vide ; dans ce cas, le site doit afficher cette situation sans fabriquer de prix ni d'économies.

## Développement

Le générateur de flux normalisé est dans `scripts/build_prices_feed.py`. Les tests sont dans `tests/test_build_prices_feed.py`.

Exécuter les tests avec :

```bash
python -m unittest discover -s tests -v
```

Le générateur ne collecte pas de prix sur le web et n'effectue pas de scraping. Il traite uniquement des offres explicitement fournies dans le format normalisé par une source autorisée.

## Documentation

- [Cap produit et qualité 2026–2027](docs/STRATEGIE_PRODUIT_2027.md)
- [Catalogue](catalogue.html)

## Limites

Ce dépôt ne garantit ni la disponibilité d'offres réelles, ni les revenus affiliés, ni un positionnement SEO. Avant une campagne publique, vérifier l'état réel du flux, les pages légales, les règles des partenaires et les réglages de suivi.

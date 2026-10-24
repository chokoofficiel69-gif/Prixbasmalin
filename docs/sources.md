# Sources de données — Prix Malin

État au 24 octobre 2026. Une URL configurée est une candidate de collecte, pas une garantie d'accès ni une garantie de prix exploitable. Le moteur ne publie une offre que si le HTML récupéré contient un Product/Offer compatible, un prix explicite et `priceCurrency: EUR`. Le nom/EAN du produit doit correspondre ; les frais de livraison restent `null` sans donnée explicite.

| Source / interface | Mode d'accès | Coût connu | Autorisation / limites | État Phase 1 |
|---|---|---|---|---|
| Fnac, page produit publique / JSON-LD | HTTP public léger, sans API | Gratuit pour la requête publique | Respecter les CGU, la fréquence et les protections du site ; disponibilité des données structurées variable | URL candidate configurée ; extraction bout-en-bout pas encore exécutée depuis cet environnement |
| Darty, page produit / JSON-LD | À vérifier manuellement avant configuration | Pas de coût API identifié pour la page publique | Ne pas contourner CAPTCHA, authentification ou blocage | Non ajouté : URL exacte et JSON-LD de prix non vérifiés |
| Boulanger, page produit / JSON-LD | À vérifier manuellement avant configuration | Pas de coût API identifié pour la page publique | Ne pas contourner CAPTCHA, authentification ou blocage | Non ajouté : URL exacte et JSON-LD de prix non vérifiés |
| Awin / flux affiliés | Flux après inscription et approbation du programme marchand | Inscription souvent gratuite ; conditions et commissions variables | Approbation du compte/programme et respect du contrat nécessaires | Phase suivante, non bloquante |
| Google Merchant API / Merchant Center | Outils pour les données produits du marchand inscrit | API sans coût direct annoncé pour certains usages, mais compte/conditions applicables | Conçus principalement pour gérer le catalogue du marchand, pas pour récupérer universellement les prix concurrents | Non utilisé comme source de prix tiers |
| Google Programmable Search / Custom Search JSON API | Disponibilité limitée pour nouveaux projets | Quotas/conditions évolutifs ; API JSON fermée aux nouveaux clients selon la documentation consultée | Ne pas bâtir cette Phase 1 dessus ni scraper Google Shopping | Exclu |
| Apps Script / Sheets / Looker Studio | Outils de tableur et de reporting | Offre gratuite avec quotas/limites | Tableaux de bord uniquement, pas le moteur de prix | Hors moteur |

## Politique de publication

- Pas de prix inféré depuis un texte non structuré ou une page de recherche.
- Pas de prix publié comme actuel si l'extraction échoue ou si le relevé dépasse 24 heures.
- Livraison uniquement lorsqu'un montant et sa devise EUR sont présents explicitement dans `shippingDetails.shippingRate`.
- Les réponses 429/500/502/503/504 peuvent être retentées trois fois avec un délai exponentiel de 1, 2 puis 4 secondes. Aucun contournement de protection n'est effectué.
- Une source n'est considérée « testée » qu'après exécution réelle du workflow ou du script et inspection du résultat. L'état « candidate » n'est pas un succès.

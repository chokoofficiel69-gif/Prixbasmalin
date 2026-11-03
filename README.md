# Prix Malin

Comparateur et moteur de découverte de produits — https://prixbasmalin.fr/

## Objectif du projet

Prix Malin aide les visiteurs à découvrir des produits, rechercher des références chez des marchands et, lorsque des sources marchandes autorisées le permettent, comparer des offres exactes et récentes.

**Règle de données :** une fiche de découverte n'est pas une offre de prix. Un prix ne doit jamais être présenté comme actuel ou comme le « meilleur prix » sans source autorisée, identité produit exacte, devise, frais connus, disponibilité et date de contrôle.

## Architecture actuelle

- **Site statique :** pages HTML/CSS/JavaScript publiées avec GitHub Pages et le domaine personnalisé.
- **Catalogue :** `catalogue.html` et les données de découverte de `data/home-products.json`.
- **Offres vérifiées :** `data/merchant-offers.json`, puis génération de `data/prices.json` à partir des relevés autorisés.
- **Flux d'affiliation :** `data/awin-products.json` et `price-engine/sync-awin-products.mjs`.
- **Historique :** fichiers `data/prixtracker-*.json`, à traiter comme historique/référence selon leur statut, pas comme prix actuels.
- **Comptes et alertes :** `js/prix-malin-auth.js`, migrations dans `supabase/migrations/`.
- **Mesure consentie :** `js/cookie-consent.js` pilote le chargement de la mesure d'audience et du suivi des clics après choix du visiteur.
- **Contrôles :** `.github/workflows/monitor-production.yml` exécute les tests de code et les contrôles de disponibilité.

## Sources et conformité

- Utiliser seulement les API, flux, exports et liens d'affiliation autorisés.
- Ne pas scraper les pages marchandes sans autorisation.
- Ne jamais versionner les clés API, tokens, secrets ou mots de passe ; utiliser GitHub Actions Secrets.
- Ne jamais inventer de prix, de stock, de livraison, de partenariat, de note ou d'avis client.
- Vérifier les droits d'utilisation des photos, logos, textes et flux marchands.
- Signaler clairement les liens affiliés et le statut des prix.

## Commandes de contrôle

Prérequis : Node.js 22 et Python 3.

```sh
node --test price-engine/price-utils.test.mjs
node --check price-engine/refresh.mjs
node --check price-engine/sync-prixtracker.mjs
node --check js/prix-malin-auth.js
node price-engine/validate-config.mjs
python3 -m unittest discover -s tests
```

Le workflow de contrôle de production réalise aussi des tests de disponibilité du site, du catalogue, de l'historique, des fichiers JSON et du Worker d'attribution.

## Règles de contribution et publication

1. Créer une branche dédiée à chaque lot de changements.
2. Préserver l'identité visuelle et les parcours existants, sauf demande explicite.
3. Faire passer les tests et examiner le diff dans une pull request.
4. Vérifier les versions ordinateur, Android et iPhone/Safari avant toute validation visuelle.
5. Ne déployer qu'après validation du comportement et des données ; un workflow GitHub vert ne garantit pas que les prix et partenariats sont actifs.

## État de référence au 3 novembre 2026

Le site et les contrôles de disponibilité sont en ligne. Le catalogue contient des fiches de découverte, mais les flux `data/prices.json` et `data/merchant-offers.json` ne contiennent pas d'offres validées. Le flux Awin attend un premier accès marchand autorisé. Les demandes de partenariat ne sont pas considérées comme acceptées tant qu'une confirmation explicite n'est pas disponible.

Voir **[`docs/audit-cession-readiness-2026-11-03.md`](docs/audit-cession-readiness-2026-11-03.md)** pour l'audit détaillé et la feuille de route de préparation à la cession.

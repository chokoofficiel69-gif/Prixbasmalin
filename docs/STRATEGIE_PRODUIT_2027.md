# PrixBasMalin — cap produit et qualité 2026–2027

> Document de travail : décrit les priorités et les contrôles recommandés. Il ne constitue ni une certification, ni une garantie de référencement, ni une preuve de conformité juridique.

## Positionnement

**PrixBasMalin aide les visiteurs à comparer des offres vérifiables, sans présenter une estimation comme un prix réel.**

La confiance doit être le produit principal. Le site ne doit pas promettre des économies qui ne peuvent pas être démontrées, ni afficher des badges « vérifié » ou des historiques de prix sans données traçables.

## Décisions de conception

- **Une seule source de vérité pour les offres** : conserver le schéma normalisé documenté dans le code et ne pas créer un second schéma côté interface.
- **Aucun prix inventé** : quand aucune offre fraîche et autorisée n'est disponible, afficher clairement l'absence de prix vérifié.
- **Prix total comparable** : prix produit + livraison connue. Une livraison inconnue doit exclure l'offre du classement.
- **Fraîcheur explicite** : conserver la date réelle de relevé, refuser les dates futures et les relevés âgés de plus de 48 heures.
- **Identité exacte** : ne comparer que les offres qui partagent un identifiant produit fiable (GTIN, ASIN ou MPN avec marque).
- **Traçabilité** : conserver la source, le marchand, l'URL du produit et les conditions d'affiliation lorsqu'elles existent.
- **Accessibilité mobile** : navigation utilisable au clavier, focus visible, libellés explicites, contrastes suffisants et respect de `prefers-reduced-motion`.
- **Monétisation transparente** : signaler les liens affiliés et distinguer les placements sponsorisés des résultats organiques.
- **Pas de fausses preuves sociales** : aucun avis, nombre d'utilisateurs, économie totale ou partenaire ne doit être fabriqué.
- **Protection des données** : minimiser le suivi, documenter les finalités et faire vérifier les mécanismes de consentement et de conservation avant toute promotion à grande échelle.

## Priorités dans l'ordre

### P0 — Fiabilité avant acquisition
1. Valider le flux de prix et les URL.
2. Empêcher l'affichage de prix périmés ou sans source.
3. Vérifier que la page d'accueil, le catalogue et les pages légales répondent correctement sur mobile.
4. Contrôler les liens externes et le suivi d'affiliation.
5. Ajouter des tests automatisés aux règles métier essentielles.

### P1 — Expérience et identité
1. Une hiérarchie simple : recherche, catégories, offres vérifiées, méthode de comparaison.
2. Un langage visuel cohérent : orange pour l'action, tons neutres pour la lecture, vert uniquement pour une économie calculée.
3. Une carte d'offre qui montre prix total, date de relevé, marchand, source et conditions.
4. Des états explicites : chargement, aucune offre vérifiée, erreur de flux, offre expirée.
5. Une page « Notre méthode » expliquant comment les prix sont validés.

### P2 — Référencement et lancement
1. Search Console et Bing Webmaster Tools.
2. Sitemap, robots.txt, titres et descriptions uniques, URL canoniques.
3. Guides utiles fondés sur des données réellement disponibles.
4. Présentation du projet aux communautés de développeurs sans autopromotion répétitive.
5. Soumission aux plateformes de lancement gratuites uniquement après validation de l'expérience et des pages essentielles.

### P3 — Monétisation et croissance
1. Commencer par des programmes partenaires dont les conditions sont comprises et acceptées.
2. Mesurer clics sortants séparément des ventes confirmées.
3. Ajouter des alertes de prix uniquement lorsqu'une source et un historique fiables existent.
4. Envisager badges ou récompenses uniquement avec des règles publiques, une valeur réelle et des garde-fous anti-abus.

## Critères de sortie avant une campagne publique

- [ ] Aucun prix de démonstration présenté comme une offre réelle.
- [ ] Chaque offre publiée a une source autorisée, une identité exacte, un prix et une livraison connue.
- [ ] La date de relevé est réelle, visible et fraîche.
- [ ] Les URL externes sont HTTPS, sans identifiants intégrés, et les destinations sont vérifiées.
- [ ] Les pages de contact, mentions légales et confidentialité sont accessibles et adaptées à l'opérateur réel.
- [ ] Les liens affiliés et contenus sponsorisés sont identifiés.
- [ ] Le site est utilisable sur mobile et au clavier.
- [ ] Les tests automatiques passent.
- [ ] Les métriques distinguent impressions, visites, clics sortants et ventes confirmées.

## Mesures à suivre

| Mesure | Interprétation |
|---|---|
| Offres valides publiées | Nombre d'offres conformes à toutes les règles |
| Offres rejetées par motif | Permet de repérer les problèmes de flux |
| Âge médian des relevés | Mesure la fraîcheur des prix |
| Clics sortants | Intérêt pour les offres, pas preuve de vente |
| Conversions confirmées par le partenaire | Revenus validés, lorsqu'ils sont disponibles |
| Pages indexées / impressions organiques | Progression SEO, sans garantie de classement |
| Retours utilisateurs qualifiés | Défauts d'usage et confiance à corriger |

## Ce qui n'est pas promis

Ce document ne garantit pas de classement Google, de trafic, de revenu affilié, de partenariat, de conformité juridique ou d'acceptation par un annuaire. Les intégrations doivent respecter les conditions des fournisseurs et les droits d'accès aux données.

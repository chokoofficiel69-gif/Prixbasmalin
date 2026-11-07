# Tableau de pilotage — Prix Malin

> Document partagé de référence pour ChatGPT, Claude et toute personne qui intervient sur le dépôt.  
> **Règle :** une tâche n'est « terminée » que si le code est fusionné, les contrôles passent et le résultat attendu est vérifié en production. Un workflow vert qui saute l'import ou la collecte ne vaut pas validation fonctionnelle.

Dernière mise à jour : 7 novembre 2026  
Dépôt : https://github.com/chokoofficiel69-gif/Prixbasmalin  
Site : https://prixbasmalin.fr

## Objectif produit

Faire de Prix Malin un vrai comparateur : plusieurs offres du **même produit exact**, classées par coût total vérifiable (prix + livraison connue), avec marchand, lien affilié autorisé et date de mise à jour. Ne jamais présenter une recherche Amazon, un prix ancien ou une suggestion catalogue comme une offre vérifiée.

## État exécutif

| Domaine | État | Constat vérifié |
|---|---|---|
| Site et publication | 🟢 Opérationnel | Déploiement GitHub Pages et contrôle de production réussis le 07/11 |
| Tests techniques | 🟢 Opérationnel | Suite de 20 tests du moteur réussie le 07/11 |
| Catalogue Awin | 🟠 Données présentes, comparaison limitée | 7 508 fiches/offres, 7 marchands dans le contrôle de production |
| Correspondance produit multi-marchands | 🔴 Bloquant | GTIN=0, MPN=0, comparaisons multi-marchands exactes=0 dans le contrôle |
| Fraîcheur Awin | 🔴 À traiter | 0 date fraîche <48 h ; 4 423 sans date ; 3 085 anciennes dans le contrôle |
| Livraison Awin | 🟠 Partielle | Livraison connue pour 4 231 offres ; disponibilité connue pour 0 |
| Catalogue Rakuten | 🟠 Import non fiabilisé | Snapshot de 3 000 produits présent (1 500 Decathlon + 1 500 Nicchia Luxury) |
| Import Rakuten automatique | 🔴 Bloquant | Une exécution a été ignorée faute de clé hôte configurée ; une autre a échoué au téléchargement SFTP (curl 18, transfert incomplet) |
| Moteur de prix interne | 🔴 Non alimenté | Dernier refresh : aucune source autorisée configurée dans `price-engine/products.json`; lecture et enregistrement des prix ignorés |
| Offres de la une | 🟠 Prudence requise | Les relevés connus sont anciens ; ne pas les présenter comme promotions en direct |
| Attribution / Worker | 🟢 Contrôle technique OK | Endpoint de santé du Worker validé ; cela ne prouve pas encore des commissions générées |
| Résultats commerciaux | ⚪ Non démontrés | Pas de preuve ici d'une hausse des clics, commandes ou commissions depuis les changements |

## Journal des réalisations

| Date | Réalisation | Preuve / vérification | État |
|---|---|---|---|
| 06–07/11 | PR #218 — protection contre l'affichage de prix périmés comme actuels | PR fusionnée ; contrôles de production | 🟢 |
| 06–07/11 | PR #219 — liens Amazon sur 86 fiches | PR fusionnée ; contrôler les clics réels après publication | 🟢 Code / 🟠 résultat |
| 06–07/11 | PR #220 — corrections SEO accueil | PR fusionnée ; contrôle de production | 🟢 |
| 06–07/11 | PR #221 — import Rakuten SFTP | PR fusionnée ; exécutions suivantes révèlent encore un problème de configuration/transfert | 🟠 |
| 06–07/11 | PR #222 — harmonisation menus et design | PR fusionnée | 🟢 |
| 06–07/11 | PR #223 — photos produits vérifiées | PR fusionnée ; 33 photos rapportées | 🟢 |
| 06–07/11 | PR #224 — mentions partenaires | PR fusionnée | 🟢 |
| 07/11 | Déploiement GitHub Pages | Workflow de déploiement réussi | 🟢 |
| 07/11 | Contrôle production | Accueil, catalogue, historique, flux prix/Awin et Worker vérifiés | 🟢 |
| 07/11 | Refresh du moteur de prix | Tests réussis, mais collecte ignorée faute de source configurée | 🔴 Fonctionnellement incomplet |

## Backlog priorisé — tâches à faire

Les cases ne doivent être cochées qu'après preuve. Ajouter un commentaire à l'issue de pilotage avec le commit/PR, les tests et le résultat public.

### P0 — Débloquer les vraies comparaisons

- [ ] **P0 — Awin : obtenir des identifiants communs.** Étudier les flux et annonceurs qui fournissent GTIN/EAN ou MPN ; établir un rapport par marchand et catégorie. Ne jamais rapprocher deux produits sur le seul titre si les variantes ne sont pas identiques.
- [ ] **P0 — Awin : diagnostiquer la fraîcheur.** Comprendre pourquoi 3 085 offres sont anciennes et 4 423 sans date ; déterminer quelles dates du flux sont fiables et conserver la date d'import séparée de la date de mise à jour marchand.
- [ ] **P0 — Awin : construire un premier cas réel.** Choisir une seule catégorie et quelques produits identifiables, trouver au moins deux offres autorisées du même produit, vérifier prix, livraison, disponibilité, URL et date.
- [ ] **P0 — Afficher les comparaisons réelles.** Alimenter la page produit/résultats avec ces offres, triées par prix + livraison connue. Afficher clairement livraison inconnue et fraîcheur ; ne pas afficher de faux « meilleur prix ».
- [ ] **P0 — Rakuten : fiabiliser SFTP.** Configurer et épingler la clé hôte vérifiée via le secret GitHub approprié ; corriger les téléchargements interrompus avec reprise/réessai et validation de taille/gzip ; ne publier qu'un snapshot complet. Ne jamais désactiver la vérification de clé hôte.
- [ ] **P0 — Rakuten : vérifier les fichiers attendus.** Confirmer les chemins MID/fichiers, les flux réellement autorisés et la date de génération ; tester chaque flux seul puis ensemble. Ne pas remplacer les données valides si un flux échoue.
- [ ] **P0 — Moteur interne : choisir les sources autorisées.** Le dernier workflow indique qu'aucun produit/source n'est configuré dans `price-engine/products.json`. Définir des sources gratuites et autorisées ; aucun scraping non autorisé, aucune API payante sans accord.
- [ ] **P0 — Distinguer les familles de données.** Séparer clairement catalogue de découverte, offres partenaires vérifiées, prix historiques et liens de recherche affiliés.

### P1 — Fiabilité et conversion

- [ ] **P1 — Fraîcheur et qualité.** Générer `data/quality.json` avec nombre d'offres valides, fraîches, anciennes, sans date, livraison connue et correspondances exactes.
- [ ] **P1 — Historique des prix.** Ajouter des relevés datés uniquement lorsqu'un prix vérifié change ; préserver les anciens relevés et identifier la source.
- [ ] **P1 — Pages produits SEO.** Générer des pages utiles à partir des seules offres vérifiées ; canonical, données structurées exactes, sitemap et liens internes.
- [ ] **P1 — Page d'accueil.** N'afficher en avant que les offres réellement vérifiées et fraîches ; sinon afficher une sélection éditoriale clairement étiquetée, jamais une fausse promotion.
- [ ] **P1 — Livraison et disponibilité.** Afficher le coût total seulement si les données nécessaires sont connues ; sinon signaler explicitement l'information manquante.
- [ ] **P1 — Liens affiliés.** Vérifier la destination, le tracking, les mentions légales et les règles de chaque réseau ; contrôler les clics sans auto-références.
- [ ] **P1 — Mobile et performance.** Tester sur vrai téléphone : recherche, filtres, cartes, boutons, images, poids JS, Core Web Vitals.
- [ ] **P1 — Mesure commerciale.** Suivre séparément impressions, clics sortants par marchand, sessions, conversions/commissions disponibles et taux de clic. Comparer une période avant/après sans confondre tests internes et visiteurs.

### P2 — Améliorations après validation du cœur

- [ ] **P2 — Recherche unifiée** par nom, marque, EAN/GTIN et référence fabricant.
- [ ] **P2 — Filtres et tri** par prix total, marchand, disponibilité, date et caractéristiques propres à la catégorie.
- [ ] **P2 — Alertes de baisse de prix** uniquement sur les produits et sources qui permettent une mesure fiable.
- [ ] **P2 — Catégories prioritaires** choisies selon la demande et la disponibilité réelle des flux, pas selon le volume brut du catalogue.
- [ ] **P2 — Accessibilité et confiance** : navigation clavier, contrastes, transparence sur les partenaires, méthode de comparaison et dates.
- [ ] **P2 — Documentation opératoire** : comment vérifier un flux, relancer un import, contrôler une publication et revenir en arrière.

## Règles de travail pour ChatGPT et Claude

1. Lire ce tableau et `docs/PLAN_COMPARATEUR.md` avant toute intervention.
2. Mettre à jour ce tableau dans la même PR que le changement, ou commenter l'issue de pilotage avec l'avancement.
3. Chaque tâche doit avoir : objectif, fichiers touchés, preuve, tests, résultat en production, risques et éventuels blocages.
4. Ne pas déclarer « terminé » sur la seule base d'un workflow vert : vérifier que les étapes de collecte/import n'ont pas été ignorées.
5. Préserver le site existant, ses logos et couleurs. Pas de refonte inutile.
6. Aucun abonnement, achat, API payante, scraping interdit, secret dans le navigateur ou déploiement non validé.
7. Ne jamais écraser un flux valide par un fichier vide, partiel ou périmé.
8. Si une information manque, noter le blocage précisément au lieu de supposer.

## Format de compte rendu à chaque intervention

- **Fait :** tâche et résultat concret.
- **Preuve :** PR/commit/workflow ou URL publique.
- **Tests :** réussis/échoués/ignorés, avec raison.
- **Impact visiteur :** ce qui change réellement sur prixbasmalin.fr.
- **Impact commercial :** clics/conversions mesurés, ou « pas encore mesuré ».
- **Reste à faire :** prochaine action prioritaire.

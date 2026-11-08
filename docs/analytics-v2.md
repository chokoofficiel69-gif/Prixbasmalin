# Mesure d’audience v2 : clics Amazon, visiteurs, sessions, robots

Ce document explique le suivi du site après la correction de novembre 2026, comment le mettre
en service sans risque et comment revenir en arrière. **Rien n’est déployé automatiquement** :
chaque étape ci-dessous est faite à la main par le propriétaire.

## Pourquoi cette correction

| Problème constaté (ancien code) | Effet | Correction |
|---|---|---|
| Environ 115 pages publiques (les 97 pages `/prix/`, les guides, les idées cadeaux, la 404, À propos…) ne chargeaient pas `js/cookie-consent.js` | Ni les visites ni les clics Amazon de ces pages n’étaient comptés, alors qu’Amazon les comptait | Toutes les pages du sitemap chargent le gestionnaire de consentement (générateurs + `scripts/site_chrome.py`) ; un test le vérifie |
| Le « visiteur » était un identifiant **par onglet** (`sessionStorage`) | Visiteurs surestimés | Visiteur = identifiant aléatoire du navigateur (13 mois max.), session = 30 min sans activité |
| Deux requêtes `/view` par page vers deux Workers | Données en double (`page_views` + `traffic_attribution`) | Une seule requête `/view` vers `prixbasmalin-clicks`, provenance incluse |
| Expressions régulières de provenance cassées (`/^www\\./`) | Google jamais compté en « recherche » ; `www.` jamais retiré | Expressions corrigées et testées |
| Aucun identifiant d’événement | Double clic / double chargement = double comptage | `event_id` unique + `INSERT OR IGNORE` + anti-doublon côté navigateur |
| Fuseau horaire fixe `+2 hours` | Journées décalées d’une heure en hiver | Décalage Europe/Paris calculé à chaque requête |
| Aucune distinction robot / humain | Robots mélangés aux visiteurs | Classement prudent : humain probable, robot identifié, trafic suspect, indéterminé |

**Tag Amazon** : tous les liens Amazon du site portent `tag=prixbasmalin2-21` (vérifié par
`tests/test_tracking_and_affiliation.py` et par un audit navigateur). Le Worker enregistre le
tag **lu dans l’URL réellement ouverte** ; le tableau de bord sépare les clics Amazon avec ce
tag, sans ce tag, et les autres marchands.

**Commandes et commissions** : un clic ne dit rien d’un achat. Elles ne viennent **que** d’un
rapport officiel Amazon Partenaires importé (voir plus bas). Rien n’est jamais estimé.

## Fichiers concernés

- `workers/prixbasmalin-clicks.js` — Worker unique de mesure (`/view`, `/track`, `/stats`, `/health`).
- `workers/prixbasmalin-attribution.js` — inchangé ; n’est plus appelé par le site mais reste en place (historique).
- `js/track-outbound.js` — script navigateur, chargé seulement après consentement.
- `migrations/2026-11-08-analytics-v2.sql` — migration **additive** (ajout de colonnes, d’index, d’une table).
- `migrations/0000-schema-reference.sql` — schéma présumé, pour référence uniquement (ne pas exécuter).
- `scripts/import_amazon_report.py` — prépare l’import d’un rapport CSV Amazon.
- `stats.html` — tableau de bord privé (clé d’accès obligatoire).

## Mise en service (dans cet ordre)

Les commandes `wrangler` se lancent depuis un ordinateur connecté au compte Cloudflare
(`npx wrangler login`). Le nom de la base (`prixbasmalin-clicks`) est à vérifier dans
Cloudflare → Workers & Pages → D1.

1. **Lire le schéma réel** (lecture seule, ne modifie rien) :
   ```
   npx wrangler d1 execute prixbasmalin-clicks --remote --command "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index')"
   ```
   Comparer avec `migrations/0000-schema-reference.sql`. Si une colonne de la migration existe
   déjà, retirer la ligne `ALTER TABLE` correspondante avant de continuer.
2. **Sauvegarder** la base :
   ```
   npx wrangler d1 export prixbasmalin-clicks --remote --output=backup-avant-v2.sql
   ```
3. **Appliquer la migration** (ajoute seulement des colonnes, des index et la table `amazon_reports`) :
   ```
   npx wrangler d1 execute prixbasmalin-clicks --remote --file=migrations/2026-11-08-analytics-v2.sql
   ```
4. **Déployer le Worker** : Cloudflare → Workers → `prixbasmalin-clicks` → Modifier le code →
   coller `workers/prixbasmalin-clicks.js` → Déployer. Les liaisons `CLICKS` (D1) et le secret
   `ADMIN_TOKEN` existants sont réutilisés ; aucun nouveau secret n’est nécessaire.
   Le Worker v2 fonctionne aussi **avant** la migration (il retombe sur l’ancien format).
5. **Fusionner la PR** : GitHub Pages publie le nouveau `js/track-outbound.js` et les pages.
6. **Vérifier** :
   - `https://prixbasmalin-clicks.chokoofficiel69.workers.dev/health` → `"schema_version": 2`
   - ouvrir le site, accepter la mesure, cliquer un lien Amazon, puis ouvrir `/stats.html` :
     « Clics Amazon avec notre tag » augmente, « sans notre tag » reste à 0, et le bandeau
     « nouveau suivi pas encore activé » a disparu.

## Retour en arrière

- **Site** : annuler la PR sur GitHub (bouton « Revert »). Les anciennes pages et l’ancien script reviennent.
- **Worker** : Cloudflare → Workers → `prixbasmalin-clicks` → Déploiements → revenir à la version précédente.
  L’ancien Worker ignore simplement les nouvelles colonnes.
- **Base** : la migration ne supprime rien, il n’y a normalement rien à annuler. En dernier recours,
  D1 Time Travel restaure la base à un instant donné :
  `npx wrangler d1 time-travel restore prixbasmalin-clicks --timestamp=<date ISO avant la migration>`
  (ou réimporter `backup-avant-v2.sql` dans une base neuve).

## Importer un rapport Amazon (commandes et commissions confirmées)

1. partenaires.amazon.fr → Rapports → choisir la période → **Télécharger le rapport** (CSV).
2. Préparer le fichier SQL (rien n’est envoyé) :
   ```
   python3 scripts/import_amazon_report.py rapport-amazon.csv --out import-amazon.sql
   ```
   Le script affiche le total de clics, d’articles commandés et de gains lus : comparer avec
   l’écran Amazon avant d’aller plus loin.
3. Importer :
   ```
   npx wrangler d1 execute prixbasmalin-clicks --remote --file=import-amazon.sql
   ```
   Réimporter le même rapport met les lignes à jour sans les dupliquer.

Le tableau de bord affiche alors « Articles commandés » et « Commissions confirmées » dans la
section « Ventes confirmées par Amazon ». Sans import, cette section dit clairement que ces
chiffres ne sont pas connus.

## Détection des robots (prudente, sans blocage)

Le Worker classe chaque page vue et chaque clic, **sans jamais bloquer personne** :

- **robot identifié** : agent connu (Googlebot, curl, HeadlessChrome, Playwright…), robot vérifié
  ou score Bot Management très bas (Bot Management n’existe que sur les offres payantes : sur le
  plan gratuit ce signal est simplement absent) ;
- **trafic suspect** : pas d’agent ou pas de langue, réseau d’hébergeur (AWS, Google Cloud, OVH…),
  navigateur automatisé signalé (`navigator.webdriver`) — un **indice**, jamais une preuve ;
- **humain probable** : navigateur courant sans signal ci-dessus ;
- **indéterminé** : le reste.

Un robot bien déguisé peut passer pour un humain probable : ces chiffres restent des estimations.

## Observabilité (plan gratuit)

- Cloudflare → Workers → `prixbasmalin-clicks` → Paramètres → **Observability** → activer
  « Workers Logs ». Sur le plan gratuit, le volume de journaux est limité : si besoin, régler un
  échantillonnage (`head_sampling_rate`, par exemple 0,1) dans ce même écran.
- Le Worker écrit une ligne JSON courte par page vue (`view`), par clic (`click` : Amazon oui/non,
  tag présent oui/non, classe de trafic, doublon), par accès refusé au tableau de bord (`stats_denied`)
  et par erreur d’écriture (`write_error`), avec `svc` et `event`. **Il n’écrit jamais** la clé d’accès, l’adresse IP,
  l’agent utilisateur ni les identifiants de visiteur ou de session (vérifié par un test).
- Aucun service payant n’est nécessaire.

## Tests

```
python3 -m unittest discover -s tests
node --test workers/prixbasmalin-clicks.test.mjs tests/js/track-outbound.test.mjs
```

Les tests Node utilisent une base SQLite en mémoire (`node:sqlite`) à la place de D1 : aucun
accès réseau, aucune donnée de production. Ils sont aussi lancés par la vérification GitHub
« Vérifier le site en production ».

## Limites connues

- Seuls les visiteurs qui **acceptent** la mesure d’audience sont comptés : Amazon comptera
  toujours plus de clics que ce tableau de bord.
- Les bloqueurs de publicité peuvent empêcher l’envoi des mesures.
- Le schéma de départ de la base est **présumé** (il n’est pas dans le dépôt) : l’étape 1 sert à le confirmer.
- Avant la migration, les anciennes lignes comptaient des onglets et non des visiteurs ; elles
  restent visibles à part (`legacy_tab_sessions`).

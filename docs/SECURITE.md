# Sécurité — Prix Malin

Journal des mesures de sécurité et des actions à faire à la main (hors code).

## 1. En-têtes de sécurité du site (à appliquer dans Cloudflare)

Le site HTML est servi par GitHub Pages, qui ne permet pas d'ajouter d'en-têtes.
Les en-têtes se posent donc dans **Cloudflare → Rules → Transform Rules → Modify Response Header**.

Règle « En-têtes de sécurité », condition : *Hostname equals `prixbasmalin.fr`* (et `www.prixbasmalin.fr`).
**Set static** les en-têtes suivants (sans risque pour AdSense ni Amazon) :

| En-tête | Valeur | Effet |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | empêche le navigateur de deviner un type de fichier |
| `X-Frame-Options` | `SAMEORIGIN` | empêche l'affichage du site dans une iframe pirate (clickjacking) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | limite les informations envoyées aux sites externes |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=(), payment=()` | désactive des API sensibles inutilisées |

### Content-Security-Policy (CSP) — à tester en mode « rapport » d'abord
Une CSP stricte peut **casser l'affichage des publicités Google AdSense** et donc les revenus.
Procédure prudente :
1. Ajouter d'abord `Content-Security-Policy-Report-Only` (il n'bloque rien, il observe).
2. Lire les rapports pendant quelques jours, repérer les domaines légitimes (googlesyndication, adtrafficquality, amazon-adsystem, etc.).
3. Seulement ensuite, passer à `Content-Security-Policy` en mode bloquant.

Ne pas activer une CSP bloquante sans cette étape d'observation.

## 2. En-têtes de sécurité des Workers (fait, dans le code)

Les trois Workers (`prixbasmalin-clicks`, `prixbasmalin-ai`, `prixbasmalin-attribution`)
renvoient `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` et
`Referrer-Policy: strict-origin-when-cross-origin`. Ces en-têtes sont présents sur toutes
les réponses, **y compris les prévols `OPTIONS` et les refus `403`** (vérifié par test
automatisé pour `prixbasmalin-clicks`).
**À déployer** : les Workers se déploient à la main (éditeur Cloudflare ou `wrangler`).
Tant que les fichiers `workers/*.js` ne sont pas republiés, **la fusion seule n'active pas
ces protections en production**. Recopier les fichiers `workers/*.js` de ce dépôt après fusion.

## 3. Limite de débit des statistiques (fait, dans le code)

`prixbasmalin-clicks` applique une limite indicative d'environ **90 écritures par minute
et par IP**. Au-delà, réponse `429` sans écriture. Cela ralentit fortement un script
extérieur qui chercherait à gonfler les compteurs de vues et de clics.

⚠️ **Portée réelle** : le compteur vit en mémoire **dans chaque isolate Cloudflare**. C'est
une **défense en profondeur par isolate**, pas une limite globale stricte garantie : avec
plusieurs isolates/instances en parallèle, ou après recyclage d'un isolate, le total effectif
peut dépasser 90/min/IP. Le test automatisé couvre le comportement **sur un seul isolate**.
Une limite globale exacte nécessiterait un stockage partagé (Durable Object ou KV), au prix
d'une consommation supplémentaire — non retenu ici pour rester dans le budget 0 €.

## 4. Rotation des secrets — À FAIRE (urgent)

Ces secrets ont été exposés en clair dans une conversation et doivent être régénérés :

- [ ] **Clé unifiée FreeLLMAPI** : la régénérer dans le tableau de bord FreeLLMAPI
  (page *Clés → Clé d'API unifiée*), puis la remettre à jour partout où elle sert :
  - Worker Cloudflare `prixbasmalin-ia` → secret `FREELLMAPI_API_KEY` ;
  - application Studio IA (Blitz) → réglage `FREELLMAPI_KEY` ;
  - Open WebUI (Blitz, « Mon espace IA ») → réglage `OPENAI_API_KEY`.
- [ ] **Mot de passe du Studio IA** : le changer dans le Studio (*Suivi des tokens → Mon compte*).

Ne jamais coller une clé ou un mot de passe dans une conversation.

## 5. À vérifier

- [ ] **Tableau de bord FreeLLMAPI** : ouvrir `https://freellmapi.prixbasmalin.prod.page`
  en navigation privée. S'il s'affiche sans mot de passe, il faut le protéger (il montre
  les clés et la consommation).

## Ce qui est déjà bien (audit du 12/11/2026)

- Aucun secret en clair dans le dépôt ni dans l'historique git.
- Requêtes SQL paramétrées (pas d'injection) dans les Workers d'analytics.
- Point d'accès privé des statistiques protégé par jeton en comparaison à temps constant.
- Réponse de l'assistant affichée en `textContent` (pas d'injection de code), lien Amazon validé.
- CORS verrouillé sur `prixbasmalin.fr`, clés gardées côté serveur.
- Workflows GitHub sans déclencheur dangereux ni injection.

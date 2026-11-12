# Quota de tokens du Studio IA — règles et garanties

## Deux indicateurs qui ne doivent jamais être confondus

| | Quota **interne** du Studio | Capacité **fournisseur** |
|---|---|---|
| Qui le fixe | L'administrateur (réglage `poolMonthlyTokens`, 10 000 000 par défaut) | Le fournisseur (OVH, etc.) |
| Nature | Plafond de **vente / consommation** que le Studio s'impose | Limites techniques et contractuelles réelles |
| Où le voir | Suivi des tokens → « Pool interne du Studio » | Suivi des tokens → « Capacité et limites confirmées chez les fournisseurs » |
| Garantie | Appliqué strictement par le registre | Seulement ce que le fournisseur publie ; sinon « quota fournisseur non communiqué » |

Un plafond configuré dans le Studio **ne crée aucune capacité** chez un fournisseur.

## Pool et quotas individuels

- Pool mensuel global (10 000 000 tokens par défaut), partagé par tous les comptes.
- Chaque compte (administrateur compris) reçoit un **quota mensuel** attribué par l'administrateur.
- **La somme des quotas des comptes actifs ne peut jamais dépasser le pool** : toute attribution, création,
  réactivation ou baisse du pool qui violerait cette règle est refusée par le serveur.
- Les compteurs sont rangés par **mois UTC** : ils repartent de zéro le 1er de chaque mois à 00:00 UTC.
- Une requête est bloquée si **une seule** des limites est atteinte : quota du compte, limite du jour du compte
  (facultative), limite globale du jour (facultative) ou pool mensuel.

## Réservation, débit, libération

1. **Avant l'appel** : le Studio estime le prompt de façon prudente (1 token pour 3 caractères, +10 %, +64 de gabarit,
   1 500 par image) et choisit `max_tokens` = min(plafond de sortie, marge restante − prompt estimé).
   Il **réserve** prompt estimé + `max_tokens`. Cette vérification et l'inscription de la réservation se font sans
   interruption possible (même tour de boucle Node.js) : **deux requêtes simultanées ne peuvent pas dépasser le plafond**.
2. `max_tokens` est envoyé au fournisseur : la réponse ne peut normalement pas dépasser la réservation.
3. **À la fin** :
   - le fournisseur renvoie `usage` → débit des **tokens réels** (marqués « réels ») ;
   - pas de `usage` → débit d'une **estimation** (prompt estimé + texte reçu / 3), marquée « estimés », jamais présentée comme exacte ;
   - le reste de la réservation est libéré.
4. **Échecs** :
   - erreur avant toute réponse (HTTP 4xx/5xx dont 429, réseau, délai) → **0 token** débité, réservation libérée ;
   - interruption après un début de réponse (utilisateur ou erreur) → débit **estimé** du prompt + du texte produit ;
   - serveur arrêté brutalement pendant une requête → au redémarrage, débit de **la totalité de la réservation**,
     marqué « estimé (interruption serveur) ». C'est la règle la plus prudente.
5. **Jamais deux débits** : chaque réservation a un identifiant ; un second règlement est ignoré, y compris après redémarrage.
6. Si un fournisseur facture plus que réservé (il a ignoré `max_tokens`), la **réalité** est débitée ; le compte ou le pool
   peut alors être légèrement dépassé, et toute requête suivante est bloquée. Le dépassement maximal possible est l'erreur
   d'estimation des requêtes en cours.

Journal : `data/ledger/AAAA-MM.jsonl` (événements `R` = réservation, `S` = règlement). Le tableau de bord est calculé
uniquement à partir de ce journal.

## Mode gratuit : blocage AVANT l'appel

- Liste blanche `allowedPlatforms` (par défaut : `ovh`). En mode gratuit, une requête ne part que vers un fournisseur
  **identifié avant l'appel** et présent dans cette liste.
- **OVH AI Endpoints est appelé directement en accès anonyme** (aucune clé envoyée) : l'identité du fournisseur est
  certaine, et sans compte ni moyen de paiement aucune facturation n'est possible.
- **FreeLLMAPI** : avec la clé du Studio, tous les modèles apparaissent comme `owned_by = freellmapi` et le fournisseur
  réel n'est connu qu'après le routage. En mode gratuit, la passerelle n'est donc utilisée **que** pour un modèle
  épinglé dont la liste complète des fournisseurs possibles (outil MCP `list_models` de FreeLLMAPI) est dans la liste
  blanche. `auto` n'est **jamais** envoyé à la passerelle. Si le serveur MCP de FreeLLMAPI est désactivé (cas par
  défaut), la passerelle est bloquée pour le chat. Après l'appel, `X-Routed-Via` est contrôlé en plus (alerte si écart).
- Images, vidéos et voix passent par FreeLLMAPI (fournisseur inconnu avant l'appel) : **bloquées par défaut** en mode
  gratuit ; l'administrateur peut les autoriser explicitement. La transcription utilise Whisper d'OVH en direct
  lorsqu'il est disponible.
- Le mode « Fusion » est désactivé : sa consommation réelle (plusieurs modèles + un juge) n'est pas mesurable.
- Si aucun fournisseur gratuit autorisé n'est disponible, la requête échoue proprement, sans appel externe.

## Coûts

- `prices` vide = **« tarif non renseigné »**, jamais 0,00 €.
- OVH en accès anonyme est affiché « 0 € — accès anonyme, aucune facturation possible » (justification : aucun compte).

## Capacité réelle d'OVH (accès anonyme)

- 2 requêtes par minute, **par adresse IP et par modèle** (documentation OVHcloud). Toutes les personnes du Studio
  partagent l'adresse IP du serveur : c'est une limite **globale** du service.
- Au-delà : HTTP 429. Le Studio applique ce rythme localement et met un modèle en pause après un 429.
- Aucun quota mensuel de tokens n'est publié : « quota fournisseur non communiqué ».
- Accès avec clé (400 requêtes/min par projet et par modèle) : nécessite un projet Public Cloud avec moyen de paiement,
  donc **payant** — non utilisé.
- Usage commercial de l'accès anonyme : **non vérifié** — à confirmer auprès d'OVHcloud avant toute vente.

## Tests

`node --test --test-concurrency=1 test/quota.test.mjs` : 13 tests (dont les 9 tests demandés). Une vérification réelle
(OVH + comparaison avec FreeLLMAPI `/v1/usage`) est disponible pour l'administrateur dans Suivi des tokens ; chaque
exécution est conservée dans `data/verifications.jsonl`.

## Capacité réelle estimée (page Tokens)

Le pool mensuel (10 M par défaut) est un **plafond interne**, pas une capacité fournisseur. La page Tokens affiche à côté une
**capacité réelle estimée** pour chaque modèle de chat OVH (accès anonyme : 2 requêtes **lancées** par minute, par modèle et par IP ;
aucun quota de tokens publié) :

- **req/min = 2 × (1 − taux d'erreur mesuré)**. OVH compte les requêtes lancées, pas les requêtes simultanées : la latence
  n'entre pas dans le calcul, elle est affichée pour information.
- Le Studio **ne sérialise pas** les appels : jusqu'à 2 appels en parallèle par modèle (la limite est comptée au lancement).
- **tokens/min = req/min × tokens moyens par réponse**, mesurés ce mois-ci. Modèle sans mesure : « non mesuré », ou
  « estimé » (clairement marqué) avec la moyenne tokens/réponse des modèles mesurés. Taux d'erreur d'un modèle non mesuré : non copié.
- Nombre de mesures **n** affiché par modèle ; **n < 10 → « fiabilité faible »**.
- **Équivalent 30 jours = min(capacité OVH × 30 j en continu, limite interne/jour × 30, pool restant)**, avec la limite qui bloque en premier.

Exemple mesuré : gpt-oss-120b, 63 s de latence (info), ~4 300 tokens/réponse, 1 erreur sur 6 (n = 6, fiabilité faible)
→ 2 × 5/6 ≈ 1,67 req/min, ≈ 7 200 tokens/min.

## Routage chat OVH

- Seuls les modèles de chat texte sont routés : **Guard** (modération) et **VL** (vision) exclus ; les VL ne servent qu'aux messages avec image.
- **Charge** : requêtes lancées sur les 60 dernières secondes, requêtes en cours incluses (comptées au lancement).
- **Après un 429** : modèle en pause **60 s minimum** (plus si OVH envoie un Retry-After plus long).
- **Niveaux** : haut = gpt-oss-120b, Qwen3.5-397B-A17B, Meta-Llama-3_3-70B-Instruct ; moyen = Qwen3.6-27B, Qwen3.8-27B,
  Mistral-Small-3.2-24B, gpt-oss-20b ; bas = Qwen3.5-9B ; les autres modèles forment un dernier niveau.
- **Bascule** : un modèle choisi à la main mais saturé ou en pause bascule vers le modèle le moins chargé **du même niveau** ;
  on ne descend d'un niveau que si tout le niveau est plein (niveaux supérieurs en dernier recours). « Automatique » commence au
  niveau haut (« rapide » : niveau moyen) et répartit sur le moins chargé.
- La conversation affiche **« Réponse fournie par X (Y était saturé) »** quand il y a eu bascule.
- Tous les modèles pleins : refus local (429) sans appel à OVH.
- **Usage commercial de l'accès anonyme OVH : non vérifié** (avertissement affiché sur la page Tokens).

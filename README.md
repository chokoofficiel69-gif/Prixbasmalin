# Studio IA — votre espace IA personnel

Une seule application web (ordinateur + téléphone, en français), pour vous et vos amis, qui réunit :

| Menu | Ce que ça fait réellement | Moteur |
|---|---|---|
| **ACCUEIL** | État des IA connectées, consommation du jour, raccourcis, dernières conversations et fichiers | Studio |
| **PARLER AUX IA** | Discussion en continu avec n'importe quel modèle, **comparaison** de 2 à 4 modèles côte à côte, **conversation vocale** (micro → IA → voix), **messages vocaux** transcrits, pièces jointes (images, PDF, textes, sons, vidéos), historique par projet, export Markdown | FreeLLMAPI (chat, vision, transcription, synthèse vocale) |
| **AGENTS** | Une équipe d'IA (rôles + modèles différents) travaille sur la même tâche : chef de projet, à la chaîne, en parallèle ou en débat, puis une synthèse produit le livrable | FreeLLMAPI |
| **IMAGES** | Création d'images par description (+ amélioration du prompt) et **retouche** : recadrage, rotation, miroir, 8 réglages, 6 looks, texte, export PNG/JPEG/WebP, description de l'image par IA | FreeLLMAPI (images) + navigateur |
| **VIDÉOS ET CLIPS** | **⚡ Clip automatique** : la musique seule suffit → paroles retranscrites mot pour mot (Whisper large-v3, guidé par vos paroles si vous les collez, corrigeables) → scénario plan par plan calé sur les paroles, avec prompts image/vidéo, création des images et plans vidéo en un clic, paroles posées en sous-titres. Photos + vidéos + musique → **clip monté** : formats 9:16 / 16:9 / 1:1 / 4:5, transitions, mouvements de caméra, looks, titre, légendes, **sous-titres automatiques** depuis l'audio, **calage sur le tempo**, montage proposé par l'IA (qui regarde vos photos), plans vidéo générés par IA, export MP4/WebM | Navigateur + FreeLLMAPI (vision, transcription, vidéo) |
| **STUDIO MUSIQUE** | **Instrumentales réellement synthétisées** (batterie, 808, basse, accords, mélodie) composées par l'IA ou à la main (séquenceur 16 pas, structure, mixage), export WAV et **pistes séparées** ; **paroles et refrains** (écriture, amélioration, rimes, critique, comptage des syllabes) ; voix de synthèse | Navigateur + FreeLLMAPI |
| **ENREGISTREMENT AUDIO** | **🎛️ Effets voix & autotune** (222 préréglages en 9 familles : vraies voix par décalage des formants — féminine, masculine, enfant, géant —, harmoniseur 3-4 voix qui suit les accords détectés dans l’instru, chant diphonique, Flavor (lampe, bande, exciter, air…), styles du moment, transposition ±12, favoris, combinaisons sauvegardées, écoute A/B ; et toujours à écouter sur 15 s puis appliquer : autotune du naturel au hard-tune avec tonalité détectée, doublages, harmonies, octaves, voix plus grave/aiguë/féminine en gardant le timbre, vocodeur, talkbox, robot, chuchotement, téléphone, radio, réverbes, échos, lo-fi…) ; **⚡ Tout faire en un clic** (débruitage, voix rap, **calage automatique sur le beat** : latence casque/micro compensée puis alignement fin des attaques sur les frappes de l'instru, mix, master) ; **plusieurs versions de master à écouter et choisir** (aussi pour un morceau déjà fini importé seul) ; enregistrement micro (avec l'instru dans le casque et le texte affiché), import, édition (couper, garder, fondus, normaliser), **réduction du bruit** spectrale, porte de bruit, **chaîne voix** (EQ, anti-sifflantes, compresseur, réverb), **mixage multipiste** et **mastering** (sonie LUFS + limiteur), export WAV 16/24 bits, transcription | Navigateur + FreeLLMAPI (transcription) |
| **MES PROJETS** | Discussions, Musique, Clips, Idées & perso (+ les vôtres) : chacun a ses consignes, sa **mémoire de travail**, ses conversations et ses fichiers | Studio |
| **FICHIERS** | Bibliothèque par projet, glisser-déposer, aperçu image/vidéo/son/PDF/texte, renommer, déplacer, quota | Studio |
| **SUIVI DES TOKENS** | **Amis et accès** (administrateur : inviter, limites par personne, désactiver), tokens par jour/mois, par modèle et fournisseur, latence, erreurs, fournisseurs prêts / en pause / sans clé, consommation déclarée par FreeLLMAPI, coût en €, **plafonds**, **mode gratuit**, changement de mot de passe | Studio + FreeLLMAPI `/v1/usage` |

## Architecture

```
Téléphone / ordinateur (navigateur)
  │   montage vidéo, synthèse musicale, mixage, mastering, débruitage → calculés sur l'appareil
  ▼
Studio IA (Blitz, 1 app, ~70 Mo de RAM, Node 22 sans dépendance)
  │   mot de passe, projets, historique, fichiers, mémoire, garde-fous budgétaires
  │   la clé FreeLLMAPI reste sur le serveur
  ▼
FreeLLMAPI (déjà installé) ──► OVH AI Endpoints, Groq, Cerebras, Mistral, Gemini, OpenRouter,
                                Pollinations, Hugging Face… (offres gratuites uniquement)
```

Pourquoi les traitements lourds se font dans le navigateur : l'hébergement Blitz gratuit a 512 Mo de mémoire au total
(384 déjà utilisés par FreeLLMAPI et Open WebUI). Aucun outil de génération musicale, de montage ou de mixage ne peut tourner
côté serveur dans 128 Mo. Votre appareil le fait gratuitement, sans limite et sans envoyer vos fichiers à un tiers.

## Ce qui est gratuit, ce qui demande une clé

| Fonction | Dépend de | Clé nécessaire ? |
|---|---|---|
| Chat, agents, paroles, scénarios | Modèles de chat de FreeLLMAPI | Oui, une clé gratuite par fournisseur (OVH déjà relié) |
| Lecture d'images (vision) | Un modèle vision activé (Gemini, Llama 4, GLM-4.6V…) | Oui : OVH seul n'en fournit peut-être pas. Gemini (Google AI Studio) ou Groq en offrent gratuitement |
| Transcription | OVH (Whisper), Groq, Mistral, Cloudflare… | OVH déjà relié |
| Synthèse vocale | Fournisseurs « audio » du catalogue FreeLLMAPI | Selon le fournisseur ; repli automatique sur la voix du navigateur |
| Images | Pollinations (sans clé), Cloudflare, NVIDIA… | Pollinations : non |
| Vidéo IA | Pollinations, Hugging Face | Pollinations : non ; lent et parfois indisponible |
| Montage, musique, mixage, mastering, débruitage, retouche | Votre navigateur | Non, illimité |

Les quotas gratuits ne sont jamais inventés : le Studio affiche ce que les fournisseurs déclarent (« prêt », « en pause car quota atteint »)
et ce qui a réellement été consommé.

## Quota de tokens (pool mensuel)

Voir [docs/QUOTAS.md](docs/QUOTAS.md) : pool interne de 10 000 000 tokens/mois partagé, quota individuel par compte
(somme ≤ pool), réservation avant chaque appel, débit des tokens réels (ou estimés, marqués comme tels), remise à zéro
mensuelle, blocage réel. OVH AI Endpoints est appelé en direct en accès anonyme (2 requêtes/min par IP et par modèle).

## Garde-fous « zéro dépense »

1. FreeLLMAPI ne route que vers des offres gratuites.
2. **Mode gratuit** (actif par défaut) : tout modèle d'un fournisseur marqué potentiellement payant (openai, anthropic, deepseek, custom…) est bloqué.
3. Si un fournisseur marqué payant répond malgré tout, une alerte rouge apparaît dans Suivi des tokens.
4. **Plafonds** : 500 000 tokens/jour, 10 M/mois, 40 générations média/jour (modifiables).
5. Règle d'or : n'ajoutez jamais dans FreeLLMAPI une clé liée à un compte avec carte bancaire et facturation activée.

## Comptes (vous + vos amis)

- L'administrateur (identifiant `admin`) invite ses amis depuis **Suivi des tokens → Amis et accès** : le Studio crée un mot de passe provisoire et le message à envoyer.
- Chaque ami a ses **propres** projets, conversations, fichiers et mémoire : personne ne voit ceux des autres (l'administrateur non plus).
- Limites par ami (tokens/jour, médias/jour, espace fichiers) pour que les quotas gratuits partagés ne soient pas épuisés par une seule personne.
- Désactiver un compte coupe l'accès immédiatement, sans effacer ses données.

## Sécurité

- Connexion identifiant + mot de passe (administrateur : `STUDIO_PASSWORD` au départ, puis modifiable ; mots de passe hachés scrypt), cookie `HttpOnly` + `SameSite=Strict`, 10 essais / 15 min.
- Toute écriture exige l'en-tête `X-Studio` (protection CSRF).
- La clé FreeLLMAPI (`FREELLMAPI_KEY`) n'est jamais envoyée au navigateur.
- Les liens publics de fichiers (nécessaires pour animer une photo en vidéo) sont signés et expirent en 30 minutes.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `FREELLMAPI_URL` | `https://freellmapi.prixbasmalin.prod.page` (défaut) |
| `FREELLMAPI_KEY` | La clé unifiée `freellmapi-…` (page Keys de FreeLLMAPI) |
| `STUDIO_PASSWORD` | Mot de passe initial du Studio |
| `DATA_DIR` | `/app/data` (dossier persistant) |

## Développement et tests

```bash
npm start                      # serveur sur :8080
node test/mock-freellmapi.mjs  # faux FreeLLMAPI + faux OVH (/ovh/v1) sur :9999
node test/ui.mjs               # 19 scénarios
node --test --test-concurrency=1 test/quota.test.mjs   # 13 tests du quota de bout en bout (Playwright, micro simulé)
```

## Ajouter ou remplacer un fournisseur

Tout passe par FreeLLMAPI : ajoutez la clé gratuite du fournisseur dans son tableau de bord (Keys).
Le Studio la voit automatiquement (liste des modèles, statut, consommation). Rien à modifier dans le Studio.

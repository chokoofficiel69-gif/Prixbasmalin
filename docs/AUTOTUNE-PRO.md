# Autotune Pro — page Enregistrement

Notre propre autotune (aucun code ni marque d'un éditeur tiers). Deux modes sur chaque
piste voix. **Tout est calculé en local dans le navigateur** (gratuit), PC et Android.

## Mode Auto (« 🎚️ Autotune Pro »)
Réglages, de gauche à droite :
- **🎯 Détecter la tonalité** : analyse la voix sélectionnée (ou l'instru) et remplit le
  menu « Tonalité ».
- **Présets maison** : LJK lead · Naturel · Pop · Robot · Backs · Ad-libs (voir valeurs
  dans `public/js/lib/autotunepro.js`), + tes réglages gardés dans « Mes réglages ».
- **⚡ Vitesse de correction** : 0–400 ms (0 = robot collé, 400 = très naturel).
- **🌿 Naturel** : garde ton vibrato et tes glissés (0 % = notes plates).
- **🎯 Force** : à quel point la note est ramenée vers la note juste.
- **🎲 Humanize** : petit écart stable par note (jusqu'à ±30 cents) pour éviter le rendu
  robotique.
- **🎛️ Transpose** : −12..+12 demi-tons (monte/descend toutes les notes).
- **🧑 Formant (timbre)** : −6..+6, change le timbre sans changer la note.
- **🗣️ Type de voix** : Naturel / Plus grave / Plus aigu / Féminine / Enfant / Caverneux
  (fixe le formant de base).
- **▶ Écouter (A/B)**, **✅ Appliquer**, **💾 Garder ce réglage**.

## Mode Graphique (éditeur de notes, déjà présent)
Éditeur façon piano-roll (`notes.js` / `createNoteEditor`) : notes chantées détectées,
meilleure note proposée, **glisser une note** (souris ou doigt), écouter avec l'instru,
appliquer. C'est la correction note par note.

## Moteur
- Le mode Auto construit l'étape `{ t:'tune', mode:'notes', strength, keep, glide, humanize,
  formant, extra:transpose }` (voir `buildTuneStep`) passée à `applyChain` → `noteCurve` +
  `psola` dans `public/js/lib/voicefx.js`.
- `transpose` est appliqué comme décalage constant (`extra`) ; `formant` est passé à `psola`
  (changement de timbre) ; `humanize` ajoute un petit écart stable par note dans `noteCurve`.

## Code et tests
- Réglages purs (présets, types de voix, bornes) : `public/js/lib/autotunepro.js`, testés par
  `test/autotunepro.test.mjs` (`npm test`).
- Ajout moteur minimal : paramètre `humanize` dans `noteCurve` (`voicefx.js`).
- Intégration interface : `public/js/views/record.js` (panneau « Autotune Pro »).
- Vérifié bout-en-bout au navigateur (Chromium) : panneau affiché, présets, Détecter,
  application + annulation.

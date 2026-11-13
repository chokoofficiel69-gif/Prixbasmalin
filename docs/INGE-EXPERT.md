# Ingé son Expert — page Enregistrement

Option **🎓 Mode expert** de l'Ingé son IA. Tout en local (gratuit), PC et Android.
**Aucun audio n'est envoyé à un LLM** : seules les mesures chiffrées le sont.

## Analyse poussée (sur la prise brute)
`analyzeSamples` dans `public/js/lib/ingexpert.js` calcule : crête & niveau moyen (dBFS),
**plage dynamique** (crest factor), **clipping** (% d'échantillons écrêtés), **sifflantes**
(estimation par énergie haute fréquence), **résonance** grave-médium (pic FFT 150–500 Hz),
**respirations/blancs** (%), et la **sonie LUFS** (via `loudness`).

## Chaîne experte (selon mesures + style)
`expertChain` ajoute, par-dessus la chaîne par rôle :
- **de-esser dosé** selon les sifflantes mesurées ;
- **EQ anti-résonance** : notch (peaking négatif, Q 2.5, −3 à −4 dB) à la fréquence de
  résonance détectée ;
- **anti-plosives** renforcé selon l'énergie grave ;
- **autotune** réglé par le style ;
- **gain staging** : la voix est calée ~3 LU au-dessus de l'instru (l'instru est baissée
  automatiquement, `instruDuckDb`) ;
- **mastering** du style appliqué par défaut.

## Styles
Rap · Chant · Drill · RnB (influencent voix, autotune et mastering) — `STYLES`.

## Conseils experts (LLM)
`expertTipsPrompt` fournit au LLM du Studio un **prompt système de persona** : ingénieur du
son professionnel expérimenté (30 ans, tous genres, matériel SSL/Neve/1176/LA-2A…, plugins
FabFilter/UAD/Waves/Ozone), avec 4 règles : diagnostic chirurgical, réglages **chiffrés**
(Hz, Q, ratios, ms, dB, LUFS), adaptation au genre, lien avec l'émotion/l'impact
(club/voiture/smartphone/casque). Il ne reçoit **que les nombres** ci-dessus, jamais d'audio.

## Rapport
Rapport détaillé en français (crête, niveau, dynamique, clipping, sonie, sifflantes,
résonance, respirations, traitement appliqué) — `expertReport`.

## Consultations prêtes à l'emploi (4 fiches)
Bouton **« 💬 Consulter l'ingé son »** (carte Ingé son IA) → modale où l'on choisit un sujet,
remplit les cases, et reçoit une réponse chiffrée et structurée. Fiches (`CONSULTATIONS` +
`buildConsult`) :
1. **Chirurgie voix** (caractère de voix + style) → chaîne vocale complète, fréquences,
   compresseurs (ratio/attaque/relâchement), sends reverb/delay.
2. **Crash-test des basses** (style) → kick vs 808/sub : sidechain, EQ chirurgical, phase,
   saturation, audibilité sur petit haut-parleur.
3. **Mastering streaming & club** (style + headroom) → chaîne de mastering, LUFS, True Peak,
   plage dynamique.
4. **Audit & référence** (titre + artiste) → analyse d'une signature sonore et réglages pour
   s'en approcher.
Le prompt système est le même persona (`EXPERT_SYSTEM_CORE`) ; la demande est construite à
partir de la description de l'utilisateur (texte), **aucun audio n'est envoyé**.

## Code et tests
- Logique pure : `public/js/lib/ingexpert.js` (analyse, FFT résonance, chaîne, duck, rapport,
  prompt) — testée par `test/ingexpert.test.mjs` (`npm test`).
- Intégration : `public/js/views/record.js` (toggle Mode expert + style ; branche experte
  de `processTake` ; conseils via `expertTipsPrompt`).
- Vérifié bout-en-bout au navigateur (Chromium) : activation, enregistrement, rapport
  « Analyse experte », aucune erreur.

Note honnête : les estimations spectrales (sifflantes, plosives) sont des **proxys** calculés
sur le signal, étiquetés « estim. » dans le rapport ; elles guident la chaîne sans prétendre
à une mesure de laboratoire.

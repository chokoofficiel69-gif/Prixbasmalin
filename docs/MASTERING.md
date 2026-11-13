# Mastering Studio — mètres pro + analyseur de référence

Dans la page Enregistrement, carte « 🎛️ Mixage et mastering ». Tout en local.

## Mètres pro (après « Mixer + masteriser »)
Calculés sur le master (L/R) par `public/js/lib/meters.js` (pur, testé) :
- **Sonie intégrée (LUFS)** — via `loudness` (audio.js).
- **True Peak (dBTP)** — estimé par suréchantillonnage cubic ; alerte si > −1 dBTP
  (risque d'écrêtage à l'encodage MP3/AAC). `truePeakDb`.
- **Crête (dBFS)**, **Dynamique (crest, dB)**.
- **Corrélation de phase** (+1 mono/en phase … −1 opposition) — `phaseCorrelation`.
- **Largeur stéréo %** (énergie side) — `stereoWidth`.
- **Balance spectrale** grave / médium / aigu (FFT) — `spectralBands`.

## Analyseur de référence
Bouton « 📊 Analyser une référence » : importe un morceau pro → on mesure sa sonie, sa
dynamique, sa largeur et sa balance spectrale, puis on **compare à ton mix** et on affiche
des conseils **chiffrés** (`compareToRef`) : monter/baisser le niveau (LU), ajouter/retirer
des graves ou de l'air, élargir/resserrer la stéréo. Aucune donnée envoyée : tout est mesuré
localement.

## Honnêteté
- True Peak est une **estimation** (suréchantillonnage cubic), pas un mètre certifié ITU ;
  il attrape les dépassements inter-échantillon courants et borne vers −1 dBTP.
- La comparaison de référence se base sur des **mesures réelles** du fichier importé
  (spectre, sonie, dynamique, stéréo), pas sur une reproduction d'une chaîne propriétaire.

## Code et tests
- `public/js/lib/meters.js` (peak/rms/crest, truePeak, phase, largeur, bandes, analyze,
  compareToRef) + `test/meters.test.mjs` (7 tests).
- Intégration : `public/js/views/record.js` (mètres après master + analyseReference).
- Vérifié au navigateur : master → mètres, import référence → comparaison, aucune erreur JS.

## À venir (mastering avancé)
Compression multibande, compression parallèle, transient shaper, saturation harmonique
dédiée, profils d'export (streaming/club/CD), export MP3 — étapes suivantes.

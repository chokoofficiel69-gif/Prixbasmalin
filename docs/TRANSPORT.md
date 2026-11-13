# Transport pro — page Enregistrement

Barre de transport façon logiciel de rec. Tout en local, PC et Android.

## Fait (cette étape)
- **Barre de transport** (sous « Mes pistes ») : ⏮ / ⏯ / ⏺ / ⏹ (déjà là) + **🔁 Boucle**,
  position en **mesures:temps** et min:s (déjà là), **BPM** éditable, **tonalité** de l'instru.
- **Métronome** : on/off + volume, clic accentué sur le 1er temps, joué pendant la prise.
- **Décompte** avant la prise : 0, 1 ou 2 mesures de clics avant le départ.
- **Boucle de lecture** : 🔁 relit en boucle le passage/projet pendant l'écoute.
- **Raccourcis** : L = boucle (en plus de Espace lecture, R enregistrer, M muet, S solo,
  Ctrl+Z/Y, E/Suppr, N, F, flèches — déjà présents). Gros boutons tactiles conservés.
- **Zoom horizontal** sur la ligne de temps : déjà présent (🔍− / 🔍+ / ↔).
- Réglages mémorisés : `localStorage` clé `studio.transport` (+ `studio.bpm`).

Helpers purs et testés : `public/js/lib/daw.js` (mesures:temps, durée de décompte, clics du
métronome, aimantation, région de punch, fondu de comping, couleur par rôle) — voir
`test/daw.test.mjs` (`npm test`).

## Prises, comping, punch, grille (fait)
- **Prises empilées** : enregistre plusieurs fois dans la même piste **armée (●)** → chaque
  prise s'ajoute sous la piste (section « 🎚️ Prises & comping » de l'éditeur). On choisit la
  prise active (✓), on l'écoute (▶), on en supprime (✕).
- **Boucle d'enregistrement** : active 🔁, enregistre plusieurs tours en continu, puis
  **« ✂️ Découper l'enregistrement en prises »** (un tour = une prise ; longueur = le passage
  sélectionné). `splitLoopTakes` dans `comp.js`.
- **Comping** : sélectionne un passage, **« ➕ Mettre la prise active sur le passage »**, répète
  pour d'autres passages/prises, puis **« 🧩 Fusionner en une piste »** (fondus enchaînés de
  10 ms, puissance constante). `planComp` + `stitchMono` dans `comp.js`.
- **Punch-in** : sélectionne le passage à refaire, **« 🎯 Punch-in »**, re-chante : seul ce
  passage est remplacé (fondu 10 ms), la version d'avant est gardée en prise. `punchInMono`.
- **Grille** : **🧲 Aimant** (aimante les prises déplacées sur la grille du tempo),
  **zoom horizontal** (🔍) et **zoom vertical** (↕), **couleur par rôle** des prises
  (Lead/Double/Backs/Ad-lib/instru). `snapToGrid` + `colorForTrack` dans `daw.js`.

Logique pure et testée : `public/js/lib/comp.js` (+ `test/comp.test.mjs`).

## Code
- Interface + métronome + décompte : `public/js/views/record.js`.
- Vérifié bout-en-bout au navigateur (Chromium) : barre affichée, BPM, métronome, décompte
  avant la prise, boucle, enregistrement sans erreur.

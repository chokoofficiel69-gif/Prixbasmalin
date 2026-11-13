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

## À venir (étape suivante, plus lourde)
Ces points demandent de retoucher le modèle de prises et la ligne de temps ; ils ne sont pas
encore faits et ne sont donc pas annoncés comme tels :
- **Punch-in/out** : réenregistrer seulement le passage sélectionné, avec pré-roll de 2 s
  (helper `punchRegion` déjà prêt dans `daw.js`).
- **Boucle d'enregistrement** : plusieurs prises d'affilée empilées sous la piste.
- **Comping** : choisir le meilleur morceau de chaque prise avec fondus de 10 ms, puis
  « Fusionner en une piste » (helper `crossfadeSamples` prêt).
- **Aimantation (snap)** on/off et **zoom vertical**, **couleur par rôle** dans la ligne de
  temps (helper `colorForTrack` prêt).

## Code
- Interface + métronome + décompte : `public/js/views/record.js`.
- Vérifié bout-en-bout au navigateur (Chromium) : barre affichée, BPM, métronome, décompte
  avant la prise, boucle, enregistrement sans erreur.

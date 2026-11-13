# Ingé son IA — page Enregistrement

Mode assistant (interrupteur **🎚️ Ingé son IA**, activé par défaut) qui guide la prise
et traite chaque enregistrement automatiquement. **Tout le traitement audio est calculé
en local dans le navigateur** (gratuit, illimité) et fonctionne sur ordinateur et Android.
**Aucun son n’est envoyé à un LLM** : seules des mesures chiffrées le sont (voir § Conseils).

## Avant la prise
- **Test micro (5 s)** : enregistre 5 s, mesure le niveau (crête + RMS) et le bruit de
  fond, puis affiche des conseils (« parle plus près/plus loin », « baisse le gain » si ça
  sature, pièce trop bruyante…).
- **Analyser l’instru** : détecte la **tonalité** et le **BPM** de la piste « Instru »,
  mémorisés pour l’autotune (tonalité) et le delay (tempo).

## Pendant la prise
- **Vu-mètre en direct** avec alertes : *« ça sature »* si la crête dépasse −1 dBFS,
  *« trop faible »* sous −30 dBFS. (Niveau estimé à partir du flux micro ; approximation
  honnête, pas une mesure crête-échantillon exacte.)

## Après chaque prise (automatique)
1. **Rôle** proposé selon l’ordre des prises — Lead → Double → Back gauche → Back droite →
   Ad-lib — modifiable à tout moment (relance le traitement).
2. **Chaîne automatique selon les mesures** :
   - débruitage **dosé selon le bruit de fond** mesuré ;
   - anti-pop ; porte de bruit (coupe des blancs) ;
   - **calage automatique** sur l’instru (latence casque/micro puis alignement des attaques) ;
   - **autotune dans la tonalité** de l’instru, vitesse selon le rôle (lead naturel →
     ad-lib dur) ;
   - **chaîne voix** selon le rôle (EQ, compression, de-esser, saturation légère, réverb) ;
   - **volume** : Lead 0 dB · Double −9 dB · Backs −7 dB (**panoramique ±70 %**) ·
     Ad-libs −6 dB (**panoramique alterné**) ;
   - **écho au tempo** (delay/ping-pong calé sur le BPM) selon le rôle.
3. **Rapport en français** : ce qui a été fait, avec les mesures (niveau, bruit,
   **justesse avant/après**, **décalage corrigé en ms**, tempo, volume).
4. **1 à 3 conseils** pour la prise suivante, rédigés par le LLM du Studio **à partir des
   seules mesures chiffrées** (JSON de nombres, jamais d’audio). Si le LLM est indisponible,
   des conseils de secours fondés sur des règles simples sont affichés (marqués « hors ligne »).
5. **Comparer A/B** (prise brute ↔ traitée), **annuler étape par étape**, **prise brute
   conservée intacte** (bouton « Revenir à l’original »).
6. **Mixer et masteriser tout** : équilibre toutes les pistes selon leur rôle puis
   mastering avec le preset existant (preset préféré mémorisé).

## Réglages mémorisés
`localStorage` clé `studio_inge` : mode activé, traitement auto, preset de mastering, micro
brut. Proposés tels quels aux prochaines sessions.

## Code et tests
- Logique pure (décisions, mesures, rapport, invite LLM) : `public/js/lib/ingesong.js`,
  testée par `test/ingesong.test.mjs` (`npm test`). Aucune dépendance navigateur, donc
  vérifiable hors navigateur.
- Traitement audio réel : réutilise `public/js/lib/audio.js` et `public/js/lib/voicefx.js`.
- Intégration interface : `public/js/views/record.js`.
- Vérification bout-en-bout : Chromium (micro simulé) — rendu des contrôles, analyse de
  l’instru, enregistrement court → traitement automatique → rapport avec rôle + A/B.

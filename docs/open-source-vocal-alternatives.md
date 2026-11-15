# Alternatives vocales libres pour Studio IA

Ce document distingue les traitements intégrés au Studio IA des applications/plugins externes. Un navigateur ne charge pas directement les binaires VST3/AU/CLAP : les traitements de la banque intégrée sont des implémentations DSP indépendantes, tandis que les projets ci-dessous sont des références ou des outils à installer dans un hôte audio compatible.

## Références open source externes

| Besoin | Projet | Licence indiquée par le projet | Usage |
|---|---|---|---|
| Correction de justesse / hard-tune | [SnapTune](https://github.com/NicoFerni/snaptune) | AGPL-3.0 | Plugin VST3/AU/LV2, Windows/macOS/Linux |
| Correction de justesse, harmonies, formants et édition graphique | [OpenVoxTuner](https://github.com/EiffelBS/OpenVoxTuner) | AGPL-3.0 | VST3/AU/CLAP/Standalone selon plateforme |
| Harmoniseur vocal multi-voix | [Chorale](https://github.com/rithulkamesh/chorale) | Vérifier le fichier LICENSE du dépôt avant redistribution | Plugin vocal VST3/AU/Standalone |
| Vocodeur, doublage, pitch/formants, EQ, compresseur, de-esser | [SuperDuper DSP](https://github.com/fortunto2/superduper-dsp) | Vérifier les licences des composants et plugins du dépôt avant redistribution | Suite de plugins audio |
| Réduction de bruit par réseau neuronal | [RNNoise](https://github.com/xiph/rnnoise) | BSD-3-Clause | Bibliothèque DSP, intégration native/WASM à prévoir |
| Chaîne vocale et traitement créatif | [This Is The Voice](https://github.com/pehadavid/ThisIsTheVoice) | MIT | Plugin vocal CLAP/VST3/AU/LV2 |

## Correspondance avec les produits montrés

- Auto-Tune / Auto-Tune EFX+ : SnapTune et OpenVoxTuner comme plugins externes ; préréglages de correction de justesse dans le pack intégré.
- Harmony Engine / Choir / Duo : OpenVoxTuner et Chorale ; harmonies et doublage dans le pack intégré.
- Vocodist / Articulator : vocoder intégré existant, avec préréglages complémentaires.
- Mic Mod : chaîne intégrée EQ + compression + de-esser ; ce n'est pas une modélisation fidèle de microphones.
- Aspirer : débruitage spectral existant et porte de bruit ; RNNoise est une piste d'intégration distincte.
- Mutator / Gorge / Metamorph : transposition et déplacement de formants déjà présents, plus modulation ; pas de morphing neuronal entre deux timbres.
- Punch / Tranche / Chaud : compression, égalisation et saturation intégrées.

## Ce qui a été ajouté dans la banque Studio IA

Une catégorie « Pack vocal libre » ajoute des chaînes prêtes à essayer : correction naturelle/hard-tune, rap mélodique, harmonies, chœur, vocoder, talkbox, nettoyage/gate, doublage, micro studio, modulation/formants, voix percutante, attaque/présence, formants graves et saturation chaude.

Les nouveaux blocs DSP de cette banque sont implémentés indépendamment dans le projet : EQ 3 bandes, compresseur, gate, de-esser et phaser. Ils ne sont pas des copies du code des plugins cités.

## Licences et limites

Le projet Studio IA est actuellement déclaré MIT. Les sources AGPL (notamment SnapTune et OpenVoxTuner) ne sont pas copiées dans le dépôt : leur code ne doit pas être incorporé dans le projet MIT sans décision explicite sur la licence globale. Les outils externes restent gratuits à utiliser selon leurs propres conditions. Toujours conserver les notices de licence lors d'une éventuelle redistribution.

# Studio IA — architecture audio complète (cible navigateur)

Statut : architecture de référence et socle d'intégration. Ce document ne signifie pas que tous les modules externes sont déjà intégrés ou livrés en production.

## 1. Objectif produit

Faire évoluer le Studio IA existant en station audio multipiste orientée voix, utilisable dans Chrome/Edge sans installation native obligatoire, tout en conservant les fonctions, données et traitements déjà présents.

Principes non négociables :
- préserver l'enregistrement, les prises, l'édition, le mixage, les exports et les projets existants ;
- aucun effet ne doit apparaître comme disponible si son binaire, sa licence ou son test audio manque ;
- chaque plugin est chargé à la demande, jamais les 142 modules au démarrage ;
- audio temps réel dans AudioWorklet/WASM ; rendu destructif hors ligne dans OfflineAudioContext ou moteur dédié ;
- les modules externes gardent leur attribution et leur licence, vérifiées individuellement ;
- pas de scraping, API payante, compte fournisseur, clé secrète ou abonnement requis ;
- aucune fusion ou publication automatique.

## 2. Architecture cible

```
UI Studio IA (timeline / pistes / mixeur / racks / presets / assistant)
        |
        v
StudioAudioFacade  <--- API stable consommée par les vues existantes
        |
        +-- ProjectSession (projets, autosave, undo/redo, versioning)
        +-- TrackGraph (tracks, clips, sends, buses, automation)
        +-- Transport (play/stop/seek/loop/metronome/count-in)
        +-- PluginRegistry (catalogue, recherche, tags, licences, compatibilité)
        +-- PluginHost (chargement, instances, paramètres, bypass, état)
        +-- PresetService (chaînes, snapshots, import/export)
        +-- MidiService (notes, contrôleurs, instruments)
        +-- RenderService (offline render, stems, WAV, peaks, LUFS)
        +-- AudioHealth (CPU, xruns/dropouts, latence, mémoire, clipping)
        |
        v
Audio runtime
  A. Web Audio natif : gain, pan, filtres, dynamics, analyser, sends
  B. AudioWorklet + WASM : plugins DSP Wadspa / Faust compilés pour navigateur
  C. OfflineAudioContext : traitement destructif et export
  D. Native bridge (option ultérieure) : CLAP/VST3 uniquement si un hôte local existe
```

Le navigateur ne charge pas directement un fichier VST3/AU/CLAP natif. Ces formats restent des applications/plugins externes ou nécessitent un hôte local séparé. Le chemin web prioritaire est AudioWorklet + WASM.

## 3. Moteur audio et responsabilités

### 3.1 AudioContext unique
- créer le contexte au premier geste utilisateur ;
- conserver un seul contexte par session et gérer suspend/resume ;
- négocier sample rate et latence avec le navigateur ;
- garder le transport et l'horloge audio indépendants de l'horloge UI ;
- ne jamais faire de calcul DSP lourd dans le thread UI.

### 3.2 Routage de piste
Chaque piste suit ce graphe logique :
```
Clip/Source -> Trim -> Insert 1..N -> Fader -> Pan -> Sends -> Bus/Master
```
Chaque bus possède la même chaîne insert/fader/pan/sends. Le master possède EQ correctif, dynamique, limiteur true-peak et mesure LUFS. Le limiteur final doit être le dernier traitement avant sortie.

### 3.3 Temps réel et rendu
- AudioWorklet pour tout DSP continu ;
- WASM pour les plugins compilés ;
- OfflineAudioContext pour rendu/export et traitements destructifs ;
- les opérations de découpe, gain de clip, fondu et déplacement restent non destructives ;
- les effets avec latence déclarent leur latence et le moteur compense l'alignement des pistes (PDC) avant le mixage.

## 4. Catalogue et passerelles de plugins

### 4.1 Wadspa — premier fournisseur web à intégrer
Le dépôt public Wadspa annonce 142 modules compilés en WASM : 112 effets et 30 instruments. Son README documente `loadPlugin(ctx, pluginModule)`, les entrées/sorties audio, les commandes `set(name, value)`, les événements MIDI `noteOn/noteOff` et un pipeline AudioWorklet.
Les packages npm `@wadspa/core`, `@wadspa/plugins` et `@wadspa/toolchain` sont encore marqués « coming soon » dans le README consulté. Il faut donc intégrer depuis une distribution réellement publiée ou construire/publier les assets à partir des sources après audit. Ne pas ajouter une dépendance npm supposée disponible.
Référence : https://github.com/wadspa/wadspa

### 4.2 Faust / FaustWasm
Faust permet de créer des DSP et de les compiler en WASM/AudioWorklet. FaustMod démontre un environnement de blocs DSP web, mais sa version consultée est GPL-3.0 et inclut des composants tiers GPL : ne pas copier son application ou son catalogue dans le projet MIT. Utiliser éventuellement libfaust/faustwasm ou des DSP écrits en interne après revue des licences de chaque composant.
Références : https://github.com/grame-cncm/faust ; https://github.com/thepacket/faustmod

### 4.3 Bibliothèques natives externes
- SuperDuper DSP : suite de plugins CLAP/VST3/AU ; excellente référence fonctionnelle pour de-esser, plosives, hum, de-click, doubles, vocoder, morph, EQ, mastering, instruments. Ne pas la présenter comme intégrée au navigateur.
- OpenVoxTuner et SnapTune : correction de justesse/harmonies natives, AGPL ; références ou outils externes tant que stratégie de licence non validée.
- Airwindows, LSP, ChowDSP : bibliothèques de référence à auditer plugin par plugin.
- RNNoise : candidat pour débruitage WASM, sous réserve de portage, tests et attribution.
Aucun code de ces projets ne doit être copié sans examen de sa licence et de ses dépendances.

## 5. Modules fonctionnels du Studio

| Domaine | Modules à proposer | Priorité |
|---|---|---:|
| Entrée / nettoyage | gain d'entrée, filtre coupe-bas, gate, de-esser, anti-pop, hum remover, de-click, denoise | P0 |
| Correction vocale | détection de tonalité, key/scale, pitch correction, note editor, retune speed, humanize, formants | P0 |
| Voix créative | pitch/formant, doubler, harmonizer, choir, vocoder, talkbox, ring mod, radio/telephone | P1 |
| EQ / dynamique | EQ paramétrique, shelves, notch, compresseur, multibande, expander, gate, limiteur | P0 |
| Temps / espace | reverb room/plate/hall, delay mono/stereo/ping-pong, chorus, flanger, phaser | P1 |
| Couleur | saturation, tape, tube, bitcrusher, transient shaper, exciter, stereo width | P1 |
| Instruments | synth analogique, FM, wavetable, sampler, piano, EP, basse, orgue, strings, drum synth | P2 |
| Mastering | loudness LUFS, true peak, EQ linéaire, compresseur bus, limiteur, export stems | P1 |
| Analyse | spectre, pitch trace, phase, correlation, loudness, clipping, tonalité/BPM | P1 |
| Workflow | presets, A/B, snapshots, automation, MIDI learn, undo/redo, import/export | P0 |

P0 = nécessaire pour une première version fiable ; P1 = production créative/mixage ; P2 = instruments avancés.

## 6. Catalogue Wadspa — instruments identifiés

Les IDs ci-dessous sont ceux annoncés par le README de Wadspa ; vérifier chaque entrée dans le catalogue généré et sa licence avant affichage/téléchargement.

- Synthés : `wadspa_synth`, `fm_synth`, `mda_DX10`, `mda_JX10`, `synthv1`, `amsynth`, `sorcer`, `string-machine`, `casynth`, `helm`, `zynaddsubfx`, `obxd`, `dexed`, `calf-monosynth`, `so-666`, `nekobi`, `vl1-emulator`, `juce-opl`, `adlplug`.
- Claviers / piano : `mda_EPiano`, `mda_Piano`, `so-kl5`, `setbfree`.
- Basse / acid : `so-404`, `nekobi`.
- Batterie : `drumkv1`, `geonkick`, `chowkick`.
- Sampler / soundfont : `tsf`, `samplv1`.
- Additif : `padthv1`.

Le catalogue complet du fournisseur annonce 30 instruments ; la liste doit être lue depuis le manifeste officiel généré et non maintenue à la main dans l'interface.

## 7. Registre de modules (métadonnées obligatoires)

Chaque module doit déclarer :
- `id`, `name`, `vendor`, `version`, `category`, `tags` ;
- `kind`: effect | instrument | analyzer | utility ;
- `runtime`: native-web-audio | audio-worklet-wasm | offline | external-native ;
- `formats`: wasm, CLAP, VST3, AU, LV2, standalone ;
- `license`, `licenseUrl`, `sourceUrl`, `attribution`, `redistributionAllowed` ;
- `loadMode`: lazy | built-in | external ;
- `inputChannels`, `outputChannels`, `midiInput`, `latencySamples` ;
- paramètres typés : nom, type, unité, min/max, défaut, échelle, valeur par défaut ;
- `status`: planned | audited | available | tested | blocked ;
- `tests`: load, audio-output, parameter-audibility, switching, memory, browser.

Aucun module ne passe à `available` tant que son asset est présent, sa licence validée, son audio vérifié et ses paramètres testés.

## 8. Interface utilisateur

### 8.1 Bibliothèque
- recherche par nom, fonction, fabricant, tags et type ;
- filtres « navigateur », « instrument », « voix », « mixage », « mastering », « open source » ;
- badge licence et lien vers source ;
- badge disponibilité : prêt, à télécharger, externe, bloqué ;
- bouton « Ajouter à la piste » seulement si le module est réellement chargeable.

### 8.2 Rack de piste
- insertions réordonnables ;
- bypass global et par module ;
- wet/dry, gain d'entrée/sortie ;
- paramètres générés depuis le manifeste ;
- sauvegarde de l'état du plugin dans le projet ;
- comparaison A/B et snapshots ;
- affichage de latence et de charge CPU.

### 8.3 Instruments
- clavier MIDI à l'écran, vélocité, sustain ;
- automation des contrôleurs ;
- presets et banque de sons ;
- rendu MIDI vers audio et export de stems.

## 9. Contrat technique du PluginHost

API cible :
```js
const host = createPluginHost({ audioContext, loadPlugin, pluginModule });
const effect = await host.addEffect(trackId, 'dj_eq', { 'Lo gain (dB)': -2 });
host.setParameter(effect.instanceId, 'Lo gain (dB)', -3);
host.setBypass(effect.instanceId, true);
const instrument = await host.addInstrument(trackId, 'fm_synth');
host.noteOn(instrument.instanceId, 60, 100);
host.noteOff(instrument.instanceId, 60);
await host.remove(effect.instanceId);
```
Le host est injecté avec le chargeur et le catalogue : le code applicatif ne dépend pas d'un chemin npm qui n'est pas publié. Les effets se connectent en série ; les instruments se connectent à la piste/bus. Toute instance a un identifiant stable et une méthode de destruction.

## 10. Format de projet et sauvegarde

Versionner le format de session :
```json
{
  "schemaVersion": 2,
  "audio": { "sampleRate": 48000, "tempo": 92, "meter": [4,4] },
  "tracks": [{
    "id": "track-1",
    "clips": [],
    "inserts": [{
      "instanceId": "fx-1",
      "pluginId": "dj_eq",
      "provider": "wadspa",
      "state": { "Lo gain (dB)": -2 },
      "bypass": false
    }],
    "automation": []
  }],
  "buses": [],
  "master": { "inserts": [] }
}
```
Migration obligatoire depuis les sessions existantes ; inconnus plugins conservés comme « indisponibles » sans supprimer leurs paramètres.

## 11. Sécurité, performance et robustesse

- charger les WASM depuis des assets locaux contrôlés, avec taille/hash et provenance ;
- aucune exécution de code récupéré dynamiquement depuis une URL non approuvée ;
- ne pas utiliser eval ou injecter du HTML de plugin ;
- limiter le nombre d'instances et la mémoire ; libérer AudioWorkletNode, buffers et listeners ;
- prévoir bypass d'urgence et retour au signal sec ;
- suspendre les analyseurs UI hors écran ;
- tester à 44,1/48/96 kHz, mono/stéréo et buffers de tailles différentes ;
- les modules threadés peuvent exiger cross-origin isolation ; ne pas les activer sans vérifier les headers du déploiement ;
- mesurer la charge audio réelle, pas seulement le temps CPU du thread UI.

## 12. Qualité et tests bloquants

Pour chaque plugin :
1. licence et provenance vérifiées ;
2. asset WASM présent et hashé ;
3. chargement AudioWorklet dans Chrome/Edge ;
4. sortie audio finie, non nulle et sans NaN/Infinity ;
5. chaque paramètre a un effet audible mesurable ;
6. switching A -> B -> A fonctionne ;
7. bypass et suppression rendent la mémoire ;
8. mono/stéréo et sample rates couverts ;
9. latence déclarée et compensation vérifiée ;
10. projet sauvegardé/rechargé avec paramètres exacts.

Tests globaux : lecture/enregistrement existants, timeline, prises, undo/redo, export WAV, stems, crash recovery et projet ancien.

## 13. Plan de réalisation de A à Z

- Phase 0 — inventaire : auditer les vues et le moteur audio existants, cartographier les appels et ne rien remplacer.
- Phase 1 — fondation : PluginRegistry, schéma, PluginHost, tests unitaires mockés, feature flags.
- Phase 2 — premier runtime WASM : vérifier la disponibilité réelle de Wadspa ; sinon construire les sources dans un pipeline contrôlé et publier les assets du projet après audit de licence.
- Phase 3 — effets P0 : EQ, compresseur, gate, de-esser, filtres, reverb, delay, limiter.
- Phase 4 — instruments : FM synth, piano/EP, synth analogique, drum synth, sampler, bass synth.
- Phase 5 — voix : pitch correction, formants, harmonies, doubler, vocoder, denoise neuronal.
- Phase 6 — interface : bibliothèque, rack, paramètres, presets, A/B, MIDI, automation.
- Phase 7 — mastering : LUFS, true peak, stems, rendu offline, PDC.
- Phase 8 — audit : tests réels sur Chrome/Edge, CPU, latence, projets sauvegardés et réouverture.
- Phase 9 — activation progressive : flag par module, aucun remplacement de moteur, rollback simple.

## 14. Hors périmètre / non-promesses

- pas de prétention à cloner exactement Auto-Tune, Harmony Engine ou les produits Antares ;
- pas de plugins VST3 natifs dans le navigateur ;
- pas de dépendance npm Wadspa tant que les packages sont annoncés « coming soon » ;
- pas d'affirmation que RNNoise, SuperDuper DSP, FaustMod ou OpenVoxTuner sont intégrés tant que leurs binaires et tests ne sont pas dans le projet ;
- pas de fusion ni de déploiement sans vérification et autorisation.

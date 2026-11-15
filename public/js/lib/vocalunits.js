// Banques de processeurs vocaux « inspirées du matériel pro » (HeadRush VX5, TC-Helicon
// VoiceTone C1 / Perform-V, Mooer MVP1, Audota AVE-100, Tascam TA-1VP, Waves Tune RT,
// BOSS VE-22). Les NOMS de presets d'origine servent de références ; les traitements sont
// NOTRE moteur (EQ + comp + sat + chorus + reverb + echo + autotune), pas les algorithmes
// propriétaires. Chaque preset renvoie un objet `fx` compatible avec les molettes « live »
// de la page Enregistrement + un descripteur d'autotune {speed, humanize}. Logique pure,
// testable sous Node.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Clés fx reconnues par la console live (voir record.js KN / FX_DEF).
// On ne renseigne que les clés utiles ; le reste reste à 0 (neutre).

/** Parse un nom de preset HeadRush VX5 en réglages de notre moteur. */
export function headrushFx(name) {
  const s = String(name).toLowerCase();
  const fx = {};
  const tune = { speed: 0.3, humanize: 0.3 };
  // Dureté de correction
  if (/hard/.test(s)) { fx.tune = 0.95; tune.speed = 1; tune.humanize = 0; }
  else if (/warm/.test(s)) { fx.tune = 0.6; tune.speed = 0.45; tune.humanize = 0.4; fx.warmth = 2; }
  else if (/soft/.test(s)) { fx.tune = 0.42; tune.speed = 0.28; tune.humanize = 0.5; }
  else if (/mild/.test(s)) { fx.tune = 0.3; tune.speed = 0.22; tune.humanize = 0.6; }
  else fx.tune = 0.72;
  // Réverbe
  if (/verb|hall|room|chamber|ambient|church|tail/.test(s)) {
    let amt = 0.26;
    if (/verb3|church|hall/.test(s)) amt = 0.5;
    else if (/verb2|chamber/.test(s)) amt = 0.38;
    else if (/ambient|room|verb1/.test(s)) amt = 0.22;
    fx.reverb = amt;
  }
  // Délai / écho
  if (/echo|slap|pong|dub|delay|rhythmic|resonator/.test(s)) {
    let amt = 0.3;
    if (/long|dub|rhythmic|pong/.test(s)) amt = 0.5;
    else if (/slap|short/.test(s)) amt = 0.18;
    fx.echo = amt;
  }
  // Harmonies (approximées par épaississement chorus + présence)
  if (/oct/.test(s)) { fx.chorus = 0.45; fx.pres = 2; }
  if (/5th|5hi|5lo|5ths|fifth/.test(s)) fx.chorus = Math.max(fx.chorus || 0, 0.32);
  if (/3hi|3lo|3rd/.test(s)) fx.chorus = Math.max(fx.chorus || 0, 0.26);
  // Caractère / couleur
  if (/lofi|lo-fi/.test(s)) { fx.sat = 0.4; fx.air = -5; fx.sub = -4; }
  if (/radio|phone/.test(s)) { fx.sub = -10; fx.low = -6; fx.air = -8; fx.pres = 4; fx.mid = 3; fx.sat = 0.32; }
  if (/tube/.test(s)) { fx.sat = 0.5; fx.warmth = 3; }
  if (/sizz|zing/.test(s)) { fx.air = 5; fx.sat = 0.35; fx.pres = 2; }
  if (/juice|wow/.test(s)) { fx.chorus = Math.max(fx.chorus || 0, 0.3); fx.sat = 0.25; }
  if (/mega/.test(s)) { fx.sat = 0.6; fx.mid = 5; fx.sub = -6; fx.air = -4; }
  if (/tubular/.test(s)) { fx.reverb = Math.max(fx.reverb || 0, 0.4); fx.chorus = 0.3; }
  if (/spooky|crazi|flo/.test(s)) { fx.chorus = Math.max(fx.chorus || 0, 0.5); fx.echo = Math.max(fx.echo || 0, 0.35); }
  // borne finale
  for (const k in fx) fx[k] = typeof fx[k] === 'number' ? fx[k] : 0;
  return { fx, tune };
}

// Les 99 presets d'usine documentés du HeadRush VX5 (noms d'origine, références).
export const HEADRUSH_NAMES = [
  'Hard Tune', 'Warm Tune', 'Soft Tune', 'Mild Tune', 'Octaves', 'Fifths', 'HardVerb1', 'HardVerb2', 'HardVerb3',
  'WarmVerb1', 'WarmVerb2', 'WarmVerb3', 'SoftVerb1', 'SoftVerb2', 'SoftVerb3', 'MildVerb1', 'MildVerb2', 'MildVerb3',
  'HardSlap', 'HardEcho', 'HardPong', 'WarmSlap', 'WarmEcho', 'WarmDub', 'SoftSlap', 'SoftEcho', 'SoftPong',
  'MildSlap', 'MildEcho', 'MildTail', 'Oct Vox', 'WarmSizzl', 'Oct LoFi', 'WarmZing', 'Oct Radio', 'HardJuice',
  'WarmJuice', 'SoftJuice', 'MildJuice', 'HardWow', 'WarmWow', 'SoftWow', 'MildWow', 'Hall', 'Room', 'Chamber',
  'Ambient', 'Church', 'SlapBack', 'ShortEcho', 'Long Echo', 'PingPong', 'DubDelay', 'Rhythmic', 'Resonator',
  'Chorus', 'Smooth C', 'Deep C', 'Heavy C', 'Robot C', '3HiVerbMj', '3HiVerbMn', '5HiVerb', 'OctHiVerb',
  '3LoVerbMj', '3LoVerbMn', '5LoVerb', 'OctLoVerb', 'DblOctVrb', '5ths Verb', 'Sizzle', 'HardSiz', 'HarmSiz',
  'LoFi', 'HardLoFi', 'HarmLoFi', 'Tube', 'HardTube', 'HarmTube', 'Zinger', 'HardZing', 'HarmZing', 'Radio',
  'HardRadio', 'HarmRadio', 'Mega', 'HardMega', 'HarmMega', 'Phone', 'HardPhone', 'HarmPhone', 'Crazinger',
  'Flosizzle', 'MinorLoFi', 'MajorLoFi', 'RadioGaGa', 'Tubular', 'SpookyHrm', 'MeloMinor',
];

// Gammes pour le Tascam TA-1VP (25 presets de gammes documentés : chromatique + 12 majeures + 12 mineures).
const KEYS = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
function tascamPresets() {
  const out = [{ n: 1, name: 'Chromatic', fx: { tune: 0.8 }, tune: { speed: 0.6, humanize: 0.2 }, note: 'Correction chromatique (toutes les notes)' }];
  KEYS.forEach((k, i) => out.push({ n: i + 2, name: `${k} Major`, fx: { tune: 0.85, comp: 0.4, deess: -2 }, tune: { speed: 0.7, humanize: 0.2 }, scale: `${k} maj`, note: 'Channel strip + correction sur gamme majeure' }));
  KEYS.forEach((k, i) => out.push({ n: i + 14, name: `${k} Minor`, fx: { tune: 0.85, comp: 0.4, deess: -2 }, tune: { speed: 0.7, humanize: 0.2 }, scale: `${k} min`, note: 'Channel strip + correction sur gamme mineure' }));
  return out;
}

// Waves Tune Real-Time : profils par tessiture (références) + réglages de correction détaillés.
const WAVES_RANGES = [
  ['Bass', 0.9, 2.5], ['Baritone', 0.85, 1.5], ['Tenor', 0.8, 0], ['Alto', 0.78, -1],
  ['Mezzo Soprano', 0.75, -2], ['Soprano', 0.72, -3],
];
function wavesPresets() {
  const out = [];
  let n = 1;
  for (const [range, amount, lowDb] of WAVES_RANGES) {
    out.push({ n: n++, name: `${range} · Natural`, fx: { tune: amount, low: lowDb, comp: 0.25 }, tune: { speed: 0.35, humanize: 0.5, formant: true }, note: 'Correction naturelle, formant préservé, vibrato gardé' });
    out.push({ n: n++, name: `${range} · Tight`, fx: { tune: Math.min(1, amount + 0.08), low: lowDb, pres: 2 }, tune: { speed: 0.9, humanize: 0.1, formant: true }, note: 'Transition rapide, tolérance faible' });
  }
  return out;
}

// Construit les 8 appareils avec leurs banques.
function buildUnits() {
  const units = [];

  units.push({
    id: 'headrush', name: 'Boîtier scène · 99 presets', ref: 'inspiré du HeadRush VX5',
    presets: HEADRUSH_NAMES.map((name, i) => { const { fx, tune } = headrushFx(name); return { n: i + 1, name, fx, tune }; }),
  });

  units.push({
    id: 'voicetone', name: 'Correcteur + Gender', ref: 'inspiré du TC-Helicon VoiceTone C1',
    presets: [
      { n: 1, name: 'Chromatic Soft', fx: { tune: 0.45 }, tune: { speed: 0.3, humanize: 0.5 }, note: 'Correction chromatique douce' },
      { n: 2, name: 'Chromatic Hard (HardTune)', fx: { tune: 0.97 }, tune: { speed: 1, humanize: 0 }, note: 'Effet robot, snap immédiat' },
      { n: 3, name: 'Key Natural', fx: { tune: 0.6, comp: 0.3 }, tune: { speed: 0.4, humanize: 0.45 }, note: 'Correction sur tonalité' },
      { n: 4, name: 'Gender Deep', fx: { tune: 0.6, warmth: 3, low: 2, air: -2 }, tune: { speed: 0.4, humanize: 0.4, formant: true }, note: 'Voix plus grave/épaisse (formant)' },
      { n: 5, name: 'Gender Bright', fx: { tune: 0.6, air: 4, pres: 2, low: -2 }, tune: { speed: 0.4, humanize: 0.4, formant: true }, note: 'Voix plus claire (formant)' },
    ],
  });

  units.push({
    id: 'mooer', name: 'Compact · couleurs & délais', ref: 'inspiré du Mooer MVP1 Autuner',
    presets: (() => {
      const colors = [['Flat', {}], ['Warm', { warmth: 3, air: -1, sat: 0.2 }], ['Bright', { air: 4, pres: 2 }]];
      const spaces = [['Room', { reverb: 0.22 }], ['Hall', { reverb: 0.45 }], ['Plate', { reverb: 0.32, air: 2 }]];
      const delays = [['Tape', { echo: 0.3, warmth: 2 }], ['Digital', { echo: 0.3 }], ['Slapback', { echo: 0.16 }]];
      const out = []; let n = 1;
      for (const [c, cfx] of colors) for (const [s, sfx] of spaces) out.push({ n: n++, name: `${c} · ${s}`, fx: { tune: 0.7, ...cfx, ...sfx }, tune: { speed: 0.4, humanize: 0.35 } });
      for (const [c, cfx] of colors) for (const [d, dfx] of delays) out.push({ n: n++, name: `${c} · ${d}`, fx: { tune: 0.7, ...cfx, ...dfx }, tune: { speed: 0.4, humanize: 0.35 } });
      return out;
    })(),
  });

  units.push({
    id: 'performv', name: 'Perform · Double/Reverb/Echo/Tone', ref: 'inspiré du TC-Helicon Perform-V',
    presets: [
      { n: 1, name: 'Double', fx: { tune: 0.65, chorus: 0.4, pres: 2 }, tune: { speed: 0.4, humanize: 0.4 }, note: 'Doublage vocal' },
      { n: 2, name: 'Double Octaves', fx: { tune: 0.65, chorus: 0.5, low: 2 }, tune: { speed: 0.4, humanize: 0.4 }, note: 'Doublage + octaves' },
      { n: 3, name: 'Reverb Room', fx: { tune: 0.7, reverb: 0.24 }, tune: { speed: 0.45, humanize: 0.35 } },
      { n: 4, name: 'Reverb Club', fx: { tune: 0.7, reverb: 0.36 }, tune: { speed: 0.45, humanize: 0.35 } },
      { n: 5, name: 'Reverb Hall', fx: { tune: 0.7, reverb: 0.5 }, tune: { speed: 0.45, humanize: 0.35 } },
      { n: 6, name: 'Echo 1/4', fx: { tune: 0.7, echo: 0.45 }, tune: { speed: 0.45, humanize: 0.35 } },
      { n: 7, name: 'Echo 1/8', fx: { tune: 0.7, echo: 0.3 }, tune: { speed: 0.45, humanize: 0.35 } },
      { n: 8, name: 'Echo Slap', fx: { tune: 0.7, echo: 0.16 }, tune: { speed: 0.45, humanize: 0.35 } },
      { n: 9, name: 'Tone (EQ+Comp+DeEss)', fx: { tune: 0.6, comp: 0.5, deess: -3, pres: 2, air: 2 }, tune: { speed: 0.4, humanize: 0.4 }, note: 'Channel strip voix' },
      { n: 10, name: 'Pitch (correction seule)', fx: { tune: 0.8 }, tune: { speed: 0.6, humanize: 0.3 } },
    ],
  });

  units.push({
    id: 'audota', name: 'Multi-effets · Harmonies', ref: "inspiré de l'Audota AVE-100",
    presets: [
      { n: 1, name: 'Auto Soft + Harm 3rd', fx: { tune: 0.5, chorus: 0.26, reverb: 0.2 }, tune: { speed: 0.3, humanize: 0.5 } },
      { n: 2, name: 'Auto Soft + Harm 5th', fx: { tune: 0.5, chorus: 0.32, reverb: 0.2 }, tune: { speed: 0.3, humanize: 0.5 } },
      { n: 3, name: 'Auto Soft + Harm Oct', fx: { tune: 0.5, chorus: 0.45, low: 2 }, tune: { speed: 0.3, humanize: 0.5 } },
      { n: 4, name: 'Auto Hard + Harm 3rd', fx: { tune: 0.95, chorus: 0.26, echo: 0.2 }, tune: { speed: 1, humanize: 0 } },
      { n: 5, name: 'Auto Hard + Harm 5th', fx: { tune: 0.95, chorus: 0.32, echo: 0.2 }, tune: { speed: 1, humanize: 0 } },
      { n: 6, name: 'Auto Hard + Harm Oct', fx: { tune: 0.95, chorus: 0.45, echo: 0.25 }, tune: { speed: 1, humanize: 0 } },
      { n: 7, name: 'Echo stéréo', fx: { tune: 0.7, echo: 0.4 }, tune: { speed: 0.45, humanize: 0.35 } },
      { n: 8, name: 'Reverb + Exciter', fx: { tune: 0.7, reverb: 0.4, air: 3, pres: 2 }, tune: { speed: 0.45, humanize: 0.35 } },
    ],
  });

  units.push({ id: 'tascam', name: 'Rack · 25 gammes + channel strip', ref: 'inspiré du Tascam TA-1VP', presets: tascamPresets() });

  units.push({ id: 'waves', name: 'Correction temps réel · tessitures', ref: 'inspiré de Waves Tune Real-Time', presets: wavesPresets() });

  units.push({
    id: 'boss', name: 'Multi-effets · 39 types', ref: 'inspiré du BOSS VE-22',
    presets: (() => {
      const types = [
        ['Autopitch Soft', { tune: 0.5 }, { speed: 0.3, humanize: 0.5 }], ['Autopitch Hard', { tune: 0.97 }, { speed: 1, humanize: 0 }],
        ['Harmony 3rd', { tune: 0.6, chorus: 0.26 }], ['Harmony 5th', { tune: 0.6, chorus: 0.32 }], ['Harmony Oct', { tune: 0.6, chorus: 0.45 }],
        ['Doubling', { chorus: 0.4, pres: 2 }], ['Compressor', { comp: 0.6 }], ['EQ Bright', { air: 4, pres: 3 }], ['EQ Warm', { warmth: 3, air: -2 }],
        ['Delay 1/4', { echo: 0.45 }], ['Delay 1/8', { echo: 0.3 }], ['Echo Slap', { echo: 0.16 }], ['Reverb Room', { reverb: 0.24 }],
        ['Reverb Hall', { reverb: 0.5 }], ['Lo-Fi', { sat: 0.4, air: -5, sub: -4 }], ['Distortion', { sat: 0.75, pres: 2 }], ['Radio', { sub: -10, low: -6, air: -8, mid: 3, sat: 0.3 }],
        ['Megaphone', { sat: 0.6, mid: 5, sub: -6, air: -4 }], ['Ring Mod', { sat: 0.5, chorus: 0.4 }], ['Modulation (Chorus)', { chorus: 0.5 }],
        ['Phone', { sub: -12, low: -8, air: -10, mid: 4 }], ['Tube', { sat: 0.5, warmth: 3 }], ['Sizzle', { air: 5, sat: 0.35 }],
        ['Vocoder-ish', { tune: 0.97, chorus: 0.5, sat: 0.3 }, { speed: 1, humanize: 0 }], ['Whisper Air', { air: 6, comp: 0.3, sub: -4 }],
      ];
      return types.map(([name, fx, tune], i) => ({ n: i + 1, name, fx: { tune: 0.7, ...fx }, tune: tune || { speed: 0.45, humanize: 0.35 } }));
    })(),
  });

  return units;
}

export const UNITS = buildUnits();
export const UNIT_ORDER = UNITS.map(u => u.id);

/** Nombre total de presets toutes banques confondues. */
export function totalPresets() { return UNITS.reduce((a, u) => a + u.presets.length, 0); }

/** Appareil par id (repli : premier). */
export function unitById(id) { return UNITS.find(u => u.id === id) || UNITS[0]; }

/** Preset par index (0-based) dans un appareil, borné. */
export function presetAt(unitId, index) {
  const u = unitById(unitId);
  const i = ((index % u.presets.length) + u.presets.length) % u.presets.length;
  return u.presets[i];
}

/**
 * Construit l'objet fx (clés molettes live) à appliquer pour un preset, borné proprement.
 * Renvoie { fx, tune, label }. `tune` = {speed, humanize, formant?} pour l'autotune.
 */
export function buildFx(unitId, index) {
  const u = unitById(unitId);
  const p = presetAt(unitId, index);
  const raw = p.fx || {};
  const fx = {};
  for (const k in raw) {
    let v = raw[k];
    if (k === 'tune') v = clamp(v, 0, 1);
    else if (k === 'comp' || k === 'sat') v = clamp(v, 0, 1);
    else if (k === 'chorus') v = clamp(v, 0, 0.7);
    else if (k === 'reverb') v = clamp(v, 0, 0.7);
    else if (k === 'echo') v = clamp(v, 0, 0.6);
    else v = clamp(v, -12, 12); // bandes EQ en dB
    fx[k] = v;
  }
  return { fx, tune: p.tune || { speed: 0.4, humanize: 0.35 }, label: `${u.ref} · ${String(p.n).padStart(2, '0')} ${p.name}`, name: p.name, n: p.n };
}

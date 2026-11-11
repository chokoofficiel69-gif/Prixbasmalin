// Moteur de composition : transforme une partition simple (JSON) en audio réel,
// avec des instruments synthétisés (batterie, 808, basse, nappes, piano, lead).
import { SR, mix } from './audio.js';

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11] };
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

export const STYLES = {
  trap: { label: 'Trap', bpm: 140, scale: 'minor', key: 'F', swing: 0, progression: ['Fm', 'Db', 'Ab', 'Eb'],
    drums: { kick: 'x.........x.....', snare: '........x.......', hat: 'x.xxx.x.x.xxx.xx', openhat: '..............x.', clap: '........x.......' },
    bass: { type: '808', pattern: 'x.........x...x.' }, pad: 'dark', lead: 'bell', leadPattern: 'x..x..x...x..x..', halftime: true },
  boombap: { label: 'Boom bap', bpm: 90, scale: 'minor', key: 'A', swing: 0.18, progression: ['Am7', 'Dm7', 'Gmaj7', 'Cmaj7'],
    drums: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', openhat: '', clap: '' },
    bass: { type: 'synth', pattern: 'x.....x...x...x.' }, pad: 'keys', lead: 'piano', leadPattern: 'x...x.x.....x...' },
  drill: { label: 'Drill', bpm: 142, scale: 'harmonic', key: 'C#', swing: 0, progression: ['C#m', 'A', 'F#m', 'G#'],
    drums: { kick: 'x.........x.....', snare: '...........x....', hat: 'x..x..x.x..x.x..', openhat: '', clap: '...........x....' },
    bass: { type: '808', pattern: 'x.....x...x.x...' }, pad: 'strings', lead: 'bell', leadPattern: 'x.x...x.x...x...', halftime: true },
  afro: { label: 'Afro / amapiano', bpm: 112, scale: 'major', key: 'G', swing: 0.08, progression: ['Gmaj7', 'Em7', 'Cmaj7', 'D'],
    drums: { kick: 'x...x...x...x...', snare: '......x.......x.', hat: '..x...x...x...x.', openhat: '', clap: '....x.......x...' },
    bass: { type: 'synth', pattern: 'x..x..x...x..x..' }, pad: 'keys', lead: 'pluck', leadPattern: 'x.x..x.x..x.x...' },
  lofi: { label: 'Lo-fi chill', bpm: 80, scale: 'major', key: 'D', swing: 0.2, progression: ['Dmaj7', 'Bm7', 'Em7', 'A7'],
    drums: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', openhat: '', clap: '' },
    bass: { type: 'synth', pattern: 'x.......x.......' }, pad: 'keys', lead: 'piano', leadPattern: 'x...x...x.x.....', lofi: true },
  pop: { label: 'Pop', bpm: 118, scale: 'major', key: 'C', swing: 0, progression: ['C', 'G', 'Am', 'F'],
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', openhat: '', clap: '....x.......x...' },
    bass: { type: 'synth', pattern: 'x.x.x.x.x.x.x.x.' }, pad: 'warm', lead: 'pluck', leadPattern: 'x..x..x.x..x..x.' },
  house: { label: 'House', bpm: 124, scale: 'minor', key: 'A', swing: 0, progression: ['Am', 'F', 'C', 'G'],
    drums: { kick: 'x...x...x...x...', snare: '', hat: '..x...x...x...x.', openhat: '..x...x...x...x.', clap: '....x.......x...' },
    bass: { type: 'synth', pattern: '..x...x...x...x.' }, pad: 'warm', lead: 'saw', leadPattern: 'x.x.x...x.x.x...' },
  ambient: { label: 'Ambiance / cinéma', bpm: 70, scale: 'minor', key: 'E', swing: 0, progression: ['Em', 'C', 'G', 'D'],
    drums: { kick: 'x...............', snare: '', hat: '', openhat: '', clap: '' },
    bass: { type: 'synth', pattern: 'x...............' }, pad: 'strings', lead: 'bell', leadPattern: 'x.......x.......' },
};

export function defaultSong(style = 'trap') {
  const s = STYLES[style] || STYLES.trap;
  return {
    title: 'Nouveau morceau', style, bpm: s.bpm, key: s.key, scale: s.scale, swing: s.swing,
    progression: [...s.progression],
    drums: { ...s.drums }, bass: { ...s.bass }, pad: s.pad, lead: s.lead, leadPattern: s.leadPattern, melody: null,
    halftime: !!s.halftime, lofi: !!s.lofi,
    sections: [
      { name: 'Intro', bars: 4, layers: ['pad', 'hat'] },
      { name: 'Couplet', bars: 8, layers: ['drums', 'bass', 'pad'] },
      { name: 'Refrain', bars: 8, layers: ['drums', 'bass', 'pad', 'lead'] },
      { name: 'Couplet', bars: 8, layers: ['drums', 'bass', 'pad'] },
      { name: 'Refrain', bars: 8, layers: ['drums', 'bass', 'pad', 'lead'] },
      { name: 'Outro', bars: 4, layers: ['pad', 'lead'] },
    ],
    mixer: { drums: 0, bass: 0, chords: -3, lead: -4 },
  };
}

/** Normalise une composition (éventuellement proposée par l'IA) pour qu'elle soit toujours jouable. */
export function sanitizeSong(input) {
  const base = defaultSong(STYLES[input?.style] ? input.style : 'trap');
  const s = { ...base, ...(input || {}) };
  s.bpm = Math.min(200, Math.max(50, Number(s.bpm) || base.bpm));
  s.key = NOTE[s.key] !== undefined ? s.key : String(s.key || '').replace(/m$/, '') in NOTE ? String(s.key).replace(/m$/, '') : base.key;
  s.scale = SCALES[s.scale] ? s.scale : base.scale;
  s.swing = Math.min(0.4, Math.max(0, Number(s.swing) || 0));
  const pat = (p, d = '') => (typeof p === 'string' ? p.replace(/[^xX.\-o0-9]/g, '').replace(/[X0-9o]/g, 'x').replace(/-/g, '.') : d).padEnd(16, '.').slice(0, 16);
  s.drums = { ...base.drums, ...(s.drums || {}) };
  for (const k of ['kick', 'snare', 'hat', 'openhat', 'clap']) s.drums[k] = pat(s.drums[k], '');
  s.bass = { ...base.bass, ...(s.bass || {}) };
  s.bass.pattern = pat(s.bass.pattern, base.bass.pattern);
  s.leadPattern = pat(s.leadPattern, base.leadPattern);
  s.progression = (Array.isArray(s.progression) ? s.progression : base.progression).map(String).filter(c => parseChord(c, s)).slice(0, 8);
  if (!s.progression.length) s.progression = base.progression;
  s.sections = (Array.isArray(s.sections) ? s.sections : base.sections).slice(0, 16).map(x => ({
    name: String(x.name || 'Partie').slice(0, 30), bars: Math.min(32, Math.max(1, Number(x.bars) || 4)),
    layers: (Array.isArray(x.layers) ? x.layers : ['drums', 'bass', 'pad']).filter(l => ['drums', 'kick', 'hat', 'bass', 'pad', 'lead'].includes(l)),
  }));
  if (!s.sections.length) s.sections = base.sections;
  s.mixer = { ...base.mixer, ...(s.mixer || {}) };
  if (Array.isArray(s.melody)) s.melody = s.melody.slice(0, 32).map(n => (n === null || n === '.' ? null : Number(n))).map(n => (Number.isFinite(n) ? Math.max(-7, Math.min(14, n)) : null));
  else s.melody = null;
  return s;
}

/** Accord « Am7 », « F#m », « Bb », « Gsus4 »… → notes MIDI. */
export function parseChord(name, song) {
  const m = /^([A-G](?:#|b)?)(maj7|m7|m9|maj9|m|dim|aug|sus2|sus4|7|9|add9)?$/.exec(String(name).trim());
  if (!m) return null;
  const root = NOTE[m[1]];
  const q = m[2] || '';
  const iv = { '': [0, 4, 7], m: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 7: [0, 4, 7, 10], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], 9: [0, 4, 7, 10, 14], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14] }[q];
  return { root, notes: iv.map(i => 48 + root + i) };
}

// ---------------- Instruments ----------------
function noiseBuffer(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function env(g, t, a, peak, d, sustain = 0, release = 0.05, end) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain || 0.0001), t + a + d);
  if (end) { g.gain.setValueAtTime(Math.max(0.0001, peak * sustain || 0.0001), end); g.gain.exponentialRampToValueAtTime(0.0001, end + release); }
}
function saturator(ctx, amount = 2) {
  const ws = ctx.createWaveShaper();
  const c = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  ws.curve = c;
  return ws;
}

const DRUM = {
  kick(ctx, out, t, v = 1) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    env(g, t, 0.002, 1.0 * v, 0.38);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.45);
  },
  snare(ctx, out, t, v = 1, noise) {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
    const g = ctx.createGain(); env(g, t, 0.001, 0.7 * v, 0.18);
    n.connect(bp).connect(g).connect(out); n.start(t); n.stop(t + 0.25);
    const o = ctx.createOscillator(), g2 = ctx.createGain(); o.type = 'triangle';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    env(g2, t, 0.001, 0.5 * v, 0.1); o.connect(g2).connect(out); o.start(t); o.stop(t + 0.15);
  },
  clap(ctx, out, t, v = 1, noise) {
    for (const dt of [0, 0.012, 0.024]) {
      const n = ctx.createBufferSource(); n.buffer = noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.2;
      const g = ctx.createGain(); env(g, t + dt, 0.001, 0.55 * v, dt === 0.024 ? 0.16 : 0.03);
      n.connect(bp).connect(g).connect(out); n.start(t + dt); n.stop(t + dt + 0.2);
    }
  },
  hat(ctx, out, t, v = 1, noise, open = false) {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    const g = ctx.createGain(); env(g, t, 0.001, (open ? 0.28 : 0.22) * v, open ? 0.32 : 0.045);
    n.connect(hp).connect(g).connect(out); n.start(t); n.stop(t + (open ? 0.4 : 0.08));
  },
};

function playBass(ctx, out, t, dur, midi, type, nextMidi) {
  const f = midiHz(midi);
  if (type === '808') {
    const o = ctx.createOscillator(), g = ctx.createGain(), sat = saturator(ctx, 2.5);
    o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    if (nextMidi && nextMidi !== midi) o.frequency.setTargetAtTime(midiHz(nextMidi), t + dur * 0.8, 0.03);
    env(g, t, 0.003, 0.9, Math.max(0.25, dur), 0.35, 0.08, t + dur);
    o.connect(sat).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.15);
  } else {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    lp.type = 'lowpass'; lp.Q.value = 4; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(220, t + 0.25);
    env(g, t, 0.005, 0.45, 0.2, 0.6, 0.06, t + dur);
    o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.1);
  }
}

function playChord(ctx, out, t, dur, notes, kind) {
  for (const n of notes) {
    const f = midiHz(n + 12);
    if (kind === 'keys' || kind === 'piano') {
      for (const [type, mult, amp] of [['triangle', 1, 0.16], ['sine', 2, 0.05]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = f * mult;
        env(g, t, 0.005, amp, Math.min(dur, 1.6), 0.25, 0.3, t + dur);
        o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.4);
      }
    } else {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = kind === 'dark' ? 700 : kind === 'strings' ? 2200 : 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + Math.min(0.4, dur / 3));
      g.gain.setValueAtTime(0.07, t + dur * 0.85); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
      for (const det of [-9, 0, 8]) {
        const o = ctx.createOscillator(); o.type = kind === 'strings' ? 'sawtooth' : kind === 'organ' ? 'square' : 'sawtooth';
        o.frequency.value = f; o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 0.35);
      }
      lp.connect(g).connect(out);
    }
  }
}

function playLead(ctx, out, t, dur, midi, kind) {
  const f = midiHz(midi);
  const g = ctx.createGain();
  if (kind === 'bell') {
    for (const [mult, amp] of [[1, 0.12], [2.76, 0.04], [5.4, 0.02]]) {
      const o = ctx.createOscillator(), gg = ctx.createGain(); o.frequency.value = f * mult;
      env(gg, t, 0.002, amp, 1.2 / mult); o.connect(gg).connect(out); o.start(t); o.stop(t + 1.4);
    }
    return;
  }
  const o = ctx.createOscillator(), lp = ctx.createBiquadFilter();
  o.type = kind === 'saw' ? 'sawtooth' : kind === 'piano' ? 'triangle' : 'square';
  o.frequency.value = f;
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(kind === 'pluck' ? 3000 : 2500, t); lp.frequency.exponentialRampToValueAtTime(kind === 'pluck' ? 400 : 1200, t + 0.3);
  env(g, t, 0.003, kind === 'piano' ? 0.18 : 0.1, kind === 'pluck' ? 0.25 : Math.max(0.15, dur), kind === 'saw' ? 0.5 : 0.2, 0.08, t + dur);
  o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.3);
}

// ---------------- Rendu ----------------
function scaleMidi(song, degree, octave = 5) {
  const sc = SCALES[song.scale];
  const d = Math.floor(degree);
  const oct = Math.floor(d / 7);
  return 12 * (octave + oct) + NOTE[song.key] + sc[((d % 7) + 7) % 7];
}
function seeded(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function autoMelody(song) {
  const rnd = seeded(song.bpm * 7 + NOTE[song.key] * 13 + song.progression.join('').length);
  const pat = song.leadPattern;
  const notes = [];
  let deg = 4;
  for (let i = 0; i < 32; i++) {
    if (pat[i % 16] !== 'x') { notes.push(null); continue; }
    deg += [-2, -1, -1, 0, 1, 1, 2, 3, -3][Math.floor(rnd() * 9)];
    deg = Math.max(0, Math.min(9, deg));
    notes.push(deg);
  }
  return notes;
}

export function songDuration(song) {
  return song.sections.reduce((s, x) => s + x.bars, 0) * 4 * 60 / song.bpm;
}

/** Calcule les stems (batterie, basse, accords, lead) puis le mix. */
export async function renderSong(input, { onProgress } = {}) {
  const song = sanitizeSong(input);
  const beat = 60 / song.bpm, step = beat / 4, bar = beat * 4;
  const total = songDuration(song) + 2;
  const len = Math.ceil(total * SR);
  const melody = song.melody?.length ? song.melody : autoMelody(song);
  const stems = {};
  for (const stem of ['drums', 'bass', 'chords', 'lead']) {
    onProgress?.(stem);
    const ctx = new OfflineAudioContext(2, len, SR);
    const noise = noiseBuffer(ctx);
    const out = ctx.createGain();
    let last = out;
    if (song.lofi) {
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
      out.connect(lp); last = lp;
    }
    if (stem === 'drums') { const c = ctx.createDynamicsCompressor(); c.threshold.value = -14; c.ratio.value = 4; last.connect(c); last = c; }
    if (stem === 'chords' || stem === 'lead') {
      const conv = ctx.createConvolver();
      const ir = ctx.createBuffer(2, SR * 2, SR);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3; }
      conv.buffer = ir;
      const wet = ctx.createGain(); wet.gain.value = stem === 'lead' ? 0.25 : 0.18;
      last.connect(conv).connect(wet).connect(ctx.destination);
    }
    last.connect(ctx.destination);

    let t0 = 0.05, barIndex = 0;
    for (const sec of song.sections) {
      const L = new Set(sec.layers);
      for (let b = 0; b < sec.bars; b++, barIndex++) {
        const tb = t0 + b * bar;
        const chordName = song.progression[barIndex % song.progression.length];
        const chord = parseChord(chordName, song);
        const nextChord = parseChord(song.progression[(barIndex + 1) % song.progression.length], song);
        for (let s = 0; s < 16; s++) {
          const swing = s % 2 === 1 ? song.swing * step : 0;
          const t = tb + s * step + swing;
          const v = s % 4 === 0 ? 1 : 0.8;
          if (stem === 'drums') {
            const d = song.drums;
            const full = L.has('drums');
            if ((full || L.has('kick')) && d.kick[s] === 'x') DRUM.kick(ctx, out, t, v);
            if (full && d.snare[s] === 'x') DRUM.snare(ctx, out, t, v, noise);
            if (full && d.clap[s] === 'x') DRUM.clap(ctx, out, t, v, noise);
            if ((full || L.has('hat')) && d.hat[s] === 'x') DRUM.hat(ctx, out, t, s % 2 ? 0.6 : 0.9, noise);
            if (full && d.openhat[s] === 'x') DRUM.hat(ctx, out, t, 0.8, noise, true);
          } else if (stem === 'bass' && L.has('bass') && song.bass.pattern[s] === 'x' && chord) {
            let n = s + 1; while (n < 16 && song.bass.pattern[n] !== 'x') n++;
            const dur = (n - s) * step * 0.95;
            const root = 24 + chord.root + (chord.root > 6 ? 0 : 12);
            const nxt = n >= 16 && nextChord ? 24 + nextChord.root + (nextChord.root > 6 ? 0 : 12) : root;
            playBass(ctx, out, t, dur, song.bass.type === '808' ? root : root + 12, song.bass.type, nxt);
          } else if (stem === 'lead' && L.has('lead')) {
            const deg = melody[(barIndex % 2) * 16 + s];
            if (deg !== null && deg !== undefined) {
              let n = s + 1; while (n < 16 && (melody[(barIndex % 2) * 16 + n] ?? null) === null) n++;
              playLead(ctx, out, t, Math.min(beat * 2, (n - s) * step * 0.9), scaleMidi(song, deg, 5), song.lead);
            }
          }
        }
        if (stem === 'chords' && L.has('pad') && chord) {
          if (song.pad === 'keys' || song.pad === 'piano') {
            for (const off of [0, 2.5]) playChord(ctx, out, tb + off * beat + (off ? song.swing * step : 0), off ? beat * 1.5 : beat * 2.5, chord.notes, song.pad);
          } else playChord(ctx, out, tb, bar, chord.notes, song.pad);
        }
      }
      t0 += sec.bars * bar;
    }
    stems[stem] = await ctx.startRendering();
  }
  onProgress?.('mix');
  const g = song.mixer;
  const full = await mix([
    { buffer: stems.drums, gainDb: g.drums - 2 }, { buffer: stems.bass, gainDb: g.bass - 3 },
    { buffer: stems.chords, gainDb: g.chords }, { buffer: stems.lead, gainDb: g.lead },
  ]);
  // marge de sécurité
  let p = 0; for (let c = 0; c < 2; c++) { const d = full.getChannelData(c); for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i])); }
  if (p > 0.89) for (let c = 0; c < 2; c++) { const d = full.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= 0.89 / p; }
  return { song, stems, full, duration: songDuration(song) };
}

/** Prompt système pour que l'IA produise une partition jouable. */
export const COMPOSER_PROMPT = `Tu es un compositeur et beatmaker. À partir de la demande, tu produis UNIQUEMENT un objet JSON (sans texte autour) décrivant une instrumentale jouable par un séquenceur :
{
 "title": "titre",
 "style": "trap|boombap|drill|afro|lofi|pop|house|ambient",
 "bpm": nombre,
 "key": "C|C#|Db|D|Eb|E|F|F#|G|Ab|A|Bb|B",
 "scale": "minor|major|dorian|phrygian|harmonic",
 "swing": 0 à 0.3,
 "progression": ["Am7","F","C","G"]  (4 à 8 accords, un par mesure, notation anglaise : C, Cm, C7, Cmaj7, Cm7, Csus4, Cdim, Cadd9),
 "drums": {"kick":"16 caractères x ou .","snare":"…","hat":"…","openhat":"…","clap":"…"},
 "bass": {"type":"808|synth","pattern":"16 caractères x ou ."},
 "pad": "warm|dark|strings|keys|organ",
 "lead": "bell|pluck|piano|saw",
 "leadPattern": "16 caractères x ou .",
 "melody": [32 valeurs : degré de la gamme (0 = tonique, 7 = octave) ou null pour un silence],
 "halftime": true|false,
 "sections": [{"name":"Intro","bars":4,"layers":["pad","hat"]},{"name":"Couplet","bars":8,"layers":["drums","bass","pad"]},{"name":"Refrain","bars":8,"layers":["drums","bass","pad","lead"]}],
 "mixer": {"drums":0,"bass":0,"chords":-3,"lead":-4},
 "notes": "2 phrases en français expliquant l'ambiance"
}
Les couches possibles : drums, kick, hat, bass, pad, lead. Les motifs comptent 16 doubles-croches par mesure (x = coup, . = silence).`;

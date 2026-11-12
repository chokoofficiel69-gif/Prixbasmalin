// Effets voix et autotune, calculés dans le navigateur (gratuit, sans limite).
// - Détection de la note : YIN sur une version à 11 025 Hz.
// - Changement de hauteur : TD-PSOLA (garde le timbre / les formants → voix naturelle).
// - Autotune : note la plus proche dans la gamme, vitesse de correction réglable (0 = effet « robot »).
// - Vocodeur / talkbox : banc de filtres, porteuse en dents de scie qui suit la mélodie corrigée.

const NOTE_FR = ['Do', 'Do#', 'Ré', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
export const SCALES = {
  majeur: [0, 2, 4, 5, 7, 9, 11],
  mineur: [0, 2, 3, 5, 7, 8, 10],
  'mineur harmonique': [0, 2, 3, 5, 7, 8, 11],
  'penta mineure': [0, 3, 5, 7, 10],
  chromatique: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const keyName = (k) => k ? `${NOTE_FR[k.root]} ${k.mode}` : 'auto';

const mono = (buf) => {
  const n = buf.length, out = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
};
const toBuffer = (data, sr, channels = 1) => {
  const b = new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, data[0]?.length ?? data.length), sampleRate: sr });
  if (data instanceof Float32Array) for (let c = 0; c < channels; c++) b.copyToChannel(data, c);
  else data.forEach((d, c) => b.copyToChannel(d, c));
  return b;
};
const tick = () => new Promise(r => setTimeout(r, 0));

// ---------- Détection de hauteur (YIN) ----------
export async function detectPitch(buffer, onProgress) {
  const SRD = 11025;
  const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * SRD), SRD);
  const src = off.createBufferSource(); src.buffer = buffer;
  const lp = off.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
  src.connect(lp).connect(off.destination); src.start();
  const x = (await off.startRendering()).getChannelData(0);
  const W = 384, hop = 64, tMin = Math.floor(SRD / 1100), tMax = Math.ceil(SRD / 65);
  const frames = Math.max(0, Math.floor((x.length - W - tMax) / hop));
  const f0 = new Float32Array(frames), conf = new Float32Array(frames), rms = new Float32Array(frames);
  const d = new Float32Array(tMax + 1);
  let peak = 1e-9;
  for (let f = 0; f < frames; f++) { let s = 0; const o = f * hop; for (let i = 0; i < W; i++) s += x[o + i] * x[o + i]; rms[f] = Math.sqrt(s / W); if (rms[f] > peak) peak = rms[f]; }
  for (let f = 0; f < frames; f++) {
    if (f % 400 === 0) { onProgress?.(f / frames); await tick(); }
    if (rms[f] < peak * 0.03) continue;
    const o = f * hop;
    for (let tau = 1; tau <= tMax; tau++) { let s = 0; for (let i = 0; i < W; i++) { const v = x[o + i] - x[o + i + tau]; s += v * v; } d[tau] = s; }
    let run = 0, best = -1;
    for (let tau = 1; tau <= tMax; tau++) {
      run += d[tau]; const cm = d[tau] * tau / (run || 1); d[tau] = cm;
    }
    for (let tau = tMin; tau < tMax; tau++) if (d[tau] < 0.15 && d[tau] < d[tau + 1]) { best = tau; break; }
    if (best < 0) continue;
    const a = d[best - 1], b = d[best], c = d[best + 1];
    const shift = (a - 2 * b + c) ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
    f0[f] = SRD / (best + shift); conf[f] = 1 - b;
  }
  // nettoie les sauts d'octave isolés (médiane sur 5 trames)
  const clean = f0.slice();
  for (let f = 2; f < frames - 2; f++) {
    if (!f0[f]) continue;
    const w = [f0[f - 2], f0[f - 1], f0[f], f0[f + 1], f0[f + 2]].filter(Boolean).sort((p, q) => p - q);
    if (w.length >= 3) clean[f] = w[w.length >> 1];
  }
  return { f0: clean, conf, rate: SRD / hop };
}

// ---------- Tonalité ----------
const KMAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KMIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export function detectKey(pitch) {
  const hist = new Array(12).fill(0);
  for (const f of pitch.f0) if (f) hist[((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12]++;
  const corr = (prof, r) => { let s = 0; for (let i = 0; i < 12; i++) s += hist[(i + r) % 12] * prof[i]; return s; };
  let best = { root: 0, mode: 'mineur', s: -1 };
  for (let r = 0; r < 12; r++) {
    const a = corr(KMAJ, r), b = corr(KMIN, r);
    if (a > best.s) best = { root: r, mode: 'majeur', s: a };
    if (b > best.s) best = { root: r, mode: 'mineur', s: b };
  }
  return { root: best.root, mode: best.mode };
}
function snap(midi, key, scaleName) {
  const sc = SCALES[scaleName || key.mode] || SCALES.chromatique;
  let best = midi, bd = 99;
  for (let o = -1; o <= 1; o++) for (const s of sc) {
    const base = Math.floor(midi / 12) * 12 + o * 12 + ((key.root + s) % 12);
    const dd = Math.abs(base - midi); if (dd < bd) { bd = dd; best = base; }
  }
  return best;
}
function scaleStep(note, key, steps) {
  const sc = SCALES[key.mode] || SCALES.majeur;
  const notes = [];
  for (let o = -2; o <= 3; o++) for (const s of sc) notes.push(60 + o * 12 + key.root + s - 12);
  notes.sort((a, b) => a - b);
  let i = notes.findIndex(n => n >= note - 0.01); if (i < 0) i = notes.length - 1;
  return notes[Math.max(0, Math.min(notes.length - 1, i + steps))];
}

// Courbe de correction (en demi-tons, une valeur par trame) selon le réglage autotune.
function correctionCurve(pitch, key, { strength = 1, speed = 0, scale, extra = 0, harmonySteps = 0 }) {
  const n = pitch.f0.length, out = new Float32Array(n);
  const alpha = speed > 0 ? Math.exp(-1 / (pitch.rate * speed / 1000)) : 0;
  let tgt = null;
  for (let i = 0; i < n; i++) {
    const f = pitch.f0[i];
    if (!f) { out[i] = extra; tgt = null; continue; }
    const m = 69 + 12 * Math.log2(f / 440);
    let t = snap(m, key, scale);
    if (harmonySteps) t = scaleStep(t, key, harmonySteps);
    tgt = tgt === null || alpha === 0 ? t : alpha * tgt + (1 - alpha) * t;
    out[i] = (harmonySteps ? (tgt - m) : strength * (tgt - m)) + extra;
  }
  return out;
}

// ---------- TD-PSOLA : change la hauteur en gardant le timbre ----------
export async function psola(buffer, pitch, semis, onProgress) {
  const sr = buffer.sampleRate, x = mono(buffer), N = x.length;
  const per = (t) => { const i = Math.min(pitch.f0.length - 1, Math.max(0, Math.round(t / sr * pitch.rate))); const f = pitch.f0[i]; return f ? sr / f : 0; };
  const semAt = (t) => { const i = Math.min(semis.length - 1, Math.max(0, Math.round(t / sr * pitch.rate))); return typeof semis === 'number' ? semis : semis[i]; };
  // repères d'analyse (un par période dans les parties chantées, toutes les 5 ms ailleurs)
  const marks = []; let t = 0;
  while (t < N) {
    const P = per(t);
    if (P) {
      // recale sur le pic local pour des repères stables
      let best = Math.round(t), bv = -1; const r = Math.round(P / 4);
      for (let k = Math.max(0, Math.round(t) - r); k < Math.min(N, Math.round(t) + r); k++) { const v = Math.abs(x[k]); if (v > bv) { bv = v; best = k; } }
      marks.push({ t: best, P }); t = Math.max(t + 1, best + P);
    } else { marks.push({ t: Math.round(t), P: sr * 0.005, unv: true }); t += sr * 0.005; }
  }
  const y = new Float32Array(N), wsum = new Float32Array(N);
  let s = 0, mi = 0, cnt = 0;
  while (s < N) {
    while (mi < marks.length - 1 && Math.abs(marks[mi + 1].t - s) <= Math.abs(marks[mi].t - s)) mi++;
    const m = marks[mi];
    const L = Math.round(m.unv ? sr * 0.01 : m.P);
    const ratio = m.unv ? 1 : 2 ** (semAt(m.t) / 12);
    for (let k = -L; k < L; k++) {
      const src = m.t + k, dst = Math.round(s) + k;
      if (src < 0 || src >= N || dst < 0 || dst >= N) continue;
      const w = 0.5 + 0.5 * Math.cos(Math.PI * k / L);
      y[dst] += x[src] * w; wsum[dst] += w;
    }
    s += m.unv ? sr * 0.005 : m.P / ratio;
    if (++cnt % 4000 === 0) { onProgress?.(s / N); await tick(); }
  }
  for (let i = 0; i < N; i++) y[i] = wsum[i] > 0.1 ? y[i] / wsum[i] : x[i];
  return toBuffer(y, sr, 1);
}

// ---------- Filtres et vocodeur ----------
function bandpass(x, sr, f, q) {
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
async function vocode(buffer, pitch, { semis = null, bands = 20, q = 6, voices = [0], fixedHz = 0, noise = false, onProgress } = {}) {
  const sr = buffer.sampleRate, x = mono(buffer), N = x.length;
  const car = new Float32Array(N); const ph = voices.map(() => 0);
  let lastF = 110;
  for (let i = 0; i < N; i++) {
    const fi = Math.min(pitch.f0.length - 1, Math.floor(i / sr * pitch.rate));
    let f = fixedHz || pitch.f0[fi];
    if (f && semis && !fixedHz) f *= 2 ** ((typeof semis === 'number' ? semis : semis[fi]) / 12);
    if (f) lastF = f; else f = lastF;
    let v = 0;
    voices.forEach((st, k) => { ph[k] += f * 2 ** (st / 12) / sr; ph[k] -= Math.floor(ph[k]); v += 2 * ph[k] - 1; });
    car[i] = noise || !pitch.f0[fi] && !fixedHz ? (Math.random() * 2 - 1) * 0.6 : v / voices.length;
  }
  const out = new Float32Array(N);
  const lo = 120, hi = 7000;
  for (let b = 0; b < bands; b++) {
    const f = lo * (hi / lo) ** (b / (bands - 1));
    const m = bandpass(x, sr, f, q), c = bandpass(car, sr, f, q);
    let env = 0; const a = Math.exp(-1 / (sr * 0.008));
    for (let i = 0; i < N; i++) { env = Math.max(Math.abs(m[i]), a * env); out[i] += c[i] * env; }
    onProgress?.((b + 1) / bands); await tick();
  }
  return toBuffer(out, sr, 1);
}

// ---------- Effets classiques via Web Audio (hors ligne) ----------
function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay; }
  return ir;
}
async function graph(buffer, build, tail = 0) {
  const sr = buffer.sampleRate;
  const ctx = new OfflineAudioContext(2, Math.ceil((buffer.duration + tail) * sr), sr);
  const src = ctx.createBufferSource(); src.buffer = buffer;
  build(ctx, src).connect(ctx.destination); src.start();
  return ctx.startRendering();
}
function fx(kind, o = {}) {
  return (ctx, src) => {
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const filt = (type, f, q = 0.7, gain = 0) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = gain; return n; };
    const shaper = (amt) => { const n = ctx.createWaveShaper(); const c = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const v = i / 1024 - 1; c[i] = Math.tanh(amt * v) / Math.tanh(amt); } n.curve = c; n.oversample = '4x'; return n; };
    const out = g(1);
    switch (kind) {
      case 'band': src.connect(filt('highpass', o.lo || 300)).connect(filt('lowpass', o.hi || 3400)).connect(o.drive ? shaper(o.drive) : g(1)).connect(out); break;
      case 'distort': src.connect(shaper(o.amt || 4)).connect(filt('lowpass', o.tone || 9000)).connect(g(0.8)).connect(out); break;
      case 'underwater': src.connect(filt('lowpass', 500, 4)).connect(out); break;
      case 'reverb': case 'delay': case 'pingpong': case 'chorus': case 'flanger': case 'tremolo': case 'ring': {
        src.connect(g(o.dry ?? 1)).connect(out);
        if (kind === 'reverb') { const cv = ctx.createConvolver(); cv.buffer = impulse(ctx, o.size || 2, o.decay || 3); src.connect(filt('highpass', 200)).connect(cv).connect(g(o.mix ?? 0.35)).connect(out); }
        if (kind === 'delay' || kind === 'pingpong') {
          const d = ctx.createDelay(2); d.delayTime.value = o.time || 0.3; const fb = g(o.fb ?? 0.35);
          const pan = ctx.createStereoPanner(); pan.pan.value = kind === 'pingpong' ? 0.7 : 0;
          src.connect(d); d.connect(fb).connect(d); d.connect(filt('lowpass', 5000)).connect(pan).connect(g(o.mix ?? 0.4)).connect(out);
          if (kind === 'pingpong') { const d2 = ctx.createDelay(2); d2.delayTime.value = (o.time || 0.3) * 2; const p2 = ctx.createStereoPanner(); p2.pan.value = -0.7; src.connect(d2).connect(p2).connect(g((o.mix ?? 0.4) * 0.7)).connect(out); }
        }
        if (kind === 'chorus' || kind === 'flanger') {
          [-0.6, 0.6].forEach((p, k) => {
            const d = ctx.createDelay(0.1); d.delayTime.value = kind === 'flanger' ? 0.003 : 0.018 + k * 0.007;
            const lfo = ctx.createOscillator(); lfo.frequency.value = (kind === 'flanger' ? 0.25 : 0.9) + k * 0.13;
            const depth = g(kind === 'flanger' ? 0.0025 : 0.004); lfo.connect(depth).connect(d.delayTime); lfo.start();
            const pan = ctx.createStereoPanner(); pan.pan.value = p;
            src.connect(d).connect(pan).connect(g(o.mix ?? 0.6)).connect(out);
            if (kind === 'flanger') d.connect(g(0.6)).connect(d);
          });
        }
        if (kind === 'tremolo' || kind === 'ring') {
          const v = ctx.createGain(); v.gain.value = kind === 'ring' ? 0 : 0.6;
          const lfo = ctx.createOscillator(); lfo.type = kind === 'ring' ? 'sine' : 'triangle'; lfo.frequency.value = o.freq || (kind === 'ring' ? 60 : 6);
          lfo.connect(g(kind === 'ring' ? 1 : 0.4)).connect(v.gain); lfo.start();
          src.disconnect(); src.connect(v).connect(out);
        }
        break;
      }
      case 'lofi': {
        const n = ctx.createWaveShaper(); const steps = 2 ** (o.bits || 6); const c = new Float32Array(4096);
        for (let i = 0; i < 4096; i++) { const v = i / 2048 - 1; c[i] = Math.round(v * steps / 2) / (steps / 2); } n.curve = c;
        src.connect(filt('lowpass', o.hi || 4000)).connect(filt('highpass', 150)).connect(n).connect(g(0.9)).connect(out); break;
      }
      default: src.connect(out);
    }
    return out;
  };
}

function mixBuffers(list, sr) {
  const N = Math.max(...list.map(([b]) => b.length));
  const L = new Float32Array(N), R = new Float32Array(N);
  for (const [b, gain = 1, pan = 0] of list) {
    const l = b.getChannelData(0), r = b.numberOfChannels > 1 ? b.getChannelData(1) : l;
    const gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan);
    for (let i = 0; i < b.length; i++) { L[i] += l[i] * gl; R[i] += r[i] * gr; }
  }
  let pk = 1e-9; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const k = pk > 0.98 ? 0.98 / pk : 1; for (let i = 0; i < N; i++) { L[i] *= k; R[i] *= k; }
  return toBuffer([L, R], sr, 2);
}

// ---------- Moteur : applique une chaîne de réglages ----------
export async function applyChain(buffer, chain, opts = {}) {
  const say = opts.onProgress || (() => {});
  let pitch = null, key = opts.key || null;
  const needPitch = chain.some(s => ['tune', 'shift', 'vocoder', 'harmony', 'double'].includes(s.t));
  if (needPitch) { say('Analyse des notes…'); pitch = await detectPitch(buffer, p => say(`Analyse des notes ${Math.round(p * 100)} %`)); if (!key) key = detectKey(pitch); }
  let cur = buffer, tuneCurve = null;
  for (const s of chain) {
    if (s.t === 'tune') {
      tuneCurve = correctionCurve(pitch, key, { strength: s.strength ?? 1, speed: s.speed ?? 0, scale: s.scale, extra: s.extra || 0 });
      say('Autotune…'); cur = await psola(buffer, pitch, tuneCurve, p => say(`Autotune ${Math.round(p * 100)} %`));
    } else if (s.t === 'shift') {
      say('Changement de timbre…'); cur = await psola(cur === buffer ? buffer : cur, pitch, s.semi, p => say(`Changement de voix ${Math.round(p * 100)} %`));
    } else if (s.t === 'resample') {
      const r = 2 ** (s.semi / 12), sr = cur.sampleRate;
      const ctx = new OfflineAudioContext(cur.numberOfChannels, Math.ceil(cur.length / r), sr);
      const src = ctx.createBufferSource(); src.buffer = cur; src.playbackRate.value = r; src.connect(ctx.destination); src.start();
      cur = await ctx.startRendering();
    } else if (s.t === 'vocoder') {
      say('Vocodeur…');
      const semis = s.follow === false ? null : (tuneCurve || correctionCurve(pitch, key, { strength: 1, speed: 0 }));
      cur = await vocode(buffer, pitch, { semis, bands: s.bands || 20, q: s.q || 6, voices: s.voices || [0], fixedHz: s.fixedHz || 0, noise: s.noise, onProgress: p => say(`Vocodeur ${Math.round(p * 100)} %`) });
      if (s.blend) cur = mixBuffers([[cur, 1], [buffer, s.blend]], cur.sampleRate);
    } else if (s.t === 'harmony' || s.t === 'double') {
      say(s.t === 'double' ? 'Doublage…' : 'Harmonies…');
      const layers = [[cur, 1, 0]];
      for (const [i, step] of (s.steps || [0]).entries()) {
        const curve = s.t === 'double'
          ? correctionCurve(pitch, key, { strength: tuneCurve ? 1 : 0, speed: tuneCurve ? 0 : 0, extra: (i % 2 ? -0.12 : 0.12) + (step || 0) })
          : correctionCurve(pitch, key, { harmonySteps: step });
        const layer = await psola(buffer, pitch, curve, () => {});
        layers.push([layer, s.gain ?? 0.55, i % 2 ? -0.6 : 0.6]);
      }
      cur = mixBuffers(layers, cur.sampleRate);
    } else if (s.t === 'fx') {
      say('Effet…'); cur = await graph(cur, fx(s.kind, s), s.kind === 'reverb' ? (s.size || 2) : s.kind.includes('delay') || s.kind === 'pingpong' ? 1.5 : 0);
    }
  }
  return { buffer: cur, key };
}

// ---------- Bibliothèque de préréglages ----------
const TUNES = [
  ['Naturel discret', { strength: 0.5, speed: 200 }],
  ['Naturel', { strength: 0.8, speed: 120 }],
  ['Pop propre', { strength: 1, speed: 60 }],
  ['R&B soyeux', { strength: 1, speed: 35 }],
  ['Trap mélodique', { strength: 1, speed: 15 }],
  ['Hard-tune (effet robot)', { strength: 1, speed: 0 }],
];
const FINISH = [
  ['', []],
  [' + doublage', [{ t: 'double', steps: [0, 0] }]],
  [' + écho', [{ t: 'fx', kind: 'delay', time: 0.32, fb: 0.35, mix: 0.3 }]],
  [' + réverbe', [{ t: 'fx', kind: 'reverb', size: 2.2, mix: 0.3 }]],
  [' + harmonie tierce', [{ t: 'harmony', steps: [2] }]],
  [' + harmonies tierce et quinte', [{ t: 'harmony', steps: [2, 4] }]],
  [' + octave grave', [{ t: 'double', steps: [-12], gain: 0.5 }]],
  [' + octave aiguë', [{ t: 'double', steps: [12], gain: 0.35 }]],
  [' + écho ping-pong', [{ t: 'fx', kind: 'pingpong', time: 0.24, mix: 0.3 }]],
  [' + téléphone', [{ t: 'fx', kind: 'band', lo: 400, hi: 3200, drive: 2 }]],
];
const TIMBRES = [
  ['Voix très grave', -7], ['Voix grave', -4], ['Voix un peu plus grave', -2],
  ['Voix un peu plus aiguë', 2], ['Voix aiguë', 4], ['Voix féminine', 5], ['Voix féminine aiguë', 7],
  ['Voix d’enfant', 9], ['Voix de géant', -12],
];
export const PRESETS = [];
for (const [tn, to] of TUNES) for (const [fn, fc] of FINISH) PRESETS.push({ cat: '🎛️ Autotune', name: tn + fn, chain: [{ t: 'tune', ...to }, ...fc] });
for (const [n, semi] of TIMBRES) {
  PRESETS.push({ cat: '🗣️ Timbre de voix', name: n, chain: [{ t: 'shift', semi }] });
  PRESETS.push({ cat: '🗣️ Timbre de voix', name: n + ' + autotune', chain: [{ t: 'tune', strength: 1, speed: 30, extra: semi }] });
}
PRESETS.push(
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Vocodeur robot', chain: [{ t: 'vocoder', bands: 22, q: 7 }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Vocodeur chœur (accord)', chain: [{ t: 'vocoder', bands: 22, q: 7, voices: [0, 4, 7] }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Vocodeur chœur mineur', chain: [{ t: 'vocoder', bands: 22, q: 7, voices: [-12, 0, 3, 7] }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Talkbox funk', chain: [{ t: 'vocoder', bands: 12, q: 4, voices: [0, 12] }, { t: 'fx', kind: 'distort', amt: 2, tone: 6000 }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Talkbox + voix d’origine', chain: [{ t: 'vocoder', bands: 12, q: 4, voices: [0], blend: 0.5 }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Robot monotone', chain: [{ t: 'vocoder', bands: 20, q: 6, fixedHz: 110, follow: false }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Robot aigu', chain: [{ t: 'vocoder', bands: 20, q: 6, fixedHz: 220, follow: false }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Dalek (modulation)', chain: [{ t: 'fx', kind: 'ring', freq: 30 }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Alien', chain: [{ t: 'fx', kind: 'ring', freq: 420 }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Chuchotement', chain: [{ t: 'vocoder', bands: 24, q: 5, noise: true }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Fantôme', chain: [{ t: 'vocoder', bands: 24, q: 5, noise: true }, { t: 'fx', kind: 'reverb', size: 3.5, mix: 0.6 }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Démon', chain: [{ t: 'shift', semi: -10 }, { t: 'fx', kind: 'distort', amt: 5, tone: 5000 }] },
  { cat: '🤖 Vocodeur / talkbox / robot', name: 'Chipmunk (accéléré)', chain: [{ t: 'resample', semi: 7 }] },
);
const AMB = [
  ['Téléphone', { kind: 'band', lo: 400, hi: 3200, drive: 2 }], ['Vieille radio', { kind: 'band', lo: 500, hi: 2800, drive: 3 }],
  ['Mégaphone', { kind: 'band', lo: 700, hi: 3000, drive: 8 }], ['Talkie-walkie', { kind: 'band', lo: 900, hi: 2600, drive: 12 }],
  ['Sous l’eau', { kind: 'underwater' }], ['Petite pièce', { kind: 'reverb', size: 0.6, decay: 4, mix: 0.25 }],
  ['Salle de bain', { kind: 'reverb', size: 1.2, decay: 2, mix: 0.4 }], ['Grande salle', { kind: 'reverb', size: 2.5, mix: 0.35 }],
  ['Cathédrale', { kind: 'reverb', size: 5, decay: 2, mix: 0.5 }], ['Stade', { kind: 'reverb', size: 4, decay: 1.5, mix: 0.45 }],
  ['Écho court (slap)', { kind: 'delay', time: 0.11, fb: 0.15, mix: 0.3 }], ['Écho 1/4', { kind: 'delay', time: 0.4, fb: 0.35, mix: 0.3 }],
  ['Écho long', { kind: 'delay', time: 0.6, fb: 0.5, mix: 0.35 }], ['Écho ping-pong', { kind: 'pingpong', time: 0.25, mix: 0.35 }],
  ['Chorus', { kind: 'chorus', mix: 0.5 }], ['Flanger', { kind: 'flanger', mix: 0.6 }], ['Trémolo', { kind: 'tremolo', freq: 6 }],
  ['Saturation douce', { kind: 'distort', amt: 2 }], ['Distorsion', { kind: 'distort', amt: 8, tone: 6000 }],
  ['Lo-fi cassette', { kind: 'lofi', bits: 8, hi: 6000 }], ['Lo-fi 8 bits', { kind: 'lofi', bits: 4, hi: 4000 }],
];
for (const [n, o] of AMB) PRESETS.push({ cat: '🌆 Ambiances et effets', name: n, chain: [{ t: 'fx', ...o }] });
for (const [n, o] of AMB.slice(5, 14)) PRESETS.push({ cat: '🌆 Ambiances et effets', name: `Autotune trap + ${n.toLowerCase()}`, chain: [{ t: 'tune', strength: 1, speed: 15 }, { t: 'fx', ...o }] });
export const PRESET_CATS = [...new Set(PRESETS.map(p => p.cat))];
export const KEY_CHOICES = [{ v: '', label: 'Tonalité : détection auto' }, ...['majeur', 'mineur'].flatMap(mode => NOTE_FR.map((n, root) => ({ v: `${root}|${mode}`, label: `${n} ${mode}` })))];

// Traitement audio dans le navigateur : décodage, export WAV, débruitage spectral,
// chaîne voix, mixage, mastering (loudness BS.1770 approchée + limiteur), détection du tempo.
import { audioCtx } from './core.js';

export const SR = 44100;

export async function decodeBlob(blob) {
  const buf = await blob.arrayBuffer();
  return await audioCtx().decodeAudioData(buf);
}

export function makeBuffer(channels, length, sampleRate = SR) {
  return new AudioBuffer({ numberOfChannels: channels, length: Math.max(1, length), sampleRate });
}

export function cloneBuffer(b) {
  const out = makeBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).slice(), c);
  return out;
}

export function sliceBuffer(b, start, end) {
  const s = Math.max(0, Math.floor(start * b.sampleRate));
  const e = Math.min(b.length, Math.floor(end * b.sampleRate));
  const out = makeBuffer(b.numberOfChannels, e - s, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).slice(s, e), c);
  return out;
}

export function encodeWav(buffer, bits = 16) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
  const bps = bits / 8;
  const ab = new ArrayBuffer(44 + n * ch * bps);
  const v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * bps, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, n * ch * bps, true);
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let s = Math.max(-1, Math.min(1, data[c][i]));
      if (bits === 16) { v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
      else { const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255); o += 3; }
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ---------- FFT (radix-2, en place) ----------
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/**
 * Débruitage spectral : apprend le profil du bruit sur les passages les plus calmes
 * puis le soustrait (avec lissage pour éviter l'effet « robot »).
 * amount : 0 (rien) → 1 (fort).
 */
export async function denoise(buffer, amount = 0.6, onProgress) {
  const N = 2048, hop = 512, bins = N / 2 + 1;
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const out = makeBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const x = buffer.getChannelData(c);
    const frames = Math.max(1, Math.ceil((x.length - N) / hop) + 1);
    // 1) magnitudes + énergie par trame
    const energies = new Float32Array(frames);
    const mags = [];
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let f = 0; f < frames; f++) {
      const o = f * hop;
      for (let i = 0; i < N; i++) { re[i] = (x[o + i] || 0) * win[i]; im[i] = 0; }
      fft(re, im);
      const m = new Float32Array(bins);
      let e = 0;
      for (let k = 0; k < bins; k++) { m[k] = Math.hypot(re[k], im[k]); e += m[k] * m[k]; }
      mags.push(m); energies[f] = e;
      if (f % 400 === 0) { onProgress?.((c + f / frames * 0.4) / buffer.numberOfChannels); await new Promise(r => setTimeout(r)); }
    }
    // 2) profil de bruit = moyenne des 10 % de trames les plus calmes
    const order = [...energies.keys()].sort((a, b) => energies[a] - energies[b]);
    const quiet = order.slice(0, Math.max(3, Math.floor(frames * 0.1)));
    const noise = new Float32Array(bins);
    for (const f of quiet) for (let k = 0; k < bins; k++) noise[k] += mags[f][k] / quiet.length;
    // 3) soustraction + reconstruction (overlap-add)
    const alpha = 1 + amount * 3, floor = 0.08 + (1 - amount) * 0.25;
    const y = new Float32Array(x.length + N);
    const norm = new Float32Array(x.length + N);
    const prevGain = new Float32Array(bins).fill(1);
    for (let f = 0; f < frames; f++) {
      const o = f * hop;
      for (let i = 0; i < N; i++) { re[i] = (x[o + i] || 0) * win[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < bins; k++) {
        const m = mags[f][k] || 1e-9;
        let g = Math.max(floor, (m - alpha * noise[k]) / m);
        g = 0.6 * g + 0.4 * prevGain[k];
        prevGain[k] = g;
        re[k] *= g; im[k] *= g;
        if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      }
      fft(re, im, true);
      for (let i = 0; i < N; i++) { y[o + i] += re[i] * win[i]; norm[o + i] += win[i] * win[i]; }
      if (f % 400 === 0) { onProgress?.((c + 0.4 + f / frames * 0.6) / buffer.numberOfChannels); await new Promise(r => setTimeout(r)); }
    }
    const res = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) res[i] = norm[i] > 1e-6 ? y[i] / norm[i] : 0;
    out.copyToChannel(res, c);
  }
  onProgress?.(1);
  return out;
}

/** Porte de bruit : coupe ce qui reste sous le seuil entre les phrases. */
export function gate(buffer, thresholdDb = -45, floorDb = -30) {
  const out = cloneBuffer(buffer);
  const th = 10 ** (thresholdDb / 20), fl = 10 ** (floorDb / 20);
  const sr = buffer.sampleRate;
  const att = Math.exp(-1 / (0.005 * sr)), rel = Math.exp(-1 / (0.15 * sr)), envRel = Math.exp(-1 / (0.05 * sr));
  const chans = [...Array(out.numberOfChannels)].map((_, c) => out.getChannelData(c));
  let env = 0, g = 1;
  for (let i = 0; i < out.length; i++) {
    let p = 0; for (const d of chans) p = Math.max(p, Math.abs(d[i]));
    env = p > env ? p : env * envRel + p * (1 - envRel);
    const target = env > th ? 1 : fl;
    g = target > g ? target + (g - target) * att : target + (g - target) * rel;
    for (const d of chans) d[i] *= g;
  }
  return out;
}

function impulse(ctx, seconds = 2.2, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return ir;
}

/** Chaîne voix rendue hors-ligne (EQ, de-esser, compresseur, réverbération). */
export async function voiceChain(buffer, o = {}) {
  const o2 = { highpass: 80, low: 0, presence: 3, air: 2, deess: 3, comp: 0.6, reverb: 0.12, gainDb: 0, ...o };
  const ctx = new OfflineAudioContext(2, buffer.length + (o2.reverb > 0 ? buffer.sampleRate * 2 : 0), buffer.sampleRate);
  const src = ctx.createBufferSource(); src.buffer = buffer;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = o2.highpass; hp.Q.value = 0.7;
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200; low.gain.value = o2.low;
  const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 350; mud.Q.value = 1; mud.gain.value = -2;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.9; pres.gain.value = o2.presence;
  const ess = ctx.createBiquadFilter(); ess.type = 'peaking'; ess.frequency.value = 6800; ess.Q.value = 3; ess.gain.value = -o2.deess;
  const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 10000; air.gain.value = o2.air;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10 - o2.comp * 20; comp.ratio.value = 2 + o2.comp * 4; comp.attack.value = 0.005; comp.release.value = 0.12; comp.knee.value = 6;
  const makeup = ctx.createGain(); makeup.gain.value = 10 ** ((o2.comp * 6 + o2.gainDb) / 20);
  src.connect(hp).connect(low).connect(mud).connect(pres).connect(ess).connect(air).connect(comp).connect(makeup);
  const dry = ctx.createGain(); dry.gain.value = 1;
  makeup.connect(dry).connect(ctx.destination);
  if (o2.reverb > 0) {
    const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 1.8, 3.5);
    const pre = ctx.createDelay(0.1); pre.delayTime.value = 0.02;
    const wet = ctx.createGain(); wet.gain.value = o2.reverb;
    makeup.connect(pre).connect(conv).connect(wet).connect(ctx.destination);
  }
  src.start();
  const out = await ctx.startRendering();
  return o2.reverb > 0 ? trimTail(out) : out;
}

function trimTail(b, thDb = -70) {
  const th = 10 ** (thDb / 20);
  let end = b.length;
  outer: for (; end > 0; end -= 256) {
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = Math.max(0, end - 256); i < end; i++) if (Math.abs(d[i]) > th) break outer;
    }
  }
  return sliceBuffer(b, 0, Math.min(b.length, end + 2048) / b.sampleRate);
}

export function peak(b) {
  let p = 0;
  for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } }
  return p;
}
export function applyGain(b, gain) {
  for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= gain; }
  return b;
}
export function normalize(b, targetDb = -1) {
  const p = peak(b);
  return p > 0 ? applyGain(b, 10 ** (targetDb / 20) / p) : b;
}

/** Sonie intégrée (LUFS) selon BS.1770 (pondération K + fenêtrage avec seuils). */
export async function loudness(buffer) {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource(); src.buffer = buffer;
  const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1681; shelf.gain.value = 4;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
  src.connect(shelf).connect(hp).connect(ctx.destination); src.start();
  const k = await ctx.startRendering();
  const block = Math.floor(0.4 * k.sampleRate), step = Math.floor(0.1 * k.sampleRate);
  const zs = [];
  for (let s = 0; s + block <= k.length; s += step) {
    let z = 0;
    for (let c = 0; c < k.numberOfChannels; c++) { const d = k.getChannelData(c); let acc = 0; for (let i = s; i < s + block; i++) acc += d[i] * d[i]; z += acc / block; }
    zs.push(z);
  }
  const L = (z) => -0.691 + 10 * Math.log10(z || 1e-12);
  const abs = zs.filter(z => L(z) > -70);
  if (!abs.length) return -70;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter(z => L(z) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / (gated.length || 1));
}

/** Limiteur à anticipation (évite toute saturation au-dessus du plafond). */
export function limit(buffer, ceilingDb = -1, releaseMs = 80) {
  const out = cloneBuffer(buffer);
  const ceil = 10 ** (ceilingDb / 20);
  const sr = out.sampleRate, look = Math.floor(0.005 * sr);
  const rel = Math.exp(-1 / ((releaseMs / 1000) * sr));
  const chans = [...Array(out.numberOfChannels)].map((_, c) => out.getChannelData(c));
  const n = out.length;
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) { let p = 0; for (const d of chans) p = Math.max(p, Math.abs(d[i])); need[i] = p > ceil ? ceil / p : 1; }
  // minimum glissant sur la fenêtre d'anticipation
  const minAhead = new Float32Array(n);
  const dq = [];
  for (let i = n - 1; i >= 0; i--) {
    while (dq.length && need[dq[dq.length - 1]] >= need[i]) dq.pop();
    dq.push(i);
    while (dq[0] > i + look) dq.shift();
    minAhead[i] = need[dq[0]];
  }
  let g = 1;
  for (let i = 0; i < n; i++) {
    const t = minAhead[i];
    g = t < g ? t : t + (g - t) * rel;
    for (const d of chans) d[i] *= g;
  }
  for (const d of chans) for (let i = 0; i < n; i++) if (d[i] > ceil) d[i] = ceil; else if (d[i] < -ceil) d[i] = -ceil;
  return out;
}

export const MASTER_PRESETS = {
  streaming: { label: 'Streaming (Spotify, YouTube) −14 LUFS', lufs: -14, low: 1, high: 1.5, glue: 0.4, width: 1 },
  rap: { label: 'Rap / trap punchy −10 LUFS', lufs: -10, low: 2.5, high: 2, glue: 0.65, width: 1.1 },
  club: { label: 'Club / fort −8 LUFS', lufs: -8, low: 3, high: 2, glue: 0.8, width: 1.1 },
  doux: { label: 'Doux / acoustique −16 LUFS', lufs: -16, low: 0, high: 1, glue: 0.25, width: 1 },
};

/** Mastering : EQ tonale, compression de bus, largeur stéréo, sonie cible, limiteur. */
export async function master(buffer, presetKey = 'streaming', onStep) {
  const p = MASTER_PRESETS[presetKey] || MASTER_PRESETS.streaming;
  onStep?.('Égalisation et compression…');
  const ctx = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource(); src.buffer = buffer;
  const sub = ctx.createBiquadFilter(); sub.type = 'highpass'; sub.frequency.value = 28;
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 110; low.gain.value = p.low;
  const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 300; mud.Q.value = 0.8; mud.gain.value = -1.5;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 9000; high.gain.value = p.high;
  const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -12 - p.glue * 12; glue.ratio.value = 1.5 + p.glue * 2.5; glue.attack.value = 0.02; glue.release.value = 0.25; glue.knee.value = 8;
  // largeur stéréo (M/S)
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  const lToM = ctx.createGain(), rToM = ctx.createGain(), lToS = ctx.createGain(), rToS = ctx.createGain();
  lToM.gain.value = 0.5; rToM.gain.value = 0.5; lToS.gain.value = 0.5 * p.width; rToS.gain.value = -0.5 * p.width;
  const mid = ctx.createGain(), side = ctx.createGain();
  const sideToR = ctx.createGain(); sideToR.gain.value = -1;
  src.connect(sub).connect(low).connect(mud).connect(high).connect(glue).connect(split);
  split.connect(lToM, 0); split.connect(rToM, 1); split.connect(lToS, 0); split.connect(rToS, 1);
  lToM.connect(mid); rToM.connect(mid); lToS.connect(side); rToS.connect(side);
  mid.connect(merge, 0, 0); side.connect(merge, 0, 0);
  mid.connect(merge, 0, 1); side.connect(sideToR).connect(merge, 0, 1);
  merge.connect(ctx.destination);
  src.start();
  let out = await ctx.startRendering();
  onStep?.('Mesure de la sonie…');
  const lufs = await loudness(out);
  const gainDb = Math.min(24, p.lufs - lufs);
  applyGain(out, 10 ** (gainDb / 20));
  onStep?.('Limiteur…');
  out = limit(out, -1);
  const finalLufs = await loudness(out);
  return { buffer: out, before: lufs, after: finalLufs, target: p.lufs, peakDb: 20 * Math.log10(peak(out) || 1e-9) };
}

/** Mixage de plusieurs pistes (gain en dB, décalage en secondes, panoramique). */
export async function mix(tracks, sampleRate = SR) {
  const len = Math.max(...tracks.map(t => Math.ceil(((t.offset || 0) + t.buffer.duration) * sampleRate)), 1);
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  for (const t of tracks) {
    if (t.mute) continue;
    const s = ctx.createBufferSource(); s.buffer = t.buffer;
    const g = ctx.createGain(); g.gain.value = 10 ** ((t.gainDb || 0) / 20);
    const pan = ctx.createStereoPanner(); pan.pan.value = t.pan || 0;
    s.connect(g).connect(pan).connect(ctx.destination);
    s.start(Math.max(0, t.offset || 0));
  }
  return ctx.startRendering();
}

/** Estimation du tempo (BPM) et des temps forts, pour caler un montage sur la musique. */
export async function detectBeats(buffer) {
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource(); src.buffer = buffer;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
  src.connect(lp).connect(ctx.destination); src.start();
  const low = (await ctx.startRendering()).getChannelData(0);
  const hop = Math.floor(buffer.sampleRate / 100); // 10 ms
  const env = new Float32Array(Math.floor(low.length / hop));
  for (let i = 0; i < env.length; i++) { let s = 0; for (let j = 0; j < hop; j++) { const v = low[i * hop + j]; s += v * v; } env[i] = Math.sqrt(s / hop); }
  const flux = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);
  let best = 0, bestLag = 50;
  for (let lag = Math.round(6000 / 180); lag <= Math.round(6000 / 70); lag++) {
    let s = 0; for (let i = lag; i < flux.length; i++) s += flux[i] * flux[i - lag];
    const bpm = 6000 / lag;
    s *= 1 - Math.abs(Math.log2(bpm / 120)) * 0.15; // légère préférence autour de 120
    if (s > best) { best = s; bestLag = lag; }
  }
  let bestPhase = 0, bestScore = -1;
  for (let ph = 0; ph < bestLag; ph++) {
    let s = 0; for (let i = ph; i < flux.length; i += bestLag) s += flux[i];
    if (s > bestScore) { bestScore = s; bestPhase = ph; }
  }
  const beats = [];
  for (let i = bestPhase; i < env.length; i += bestLag) beats.push(i / 100);
  return { bpm: Math.round((6000 / bestLag) * 10) / 10, beats };
}

/** Dessin de forme d'onde. */
export function drawWave(canvas, buffer, { sel, playhead, color } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr || 600, hgt = canvas.clientHeight * dpr || 90;
  canvas.width = w; canvas.height = hgt;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, hgt);
  if (!buffer) return;
  const d = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / w));
  const accent = color || getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#7c6cff';
  if (sel) { g.fillStyle = 'rgba(124,108,255,.18)'; g.fillRect((sel[0] / buffer.duration) * w, 0, ((sel[1] - sel[0]) / buffer.duration) * w, hgt); }
  g.fillStyle = accent.trim();
  for (let x = 0; x < w; x++) {
    let mn = 1, mx = -1;
    for (let i = x * step; i < (x + 1) * step && i < d.length; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    g.fillRect(x, ((1 - mx) / 2) * hgt, 1, Math.max(1, ((mx - mn) / 2) * hgt));
  }
  if (playhead !== undefined) { g.fillStyle = '#22d3ee'; g.fillRect((playhead / buffer.duration) * w, 0, 2 * dpr, hgt); }
}

/** Lecteur simple d'AudioBuffer avec position. */
export function bufferPlayer(onTime) {
  let src = null, startAt = 0, offset = 0, raf = 0, buffer = null, playing = false;
  const tick = () => { onTime?.(position()); raf = requestAnimationFrame(tick); };
  function position() { return playing ? Math.min(buffer.duration, audioCtx().currentTime - startAt + offset) : offset; }
  return {
    load(b) { this.stop(); buffer = b; offset = 0; },
    play(from) {
      if (!buffer) return;
      this.stop(false);
      const ctx = audioCtx();
      src = ctx.createBufferSource(); src.buffer = buffer; src.connect(ctx.destination);
      offset = from ?? offset; if (offset >= buffer.duration) offset = 0;
      startAt = ctx.currentTime; src.start(0, offset); playing = true;
      src.onended = () => { if (playing && position() >= buffer.duration - 0.05) { playing = false; offset = 0; cancelAnimationFrame(raf); onTime?.(0, true); } };
      tick();
    },
    pause() { if (!playing) return; offset = position(); this.stop(false); },
    stop(reset = true) { try { src?.stop(); } catch {} src = null; playing = false; cancelAnimationFrame(raf); if (reset) offset = 0; },
    get playing() { return playing; },
    get position() { return position(); },
    seek(t) { const was = playing; offset = t; if (was) this.play(t); else onTime?.(t); },
  };
}

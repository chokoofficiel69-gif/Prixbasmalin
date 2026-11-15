// Reconnaissance locale des accords majeurs/mineurs à partir du chroma.
const NOTES = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const INTERVALS = { majeur: [0, 4, 7], mineur: [0, 3, 7] };

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len, wr0 = Math.cos(angle), wi0 = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const p = i + j, q = p + len / 2;
        const tr = re[q] * wr - im[q] * wi, ti = re[q] * wi + im[q] * wr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const next = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = next;
      }
    }
  }
}
function templates() {
  const out = [];
  for (let root = 0; root < 12; root++) for (const [quality, intervals] of Object.entries(INTERVALS)) {
    const vector = Array(12).fill(0);
    for (const interval of intervals) vector[(root + interval) % 12] = 1;
    out.push({ root, quality, vector });
  }
  return out;
}
const CHORDS = templates();
function classify(chroma) {
  let norm = Math.sqrt(chroma.reduce((sum, x) => sum + x * x, 0));
  if (norm < 1e-8) return null;
  let best = null, second = null;
  for (const candidate of CHORDS) {
    let dot = 0, templateNorm = 0;
    for (let i = 0; i < 12; i++) {
      dot += chroma[i] * candidate.vector[i];
      templateNorm += candidate.vector[i] * candidate.vector[i];
    }
    const score = dot / (norm * Math.sqrt(templateNorm));
    const item = { ...candidate, score };
    if (!best || score > best.score) { second = best; best = item; }
    else if (!second || score > second.score) second = item;
  }
  return { ...best, confidence: Math.max(0, Math.min(1, (best.score - (second?.score ?? 0)) / 0.35)) };
}
function smooth(labels) {
  return labels.map((item, i) => {
    if (!item) return null;
    const window = labels.slice(Math.max(0, i - 1), Math.min(labels.length, i + 2)).filter(Boolean);
    const counts = new Map();
    for (const label of window) {
      const key = label.root + ':' + label.quality;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return window.find(label => label.root + ':' + label.quality === winner) ?? item;
  });
}

/**
 * Analyse une progression d'accords depuis du PCM mono/stéréo.
 * Limité aux triades majeures et mineures ; les extensions et renversements
 * ne sont pas distingués à ce stade. Audio traité localement.
 */
export function analyzeChordProgression(input, sampleRate = 44100, options = {}) {
  if (!(input instanceof Float32Array) && !Array.isArray(input)) throw new TypeError('PCM Float32Array ou canaux requis');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) throw new RangeError('Fréquence échantillonnage invalide');
  const channels = input instanceof Float32Array ? [input] : input;
  if (!channels.length || channels.some(channel => !(channel instanceof Float32Array))) throw new TypeError('Canaux PCM Float32Array requis');
  const length = Math.min(...channels.map(channel => channel.length));
  const size = 8192;
  if (length < size) return { valid: false, reason: 'signal_trop_court', duration: length / sampleRate, segments: [] };
  const hop = Math.floor(size / 2), re = new Float32Array(size), im = new Float32Array(size);
  const frameLabels = [], frameTimes = [];
  const minHz = options.minHz ?? 65, maxHz = Math.min(options.maxHz ?? 1800, sampleRate / 2);
  for (let start = 0; start + size <= length; start += hop) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < size; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[start + i] / channels.length;
      re[i] = sample * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
    }
    fft(re, im);
    const chroma = Array(12).fill(0);
    for (let k = 1; k < size / 2; k++) {
      const hz = k * sampleRate / size;
      if (hz < minHz || hz > maxHz) continue;
      const magnitude = Math.hypot(re[k], im[k]);
      if (magnitude < 1e-5) continue;
      const midi = 69 + 12 * Math.log2(hz / 440);
      const note = Math.round(midi);
      if (Math.abs(midi - note) * 100 > 45) continue;
      const pitchClass = ((note % 12) + 12) % 12;
      chroma[pitchClass] += magnitude / Math.sqrt(Math.max(1, hz / 440));
    }
    const total = chroma.reduce((sum, value) => sum + value, 0);
    frameLabels.push(total > 1e-3 ? classify(chroma) : null);
    frameTimes.push((start + size / 2) / sampleRate);
  }
  const labels = smooth(frameLabels);
  const minDuration = Math.max(0.2, options.minChordSeconds ?? 0.45);
  const segments = [];
  let current = null;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const key = label ? label.root + ':' + label.quality : 'N.C.';
    if (!current || current.key !== key) {
      if (current) {
        current.end = frameTimes[i - 1] + hop / (2 * sampleRate);
        if (current.end - current.start >= minDuration) segments.push(current);
      }
      current = {
        key,
        chord: label ? NOTES[label.root] + (label.quality === 'mineur' ? 'm' : '') : 'N.C.',
        root: label ? NOTES[label.root] : null,
        quality: label?.quality ?? null,
        start: Math.max(0, frameTimes[i] - hop / (2 * sampleRate)),
        end: frameTimes[i] + hop / (2 * sampleRate),
        confidence: label?.confidence ?? 0,
        score: label?.score ?? 0
      };
    } else {
      current.end = frameTimes[i] + hop / (2 * sampleRate);
      current.confidence = Math.min(current.confidence, label?.confidence ?? 0);
      current.score = Math.min(current.score, label?.score ?? 0);
    }
  }
  if (current) {
    current.end = length / sampleRate;
    if (current.end - current.start >= minDuration) segments.push(current);
  }
  for (const segment of segments) {
    segment.start = Number(segment.start.toFixed(3));
    segment.end = Number(segment.end.toFixed(3));
    segment.duration = Number((segment.end - segment.start).toFixed(3));
    segment.confidence = Number(segment.confidence.toFixed(3));
    segment.score = Number(segment.score.toFixed(3));
    delete segment.key;
  }
  return { valid: segments.length > 0, reason: segments.length ? null : 'aucun_accord_fiable', duration: Number((length / sampleRate).toFixed(3)), frameCount: labels.length, segments };
}

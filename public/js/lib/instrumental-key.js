// Analyse tonale légère, sans dépendance ni envoi audio serveur.
// Entrée : PCM Float32 mono ou tableau de canaux Float32Array.
// Cette première brique estime la tonalité globale ; elle ne prétend pas transcrire
// les accords ni isoler une mélodie polyphonique.
const NOTE_NAMES = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr0 = Math.cos(a), wi0 = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const p = i + j, q = p + len / 2;
        const tr = re[q] * wr - im[q] * wi, ti = re[q] * wi + im[q] * wr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nw = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = nw;
      }
    }
  }
}
function pearson(a, b) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
function rotate(profile, root) { return profile.map((_, i) => profile[(i - root + 12) % 12]); }

export function analyzeInstrumentalKey(input, sampleRate = 44100, options = {}) {
  if (!(input instanceof Float32Array) && !Array.isArray(input)) throw new TypeError('PCM Float32Array ou canaux requis');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000) throw new RangeError('Fréquence échantillonnage invalide');
  const channels = input instanceof Float32Array ? [input] : input;
  if (!channels.length || channels.some(c => !(c instanceof Float32Array))) throw new TypeError('Canaux PCM Float32Array requis');
  const length = Math.min(...channels.map(c => c.length));
  const size = Math.min(8192, 2 ** Math.floor(Math.log2(Math.max(256, length))));
  if (length < 4096 || size < 4096) return { valid: false, reason: 'signal_trop_court', key: null, confidence: 0, chroma: Array(12).fill(0) };
  const hop = Math.floor(size / 2), re = new Float32Array(size), im = new Float32Array(size);
  const chroma = new Float64Array(12);
  let frames = 0, totalEnergy = 0;
  const minHz = options.minHz ?? 55, maxHz = Math.min(options.maxHz ?? 5000, sampleRate / 2);
  for (let start = 0; start + size <= length; start += hop) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < size; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[start + i] / channels.length;
      const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
      re[i] = sample * hann;
    }
    fft(re, im);
    let frameEnergy = 0;
    for (let k = 1; k < size / 2; k++) {
      const hz = k * sampleRate / size;
      if (hz < minHz || hz > maxHz) continue;
      const mag = Math.hypot(re[k], im[k]);
      if (mag < 1e-5) continue;
      const midi = 69 + 12 * Math.log2(hz / 440);
      const nearest = Math.round(midi);
      const cents = Math.abs(midi - nearest) * 100;
      if (cents > 48) continue;
      const weight = mag * (1 - cents / 100) / Math.sqrt(Math.max(1, hz / 440));
      chroma[((nearest % 12) + 12) % 12] += weight;
      frameEnergy += mag;
    }
    totalEnergy += frameEnergy;
    frames++;
  }
  const sum = chroma.reduce((a, b) => a + b, 0);
  if (!frames || totalEnergy < 1e-3 || sum < 1e-3) return { valid: false, reason: 'signal_silencieux', key: null, confidence: 0, chroma: Array(12).fill(0) };
  const normalized = Array.from(chroma, x => x / sum);
  const candidates = [];
  for (let root = 0; root < 12; root++) {
    candidates.push({ root, mode: 'majeur', score: pearson(normalized, rotate(MAJOR, root)) });
    candidates.push({ root, mode: 'mineur', score: pearson(normalized, rotate(MINOR, root)) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0], second = candidates[1];
  const margin = Math.max(0, best.score - second.score);
  const confidence = Math.max(0, Math.min(1, margin / 0.18));
  return {
    valid: true,
    key: `${NOTE_NAMES[best.root]} ${best.mode}`,
    root: NOTE_NAMES[best.root],
    mode: best.mode,
    score: Number(best.score.toFixed(4)),
    confidence: Number(confidence.toFixed(3)),
    margin: Number(margin.toFixed(4)),
    frames,
    chroma: normalized.map(x => Number(x.toFixed(5))),
    alternatives: candidates.slice(1, 4).map(c => ({ key: `${NOTE_NAMES[c.root]} ${c.mode}`, score: Number(c.score.toFixed(4)) }))
  };
}

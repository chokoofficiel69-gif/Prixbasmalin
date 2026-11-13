// Analyseur spectral complémentaire pour l'Expert Ingé Son.
// Mesures calculées sur le signal local : aucun audio transmis à un modèle.
// Ne remplace pas l'analyse historique : module additif, sans effet sur les chaînes existantes.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const db = (v) => 20 * Math.log10(Math.max(1e-12, v));

function fftPower(input) {
  const n = input.length;
  const re = Float64Array.from(input);
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const out = new Float64Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  return out;
}

/**
 * Analyse les bandes vocales sur fenêtres Hann chevauchées.
 * sibilanceRatio est une proportion d'énergie 5–10 kHz (indicateur, pas un
 * détecteur phonétique de /s/). noiseFloorDb est le 20e percentile des RMS
 * de fenêtres de 20 ms : estimation prudente, pas une mesure de bruit isolé.
 */
export function analyzeVoiceDsp(samples, sampleRate = 44100) {
  if (!(samples instanceof Float32Array) || !Number.isFinite(sampleRate) || sampleRate < 8000) {
    throw new TypeError('samples doit être un Float32Array et sampleRate >= 8000');
  }
  if (samples.length < 1024) {
    return { valid: false, reason: 'signal_trop_court', sampleCount: samples.length };
  }

  const N = 2048, hop = 1024;
  const bands = { sub: 0, low: 0, lowMid: 0, midHigh: 0, sibilance: 0, air: 0 };
  let total = 0, weightedHz = 0, frames = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  for (let offset = 0; offset + N <= samples.length; offset += hop) {
    const frame = new Float64Array(N);
    let frameEnergy = 0;
    for (let i = 0; i < N; i++) {
      const v = samples[offset + i];
      frameEnergy += v * v;
      frame[i] = v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    }
    if (frameEnergy / N < 1e-10) continue;
    const p = fftPower(frame);
    for (let b = 1; b < p.length; b++) {
      const hz = b * sampleRate / N, e = p[b];
      if (hz < 20 || hz > Math.min(20000, sampleRate / 2)) continue;
      total += e; weightedHz += hz * e;
      if (hz < 120) bands.sub += e;
      else if (hz < 500) bands.low += e;
      else if (hz < 2000) bands.lowMid += e;
      else if (hz < 5000) bands.midHigh += e;
      else if (hz < 10000) bands.sibilance += e;
      else bands.air += e;
    }
    frames++;
  }
  if (!frames || total <= 1e-20) {
    return { valid: false, reason: 'signal_silencieux', sampleCount: samples.length, frames };
  }

  const norm = {};
  for (const [key, value] of Object.entries(bands)) norm[key] = value / total;
  const windows = [];
  const win = Math.max(1, Math.floor(sampleRate * 0.02));
  for (let start = 0; start + win <= samples.length; start += win) {
    let sum = 0;
    for (let i = start; i < start + win; i++) sum += samples[i] * samples[i];
    windows.push(Math.sqrt(sum / win));
  }
  windows.sort((a, b) => a - b);
  const floor = windows[Math.floor((windows.length - 1) * 0.2)] || 0;
  const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
  const ratio = (a, b) => a / Math.max(1e-12, b);
  return {
    valid: true,
    sampleCount: samples.length,
    durationSec: Math.round(samples.length / sampleRate * 1000) / 1000,
    frames,
    peakDbfs: Math.round(db(peak) * 10) / 10,
    rmsDbfs: Math.round(db(rms) * 10) / 10,
    noiseFloorEstimateDbfs: Math.round(db(floor) * 10) / 10,
    crestDb: Math.round((db(peak) - db(rms)) * 10) / 10,
    spectralCentroidHz: Math.round(weightedHz / total),
    bandEnergy: norm,
    sibilanceRatio: Math.round(norm.sibilance * 10000) / 10000,
    lowRatio: Math.round((norm.sub + norm.low) * 10000) / 10000,
    highRatio: Math.round((norm.sibilance + norm.air) * 10000) / 10000,
    confidence: clamp(frames / 12, 0, 1),
    notes: {
      sibilance: 'La bande 5–10 kHz est un indicateur spectral, pas une détection des phonèmes /s/.',
      noiseFloor: 'Le 20e percentile RMS inclut les silences et les passages faibles ; à confirmer sans voix.',
    },
  };
}

/** Convertit les mesures DSP en conseils prudents pour l'Expert Ingé Son. */
export function voiceDspRecommendations(m = {}) {
  if (!m.valid) return ['Prends une nouvelle mesure avec au moins 0,1 seconde de signal exploitable.'];
  const tips = [];
  if (m.sibilanceRatio > 0.22) tips.push('Écouter les sifflantes avant d’activer le de-esser : énergie 5–10 kHz élevée.');
  if (m.lowRatio > 0.65) tips.push('Contrôler le bas de voix et les plosives ; ne pas couper les graves sans écoute.');
  if (m.crestDb < 6) tips.push('Dynamique déjà très resserrée : éviter une compression supplémentaire automatique.');
  if (m.crestDb > 18) tips.push('Dynamique large : vérifier les écarts de niveau avant de compresser.');
  if (m.peakDbfs > -1) tips.push('Crête proche de 0 dBFS : réduire le gain avant tout traitement.');
  if (!tips.length) tips.push('Aucune anomalie spectrale évidente dans ces mesures ; valider à l’écoute.');
  return tips.slice(0, 4);
}

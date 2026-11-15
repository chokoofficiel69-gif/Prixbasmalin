// Mastering avancé — logique pure, testable sous Node (aucune dépendance WebAudio ici).
// Deux outils honnêtes :
//  1) Transient shaper : accentue/adoucit l'attaque et le sustain par double suiveur
//     d'enveloppe (rapide vs lent). Pur calcul d'échantillons -> testable.
//  2) Réglages de compression multibande par preset (grave/médium/aigu), consommés
//     par le graphe WebAudio dans audio.js. On ne met ici que les PARAMÈTRES (purs),
//     pas le filtrage lui-même.

export const dbToLin = (db) => 10 ** (db / 20);
export const linToDb = (x) => 20 * Math.log10(Math.max(1e-9, x));

/** Coefficient d'un suiveur d'enveloppe une-pôle pour une constante de temps en ms. */
export function envCoef(ms, sr = 44100) {
  if (ms <= 0) return 0;
  return Math.exp(-1 / ((ms / 1000) * sr));
}

/**
 * Suiveur d'enveloppe (valeur absolue lissée) avec attaque/relâche distinctes.
 * Retourne un Float32Array de même longueur.
 */
export function envelope(x, { attackMs = 1, releaseMs = 50, sr = 44100 } = {}) {
  const a = envCoef(attackMs, sr), r = envCoef(releaseMs, sr);
  const env = new Float32Array(x.length);
  let e = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    const c = v > e ? a : r;
    e = v + (e - v) * c;
    env[i] = e;
  }
  return env;
}

/**
 * Transient shaper mono. `attack` et `sustain` dans [-1, 1].
 *  attack > 0 : attaques plus nettes (punch) ; < 0 : attaques adoucies.
 *  sustain > 0 : queue/corps plus présent ; < 0 : plus sec.
 * Principe : enveloppe rapide (suit l'attaque) vs lente (suit le corps). La
 * différence rapide-lente marque les transitoires ; on applique un gain
 * dépendant du signe de cette différence. Gain borné pour rester musical.
 */
export function transientShape(x, { attack = 0, sustain = 0, sr = 44100, maxDb = 9 } = {}) {
  const out = new Float32Array(x.length);
  if (!attack && !sustain) { out.set(x); return out; }
  const fast = envelope(x, { attackMs: 0.5, releaseMs: 12, sr });
  const slow = envelope(x, { attackMs: 18, releaseMs: 180, sr });
  const maxLin = dbToLin(maxDb), minLin = dbToLin(-maxDb);
  for (let i = 0; i < x.length; i++) {
    const diff = fast[i] - slow[i]; // >0 pendant l'attaque, <0 pendant la retombée
    const denom = slow[i] + 1e-4;
    const t = diff / denom; // force relative du transitoire, ~[-1, +qqch]
    let gain = 1;
    if (t > 0) gain *= 1 + attack * Math.min(1, t);      // phase d'attaque
    else gain *= 1 + sustain * Math.min(1, -t);          // phase de sustain
    if (gain > maxLin) gain = maxLin; else if (gain < minLin) gain = minLin;
    out[i] = x[i] * gain;
  }
  return out;
}

/** Applique le transient shaper sur chaque canal (tableau de Float32Array). */
export function transientShapeChannels(channels, opts) {
  return channels.map((c) => transientShape(c, opts));
}

// Fréquences de coupure des bandes (Hz) : grave | médium | aigu.
export const CROSSOVERS = { lowMid: 200, midHigh: 3000 };

/**
 * Réglages du compresseur multibande par preset de mastering.
 * Chaque bande : threshold (dB), ratio, attack (s), release (s), makeup (dB).
 * Valeurs modérées : le multibande colle le bas, maîtrise les médiums, ouvre l'aigu
 * sans écraser. `transient` : réglage par défaut du shaper pour ce preset.
 */
export const MULTIBAND_PRESETS = {
  streaming: {
    low: { threshold: -24, ratio: 2.5, attack: 0.012, release: 0.18, makeup: 1 },
    mid: { threshold: -22, ratio: 2, attack: 0.02, release: 0.14, makeup: 0 },
    high: { threshold: -26, ratio: 2, attack: 0.004, release: 0.10, makeup: 0.5 },
    transient: { attack: 0.08, sustain: 0 },
  },
  spotify: {
    low: { threshold: -24, ratio: 2.5, attack: 0.012, release: 0.18, makeup: 1 },
    mid: { threshold: -22, ratio: 2, attack: 0.02, release: 0.14, makeup: 0 },
    high: { threshold: -26, ratio: 2, attack: 0.004, release: 0.10, makeup: 0.5 },
    transient: { attack: 0.08, sustain: 0 },
  },
  youtube: {
    low: { threshold: -25, ratio: 2.2, attack: 0.014, release: 0.2, makeup: 0.8 },
    mid: { threshold: -23, ratio: 1.9, attack: 0.02, release: 0.16, makeup: 0 },
    high: { threshold: -27, ratio: 1.8, attack: 0.005, release: 0.12, makeup: 0.4 },
    transient: { attack: 0.06, sustain: 0 },
  },
  apple: {
    low: { threshold: -28, ratio: 1.8, attack: 0.02, release: 0.25, makeup: 0 },
    mid: { threshold: -26, ratio: 1.5, attack: 0.03, release: 0.2, makeup: 0 },
    high: { threshold: -30, ratio: 1.5, attack: 0.006, release: 0.15, makeup: 0 },
    transient: { attack: 0, sustain: 0.06 },
  },
  tiktok: {
    low: { threshold: -23, ratio: 2.8, attack: 0.01, release: 0.15, makeup: 1.2 },
    mid: { threshold: -21, ratio: 2.2, attack: 0.018, release: 0.13, makeup: 0 },
    high: { threshold: -25, ratio: 2.2, attack: 0.004, release: 0.09, makeup: 0.8 },
    transient: { attack: 0.12, sustain: 0 },
  },
  podcast: {
    low: { threshold: -28, ratio: 1.8, attack: 0.02, release: 0.25, makeup: 0 },
    mid: { threshold: -24, ratio: 2, attack: 0.025, release: 0.2, makeup: 0.3 },
    high: { threshold: -28, ratio: 1.7, attack: 0.006, release: 0.15, makeup: 0.5 },
    transient: { attack: 0, sustain: 0.04 },
  },
  rap: {
    low: { threshold: -22, ratio: 3.5, attack: 0.008, release: 0.12, makeup: 1.5 },
    mid: { threshold: -20, ratio: 2.2, attack: 0.02, release: 0.12, makeup: 0 },
    high: { threshold: -26, ratio: 2.5, attack: 0.003, release: 0.08, makeup: 1 },
    transient: { attack: 0.22, sustain: -0.05 },
  },
  club: {
    low: { threshold: -20, ratio: 4, attack: 0.006, release: 0.10, makeup: 2 },
    mid: { threshold: -18, ratio: 2.5, attack: 0.015, release: 0.10, makeup: 0 },
    high: { threshold: -24, ratio: 3, attack: 0.003, release: 0.07, makeup: 1 },
    transient: { attack: 0.18, sustain: 0 },
  },
  doux: {
    low: { threshold: -28, ratio: 1.8, attack: 0.02, release: 0.25, makeup: 0 },
    mid: { threshold: -26, ratio: 1.5, attack: 0.03, release: 0.2, makeup: 0 },
    high: { threshold: -30, ratio: 1.5, attack: 0.006, release: 0.15, makeup: 0 },
    transient: { attack: 0, sustain: 0.06 },
  },
};

/** Réglages multibande d'un preset (repli : streaming). */
export function multibandSettings(presetKey = 'streaming') {
  return MULTIBAND_PRESETS[presetKey] || MULTIBAND_PRESETS.streaming;
}

/** Ratio crête/RMS (crest factor, dB) d'un signal — indicateur de "punch". */
export function crestFactorDb(x) {
  let peak = 0, sum = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; sum += x[i] * x[i]; }
  const rms = Math.sqrt(sum / (x.length || 1));
  return linToDb(peak) - linToDb(rms || 1e-9);
}

// Mètres de mastering — mesures pures (sans navigateur), testables.
// Opèrent sur des Float32Array (un canal) ou une paire L/R.

const dB = (x) => 20 * Math.log10(Math.max(1e-9, x));

// ---- FFT radix-2 (puissance) pour la balance spectrale ----
function fftPower(re) {
  const n = re.length, im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  const p = new Float32Array(n / 2); for (let i = 0; i < n / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
  return p;
}

/** Crête-échantillon en dBFS. */
export function peakDb(ch) { let p = 0; for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; } return Math.round(dB(p) * 10) / 10; }
/** RMS en dBFS. */
export function rmsDb(ch) { let s = 0; for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i]; return Math.round(dB(Math.sqrt(s / (ch.length || 1))) * 10) / 10; }
/** Facteur de crête (dynamique) en dB. */
export function crestDb(ch) { return Math.round((peakDb(ch) - rmsDb(ch)) * 10) / 10; }

/** True-Peak estimé (dBTP) par suréchantillonnage cubic (Catmull-Rom), facteur os (4 par défaut). */
export function truePeakDb(ch, os = 4) {
  const n = ch.length; if (n < 4) return peakDb(ch);
  const at = (i) => ch[i < 0 ? 0 : i >= n ? n - 1 : i];
  let pk = 0;
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < os; k++) {
      const t = k / os, t2 = t * t, t3 = t2 * t;
      const v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      const a = Math.abs(v); if (a > pk) pk = a;
    }
  }
  const last = Math.abs(ch[n - 1]); if (last > pk) pk = last;
  return Math.round(dB(pk) * 10) / 10;
}

/** Corrélation de phase L/R : +1 (mono/en phase) … 0 (décorrélé) … −1 (opposition de phase). */
export function phaseCorrelation(L, R) {
  const n = Math.min(L.length, R.length); if (!n) return 1;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += L[i] * R[i]; sxx += L[i] * L[i]; syy += R[i] * R[i]; }
  const d = Math.sqrt(sxx * syy); return d < 1e-12 ? 1 : Math.round(sxy / d * 100) / 100;
}

/** Largeur stéréo 0–100 % (énergie side / (mid+side)). 0 = mono. */
export function stereoWidth(L, R) {
  const n = Math.min(L.length, R.length); if (!n) return 0;
  let m = 0, s = 0; for (let i = 0; i < n; i++) { const mid = (L[i] + R[i]) * 0.5, side = (L[i] - R[i]) * 0.5; m += mid * mid; s += side * side; }
  const tot = m + s; return tot < 1e-12 ? 0 : Math.round(s / tot * 100);
}

/** Balance spectrale : part d'énergie grave (<250 Hz), médium (250–4k), aigu (>4k). Somme = 1. */
export function spectralBands(ch, sr = 44100) {
  const N = 4096; if (ch.length < N) { return { low: 0, mid: 0, high: 0 }; }
  const bins = { low: 0, mid: 0, high: 0 }; let wins = 0;
  const hop = Math.max(N, Math.floor((ch.length - N) / 24) || N);
  for (let o = 0; o + N <= ch.length; o += hop) {
    const fr = new Float32Array(N);
    for (let i = 0; i < N; i++) fr[i] = ch[o + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    const p = fftPower(fr);
    for (let b = 1; b < N / 2; b++) { const f = b * sr / N; const e = p[b]; if (f < 250) bins.low += e; else if (f < 4000) bins.mid += e; else bins.high += e; }
    wins++;
  }
  const tot = bins.low + bins.mid + bins.high || 1;
  return { low: Math.round(bins.low / tot * 100) / 100, mid: Math.round(bins.mid / tot * 100) / 100, high: Math.round(bins.high / tot * 100) / 100 };
}

/** Analyse complète d'un master (L, R ou L seul). */
export function analyzeMaster(L, R, sr = 44100) {
  return {
    peakDb: peakDb(L), rmsDb: rmsDb(L), crestDb: crestDb(L), truePeakDb: truePeakDb(L),
    phase: R ? phaseCorrelation(L, R) : 1, width: R ? stereoWidth(L, R) : 0,
    bands: spectralBands(L, sr),
  };
}

/** Conseils chiffrés en comparant le mix à une référence (toutes valeurs mesurées). */
export function compareToRef(mix, ref) {
  const tips = [];
  if (Number.isFinite(mix.lufs) && Number.isFinite(ref.lufs)) {
    const d = Math.round((ref.lufs - mix.lufs) * 10) / 10;
    if (Math.abs(d) >= 1) tips.push(`Niveau : ${d > 0 ? 'monte' : 'baisse'} d'environ ${Math.abs(d)} LU pour coller à la référence (${ref.lufs} LUFS).`);
  }
  if (mix.bands && ref.bands) {
    const dl = Math.round((ref.bands.low - mix.bands.low) * 100), dh = Math.round((ref.bands.high - mix.bands.high) * 100);
    if (dl >= 6) tips.push(`Graves : la référence a plus de bas (${dh < 0 ? '' : ''}+${dl} pts) — ajoute un peu de 60–120 Hz.`);
    else if (dl <= -6) tips.push(`Graves : ton mix a plus de bas (${-dl} pts) — allège vers 80–150 Hz.`);
    if (dh >= 6) tips.push(`Aigus : la référence est plus brillante (+${dh} pts) — ajoute un shelf doux vers 8–12 kHz.`);
    else if (dh <= -6) tips.push(`Aigus : ton mix est plus brillant (${-dh} pts) — calme un peu l'air (>8 kHz).`);
  }
  if (Number.isFinite(mix.width) && Number.isFinite(ref.width)) {
    const d = ref.width - mix.width;
    if (d >= 12) tips.push(`Stéréo : la référence est plus large (+${d} %) — élargis légèrement le mix (M/S).`);
    else if (d <= -12) tips.push(`Stéréo : ton mix est plus large (${-d} %) — resserre un peu pour la mono/club.`);
  }
  if (!tips.length) tips.push('Ton mix est déjà proche de la référence sur le niveau, la balance et la stéréo.');
  return tips.slice(0, 4);
}

// Note de qualité vocale — transforme les MESURES réelles (issues de l'analyse experte,
// ingexpert.js / ingexpert-dsp.js) en scores 0-100 lisibles + un score global. Aucune
// donnée inventée : chaque score vient d'une mesure, avec une formule documentée.
// Logique pure, testable sous Node.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// rampe linéaire lo->hi renvoyée en 0..100
const ramp = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1) * 100;
// plateau : 100 dans [a,b], retombe de part et d'autre sur une largeur w
function plateau(v, a, b, w) {
  if (v >= a && v <= b) return 100;
  const d = v < a ? a - v : v - b;
  return clamp(100 - (d / w) * 100, 0, 100);
}

export function statusOf(pct) { return pct >= 80 ? 'ok' : pct >= 60 ? 'warn' : 'bad'; }
export function verdictOf(pct) { return pct >= 90 ? 'Excellent' : pct >= 75 ? 'Bon' : pct >= 60 ? 'Correct' : 'À travailler'; }

/** Justesse (0-100) : vient directement du % de justesse mesuré. */
export function justesseScore(em) {
  const j = em.justesseAfter != null ? em.justesseAfter : em.justesseBefore;
  return j == null ? null : clamp(Math.round(j), 0, 100);
}

/** Dynamique : crest factor idéal ~6-14 dB (ni écrasé, ni trop sauvage). */
export function dynamiqueScore(em) {
  const crest = em.crestDb != null ? em.crestDb : em.dsp && em.dsp.crestDb;
  if (crest == null) return null;
  return Math.round(plateau(crest, 6, 14, 10));
}

/** Clarté : pénalisée par l'écrêtage (clip) ; bonifiée par une brillance en zone utile. */
export function clarteScore(em) {
  if (em.clipPct == null && em.brightness == null) return null; // pas de mesure -> pas de score
  const clip = em.clipPct != null ? em.clipPct : 0;
  let s = 100 - clip * 6; // 1 % de clip = -6
  // brillance (centroïde relatif) : trop sombre ou trop criard baisse la clarté
  const b = em.brightness != null ? em.brightness : null;
  if (b != null) s -= Math.abs(clamp(b, 0, 1) - 0.5) * 40;
  return Math.round(clamp(s, 0, 100));
}

/** Sibilantes : moins il y a de sifflantes, mieux c'est (ratio sibilance / de-ess requis). */
export function sibilantesScore(em) {
  const r = em.dsp && em.dsp.sibilanceRatio;
  if (r != null) return Math.round(ramp(r, 0.35, 0.05)); // 0.35->0, 0.05->100 (inversé)
  if (em.deess != null) return Math.round(clamp(100 - Math.abs(em.deess) * 12, 0, 100));
  return null;
}

/** Bruit : plancher de bruit bas = propre. -65 dBFS ~100, -40 ~40. */
export function bruitScore(em) {
  const nf = em.dsp && em.dsp.noiseFloorEstimateDbfs;
  if (nf != null) return Math.round(ramp(nf, -40, -65));
  if (em.breathPct != null) return Math.round(clamp(100 - em.breathPct * 3, 0, 100));
  return null;
}

export const SCORE_DEFS = [
  { key: 'justesse', label: 'Justesse', fn: justesseScore, weight: 0.3 },
  { key: 'clarte', label: 'Clarté', fn: clarteScore, weight: 0.2 },
  { key: 'dynamique', label: 'Dynamique', fn: dynamiqueScore, weight: 0.2 },
  { key: 'sibilantes', label: 'Sibilantes', fn: sibilantesScore, weight: 0.15 },
  { key: 'bruit', label: 'Bruit', fn: bruitScore, weight: 0.15 },
];

/**
 * Note globale à partir des mesures. Renvoie { overall, items: [{key,label,pct,status,verdict}] }.
 * `overall` = moyenne pondérée des critères disponibles (null si aucun).
 */
export function scoreVoice(em) {
  if (!em || typeof em !== 'object') return { overall: null, items: [] };
  const items = [];
  let sum = 0, wsum = 0;
  for (const d of SCORE_DEFS) {
    const pct = d.fn(em);
    if (pct == null) continue;
    items.push({ key: d.key, label: d.label, pct, status: statusOf(pct), verdict: verdictOf(pct) });
    sum += pct * d.weight; wsum += d.weight;
  }
  const overall = wsum ? Math.round(sum / wsum) : null;
  return { overall, items };
}

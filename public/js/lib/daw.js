// Transport / grille façon logiciel de rec — helpers purs, testables sans navigateur.
// L'audio (métronome, enregistrement) reste dans record.js ; ici, uniquement les calculs.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function clampBpm(v) { const n = Math.round(Number(v)); return clamp(Number.isFinite(n) ? n : 90, 40, 300); }

/** Position en mesures:temps (1-indexés) à partir des secondes et du BPM. */
export function fmtBarsBeats(sec, bpm, bpb = 4) {
  if (!(bpm > 0)) return '—';
  const beats = Math.max(0, sec) * bpm / 60;
  const bar = Math.floor(beats / bpb) + 1;
  const beat = Math.floor(beats % bpb) + 1;
  return `${bar}:${beat}`;
}

/** Durée (s) d'un décompte de `bars` mesures au BPM donné. */
export function countInDuration(bars, bpm, bpb = 4) {
  if (!(bpm > 0) || !(bars > 0)) return 0;
  return bars * bpb * 60 / bpm;
}

/** Temps (s) de chaque clic sur une durée, avec accent sur le 1er temps de chaque mesure. */
export function beatClickTimes(durationSec, bpm, bpb = 4, startBeatIndex = 0) {
  if (!(bpm > 0) || !(durationSec > 0)) return [];
  const spb = 60 / bpm, out = [];
  for (let i = 0; ; i++) {
    const t = i * spb;
    if (t >= durationSec - 1e-6) break;
    out.push({ t, accent: ((startBeatIndex + i) % bpb) === 0 });
  }
  return out;
}

/** Aimante une position (s) sur la grille. division = temps par pas (1 = la noire, 0.25 = double-croche). */
export function snapToGrid(sec, bpm, division = 1, bpb = 4) {
  if (!(bpm > 0) || !(division > 0)) return sec;
  const step = division * 60 / bpm;
  return Math.round(sec / step) * step;
}

/** Punch-in/out : région à réenregistrer + pré-roll pour se caler. */
export function punchRegion(selFrom, selTo, preRoll = 2) {
  const punchIn = Math.min(selFrom, selTo), punchOut = Math.max(selFrom, selTo);
  return { recStart: Math.max(0, punchIn - Math.max(0, preRoll)), punchIn, punchOut };
}

/** Nombre d'échantillons du fondu enchaîné de comping (par défaut 10 ms). */
export function crossfadeSamples(sr = 44100, fadeSec = 0.01) {
  return Math.max(1, Math.round(Math.max(0, fadeSec) * sr));
}

/** Position (0–100 %) d'un niveau en dBFS sur un vu-mètre (plancher par défaut −60 dB). */
export function dbToMeterPct(db, floor = -60) {
  if (!Number.isFinite(db)) return 0;
  return clamp((db - floor) / (0 - floor) * 100, 0, 100);
}

/** Couleur par rôle (pour la ligne de temps). */
export const ROLE_COLORS = {
  lead: '#3b82f6', double: '#22c55e', backL: '#a855f7', backR: '#ec4899', adlib: '#f59e0b',
  instru: '#64748b', voix: '#0ea5e9', autre: '#94a3b8',
};
// Palette vive façon arrangement DAW : une couleur distincte par piste.
export const CLIP_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#f59e0b', '#06b6d4', '#ef4444', '#84cc16', '#eab308', '#8b5cf6'];
export function colorForTrack(t = {}, i) {
  if (t.kind === 'instru') return ROLE_COLORS.instru;
  if (Number.isFinite(i)) return CLIP_COLORS[((i % CLIP_COLORS.length) + CLIP_COLORS.length) % CLIP_COLORS.length];
  return ROLE_COLORS[t.role] || ROLE_COLORS[t.kind] || ROLE_COLORS.autre;
}

// Autotune Pro — réglages purs (présets, types de voix), testables sans navigateur.
// Le traitement réel reste dans voicefx.js (noteCurve + psola) ; ici on ne fait que
// produire les paramètres de l'étape { t:'tune', mode:'notes', ... }.

const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Type de voix = décalage de formant (timbre) sans changer la hauteur.
export const VOICE_TYPES = {
  naturel:   { label: 'Naturel', formant: 0 },
  grave:     { label: 'Plus grave', formant: -3 },
  aigu:      { label: 'Plus aigu', formant: 3 },
  feminine:  { label: 'Féminine', formant: 4 },
  enfant:    { label: 'Enfant', formant: 6 },
  caverneux: { label: 'Caverneux', formant: -5 },
};
export const VOICE_TYPE_ORDER = ['naturel', 'grave', 'aigu', 'feminine', 'enfant', 'caverneux'];

// Présets « maison » (aucun nom de marque). glide = vitesse (ms), keep = naturel/vibrato,
// strength = force, humanize 0–1, formant (demi-tons), transpose (demi-tons).
export const PRO_PRESETS = {
  ljk:     { label: 'LJK lead', glide: 18, keep: 0.12, strength: 1, humanize: 0.15, formant: 0, transpose: 0 },
  naturel: { label: 'Naturel', glide: 70, keep: 0.5, strength: 0.8, humanize: 0.3, formant: 0, transpose: 0 },
  pop:     { label: 'Pop', glide: 40, keep: 0.25, strength: 1, humanize: 0.1, formant: 0, transpose: 0 },
  robot:   { label: 'Robot', glide: 0, keep: 0, strength: 1, humanize: 0, formant: 0, transpose: 0 },
  backs:   { label: 'Backs', glide: 30, keep: 0.2, strength: 1, humanize: 0.2, formant: 1, transpose: 0 },
  adlibs:  { label: 'Ad-libs', glide: 8, keep: 0.1, strength: 1, humanize: 0.1, formant: 1, transpose: 12 },
};
export const PRO_PRESET_ORDER = ['ljk', 'naturel', 'pop', 'robot', 'backs', 'adlibs'];

export const DEFAULT_PRO = { glide: 30, keep: 0.2, strength: 1, humanize: 0, formant: 0, transpose: 0, voice: 'naturel' };

/** Borne et nettoie les paramètres (tolère valeurs manquantes/NaN). */
export function clampPro(p = {}) {
  return {
    glide: Math.round(clamp(num(p.glide, 30), 0, 400)),
    keep: clamp(num(p.keep, 0.2), 0, 0.7),
    strength: clamp(num(p.strength, 1), 0, 1),
    humanize: clamp(num(p.humanize, 0), 0, 1),
    formant: clamp(num(p.formant, 0), -6, 6),
    transpose: Math.round(clamp(num(p.transpose, 0), -12, 12)),
  };
}

/** Construit l'étape de chaîne pour applyChain (transpose → extra, formant → psola). */
export function buildTuneStep(p = {}) {
  const c = clampPro(p);
  return { t: 'tune', mode: 'notes', strength: c.strength, keep: c.keep, glide: c.glide, humanize: c.humanize, formant: c.formant, extra: c.transpose };
}

/** Fusionne un préset (par clé) avec les réglages courants, en gardant la tonalité choisie. */
export function applyPreset(key, current = {}) {
  const p = PRO_PRESETS[key];
  if (!p) return clampPro(current);
  return clampPro({ ...p });
}

/** Résout le formant depuis un type de voix (le type fixe le formant de base). */
export function formantForVoice(voice) {
  return (VOICE_TYPES[voice] || VOICE_TYPES.naturel).formant;
}

/** Nom lisible résumant les réglages, pour la sauvegarde et l'A/B. */
export function proName(p = {}) {
  const c = clampPro(p);
  const bits = [`vitesse ${c.glide} ms`, `naturel ${Math.round(c.keep * 100)} %`, `force ${Math.round(c.strength * 100)} %`];
  if (c.humanize) bits.push(`humanize ${Math.round(c.humanize * 100)} %`);
  if (c.transpose) bits.push(`transpose ${c.transpose > 0 ? '+' : ''}${c.transpose}`);
  if (c.formant) bits.push(`formant ${c.formant > 0 ? '+' : ''}${c.formant}`);
  return `Autotune Pro (${bits.join(', ')})`;
}

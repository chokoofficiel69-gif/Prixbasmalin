// Ingé son IA — logique pure (sans navigateur ni audio), testable avec node:test.
//
// Ce module ne contient AUCUN traitement audio : il décide seulement, à partir de
// mesures chiffrées, quelle chaîne appliquer et quels conseils donner. Le traitement
// réel (débruitage, autotune, chaîne voix, mix, master) reste dans audio.js / voicefx.js
// et s'exécute en local dans le navigateur. Aucun son n'est jamais envoyé à un LLM :
// seuls les nombres produits ici le sont (voir tipsPrompt).

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => { const m = 10 ** d; return Math.round(v * m) / m; };

// ---------------------------------------------------------------------------
// Rôles de piste et ordre proposé selon l'ordre des prises.
// Volumes et panoramiques demandés : Lead 0 dB · Double −9 dB · Backs −7 dB (±70 %)
// · Ad-libs −6 dB (panoramique alterné).
// ---------------------------------------------------------------------------
export const ROLES = {
  lead:   { label: 'Lead (voix principale)', gainDb: 0,  pan: 0 },
  double: { label: 'Double (doublage serré)', gainDb: -9, pan: 0 },
  backL:  { label: 'Back gauche', gainDb: -7, pan: -0.7 },
  backR:  { label: 'Back droite', gainDb: -7, pan: 0.7 },
  adlib:  { label: 'Ad-lib', gainDb: -6, pan: 0 },
};
export const ROLE_ORDER = ['lead', 'double', 'backL', 'backR', 'adlib'];

/** Rôle proposé selon le numéro de prise (0 = 1re prise). Au-delà de 5 : ad-lib. */
export function proposeRole(takeIndex) {
  return ROLE_ORDER[clamp(takeIndex | 0, 0, ROLE_ORDER.length - 1)];
}

/** Panoramique d'un ad-lib : alterné gauche/droite selon le nombre d'ad-libs déjà posés. */
export function adlibPan(adlibIndex) {
  return (adlibIndex | 0) % 2 === 0 ? -0.5 : 0.5;
}

// ---------------------------------------------------------------------------
// Dosage du débruitage selon le bruit de fond mesuré (en dBFS).
// Très calme (≈ −60 dB) → léger (0.25) ; bruyant (≈ −30 dB) → fort (0.85).
// ---------------------------------------------------------------------------
export function denoiseAmountFromNoise(noiseDb) {
  if (!Number.isFinite(noiseDb)) return 0.5;
  const a = (noiseDb + 60) / 30; // 0 à −60 dB, 1 à −30 dB
  return round(clamp(0.25 + a * 0.6, 0.2, 0.85), 2);
}

// ---------------------------------------------------------------------------
// Autotune selon le rôle. `speed` = temps de glissando en ms (0 = correction dure
// « robot », grand = naturel). `strength` = force de correction (0..1).
// ---------------------------------------------------------------------------
export function autotuneFor(role) {
  switch (role) {
    case 'lead':   return { strength: 0.9, speed: 80 };   // juste mais naturel
    case 'double': return { strength: 1.0, speed: 30 };   // serré, colle au lead
    case 'backL':
    case 'backR':  return { strength: 0.95, speed: 45 };
    case 'adlib':  return { strength: 1.0, speed: 0 };    // effet assumé
    default:       return { strength: 0.9, speed: 60 };
  }
}

// ---------------------------------------------------------------------------
// Chaîne voix selon le rôle (paramètres passés à voiceChain de audio.js).
// Le lead est présent et devant ; doubles/backs reculent (moins de présence,
// plus de réverb) ; ad-libs brillants et colorés.
// ---------------------------------------------------------------------------
export function voiceFor(role) {
  const base = { highpass: 90, low: -1, presence: 4, air: 3, deess: 4, comp: 0.75, reverb: 0.08 };
  switch (role) {
    case 'lead':   return { ...base };
    case 'double': return { ...base, presence: 2, air: 2, comp: 0.8, reverb: 0.05 };
    case 'backL':
    case 'backR':  return { ...base, presence: 1.5, air: 2.5, comp: 0.7, reverb: 0.18 };
    case 'adlib':  return { ...base, presence: 3, air: 4, comp: 0.7, reverb: 0.2 };
    default:       return { ...base };
  }
}

// ---------------------------------------------------------------------------
// Temps de delay calé sur le tempo. Par défaut une croche (1/8). Borné.
// ---------------------------------------------------------------------------
export function delayTimeFromBpm(bpm, division = 0.5) {
  if (!Number.isFinite(bpm) || bpm <= 0) return 0.3;
  const quarter = 60 / bpm;
  return round(clamp(quarter * division, 0.05, 1.2), 3);
}

/** Envoi delay/réverb selon le rôle. `time` est rempli par l'appelant via delayTimeFromBpm. */
export function sendsFor(role, bpm) {
  switch (role) {
    case 'lead':   return { delay: { kind: 'delay', time: delayTimeFromBpm(bpm, 0.5), fb: 0.25, mix: 0.16 } };
    case 'adlib':  return { delay: { kind: 'pingpong', time: delayTimeFromBpm(bpm, 0.5), fb: 0.3, mix: 0.32 } };
    case 'backL':
    case 'backR':  return { delay: { kind: 'delay', time: delayTimeFromBpm(bpm, 0.25), fb: 0.2, mix: 0.14 } };
    case 'double': return { delay: null }; // le double reste sec, collé au lead
    default:       return { delay: null };
  }
}

/** Plan complet de traitement d'une prise, uniquement à partir des mesures. */
export function roleChain(role, { noiseDb, bpm } = {}) {
  const r = ROLES[role] || ROLES.lead;
  return {
    role,
    label: r.label,
    denoise: denoiseAmountFromNoise(noiseDb),
    gate: { threshold: -45, floor: -30 },
    autotune: autotuneFor(role),
    voice: voiceFor(role),
    gainDb: r.gainDb,
    pan: r.pan,
    sends: sendsFor(role, bpm),
  };
}

// ---------------------------------------------------------------------------
// Vu-mètre en direct : alertes saturation / trop faible (crête en dBFS).
// ---------------------------------------------------------------------------
export function vuState(peakDb) {
  if (!Number.isFinite(peakDb)) return { level: 'ok', msg: '' };
  if (peakDb > -1) return { level: 'sature', msg: '⚠️ Ça sature (crête > −1 dBFS) : baisse le gain ou éloigne-toi du micro.' };
  if (peakDb < -30) return { level: 'faible', msg: '🔉 Trop faible (< −30 dBFS) : rapproche-toi du micro ou monte le gain.' };
  return { level: 'ok', msg: '🟢 Bon niveau.' };
}

// ---------------------------------------------------------------------------
// Test micro (5 s) : conseils selon niveau (crête + RMS) et bruit de fond.
// ---------------------------------------------------------------------------
export function micAdvice({ peakDb, rmsDb, noiseDb } = {}) {
  const tips = [];
  let verdict = 'ok';
  if (Number.isFinite(peakDb) && peakDb > -1) { tips.push('Ça sature : baisse le gain d’entrée ou éloigne-toi un peu du micro.'); verdict = 'sature'; }
  else if (Number.isFinite(rmsDb) && rmsDb < -30) { tips.push('Voix trop faible : rapproche-toi du micro ou monte le gain.'); verdict = 'faible'; }
  else if (Number.isFinite(rmsDb) && rmsDb > -12) { tips.push('Un peu fort : recule légèrement pour garder de la marge avant saturation.'); verdict = 'fort'; }
  else { tips.push('Bon niveau de voix, garde cette distance au micro.'); }

  if (Number.isFinite(noiseDb)) {
    if (noiseDb > -40) tips.push('Beaucoup de bruit de fond : coupe ventilateur/clim, ferme la fenêtre, éloigne l’ordinateur.');
    else if (noiseDb > -55) tips.push('Un peu de bruit de fond : le débruitage s’en chargera, mais une pièce plus calme aide.');
    else tips.push('Pièce bien calme : parfait pour enregistrer.');
  }
  // signal/bruit approximatif
  const snr = (Number.isFinite(rmsDb) && Number.isFinite(noiseDb)) ? round(rmsDb - noiseDb, 1) : null;
  return { verdict, tips, snrDb: snr };
}

// ---------------------------------------------------------------------------
// Justesse : écart moyen (en cents) des notes chantées à la gamme de la tonalité.
// f0 = tableau de fréquences Hz (0 = non voisé). Retourne pct (100 = parfait).
// ---------------------------------------------------------------------------
const SCALE_SEMITONES = {
  majeur: [0, 2, 4, 5, 7, 9, 11],
  mineur: [0, 2, 3, 5, 7, 8, 10],
};
export function justesse(f0, key) {
  const sc = SCALE_SEMITONES[key && key.mode] || SCALE_SEMITONES.majeur;
  const root = (key && Number.isFinite(key.root)) ? key.root : 0;
  // notes MIDI autorisées, pour recherche du plus proche (large plage)
  const allowed = [];
  for (let oct = 1; oct <= 7; oct++) for (const s of sc) allowed.push(12 * oct + ((root + s) % 12) + ((root + s) >= 12 ? 0 : 0));
  allowed.sort((a, b) => a - b);
  let sum = 0, n = 0;
  for (const f of f0) {
    if (!f || f <= 0) continue;
    const m = 69 + 12 * Math.log2(f / 440);
    let best = Infinity;
    for (const a of allowed) { const d = Math.abs(a - m); if (d < best) best = d; else if (a > m && d > best) break; }
    sum += best * 100; // demi-tons → cents
    n++;
  }
  if (!n) return { avgCents: null, pct: null, voicedFrames: 0 };
  const avgCents = round(sum / n, 1);
  // 0 cent → 100 % ; 50 cents (à mi-chemin entre deux notes) → 0 %
  const pct = round(clamp(100 - (avgCents * 2), 0, 100), 0);
  return { avgCents, pct, voicedFrames: n };
}

// ---------------------------------------------------------------------------
// Rapport en français simple : ce qui a été fait + mesures chiffrées.
// ---------------------------------------------------------------------------
export function buildReport(m = {}) {
  const r = ROLES[m.role] || {};
  const lines = [];
  lines.push(`Rôle : ${r.label || m.role}.`);
  const parts = [];
  if (Number.isFinite(m.denoise)) parts.push(`débruitage dosé à ${Math.round(m.denoise * 100)} %`);
  parts.push('anti-pop', 'coupe des blancs');
  if (Number.isFinite(m.alignMs) && m.alignMs !== 0) parts.push(`calage sur l’instru (${m.alignMs > 0 ? '+' : ''}${Math.round(m.alignMs)} ms)`);
  if (m.key) parts.push(`autotune dans la tonalité ${m.key}`);
  parts.push('chaîne voix adaptée au rôle');
  lines.push('Fait : ' + parts.join(', ') + '.');

  const mes = [];
  if (Number.isFinite(m.levelDb)) mes.push(`niveau ${round(m.levelDb, 1)} dBFS`);
  if (Number.isFinite(m.noiseDb)) mes.push(`bruit de fond ${round(m.noiseDb, 1)} dBFS`);
  if (Number.isFinite(m.justesseBefore) && Number.isFinite(m.justesseAfter)) mes.push(`justesse ${m.justesseBefore} % → ${m.justesseAfter} %`);
  if (Number.isFinite(m.alignMs)) mes.push(`décalage corrigé ${Math.round(m.alignMs)} ms`);
  if (Number.isFinite(m.bpm)) mes.push(`tempo ${m.bpm} BPM`);
  if (Number.isFinite(m.gainDb)) mes.push(`volume réglé à ${m.gainDb} dB`);
  if (mes.length) lines.push('Mesures : ' + mes.join(' · ') + '.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Conseils par le LLM — À PARTIR DES SEULES MESURES CHIFFRÉES (aucun audio).
// Retourne {system, prompt}. L'appelant envoie ça à /api/complete.
// ---------------------------------------------------------------------------
export function tipsPrompt(m = {}) {
  const facts = {
    role: m.role,
    niveau_dBFS: Number.isFinite(m.levelDb) ? round(m.levelDb, 1) : null,
    bruit_fond_dBFS: Number.isFinite(m.noiseDb) ? round(m.noiseDb, 1) : null,
    rapport_signal_bruit_dB: Number.isFinite(m.snrDb) ? round(m.snrDb, 1) : null,
    justesse_avant_pct: Number.isFinite(m.justesseBefore) ? m.justesseBefore : null,
    justesse_apres_pct: Number.isFinite(m.justesseAfter) ? m.justesseAfter : null,
    decalage_corrige_ms: Number.isFinite(m.alignMs) ? Math.round(m.alignMs) : null,
    tempo_bpm: Number.isFinite(m.bpm) ? m.bpm : null,
    saturation: Number.isFinite(m.peakDb) ? (m.peakDb > -1) : null,
  };
  const system = 'Tu es un ingénieur du son. À partir UNIQUEMENT des mesures chiffrées fournies (tu n’as pas accès à l’audio), donne 1 à 3 conseils courts et concrets pour améliorer la PROCHAINE prise. Réponds en français simple, une puce par conseil, sans jargon inutile, sans inventer de mesure non fournie.';
  const prompt = 'Mesures de la prise (chiffres uniquement, aucun son) :\n' + JSON.stringify(facts, null, 2) + '\n\nDonne 1 à 3 conseils pour la prochaine prise.';
  return { system, prompt, facts };
}

/** Conseils de secours (règles simples) si le LLM est indisponible. */
export function fallbackTips(m = {}) {
  const tips = [];
  if (Number.isFinite(m.peakDb) && m.peakDb > -1) tips.push('La prise sature : baisse le gain d’entrée ou éloigne-toi du micro.');
  if (Number.isFinite(m.noiseDb) && m.noiseDb > -45) tips.push('Bruit de fond élevé : enregistre dans une pièce plus calme (le débruitage a ses limites).');
  if (Number.isFinite(m.justesseAfter) && m.justesseAfter < 70) tips.push('Justesse encore moyenne : chante plus près de la note, ou ralentis le débit sur ce passage.');
  if (Number.isFinite(m.snrDb) && m.snrDb < 15) tips.push('Voix peu détachée du bruit : rapproche-toi du micro pour un meilleur rapport signal/bruit.');
  if (!tips.length) tips.push('Bonne prise : garde cette distance au micro et ce niveau.');
  return tips.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Préférences mémorisées (fusion valeurs par défaut + enregistrées).
// ---------------------------------------------------------------------------
export const DEFAULT_PREFS = {
  enabled: true,        // mode Ingé son activé par défaut
  autoProcess: true,    // traiter automatiquement après chaque prise
  masterPreset: 'rap',  // preset de mastering préféré
  rawMic: false,        // micro brut (filtres du téléphone désactivés)
};
export function mergePrefs(saved) {
  const out = { ...DEFAULT_PREFS };
  if (saved && typeof saved === 'object') for (const k of Object.keys(DEFAULT_PREFS)) if (k in saved) out[k] = saved[k];
  return out;
}

// ---------------------------------------------------------------------------
// Mesures de niveau sur un tableau d'échantillons (mono) — utilisé côté navigateur
// après décodage, et testable sans navigateur.
// ---------------------------------------------------------------------------
export function peakDbOf(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a; }
  return 20 * Math.log10(p || 1e-9);
}
export function rmsDbOf(samples) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return 10 * Math.log10((s / (samples.length || 1)) || 1e-12);
}
/** Bruit de fond = RMS du décile le plus calme (fenêtres de ~50 ms). */
export function noiseFloorDb(samples, sampleRate = 44100) {
  const win = Math.max(1, Math.floor(0.05 * sampleRate));
  const rms = [];
  for (let s = 0; s + win <= samples.length; s += win) {
    let acc = 0; for (let i = s; i < s + win; i++) acc += samples[i] * samples[i];
    rms.push(Math.sqrt(acc / win));
  }
  if (!rms.length) return rmsDbOf(samples);
  rms.sort((a, b) => a - b);
  const q = Math.max(1, Math.floor(rms.length * 0.1));
  let acc = 0; for (let i = 0; i < q; i++) acc += rms[i];
  return 20 * Math.log10((acc / q) || 1e-9);
}

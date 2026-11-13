// Ingé son Expert — analyse poussée + décisions de chaîne, logique pure (sans navigateur).
// Toutes les mesures sortent de calculs sur les échantillons (pas d'audio envoyé à un LLM).
// Les estimations spectrales sont volontairement prudentes et étiquetées comme telles.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 1) => { const m = 10 ** d; return Math.round(v * m) / m; };
const dB = (x) => 20 * Math.log10((x || 0) + 1e-9);

// ---- petite FFT (radix-2) pour repérer une résonance grave-médium ----
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

/** Analyse d'un signal mono. Retourne des mesures chiffrées (dBFS, %, Hz, ratios 0–1). */
export function analyzeSamples(samples, sr = 44100) {
  const n = samples.length || 1;
  let peak = 0, sumSq = 0, clip = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; sumSq += samples[i] * samples[i]; if (a >= 0.98) clip++; }
  const peakDb = round(dB(peak)), rmsDb = round(dB(Math.sqrt(sumSq / n)));
  const crestDb = round(peakDb - rmsDb);
  const clipPct = round(clip / n * 100, 2);

  // brillance / sifflantes : énergie haute fréquence via différence première (proxy, estimé)
  let dSq = 0; for (let i = 1; i < n; i++) { const d = samples[i] - samples[i - 1]; dSq += d * d; }
  const brightness = round(clamp((dSq / (sumSq + 1e-9)) / 2, 0, 1), 2);

  // graves / plosives : énergie basse via lissage 1-pôle (proxy, estimé)
  let lp = 0, lpSq = 0; const a = Math.exp(-2 * Math.PI * 120 / sr);
  for (let i = 0; i < n; i++) { lp = a * lp + (1 - a) * samples[i]; lpSq += lp * lp; }
  const lowRatio = round(clamp(lpSq / (sumSq + 1e-9), 0, 1), 2);

  // respirations / blancs : part de fenêtres 50 ms faibles mais non muettes
  const win = Math.max(1, Math.floor(0.05 * sr)); let breath = 0, frames = 0;
  for (let s = 0; s + win <= n; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += samples[i] * samples[i]; const d = dB(Math.sqrt(e / win)); frames++; if (d > -55 && d < -40) breath++; }
  const breathPct = round(frames ? breath / frames * 100 : 0, 1);

  // résonance grave-médium : pic du spectre moyen entre 150 et 500 Hz (décimé à ~8 kHz)
  const resonanceHz = findResonance(samples, sr);

  return { peakDb, rmsDb, crestDb, clipPct, brightness, lowRatio, breathPct, resonanceHz };
}

/** Fréquence de résonance dominante (150–500 Hz) ou null. */
export function findResonance(samples, sr = 44100) {
  const target = 8000, step = Math.max(1, Math.floor(sr / target)), dsr = sr / step;
  const N = 2048; const dec = [];
  for (let i = 0; i + step <= samples.length && dec.length < N * 8; i += step) dec.push(samples[i]);
  if (dec.length < N) return null;
  const avg = new Float32Array(N / 2); let wins = 0;
  for (let o = 0; o + N <= dec.length; o += N) {
    const fr = new Float32Array(N);
    for (let i = 0; i < N; i++) fr[i] = dec[o + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    const p = fftPower(fr); for (let i = 0; i < N / 2; i++) avg[i] += p[i]; wins++;
  }
  if (!wins) return null;
  let bestBin = -1, bestVal = 0;
  const binHz = dsr / N, lo = Math.floor(150 / binHz), hi = Math.ceil(500 / binHz);
  for (let b = lo; b <= hi && b < N / 2; b++) if (avg[b] > bestVal) { bestVal = avg[b]; bestBin = b; }
  if (bestBin < 0) return null;
  // n'est une « résonance » que si le pic dépasse nettement la moyenne de la bande
  let mean = 0, cnt = 0; for (let b = lo; b <= hi && b < N / 2; b++) { mean += avg[b]; cnt++; }
  mean /= (cnt || 1);
  return bestVal > mean * 2.2 ? Math.round(bestBin * binHz) : null;
}

// Styles : influencent voix, autotune, mastering.
export const STYLES = {
  rap:   { label: 'Rap', voicePreset: 'rap', master: 'rap', tuneSpeed: 24, tuneStrength: 1, air: 3 },
  chant: { label: 'Chant', voicePreset: 'chant', master: 'streaming', tuneSpeed: 70, tuneStrength: 0.85, air: 3 },
  drill: { label: 'Drill', voicePreset: 'rap', master: 'club', tuneSpeed: 14, tuneStrength: 1, air: 2.5 },
  rnb:   { label: 'RnB', voicePreset: 'chant', master: 'streaming', tuneSpeed: 45, tuneStrength: 0.95, air: 4 },
};
export const STYLE_ORDER = ['rap', 'chant', 'drill', 'rnb'];

/** De-esser dosé selon la brillance mesurée (0 = aucun, 10 = fort). */
export function deessFor(brightness) { return round(clamp(brightness * 14, 0, 10), 1); }
/** Anti-pop dosé selon l'énergie grave (0.5–1). */
export function antipopFor(lowRatio) { return round(clamp(0.5 + lowRatio * 0.6, 0.5, 1), 2); }

/** Plan de chaîne experte à partir du rôle de base, du style et des mesures. */
export function expertChain(baseVoice, style, analysis = {}) {
  const st = STYLES[style] || STYLES.rap;
  const voice = { ...baseVoice };
  voice.deess = Math.max(voice.deess || 0, deessFor(analysis.brightness || 0));
  voice.air = st.air;
  if (analysis.brightness > 0.6) voice.air = Math.min(voice.air, 2); // déjà très brillant : on calme l'aigu
  const steps = { antipop: antipopFor(analysis.lowRatio || 0), notchHz: null, notchGain: 0, deEssExtra: 0 };
  if (analysis.resonanceHz) { steps.notchHz = analysis.resonanceHz; steps.notchGain = analysis.resonanceHz < 350 ? -4 : -3; }
  const tune = { strength: st.tuneStrength, speed: st.tuneSpeed };
  return { style, voice, steps, tune, master: st.master };
}

/** Gain de calage de l'instru sous la voix (duck), selon la sonie voix/instru. */
export function instruDuckDb(voiceLufs, instruLufs) {
  if (!Number.isFinite(voiceLufs) || !Number.isFinite(instruLufs)) return 0;
  // on vise la voix ~3 LU au-dessus de l'instru
  const want = voiceLufs - 3;
  return round(clamp(want - instruLufs, -12, 0), 1);
}

/** Rapport détaillé en français simple. */
export function expertReport(m = {}) {
  const lines = ['Analyse experte :'];
  const add = (k, v) => lines.push('• ' + k + ' : ' + v);
  if (Number.isFinite(m.peakDb)) add('crête', `${m.peakDb} dBFS`);
  if (Number.isFinite(m.rmsDb)) add('niveau moyen', `${m.rmsDb} dBFS`);
  if (Number.isFinite(m.crestDb)) add('dynamique', `${m.crestDb} dB${m.crestDb > 18 ? ' (très dynamique)' : m.crestDb < 8 ? ' (très compressé)' : ''}`);
  if (Number.isFinite(m.clipPct)) add('saturation', m.clipPct > 0.01 ? `${m.clipPct} % d’échantillons écrêtés ⚠️` : 'aucune');
  if (Number.isFinite(m.lufs)) add('sonie', `${m.lufs} LUFS`);
  if (Number.isFinite(m.brightness)) add('sifflantes (estim.)', m.brightness > 0.6 ? 'fortes' : m.brightness > 0.35 ? 'moyennes' : 'faibles');
  if (m.resonanceHz) add('résonance grave-médium', `vers ${m.resonanceHz} Hz (atténuée)`);
  if (Number.isFinite(m.breathPct)) add('respirations/blancs', `${m.breathPct} %`);
  if (m.dsp) {
    add('centre spectral', `${m.dsp.spectralCentroidHz} Hz (analyse DSP)`);
    add('énergie 5–10 kHz', `${(m.dsp.sibilanceRatio * 100).toFixed(1)} % (indicateur, pas détection phonétique)`);
    add('estimation bruit', `${m.dsp.noiseFloorEstimateDbfs} dBFS (à confirmer sur un passage sans voix)`);
    add('confiance spectrale', `${Math.round(m.dsp.confidence * 100)} %`);
  }
  for (const tip of (m.dspRecommendations || []).slice(0, 3)) lines.push('• Contrôle DSP : ' + tip);
  const done = [];
  if (m.deess) done.push(`de-esser ${m.deess}`);
  if (m.notchHz) done.push(`EQ anti-résonance à ${m.notchHz} Hz`);
  if (Number.isFinite(m.instruDuck) && m.instruDuck < 0) done.push(`instru baissée de ${Math.abs(m.instruDuck)} dB sous la voix`);
  if (m.style) done.push(`réglages ${(STYLES[m.style] || {}).label || m.style}`);
  if (done.length) lines.push('Traitement : ' + done.join(', ') + '.');
  return lines.join('\n');
}

// Persona partagé (conseils de prise ET consultations) — identité + règles de réponse.
export const EXPERT_SYSTEM_CORE = [
  'Tu es un ingénieur du son professionnel expérimenté : 30 ans de studio (prise de son, mixage, mastering), référence dans tous les genres (Rap/Hip-Hop/Trap/Drill, Électro/House/EDM, Pop, R&B, Afrobeat, Rock, Acoustique). Tu connais le matériel légendaire (SSL, Neve, API, 1176, LA-2A, Distressor, Pultec) et les plugins modernes (FabFilter, UAD, Waves, Soundtoys, Valhalla, iZotope Ozone), mais tu ne nommes une marque que si ça aide vraiment.',
  'Règles de réponse :',
  '1. Diagnostic chirurgical : nomme la cause exacte (conflit de fréquences, phase, dynamique mal gérée, manque de headroom, écrêtage, résonance…).',
  '2. Réglages ultra-précis et chiffrés : fréquences en Hz, valeurs de Q, ratios de compression, attaque/relâchement en ms, niveaux en dB, cibles LUFS. Jamais de conseil vague.',
  '3. Adapte la chaîne au genre/style indiqué. Ex. : saturation harmonique + compression parallèle pour Rap/Électro ; transparence et profondeur pour l’acoustique.',
  '4. Relie toujours le réglage à l’émotion, au groove et à l’impact sur tous les systèmes (club, voiture, smartphone, casque).',
].join('\n');

/** Invite LLM experte — SEULEMENT des nombres (aucun audio). */
export function expertTipsPrompt(m = {}) {
  const facts = {
    style: m.style, crete_dBFS: m.peakDb ?? null, niveau_moyen_dBFS: m.rmsDb ?? null, dynamique_dB: m.crestDb ?? null,
    ecretage_pct: m.clipPct ?? null, sonie_LUFS: m.lufs ?? null, sifflantes_0a1: m.brightness ?? null,
    resonance_Hz: m.resonanceHz ?? null, respirations_pct: m.breathPct ?? null,
    de_esser: m.deess ?? null, duck_instru_dB: m.instruDuck ?? null,
    justesse_avant_pct: m.justesseBefore ?? null, justesse_apres_pct: m.justesseAfter ?? null,
    analyse_spectrale_DSP: m.dsp ?? null,
    controles_DSP: m.dspRecommendations ?? [],
  };
  const system = EXPERT_SYSTEM_CORE + '\nIMPORTANT : tu n’as pas l’audio, seulement les mesures chiffrées ci-dessous. N’invente aucune mesure non fournie. Réponds en français, 2 à 3 conseils maximum, une puce par conseil, priorisés.';
  const prompt = 'Mesures de la voix/prise (chiffres uniquement, aucun son) :\n' + JSON.stringify(facts, null, 2) + '\n\nDonne 2 à 3 conseils experts, chiffrés et priorisés.';
  return { system, prompt, facts };
}

const field = (name, label, type, opts) => ({ name, label, type, ...(opts || {}) });
// Consultations prêtes à l'emploi (les 4 fiches). `build(v)` renvoie le texte de la demande.
export const CONSULTATIONS = [
  {
    id: 'voix', label: '🎤 Chirurgie voix (chaîne vocale sur mesure)',
    fields: [field('voix', 'Caractère de ta voix', 'select', { options: ['grave', 'aiguë', 'nasillarde', 'agressive', 'posée'] }), field('style', 'Style du morceau', 'text', { placeholder: 'ex. Trap sombre, Boom Bap, Afro-Pop, Électro' })],
    build: (v) => `Voici les caractéristiques de ma voix (${v.voix || 'non précisé'}) et le style du morceau (${v.style || 'non précisé'}). Construis-moi ma chaîne complète de traitement vocal étape par étape dans l'ordre exact (nettoyage, compression, égalisation, saturation, effets temporels). Donne-moi les fréquences exactes à couper ou booster, les réglages précis de mes compresseurs (ratio, attaque, relâchement) et le dosage des envois (sends) de reverb et delay pour que ma voix perce le mix sans être agressive.`,
  },
  {
    id: 'basses', label: '🔊 Crash-test des basses (Kick & 808 / Sub)',
    fields: [field('style', 'Style', 'text', { placeholder: 'ex. Drill, Techno, House, Trap' })],
    build: (v) => `J'ai un problème de gestion des basses sur mon morceau [${v.style || 'style non précisé'}]. Mon kick et ma basse/808 manquent de puissance ou se masquent mutuellement. Donne-moi une méthode d'ingénieur du son étape par étape pour les faire cohabiter parfaitement : réglage du sidechain (fréquences ciblées, temps de relâchement), découpage fréquentiel chirurgical (EQ), gestion de la phase et saturation harmonique pour que la basse soit audible même sur un petit haut-parleur de téléphone.`,
  },
  {
    id: 'master', label: '💽 Mastering streaming & club',
    fields: [field('style', 'Style', 'text', { placeholder: 'ex. Trap, House…' }), field('headroom', 'Marge (headroom) en dB', 'text', { placeholder: '-6', value: '-6' })],
    build: (v) => `Mon mixage est terminé avec une marge (headroom) de ${v.headroom || '-6'} dB. Je veux faire le mastering de ce titre [${v.style || 'style non précisé'}] pour qu'il rivalise avec les sorties commerciales actuelles sur Spotify, Apple Music et en club. Détaille-moi la chaîne de mastering idéale (EQ de correction, compression de bus/glue, élargissement stéréo Mid/Side, saturation et limiteur final). Indique-moi les valeurs cibles précises en LUFS intégrés, True Peak (dBTP) et la plage dynamique à respecter pour éviter que les plateformes de streaming n'écrasent mon son.`,
  },
  {
    id: 'reference', label: '🎯 Audit & référence (viser le son d’un hit)',
    fields: [field('morceau', 'Titre de référence', 'text', { placeholder: 'ex. SICKO MODE' }), field('artiste', 'Artiste', 'text', { placeholder: 'ex. Travis Scott' })],
    build: (v) => `Je veux que mon morceau se rapproche de la couleur sonore et de la dynamique du titre '${v.morceau || '?'}' de '${v.artiste || '?'}'. Analyse ce titre en tant qu'ingénieur du son : décris-moi l'équilibre fréquentiel (graves, médiums, aigus), le placement des éléments dans l'espace stéréo, la texture des voix et l'impact de la batterie. Donne-moi ensuite les astuces concrètes et les réglages à appliquer sur mon propre mix pour obtenir cette même signature sonore.`,
  },
];

/** Construit {system, prompt} pour une consultation. Le système = persona + consigne de forme. */
export function buildConsult(id, values = {}) {
  const c = CONSULTATIONS.find(x => x.id === id);
  if (!c) return null;
  const system = EXPERT_SYSTEM_CORE + '\nRéponds en français, structuré en étapes numérotées dans l’ordre d’application, avec des valeurs chiffrées (Hz, Q, ratios, ms, dB, LUFS, dBTP). Reste concret et actionnable.';
  return { system, prompt: c.build(values), consult: c.id };
}

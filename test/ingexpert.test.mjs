// Tests Ingé son Expert (purs, sans navigateur).
// Lancer : node --test test/ingexpert.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples, findResonance, STYLES, STYLE_ORDER, deessFor, antipopFor, expertChain, instruDuckDb, expertReport, expertTipsPrompt, EXPERT_SYSTEM_CORE, CONSULTATIONS, buildConsult, buildVoiceProposals } from '../public/js/lib/ingexpert.js';

const sine = (hz, sec, sr = 44100, amp = 0.5) => { const n = Math.floor(sec * sr), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / sr); return a; };

test('analyse : crête, RMS, dynamique, clipping', () => {
  const a = analyzeSamples(sine(200, 1, 44100, 0.5));
  assert.ok(a.peakDb > -7 && a.peakDb < -5, `crête ~ −6 dBFS (${a.peakDb})`);
  assert.ok(a.rmsDb < a.peakDb, 'RMS sous la crête');
  assert.ok(a.crestDb > 0);
  assert.equal(a.clipPct, 0, 'pas de clipping à 0,5');
  const clipped = new Float32Array(44100).fill(1); // signal saturé
  assert.ok(analyzeSamples(clipped).clipPct > 50, 'clipping détecté');
});

test('brillance : un signal aigu est plus « brillant » qu’un grave', () => {
  const low = analyzeSamples(sine(150, 1)).brightness;
  const high = analyzeSamples(sine(4000, 1)).brightness;
  assert.ok(high > low, `aigu plus brillant (${high} > ${low})`);
});

test('résonance : un 300 Hz fort est repéré dans la bande 150–500', () => {
  const r = findResonance(sine(300, 1.5));
  assert.ok(r !== null && Math.abs(r - 300) < 60, `résonance ~300 Hz, obtenu ${r}`);
  // bruit blanc léger → pas de résonance franche
  const noise = new Float32Array(44100); for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * 0.05;
  const rn = findResonance(noise);
  assert.ok(rn === null || typeof rn === 'number');
});

test('de-esser et anti-pop dosés selon les mesures', () => {
  assert.ok(deessFor(0.8) > deessFor(0.2), 'plus de sifflantes → plus de de-esser');
  assert.ok(deessFor(2) <= 10 && deessFor(-1) >= 0, 'borné');
  assert.ok(antipopFor(1) > antipopFor(0), 'plus de graves → plus d’anti-pop');
  assert.ok(antipopFor(1) <= 1 && antipopFor(0) >= 0.5, 'borné');
});

test('expertChain : de-esser monte avec la brillance, notch si résonance, style appliqué', () => {
  const base = { highpass: 90, low: -1, presence: 4, air: 3, deess: 2, comp: 0.75, reverb: 0.08 };
  const plan = expertChain(base, 'drill', { brightness: 0.8, lowRatio: 0.5, resonanceHz: 300 });
  assert.ok(plan.voice.deess >= deessFor(0.8));
  assert.equal(plan.steps.notchHz, 300);
  assert.ok(plan.steps.notchGain < 0);
  assert.equal(plan.master, STYLES.drill.master);
  assert.equal(plan.tune.speed, STYLES.drill.tuneSpeed);
  // très brillant → on calme l'aigu
  assert.ok(plan.voice.air <= 2);
  // sans résonance → pas de notch
  assert.equal(expertChain(base, 'rap', { brightness: 0.3, lowRatio: 0.2 }).steps.notchHz, null);
});

test('instruDuckDb : vise la voix ~3 LU au-dessus de l’instru', () => {
  assert.equal(instruDuckDb(-12, -12), -3, 'instru baissée de 3 dB');
  assert.equal(instruDuckDb(-12, -20), 0, 'déjà sous la voix → pas de baisse');
  assert.ok(instruDuckDb(-9, -3) >= -12, 'borné');
  assert.equal(instruDuckDb(NaN, -10), 0, 'mesure absente → 0');
});

test('rapport détaillé contient les mesures', () => {
  const r = expertReport({ peakDb: -1.2, rmsDb: -14, crestDb: 12.8, clipPct: 0, lufs: -13.5, brightness: 0.7, resonanceHz: 280, breathPct: 9, deess: 5, notchHz: 280, instruDuck: -3, style: 'rap' });
  assert.match(r, /dynamique : 12.8 dB/);
  assert.match(r, /280 Hz/);
  assert.match(r, /de-esser 5/);
  assert.match(r, /instru baissée de 3 dB/);
});

test('invite LLM experte : nombres seulement, aucun audio', () => {
  const { system, prompt, facts } = expertTipsPrompt({ style: 'rap', peakDb: -1, crestDb: 9, clipPct: 0.2, lufs: -12, brightness: 0.6, resonanceHz: 300, deess: 6 });
  assert.match(system, /professionnel exp/i);
  assert.match(system, /pas l’audio|pas l'audio/i);
  assert.equal(facts.resonance_Hz, 300);
  assert.ok(!/base64|data:audio|\.wav|échantillons|samples/i.test(prompt));
});

test('styles disponibles', () => {
  assert.deepEqual(STYLE_ORDER, ['rap', 'chant', 'drill', 'rnb']);
  for (const k of STYLE_ORDER) assert.ok(STYLES[k].master && STYLES[k].voicePreset);
});

test('consultations : 4 fiches, persona partagé, variables remplies', () => {
  assert.equal(CONSULTATIONS.length, 4);
  assert.deepEqual(CONSULTATIONS.map(c => c.id), ['voix', 'basses', 'master', 'reference']);
  assert.match(EXPERT_SYSTEM_CORE, /professionnel exp/i);
  const voix = buildConsult('voix', { voix: 'grave', style: 'Trap sombre' });
  assert.match(voix.system, /professionnel exp/i);
  assert.match(voix.system, /étapes numérotées/);
  assert.match(voix.prompt, /grave/); assert.match(voix.prompt, /Trap sombre/);
  const ref = buildConsult('reference', { morceau: 'SICKO MODE', artiste: 'Travis Scott' });
  assert.match(ref.prompt, /SICKO MODE/); assert.match(ref.prompt, /Travis Scott/);
  const master = buildConsult('master', { style: 'Trap', headroom: '-6' });
  assert.match(master.prompt, /-6 dB/); assert.match(master.prompt, /LUFS|True Peak|dBTP/);
  assert.equal(buildConsult('inconnu'), null);
});

test('Head Audio Engineer : quatre propositions distinctes et adaptées aux mesures', () => {
  const low = buildVoiceProposals({ brightness: 0.15, lowRatio: 0.2, crestDb: 19, resonanceHz: null }, 'rap');
  const bright = buildVoiceProposals({ brightness: 0.85, lowRatio: 0.8, crestDb: 5, resonanceHz: 310 }, 'drill');
  assert.deepEqual(low.map(p => p.id), ['premium', 'broadcast', 'modern', 'natural']);
  assert.equal(bright.length, 4);
  assert.equal(new Set(low.map(p => JSON.stringify(p.settings))).size, 4, 'les quatre chaînes sont distinctes');
  assert.ok(bright[0].settings.highpass > low[0].settings.highpass, 'plus de bas mesuré → passe-haut plus haut');
  assert.ok(bright[0].settings.deess > low[0].settings.deess, 'plus de brillance mesurée → contrôle sifflantes renforcé');
  assert.ok(bright[3].settings.comp < bright[2].settings.comp, 'version naturelle moins compressée');
});

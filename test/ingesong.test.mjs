// Tests de la logique « Ingé son IA » (pure, sans navigateur ni audio).
// Lancer : node --test test/ingesong.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES, ROLE_ORDER, proposeRole, adlibPan,
  denoiseAmountFromNoise, autotuneFor, voiceFor, delayTimeFromBpm, sendsFor, roleChain,
  vuState, micAdvice, justesse, buildReport, tipsPrompt, fallbackTips,
  DEFAULT_PREFS, mergePrefs, peakDbOf, rmsDbOf, noiseFloorDb,
} from '../public/js/lib/ingesong.js';

test('rôle proposé selon l’ordre des prises', () => {
  assert.equal(proposeRole(0), 'lead');
  assert.equal(proposeRole(1), 'double');
  assert.equal(proposeRole(2), 'backL');
  assert.equal(proposeRole(3), 'backR');
  assert.equal(proposeRole(4), 'adlib');
  assert.equal(proposeRole(9), 'adlib', 'au-delà de 5 prises : ad-lib');
});

test('volumes et panoramiques demandés par rôle', () => {
  assert.equal(ROLES.lead.gainDb, 0);
  assert.equal(ROLES.double.gainDb, -9);
  assert.equal(ROLES.backL.gainDb, -7);
  assert.equal(ROLES.backR.gainDb, -7);
  assert.equal(ROLES.backL.pan, -0.7);
  assert.equal(ROLES.backR.pan, 0.7);
  assert.equal(ROLES.adlib.gainDb, -6);
});

test('panoramique alterné des ad-libs', () => {
  assert.equal(adlibPan(0), -0.5);
  assert.equal(adlibPan(1), 0.5);
  assert.equal(adlibPan(2), -0.5);
});

test('dosage du débruitage selon le bruit de fond (monotone et borné)', () => {
  const quiet = denoiseAmountFromNoise(-60);
  const mid = denoiseAmountFromNoise(-45);
  const loud = denoiseAmountFromNoise(-30);
  assert.ok(quiet < mid && mid < loud, 'plus de bruit → plus de débruitage');
  assert.ok(quiet >= 0.2 && loud <= 0.85, 'bornes respectées');
  assert.equal(denoiseAmountFromNoise(-200), 0.2, 'borne basse');
  assert.equal(denoiseAmountFromNoise(0), 0.85, 'borne haute');
  assert.equal(denoiseAmountFromNoise(NaN), 0.5, 'valeur par défaut si mesure absente');
});

test('autotune : vitesse selon le rôle (ad-lib dur, lead naturel)', () => {
  assert.equal(autotuneFor('adlib').speed, 0, 'ad-lib = correction dure');
  assert.ok(autotuneFor('lead').speed > autotuneFor('double').speed, 'lead plus naturel que le double');
  assert.ok(autotuneFor('lead').strength <= 1 && autotuneFor('adlib').strength === 1);
});

test('delay calé sur le tempo', () => {
  assert.equal(delayTimeFromBpm(120, 0.5), 0.25, 'croche à 120 BPM = 0,25 s');
  assert.equal(delayTimeFromBpm(120, 1), 0.5, 'noire à 120 BPM = 0,5 s');
  assert.equal(delayTimeFromBpm(0), 0.3, 'tempo inconnu → valeur par défaut');
  assert.ok(delayTimeFromBpm(300, 1) <= 1.2 && delayTimeFromBpm(300, 0.0001) >= 0.05, 'bornes');
});

test('envois delay selon le rôle', () => {
  assert.equal(sendsFor('double', 120).delay, null, 'le double reste sec');
  assert.equal(sendsFor('adlib', 120).delay.kind, 'pingpong');
  assert.equal(sendsFor('lead', 120).delay.kind, 'delay');
  assert.equal(sendsFor('lead', 120).delay.time, 0.25);
});

test('plan de chaîne complet cohérent avec les mesures', () => {
  const plan = roleChain('backL', { noiseDb: -45, bpm: 90 });
  assert.equal(plan.gainDb, -7);
  assert.equal(plan.pan, -0.7);
  assert.equal(plan.denoise, denoiseAmountFromNoise(-45));
  assert.equal(plan.gate.threshold, -45);
  assert.ok(plan.voice.highpass > 0);
  assert.ok(plan.sends.delay && plan.sends.delay.time > 0);
});

test('vu-mètre : alertes saturation et niveau faible', () => {
  assert.equal(vuState(-0.5).level, 'sature');
  assert.equal(vuState(-40).level, 'faible');
  assert.equal(vuState(-12).level, 'ok');
});

test('conseils test micro selon niveau et bruit', () => {
  assert.equal(micAdvice({ peakDb: -0.2, rmsDb: -8, noiseDb: -60 }).verdict, 'sature');
  assert.equal(micAdvice({ peakDb: -10, rmsDb: -34, noiseDb: -60 }).verdict, 'faible');
  const bruyant = micAdvice({ peakDb: -8, rmsDb: -18, noiseDb: -35 });
  assert.ok(bruyant.tips.some(t => /bruit de fond/i.test(t)));
  assert.equal(micAdvice({ peakDb: -8, rmsDb: -18, noiseDb: -35 }).snrDb, 17);
});

test('justesse : gamme parfaite ≈ 100 %, désaccordé plus bas', () => {
  const key = { root: 0, mode: 'majeur' }; // Do majeur
  // Do4 (261.63), Mi4 (329.63), Sol4 (392.0) — notes exactes de la gamme
  const parfait = justesse([261.63, 329.63, 392.0], key);
  assert.ok(parfait.pct >= 95, `attendu ~100 %, obtenu ${parfait.pct}`);
  // un quart de ton (~50 cents) au-dessus du Do → justesse basse
  const faux = justesse([261.63 * Math.pow(2, 0.5 / 12)], key);
  assert.ok(faux.pct <= parfait.pct, 'une note fausse baisse la justesse');
  assert.equal(justesse([0, 0, 0], key).voicedFrames, 0, 'aucune note voisée');
});

test('rapport en français avec les mesures chiffrées', () => {
  const txt = buildReport({ role: 'lead', denoise: 0.5, alignMs: 12, key: 'Do mineur', levelDb: -9.2, noiseDb: -58.4, justesseBefore: 72, justesseAfter: 95, bpm: 90, gainDb: 0 });
  assert.match(txt, /Lead/);
  assert.match(txt, /72 % → 95 %/);
  assert.match(txt, /90 BPM/);
  assert.match(txt, /débruitage dosé à 50 %/);
});

test('invite LLM : seulement des nombres, aucun audio', () => {
  const { system, prompt, facts } = tipsPrompt({ role: 'lead', levelDb: -9.2, noiseDb: -58.4, snrDb: 49, justesseBefore: 72, justesseAfter: 95, alignMs: 12, bpm: 90, peakDb: -2 });
  assert.match(system, /mesures chiffrées/i);
  assert.match(system, /n’as pas accès à l’audio|pas accès à l'audio/i);
  // le prompt ne contient que des champs chiffrés/known, pas de données audio brutes
  assert.equal(facts.niveau_dBFS, -9.2);
  assert.equal(facts.saturation, false);
  assert.ok(!/base64|data:audio|\.wav|échantillons|samples/i.test(prompt), 'aucune donnée audio dans l’invite');
});

test('conseils de secours sans LLM', () => {
  assert.ok(fallbackTips({ peakDb: 0.5 }).some(t => /sature/i.test(t)));
  assert.ok(fallbackTips({ noiseDb: -30 }).some(t => /bruit/i.test(t)));
  assert.ok(fallbackTips({}).length >= 1);
  assert.ok(fallbackTips({ peakDb: 0.5, noiseDb: -20, justesseAfter: 50, snrDb: 5 }).length <= 3, 'au plus 3 conseils');
});

test('préférences : fusion avec les valeurs par défaut', () => {
  assert.equal(mergePrefs(null).enabled, true);
  assert.equal(mergePrefs({ masterPreset: 'club' }).masterPreset, 'club');
  assert.equal(mergePrefs({ masterPreset: 'club' }).enabled, DEFAULT_PREFS.enabled);
  assert.equal(mergePrefs({ inconnu: 1 }).inconnu, undefined, 'ignore les clés inconnues');
});

test('mesures de niveau sur échantillons', () => {
  const n = 44100;
  const sine = new Float32Array(n);
  for (let i = 0; i < n; i++) sine[i] = 0.5 * Math.sin(2 * Math.PI * 200 * i / n);
  const pk = peakDbOf(sine);
  assert.ok(pk > -7 && pk < -5, `crête ~ −6 dBFS pour une amplitude 0,5 (obtenu ${pk.toFixed(2)})`);
  const rms = rmsDbOf(sine);
  assert.ok(rms < pk, 'le RMS est sous la crête');
  // bruit de fond : signal avec une moitié silencieuse → plancher très bas
  const half = new Float32Array(n);
  for (let i = 0; i < n / 2; i++) half[i] = 0.5 * Math.sin(2 * Math.PI * 200 * i / n);
  assert.ok(noiseFloorDb(half, n) < -80, 'le décile calme capte le silence');
});

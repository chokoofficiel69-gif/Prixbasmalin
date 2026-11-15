import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreVoice, justesseScore, dynamiqueScore, clarteScore, sibilantesScore, bruitScore,
  statusOf, verdictOf, SCORE_DEFS,
} from '../public/js/lib/voicescore.js';

test('statusOf / verdictOf : seuils', () => {
  assert.equal(statusOf(90), 'ok');
  assert.equal(statusOf(70), 'warn');
  assert.equal(statusOf(50), 'bad');
  assert.equal(verdictOf(95), 'Excellent');
  assert.equal(verdictOf(80), 'Bon');
  assert.equal(verdictOf(65), 'Correct');
  assert.equal(verdictOf(40), 'À travailler');
});

test('justesseScore : prend la justesse après si dispo', () => {
  assert.equal(justesseScore({ justesseBefore: 50, justesseAfter: 92 }), 92);
  assert.equal(justesseScore({ justesseBefore: 70 }), 70);
  assert.equal(justesseScore({}), null);
});

test('dynamiqueScore : plateau 6-14 dB', () => {
  assert.equal(dynamiqueScore({ crestDb: 10 }), 100);
  assert.ok(dynamiqueScore({ crestDb: 2 }) < 100); // trop écrasé
  assert.ok(dynamiqueScore({ crestDb: 22 }) < 100); // trop sauvage
  assert.equal(dynamiqueScore({}), null);
});

test('clarteScore : l\'écrêtage fait chuter', () => {
  assert.ok(clarteScore({ clipPct: 0, brightness: 0.5 }) > clarteScore({ clipPct: 5, brightness: 0.5 }));
});

test('sibilantesScore : moins de sibilance = meilleur', () => {
  assert.ok(sibilantesScore({ dsp: { sibilanceRatio: 0.06 } }) > sibilantesScore({ dsp: { sibilanceRatio: 0.3 } }));
});

test('bruitScore : plancher plus bas = plus propre', () => {
  assert.ok(bruitScore({ dsp: { noiseFloorEstimateDbfs: -62 } }) > bruitScore({ dsp: { noiseFloorEstimateDbfs: -45 } }));
});

test('scoreVoice : global pondéré + items, ignore les mesures absentes', () => {
  const em = { justesseAfter: 92, crestDb: 10, clipPct: 0, brightness: 0.5, dsp: { sibilanceRatio: 0.08, noiseFloorEstimateDbfs: -60, crestDb: 10 } };
  const r = scoreVoice(em);
  assert.ok(r.overall >= 80 && r.overall <= 100);
  assert.equal(r.items.length, 5);
  for (const it of r.items) { assert.ok(it.pct >= 0 && it.pct <= 100); assert.ok(['ok', 'warn', 'bad'].includes(it.status)); }
});

test('scoreVoice : objet vide -> overall null, pas d\'items', () => {
  const r = scoreVoice({});
  assert.equal(r.overall, null);
  assert.equal(r.items.length, 0);
});

test('scoreVoice : entrée invalide gérée', () => {
  assert.deepEqual(scoreVoice(null), { overall: null, items: [] });
  assert.equal(SCORE_DEFS.length, 5);
});

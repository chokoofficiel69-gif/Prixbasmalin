// Tests des mètres de mastering (purs, sans navigateur).
// Lancer : node --test test/meters.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakDb, rmsDb, crestDb, truePeakDb, phaseCorrelation, stereoWidth, spectralBands, analyzeMaster, compareToRef } from '../public/js/lib/meters.js';

const sine = (hz, sec = 1, sr = 44100, amp = 0.5, ph = 0) => { const n = Math.floor(sec * sr), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / sr + ph); return a; };

test('peak / rms / crest', () => {
  const s = sine(200, 1, 44100, 0.5);
  assert.ok(peakDb(s) > -7 && peakDb(s) < -5);
  assert.ok(rmsDb(s) < peakDb(s));
  assert.ok(crestDb(s) > 2 && crestDb(s) < 4, 'crest d’une sinus ≈ 3 dB');
});

test('true-peak ≥ crête-échantillon, et dépasse pour un signal inter-échantillon', () => {
  const s = sine(1000, 0.2, 44100, 0.9);
  assert.ok(truePeakDb(s) >= peakDb(s) - 0.1);
  // sinus à sr/12 avec une phase qui fait rater la crête : la crête réelle (inter-échantillon)
  // dépasse nettement la crête-échantillon → le True-Peak suréchantillonné le voit.
  const s2 = sine(3675, 0.2, 44100, 1.0, Math.PI / 12);
  assert.ok(truePeakDb(s2) > peakDb(s2), `true-peak (${truePeakDb(s2)}) > crête (${peakDb(s2)})`);
});

test('corrélation de phase', () => {
  const L = sine(200), R = sine(200);
  assert.equal(phaseCorrelation(L, R), 1, 'identiques → +1');
  const Rinv = sine(200, 1, 44100, 0.5, Math.PI);
  assert.ok(phaseCorrelation(L, Rinv) < -0.9, 'opposition de phase → ≈ −1');
});

test('largeur stéréo', () => {
  const L = sine(200), R = sine(200);
  assert.equal(stereoWidth(L, R), 0, 'mono → 0 %');
  const Rinv = sine(200, 1, 44100, 0.5, Math.PI);
  assert.ok(stereoWidth(L, Rinv) > 80, 'L=−R → très large');
});

test('balance spectrale : grave vs aigu', () => {
  const low = spectralBands(sine(100, 1));
  assert.ok(low.low > 0.8, 'sinus 100 Hz → surtout grave');
  const high = spectralBands(sine(9000, 1));
  assert.ok(high.high > 0.8, 'sinus 9 kHz → surtout aigu');
});

test('analyzeMaster assemble les mesures', () => {
  const L = sine(200), R = sine(500);
  const a = analyzeMaster(L, R);
  assert.ok(Number.isFinite(a.truePeakDb) && Number.isFinite(a.phase) && Number.isFinite(a.width));
  assert.ok(a.bands.low + a.bands.mid + a.bands.high > 0.9);
});

test('compareToRef donne des conseils chiffrés', () => {
  const mix = { lufs: -16, width: 20, bands: { low: 0.2, mid: 0.6, high: 0.2 } };
  const ref = { lufs: -10, width: 40, bands: { low: 0.35, mid: 0.45, high: 0.2 } };
  const tips = compareToRef(mix, ref);
  assert.ok(tips.some(t => /monte.*6/i.test(t)), 'propose de monter ~6 LU');
  assert.ok(tips.some(t => /Graves/i.test(t)));
  assert.ok(tips.some(t => /Stéréo/i.test(t)));
  assert.ok(compareToRef({ lufs: -10, width: 30, bands: { low: .3, mid: .4, high: .3 } }, { lufs: -10, width: 30, bands: { low: .3, mid: .4, high: .3 } }).length >= 1);
});

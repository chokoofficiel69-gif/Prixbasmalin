import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVoiceDsp, voiceDspRecommendations } from '../public/js/lib/ingexpert-dsp.js';

const sine = (hz, sec = 1, sr = 44100, amp = 0.4) => {
  const out = new Float32Array(Math.floor(sec * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin(2 * Math.PI * hz * i / sr);
  return out;
};

test('analyse spectrale : les bandes distinguent grave et sifflance', () => {
  const low = analyzeVoiceDsp(sine(100));
  const high = analyzeVoiceDsp(sine(7000));
  assert.equal(low.valid, true);
  assert.equal(high.valid, true);
  assert.ok(low.bandEnergy.sub > high.bandEnergy.sub);
  assert.ok(high.sibilanceRatio > low.sibilanceRatio);
  assert.ok(high.spectralCentroidHz > low.spectralCentroidHz);
});

test('mesures de niveau et dynamique cohérentes', () => {
  const m = analyzeVoiceDsp(sine(440, 1, 44100, 0.5));
  assert.ok(m.peakDbfs < 0 && m.peakDbfs > -8);
  assert.ok(m.rmsDbfs < m.peakDbfs);
  assert.ok(m.crestDb > 2 && m.crestDb < 5);
  assert.ok(m.noiseFloorEstimateDbfs <= m.rmsDbfs);
});

test('silence et signal trop court ne déclenchent pas de faux diagnostic', () => {
  assert.equal(analyzeVoiceDsp(new Float32Array(300)).valid, false);
  assert.equal(analyzeVoiceDsp(new Float32Array(4096)).reason, 'signal_silencieux');
});

test('valide le type et la fréquence échantillonnage', () => {
  assert.throws(() => analyzeVoiceDsp([], 44100), TypeError);
  assert.throws(() => analyzeVoiceDsp(new Float32Array(4096), 4000), TypeError);
});

test('recommandations prudentes et bornées', () => {
  assert.equal(voiceDspRecommendations({ valid: false }).length, 1);
  assert.ok(voiceDspRecommendations({ valid: true, sibilanceRatio: .3, lowRatio: .7, crestDb: 4, peakDbfs: -0.5 }).length <= 4);
});

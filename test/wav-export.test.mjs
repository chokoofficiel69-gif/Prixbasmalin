import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantizePcmSample } from '../public/js/lib/wav-export.js';

test('quantification PCM 16/24 bits respecte les bornes signées', () => {
  for (const bits of [16, 24]) {
    const min = -(2 ** (bits - 1)), max = 2 ** (bits - 1) - 1;
    assert.equal(quantizePcmSample(-1, bits, () => 0.5, false), min);
    assert.equal(quantizePcmSample(1, bits, () => 0.5, false), max);
    assert.equal(quantizePcmSample(Number.NaN, bits, () => 0.5, false), 0);
  }
});

test('dither TPDF reste borné et ne décale pas un signal constant en moyenne', () => {
  const vals = [0.1, 0.2, 0.3, 0.4]; let i = 0;
  const random = () => vals[(i++) % vals.length];
  const q = quantizePcmSample(0, 16, random, true);
  assert.ok(q >= -1 && q <= 1);
  assert.equal(quantizePcmSample(0.25, 16, () => 0.5, true), quantizePcmSample(0.25, 16, () => 0.5, false));
});

test('formats non pris en charge refusés explicitement', () => {
  assert.throws(() => quantizePcmSample(0, 32), /16 ou 24/);
});

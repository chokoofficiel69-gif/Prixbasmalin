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

test('dither TPDF reste borné et conserve une erreur moyenne proche de zéro', () => {
  let seed = 123456789;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  let sum = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const q = quantizePcmSample(0, 16, random, true);
    sum += q; min = Math.min(min, q); max = Math.max(max, q);
  }
  assert.ok(Math.abs(sum / 20000) < 0.03, 'le dither ne doit pas introduire de biais DC');
  assert.ok(min >= -1 && max <= 1, 'le bruit reste dans les limites de quantification du silence');
  assert.equal(quantizePcmSample(0.25, 16, () => 0.5, true), quantizePcmSample(0.25, 16, () => 0.5, false));
});

test('formats non pris en charge refusés explicitement', () => {
  assert.throws(() => quantizePcmSample(0, 32), /16 ou 24/);
});

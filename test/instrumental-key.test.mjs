import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeInstrumentalKey } from '../public/js/lib/instrumental-key.js';

function chord(frequencies, seconds = 2, sampleRate = 44100) {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    for (const hz of frequencies) out[i] += 0.12 * Math.sin(2 * Math.PI * hz * t);
  }
  return out;
}

test('analyse une instrumentale et retourne une tonalité avec confiance bornée', () => {
  const pcm = chord([261.63, 329.63, 392.00, 523.25]); // accord de Do majeur
  const result = analyzeInstrumentalKey(pcm);
  assert.equal(result.valid, true);
  assert.equal(typeof result.key, 'string');
  assert.ok(result.chroma.length === 12);
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  assert.ok(result.frames > 0);
});

test('ne donne pas de tonalité sur un silence', () => {
  const result = analyzeInstrumentalKey(new Float32Array(44100));
  assert.equal(result.valid, false);
  assert.equal(result.key, null);
  assert.equal(result.reason, 'signal_silencieux');
});

test('refuse les entrées invalides et les fréquences impossibles', () => {
  assert.throws(() => analyzeInstrumentalKey([], 4000), RangeError);
  assert.throws(() => analyzeInstrumentalKey([new Float32Array(4096)]), TypeError);
  assert.equal(analyzeInstrumentalKey(new Float32Array(2000)).reason, 'signal_trop_court');
});

test('analyse les canaux stéréo sans modifier les buffers originaux', () => {
  const left = chord([220, 277.18, 329.63]);
  const right = chord([220, 277.18, 329.63]);
  const before = left[100];
  const result = analyzeInstrumentalKey([left, right]);
  assert.equal(result.valid, true);
  assert.equal(left[100], before);
});

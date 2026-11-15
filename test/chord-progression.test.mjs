import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChordProgression } from '../public/js/lib/chord-progression.js';

function tone(freqs, seconds, sampleRate = 44100) {
  const pcm = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < pcm.length; i++) {
    const t = i / sampleRate;
    for (const hz of freqs) pcm[i] += 0.1 * Math.sin(2 * Math.PI * hz * t);
  }
  return pcm;
}
function progression() {
  const blocks = [
    tone([261.63, 329.63, 392], 2), // Do majeur
    tone([220, 261.63, 329.63], 2) // La mineur
  ];
  const out = new Float32Array(blocks[0].length + blocks[1].length);
  out.set(blocks[0], 0); out.set(blocks[1], blocks[0].length);
  return out;
}

test('détecte les accords majeurs et mineurs dans l’ordre', () => {
  const result = analyzeChordProgression(progression());
  assert.equal(result.valid, true);
  assert.ok(result.segments.length >= 2);
  assert.equal(result.segments[0].chord, 'Do');
  assert.ok(result.segments.some(segment => segment.chord === 'Lam'));
  assert.ok(result.segments.every(segment => segment.end > segment.start && segment.duration > 0));
});

test('refuse les entrées invalides et les fréquences impossibles', () => {
  assert.throws(() => analyzeChordProgression(tone([440], 1), 4000), RangeError);
  assert.throws(() => analyzeChordProgression([new Int16Array(9000)]), TypeError);
  assert.equal(analyzeChordProgression(new Float32Array(1000)).reason, 'signal_trop_court');
});

test('ne modifie pas le PCM original', () => {
  const pcm = progression();
  const before = pcm[1000];
  const result = analyzeChordProgression(pcm);
  assert.equal(result.valid, true);
  assert.equal(pcm[1000], before);
});

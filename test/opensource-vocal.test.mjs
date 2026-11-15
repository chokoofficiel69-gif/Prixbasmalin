import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, PRESET_CATS } from '../public/js/lib/voicefx.js';

const pack = PRESETS.filter(p => p.cat === '🆓 Pack vocal libre');

test('le pack vocal libre expose les alternatives principales', () => {
  const names = pack.map(p => p.name);
  for (const name of [
    'Correction vocale libre — naturelle',
    'Correction vocale libre — hard tune',
    'Harmony Engine — tierce et quinte',
    'Choir — chœur large',
    'Vocoder — robot 20 bandes',
    'Aspirer — nettoyage + gate',
    'Duo — doublage naturel',
    'Mic Mod — micro radio studio',
    'Mutator — formant + modulation',
    'Punch — voix percutante',
    'Tranche — attaque et présence',
    'Chaud — saturation analogique',
  ]) assert.ok(names.includes(name), `préréglage manquant : ${name}`);
  assert.ok(PRESET_CATS.includes('🆓 Pack vocal libre'));
});

test('les chaînes du pack ne contiennent que des briques connues du moteur', () => {
  const allowed = new Set(['tune', 'shift', 'double', 'harmony', 'vocoder', 'fx']);
  for (const preset of pack) {
    assert.ok(preset.chain.length > 0, preset.name);
    for (const step of preset.chain) assert.ok(allowed.has(step.t), `${preset.name}: ${step.t}`);
  }
});

test('les effets DSP ajoutés ont des paramètres bornés et raisonnables', () => {
  const all = pack.flatMap(p => p.chain).filter(s => s.t === 'fx');
  assert.ok(all.some(s => s.kind === 'deesser'));
  assert.ok(all.some(s => s.kind === 'phaser'));
  assert.ok(all.some(s => s.kind === 'compressor'));
  assert.ok(all.some(s => s.kind === 'gate'));
  assert.ok(all.some(s => s.kind === 'eq'));
});

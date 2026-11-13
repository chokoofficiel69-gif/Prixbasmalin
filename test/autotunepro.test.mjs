// Tests des réglages Autotune Pro (purs, sans navigateur).
// Lancer : node --test test/autotunepro.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VOICE_TYPES, VOICE_TYPE_ORDER, PRO_PRESETS, PRO_PRESET_ORDER, DEFAULT_PRO,
  clampPro, buildTuneStep, applyPreset, formantForVoice, proName,
} from '../public/js/lib/autotunepro.js';

test('présets demandés présents et cohérents', () => {
  for (const k of ['ljk', 'naturel', 'pop', 'robot', 'backs', 'adlibs']) assert.ok(PRO_PRESETS[k], `préset ${k}`);
  assert.deepEqual(PRO_PRESET_ORDER, ['ljk', 'naturel', 'pop', 'robot', 'backs', 'adlibs']);
  assert.equal(PRO_PRESETS.robot.glide, 0, 'Robot = correction dure (0 ms)');
  assert.equal(PRO_PRESETS.robot.keep, 0, 'Robot ne garde pas le vibrato');
  assert.equal(PRO_PRESETS.adlibs.transpose, 12, 'Ad-libs montés d’une octave');
  assert.ok(PRO_PRESETS.naturel.glide > PRO_PRESETS.ljk.glide, 'Naturel plus doux que le lead');
});

test('clampPro borne tout et tolère les valeurs absentes/NaN', () => {
  const c = clampPro({ glide: 999, keep: 5, strength: 9, humanize: 9, formant: 99, transpose: 99 });
  assert.equal(c.glide, 400);
  assert.equal(c.keep, 0.7);
  assert.equal(c.strength, 1);
  assert.equal(c.humanize, 1);
  assert.equal(c.formant, 6);
  assert.equal(c.transpose, 12);
  const d = clampPro({});
  assert.equal(d.glide, 30); assert.equal(d.transpose, 0);
  const e = clampPro({ glide: 'abc', transpose: NaN });
  assert.equal(e.glide, 30, 'NaN → valeur par défaut'); assert.equal(e.transpose, 0);
  const neg = clampPro({ transpose: -99, formant: -99, glide: -5 });
  assert.equal(neg.transpose, -12); assert.equal(neg.formant, -6); assert.equal(neg.glide, 0);
});

test('buildTuneStep mappe transpose→extra, garde formant et humanize', () => {
  const s = buildTuneStep({ glide: 20, keep: 0.1, strength: 1, humanize: 0.5, formant: 2, transpose: 7 });
  assert.equal(s.t, 'tune');
  assert.equal(s.mode, 'notes');
  assert.equal(s.extra, 7, 'transpose devient extra (décalage constant)');
  assert.equal(s.formant, 2);
  assert.equal(s.humanize, 0.5);
  assert.equal(s.glide, 20);
  // Robot : valeurs dures
  const r = buildTuneStep(PRO_PRESETS.robot);
  assert.equal(r.glide, 0); assert.equal(r.keep, 0); assert.equal(r.humanize, 0);
});

test('types de voix = décalages de formant', () => {
  assert.equal(formantForVoice('naturel'), 0);
  assert.equal(formantForVoice('grave'), -3);
  assert.equal(formantForVoice('feminine'), 4);
  assert.equal(formantForVoice('inconnu'), 0, 'type inconnu → naturel');
  for (const k of VOICE_TYPE_ORDER) assert.ok(VOICE_TYPES[k], `type ${k}`);
});

test('applyPreset renvoie des valeurs bornées du préset', () => {
  const a = applyPreset('adlibs', { glide: 999 });
  assert.equal(a.transpose, 12);
  assert.equal(a.glide, 8, 'le préset remplace les réglages courants');
  assert.deepEqual(applyPreset('inexistant', { glide: 50 }), clampPro({ glide: 50 }), 'préset inconnu → réglages courants bornés');
});

test('proName résume les réglages pour la sauvegarde', () => {
  const n = proName({ glide: 18, keep: 0.12, strength: 1, humanize: 0.15, transpose: 12, formant: 1 });
  assert.match(n, /Autotune Pro/);
  assert.match(n, /vitesse 18 ms/);
  assert.match(n, /transpose \+12/);
  assert.match(n, /formant \+1/);
  assert.ok(!/transpose/.test(proName({ transpose: 0 })), 'pas de transpose affiché si 0');
});

test('DEFAULT_PRO a une voix par défaut', () => {
  assert.equal(DEFAULT_PRO.voice, 'naturel');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNITS, UNIT_ORDER, totalPresets, unitById, presetAt, buildFx, headrushFx, HEADRUSH_NAMES,
} from '../public/js/lib/vocalunits.js';

test('8 appareils présents', () => {
  assert.equal(UNITS.length, 8);
  for (const id of ['headrush', 'voicetone', 'mooer', 'performv', 'audota', 'tascam', 'waves', 'boss']) {
    assert.ok(UNIT_ORDER.includes(id), `manque ${id}`);
  }
});

test('HeadRush : exactement 99 presets d\'origine', () => {
  assert.equal(HEADRUSH_NAMES.length, 99);
  assert.equal(unitById('headrush').presets.length, 99);
  assert.equal(unitById('headrush').presets[0].name, 'Hard Tune');
  assert.equal(unitById('headrush').presets[98].name, 'MeloMinor');
});

test('Tascam : 25 presets de gammes', () => {
  assert.equal(unitById('tascam').presets.length, 25);
  assert.equal(unitById('tascam').presets[0].name, 'Chromatic');
});

test('total presets conséquent (> 170)', () => {
  assert.ok(totalPresets() > 170, `total=${totalPresets()}`);
});

test('headrushFx : Hard = correction forte + speed max', () => {
  const { fx, tune } = headrushFx('Hard Tune');
  assert.ok(fx.tune >= 0.9);
  assert.equal(tune.speed, 1);
  assert.equal(tune.humanize, 0);
});

test('headrushFx : Mild = correction douce + humanize élevé', () => {
  const { fx, tune } = headrushFx('Mild Tune');
  assert.ok(fx.tune <= 0.4);
  assert.ok(tune.humanize >= 0.5);
});

test('headrushFx : Verb3 > Verb1 en réverbe', () => {
  assert.ok(headrushFx('HardVerb3').fx.reverb > headrushFx('HardVerb1').fx.reverb);
});

test('headrushFx : Radio sculpte (coupe graves/aigus, booste médium)', () => {
  const { fx } = headrushFx('HardRadio');
  assert.ok(fx.sub < 0 && fx.air < 0 && fx.mid > 0);
});

test('headrushFx : Octaves ajoute de l\'épaisseur (chorus)', () => {
  assert.ok(headrushFx('Octaves').fx.chorus > 0);
});

test('buildFx borne les valeurs dans les plages des molettes', () => {
  const { fx } = buildFx('boss', 15); // Distortion : sat fort
  for (const k in fx) {
    if (k === 'tune' || k === 'comp' || k === 'sat') assert.ok(fx[k] >= 0 && fx[k] <= 1);
    else if (k === 'chorus') assert.ok(fx[k] <= 0.7);
    else if (k === 'reverb') assert.ok(fx[k] <= 0.7);
    else if (k === 'echo') assert.ok(fx[k] <= 0.6);
    else assert.ok(fx[k] >= -12 && fx[k] <= 12);
  }
});

test('buildFx renvoie un label avec référence + numéro + nom', () => {
  const b = buildFx('headrush', 0);
  assert.match(b.label, /HeadRush/);
  assert.match(b.label, /01 Hard Tune/);
  assert.ok(b.tune && typeof b.tune.speed === 'number');
});

test('presetAt boucle proprement (index négatif / débordant)', () => {
  const u = unitById('voicetone');
  assert.equal(presetAt('voicetone', -1).name, u.presets[u.presets.length - 1].name);
  assert.equal(presetAt('voicetone', u.presets.length).name, u.presets[0].name);
});

test('QUICK_VIBES : 8 vibes avec fx + tune bornés', async () => {
  const { QUICK_VIBES, buildVibe, vibeById } = await import('../public/js/lib/vocalunits.js');
  assert.equal(QUICK_VIBES.length, 8);
  for (const v of QUICK_VIBES) {
    const b = buildVibe(v.id);
    assert.ok(b.fx.tune === undefined || (b.fx.tune >= 0 && b.fx.tune <= 1));
    assert.ok(b.tune && typeof b.tune.speed === 'number');
    assert.match(b.label, new RegExp(v.name));
  }
  assert.equal(vibeById('robot').name, 'Robot');
  assert.equal(vibeById('inconnu').id, QUICK_VIBES[0].id);
  // robot = correction maximale
  assert.equal(buildVibe('robot').fx.tune, 1);
});

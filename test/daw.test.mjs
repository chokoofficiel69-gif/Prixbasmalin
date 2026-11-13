// Tests des helpers de transport/grille (purs, sans navigateur).
// Lancer : node --test test/daw.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampBpm, fmtBarsBeats, countInDuration, beatClickTimes, snapToGrid, punchRegion, crossfadeSamples, colorForTrack, ROLE_COLORS } from '../public/js/lib/daw.js';

test('clampBpm borne et tolère les valeurs absurdes', () => {
  assert.equal(clampBpm(120), 120);
  assert.equal(clampBpm(10), 40);
  assert.equal(clampBpm(999), 300);
  assert.equal(clampBpm('abc'), 90);
  assert.equal(clampBpm(90.7), 91);
});

test('mesures:temps', () => {
  assert.equal(fmtBarsBeats(0, 120), '1:1');
  assert.equal(fmtBarsBeats(1, 120), '1:3');   // 2 temps à 120 BPM
  assert.equal(fmtBarsBeats(2, 120), '2:1');   // 4 temps = mesure 2
  assert.equal(fmtBarsBeats(5, 0), '—', 'BPM inconnu');
});

test('durée du décompte', () => {
  assert.equal(countInDuration(2, 120, 4), 4);  // 2 mesures × 4 temps × 0,5 s
  assert.equal(countInDuration(1, 60, 4), 4);
  assert.equal(countInDuration(0, 120), 0);
  assert.equal(countInDuration(2, 0), 0);
});

test('clics du métronome avec accent sur le 1er temps', () => {
  const clicks = beatClickTimes(2, 120, 4);  // 2 s → 4 temps (0, .5, 1, 1.5)
  assert.equal(clicks.length, 4);
  assert.deepEqual(clicks.map(c => c.t), [0, 0.5, 1, 1.5]);
  assert.equal(clicks[0].accent, true);
  assert.equal(clicks[1].accent, false);
  assert.equal(beatClickTimes(1, 0).length, 0, 'BPM inconnu → aucun clic');
});

test('aimantation sur la grille', () => {
  assert.equal(snapToGrid(0.26, 120, 1), 0.5, 'proche de la noire');
  assert.equal(snapToGrid(0.1, 120, 1), 0, 'vers 0');
  assert.equal(snapToGrid(0.3, 0), 0.3, 'sans BPM : inchangé');
});

test('punch-in/out avec pré-roll', () => {
  const r = punchRegion(10, 14, 2);
  assert.deepEqual(r, { recStart: 8, punchIn: 10, punchOut: 14 });
  assert.equal(punchRegion(1, 3, 2).recStart, 0, 'pré-roll borné à 0');
  const swapped = punchRegion(14, 10, 2);
  assert.equal(swapped.punchIn, 10, 'ordre normalisé');
});

test('fondu de comping', () => {
  assert.equal(crossfadeSamples(44100, 0.01), 441);
  assert.ok(crossfadeSamples(48000, 0) >= 1);
});

test('couleur par rôle puis par type', () => {
  assert.equal(colorForTrack({ role: 'lead' }), ROLE_COLORS.lead);
  assert.equal(colorForTrack({ kind: 'instru' }), ROLE_COLORS.instru);
  assert.equal(colorForTrack({}), ROLE_COLORS.autre);
});

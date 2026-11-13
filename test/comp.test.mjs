// Tests comping/punch (purs, sans navigateur).
// Lancer : node --test test/comp.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planComp, stitchMono, splitLoopTakes, punchInMono } from '../public/js/lib/comp.js';

test('planComp comble les trous avec la prise de base', () => {
  const segs = planComp(100, [{ a: 40, b: 60, take: 1 }], 0);
  assert.deepEqual(segs, [{ take: 0, a: 0, b: 40 }, { take: 1, a: 40, b: 60 }, { take: 0, a: 60, b: 100 }]);
});
test('planComp : sans choix = toute la base', () => {
  assert.deepEqual(planComp(50, [], 2), [{ take: 2, a: 0, b: 50 }]);
});
test('planComp : choix qui se chevauchent tronqués dans l’ordre', () => {
  const segs = planComp(100, [{ a: 10, b: 50, take: 1 }, { a: 30, b: 70, take: 2 }], 0);
  assert.equal(segs[0].take, 0); assert.equal(segs[1].take, 1);
  assert.equal(segs[1].b, 50); assert.equal(segs[2].a, 50); assert.equal(segs[2].take, 2);
});

test('stitchMono choisit la bonne prise loin des coutures, et mélange à la couture', () => {
  const A = new Float32Array(100).fill(1), B = new Float32Array(100).fill(0);
  const segs = [{ take: 0, a: 0, b: 50 }, { take: 1, a: 50, b: 100 }];
  const out = stitchMono([A, B], segs, 100, 10);
  assert.equal(out[10], 1, 'début = prise A');
  assert.equal(out[90], 0, 'fin = prise B');
  // au milieu de la couture (indice 50), puissance constante ≈ 0,707 de A
  assert.ok(Math.abs(out[50] - Math.cos(Math.PI / 4)) < 0.08, `couture ~0.707, obtenu ${out[50].toFixed(3)}`);
});

test('splitLoopTakes découpe par longueur de boucle', () => {
  assert.deepEqual(splitLoopTakes(100, 50), [{ a: 0, b: 50 }, { a: 50, b: 100 }]);
  // dernière tranche trop courte ignorée
  const s = splitLoopTakes(105, 50); assert.equal(s.length, 2);
  assert.deepEqual(splitLoopTakes(30, 0), [{ a: 0, b: 30 }], 'sans boucle = une prise');
});

test('punchInMono remplace la région et garde le reste', () => {
  const base = new Float32Array(100).fill(1), patch = new Float32Array(100).fill(0);
  const out = punchInMono(base, patch, 40, 60, 4);
  assert.equal(out[10], 1, 'avant la région : base');
  assert.equal(out[90], 1, 'après la région : base');
  assert.equal(out[50], 0, 'centre de la région : patch');
  assert.equal(out.length, 100);
});

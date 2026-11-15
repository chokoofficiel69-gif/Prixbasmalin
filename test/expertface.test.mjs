import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faceCaption, normalizeState, FACE_STATES, DEFAULT_ENGINEER } from '../public/js/lib/expertface.js';

test('faceCaption : valeurs par défaut', () => {
  const c = faceCaption();
  assert.equal(c.name, DEFAULT_ENGINEER.name);
  assert.equal(c.role, DEFAULT_ENGINEER.role);
});

test('faceCaption : respecte les valeurs fournies', () => {
  const c = faceCaption('Lina', 'Beatmaker');
  assert.equal(c.name, 'Lina');
  assert.equal(c.role, 'Beatmaker');
});

test('faceCaption : repli si vide', () => {
  const c = faceCaption('', null);
  assert.equal(c.name, DEFAULT_ENGINEER.name);
  assert.equal(c.role, DEFAULT_ENGINEER.role);
});

test('normalizeState : états connus conservés, sinon idle', () => {
  for (const s of FACE_STATES) assert.equal(normalizeState(s), s);
  assert.equal(normalizeState('wat'), 'idle');
  assert.equal(normalizeState(undefined), 'idle');
});

test('FACE_STATES contient idle/thinking/speaking', () => {
  assert.deepEqual([...FACE_STATES].sort(), ['idle', 'speaking', 'thinking']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentContext, validateAgentActions } from '../public/js/lib/agent-intelligence.js';

test('keeps recent conversation and studio state in the model context', () => {
  const context = buildAgentContext([
    { role: 'user', content: 'Mets un peu de réverbe' },
    { role: 'assistant', content: 'Je te propose un dosage léger.' }
  ], { pistes: [{ nom: 'Voix 1' }] });
  assert.match(context, /Mets un peu de réverbe/);
  assert.match(context, /Voix 1/);
});

test('filters unknown actions and refuses implicit track deletion', () => {
  const actions = validateAgentActions([{ a: 'delete', track: 2 }, { a: 'magic' }, { a: 'clean', level: 5 }], 'améliore le son');
  assert.deepEqual(actions, [{ a: 'clean', level: 0.9 }]);
});

test('allows deletion only when the artist explicitly requests it', () => {
  assert.deepEqual(validateAgentActions([{ a: 'delete', track: 2 }], 'supprime la piste 2'), [{ a: 'delete', track: 2 }]);
});

test('clamps volume and recording parameters before execution', () => {
  assert.deepEqual(validateAgentActions([
    { a: 'volume', track: 'instru', delta: 99 },
    { a: 'record', seconds: 9999 }
  ]), [{ a: 'volume', track: 'instru', delta: 12 }, { a: 'record', seconds: 600 }]);
});

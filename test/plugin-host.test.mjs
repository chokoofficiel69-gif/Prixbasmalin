import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPluginHost } from '../public/js/lib/plugin-host.js';

function gain() {
  return { gain: { value: 1, setTargetAtTime(v) { this.value = v; } }, connect() {}, disconnect() {} };
}
function fakeContext() {
  return { currentTime: 0, createGain: gain };
}
function fakePlugin() {
  return {
    input: { connect() {}, disconnect() {} },
    output: { connect() {}, disconnect() {} },
    set(name, value) { this.values ||= {}; this.values[name] = value; },
    destroy() { this.destroyed = true; }
  };
}

test('plugin host loads effect, sets parameter, bypasses and disposes', async () => {
  const ctx = fakeContext(), input = { connect() {} }, output = { connect() {} };
  const host = createPluginHost({ audioContext: ctx, loadPlugin: async () => fakePlugin(), pluginModule: id => ({ id }), getTrackInput: () => input, getTrackOutput: () => output });
  const ref = await host.addEffect('vocal-1', 'dj_eq', { 'Lo gain (dB)': -2 });
  assert.equal(host.instances.length, 1);
  host.setParameter(ref.instanceId, 'Lo gain (dB)', -4);
  host.setBypass(ref.instanceId, true);
  assert.equal(host.instances[0].bypass, true);
  assert.equal(await host.remove(ref.instanceId), true);
  assert.equal(host.instances.length, 0);
  await host.dispose();
});

test('plugin host rejects invalid plugin shapes and unknown tracks', async () => {
  const ctx = fakeContext();
  const host = createPluginHost({ audioContext: ctx, loadPlugin: async () => ({}), pluginModule: id => id, getTrackInput: () => null, getTrackOutput: () => null });
  await assert.rejects(() => host.addEffect('missing', 'dj_eq'), /Piste inconnue/);
});

test('plugin host exposes instrument MIDI calls', async () => {
  const calls = [], inst = { output: { connect() {}, disconnect() {} }, noteOn(...a) { calls.push(['on', ...a]); }, noteOff(...a) { calls.push(['off', ...a]); }, destroy() {} };
  const host = createPluginHost({ audioContext: fakeContext(), loadPlugin: async () => inst, pluginModule: id => id, getTrackOutput: () => ({ connect() {} }) });
  const ref = await host.addInstrument('midi-1', 'fm_synth');
  host.noteOn(ref.instanceId, 60, 110);
  host.noteOff(ref.instanceId, 60);
  assert.deepEqual(calls, [['on', 60, 110], ['off', 60]]);
  await host.dispose();
});

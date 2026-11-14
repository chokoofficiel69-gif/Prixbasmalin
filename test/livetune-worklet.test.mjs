import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function makeProcessor() {
  const source = await readFile(new URL('../public/js/lib/livetune-worklet.js', import.meta.url), 'utf8');
  let Processor;
  const context = {
    sampleRate: 48000,
    currentFrame: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null }; } },
    registerProcessor(name, ctor) { assert.equal(name, 'live-tune'); Processor = ctor; },
    Float32Array, Math, Number, Infinity,
  };
  vm.runInNewContext(source, context);
  return { instance: new Processor(), context };
}

test('live worklet produit une sortie finie avec une entrée mono et stéréo', async () => {
  const { instance, context } = await makeProcessor();
  for (let block = 0; block < 24; block++) {
    context.currentFrame = block * 128;
    const left = new Float32Array(128), right = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      const t = (block * 128 + i) / 48000;
      left[i] = Math.sin(2 * Math.PI * 220 * t) * 0.2;
      right[i] = Math.sin(2 * Math.PI * 220 * t) * 0.2;
    }
    const output = [new Float32Array(128), new Float32Array(128)];
    assert.equal(instance.process([[left, right]], [output]), true);
    for (const channel of output) for (const sample of channel) assert.ok(Number.isFinite(sample));
  }
});

test('live worklet borne les réglages reçus et tolère le silence', async () => {
  const { instance, context } = await makeProcessor();
  instance.port.onmessage({ data: { strength: 9, speed: -3, scale: [true, false] } });
  assert.equal(instance.strength, 1);
  assert.equal(instance.speed, 0.001);
  assert.equal(instance.scale, null);
  const silence = new Float32Array(128);
  const output = [new Float32Array(128)];
  context.currentFrame = 0;
  assert.equal(instance.process([[silence]], [output]), true);
  assert.ok(output[0].every(Number.isFinite));
});

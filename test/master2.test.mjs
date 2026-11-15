import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dbToLin, linToDb, envCoef, envelope, transientShape, transientShapeChannels,
  MULTIBAND_PRESETS, multibandSettings, crestFactorDb, CROSSOVERS,
} from '../public/js/lib/master2.js';

// Signal : un "coup" net (attaque courte) suivi d'une queue qui décroît.
function hit(sr = 44100, dur = 0.4) {
  const n = Math.floor(sr * dur);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 12); // décroissance
    x[i] = Math.sin(2 * Math.PI * 220 * t) * env;
  }
  return x;
}

test('dbToLin / linToDb sont réciproques', () => {
  assert.ok(Math.abs(dbToLin(0) - 1) < 1e-9);
  assert.ok(Math.abs(linToDb(1) - 0) < 1e-9);
  assert.ok(Math.abs(linToDb(dbToLin(-6)) + 6) < 1e-6);
});

test('envCoef : 0 ms -> 0, plus long -> plus proche de 1', () => {
  assert.equal(envCoef(0), 0);
  assert.ok(envCoef(50) > envCoef(5));
  assert.ok(envCoef(50) < 1);
});

test('envelope suit l\'amplitude et reste positive', () => {
  const x = hit();
  const e = envelope(x, { attackMs: 1, releaseMs: 50 });
  assert.equal(e.length, x.length);
  assert.ok(e.every((v) => v >= 0));
  // le pic d'enveloppe arrive tôt (dans le premier quart)
  let argmax = 0; for (let i = 1; i < e.length; i++) if (e[i] > e[argmax]) argmax = i;
  assert.ok(argmax < e.length / 4);
});

test('transientShape neutre (0,0) renvoie une copie identique', () => {
  const x = hit();
  const y = transientShape(x, { attack: 0, sustain: 0 });
  assert.notEqual(y, x);
  for (let i = 0; i < x.length; i++) assert.equal(y[i], x[i]);
});

test('attack > 0 augmente le punch (crest factor monte)', () => {
  const x = hit();
  const before = crestFactorDb(x);
  const y = transientShape(x, { attack: 0.6, sustain: 0 });
  const after = crestFactorDb(y);
  assert.ok(after > before, `crest ${after} devrait dépasser ${before}`);
});

test('sustain < 0 assèche la queue (énergie de fin réduite)', () => {
  const x = hit();
  const tailStart = Math.floor(x.length * 0.6);
  const tailEnergy = (a) => { let s = 0; for (let i = tailStart; i < a.length; i++) s += a[i] * a[i]; return s; };
  const y = transientShape(x, { attack: 0, sustain: -0.7 });
  assert.ok(tailEnergy(y) < tailEnergy(x), 'la queue doit perdre de l\'énergie');
});

test('transientShape borne le gain (±maxDb)', () => {
  const x = hit();
  const y = transientShape(x, { attack: 1, sustain: 0, maxDb: 6 });
  const lim = dbToLin(6) + 1e-6;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) > 1e-9) assert.ok(Math.abs(y[i]) <= Math.abs(x[i]) * lim + 1e-9);
  }
});

test('transientShapeChannels traite chaque canal', () => {
  const x = hit();
  const [l, r] = transientShapeChannels([x, x], { attack: 0.5 });
  assert.equal(l.length, x.length);
  for (let i = 0; i < x.length; i++) assert.equal(l[i], r[i]);
});

test('multibandSettings : presets connus + repli streaming', () => {
  for (const k of ['streaming', 'rap', 'club', 'doux']) {
    const s = multibandSettings(k);
    for (const b of ['low', 'mid', 'high']) {
      assert.ok(s[b].ratio >= 1, `${k}.${b} ratio >= 1`);
      assert.ok(s[b].threshold <= 0, `${k}.${b} threshold <= 0 dB`);
      assert.ok(s[b].attack > 0 && s[b].release > 0);
    }
    assert.ok('attack' in s.transient && 'sustain' in s.transient);
  }
  assert.equal(multibandSettings('inconnu'), MULTIBAND_PRESETS.streaming);
});

test('CROSSOVERS cohérents (grave < aigu, audibles)', () => {
  assert.ok(CROSSOVERS.lowMid > 20 && CROSSOVERS.lowMid < CROSSOVERS.midHigh);
  assert.ok(CROSSOVERS.midHigh < 20000);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpertPass, expertAgentSummary } from '../public/js/lib/expert-agent.js';

test('agent keeps a pass when measurements show no major regression', () => {
  const r = evaluateExpertPass(
    { peakDb: -6, rmsDb: -18, clipPct: 0, sibilanceRatio: 0.12 },
    { peakDb: -3, rmsDb: -14, clipPct: 0, sibilanceRatio: 0.13 }
  );
  assert.equal(r.verdict, 'keep');
  assert.equal(r.checks[0].code, 'measured_ok');
});

test('agent rejects processing that introduces clipping', () => {
  const r = evaluateExpertPass(
    { peakDb: -5, rmsDb: -18, clipPct: 0, sibilanceRatio: 0.1 },
    { peakDb: 0, rmsDb: -8, clipPct: 0.2, sibilanceRatio: 0.12 }
  );
  assert.equal(r.verdict, 'rollback');
  assert.ok(r.checks.some(x => x.code === 'new_clipping'));
});

test('agent warns when sibilance energy or average level jumps', () => {
  const r = evaluateExpertPass(
    { peakDb: -6, rmsDb: -20, clipPct: 0, sibilanceRatio: 0.1 },
    { peakDb: -2, rmsDb: -10, clipPct: 0, sibilanceRatio: 0.21 }
  );
  assert.equal(r.verdict, 'review');
  assert.ok(r.checks.some(x => x.code === 'sibilance_increase'));
  assert.ok(r.checks.some(x => x.code === 'level_jump'));
});

test('summary is explicit about objective quality control and listening', () => {
  const summary = expertAgentSummary({ verdict: 'keep', checks: [{ level: 'ok', message: 'A/B à écouter.' }] });
  assert.match(summary, /Contrôle qualité/);
  assert.match(summary, /A\/B à écouter/);
});

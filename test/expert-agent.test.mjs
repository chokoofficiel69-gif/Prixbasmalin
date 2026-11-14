import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpertPass, expertAgentSummary } from '../public/js/lib/expert-agent.js';

test('keeps a pass when measurements show no major regression', () => {
  const r = evaluateExpertPass(
    { peakDb: -6, rmsDb: -18, clipPct: 0, sibilanceRatio: 0.12 },
    { peakDb: -3, rmsDb: -14, clipPct: 0, sibilanceRatio: 0.13 }
  );
  assert.equal(r.verdict, 'keep');
});
test('rolls back processing that introduces clipping', () => {
  const r = evaluateExpertPass(
    { peakDb: -5, rmsDb: -18, clipPct: 0, sibilanceRatio: 0.1 },
    { peakDb: 0, rmsDb: -8, clipPct: 0.2, sibilanceRatio: 0.12 }
  );
  assert.equal(r.verdict, 'rollback');
  assert.ok(r.checks.some(x => x.code === 'new_clipping'));
});
test('warns when sibilance or average level jumps', () => {
  const r = evaluateExpertPass(
    { peakDb: -6, rmsDb: -20, clipPct: 0, sibilanceRatio: 0.1 },
    { peakDb: -2, rmsDb: -10, clipPct: 0, sibilanceRatio: 0.21 }
  );
  assert.equal(r.verdict, 'review');
  assert.ok(r.checks.some(x => x.code === 'sibilance_increase'));
  assert.ok(r.checks.some(x => x.code === 'level_jump'));
});
test('summary reminds that A/B listening remains necessary', () => {
  const summary = expertAgentSummary({ verdict: 'keep', checks: [{ level: 'ok', message: 'A/B à écouter.' }] });
  assert.match(summary, /Contrôle qualité/);
  assert.match(summary, /A\/B à écouter/);
});


test('diagnostic vocal : priorise les défauts mesurés et reste prudent', async () => {
  const { diagnoseVoice } = await import('../public/js/lib/expert-agent.js');
  const r = diagnoseVoice({
    clipPct: 0.2, peakDb: -0.4, crestDb: 4,
    sibilanceRatio: 0.3, lowRatio: 0.7,
    confidence: 0.9
  });
  assert.equal(r.findings[0].code, 'clipping');
  assert.ok(r.findings.some(x => x.code === 'sibilance'));
  assert.equal(r.confidenceLabel, 'bonne');
  assert.match(r.disclaimer, /écoute/i);
});

test('diagnostic vocal : ne transforme pas une mesure absente en défaut', async () => {
  const { diagnoseVoice } = await import('../public/js/lib/expert-agent.js');
  const r = diagnoseVoice({});
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].code, 'listen_ab');
  assert.equal(r.confidenceLabel, 'faible');
});

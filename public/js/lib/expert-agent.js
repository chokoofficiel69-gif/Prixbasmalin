// Agent Ingé Son — contrôle qualité mesuré après traitement.
// Ne remplace pas l'écoute : protège contre les régressions objectives et expose les limites.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function evaluateExpertPass(before = {}, after = {}) {
  const checks = [];
  const clipBefore = Number.isFinite(before.clipPct) ? before.clipPct : null;
  const clipAfter = Number.isFinite(after.clipPct) ? after.clipPct : null;
  const peakAfter = Number.isFinite(after.peakDb) ? after.peakDb : null;
  const rmsBefore = Number.isFinite(before.rmsDb) ? before.rmsDb : null;
  const rmsAfter = Number.isFinite(after.rmsDb) ? after.rmsDb : null;
  const sibBefore = Number.isFinite(before.sibilanceRatio) ? before.sibilanceRatio : null;
  const sibAfter = Number.isFinite(after.sibilanceRatio) ? after.sibilanceRatio : null;

  let rollback = false;
  if (clipAfter !== null && clipAfter > 0.01 && (clipBefore === null || clipAfter > clipBefore + 0.005)) {
    rollback = true;
    checks.push({ level: 'error', code: 'new_clipping', message: 'Le traitement a créé ou augmenté l’écrêtage : retour à la prise brute recommandé.' });
  }
  if (peakAfter !== null && peakAfter > -0.1 && (clipBefore === null || clipBefore <= 0.01)) {
    rollback = true;
    checks.push({ level: 'error', code: 'peak_headroom', message: 'La sortie dépasse −0,1 dBFS : marge de sécurité insuffisante.' });
  }
  if (rmsBefore !== null && rmsAfter !== null && rmsAfter - rmsBefore > 8) {
    checks.push({ level: 'warning', code: 'level_jump', message: 'Le niveau moyen a fortement augmenté : vérifie la compression et le gain.' });
  }
  if (sibBefore !== null && sibAfter !== null && sibAfter - sibBefore > 0.08) {
    checks.push({ level: 'warning', code: 'sibilance_increase', message: 'L’énergie 5–10 kHz a augmenté : contrôle les sifflantes à l’écoute.' });
  }
  if (!checks.length) checks.push({ level: 'ok', code: 'measured_ok', message: 'Aucune régression majeure détectée par les mesures. L’écoute A/B reste indispensable.' });

  return {
    verdict: rollback ? 'rollback' : checks.some(x => x.level === 'warning') ? 'review' : 'keep',
    checks,
    metrics: {
      peakDeltaDb: peakAfter !== null && Number.isFinite(before.peakDb) ? Math.round((peakAfter - before.peakDb) * 10) / 10 : null,
      rmsDeltaDb: rmsBefore !== null && rmsAfter !== null ? Math.round((rmsAfter - rmsBefore) * 10) / 10 : null,
      sibilanceDelta: sibBefore !== null && sibAfter !== null ? Math.round((sibAfter - sibBefore) * 1000) / 1000 : null,
    },
  };
}

export function expertAgentSummary(result) {
  const title = result?.verdict === 'rollback' ? 'Contrôle qualité : traitement à annuler'
    : result?.verdict === 'review' ? 'Contrôle qualité : écoute ciblée nécessaire'
    : 'Contrôle qualité : mesures sans alerte majeure';
  return [title, ...(result?.checks || []).map(x => (x.level === 'error' ? '⛔ ' : x.level === 'warning' ? '⚠️ ' : '✓ ') + x.message)].join('\\n');
}

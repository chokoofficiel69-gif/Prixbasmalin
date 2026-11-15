// Contrôle qualité mesuré de l'agent Ingé Son. Ne remplace jamais l'écoute A/B.
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
    checks.push({ level: 'error', code: 'new_clipping', message: 'Le traitement a créé ou augmenté l’écrêtage : retour à la prise brute.' });
  }
  if (peakAfter !== null && peakAfter > -0.1 && (clipBefore === null || clipBefore <= 0.01)) {
    rollback = true;
    checks.push({ level: 'error', code: 'peak_headroom', message: 'La sortie dépasse −0,1 dBFS : marge de sécurité insuffisante.' });
  }
  if (rmsBefore !== null && rmsAfter !== null && rmsAfter - rmsBefore > 8)
    checks.push({ level: 'warning', code: 'level_jump', message: 'Le niveau moyen a fortement augmenté : vérifie la compression et le gain.' });
  if (sibBefore !== null && sibAfter !== null && sibAfter - sibBefore > 0.08)
    checks.push({ level: 'warning', code: 'sibilance_increase', message: 'L’énergie 5–10 kHz a augmenté : contrôle les sifflantes à l’écoute.' });
  if (!checks.length) checks.push({ level: 'ok', code: 'measured_ok', message: 'Aucune régression majeure détectée par les mesures. L’écoute A/B reste indispensable.' });
  return {
    verdict: rollback ? 'rollback' : checks.some(x => x.level === 'warning') ? 'review' : 'keep',
    checks,
    metrics: {
      peakDeltaDb: Number.isFinite(before.peakDb) && peakAfter !== null ? Math.round((peakAfter-before.peakDb)*10)/10 : null,
      rmsDeltaDb: rmsBefore !== null && rmsAfter !== null ? Math.round((rmsAfter-rmsBefore)*10)/10 : null,
      sibilanceDelta: sibBefore !== null && sibAfter !== null ? Math.round((sibAfter-sibBefore)*1000)/1000 : null
    }
  };
}
export function expertAgentSummary(result) {
  const title = result?.verdict === 'rollback' ? 'Contrôle qualité : traitement annulé'
    : result?.verdict === 'review' ? 'Contrôle qualité : écoute ciblée nécessaire'
    : 'Contrôle qualité : mesures sans alerte majeure';
  return [title, ...(result?.checks || []).map(x => (x.level === 'error' ? '⛔ ' : x.level === 'warning' ? '⚠️ ' : '✓ ') + x.message)].join('\n');
}


/**
 * Diagnostic priorisé à partir de mesures locales.
 * Les seuils produisent des pistes à vérifier, jamais des corrections automatiques.
 */
export function diagnoseVoice(measures = {}) {
  const findings = [];
  const add = (priority, code, title, evidence, action) =>
    findings.push({ priority, code, title, evidence, action });

  if (Number.isFinite(measures.clipPct) && measures.clipPct > 0.01)
    add(1, 'clipping', 'Écrêtage détecté', `${measures.clipPct} % des échantillons dépassent le seuil de sécurité`, 'Reprendre le gain à la source ou réduire le niveau avant tout traitement.');
  if (Number.isFinite(measures.peakDb) && measures.peakDb > -1)
    add(1, 'headroom', 'Marge de crête insuffisante', `Crête mesurée à ${measures.peakDb} dBFS`, 'Baisser le gain d’entrée ; ne pas compenser avec un limiteur pendant la prise.');
  if (Number.isFinite(measures.crestDb) && measures.crestDb < 6)
    add(2, 'low_dynamics', 'Dynamique déjà très resserrée', `Facteur de crête : ${measures.crestDb} dB`, 'Éviter d’ajouter de la compression sans écoute comparative.');
  if (Number.isFinite(measures.crestDb) && measures.crestDb > 18)
    add(2, 'wide_dynamics', 'Écarts de niveau importants', `Facteur de crête : ${measures.crestDb} dB`, 'Vérifier les passages faibles et forts ; envisager une automation avant une compression forte.');
  if (Number.isFinite(measures.sibilanceRatio) && measures.sibilanceRatio > 0.22)
    add(2, 'sibilance', 'Énergie aiguë élevée', `Énergie 5–10 kHz : ${Math.round(measures.sibilanceRatio * 100)} %`, 'Écouter les consonnes sifflantes puis doser le de-esser ; cette mesure ne détecte pas les phonèmes.');
  if (Number.isFinite(measures.lowRatio) && measures.lowRatio > 0.65)
    add(2, 'low_energy', 'Énergie grave importante', `Part grave mesurée : ${Math.round(measures.lowRatio * 100)} %`, 'Contrôler plosives, proximité micro et bas-médium avant de choisir le filtre passe-haut.');
  if (Number.isFinite(measures.noiseFloorEstimateDbfs) && Number.isFinite(measures.rmsDbfs)
      && measures.rmsDbfs - measures.noiseFloorEstimateDbfs < 8)
    add(2, 'noise_margin', 'Marge voix / bruit potentiellement faible', `Écart RMS estimé : ${Math.round((measures.rmsDbfs - measures.noiseFloorEstimateDbfs) * 10) / 10} dB`, 'Faire une mesure dans un passage sans voix : le percentile RMS seul ne sépare pas le bruit de la respiration.');
  if (!findings.length)
    add(3, 'listen_ab', 'Aucune alerte majeure dans les indicateurs', 'Les seuils de contrôle ne signalent pas de défaut évident.', 'Écouter la prise au casque et comparer avec la version traitée avant validation.');

  const confidence = Number.isFinite(measures.confidence)
    ? Math.max(0, Math.min(1, measures.confidence))
    : 0.35;
  return {
    findings: findings.sort((a, b) => a.priority - b.priority),
    confidence,
    confidenceLabel: confidence >= 0.8 ? 'bonne' : confidence >= 0.45 ? 'partielle' : 'faible',
    disclaimer: 'Diagnostic indicatif fondé sur des mesures du signal ; l’écoute reste indispensable.'
  };
}

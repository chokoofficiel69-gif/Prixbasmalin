// Suivi de consommation + garde-fous budgétaires.
// Chaque appel est journalisé dans usage/AAAA-MM.jsonl ; les agrégats sont recalculés au démarrage.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getSettings } from './store.js';

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const month = (d = new Date()) => d.toISOString().slice(0, 7);

const state = {
  days: {},        // 'AAAA-MM-JJ' -> { tokens, prompt, completion, requests, errors, media }
  months: {},      // 'AAAA-MM' -> idem
  models: {},      // `${mois}|${modèle}` -> { model, platform, tokens, requests, errors, ms }
  platforms: {},   // `${mois}|${plateforme}` -> { platform, tokens, requests, errors, lastError, lastOk }
  recent: [],      // 100 derniers appels
  errors: [],      // 50 dernières erreurs
  alerts: [],      // alertes (fournisseur payant détecté, plafond atteint…)
};

function bucket(map, key, init) {
  if (!map[key]) map[key] = { tokens: 0, prompt: 0, completion: 0, requests: 0, errors: 0, media: 0, ms: 0, ...init };
  return map[key];
}

function apply(e) {
  const d = e.t.slice(0, 10);
  const m = e.t.slice(0, 7);
  const tok = e.tokens || 0;
  for (const b of [bucket(state.days, d), bucket(state.months, m)]) {
    b.requests++;
    b.tokens += tok;
    b.prompt += e.pt || 0;
    b.completion += e.ct || 0;
    if (!e.ok) b.errors++;
    if (e.kind && e.kind !== 'chat') b.media++;
  }
  const model = e.model || 'inconnu';
  const platform = e.platform || 'inconnu';
  const mb = bucket(state.models, `${m}|${model}|${platform}`, { model, platform, kind: e.kind });
  mb.requests++; mb.tokens += tok; mb.ms += e.ms || 0; if (!e.ok) mb.errors++;
  const pb = bucket(state.platforms, `${m}|${platform}`, { platform });
  pb.requests++; pb.tokens += tok; if (!e.ok) { pb.errors++; pb.lastError = e.t; } else pb.lastOk = e.t;
}

export function loadUsage() {
  const dir = path.join(DATA_DIR, 'usage');
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  for (const m of [month(prev), month(now)]) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, `${m}.jsonl`), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        apply(e);
        state.recent.push(e);
        if (!e.ok) state.errors.push(e);
      } catch {}
    }
  }
  state.recent = state.recent.slice(-100);
  state.errors = state.errors.slice(-50);
  state.alerts = readAlerts();
}

function readAlerts() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'usage', 'alerts.json'), 'utf8')); } catch { return []; }
}
function addAlert(level, message) {
  const last = state.alerts[state.alerts.length - 1];
  if (last && last.message === message && Date.now() - Date.parse(last.t) < 3600_000) return;
  state.alerts.push({ t: new Date().toISOString(), level, message });
  state.alerts = state.alerts.slice(-30);
  try { fs.writeFileSync(path.join(DATA_DIR, 'usage', 'alerts.json'), JSON.stringify(state.alerts)); } catch {}
}

/** Coût estimé en euros (0 tant qu'aucun prix n'est configuré : tout est gratuit). */
export function costOf(platform, tokens) {
  const price = Number(getSettings().prices?.[platform] || 0);
  return price > 0 ? (tokens / 1e6) * price : 0;
}

export function record(e) {
  const entry = {
    t: new Date().toISOString(),
    kind: e.kind || 'chat',
    model: e.model || '',
    platform: e.platform || '',
    pt: e.pt || 0,
    ct: e.ct || 0,
    tokens: e.tokens ?? ((e.pt || 0) + (e.ct || 0)),
    est: !!e.estimated,
    ms: e.ms || 0,
    ok: e.ok !== false,
    err: e.err ? String(e.err).slice(0, 300) : undefined,
    src: e.src || undefined,
  };
  entry.eur = costOf(entry.platform, entry.tokens);
  apply(entry);
  state.recent.push(entry); state.recent = state.recent.slice(-100);
  if (!entry.ok) { state.errors.push(entry); state.errors = state.errors.slice(-50); }
  try {
    fs.appendFileSync(path.join(DATA_DIR, 'usage', `${entry.t.slice(0, 7)}.jsonl`), JSON.stringify(entry) + '\n');
  } catch {}

  const s = getSettings();
  const plat = (entry.platform || '').toLowerCase();
  if (plat && s.paidPlatforms.includes(plat)) {
    addAlert('danger', `Le fournisseur « ${plat} » (marqué potentiellement payant) a servi une requête. Vérifiez sa clé dans FreeLLMAPI.`);
  }
  const today = state.days[day()];
  if (s.dailyTokenCap && today && today.tokens >= s.dailyTokenCap * 0.8) {
    addAlert('warning', `80 % du plafond journalier de tokens atteint (${today.tokens.toLocaleString('fr-FR')} / ${s.dailyTokenCap.toLocaleString('fr-FR')}).`);
  }
  return entry;
}

/** Vérifie les plafonds AVANT un appel. Renvoie un message d'erreur en français, ou null. */
export function guard({ kind = 'chat', model = '', platform = '' } = {}) {
  const s = getSettings();
  const today = state.days[day()] || { tokens: 0, media: 0 };
  const mon = state.months[month()] || { tokens: 0 };
  const plat = (platform || '').toLowerCase();
  if (plat && s.paidPlatforms.includes(plat) && (s.freeOnly || !s.allowPaid)) {
    return `Le modèle « ${model} » passe par « ${plat} », marqué comme potentiellement payant. Il est bloqué tant que le mode gratuit est actif (Suivi des tokens → Réglages).`;
  }
  if (kind === 'chat' || kind === 'agents') {
    if (s.dailyTokenCap && today.tokens >= s.dailyTokenCap) {
      return `Plafond journalier atteint (${today.tokens.toLocaleString('fr-FR')} tokens). Augmentez-le dans Suivi des tokens ou attendez demain.`;
    }
    if (s.monthlyTokenCap && mon.tokens >= s.monthlyTokenCap) {
      return `Plafond mensuel atteint (${mon.tokens.toLocaleString('fr-FR')} tokens).`;
    }
  } else if (s.dailyMediaCap && today.media >= s.dailyMediaCap) {
    return `Plafond journalier de générations média atteint (${today.media}). Modifiable dans Suivi des tokens.`;
  }
  return null;
}

export function summary() {
  const m = month();
  const d = day();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const k = day(new Date(Date.now() - i * 86400_000));
    const b = state.days[k] || {};
    days.push({ day: k, tokens: b.tokens || 0, requests: b.requests || 0, errors: b.errors || 0, media: b.media || 0 });
  }
  const pick = (map) => Object.entries(map).filter(([k]) => k.startsWith(m + '|')).map(([, v]) => ({ ...v, eur: costOf(v.platform, v.tokens) }));
  const monthEur = pick(state.platforms).reduce((s, p) => s + p.eur, 0);
  return {
    today: { ...(state.days[d] || { tokens: 0, requests: 0, errors: 0, media: 0 }), day: d },
    month: { ...(state.months[m] || { tokens: 0, requests: 0, errors: 0, media: 0 }), month: m, eur: monthEur },
    days,
    models: pick(state.models).sort((a, b) => b.tokens - a.tokens || b.requests - a.requests),
    platforms: pick(state.platforms).sort((a, b) => b.tokens - a.tokens || b.requests - a.requests),
    recent: state.recent.slice(-30).reverse(),
    errors: state.errors.slice(-20).reverse(),
    alerts: state.alerts.slice(-10).reverse(),
  };
}

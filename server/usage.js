// Suivi de consommation + garde-fous budgétaires (global et par compte).
// Chaque appel est journalisé dans usage/AAAA-MM.jsonl ; les agrégats sont recalculés au démarrage.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getSettings, getUser, DEFAULT_USER_LIMITS } from './store.js';

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const month = (d = new Date()) => d.toISOString().slice(0, 7);

const scopes = {}; // 'all' et un par utilisateur
let alerts = [];
function scope(key) {
  return (scopes[key] ||= { days: {}, months: {}, models: {}, platforms: {}, recent: [], errors: [] });
}
function bucket(map, key, init) {
  if (!map[key]) map[key] = { tokens: 0, prompt: 0, completion: 0, requests: 0, errors: 0, media: 0, ms: 0, ...init };
  return map[key];
}

function applyTo(S, e) {
  const d = e.t.slice(0, 10), m = e.t.slice(0, 7), tok = e.tokens || 0;
  for (const b of [bucket(S.days, d), bucket(S.months, m)]) {
    b.requests++; b.tokens += tok; b.prompt += e.pt || 0; b.completion += e.ct || 0;
    if (!e.ok) b.errors++;
    if (e.ok && e.kind && e.kind !== 'chat') b.media++;
  }
  const model = e.model || 'inconnu', platform = e.platform || 'inconnu';
  const mb = bucket(S.models, `${m}|${model}|${platform}`, { model, platform, kind: e.kind });
  mb.requests++; mb.tokens += tok; mb.ms += e.ms || 0; if (!e.ok) mb.errors++;
  const pb = bucket(S.platforms, `${m}|${platform}`, { platform });
  pb.requests++; pb.tokens += tok; if (!e.ok) { pb.errors++; pb.lastError = e.t; } else pb.lastOk = e.t;
  S.recent.push(e); if (S.recent.length > 120) S.recent.splice(0, S.recent.length - 100);
  if (!e.ok) { S.errors.push(e); if (S.errors.length > 60) S.errors.splice(0, S.errors.length - 50); }
}
function apply(e) {
  applyTo(scope('all'), e);
  if (e.u) applyTo(scope(e.u), e);
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
      try { apply(JSON.parse(line)); } catch {}
    }
  }
  try { alerts = JSON.parse(fs.readFileSync(path.join(dir, 'alerts.json'), 'utf8')); } catch { alerts = []; }
}

function addAlert(level, message) {
  const last = alerts[alerts.length - 1];
  if (last && last.message === message && Date.now() - Date.parse(last.t) < 3600_000) return;
  alerts.push({ t: new Date().toISOString(), level, message });
  alerts = alerts.slice(-30);
  try { fs.writeFileSync(path.join(DATA_DIR, 'usage', 'alerts.json'), JSON.stringify(alerts)); } catch {}
}

export function costOf(platform, tokens) {
  const price = Number(getSettings().prices?.[platform] || 0);
  return price > 0 ? (tokens / 1e6) * price : 0;
}

export function record(e) {
  const entry = {
    t: new Date().toISOString(), u: e.uid || undefined, kind: e.kind || 'chat', model: e.model || '', platform: e.platform || '',
    pt: e.pt || 0, ct: e.ct || 0, tokens: e.tokens ?? ((e.pt || 0) + (e.ct || 0)), est: !!e.estimated,
    ms: e.ms || 0, ok: e.ok !== false, err: e.err ? String(e.err).slice(0, 300) : undefined, src: e.src || undefined,
  };
  entry.eur = costOf(entry.platform, entry.tokens);
  apply(entry);
  try { fs.appendFileSync(path.join(DATA_DIR, 'usage', `${entry.t.slice(0, 7)}.jsonl`), JSON.stringify(entry) + '\n'); } catch {}
  const s = getSettings();
  const plat = (entry.platform || '').toLowerCase();
  if (plat && s.paidPlatforms.includes(plat)) addAlert('danger', `Le fournisseur « ${plat} » (marqué potentiellement payant) a servi une requête. Vérifiez sa clé dans FreeLLMAPI.`);
  const today = scope('all').days[day()];
  if (s.dailyTokenCap && today && today.tokens >= s.dailyTokenCap * 0.8) {
    addAlert('warning', `80 % du plafond journalier global atteint (${today.tokens.toLocaleString('fr-FR')} / ${s.dailyTokenCap.toLocaleString('fr-FR')} tokens).`);
  }
  return entry;
}

function userLimits(uid) {
  const u = uid && getUser(uid);
  if (!u || u.role === 'admin') return null;
  return {
    dailyTokenCap: u.dailyTokenCap ?? DEFAULT_USER_LIMITS.dailyTokenCap,
    dailyMediaCap: u.dailyMediaCap ?? DEFAULT_USER_LIMITS.dailyMediaCap,
  };
}

/** Vérifie les plafonds AVANT un appel. Renvoie un message d'erreur en français, ou null. */
export function guard({ kind = 'chat', model = '', platform = '', uid } = {}) {
  const s = getSettings();
  const all = scope('all');
  const today = all.days[day()] || { tokens: 0, media: 0 };
  const mon = all.months[month()] || { tokens: 0 };
  const plat = (platform || '').toLowerCase();
  if (plat && s.paidPlatforms.includes(plat) && (s.freeOnly || !s.allowPaid)) {
    return `Le modèle « ${model} » passe par « ${plat} », marqué comme potentiellement payant. Il est bloqué tant que le mode gratuit est actif.`;
  }
  const lim = userLimits(uid);
  const mine = uid ? (scope(uid).days[day()] || { tokens: 0, media: 0 }) : null;
  if (kind === 'chat' || kind === 'agents') {
    if (s.dailyTokenCap && today.tokens >= s.dailyTokenCap) return `Plafond journalier du Studio atteint (${today.tokens.toLocaleString('fr-FR')} tokens). Réessayez demain.`;
    if (s.monthlyTokenCap && mon.tokens >= s.monthlyTokenCap) return `Plafond mensuel du Studio atteint (${mon.tokens.toLocaleString('fr-FR')} tokens).`;
    if (lim?.dailyTokenCap && mine.tokens >= lim.dailyTokenCap) return `Votre limite du jour est atteinte (${mine.tokens.toLocaleString('fr-FR')} tokens). Elle se remet à zéro demain.`;
  } else {
    if (s.dailyMediaCap && today.media >= s.dailyMediaCap) return `Plafond journalier de générations média du Studio atteint (${today.media}).`;
    if (lim?.dailyMediaCap && mine.media >= lim.dailyMediaCap) return `Votre limite du jour pour les images, vidéos et voix est atteinte (${mine.media}).`;
  }
  return null;
}

/** Résumé : 'all' pour l'administrateur, sinon l'identifiant d'un compte. */
export function summary(key = 'all') {
  const S = scope(key);
  const m = month(), d = day();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const k = day(new Date(Date.now() - i * 86400_000));
    const b = S.days[k] || {};
    days.push({ day: k, tokens: b.tokens || 0, requests: b.requests || 0, errors: b.errors || 0, media: b.media || 0 });
  }
  const pick = (map) => Object.entries(map).filter(([k]) => k.startsWith(m + '|')).map(([, v]) => ({ ...v, eur: costOf(v.platform, v.tokens) }));
  return {
    today: { ...(S.days[d] || { tokens: 0, requests: 0, errors: 0, media: 0 }), day: d },
    month: { ...(S.months[m] || { tokens: 0, requests: 0, errors: 0, media: 0 }), month: m, eur: pick(S.platforms).reduce((s, p) => s + p.eur, 0) },
    days,
    models: pick(S.models).sort((a, b) => b.tokens - a.tokens || b.requests - a.requests),
    platforms: pick(S.platforms).sort((a, b) => b.tokens - a.tokens || b.requests - a.requests),
    recent: S.recent.slice(-30).reverse(),
    errors: S.errors.slice(-20).reverse(),
    alerts: key === 'all' ? alerts.slice(-10).reverse() : [],
  };
}

/** Consommation du jour et du mois par compte (vue administrateur). */
export function perUser() {
  const d = day(), m = month();
  const out = {};
  for (const [k, S] of Object.entries(scopes)) {
    if (k === 'all') continue;
    out[k] = { today: S.days[d]?.tokens || 0, todayMedia: S.days[d]?.media || 0, month: S.months[m]?.tokens || 0, requests: S.months[m]?.requests || 0 };
  }
  return out;
}

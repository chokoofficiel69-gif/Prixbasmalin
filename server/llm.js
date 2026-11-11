// Client FreeLLMAPI (API compatible OpenAI). La clé reste côté serveur.
import { record, guard } from './usage.js';

export const API_BASE = (process.env.FREELLMAPI_URL || 'https://freellmapi.prixbasmalin.prod.page').replace(/\/+$/, '').replace(/\/v1$/, '');
const KEY = () => process.env.FREELLMAPI_KEY || '';

export function isConfigured() { return !!KEY(); }

export class UpstreamError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function headers(extra = {}) {
  return { Authorization: `Bearer ${KEY()}`, ...extra };
}

export async function upstream(pathname, { method = 'GET', body, json, timeoutMs = 60000, signal, headers: extra } = {}) {
  if (!isConfigured()) throw new UpstreamError("FreeLLMAPI n'est pas encore relié : la variable FREELLMAPI_KEY manque sur le serveur.", 503);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  try {
    const res = await fetch(API_BASE + pathname, {
      method,
      headers: headers(json !== undefined ? { 'Content-Type': 'application/json', ...extra } : extra),
      body: json !== undefined ? JSON.stringify(json) : body,
      signal: ctrl.signal,
      duplex: body && typeof body.getReader === 'function' ? 'half' : undefined,
    });
    return res;
  } catch (err) {
    if (ctrl.signal.aborted && !signal?.aborted) throw new UpstreamError(`FreeLLMAPI ne répond pas (délai de ${Math.round(timeoutMs / 1000)} s dépassé).`, 504);
    throw new UpstreamError(`FreeLLMAPI injoignable : ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function errorText(res) {
  let msg = `${res.status}`;
  try {
    const t = await res.text();
    try { const j = JSON.parse(t); msg = j.error?.message || j.message || t; } catch { msg = t || msg; }
  } catch {}
  return frenchError(res.status, String(msg).slice(0, 400));
}

export function frenchError(status, msg) {
  if (status === 401 || status === 403) return `Accès refusé par FreeLLMAPI (clé invalide ?) — ${msg}`;
  if (status === 429) return `Quota gratuit momentanément épuisé ou limite de débit atteinte — réessayez plus tard. (${msg})`;
  if (status === 422 && /vision/i.test(msg)) return "Aucun modèle capable de lire les images n'est activé dans FreeLLMAPI.";
  if (status === 503) return `Service indisponible : ${msg}`;
  return msg;
}

let modelsCache = { t: 0, data: null };
export async function listModels(force = false) {
  if (!force && modelsCache.data && Date.now() - modelsCache.t < 60_000) return modelsCache.data;
  const res = await upstream('/v1/models', { timeoutMs: 20000 });
  if (!res.ok) throw new UpstreamError(await errorText(res), res.status);
  const j = await res.json();
  modelsCache = { t: Date.now(), data: j.data || [] };
  return modelsCache.data;
}
export async function platformOf(model) {
  if (!model || model === 'auto' || model.startsWith('auto:') || model === 'fusion') return '';
  try {
    const m = (await listModels()).find(x => x.id === model);
    return m && m.owned_by && m.owned_by !== 'freellmapi' ? m.owned_by : '';
  } catch { return ''; }
}

const estimate = (text) => Math.ceil((text || '').length / 3.6);
function estimateMessages(messages) {
  let n = 0;
  for (const m of messages || []) {
    if (typeof m.content === 'string') n += estimate(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) n += p.type === 'text' ? estimate(p.text) : 800;
  }
  return n;
}

/**
 * Appel de chat. Avec onDelta, la réponse est streamée (texte et réflexion).
 * Renvoie { content, reasoning, routedVia, platform, model, usage, estimated, ms }.
 */
export async function chat({ model = 'auto', messages, onDelta, onMeta, signal, temperature, maxTokens, src = 'chat', extra = {}, uid }) {
  const platform = await platformOf(model);
  const blocked = guard({ kind: src === 'agents' ? 'agents' : 'chat', model, platform, uid });
  if (blocked) throw new UpstreamError(blocked, 402);
  const t0 = Date.now();
  const stream = !!onDelta;
  const body = { model, messages, stream, ...extra };
  if (stream) body.stream_options = { include_usage: true };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens) body.max_tokens = maxTokens;
  let res;
  try {
    res = await upstream('/v1/chat/completions', { method: 'POST', json: body, timeoutMs: 240000, signal });
  } catch (err) {
    record({ uid, kind: 'chat', model, platform, ok: false, err: err.message, ms: Date.now() - t0, src });
    throw err;
  }
  const routedVia = decodeURIComponent(res.headers.get('x-routed-via') || '');
  const [rPlatform, ...rest] = routedVia.split('/');
  const rModel = rest.join('/') || model;
  if (!res.ok) {
    const msg = await errorText(res);
    record({ uid, kind: 'chat', model, platform: rPlatform || platform, ok: false, err: msg, ms: Date.now() - t0, src });
    throw new UpstreamError(msg, res.status);
  }
  onMeta?.({ routedVia, platform: rPlatform, model: rModel, fallbacks: res.headers.get('x-fallback-attempts') || '0' });

  let content = '', reasoning = '', usage = null;
  if (!stream) {
    const j = await res.json();
    const msg = j.choices?.[0]?.message || {};
    content = msg.content || '';
    reasoning = msg.reasoning_content || msg.reasoning || '';
    usage = j.usage || null;
  } else {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j.error) throw new UpstreamError(j.error.message || 'Erreur du fournisseur', 502);
          if (j.usage) usage = j.usage;
          const d = j.choices?.[0]?.delta || {};
          const r = d.reasoning_content || d.reasoning || '';
          if (r) { reasoning += r; onDelta({ reasoning: r }); }
          if (d.content) { content += d.content; onDelta({ content: d.content }); }
        } catch (e) {
          if (e instanceof UpstreamError) {
            record({ uid, kind: 'chat', model: rModel, platform: rPlatform, ok: false, err: e.message, ms: Date.now() - t0, src });
            throw e;
          }
        }
      }
    }
  }
  const estimated = !usage;
  const pt = usage?.prompt_tokens ?? estimateMessages(messages);
  const ct = usage?.completion_tokens ?? estimate(content + reasoning);
  const ms = Date.now() - t0;
  record({ uid, kind: 'chat', model: rModel, platform: rPlatform, pt, ct, tokens: usage?.total_tokens ?? pt + ct, estimated, ms, src });
  return { content, reasoning, routedVia, platform: rPlatform, model: rModel, usage: { prompt: pt, completion: ct, total: pt + ct }, estimated, ms };
}

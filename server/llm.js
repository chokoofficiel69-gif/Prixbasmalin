// Appels aux modèles de chat : itinéraire vérifié AVANT l'appel, réservation de tokens,
// débit réel (ou estimé et marqué comme tel), règlement unique de chaque réservation.
import { getSettings } from './store.js';
import { record } from './usage.js';
import { QuotaError } from './quota.js';
import {
  GATEWAY_BASE, OVH_BASE, resolveChatRoute, RouteError, ovhSlot, ovhTake, ovhCooldown, platformAllowed, verifyGateway,
} from './providers.js';

export const API_BASE = GATEWAY_BASE;
const KEY = () => process.env.FREELLMAPI_KEY || '';
export function isConfigured() { return !!KEY(); }

export class UpstreamError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

let ledgerRef = null;
export function setLedger(l) { ledgerRef = l; }

/** Appel brut à la passerelle FreeLLMAPI (médias, usage, liste). */
export async function upstream(pathname, { method = 'GET', body, json, timeoutMs = 60000, signal, headers: extra } = {}) {
  if (!isConfigured()) throw new UpstreamError("FreeLLMAPI n'est pas relié : la variable FREELLMAPI_KEY manque sur le serveur.", 503);
  return rawFetch(GATEWAY_BASE + pathname, { method, body, json, timeoutMs, signal, headers: { Authorization: `Bearer ${KEY()}`, ...extra } });
}

async function rawFetch(url, { method = 'GET', body, json, timeoutMs = 60000, signal, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  try {
    return await fetch(url, {
      method,
      headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: json !== undefined ? JSON.stringify(json) : body,
      signal: ctrl.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw Object.assign(new UpstreamError('Requête interrompue.', 499), { aborted: true });
    if (ctrl.signal.aborted) throw new UpstreamError(`Le fournisseur ne répond pas (délai de ${Math.round(timeoutMs / 1000)} s dépassé).`, 504);
    throw new UpstreamError(`Fournisseur injoignable : ${err.message}`, 502);
  } finally { clearTimeout(timer); }
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
  if (status === 401 || status === 403) return `Accès refusé par le fournisseur — ${msg}`;
  if (status === 429) return `Limite du fournisseur atteinte (HTTP 429 : trop de requêtes ou quota gratuit épuisé chez le fournisseur). Réessayez plus tard. Détail : ${msg}`;
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

// --- Estimations (prudentes : 1 token pour 3 caractères, + marge de gabarit) ---
export const estimateText = (text) => Math.ceil((text || '').length / 3);
export function estimatePrompt(messages) {
  let n = 64;
  for (const m of messages || []) {
    n += 6;
    if (typeof m.content === 'string') n += estimateText(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) n += p.type === 'text' ? estimateText(p.text) : 1500;
  }
  return Math.ceil(n * 1.1);
}
const hasImage = (messages) => (messages || []).some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image_url'));

/**
 * Appel de chat. Avec onDelta, la réponse est streamée.
 * Renvoie { content, reasoning, routedVia, platform, model, usage:{prompt,completion,total}, exact, estimated, ms }.
 */
export async function chat({ uid, model = 'auto', messages, onDelta, onMeta, signal, temperature, maxTokens, src = 'chat', extra = {} }) {
  if (!ledgerRef) throw new Error('Registre de quota non initialisé');
  const s = getSettings();
  const t0 = Date.now();

  // 1) Itinéraire décidé avant tout appel (et créneau OVH pris de façon synchrone).
  let route = await resolveChatRoute(model, { vision: hasImage(messages) });
  if (route.provider === 'ovh') {
    if (!ovhSlot(route.model).ok) route = await resolveChatRoute(model, { vision: hasImage(messages) });
  }

  // 2) Réservation (synchrone avec la prise du créneau : aucune autre requête ne peut s'intercaler).
  const promptEst = estimatePrompt(messages);
  const wanted = Math.min(maxTokens || s.maxOutputTokens || 4096, s.maxOutputTokens || 4096);
  const reservation = ledgerRef.reserveChat(uid, promptEst, wanted, Math.min(256, wanted), { provider: route.provider, model: route.model, src });
  if (route.provider === 'ovh') {
    const slot = ovhSlot(route.model);
    if (!slot.ok) {
      ledgerRef.settle(reservation.id, { exact: false, pt: 0, ct: 0, outcome: 'refusé-avant-appel' });
      throw new RouteError(`Capacité gratuite d’OVH momentanément atteinte. Réessayez dans ${slot.retryIn} s.`, 429, slot.retryIn);
    }
    ovhTake(route.model);
  }

  let content = '', reasoning = '', usage = null, routedVia = route.label, platform = route.provider === 'ovh' ? 'ovh' : '';
  let settled = false;
  const settle = (r) => { if (!settled) { settled = true; ledgerRef.settle(reservation.id, { provider: route.provider, platform, model: route.model, ...r }); } };

  try {
    const stream = !!onDelta;
    const body = { model: route.model, messages, stream, max_tokens: reservation.maxTokens, ...extra };
    if (stream) body.stream_options = { include_usage: true };
    if (temperature !== undefined) body.temperature = temperature;
    const res = route.provider === 'ovh'
      ? await rawFetch(`${OVH_BASE}/chat/completions`, { method: 'POST', json: body, timeoutMs: 240000, signal })
      : await upstream('/v1/chat/completions', { method: 'POST', json: body, timeoutMs: 240000, signal });

    if (route.provider === 'freellmapi') {
      routedVia = decodeURIComponent(res.headers.get('x-routed-via') || '') || routedVia;
      platform = routedVia.includes('/') ? routedVia.split('/')[0] : '';
      // Défense supplémentaire : un fournisseur hors liste blanche ne doit jamais servir en mode gratuit.
      if (platform && s.freeOnly && !platformAllowed(platform)) {
        record({ uid, kind: 'chat', model: route.model, platform, ok: false, err: `ALERTE : fournisseur non autorisé « ${platform} » utilisé par la passerelle`, src, alert: true });
        verifyGateway(true).catch(() => {});
      }
    }
    if (!res.ok) {
      const msg = await errorText(res);
      if (res.status === 429 && route.provider === 'ovh') ovhCooldown(route.model, Number(res.headers.get('retry-after')) || 60);
      settle({ exact: false, pt: 0, ct: 0, outcome: `échec-http-${res.status}` });
      record({ uid, kind: 'chat', model: route.model, platform: platform || route.provider, ok: false, err: msg, ms: Date.now() - t0, src, status: res.status });
      throw new UpstreamError(msg, res.status);
    }
    onMeta?.({ routedVia, platform, model: route.model, provider: route.provider });

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
          let j; try { j = JSON.parse(data); } catch { continue; }
          if (j.error) throw new UpstreamError(j.error.message || 'Erreur du fournisseur', 502);
          if (j.usage) usage = j.usage;
          const d = j.choices?.[0]?.delta || {};
          const r = d.reasoning_content || d.reasoning || '';
          if (r) { reasoning += r; onDelta({ reasoning: r }); }
          if (d.content) { content += d.content; onDelta({ content: d.content }); }
        }
      }
    }

    const exact = !!(usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens));
    const pt = exact ? usage.prompt_tokens : promptEst;
    const ct = exact ? usage.completion_tokens : estimateText(content + reasoning);
    const tok = exact && Number.isFinite(usage.total_tokens) ? usage.total_tokens : pt + ct;
    settle({ exact, pt, ct, tok, outcome: 'ok' });
    record({ uid, kind: 'chat', model: route.model, platform: platform || route.provider, pt, ct, tokens: tok, estimated: !exact, ms: Date.now() - t0, src });
    return { content, reasoning, routedVia, platform, model: route.model, provider: route.provider, usage: { prompt: pt, completion: ct, total: tok }, exact, estimated: !exact, ms: Date.now() - t0 };
  } catch (err) {
    if (!settled) {
      if (content || reasoning) {
        // Interruption après un début de réponse : débit estimé du prompt + du texte produit.
        settle({ exact: false, pt: promptEst, ct: estimateText(content + reasoning), outcome: err.aborted ? 'interrompu-client' : 'interrompu-erreur' });
      } else {
        settle({ exact: false, pt: 0, ct: 0, outcome: err.aborted ? 'annulé-avant-réponse' : 'échec-avant-réponse' });
      }
      record({ uid, kind: 'chat', model: route.model, platform: platform || route.provider, ok: false, err: err.message, ms: Date.now() - t0, src });
    }
    throw err;
  }
}

export { QuotaError, RouteError };

// Fournisseurs de modèles et choix de l'itinéraire AVANT tout appel externe.
//
// Principe : en mode gratuit, une requête ne part que vers un fournisseur dont l'identité est
// connue avec certitude AVANT l'appel et qui figure dans la liste blanche (allowedPlatforms).
//  - « ovh » (appel direct, accès anonyme) : identité certaine par construction ; aucune clé, donc
//    aucun compte ni moyen de paiement : aucune facturation possible.
//  - « freellmapi » (passerelle) : le fournisseur réel n'est connu qu'après le routage. Elle n'est
//    utilisable en mode gratuit que pour un modèle épinglé dont la liste COMPLÈTE des fournisseurs
//    possibles (outil MCP « list_models » de FreeLLMAPI) est incluse dans la liste blanche. Sans
//    cette vérification, la passerelle est bloquée. « auto » n'est jamais envoyé à la passerelle
//    en mode gratuit. Après l'appel, l'en-tête X-Routed-Via est contrôlé en défense supplémentaire.
import { getSettings } from './store.js';

export const OVH_BASE = (process.env.OVH_BASE_URL || 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1').replace(/\/+$/, '');
export const GATEWAY_BASE = (process.env.FREELLMAPI_URL || 'https://freellmapi.prixbasmalin.prod.page').replace(/\/+$/, '').replace(/\/v1$/, '');
const gatewayKey = () => process.env.FREELLMAPI_KEY || '';

/** Fiches fournisseurs : uniquement des faits sourcés. */
export const PROVIDER_FACTS = {
  ovh: {
    id: 'ovh', label: 'OVH AI Endpoints (accès anonyme, appel direct)',
    billing: { status: 'aucune', note: 'Accès anonyme : aucune clé, aucun compte, aucun moyen de paiement. Aucune facturation n’est techniquement possible.' },
    limits: [
      { text: '2 requêtes par minute, par adresse IP et par modèle (accès anonyme)', source: 'Documentation OVHcloud « AI Endpoints – Features, Capabilities and Limitations »' },
      { text: 'Au-delà : réponse HTTP 429', source: 'Documentation OVHcloud (guide de dépannage AI Endpoints)' },
      { text: 'Accès avec clé : 400 requêtes par minute, par projet Public Cloud et par modèle — nécessite un projet avec moyen de paiement (payant, NON utilisé)', source: 'Documentation OVHcloud ; commentaire du code FreeLLMAPI (providers/index.ts)' },
      { text: 'Limite observée parfois plus stricte que 2 req/min entre modèles ; OVH se réserve d’ajouter des plafonds de tokens et de retirer des modèles avec préavis', source: 'Commentaire du code FreeLLMAPI (providers/index.ts, sondage du 2026-06-10)' },
    ],
    monthlyQuota: null, // non communiqué par OVH
    commercialUse: 'Non vérifié : les conditions d’utilisation de l’accès anonyme pour un service commercial doivent être confirmées auprès d’OVHcloud.',
  },
  freellmapi: {
    id: 'freellmapi', label: 'FreeLLMAPI (passerelle multi-fournisseurs)',
    billing: { status: 'variable', note: 'Dépend des clés enregistrées dans FreeLLMAPI. Le fournisseur réel n’est connu qu’après le routage.' },
    limits: [{ text: 'Limites propres à chaque fournisseur sous-jacent ; FreeLLMAPI les suit par clé', source: 'Documentation FreeLLMAPI' }],
    monthlyQuota: null,
    commercialUse: 'Dépend des conditions de chaque fournisseur sous-jacent.',
  },
};

// ---------------------------------------------------------------------------
// OVH : liste des modèles + limiteur local (2 requêtes / minute / modèle depuis notre IP)
// ---------------------------------------------------------------------------
let ovhModels = { t: 0, list: null, error: null };
const NON_CHAT = /whisper|embed|bge|tts|stable-diffusion|sdxl|rerank|flux|parakeet/i;
// Modèles exclus du routage chat texte : modération (Guard) et vision (VL, réservés aux messages avec image)
const NOT_TEXT_CHAT = /guard/i;
const isVisionModel = (id) => /VL|vision|llava|pixtral|gemma-3/i.test(id); // capables de lire une image
const VISION_ONLY = /(^|[-_.])VL([-_.]|$)|vision|llava|pixtral/i; // modèles vision exclus du chat texte
export async function listOvhModels(force = false) {
  if (!force && ovhModels.list && Date.now() - ovhModels.t < 10 * 60_000) return ovhModels;
  try {
    const r = await fetch(`${OVH_BASE}/models`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const list = (j.data || []).map(m => m.id).filter(Boolean);
    ovhModels = { t: Date.now(), list, error: null, verifiedAt: new Date().toISOString() };
  } catch (err) {
    ovhModels = { t: Date.now(), list: ovhModels.list, error: `Liste des modèles OVH indisponible : ${err.message}` };
  }
  return ovhModels;
}
/** Modèles OVH utiles pour le chat texte (sans Guard ni VL). */
export const ovhChatModels = (list) => (list || []).filter(id => !NON_CHAT.test(id) && !NOT_TEXT_CHAT.test(id) && !VISION_ONLY.test(id));
/** Modèles OVH capables de lire une image (utilisés seulement pour les messages avec image). */
export const ovhVisionModels = (list) => (list || []).filter(id => !NON_CHAT.test(id) && !NOT_TEXT_CHAT.test(id) && isVisionModel(id));
/** Modèles OVH écartés du chat, avec la raison (affichage). */
export const ovhExcludedModels = (list) => (list || []).filter(id => !NON_CHAT.test(id) && (NOT_TEXT_CHAT.test(id) || VISION_ONLY.test(id)))
  .map(id => ({ id, reason: NOT_TEXT_CHAT.test(id) ? 'modèle de modération (Guard)' : 'modèle vision (VL) : seulement pour les messages avec image' }));

const windows = new Map(); // modèle -> horodatages des 60 dernières secondes
const cooldown = new Map(); // modèle -> fin de pause après un 429
export function ovhSlot(model) {
  const rpm = Math.max(1, Number(getSettings().ovhRpmPerModel) || 2);
  const now = Date.now();
  const w = (windows.get(model) || []).filter(t => now - t < 60_000);
  windows.set(model, w);
  const cd = cooldown.get(model) || 0;
  if (cd > now) return { ok: false, retryIn: Math.ceil((cd - now) / 1000) };
  if (w.length >= rpm) return { ok: false, retryIn: Math.ceil((60_000 - (now - w[0])) / 1000) };
  return { ok: true };
}
/** Requêtes envoyées à ce modèle dans les 60 dernières secondes (depuis notre IP). */
export function ovhLoad(model) { return (windows.get(model) || []).filter(t => Date.now() - t < 60_000).length; }
/**
 * Répartition : parmi les candidats disponibles, prend le moins chargé sur la dernière minute
 * (à charge égale, l'ordre de préférence). Un modèle qui approche 2 req/min n'est donc choisi
 * que si tous les autres sont au moins aussi chargés. Renvoie null si aucun n'est libre.
 */
export function pickOvhModel(candidates) {
  let best = null, bestLoad = Infinity, soonest = 60;
  for (const m of candidates) {
    const slot = ovhSlot(m);
    if (!slot.ok) { soonest = Math.min(soonest, slot.retryIn); continue; }
    const load = ovhLoad(m);
    if (load < bestLoad) { best = m; bestLoad = load; }
  }
  return { model: best, soonest };
}
export function ovhTake(model) { const w = windows.get(model) || []; w.push(Date.now()); windows.set(model, w); }
export function ovhCooldown(model, sec = 60) { cooldown.set(model, Date.now() + sec * 1000); }
export function ovhCapacityNow(models) {
  return (models || []).map(m => ({ model: m, ...ovhSlot(m), usedLastMinute: (windows.get(m) || []).filter(t => Date.now() - t < 60_000).length }));
}

// ---------------------------------------------------------------------------
// Passerelle : vérification des fournisseurs possibles par modèle (outil MCP list_models)
// ---------------------------------------------------------------------------
let gatewayMap = { t: 0, ok: false, models: {}, error: 'non vérifié' };
export async function verifyGateway(force = false) {
  if (!gatewayKey()) return (gatewayMap = { t: Date.now(), ok: false, models: {}, error: 'clé FreeLLMAPI absente' });
  if (!force && Date.now() - gatewayMap.t < 5 * 60_000) return gatewayMap;
  try {
    const r = await fetch(`${GATEWAY_BASE}/mcp`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${gatewayKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_models', arguments: { available_only: true } } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error?.message || `HTTP ${r.status}`);
    const data = j.result?.structuredContent || JSON.parse(j.result?.content?.[0]?.text || '{}');
    const models = {};
    for (const m of data.models || []) models[m.id] = { platforms: m.platforms || [], name: m.name || m.id, vision: false };
    gatewayMap = { t: Date.now(), ok: true, models, error: null, verifiedAt: new Date().toISOString() };
  } catch (err) {
    gatewayMap = { t: Date.now(), ok: false, models: {}, error: /disabled|403/i.test(err.message)
      ? 'Serveur MCP de FreeLLMAPI désactivé : impossible de connaître les fournisseurs avant l’appel'
      : `Vérification impossible : ${err.message}` };
  }
  return gatewayMap;
}
export function gatewayState() { return gatewayMap; }

// ---------------------------------------------------------------------------
// Choix de l'itinéraire
// ---------------------------------------------------------------------------
export class RouteError extends Error {
  constructor(message, status = 503, retryIn) { super(message); this.status = status; this.retryIn = retryIn; }
}
const PREFERRED = {
  auto: ['gpt-oss-120b', 'Meta-Llama-3_3-70B-Instruct', 'Qwen3-32B', 'Mistral-Small-3.2-24B-Instruct-2506', 'gpt-oss-20b'],
  'auto:smart': ['gpt-oss-120b', 'Qwen3-32B', 'Meta-Llama-3_3-70B-Instruct', 'Mistral-Small-3.2-24B-Instruct-2506'],
  'auto:fast': ['gpt-oss-20b', 'Mistral-Small-3.2-24B-Instruct-2506', 'Llama-3.1-8B-Instruct', 'Mistral-Nemo-Instruct-2407', 'gpt-oss-120b'],
};
export function platformAllowed(platform) {
  const s = getSettings();
  const p = String(platform || '').toLowerCase();
  if (!p) return false;
  if (s.paidPlatforms.includes(p) && (s.freeOnly || !s.allowPaid)) return false;
  return s.freeOnly ? s.allowedPlatforms.includes(p) : true;
}

/**
 * Décide où envoyer une requête de chat, sans rien appeler.
 * Renvoie { provider, model, label } ou lève RouteError.
 */
export async function resolveChatRoute(requested = 'auto', { vision = false } = {}) {
  const s = getSettings();
  let req = String(requested || 'auto');
  if (req === 'fusion') throw new RouteError('Le mode « Fusion » est désactivé : sa consommation réelle (plusieurs modèles + un juge) n’est pas mesurable de façon fiable.', 400);
  const isAuto = req === 'auto' || req.startsWith('auto:');
  let wantProvider = null;
  if (req.startsWith('ovh/')) { wantProvider = 'ovh'; req = req.slice(4); }
  else if (req.startsWith('freellmapi/')) { wantProvider = 'freellmapi'; req = req.slice(11); }

  // 1) OVH direct
  if ((wantProvider === null || wantProvider === 'ovh') && platformAllowed('ovh')) {
    const { list } = await listOvhModels();
    const chat = vision ? ovhVisionModels(list || []) : ovhChatModels(list || ['gpt-oss-120b']);
    const excluded = ovhExcludedModels(list || []).find(x => x.id.toLowerCase() === req.toLowerCase());
    let candidates, redirectedFrom = null;
    if (isAuto) {
      const pref = PREFERRED[req] || PREFERRED.auto;
      candidates = [...pref.filter(m => chat.includes(m)), ...chat.filter(m => !pref.includes(m))];
    } else if (excluded && !vision) {
      throw new RouteError(`« ${excluded.id} » est exclu du chat texte (${excluded.reason}). Choisissez un autre modèle ou « Automatique ».`, 400);
    } else {
      candidates = chat.filter(m => m.toLowerCase() === req.toLowerCase());
      // Modèle choisi à la main mais déjà à sa limite : bascule sur le modèle le moins chargé (évite le 429)
      if (candidates.length && !ovhSlot(candidates[0]).ok) {
        redirectedFrom = candidates[0];
        candidates = [candidates[0], ...chat.filter(m => m !== redirectedFrom)];
      }
    }
    if (candidates.length) {
      const { model: m, soonest } = pickOvhModel(candidates);
      if (m) return { provider: 'ovh', model: m, label: `ovh/${m}`, ...(redirectedFrom && m !== redirectedFrom ? { redirectedFrom } : {}) };
      if (wantProvider === 'ovh' || !isAuto || !s.gatewayForAuto) {
        throw new RouteError(`Capacité gratuite d’OVH momentanément atteinte sur tous les modèles (2 requêtes par minute et par modèle, limite fixée par OVH pour l’accès anonyme). Réessayez dans ${soonest} s.`, 429, soonest);
      }
    } else if (wantProvider === 'ovh') {
      throw new RouteError(`Le modèle « ${req} » n’existe pas (ou plus) chez OVH.`, 404);
    }
  }

  // 2) Passerelle FreeLLMAPI
  if (wantProvider === null || wantProvider === 'freellmapi') {
    if (!gatewayKey()) throw new RouteError('Aucun fournisseur gratuit autorisé n’est disponible pour cette demande.', 503);
    if (!s.freeOnly) return { provider: 'freellmapi', model: isAuto ? req : req, label: `freellmapi/${req}`, unverified: true };
    const g = await verifyGateway();
    if (!g.ok) {
      throw new RouteError(vision
        ? `Aucun modèle capable de lire les images n’est disponible chez un fournisseur gratuit vérifié. (${g.error})`
        : `Aucun fournisseur gratuit autorisé et vérifiable n’est disponible pour « ${requested} ». (${g.error})`, 503);
    }
    const ok = (id) => { const m = g.models[id]; return m && m.platforms.length && m.platforms.every(p => platformAllowed(p)); };
    if (isAuto) {
      const ids = Object.keys(g.models).filter(ok).filter(id => !vision || isVisionModel(id));
      if (ids.length) return { provider: 'freellmapi', model: ids[0], label: `freellmapi/${ids[0]}`, platforms: g.models[ids[0]].platforms };
    } else if (ok(req)) {
      return { provider: 'freellmapi', model: req, label: `freellmapi/${req}`, platforms: g.models[req].platforms };
    } else if (g.models[req]) {
      throw new RouteError(`Le modèle « ${req} » peut être servi par ${g.models[req].platforms.join(', ')} : au moins un de ces fournisseurs n’est pas autorisé en mode gratuit. Requête bloquée avant l’appel.`, 403);
    }
  }
  throw new RouteError(`Aucun fournisseur gratuit autorisé n’est disponible pour « ${requested} ». Requête bloquée avant tout appel externe.`, 503);
}

/** Les médias (images, vidéos, voix) passent par la passerelle : fournisseur inconnu avant l'appel. */
export function gatewayMediaAllowed() {
  const s = getSettings();
  return !s.freeOnly || s.gatewayMediaAllowed === true;
}

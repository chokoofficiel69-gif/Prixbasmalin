/**
 * Prix Malin — AI gateway for Cloudflare Workers.
 * Required secrets: AGNES_API_KEY and GROK_API_KEY.
 * Optional vars: AGNES_MODEL, GROK_MODEL.
 * Never expose provider keys to browser code.
 */
const ALLOWED_ORIGINS = new Set([
  "https://prixbasmalin.fr",
  "https://www.prixbasmalin.fr"
]);
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
// Best-effort per-isolate guard. Use Cloudflare Rate Limiting rules for a durable edge-wide limit.
const rateBuckets = new Map();
function isRateLimited(key, now = Date.now()) {
  const windowMs = 60_000;
  const limit = 20;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets) if (now - v.start >= windowMs) rateBuckets.delete(k);
  }
  return bucket.count > limit;
}

function json(data, status, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...cors }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const originAllowed = ALLOWED_ORIGINS.has(origin);
    const cors = {
      ...(originAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      if (!originAllowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "Prix Malin AI gateway",
        providers: {
          agnes: Boolean(env.AGNES_API_KEY),
          grok: Boolean(env.GROK_API_KEY)
        }
      }, 200, cors);
    }

    if (url.pathname !== "/api/ai" || request.method !== "POST")
      return json({ error: "Not found" }, 404, cors);

    if (!originAllowed)
      return json({ error: "Origin not allowed" }, 403);

    const contentType = request.headers.get("Content-Type") || "";
    if (!contentType.toLowerCase().includes("application/json"))
      return json({ error: "Content-Type must be application/json" }, 415, cors);

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > 12_000)
      return json({ error: "Request too large" }, 413, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }

    const provider = body?.provider;
    if (provider !== "agnes" && provider !== "grok")
      return json({ error: "provider must be agnes or grok" }, 400, cors);

    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    if (isRateLimited(clientIp))
      return json({ error: "Too many requests. Please try again in a minute." }, 429, cors);

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 4000)
      return json({ error: "message required (max 4000 characters)" }, 400, cors);

    // Deterministic product intent: never let the chat invent a catalog. Search Amazon France directly.
    const normalizedMessage = message.toLocaleLowerCase("fr-FR");
    const productIntent = /\b(trouve|chercher|cherche|recherche|recherches|montre|sors|affiche|donne|liste|catalogue|produits?|articles?|casquette|casquettes|chaussures|baskets|veste|vestes|polo|polos|t[- ]?shirt|tee[- ]?shirt|sac|sacs|parfum|parfums|lunettes|pantalon|pantalons|robe|robes|sweat|sweats|montre|montres|lacoste|adidas|nike|puma|gucci|prada|tommy hilfiger|ralph lauren|new balance|reebok|converse|levis|levi's)\b/.test(normalizedMessage);
    if (productIntent) {
      let query = message
        .replace(/^(?:bonjour[,! ]*)?(?:s\u2019il te pla\u00eet[, ]*)?/i, "")
        .replace(/\b(?:peux[- ]tu|pourrais[- ]tu|est[- ]ce que tu peux|je veux|je voudrais|j\u2019aimerais|aide[- ]moi \u00e0|trouve[- ]moi|cherche[- ]moi|recherche[- ]moi|montre[- ]moi|sors[- ]moi|donne[- ]moi|affiche[- ]moi|liste[- ]moi|sur amazon|chez amazon|sur le site prix ?malin|sur prix ?bas ?malin|stp|s\u2019il te pla\u00eet)\b/gi, " ")
        .replace(/\b(?:tous les produits|toutes les produits|tous les articles|toutes les marques)\b/gi, " ")
        .replace(/[?!.,;:]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!query) query = message.trim();
      const amazonSearchUrl = "https://www.amazon.fr/s?k=" + encodeURIComponent(query) + "&tag=prixbasmalin2021";
      return json({ ok: true, provider: "amazon", mode: "amazon_search", answer: "Je lance une recherche sur Amazon France pour : " + query + ". J’affiche les résultats Amazon correspondants ; je ne vais pas inventer des produits ni des prix.", amazonSearchUrl, amazonSearchQuery: query }, 200, cors);
    }

    // Models are controlled by server-side environment variables, not arbitrary client input.
    const model = provider === "agnes"
      ? (env.AGNES_MODEL || "agnes-3.0-flash")
      : (env.GROK_MODEL || "grok-4.7");
    if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model))
      return json({ error: "Invalid server model configuration" }, 500, cors);

    const apiKey = provider === "agnes" ? env.AGNES_API_KEY : env.GROK_API_KEY;
    if (!apiKey)
      return json({ error: "Provider not configured", provider }, 503, cors);

    const base = provider === "agnes"
      ? "https://apihub.agnes-ai.com/v1"
      : "https://api.x.ai/v1";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    let upstream;
    try {
      upstream = await fetch(base + "/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": "Bearer " + apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Tu es l’assistant d’achat de Prix Malin, en français. Tu aides uniquement à chercher et comparer des produits. Pour une demande de produits, ne prétends jamais avoir consulté un catalogue ou vérifié un prix si tu ne disposes pas de résultats réels. Ne redirige pas vers des enseignes sans rapport, ne réponds jamais à côté, ne dis pas que tu ne peux pas chercher une marque. Si la demande concerne un produit, précise que les recherches du site sont centrées sur Amazon France et demande au client d’utiliser la recherche Amazon intégrée si aucun résultat live n’est fourni. Réponses courtes, concrètes, honnêtes, sans inventer de références, de stocks ni de prix." },
            { role: "user", content: message }
          ],
          max_tokens: 500,
          temperature: 0.2
        })
      });
    } catch (error) {
      clearTimeout(timeout);
      return json({
        error: error?.name === "AbortError" ? "AI provider timed out" : "AI provider unreachable",
        provider
      }, 502, cors);
    } finally {
      // The timer is cleared after fetch resolves/rejects; the response body is read below.
    }

    let raw;
    try {
      raw = await upstream.text();
    } catch {
      clearTimeout(timeout);
      return json({ error: "Could not read AI provider response", provider }, 502, cors);
    }
    clearTimeout(timeout);

    if (!upstream.ok) {
      // Return only a short, sanitized provider error message; never return raw bodies or credentials.
      let providerMessage = "";
      try {
        const errorData = JSON.parse(raw);
        const candidate = errorData?.error?.message || errorData?.message || errorData?.error;
        if (typeof candidate === "string") providerMessage = candidate;
        else if (candidate && typeof candidate.message === "string") providerMessage = candidate.message;
      } catch {}
      providerMessage = String(providerMessage)
        .replace(/Bearer\\s+\\S+/gi, "Bearer [redacted]")
        .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
        .replace(/[\\r\\n\\t]+/g, " ")
        .slice(0, 240);
      return json({
        error: "AI provider request failed",
        provider,
        status: upstream.status,
        ...(providerMessage ? { providerMessage } : {})
      }, 502, cors);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid response from AI provider", provider }, 502, cors);
    }

    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim())
      return json({ error: "AI provider returned no answer", provider }, 502, cors);

    return json({ ok: true, provider, model, answer }, 200, cors);
  }
};

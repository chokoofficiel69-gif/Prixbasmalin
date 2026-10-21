/**
 * Prix Malin — secure AI gateway for Cloudflare Workers.
 * Required Worker secrets: AGNES_API_KEY and GROK_API_KEY.
 * Never put provider keys in browser code or this repository.
 */
const ALLOWED_ORIGINS = new Set(["https://prixbasmalin.fr", "https://www.prixbasmalin.fr"]);
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://prixbasmalin.fr",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "Prix Malin AI gateway", providers: {
        agnes: Boolean(env.AGNES_API_KEY), grok: Boolean(env.GROK_API_KEY)
      }}, { headers: cors });
    }
    if (url.pathname !== "/api/ai" || request.method !== "POST")
      return Response.json({ error: "Not found" }, { status: 404, headers: cors });
    if (!ALLOWED_ORIGINS.has(origin))
      return Response.json({ error: "Origin not allowed" }, { status: 403, headers: cors });
    let body;
    try { body = await request.json(); } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
    }
    const provider = body.provider;
    if (!["agnes", "grok"].includes(provider))
      return Response.json({ error: "provider must be agnes or grok" }, { status: 400, headers: cors });
    const apiKey = provider === "agnes" ? env.AGNES_API_KEY : env.GROK_API_KEY;
    if (!apiKey)
      return Response.json({ error: "API key not configured", provider }, { status: 503, headers: cors });
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 4000)
      return Response.json({ error: "message required (max 4000 characters)" }, { status: 400, headers: cors });
    const base = provider === "agnes" ? "https://apihub.agnes-ai.com/v1" : "https://api.x.ai/v1";
    const model = typeof body.model === "string" && /^[a-zA-Z0-9._:-]{1,100}$/.test(body.model)
      ? body.model : (provider === "agnes" ? "agnes-default" : "grok-3-mini");
    let upstream;
    try {
      upstream = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: message }], max_tokens: 500, temperature: 0.2 })
      });
    } catch {
      return Response.json({ error: "AI provider unreachable", provider }, { status: 502, headers: cors });
    }
    const raw = await upstream.text();
    if (!upstream.ok)
      return Response.json({ error: "AI provider request failed", provider, status: upstream.status, details: raw.slice(0, 300) }, { status: 502, headers: cors });
    let data;
    try { data = JSON.parse(raw); } catch {
      return Response.json({ error: "Invalid response from AI provider" }, { status: 502, headers: cors });
    }
    return Response.json({ ok: true, provider, model, answer: data.choices?.[0]?.message?.content ?? null }, { headers: cors });
  }
};

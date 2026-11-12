// Prix Malin — Worker de mesure (pages vues, clics sortants, tableau de bord privé).
// Fichier unique : il peut être collé tel quel dans l'éditeur Cloudflare ou déployé avec Wrangler.
//
// Version 2 (compatible avec l'ancien frontend) :
// - événements dédupliqués par event_id (double envoi, nouvelle tentative réseau) ;
// - visiteur mesuré (identifiant aléatoire persistant, après consentement) distinct de la session
//   (30 minutes d'inactivité) ;
// - classification prudente du trafic côté serveur (humain probable, robot, suspect, indéterminé),
//   sans aucun blocage ;
// - tag Amazon contrôlé côté serveur (has_affiliate_tag) ;
// - le Worker fonctionne avant ET après la migration D1 2026-11-08 (repli sur l'ancien schéma).
//
// Aucune adresse IP, aucun User-Agent complet et aucun jeton n'est enregistré ni journalisé.

const ALLOWED_ORIGINS = new Set(["https://prixbasmalin.fr", "https://www.prixbasmalin.fr"]);
const EXPECTED_AMAZON_TAG = "prixbasmalin2-21";
const SCHEMA_VERSION = 2;

const KNOWN_BOT_UA = /bot\b|bot\/|crawl|spider|slurp|archiver|facebookexternalhit|facebookcatalog|embedly|quora link|whatsapp|telegrambot|discordbot|slackbot|linkedinbot|twitterbot|pinterestbot|headlesschrome|phantomjs|puppeteer|playwright|selenium|webdriver|python-requests|python-urllib|aiohttp|httpx|scrapy|curl\/|wget\/|libwww|httpclient|okhttp|go-http-client|java\/|node-fetch|undici|axios|postmanruntime|insomnia|lighthouse|chrome-lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|site24x7|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|anthropic-ai|perplexity|ccbot|applebot|yandex|baidu|seznam|sogou|exabot|ia_archiver|feedfetcher|mediapartners|adsbot|google-inspectiontool|bingpreview|cloudflare-diagnostics/i;
const DATACENTER_ORG = /amazon|aws|google cloud|googleusercontent|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|vultr|choopa|oracle cloud|alibaba|tencent cloud|scaleway|online s\.a\.s|contabo|leaseweb|m247|datacamp|cdn77|hostinger|ionos|psychz|quadranet|colocrossing|servers\.com/i;

const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;
const EVENT_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;
const VISITOR_ID_RE = /^[a-zA-Z0-9-]{12,80}$/;
const LINK_KINDS = new Set(["product", "search", "deals", "partner", "other"]);

// En-têtes de sécurité ajoutés à toute réponse (défense en profondeur côté API).
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

// Limiteur de débit par IP pour l'écriture des événements : ralentit un script
// extérieur qui gonflerait les compteurs. Fenêtre glissante d'une minute, limite large
// (une page légitime émet une vue + quelques clics) pour ne jamais perdre de vraie mesure.
// Au-delà, le worker renvoie 429 sans écrire.
// IMPORTANT : le compteur vit en mémoire DANS CHAQUE isolate Cloudflare. C'est une défense
// en profondeur par isolate, pas une limite globale stricte garantie sur toutes les instances.
// Une limite globale exacte demanderait un stockage partagé (Durable Object ou KV).
const RATE_LIMIT_PER_MINUTE = 90;
const rateBuckets = new Map();
function isRateLimited(key, now = Date.now()) {
  const windowMs = 60000;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) bucket = { start: now, count: 0 };
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (now - v.start >= windowMs) rateBuckets.delete(k);
  }
  return bucket.count > RATE_LIMIT_PER_MINUTE;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://prixbasmalin.fr",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function cleanText(value, max) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, max) : "";
}

function optionalId(value, re) {
  return typeof value === "string" && re.test(value) ? value : null;
}

/** Classe prudemment une requête, sans jamais faire confiance aux seules déclarations du navigateur. */
function classifyTraffic(request, body = {}) {
  const ua = request.headers.get("User-Agent") || "";
  const cf = request.cf || {};
  const bm = cf.botManagement;
  if (!ua) return "suspect";
  if (KNOWN_BOT_UA.test(ua)) return "bot";
  if (bm && typeof bm === "object") {
    if (bm.verifiedBot === true) return "bot";
    if (typeof bm.score === "number") {
      if (bm.score < 30) return "bot";
      if (bm.score < 50) return "suspect";
    }
  }
  if (typeof cf.verifiedBotCategory === "string" && cf.verifiedBotCategory) return "bot";
  // Signaux complémentaires : ils rendent l'événement suspect, jamais « humain certain ».
  if (typeof cf.asOrganization === "string" && DATACENTER_ORG.test(cf.asOrganization)) return "suspect";
  if (!request.headers.get("Accept-Language")) return "suspect";
  if (body && body.signals && body.signals.webdriver === true) return "suspect";
  const looksLikeBrowser = /^Mozilla\/5\.0 /.test(ua) && /(Chrome|CriOS|Safari|Firefox|FxiOS|Edg|OPR|SamsungBrowser)\//.test(ua);
  return looksLikeBrowser ? "human_probable" : "unknown";
}

function amazonInfo(merchantHost, rawTag) {
  const isAmazon = merchantHost === "amazon.fr" || merchantHost.endsWith(".amazon.fr");
  if (!isAmazon) return { isAmazon, tag: null, hasTag: null };
  const tag = typeof rawTag === "string" && /^[a-z0-9-]{1,30}$/i.test(rawTag) ? rawTag.toLowerCase() : null;
  return { isAmazon, tag, hasTag: tag === EXPECTED_AMAZON_TAG ? 1 : 0 };
}

/** Décalage horaire de Paris en minutes (heure d'été / d'hiver), pour les regroupements par jour. */
function parisOffsetModifier(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
    const get = type => Number(parts.find(p => p.type === type).value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const minutes = Math.round((asUtc - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes())) / 60000);
    return (minutes >= 0 ? "+" : "") + minutes + " minutes";
  } catch {
    return "+60 minutes";
  }
}

/** Comparaison en temps constant du jeton d'administration. */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function isSchemaError(error) {
  return /no such column|no column named|has no column|no such table/i.test(String(error && error.message || error));
}

function log(event, fields) {
  // Une ligne courte par événement : jamais d'identifiant, de jeton, d'IP ni de User-Agent.
  try { console.log(JSON.stringify({ svc: "prixbasmalin-clicks", event, ...fields })); } catch {}
}

async function recordView(env, request, body) {
  const pagePath = body.page_path;
  const visitorId = typeof body.visitor_id === "string" ? body.visitor_id.slice(0, 80) : "";
  if (!VISITOR_ID_RE.test(visitorId)) return { status: 400, error: "Invalid visitor id" };
  const v2 = body.schema_version === SCHEMA_VERSION;
  const eventId = optionalId(body.event_id, EVENT_ID_RE);
  const sessionId = optionalId(body.session_id, VISITOR_ID_RE);
  const productId = optionalId(body.product_id, PRODUCT_ID_RE);
  const country = typeof request.cf?.country === "string" && /^[A-Z]{2}$/.test(request.cf.country) ? request.cf.country : null;
  const trafficClass = classifyTraffic(request, body);
  const source = cleanText(body.source, 80) || null, medium = cleanText(body.medium, 80) || null, campaign = cleanText(body.campaign, 100) || null;
  try {
    const result = await env.CLICKS.prepare(
      "INSERT OR IGNORE INTO page_views (page_path, visitor_id, session_id, event_id, source, medium, campaign, country, product_id, traffic_class, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(pagePath, visitorId, sessionId, eventId, source, medium, campaign, country, productId, trafficClass, v2 ? SCHEMA_VERSION : 1).run();
    const duplicate = !!(result && result.meta && result.meta.changes === 0);
    log("view", { traffic_class: trafficClass, v2, duplicate, product: !!productId });
    return { status: 204, duplicate };
  } catch (error) {
    if (!isSchemaError(error)) throw error;
    // Migration pas encore appliquée : on garde exactement le comportement historique.
    await env.CLICKS.prepare("INSERT INTO page_views (page_path, visitor_id) VALUES (?, ?)").bind(pagePath, visitorId).run();
    log("view", { traffic_class: trafficClass, v2, legacy_schema: true });
    return { status: 204, legacySchema: true };
  }
}

async function recordClick(env, request, body) {
  const merchantHost = typeof body.merchant_host === "string" ? body.merchant_host.toLowerCase().slice(0, 120) : "";
  const labels = merchantHost.split(".");
  const validHost = labels.length >= 2 && labels.every(label => label.length > 0 && /^[a-z0-9-]+$/.test(label));
  if (!validHost) return { status: 400, error: "Invalid merchant host" };
  const clickType = body.click_type === "search" ? "search" : "outbound";
  const amazon = amazonInfo(merchantHost, body.affiliate_tag);
  const eventId = optionalId(body.event_id, EVENT_ID_RE);
  const visitorId = optionalId(body.visitor_id, VISITOR_ID_RE);
  const sessionId = optionalId(body.session_id, VISITOR_ID_RE);
  const productId = optionalId(body.product_id, PRODUCT_ID_RE);
  const linkKind = LINK_KINDS.has(body.link_kind) ? body.link_kind : null;
  const country = typeof request.cf?.country === "string" && /^[A-Z]{2}$/.test(request.cf.country) ? request.cf.country : null;
  const trafficClass = classifyTraffic(request, body);
  const v2 = body.schema_version === SCHEMA_VERSION;
  try {
    const result = await env.CLICKS.prepare(
      "INSERT OR IGNORE INTO outbound_clicks (page_path, merchant_host, click_type, affiliate_tag, has_affiliate_tag, visitor_id, session_id, event_id, product_id, link_kind, traffic_class, country, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(body.page_path, merchantHost, clickType, amazon.tag, amazon.hasTag, visitorId, sessionId, eventId, productId, linkKind, trafficClass, country, v2 ? SCHEMA_VERSION : 1).run();
    const duplicate = !!(result && result.meta && result.meta.changes === 0);
    log("click", { amazon: amazon.isAmazon, tagged: amazon.hasTag, traffic_class: trafficClass, duplicate });
    return { status: 204, duplicate };
  } catch (error) {
    if (!isSchemaError(error)) throw error;
    await env.CLICKS.prepare("INSERT INTO outbound_clicks (page_path, merchant_host, click_type, affiliate_tag) VALUES (?, ?, ?, ?)").bind(body.page_path, merchantHost, clickType, amazon.tag).run();
    log("click", { amazon: amazon.isAmazon, tagged: amazon.hasTag, legacy_schema: true });
    return { status: 204, legacySchema: true };
  }
}

async function safeFirst(env, sql, binds = []) {
  try { return await env.CLICKS.prepare(sql).bind(...binds).first(); } catch (error) { if (isSchemaError(error)) return null; throw error; }
}
async function safeAll(env, sql, binds = []) {
  try { const r = await env.CLICKS.prepare(sql).bind(...binds).all(); return r.results || []; } catch (error) { if (isSchemaError(error)) return null; throw error; }
}

async function buildStats(env, url) {
  const tz = parisOffsetModifier();
  const days = Math.min(90, Math.max(1, Number.parseInt(url.searchParams.get("days") || "7", 10) || 7));
  const since = `date('now', '${tz}', '-${days - 1} days')`;
  const inPeriod = `date(created_at, '${tz}') >= ${since}`;
  const isToday = `date(created_at, '${tz}') = date('now', '${tz}')`;
  const amazonHost = "(merchant_host = 'amazon.fr' OR merchant_host LIKE '%.amazon.fr')";

  // Bloc historique : mêmes champs qu'avant, pour la compatibilité de l'ancien tableau de bord.
  const today = await env.CLICKS.prepare(`SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM page_views WHERE ${isToday}`).first();
  const clicksToday = await env.CLICKS.prepare(`SELECT COUNT(*) AS clicks FROM outbound_clicks WHERE ${isToday}`).first();
  const daysRows = await env.CLICKS.prepare(`SELECT date(created_at, '${tz}') AS day, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM page_views WHERE ${inPeriod} GROUP BY day ORDER BY day`).all();
  const clicksDays = await env.CLICKS.prepare(`SELECT date(created_at, '${tz}') AS day, COUNT(*) AS clicks FROM outbound_clicks WHERE ${inPeriod} GROUP BY day ORDER BY day`).all();
  const pages = await env.CLICKS.prepare(`SELECT page_path, COUNT(*) AS views FROM page_views WHERE ${inPeriod} GROUP BY page_path ORDER BY views DESC LIMIT 15`).all();
  const merchants = await env.CLICKS.prepare(`SELECT merchant_host, COUNT(*) AS clicks FROM outbound_clicks WHERE ${inPeriod} GROUP BY merchant_host ORDER BY clicks DESC LIMIT 15`).all();
  const amazonAffiliateTags = await env.CLICKS.prepare(`SELECT affiliate_tag, COUNT(*) AS clicks FROM outbound_clicks WHERE ${amazonHost} AND affiliate_tag IS NOT NULL GROUP BY affiliate_tag ORDER BY clicks DESC LIMIT 10`).all();

  // Clics : Amazon avec le bon tag, Amazon sans (ou avec un autre) tag, autres marchands. Valable aussi pour l'historique.
  const clicks = await env.CLICKS.prepare(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${amazonHost} AND affiliate_tag = ? THEN 1 ELSE 0 END) AS amazon_tagged,
      SUM(CASE WHEN ${amazonHost} AND (affiliate_tag IS NULL OR affiliate_tag <> ?) THEN 1 ELSE 0 END) AS amazon_untagged,
      SUM(CASE WHEN NOT ${amazonHost} THEN 1 ELSE 0 END) AS other_merchants
     FROM outbound_clicks WHERE ${inPeriod}`
  ).bind(EXPECTED_AMAZON_TAG, EXPECTED_AMAZON_TAG).first();

  // Audience v2 (après migration). Les anciennes lignes (schema_version NULL ou 1) sont comptées à part.
  const audience = await safeFirst(env,
    `SELECT COUNT(*) AS page_views,
      SUM(CASE WHEN traffic_class = 'human_probable' THEN 1 ELSE 0 END) AS page_views_human,
      COUNT(DISTINCT CASE WHEN schema_version = 2 THEN visitor_id END) AS visitors_measured,
      COUNT(DISTINCT CASE WHEN schema_version = 2 AND traffic_class = 'human_probable' THEN visitor_id END) AS visitors_human,
      COUNT(DISTINCT CASE WHEN schema_version = 2 THEN session_id END) AS sessions,
      COUNT(DISTINCT CASE WHEN schema_version = 2 AND traffic_class = 'human_probable' THEN session_id END) AS sessions_human,
      COUNT(DISTINCT product_id) AS products_viewed,
      SUM(CASE WHEN product_id IS NOT NULL THEN 1 ELSE 0 END) AS product_views,
      COUNT(DISTINCT CASE WHEN schema_version IS NULL OR schema_version = 1 THEN visitor_id END) AS legacy_tab_sessions
     FROM page_views WHERE ${inPeriod}`);
  const classes = await safeAll(env, `SELECT COALESCE(traffic_class, 'non_classe') AS traffic_class, COUNT(*) AS page_views FROM page_views WHERE ${inPeriod} GROUP BY 1 ORDER BY 2 DESC`);
  const sources = await safeAll(env,
    `SELECT COALESCE(source, 'direct') AS source, COALESCE(medium, 'direct') AS medium, COUNT(DISTINCT session_id) AS sessions
     FROM page_views WHERE ${inPeriod} AND schema_version = 2 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`);
  const legacySources = await safeAll(env,
    `SELECT COALESCE(source, 'direct') AS source, COALESCE(medium, 'direct') AS medium, COUNT(DISTINCT visitor_id) AS sessions
     FROM traffic_attribution WHERE ${inPeriod} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`);
  const products = await safeAll(env,
    `SELECT product_id, COUNT(*) AS views FROM page_views WHERE ${inPeriod} AND product_id IS NOT NULL GROUP BY product_id ORDER BY views DESC LIMIT 15`);
  const clickClasses = await safeAll(env,
    `SELECT COALESCE(traffic_class, 'non_classe') AS traffic_class, COUNT(*) AS clicks FROM outbound_clicks WHERE ${inPeriod} GROUP BY 1 ORDER BY 2 DESC`);
  // Ventes : uniquement depuis un rapport officiel Amazon importé (jamais déduites des clics).
  const amazonReport = await safeFirst(env,
    `SELECT COUNT(*) AS report_days, SUM(clicks) AS amazon_reported_clicks, SUM(ordered_items) AS ordered_items,
      SUM(shipped_items) AS shipped_items, SUM(revenue_eur) AS revenue_eur, SUM(earnings_eur) AS earnings_eur, MAX(imported_at) AS last_import
     FROM amazon_reports WHERE report_date >= ${since} AND tracking_id = ?`, [EXPECTED_AMAZON_TAG]);

  return {
    generated_at: new Date().toISOString(),
    timezone: "Europe/Paris",
    period_days: days,
    migration_applied: audience !== null,
    today: { ...today, clicks: clicksToday?.clicks || 0 },
    days: daysRows.results || [],
    clicks_days: clicksDays.results || [],
    top_pages: pages.results || [],
    top_merchants: merchants.results || [],
    amazon_affiliate_tags: amazonAffiliateTags.results || [],
    commercial: {
      audience,
      traffic_classes: classes,
      sources: sources,
      legacy_sources: legacySources,
      top_products: products,
      clicks: {
        total: clicks?.total || 0,
        amazon_tagged: clicks?.amazon_tagged || 0,
        amazon_untagged: clicks?.amazon_untagged || 0,
        other_merchants: clicks?.other_merchants || 0,
        by_traffic_class: clickClasses
      },
      amazon_official: amazonReport && amazonReport.report_days ? amazonReport : null,
      notes: [
        "Les clics enregistrés ne prouvent ni une commande ni une commission.",
        "Commandes et commissions : uniquement depuis un rapport officiel Amazon importé.",
        "Avant la migration v2, « visitor_id » identifiait un onglet de navigateur, pas un visiteur."
      ]
    }
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);
    const url = new URL(request.url);
    const json = (data, status = 200) => Response.json(data, { status, headers: { ...cors, ...SECURITY_HEADERS, "Cache-Control": "no-store" } });

    if (request.method === "OPTIONS") return new Response(null, { status: ALLOWED_ORIGINS.has(origin) ? 204 : 403, headers: { ...cors, ...SECURITY_HEADERS } });
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, service: "prixbasmalin-analytics", schema_version: SCHEMA_VERSION });

    if (request.method === "POST" && (url.pathname === "/track" || url.pathname === "/view")) {
      if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403);
      const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
      if (isRateLimited(clientIp)) return json({ error: "Too many requests" }, 429);
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > 2048) return json({ error: "Payload too large" }, 413);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      if (!body || typeof body !== "object") return json({ error: "Invalid JSON" }, 400);
      const pagePath = typeof body.page_path === "string" ? body.page_path.slice(0, 180) : "/";
      const validPath = pagePath.startsWith("/") && !pagePath.includes("..") && /^[a-zA-Z0-9/_.-]+$/.test(pagePath);
      if (!validPath) return json({ error: "Invalid page path" }, 400);
      body.page_path = pagePath;
      try {
        const result = url.pathname === "/view" ? await recordView(env, request, body) : await recordClick(env, request, body);
        if (result.error) return json({ error: result.error }, result.status);
        return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS, "Cache-Control": "no-store" } });
      } catch (error) {
        console.error(JSON.stringify({ svc: "prixbasmalin-clicks", event: "write_error", path: url.pathname, message: String(error && error.message || error).slice(0, 160) }));
        return json({ error: "Storage error" }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.ADMIN_TOKEN || !safeEqual(auth, "Bearer " + env.ADMIN_TOKEN)) {
        log("stats_denied", {});
        return json({ error: "Unauthorized" }, 401);
      }
      return json(await buildStats(env, url));
    }
    return json({ error: "Not found" }, 404);
  }
};

// Tests du Worker prixbasmalin-clicks contre une vraie base SQLite (node:sqlite) imitant D1.
// Lancer : node --test workers/prixbasmalin-clicks.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "./prixbasmalin-clicks.js";

const ROOT = new URL("../", import.meta.url);
const BASE_SCHEMA = readFileSync(new URL("migrations/0000-schema-reference.sql", ROOT), "utf8");
const COUNTRY = readFileSync(new URL("migrations/2026-11-06-traffic-attribution-country.sql", ROOT), "utf8");
const V2 = readFileSync(new URL("migrations/2026-11-08-analytics-v2.sql", ROOT), "utf8");
const TOKEN = "test-admin-token-not-a-real-secret";
const ORIGIN = "https://prixbasmalin.fr";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** Imitation minimale de l'API D1 (prepare / bind / run / first / all). */
function d1(db) {
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) })
  });
  return { prepare: sql => statement(sql) };
}

function database({ migrated = true } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(BASE_SCHEMA);
  db.exec(COUNTRY);
  if (migrated) db.exec(V2);
  return db;
}

function request(method, path, { body, origin = ORIGIN, ua = SAFARI, lang = "fr-FR,fr;q=0.9", auth, ip, cf = { country: "FR", asOrganization: "Orange" } } = {}) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (ua) headers.set("User-Agent", ua);
  if (lang) headers.set("Accept-Language", lang);
  if (auth) headers.set("Authorization", auth);
  if (ip) headers.set("CF-Connecting-IP", ip);
  const text = body === undefined ? "" : JSON.stringify(body);
  if (body !== undefined) { headers.set("Content-Type", "application/json"); headers.set("Content-Length", String(Buffer.byteLength(text))); }
  return { method, url: "https://prixbasmalin-clicks.example.workers.dev" + path, headers, cf, json: async () => JSON.parse(text) };
}

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = (n, extra = {}) => ({ schema_version: 2, event_id: uuid(n), page_path: "/prix/airpods-4.html", visitor_id: "visitor-aaaaaaaaaaaa", session_id: "session-aaaaaaaaaaaa", product_id: "airpods-4", source: "google.com", medium: "organic", campaign: "none", ...extra });
const click = (n, extra = {}) => ({ schema_version: 2, event_id: uuid(1000 + n), page_path: "/prix/airpods-4.html", merchant_host: "www.amazon.fr", click_type: "outbound", affiliate_tag: "prixbasmalin2-21", link_kind: "search", product_id: "airpods-4", visitor_id: "visitor-aaaaaaaaaaaa", session_id: "session-aaaaaaaaaaaa", ...extra });
const stats = async env => (await worker.fetch(request("GET", "/stats?days=7", { auth: "Bearer " + TOKEN }), env)).json();

test("une page vue est enregistrée une seule fois par événement (double envoi maîtrisé)", async () => {
  const db = database(); const env = { CLICKS: d1(db) };
  for (let i = 0; i < 3; i++) assert.equal((await worker.fetch(request("POST", "/view", { body: view(1) }), env)).status, 204);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM page_views").get().n, 1);
  await worker.fetch(request("POST", "/view", { body: view(2) }), env);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM page_views").get().n, 2);
});

test("sessions, visiteurs et produits consultés sont cohérents", async () => {
  const db = database(); const env = { CLICKS: d1(db), ADMIN_TOKEN: TOKEN };
  await worker.fetch(request("POST", "/view", { body: view(1) }), env);
  await worker.fetch(request("POST", "/view", { body: view(2, { page_path: "/prix/", product_id: null }) }), env);
  await worker.fetch(request("POST", "/view", { body: view(3, { session_id: "session-bbbbbbbbbbbb" }) }), env);
  await worker.fetch(request("POST", "/view", { body: view(4, { visitor_id: "visitor-cccccccccccc", session_id: "session-cccccccccccc", product_id: "ps5-pro" }) }), env);
  const a = (await stats(env)).commercial.audience;
  assert.equal(a.page_views, 4);
  assert.equal(a.visitors_measured, 2);
  assert.equal(a.sessions, 3);
  assert.equal(a.products_viewed, 2);
  assert.equal(a.product_views, 3);
});

test("clics : Amazon avec tag, Amazon sans tag, autre tag, autres marchands", async () => {
  const db = database(); const env = { CLICKS: d1(db), ADMIN_TOKEN: TOKEN };
  await worker.fetch(request("POST", "/track", { body: click(1) }), env);
  await worker.fetch(request("POST", "/track", { body: click(1) }), env); // doublon ignoré
  await worker.fetch(request("POST", "/track", { body: click(2, { affiliate_tag: "" }) }), env);
  await worker.fetch(request("POST", "/track", { body: click(3, { affiliate_tag: "quelquun-21" }) }), env);
  await worker.fetch(request("POST", "/track", { body: click(4, { merchant_host: "www.fnac.com", affiliate_tag: "" }) }), env);
  const rows = db.prepare("SELECT merchant_host, affiliate_tag, has_affiliate_tag FROM outbound_clicks ORDER BY id").all();
  assert.deepEqual(rows.map(r => r.has_affiliate_tag), [1, 0, 0, null]);
  assert.equal(rows[0].affiliate_tag, "prixbasmalin2-21");
  const c = (await stats(env)).commercial.clicks;
  assert.deepEqual({ total: c.total, amazon_tagged: c.amazon_tagged, amazon_untagged: c.amazon_untagged, other_merchants: c.other_merchants },
    { total: 4, amazon_tagged: 1, amazon_untagged: 2, other_merchants: 1 });
});

test("robots classés sans être bloqués ; le navigateur ne peut pas se déclarer humain", async () => {
  const db = database(); const env = { CLICKS: d1(db) };
  const cases = [
    [{ ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }, "bot"],
    [{ ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0 Safari/537.36" }, "bot"],
    [{ ua: "curl/8.5.0" }, "bot"],
    [{ cf: { country: "FR", botManagement: { score: 5 } } }, "bot"],
    [{ cf: { country: "FR", botManagement: { score: 40 } } }, "suspect"],
    [{ cf: { country: "US", asOrganization: "Amazon.com, Inc." } }, "suspect"],
    [{ lang: null }, "suspect"],
    [{ ua: null }, "suspect"],
    [{ bodyExtra: { signals: { webdriver: true } } }, "suspect"],
    [{ bodyExtra: { signals: { webdriver: false } } }, "human_probable"],
    [{ ua: "SomethingUnknown/1.0" }, "unknown"],
    [{}, "human_probable"]
  ];
  for (const [i, [opts, expected]] of cases.entries()) {
    const res = await worker.fetch(request("POST", "/view", { ...opts, body: view(100 + i, opts.bodyExtra || {}) }), env);
    assert.equal(res.status, 204, "jamais bloqué");
    assert.equal(db.prepare("SELECT traffic_class FROM page_views WHERE event_id = ?").get(uuid(100 + i)).traffic_class, expected, JSON.stringify(opts));
  }
});

test("CORS et validation conservés", async () => {
  const env = { CLICKS: d1(database()) };
  assert.equal((await worker.fetch(request("OPTIONS", "/track", { origin: "https://evil.example" }), env)).status, 403);
  const ok = await worker.fetch(request("OPTIONS", "/track"), env);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal((await worker.fetch(request("POST", "/view", { origin: "https://evil.example", body: view(1) }), env)).status, 403);
  assert.equal((await worker.fetch(request("POST", "/view", { body: view(2, { page_path: "/../etc" }) }), env)).status, 400);
  assert.equal((await worker.fetch(request("POST", "/track", { body: click(2, { merchant_host: "bad host" }) }), env)).status, 400);
  const big = view(3, { campaign: "x".repeat(3000) });
  assert.equal((await worker.fetch(request("POST", "/view", { body: big }), env)).status, 413);
});

test("tableau de bord protégé, jeton jamais journalisé", async () => {
  const env = { CLICKS: d1(database()), ADMIN_TOKEN: TOKEN };
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try {
    assert.equal((await worker.fetch(request("GET", "/stats"), env)).status, 401);
    assert.equal((await worker.fetch(request("GET", "/stats", { auth: "Bearer mauvais" }), env)).status, 401);
    assert.equal((await worker.fetch(request("GET", "/stats", { auth: "Bearer " + TOKEN }), { CLICKS: env.CLICKS })).status, 401, "sans ADMIN_TOKEN configuré : refus");
    const res = await worker.fetch(request("GET", "/stats", { auth: "Bearer " + TOKEN }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    await worker.fetch(request("POST", "/view", { body: view(9) }), env);
  } finally { console.log = orig; }
  const joined = logs.join("\n");
  assert.ok(!joined.includes(TOKEN));
  assert.ok(!joined.includes("visitor-aaaaaaaaaaaa"));
  assert.ok(!joined.includes(SAFARI));
});

test("avant la migration : ancien comportement intact ; après : anciennes données conservées", async () => {
  const db = database({ migrated: false }); const env = { CLICKS: d1(db), ADMIN_TOKEN: TOKEN };
  // Ancien frontend (v1) puis nouveau frontend (v2) avant migration : rien n'échoue.
  assert.equal((await worker.fetch(request("POST", "/view", { body: { page_path: "/", visitor_id: "legacy-tab-session-1" } }), env)).status, 204);
  assert.equal((await worker.fetch(request("POST", "/view", { body: view(1) }), env)).status, 204);
  assert.equal((await worker.fetch(request("POST", "/track", { body: { page_path: "/", merchant_host: "www.amazon.fr", click_type: "outbound", affiliate_tag: "prixbasmalin2-21" } }), env)).status, 204);
  const before = await stats(env);
  assert.equal(before.migration_applied, false);
  assert.equal(before.commercial.clicks.amazon_tagged, 1);
  assert.equal(before.today.views, 2);
  // Migration additive : les lignes existantes restent, le nouveau code s'appuie dessus.
  db.exec(V2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM page_views").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbound_clicks").get().n, 1);
  await worker.fetch(request("POST", "/view", { body: view(2) }), env);
  const after = await stats(env);
  assert.equal(after.migration_applied, true);
  assert.equal(after.today.views, 3);
  assert.equal(after.commercial.audience.legacy_tab_sessions, 2);
  assert.equal(after.commercial.clicks.amazon_tagged, 1);
});

test("les commandes ne viennent que d'un rapport Amazon importé", async () => {
  const db = database(); const env = { CLICKS: d1(db), ADMIN_TOKEN: TOKEN };
  for (let i = 0; i < 5; i++) await worker.fetch(request("POST", "/track", { body: click(i) }), env);
  assert.equal((await stats(env)).commercial.amazon_official, null, "des clics ne créent aucune commande");
  db.exec("INSERT INTO amazon_reports (report_date, tracking_id, clicks, ordered_items, shipped_items, revenue_eur, earnings_eur, source_file) VALUES (date('now'), 'prixbasmalin2-21', 12, 1, 1, 49.9, 1.5, 'test.csv')");
  const official = (await stats(env)).commercial.amazon_official;
  assert.equal(official.ordered_items, 1);
  assert.equal(official.earnings_eur, 1.5);
});

test("un flot d'événements depuis une même IP est limité (anti-gonflage des compteurs)", async () => {
  const db = database(); const env = { CLICKS: d1(db) };
  const ip = "203.0.113.7";
  let ok = 0, limited = 0;
  for (let i = 0; i < 95; i++) {
    const res = await worker.fetch(request("POST", "/view", { body: view(5000 + i), ip }), env);
    if (res.status === 204) ok++;
    else if (res.status === 429) limited++;
  }
  assert.equal(ok, 90, "90 événements acceptés par minute et par IP");
  assert.equal(limited, 5, "au-delà, réponse 429 sans écriture");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM page_views").get().n, 90, "rien n'est écrit après la limite");
});

test("les réponses portent les en-têtes de sécurité (nosniff, anti-iframe)", async () => {
  const db = database(); const env = { CLICKS: d1(db) };
  const res = await worker.fetch(request("POST", "/view", { body: view(6000), ip: "203.0.113.8" }), env);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("les en-têtes de sécurité sont aussi présents sur les prévols OPTIONS (autorisés et refusés)", async () => {
  const env = { CLICKS: d1(database()) };
  const ok = await worker.fetch(request("OPTIONS", "/track"), env);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(ok.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(ok.headers.get("X-Frame-Options"), "DENY");
  assert.equal(ok.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  const denied = await worker.fetch(request("OPTIONS", "/track", { origin: "https://evil.example" }), env);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(denied.headers.get("X-Frame-Options"), "DENY");
});

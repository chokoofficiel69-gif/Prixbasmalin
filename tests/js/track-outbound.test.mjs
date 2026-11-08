// Tests du script navigateur js/track-outbound.js dans un environnement simulé (sans réseau).
// Lancer : node --test tests/js/track-outbound.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../../js/track-outbound.js", import.meta.url), "utf8");

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), _map: map };
}

/** Charge le script dans une « page » simulée et renvoie les requêtes envoyées. */
function loadPage({ path = "/prix/airpods-4.html", search = "", referrer = "", now = 1_800_000_000_000, local, session, productMeta = "airpods-4", webdriver = false } = {}) {
  const sent = [];
  let clickHandler = null;
  let counter = 0;
  const location = { hostname: "prixbasmalin.fr", pathname: path, search, href: "https://prixbasmalin.fr" + path + search };
  const sandbox = {
    location, URL, URLSearchParams, JSON, Math, Uint8Array, Array, String, Number,
    Date: { now: () => sandbox.__now },
    __now: now,
    localStorage: local || storage(),
    sessionStorage: session || storage(),
    navigator: { webdriver },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` },
    fetch: (url, init) => { sent.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive }); return Promise.resolve({}); },
    document: {
      referrer,
      querySelector: sel => (sel === 'meta[name="pm-product-id"]' && productMeta ? { getAttribute: () => productMeta } : null),
      addEventListener: (type, fn) => { if (type === "click") clickHandler = fn; }
    },
    open: () => null
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  const clickLink = href => clickHandler({ target: { closest: () => ({ href }) } });
  return { sent, sandbox, clickLink, views: () => sent.filter(s => s.url.endsWith("/view")), tracks: () => sent.filter(s => s.url.endsWith("/track")) };
}

test("une seule page vue par chargement, vers un seul Worker", () => {
  const page = loadPage();
  assert.equal(page.views().length, 1);
  assert.match(page.views()[0].url, /prixbasmalin-clicks\.chokoofficiel69\.workers\.dev\/view$/);
  assert.equal(page.sent.filter(s => s.url.includes("prixbasmalin-attribution")).length, 0);
  const v = page.views()[0].body;
  assert.equal(v.schema_version, 2);
  assert.equal(v.product_id, "airpods-4");
  assert.ok(v.event_id && v.visitor_id && v.session_id);
  // Le script chargé deux fois sur la même page n'envoie pas de seconde vue.
  vm.runInContext(SOURCE, page.sandbox);
  assert.equal(page.views().length, 1);
});

test("session : la même pendant 30 min d'activité, nouvelle après 30 min d'inactivité ; visiteur conservé", () => {
  const local = storage();
  const a = loadPage({ local, now: 1_800_000_000_000 }).views()[0].body;
  const b = loadPage({ local, now: 1_800_000_000_000 + 29 * 60 * 1000 }).views()[0].body;
  const c = loadPage({ local, now: 1_800_000_000_000 + 29 * 60 * 1000 + 31 * 60 * 1000 }).views()[0].body;
  assert.equal(a.session_id, b.session_id);
  assert.notEqual(b.session_id, c.session_id);
  assert.equal(a.visitor_id, c.visitor_id);
  assert.notEqual(a.event_id, b.event_id);
});

test("clic Amazon : le tag est lu dans l'URL réellement ouverte ; double clic compté une fois", () => {
  const page = loadPage();
  page.clickLink("https://www.amazon.fr/s?k=AirPods+4&tag=prixbasmalin2-21");
  page.clickLink("https://www.amazon.fr/s?k=AirPods+4&tag=prixbasmalin2-21");
  page.sandbox.__now += 2000;
  page.clickLink("https://www.amazon.fr/s?k=AirPods+4");
  page.clickLink("https://www.fnac.com/SearchResult/ResultList.aspx?Search=AirPods");
  page.clickLink("https://prixbasmalin.fr/prix/");
  const t = page.tracks().map(x => x.body);
  assert.equal(t.length, 3, "doublon et lien interne ignorés");
  assert.equal(t[0].affiliate_tag, "prixbasmalin2-21");
  assert.equal(t[0].link_kind, "search");
  assert.equal(t[1].affiliate_tag, "");
  assert.equal(t[2].merchant_host, "www.fnac.com");
  assert.equal(t[2].affiliate_tag, "");
  assert.ok(t.every(x => x.event_id && x.session_id && x.product_id === "airpods-4"));
  assert.ok(page.tracks().every(x => x.keepalive === true));
});

test("lien « offres du jour » Amazon classé deals", () => {
  const page = loadPage();
  page.clickLink("https://www.amazon.fr/gp/goldbox?tag=prixbasmalin2-21");
  assert.equal(page.tracks()[0].body.link_kind, "deals");
});

test("sources : Google = organique, réseau social, campagne utm, accès direct", () => {
  assert.deepEqual(pick(loadPage({ referrer: "https://www.google.com/" })), ["google.com", "organic"]);
  assert.deepEqual(pick(loadPage({ referrer: "https://www.google.fr/search?q=x" })), ["google.fr", "organic"]);
  assert.deepEqual(pick(loadPage({ referrer: "https://m.facebook.com/" })), ["m.facebook.com", "social"]);
  assert.deepEqual(pick(loadPage({ search: "?utm_source=newsletter&utm_medium=email" })), ["newsletter", "email"]);
  assert.deepEqual(pick(loadPage({ referrer: "https://prixbasmalin.fr/" })), ["direct", "direct"]);
  assert.deepEqual(pick(loadPage()), ["direct", "direct"]);
  function pick(page) { const v = page.views()[0].body; return [v.source, v.medium]; }
});

test("le signal webdriver est transmis comme indice, jamais comme preuve d'humanité", () => {
  assert.equal(loadPage({ webdriver: true }).views()[0].body.signals.webdriver, true);
  assert.equal(loadPage().views()[0].body.signals.webdriver, false);
});

test("hors du domaine prixbasmalin.fr, rien n'est envoyé", () => {
  const sent = [];
  const sandbox = { location: { hostname: "localhost", pathname: "/" }, fetch: () => sent.push(1) };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  assert.equal(sent.length, 0);
});

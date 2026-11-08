/* Prix Malin — mesure d'audience et des clics sortants (chargée uniquement après consentement).
   Version 2 :
   - une seule page vue envoyée par chargement de page (au lieu de deux, vers deux Workers) ;
   - visiteur mesuré : identifiant aléatoire conservé 13 mois au plus dans ce navigateur ;
   - session : nouvelle après 30 minutes d'inactivité, partagée entre les onglets ;
   - chaque événement porte un identifiant unique (event_id) : le Worker ignore les doublons ;
   - clic : le tag Amazon est lu dans l'URL réellement ouverte, jamais supposé ;
   - aucun nom, e-mail, adresse IP ou empreinte de navigateur n'est collecté. */
(function () {
  "use strict";
  var base = "https://prixbasmalin-clicks.chokoofficiel69.workers.dev";
  var endpoint = base + "/track";
  var ownHost = location.hostname.replace(/^www\./, "");
  if (ownHost !== "prixbasmalin.fr") return;
  if (window.__pmTrackerV2) return; // le script ne s'installe qu'une fois par page
  window.__pmTrackerV2 = true;

  var SESSION_TIMEOUT = 30 * 60 * 1000;
  var VISITOR_TTL = 395 * 24 * 60 * 60 * 1000; // 13 mois maximum
  var SESSION_KEY = "pm_analytics_session_v2";
  var VISITOR_KEY = "pm_analytics_visitor_v2";
  var attributionKey = "pm_traffic_attribution";

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return "pm-" + Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function readJson(store, key) {
    try { return JSON.parse(store.getItem(key) || "null"); } catch (_) { return null; }
  }
  function writeJson(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  /** Classe la provenance d'une session : campagne (utm), moteur de recherche, site référent ou accès direct. */
  function detectAttribution() {
    var params = new URLSearchParams(location.search);
    var source = params.get("utm_source") || "";
    var medium = params.get("utm_medium") || "";
    var campaign = params.get("utm_campaign") || "";
    if (!source && document.referrer) {
      try {
        var refHost = new URL(document.referrer).hostname.toLowerCase().replace(/^www\./, "");
        if (refHost && refHost !== ownHost && !refHost.endsWith("." + ownHost)) {
          source = refHost;
          medium = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|qwant|startpage|yandex|baidu)\./.test(refHost) ? "organic"
            : /(^|\.)(facebook|instagram|tiktok|pinterest|twitter|x|linkedin|reddit|youtube|whatsapp|snapchat)\.|^t\.co$|^lnkd\.in$/.test(refHost) ? "social"
            : "referral";
        }
      } catch (_) {}
    }
    return { source: source || "direct", medium: medium || (source ? "referral" : "direct"), campaign: campaign || "none" };
  }

  /** Visiteur mesuré (persistant, renouvelé après 13 mois) et session (30 min d'inactivité). */
  function identity(now) {
    var visitor = readJson(localStorage, VISITOR_KEY);
    if (!visitor || !visitor.id || now - (visitor.created || 0) > VISITOR_TTL) {
      visitor = { id: randomId(), created: now };
      writeJson(localStorage, VISITOR_KEY, visitor);
    }
    var session = readJson(localStorage, SESSION_KEY);
    if (!session || !session.id || now - (session.last || 0) > SESSION_TIMEOUT) {
      session = { id: randomId(), started: now, last: now, attribution: detectAttribution() };
      writeJson(sessionStorage, attributionKey, session.attribution);
    }
    session.last = now;
    writeJson(localStorage, SESSION_KEY, session);
    return { visitor: visitor, session: session };
  }

  /** Produit consulté : fiche /prix/<id>.html (balise meta) ou comparateur produit.html?id=. */
  function currentProductId() {
    var meta = document.querySelector('meta[name="pm-product-id"]');
    var id = meta ? meta.getAttribute("content") : "";
    if (!id && /\/produit\.html$/.test(location.pathname)) id = new URLSearchParams(location.search).get("id") || "";
    return /^[a-z0-9][a-z0-9-]{1,79}$/.test(id) ? id : null;
  }

  function send(path, payload) {
    try {
      fetch(base + path, {
        method: "POST", mode: "cors", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (_) {}
  }

  function linkKind(target) {
    var host = target.hostname.toLowerCase();
    var isAmazon = host === "amazon.fr" || host.endsWith(".amazon.fr");
    if (isAmazon && /^\/(dp|gp\/product)\//.test(target.pathname)) return "product";
    if (isAmazon && /^\/gp\/(goldbox|bestsellers|deals)/.test(target.pathname)) return "deals";
    if (/^\/s$|\/s\/|\/search|\/recherche|resultats|SearchResult|wholesale|\/sch\//i.test(target.pathname) || target.searchParams.has("k") || target.searchParams.has("q")) return "search";
    if (/linksynergy\.com$|awin1\.com$/.test(host)) return "partner";
    return "other";
  }

  var lastClick = { url: "", at: 0 };
  function record(rawUrl, type) {
    try {
      var target = new URL(rawUrl, location.href);
      if (target.protocol !== "https:" && target.protocol !== "http:") return;
      if (target.hostname.replace(/^www\./, "") === ownHost) return;
      var now = Date.now();
      // Double clic, double tap ou clic suivi d'un window.open sur la même URL : un seul clic compté.
      if (lastClick.url === target.href && now - lastClick.at < 1500) return;
      lastClick = { url: target.href, at: now };
      var host = target.hostname.toLowerCase();
      var isAmazon = host === "amazon.fr" || host.endsWith(".amazon.fr");
      var ids = identity(now);
      send("/track", {
        schema_version: 2,
        event_id: randomId(),
        page_path: location.pathname || "/",
        merchant_host: host,
        click_type: type === "search" ? "search" : "outbound",
        // Le tag est lu dans l'URL qui va réellement s'ouvrir.
        affiliate_tag: isAmazon ? (target.searchParams.get("tag") || "").slice(0, 30) : "",
        link_kind: linkKind(target),
        product_id: currentProductId(),
        visitor_id: ids.visitor.id,
        session_id: ids.session.id
      });
    } catch (_) {}
  }

  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    record(link.href, "outbound");
  }, true);

  var originalOpen = window.open;
  window.open = function (url) {
    if (url) record(String(url), "search");
    return originalOpen.apply(this, arguments);
  };

  // Une seule page vue par chargement de page.
  try {
    var now = Date.now();
    var ids = identity(now);
    var attribution = ids.session.attribution || detectAttribution();
    send("/view", {
      schema_version: 2,
      event_id: randomId(),
      page_path: location.pathname || "/",
      visitor_id: ids.visitor.id,
      session_id: ids.session.id,
      product_id: currentProductId(),
      source: attribution.source,
      medium: attribution.medium,
      campaign: attribution.campaign,
      // Signal informatif seulement : il peut rendre l'événement « suspect », jamais « humain ».
      signals: { webdriver: navigator.webdriver === true }
    });
  } catch (_) {}
})();

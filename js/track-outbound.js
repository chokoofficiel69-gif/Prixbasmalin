(function () {
  "use strict";
  var endpoint = "https://prixbasmalin-clicks.chokoofficiel69.workers.dev/track";
  var ownHost = location.hostname.replace(/^www\./, "");
  if (ownHost !== "prixbasmalin.fr") return;

  function record(rawUrl, type) {
    try {
      var target = new URL(rawUrl, location.href);
      if (target.protocol !== "https:" && target.protocol !== "http:") return;
      if (target.hostname.replace(/^www\./, "") === ownHost) return;
      var payload = {
        page_path: location.pathname || "/",
        merchant_host: target.hostname.toLowerCase(),
        click_type: type === "search" ? "search" : "outbound",
        affiliate_tag: (target.hostname.toLowerCase() === "amazon.fr" || target.hostname.toLowerCase().endsWith(".amazon.fr")) ? (target.searchParams.get("tag") || "").slice(0, 30) : ""
      };
      fetch(endpoint, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (_) {}
  }

  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    record(link.href, "outbound");
  }, true);


  // Mesure anonyme + attribution première source de la session, sans cookie.
  try {
    var sessionKey = "pm_analytics_session";
    var sessionId = sessionStorage.getItem(sessionKey);
    if (!sessionId) {
      sessionId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() :
        "pm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      sessionStorage.setItem(sessionKey, sessionId);
    }
    var attributionKey = "pm_traffic_attribution";
    var attribution = null;
    try { attribution = JSON.parse(sessionStorage.getItem(attributionKey) || "null"); } catch (_) {}
    if (!attribution) {
      var params = new URLSearchParams(location.search);
      var source = params.get("utm_source") || "";
      var medium = params.get("utm_medium") || "";
      var campaign = params.get("utm_campaign") || "";
      if (!source && document.referrer) {
        try { source = new URL(document.referrer).hostname.replace(/^www\./, ""); medium = "referral"; } catch (_) {}
      }
      attribution = { source: source || "direct", medium: medium || (source ? "unspecified" : "direct"), campaign: campaign || "none" };
      sessionStorage.setItem(attributionKey, JSON.stringify(attribution));
    }
    fetch("https://prixbasmalin-attribution.chokoofficiel69.workers.dev/view", {
      method: "POST", mode: "cors", credentials: "omit", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_path: location.pathname || "/", visitor_id: sessionId, source: attribution.source, medium: attribution.medium, campaign: attribution.campaign })
    }).catch(function () {});
    // L'ancien endpoint reste actif pour conserver les statistiques historiques.
    fetch(endpoint.replace(/\/track$/, "/view"), {
      method: "POST", mode: "cors", credentials: "omit", keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_path: location.pathname || "/", visitor_id: sessionId })
    }).catch(function () {});
  } catch (_) {}

  var originalOpen = window.open;
  window.open = function (url) {
    if (url) record(String(url), "search");
    return originalOpen.apply(this, arguments);
  };
})();
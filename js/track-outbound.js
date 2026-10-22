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
        click_type: type === "search" ? "search" : "outbound"
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

  var originalOpen = window.open;
  window.open = function (url) {
    if (url) record(String(url), "search");
    return originalOpen.apply(this, arguments);
  };
})();
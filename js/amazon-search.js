/* Prix Malin — centralised Amazon search URL configuration.
 * Current default matches the existing catalogue behaviour. Keep disabled
 * affiliate tag changes behind an explicit approved configuration.
 */
(() => {
  "use strict";
  const AMAZON_SEARCH_CONFIG = Object.freeze({
    origin: "https://www.amazon.fr/s",
    tag: "", // do not add a tag on flows that currently have no tag
    defaultAffiliateTag: "prixbasmalin2-21",
    affiliateTagEnabled: false
  });

  function amazonSearchUrl(query, { affiliate = false } = {}) {
    const url = new URL(AMAZON_SEARCH_CONFIG.origin);
    url.searchParams.set("k", String(query || "").trim());
    if (affiliate && AMAZON_SEARCH_CONFIG.affiliateTagEnabled && AMAZON_SEARCH_CONFIG.defaultAffiliateTag) {
      url.searchParams.set("tag", AMAZON_SEARCH_CONFIG.defaultAffiliateTag);
    }
    return url.href;
  }

  window.PrixMalinAmazon = Object.freeze({ config: AMAZON_SEARCH_CONFIG, searchUrl: amazonSearchUrl });
})();

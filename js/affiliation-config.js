/* Prix Malin — architecture préparatoire des liens marchands.
 * Aucun prix n'est fourni ici. Les modèles d'URL doivent être remplacés ou
 * complétés uniquement par des URL officielles et des liens de suivi délivrés
 * par le programme après acceptation. Ce module ne collecte aucune donnée.
 */
(() => {
  "use strict";

  const CONFIG = Object.freeze({
    merchantName: "Cdiscount",
    status: "template_only",
    attribution: {
      network: "Awin",
      approved: false,
      publisherId: null,
      advertiserId: null
    },
    // Les URL de recherche/produit doivent être définies après validation
    // par le programme ; ne pas fabriquer d'URL de tracking.
    urls: {
      searchTemplate: null,
      productTrackingTemplate: null
    }
  });

  function buildSearchUrl(query) {
    const cleaned = typeof query === "string" ? query.trim() : "";
    if (!cleaned) throw new TypeError("Une recherche non vide est requise.");
    if (!CONFIG.attribution.approved || !CONFIG.urls.searchTemplate) {
      throw new Error("Cdiscount n'est pas encore configuré : valider le programme et ses URL officielles.");
    }
    // La forme exacte dépend des gabarits fournis par le réseau / marchand.
    return CONFIG.urls.searchTemplate.replace("{query}", encodeURIComponent(cleaned));
  }

  function buildProductTrackingUrl(productUrl) {
    if (!CONFIG.attribution.approved || !CONFIG.urls.productTrackingTemplate) {
      throw new Error("Aucun lien de suivi Cdiscount autorisé n'est configuré.");
    }
    let url;
    try { url = new URL(productUrl); } catch (_) { throw new TypeError("URL de produit invalide."); }
    if (url.protocol !== "https:") throw new TypeError("Seules les URL HTTPS sont autorisées.");
    return CONFIG.urls.productTrackingTemplate.replace("{url}", encodeURIComponent(url.href));
  }

  window.PrixMalinCdiscount = Object.freeze({
    config: CONFIG,
    buildSearchUrl,
    buildProductTrackingUrl
  });
})();

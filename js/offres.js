/* Prix Malin: public client for the normalized offers file.
 * No credentials or merchant scraping run in this file.
 */
(() => {
  "use strict";
  const FEED_URL = "data/offres-exemple.json";
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  function euro(value) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
  }

  function parseDate(value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }

  function validateOffer(offer) {
    if (!offer || typeof offer !== "object") return false;
    if (!offer.product_name || !offer.merchant_name || !offer.source) return false;
    if (typeof offer.price !== "number" || !Number.isFinite(offer.price) || offer.price < 0) return false;
    if (offer.currency !== "EUR") return false;
    if (typeof offer.product_url !== "string" || !offer.product_url.startsWith("https://")) return false;
    if (offer.tracking_url != null && (typeof offer.tracking_url !== "string" || !offer.tracking_url.startsWith("https://"))) return false;
    if (!parseDate(offer.last_updated)) return false;
    if (!["new", "used", "refurbished", "unknown"].includes(offer.condition)) return false;
    if (offer.shipping_price != null && (typeof offer.shipping_price !== "number" || !Number.isFinite(offer.shipping_price) || offer.shipping_price < 0)) return false;
    if (offer.total_price != null && (typeof offer.total_price !== "number" || !Number.isFinite(offer.total_price) || offer.total_price < 0)) return false;
    return true;
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function groupOffers(offers) {
    const groups = new Map();
    for (const offer of offers) {
      // Only group by an explicit partner-supplied product group identifier,
      // never by fuzzy title matching that could mix variants.
      const groupId = typeof offer.product_group_id === "string" && offer.product_group_id.trim()
        ? offer.product_group_id.trim()
        : null;
      if (!groupId) continue;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(offer);
    }
    return [...groups.entries()].map(([groupId, entries]) => ({
      groupId,
      offers: entries.sort((a, b) => {
        const at = a.total_price;
        const bt = b.total_price;
        if (typeof at === "number" && typeof bt === "number") return at - bt;
        if (typeof at === "number") return -1;
        if (typeof bt === "number") return 1;
        return a.merchant_name.localeCompare(b.merchant_name, "fr");
      })
    }));
  }

  async function load() {
    const target = document.querySelector("[data-price-offers]");
    if (!target) return;
    try {
      const response = await fetch(FEED_URL, { cache: "no-store", headers: { "Accept": "application/json" } });
      if (!response.ok) throw new Error("Le fichier d'offres n'est pas disponible.");
      const data = await response.json();
      if (!data || !Array.isArray(data.offers)) throw new Error("Format de données incorrect.");
      const generatedAt = data.generated_at ? parseDate(data.generated_at) : null;
      if (!generatedAt) {
        target.textContent = "Comparaison automatique en préparation : aucun flux de prix vérifié n'est connecté.";
        return;
      }
      if (Date.now() - generatedAt > MAX_AGE_MS || generatedAt > Date.now() + 5 * 60 * 1000) {
        target.textContent = "Les données de comparaison ne sont pas assez récentes. Vérifiez directement chez le vendeur.";
        return;
      }
      const valid = data.offers.filter(validateOffer);
      if (!valid.length) {
        target.textContent = "Aucune offre vérifiable n'est disponible pour le moment.";
        return;
      }
      const groups = groupOffers(valid);
      target.replaceChildren();
      if (!groups.length) {
        target.textContent = "Les offres sont reçues, mais aucun produit commun à plusieurs marchands n'est identifié.";
        return;
      }
      for (const group of groups) {
        const article = document.createElement("article");
        article.className = "offer-group";
        const title = document.createElement("h3");
        title.textContent = group.offers[0].product_name;
        article.append(title);
        const list = document.createElement("ul");
        list.className = "offer-list";
        for (const offer of group.offers) {
          const li = document.createElement("li");
          const merchant = document.createElement("strong");
          merchant.textContent = offer.merchant_name;
          const price = document.createElement("span");
          price.textContent = euro(offer.price);
          const shipping = document.createElement("span");
          shipping.textContent = offer.shipping_price == null ? "Livraison à confirmer" : "Livraison : " + euro(offer.shipping_price);
          const last = document.createElement("small");
          last.textContent = "Mis à jour : " + new Date(offer.last_updated).toLocaleString("fr-FR");
          const link = document.createElement("a");
          link.href = safeHttpsUrl(offer.tracking_url || offer.product_url) || safeHttpsUrl(offer.product_url) || "#";
          link.textContent = "Voir chez le marchand";
          link.target = "_blank";
          link.rel = offer.tracking_url ? "sponsored noopener noreferrer" : "noopener noreferrer";
          li.append(merchant, price, shipping, last, link);
          if (typeof offer.total_price !== "number") {
            const note = document.createElement("small");
            note.textContent = "Prix total non classé : coût de livraison total non confirmé.";
            li.append(note);
          } else {
            const total = document.createElement("small");
            total.textContent = "Total connu : " + euro(offer.total_price);
            li.append(total);
          }
          list.append(li);
        }
        article.append(list);
        target.append(article);
      }
    } catch (error) {
      target.textContent = "Impossible de charger les offres pour le moment. Consultez directement les vendeurs.";
    }
  }

  document.addEventListener("DOMContentLoaded", load);
})();

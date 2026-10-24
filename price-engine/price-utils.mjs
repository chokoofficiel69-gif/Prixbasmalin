import {isIP} from "node:net";
// Utilitaires partagés et testables du moteur de prix.
export function parsePrice(value) {
  if (value == null) return null;
  let s = String(value).trim().replace(/[\s\u00a0\u202f€]/g, "");
  if (!/^-?\d[\d.,]*$/.test(s)) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function secureUrl(value, base) {
  try { const url = new URL(value, base); return url.protocol === "https:" ? url.href : null; }
  catch { return null; }
}
export function isSafeMerchantUrl(value) {
  const normalized = secureUrl(value);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    const hostForIpCheck = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
    if (isIP(hostForIpCheck) !== 0) return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
    if (url.username || url.password || (url.port && url.port !== "443")) return false;
    return true;
  } catch { return false; }
}
export function resolveSafeRedirect(location, currentUrl) {
  if (typeof location !== "string" || !location.trim()) return null;
  const resolved = secureUrl(location, currentUrl);
  return resolved && isSafeMerchantUrl(resolved) ? resolved : null;
}
function normalizeProductName(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
export function matchesProductIdentity(node, product) {
  const productGtins = [node?.gtin13, node?.gtin, node?.gtin12, node?.gtin14].filter(v => v != null).map(String);
  if (product?.ean && productGtins.length && !productGtins.includes(String(product.ean))) return false;
  if (product?.ean && productGtins.includes(String(product.ean))) return true;
  const actual = normalizeProductName(node?.name);
  const expected = normalizeProductName(product?.name);
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  const terms = Array.isArray(product?.match_terms) ? product.match_terms.map(normalizeProductName).filter(Boolean) : [];
  return terms.length > 0 && terms.every(term => actual.includes(term));
}
function normalizeRetailer(value) { return typeof value === "string" ? value.trim().toLocaleLowerCase("fr") : ""; }
export function mergeFreshAndStaleOffers(freshOffers, previousOffers, configuredProducts) {
  const configured = new Map();
  for (const product of configuredProducts) {
    if (!product?.id) continue;
    configured.set(product.id, new Set((Array.isArray(product.sources) ? product.sources : []).map(source => normalizeRetailer(source?.retailer)).filter(Boolean)));
  }
  const freshKeys = new Set(freshOffers.map(offer => JSON.stringify([offer.product_id, normalizeRetailer(offer.retailer)])));
  const merged = [...freshOffers];
  for (const oldOffer of previousOffers) {
    const retailerKey = normalizeRetailer(oldOffer?.retailer);
    const retailers = configured.get(oldOffer?.product_id);
    if (!retailers || !retailerKey || !retailers.has(retailerKey)) continue;
    if (freshKeys.has(JSON.stringify([oldOffer.product_id, retailerKey]))) continue;
    merged.push({...oldOffer, stale:true, comparison_note:"Dernier prix connu : actualisation échouée, vérifier chez le marchand"});
  }
  return merged;
}
export function parseExplicitEuroOffer(offer) {
  const currency = String(offer?.priceCurrency ?? offer?.priceSpecification?.priceCurrency ?? "").toUpperCase();
  if (currency !== "EUR") return null;
  const price = parsePrice(offer?.price ?? offer?.priceSpecification?.price);
  return price === null ? null : {price, currency};
}
export function extractShippingFromJsonLd(offerNode) {
  const details = offerNode?.shippingDetails;
  if (!details) return null;
  const list = Array.isArray(details) ? details : [details];
  for (const detail of list) {
    const rate = detail?.shippingRate;
    if (rate?.value == null) continue;
    const currency = String(rate.currency ?? rate.priceCurrency ?? "").toUpperCase();
    if (currency && currency !== "EUR") continue;
    const value = parsePrice(rate.value);
    if (value !== null) return Math.round(value * 100) / 100;
  }
  return null;
}
export function markOffersStale(offers, reason) {
  return offers.map(offer => ({...offer, stale:true, comparison_note:reason}));
}
function flattenJsonLd(value, out = []) {
  if (Array.isArray(value)) value.forEach(item => flattenJsonLd(item, out));
  else if (value && typeof value === "object") {
    out.push(value);
    if (value["@graph"]) flattenJsonLd(value["@graph"], out);
    if (value.mainEntity) flattenJsonLd(value.mainEntity, out);
  }
  return out;
}
export function extractOfferFromJsonLd(value, product, retailer, responseUrl, checkedAt) {
  for (const node of flattenJsonLd(value)) {
    const type = node["@type"];
    if (!(type === "Product" || (Array.isArray(type) && type.includes("Product")))) continue;
    if (!matchesProductIdentity(node, product)) continue;
    const rawOffers = Array.isArray(node.offers) ? node.offers : [node.offers];
    for (const raw of rawOffers) {
      if (!raw) continue;
      const offerType = raw["@type"];
      if (offerType === "AggregateOffer" || (Array.isArray(offerType) && offerType.includes("AggregateOffer"))) continue;
      const availability = String(raw.availability ?? "");
      if (/OutOfStock|SoldOut|Discontinued|PreOrder/i.test(availability)) continue;
      const parsedOffer = parseExplicitEuroOffer(raw);
      const productUrl = secureUrl(raw.url ?? node.url ?? responseUrl, responseUrl);
      if (!parsedOffer || !productUrl) continue;
      const shippingCost = extractShippingFromJsonLd(raw);
      return {
        product_id:product.id, product_name:product.name, ean:product.ean ?? null, retailer,
        price_eur:Math.round(parsedOffer.price * 100) / 100, currency:"EUR",
        shipping_cost:shippingCost, shipping_price_eur:shippingCost,
        total_price_eur:shippingCost === null ? null : Math.round((parsedOffer.price + shippingCost) * 100) / 100,
        availability:availability.includes("InStock") ? "in_stock" : availability.includes("OutOfStock") ? "out_of_stock" : "unknown",
        product_url:productUrl, checked_at:checkedAt, verified_at:checkedAt, verification_status:"verified_json_ld",
        source:"public_json_ld",
        comparison_note:shippingCost === null ? "Livraison non incluse : frais non confirmés" : "Livraison explicitement présente dans les données structurées"
      };
    }
  }
  return null;
}
export function isOfferCurrent(offer, now = Date.now(), maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!offer || offer.stale) return false;
  const checkedAt = Date.parse(offer.verified_at ?? offer.checked_at ?? "");
  if (!Number.isFinite(checkedAt)) return false;
  const age = now - checkedAt;
  return age >= -5 * 60 * 1000 && age <= maxAgeMs;
}

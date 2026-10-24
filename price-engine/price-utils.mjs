// Utilitaires partagés et testables du moteur de prix.
export function parsePrice(value) {
  if (value == null) return null;
  let s = String(value).trim().replace(/[\s\u00a0\u202f€]/g, "").replace(/[^0-9,.-]/g, "");
  if (!s || s === "-" || s === "." || s === ",") return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function secureUrl(value, base) {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeProductName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Ne retient que le produit explicitement nommé, ou les fiches validées
// par des termes distinctifs configurés pour ce produit. Échec = pas d'offre.
export function matchesProductIdentity(node, product) {
  const actual = normalizeProductName(node?.name);
  const expected = normalizeProductName(product?.name);
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  const terms = Array.isArray(product?.match_terms)
    ? product.match_terms.map(normalizeProductName).filter(Boolean)
    : [];
  return terms.length > 0 && terms.every(term => actual.includes(term));
}

export function mergeFreshAndStaleOffers(freshOffers, previousOffers, configuredProducts) {
  const configured = new Map();
  for (const product of configuredProducts) {
    if (!product?.id) continue;
    configured.set(product.id, new Set(
      (Array.isArray(product.sources) ? product.sources : [])
        .map(source => source?.retailer)
        .filter(retailer => typeof retailer === "string" && retailer.trim())
    ));
  }
  const freshKeys = new Set(
    freshOffers.map(offer => JSON.stringify([offer.product_id, offer.retailer]))
  );
  const merged = [...freshOffers];
  for (const oldOffer of previousOffers) {
    const retailers = configured.get(oldOffer?.product_id);
    if (!retailers || !retailers.has(oldOffer?.retailer)) continue;
    const key = JSON.stringify([oldOffer.product_id, oldOffer.retailer]);
    if (freshKeys.has(key)) continue;
    merged.push({
      ...oldOffer,
      stale: true,
      comparison_note: "Dernier prix connu : actualisation échouée, vérifier chez le marchand"
    });
  }
  return merged;
}

export function parseExplicitEuroOffer(offer) {
  const currency = String(
    offer?.priceCurrency ?? offer?.priceSpecification?.priceCurrency ?? ""
  ).toUpperCase();
  if (currency !== "EUR") return null;
  const price = parsePrice(offer?.price ?? offer?.priceSpecification?.price);
  if (price === null) return null;
  return {price, currency};
}

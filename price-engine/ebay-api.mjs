const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

/** Request an application token. Keep credentials in server-side secrets only. */
export async function getEbayApplicationToken({clientId, clientSecret, fetchImpl = fetch}) {
  if (!clientId || !clientSecret) throw new Error("EBAY_CLIENT_ID et EBAY_CLIENT_SECRET sont requis.");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: new URLSearchParams({grant_type:"client_credentials", scope:"https://api.ebay.com/oauth/api_scope"}),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`eBay OAuth HTTP ${response.status}`);
  const data = await response.json();
  if (typeof data.access_token !== "string" || !data.access_token) throw new Error("eBay OAuth n'a pas renvoyé de jeton.");
  return data.access_token;
}

function parseEurAmount(value) {
  if (!value || String(value.currency ?? "").toUpperCase() !== "EUR") return null;
  const amount = Number(value.value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

/** Map an eBay listing into a normalized candidate; identity still needs validation. */
export function normalizeEbayListing(item, {productId, productName, ean, checkedAt = new Date().toISOString()} = {}) {
  if (!item || typeof item !== "object") return null;
  const price = parseEurAmount(item.price);
  const url = typeof item.itemWebUrl === "string" && item.itemWebUrl.startsWith("https://") ? item.itemWebUrl : null;
  if (price === null || !url || item.itemEndDate && Date.parse(item.itemEndDate) < Date.now()) return null;
  const shippingOptions = Array.isArray(item.shippingOptions) ? item.shippingOptions : [];
  const shipping = shippingOptions.map(s => parseEurAmount(s.shippingCost)).find(v => v !== null) ?? null;
  return {
    product_id: productId,
    product_name: productName,
    ean: ean ?? null,
    retailer: "eBay",
    price_eur: price,
    currency: "EUR",
    shipping_cost: shipping,
    shipping_price_eur: shipping,
    total_price_eur: shipping === null ? null : Math.round((price + shipping) * 100) / 100,
    availability: "unknown",
    product_url: url,
    checked_at: checkedAt,
    verified_at: checkedAt,
    verification_status: "verified_ebay_api",
    source: "ebay_browse_api",
    listing_title: typeof item.title === "string" ? item.title : null,
    comparison_note: shipping === null ? "Frais de livraison non confirmés par l’API" : "Prix et livraison lus dans l’API eBay"
  };
}

/** Search by GTIN via eBay Browse API. Requires approved application credentials. */
export async function searchEbayByGtin({gtin, productId, productName, clientId, clientSecret, affiliateCampaignId, fetchImpl = fetch, checkedAt = new Date().toISOString()}) {
  if (!/^\d{8,14}$/.test(String(gtin ?? ""))) throw new Error("GTIN invalide.");
  const token = await getEbayApplicationToken({clientId, clientSecret, fetchImpl});
  const url = new URL(SEARCH_URL);
  url.searchParams.set("gtin", String(gtin));
  url.searchParams.set("limit", "50");
  const headers = {authorization:`Bearer ${token}`, accept:"application/json", "X-EBAY-C-MARKETPLACE-ID":"EBAY_FR"};
  if (affiliateCampaignId && /^\d{10}$/.test(affiliateCampaignId)) {
    headers["X-EBAY-C-ENDUSERCTX"] = `affiliateCampaignId=${affiliateCampaignId}`;
  }
  const response = await fetchImpl(url, {headers, signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`eBay Browse API HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
  return rows.map(item => normalizeEbayListing(item, {productId, productName, ean:gtin, checkedAt})).filter(Boolean);
}

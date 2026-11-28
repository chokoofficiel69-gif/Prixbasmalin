import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "tradedoubler-products.json");
const STATE = path.join(ROOT, "data", "tradedoubler-feed-state.json");
const TOKEN = String(process.env.TRADEDOUBLER_PRODUCTS_TOKEN || "").trim();
const API = "https://api.tradedoubler.com/1.0";
const MAX_FEEDS = Number(process.env.TRADEDOUBLER_MAX_FEEDS || 100);
const TIMEOUT_MS = 60000;

function fail(message) { throw new Error(message); }
function validFeed(feed) {
  return feed && feed.active === true && feed.visible !== false &&
    String(feed.languageISOCode || "").toLowerCase() === "fr" &&
    String(feed.currencyISOCode || "").toUpperCase() === "EUR" &&
    Number.isInteger(Number(feed.feedId));
}
function isoDate(value) {
  if (value == null || value === "") return null;
  const d = typeof value === "number" || /^\d+$/.test(String(value))
    ? new Date(Number(value)) : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function price(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
function shipping(value) {
  const raw = String(value ?? "").trim();
  if (/^(free|gratuit|offert|0(?:[.,]0+)?)(?:\s*(?:eur|€))?$/i.test(raw)) return 0;
  return price(raw.replace(/\s*€|\s*EUR/ig, ""));
}
function productsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.result?.products)) return payload.result.products;
  return [];
}
export function appendPreviousFeedOffers(collected, oldByFeed, feedId) {
  const previous = oldByFeed.get(Number(feedId)) || [];
  collected.push(...previous);
  return previous.length;
}
function normalizeProduct(product, feed, now) {
  const offers = Array.isArray(product?.offers) ? product.offers : [];
  return offers.map(offer => {
    const value = price(offer?.price?.value ?? offer?.price ?? product?.price);
    const ean = String(product?.identifiers?.ean ?? product?.ean ?? "").replace(/\D/g, "");
    const modified = isoDate(offer?.modified ?? product?.modified);
    const url = String(offer?.productUrl ?? product?.productUrl ?? "");
    const image = String(product?.productImage?.url ?? product?.productImage ?? "");
    if (!value || !/^https:\/\//i.test(url)) return null;
    return {
      source: "tradedoubler",
      feed_id: Number(feed.feedId),
      program_name: String(offer?.programName || feed.name || ""),
      merchant: String(offer?.programName || feed.name || ""),
      product_id: String(product?.id || ""),
      source_product_id: String(offer?.sourceProductId || product?.sourceProductId || ""),
      name: String(product?.name || ""),
      brand: String(product?.brand || product?.manufacturer || ""),
      ean: /^\d{8,14}$/.test(ean) ? ean : "",
      mpn: String(product?.identifiers?.mpn || ""),
      price_eur: value,
      shipping_price_eur: shipping(offer?.shippingCost),
      currency: "EUR",
      availability: String(offer?.availability || product?.availability || "unknown"),
      modified_at: modified,
      fetched_at: now,
      product_url: url,
      source_product_url: String(offer?.sourceProductUrl || product?.sourceProductUrl || ""),
      image: /^https:\/\//i.test(image) ? image : "",
      price_history: Array.isArray(offer?.priceHistory) ? offer.priceHistory.map(item => ({
        price_eur: price(item?.price?.value ?? item?.price),
        changed_at: isoDate(item?.date)
      })).filter(item => item.price_eur && item.changed_at) : []
    };
  }).filter(Boolean);
}
async function requestJson(url, label) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) fail(label + " : HTTP " + response.status);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("json")) fail(label + " : réponse non JSON");
  return response.json();
}
async function main() {
  if (!TOKEN) fail("Secret TRADEDOUBLER_PRODUCTS_TOKEN absent. Aucun accès tenté.");
  if (!/^[a-f0-9]{40}$/i.test(TOKEN)) fail("Format du jeton Tradedoubler invalide ; valeur masquée.");
  const feedsPayload = await requestJson(API + "/productFeeds?token=" + encodeURIComponent(TOKEN), "Liste des flux");
  const feeds = (Array.isArray(feedsPayload?.feeds) ? feedsPayload.feeds : [])
    .filter(validFeed).slice(0, MAX_FEEDS);
  if (!feeds.length) fail("Aucun flux actif, visible, français et EUR accessible au compte.");
  let previous;
  try {
    previous = JSON.parse(await fs.readFile(OUT, "utf8"));
    if (!previous || !Array.isArray(previous.offers)) fail("Snapshot Tradedoubler existant invalide.");
  } catch (error) {
    if (error?.code === "ENOENT") previous = { schema_version: 1, offers: [] };
    else fail("Snapshot Tradedoubler existant illisible ; aucun écrasement effectué.");
  }
  const state = await fs.readFile(STATE, "utf8").then(JSON.parse).catch(() => ({ feeds: {} }));
  const oldByFeed = new Map();
  for (const offer of Array.isArray(previous.offers) ? previous.offers : []) {
    const id = Number(offer.feed_id);
    if (!oldByFeed.has(id)) oldByFeed.set(id, []);
    oldByFeed.get(id).push(offer);
  }
  const nextState = { ...(state.feeds || {}) };
  const collected = [];
  const updated = [];
  const skipped = [];
  const now = new Date().toISOString();
  for (const feed of feeds) {
    const id = Number(feed.feedId);
    const last = await requestJson(API + "/productsUnlimited/lastUpdated.json;fid=" + id + "?token=" + encodeURIComponent(TOKEN), "Date de flux " + id);
    const lastUpdated = String(last?.lastUpdatedTime || "");
    if (!lastUpdated || !Number.isFinite(Date.parse(lastUpdated))) {
      const preserved = appendPreviousFeedOffers(collected, oldByFeed, id);
      skipped.push({ feed_id: id, reason: "date de mise à jour absente ou illisible ; ancien snapshot conservé", preserved_offers: preserved });
      continue;
    }
    if (nextState[id]?.last_updated === lastUpdated && oldByFeed.has(id)) {
      appendPreviousFeedOffers(collected, oldByFeed, id);
      skipped.push({ feed_id: id, reason: "flux inchangé" });
      continue;
    }
    const payload = await requestJson(API + "/productsUnlimited.json;fid=" + id + "?sourceproducturl=true&token=" + encodeURIComponent(TOKEN), "Téléchargement du flux " + id);
    const products = productsFrom(payload);
    if (!products.length) {
      skipped.push({ feed_id: id, reason: "flux vide ou format inattendu ; ancien snapshot conservé" });
      appendPreviousFeedOffers(collected, oldByFeed, id);
      continue;
    }
    const normalized = products.flatMap(product => normalizeProduct(product, feed, now));
    if (!normalized.length) {
      skipped.push({ feed_id: id, reason: "aucune offre HTTPS exploitable ; ancien snapshot conservé" });
      if (oldByFeed.has(id)) collected.push(...oldByFeed.get(id));
      continue;
    }
    collected.push(...normalized);
    nextState[id] = { last_updated: lastUpdated, checked_at: now, product_count: products.length, offer_count: normalized.length, feed_name: String(feed.name || "") };
    updated.push({ feed_id: id, feed_name: String(feed.name || ""), products: products.length, offers: normalized.length });
  }
  if (!collected.length) fail("Aucune offre exploitable. Aucun snapshot vide ne sera publié.");
  const output = {
    schema_version: 1,
    status: "ok",
    source: "Tradedoubler Products API — flux actifs français EUR accessibles au compte éditeur",
    fetched_at: now,
    counts: { feeds_considered: feeds.length, feeds_updated: updated.length, offers: collected.length, offers_with_ean: collected.filter(x => x.ean).length, offers_with_modified_date: collected.filter(x => x.modified_at).length },
    updated_feeds: updated,
    skipped_feeds: skipped,
    offers: collected
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT + ".tmp", JSON.stringify(output, null, 2) + "\n");
  await fs.rename(OUT + ".tmp", OUT);
  await fs.writeFile(STATE + ".tmp", JSON.stringify({ schema_version: 1, feeds: nextState }, null, 2) + "\n");
  await fs.rename(STATE + ".tmp", STATE);
  console.log("Tradedoubler : " + updated.length + " flux actualisés ; " + collected.length + " offres conservées ; " + output.counts.offers_with_ean + " offres avec EAN.");
  for (const item of skipped) console.log("Flux " + item.feed_id + " : " + item.reason);
}
if (process.argv[1] && import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error("Import Tradedoubler bloqué :", error.message); process.exitCode = 1; });
}

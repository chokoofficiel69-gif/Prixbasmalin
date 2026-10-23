import fs from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const CONFIG = new URL("./products.json", import.meta.url);
const OUTPUT = new URL("../data/prices.json", import.meta.url);
const now = new Date().toISOString();
const config = JSON.parse(await fs.readFile(CONFIG, "utf8"));
if (!Array.isArray(config.products) || config.products.length === 0) {
  console.log("Aucune source produit configurée : relevé existant conservé, aucun prix remplacé.");
  process.exit(0);
}
const previous = await fs.readFile(OUTPUT, "utf8").then(JSON.parse).catch(() => ({version:1,offers:[]}));
const offers = [];
const errors = [];

function flattenJsonLd(value, out = []) {
  if (Array.isArray(value)) value.forEach(v => flattenJsonLd(v, out));
  else if (value && typeof value === "object") {
    out.push(value);
    if (value["@graph"]) flattenJsonLd(value["@graph"], out);
  }
  return out;
}
function parsePrice(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/\s/g,"").replace(",",".").replace(/[^0-9.]/g,""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function absoluteUrl(v, base) { try { return new URL(v, base).href; } catch { return null; } }

for (const product of config.products ?? []) {
  for (const source of product.sources ?? []) {
    if (!source.url || !/^https?:\/\//i.test(source.url)) continue;
    try {
      const response = await fetch(source.url, {
        headers: {"user-agent":"PrixMalinPriceBot/1.0 (+https://prixbasmalin.fr; public product price monitoring)","accept":"text/html,application/xhtml+xml"},
        signal: AbortSignal.timeout(12000),
        redirect:"follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      let found = null;
      for (const block of blocks) {
        try {
          const nodes = flattenJsonLd(JSON.parse(block[1]));
          for (const node of nodes) {
            const type = node["@type"];
            if (!(type === "Product" || (Array.isArray(type) && type.includes("Product")))) continue;
            const rawOffers = Array.isArray(node.offers) ? node.offers : [node.offers];
            for (const raw of rawOffers) {
              if (!raw) continue;
              const price = parsePrice(raw.price ?? raw.lowPrice ?? raw.priceSpecification?.price);
              const currency = raw.priceCurrency ?? raw.priceSpecification?.priceCurrency ?? "EUR";
              if (price && currency === "EUR") {
                found = {
                  product_id: product.id,
                  product_name: product.name,
                  retailer: source.retailer,
                  price_eur: Math.round(price * 100) / 100,
                  currency:"EUR",
                  availability: String(raw.availability ?? "").includes("InStock") ? "in_stock" : String(raw.availability ?? "").includes("OutOfStock") ? "out_of_stock" : "unknown",
                  product_url: absoluteUrl(raw.url ?? node.url ?? source.url, source.url),
                  checked_at: now,
                  source:"public_json_ld"
                };
                break;
              }
            }
            if (found) break;
          }
        } catch {}
        if (found) break;
      }
      if (found) offers.push(found);
      else errors.push({product_id:product.id,retailer:source.retailer,url:source.url,reason:"Prix EUR absent des données structurées publiques"});
    } catch (error) {
      errors.push({product_id:product.id,retailer:source.retailer,url:source.url,reason:String(error.message ?? error).slice(0,180)});
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}
const productIds = [...new Set((config.products ?? []).map(p => p.id))];
const output = {
  version:1,
  generated_at:now,
  schedule:"toutes les 10 heures",
  methodology:"Prix lus dans les données structurées publiques Product/Offer des pages marchands. Aucune estimation ni prix inventé.",
  products:productIds.map(id => {
    const product = config.products.find(p => p.id === id);
    const rows = offers.filter(o => o.product_id === id).sort((a,b) => a.price_eur - b.price_eur);
    return {id,name:product.name,offers:rows,best_price_eur:rows[0]?.price_eur ?? null,offer_count:rows.length};
  }),
  offers,
  errors,
  previous_generated_at:previous.generated_at ?? null
};
await fs.mkdir(new URL("../data/", import.meta.url), {recursive:true});
await fs.writeFile(OUTPUT, JSON.stringify(output,null,2)+"\n");
console.log(`Prix lus: ${offers.length}; sources sans prix/erreurs: ${errors.length}; produits suivis: ${productIds.length}`);

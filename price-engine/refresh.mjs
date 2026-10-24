import fs from "node:fs/promises";

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
    if (value.mainEntity) flattenJsonLd(value.mainEntity, out);
  }
  return out;
}

// Accepte les formats français (1 299,99), anglais (1,299.99) et décimaux simples.
function parsePrice(value) {
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
function secureUrl(value, base) {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

for (const product of config.products) {
  if (!product?.id || !product?.name || !Array.isArray(product.sources)) {
    errors.push({product_id: product?.id ?? null, reason:"Configuration produit invalide"});
    continue;
  }
  for (const source of product.sources) {
    const sourceUrl = secureUrl(source?.url, source?.url);
    if (!sourceUrl || !source?.retailer) {
      errors.push({product_id:product.id,retailer:source?.retailer ?? null,reason:"Source HTTPS ou nom du marchand manquant"});
      continue;
    }
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          "user-agent":"PrixMalinPriceBot/1.0 (+https://prixbasmalin.fr; public product price monitoring)",
          "accept":"text/html,application/xhtml+xml"
        },
        signal:AbortSignal.timeout(12000),
        redirect:"follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (new URL(response.url).protocol !== "https:") throw new Error("Redirection non HTTPS refusée");
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
              const productUrl = secureUrl(raw.url ?? node.url ?? response.url, response.url);
              if (price !== null && currency === "EUR" && productUrl) {
                found = {
                  product_id:product.id,
                  product_name:product.name,
                  retailer:source.retailer,
                  price_eur:Math.round(price * 100) / 100,
                  currency:"EUR",
                  shipping_price_eur:null,
                  total_price_eur:null,
                  availability:String(raw.availability ?? "").includes("InStock") ? "in_stock" : String(raw.availability ?? "").includes("OutOfStock") ? "out_of_stock" : "unknown",
                  product_url:productUrl,
                  checked_at:now,
                  source:"public_json_ld",
                  comparison_note:"Livraison non incluse : frais non confirmés"
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
      else errors.push({product_id:product.id,retailer:source.retailer,url:sourceUrl,reason:"Prix EUR absent des données structurées publiques"});
    } catch (error) {
      errors.push({product_id:product.id,retailer:source.retailer,url:sourceUrl,reason:String(error.message ?? error).slice(0,180)});
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}

// Ne jamais remplacer un relevé existant par un tableau vide si tous les marchands échouent.
if (offers.length === 0) {
  console.error(`Aucune offre valide récupérée; relevé précédent conservé. Erreurs: ${errors.length}`);
  process.exitCode = 1;
} else {
  const productIds = [...new Set(config.products.map(p => p.id))];
  const output = {
    version:1,
    generated_at:now,
    schedule:"vérification automatique toutes les heures (si des sources sont configurées)",
    methodology:"Prix lus dans les données structurées publiques Product/Offer. Frais de livraison inconnus exclus du prix; aucune estimation ni prix inventé.",
    products:productIds.map(id => {
      const product = config.products.find(p => p.id === id);
      const rows = offers.filter(o => o.product_id === id).sort((a,b) => a.price_eur - b.price_eur);
      const freshRows = rows.filter(o => !o.stale);
      const best = (freshRows.length ? freshRows : rows)[0];
      return {id,name:product.name,offers:rows,best_price_eur:best?.price_eur ?? null,offer_count:rows.length,has_fresh_offer:freshRows.length>0};
    }),
    offers,
    errors,
    previous_generated_at:previous.generated_at ?? null
  };
  await fs.mkdir(new URL("../data/", import.meta.url), {recursive:true});
  await fs.writeFile(OUTPUT, JSON.stringify(output,null,2)+"\n");
  console.log(`Prix lus: ${offers.length}; sources sans prix/erreurs: ${errors.length}; produits suivis: ${productIds.length}`);
}

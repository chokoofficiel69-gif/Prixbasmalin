import fs from "node:fs/promises";
import {secureUrl, isSafeMerchantUrl, resolveSafeRedirect, extractOfferFromJsonLd, mergeFreshAndStaleOffers, markOffersStale} from "./price-utils.mjs";

const CONFIG = new URL("./products.json", import.meta.url);
const OUTPUT = new URL("../data/prices.json", import.meta.url);
const now = new Date().toISOString();
const config = JSON.parse(await fs.readFile(CONFIG, "utf8"));
const quality = {generated_at:now, sources:{}, global:{products_configured:0,offers_verified:0,offers_stale:0,coverage_rate:0}};
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  const retryStatuses = new Set([429,500,502,503,504]);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, options);
    if (!retryStatuses.has(response.status) || attempt >= maxRetries) return response;
    const delayMs = 1000 * (2 ** attempt);
    console.warn(`HTTP ${response.status} pour ${new URL(url).hostname}; nouvelle tentative dans ${delayMs} ms (${attempt + 1}/${maxRetries})`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}
function sourceStats(retailer) {
  if (!quality.sources[retailer]) quality.sources[retailer] = {attempts:0,success:0,failures:0,last_success_at:null,products_without_offer:[]};
  return quality.sources[retailer];
}
async function writeQuality(offers, products, errors) {
  quality.global.products_configured = products.length;
  quality.global.offers_verified = offers.filter(o => !o.stale && o.verification_status === "verified_json_ld").length;
  quality.global.offers_stale = offers.filter(o => o.stale).length;
  quality.global.coverage_rate = products.length ? Number((new Set(offers.filter(o => !o.stale).map(o => o.product_id)).size / products.length).toFixed(4)) : 0;
  for (const error of errors) {
    if (!error.retailer) continue;
    const stats = sourceStats(error.retailer);
    if (error.reason?.includes("Prix EUR absent")) stats.products_without_offer.push(error.product_id);
  }
  await fs.mkdir(new URL("../data/", import.meta.url), {recursive:true});
  await fs.writeFile(new URL("../data/quality.json", import.meta.url), JSON.stringify(quality,null,2)+"\n");
}

async function fetchPublicMerchantPage(initialUrl) {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= 5; hop++) {
    if (!isSafeMerchantUrl(currentUrl)) {
      throw new Error("URL marchande non sûre : seuls les domaines publics HTTPS sont autorisés");
    }
    const response = await fetchWithRetry(currentUrl, {
      headers: {
        "user-agent":"PrixMalinPriceBot/1.0 (+https://prixbasmalin.fr; public product price monitoring)",
        "accept":"text/html,application/xhtml+xml"
      },
      signal:AbortSignal.timeout(10000),
      redirect:"manual"
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirection sans en-tête Location");
      if (hop === 5) throw new Error("Trop de redirections");
      const nextUrl = resolveSafeRedirect(location, currentUrl);
      if (!nextUrl) {
        throw new Error("Redirection vers une URL non autorisée refusée");
      }
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {response, url:currentUrl};
  }
  throw new Error("Trop de redirections");
}
if (!Array.isArray(config.products)) {
  throw new Error("Configuration invalide : products doit être un tableau.");
}

const previous = await fs.readFile(OUTPUT, "utf8").then(JSON.parse).catch(() => ({version:1,offers:[]}));

async function saveHistoricalSnapshot(snapshot, reason) {
  const previousOffers = Array.isArray(snapshot.offers) ? snapshot.offers : [];
  const staleOffers = markOffersStale(previousOffers, reason);
  const previousProducts = Array.isArray(snapshot.products) ? snapshot.products : [];
  const products = previousProducts.map(product => {
    const rows = staleOffers
      .filter(offer => offer.product_id === product.id)
      .sort((a,b) => Number(a.price_eur) - Number(b.price_eur));
    const best = rows[0];
    return {
      ...product,
      offers: rows,
      offer_count: rows.length,
      best_price_eur: best?.price_eur ?? (rows.length === 0 ? null : product.best_price_eur ?? null),
      has_fresh_offer: false
    };
  });
  const output = {
    ...snapshot,
    status: previousOffers.length ? "historical_only" : "no_sources_configured",
    generated_at: snapshot.generated_at ?? now,
    schedule: "Pas d'actualisation automatique tant que des sources marchandes ne sont pas configurées",
    methodology: previousOffers.length
      ? "Derniers prix connus conservés à titre indicatif et marqués périmés. Aucune source active, aucun nouveau prix validé."
      : "Aucun produit ni offre vérifiée configuré. Aucun prix fictif n'est généré.",
    products,
    offers: staleOffers
  };
  if (JSON.stringify(output) !== JSON.stringify(snapshot)) {
  await fs.writeFile(OUTPUT, JSON.stringify(output,null,2)+"\n");
  }
}

if (config.products.length === 0) {
  await saveHistoricalSnapshot(previous, "Aucune source configurée : dernier prix connu à revérifier chez le marchand");
  console.log("Aucune source produit configurée : prix inchangés, offres historiques marquées comme périmées.");
  process.exit(0);
}
const offers = [];
const errors = [];
const validProducts = [];
const seenProductIds = new Set();
for (const product of config.products) {
  if (!product || typeof product.id !== "string" || !product.id.trim() ||
      typeof product.name !== "string" || !product.name.trim() ||
      !Array.isArray(product.sources) || product.sources.length === 0) {
    errors.push({product_id:product?.id ?? null,reason:"Configuration produit invalide ou sans source marchande"});
    continue;
  }
  if (seenProductIds.has(product.id)) {
    errors.push({product_id:product.id,reason:"Identifiant produit dupliqué dans la configuration"});
    continue;
  }
  seenProductIds.add(product.id);
  validProducts.push(product);
}

if (validProducts.length === 0) {
  await saveHistoricalSnapshot(previous, "Configuration source invalide ou absente : dernier prix connu à revérifier");
  console.error("Aucun produit valide dans la configuration. Les anciens prix, s'il y en a, restent marqués historiques.");
  process.exit(0);
}

for (const product of validProducts) {
  for (const source of product.sources) {
    const stats = sourceStats(source?.retailer || "Marchand inconnu");
    stats.attempts++;
    const sourceUrl = secureUrl(source?.url, source?.url);
    if (!sourceUrl || !isSafeMerchantUrl(sourceUrl) || !source?.retailer) {
      errors.push({product_id:product.id,retailer:source?.retailer ?? null,reason:"Source HTTPS ou nom du marchand manquant"});
      continue;
    }
    try {
      const {response, url:finalUrl} = await fetchPublicMerchantPage(sourceUrl);
      const html = await response.text();
      const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
      let found = null;
      for (const block of blocks) {
        try {
          found = extractOfferFromJsonLd(
            JSON.parse(block[1]),
            product,
            source.retailer,
            finalUrl,
            now
          );
        } catch {}
        if (found) break;
      }
      if (found) offers.push(found);
      else errors.push({product_id:product.id,retailer:source.retailer,url:sourceUrl,reason:"Prix EUR absent des données structurées publiques"});
    } catch (error) {
      stats.failures++;
      errors.push({product_id:product.id,retailer:source.retailer,url:sourceUrl,reason:String(error.message ?? error).slice(0,180)});
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}

// Conserver séparément les dernières offres des marchands qui ont échoué.
const previousOffers = Array.isArray(previous.offers) ? previous.offers : [];
const mergedOffers = mergeFreshAndStaleOffers(offers, previousOffers, validProducts);
offers.splice(0, offers.length, ...mergedOffers);

// Si toutes les sources échouent et qu'aucune ancienne offre n'existe,
// ne pas remplacer un relevé vide par un faux relevé de succès.
if (offers.length === 0) {
  for (const error of errors) console.error(`[SOURCE_DIAGNOSTIC] ${JSON.stringify(error)}`);
  await writeQuality(offers, validProducts, errors);
  console.error(`Aucune offre valide récupérée; relevé précédent conservé. Erreurs: ${errors.length}`);
  process.exitCode = 1;
} else {
  const productIds = validProducts.map(p => p.id);
  const hasFreshOffers = offers.some(o => !o.stale);
  const output = {
    version:1,
    status:hasFreshOffers ? "fresh_offers_available" : "historical_only",
    generated_at:hasFreshOffers ? now : (previous.generated_at ?? now),
    schedule:"vérification automatique toutes les heures (si des sources sont configurées)",
    methodology:"Prix lus dans les données structurées publiques Product/Offer. Frais de livraison inconnus exclus du prix; aucune estimation ni prix inventé.",
    products:productIds.map(id => {
      const product = validProducts.find(p => p.id === id);
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

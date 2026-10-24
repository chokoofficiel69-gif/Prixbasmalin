import fs from "node:fs/promises";
import {secureUrl, extractOfferFromJsonLd, mergeFreshAndStaleOffers, markOffersStale} from "./price-utils.mjs";

const CONFIG = new URL("./products.json", import.meta.url);
const OUTPUT = new URL("../data/prices.json", import.meta.url);
const now = new Date().toISOString();
const config = JSON.parse(await fs.readFile(CONFIG, "utf8"));

const previous = await fs.readFile(OUTPUT, "utf8").then(JSON.parse).catch(() => ({version:1,offers:[]}));

async function saveHistoricalSnapshot(snapshot, reason) {
  const previousOffers = Array.isArray(snapshot.offers) ? snapshot.offers : [];
  if (previousOffers.length === 0) return;
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
      best_price_eur: best?.price_eur ?? product.best_price_eur ?? null,
      has_fresh_offer: false
    };
  });
  const output = {
    ...snapshot,
    generated_at: snapshot.generated_at ?? now,
    schedule: "Aucune source configurée : les derniers prix sont historiques",
    methodology: "Derniers prix connus conservés à titre indicatif et marqués périmés. Aucune source active, aucun nouveau prix validé.",
    products,
    offers: staleOffers
  };
  if (JSON.stringify(output) !== JSON.stringify(snapshot)) {
  await fs.writeFile(OUTPUT, JSON.stringify(output,null,2)+"\n");
  }
}

if (!Array.isArray(config.products) || config.products.length === 0) {
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
      !Array.isArray(product.sources)) {
    errors.push({product_id:product?.id ?? null,reason:"Configuration produit invalide"});
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
          found = extractOfferFromJsonLd(
            JSON.parse(block[1]),
            product,
            source.retailer,
            response.url,
            now
          );
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

// Conserver séparément les dernières offres des marchands qui ont échoué.
const previousOffers = Array.isArray(previous.offers) ? previous.offers : [];
const mergedOffers = mergeFreshAndStaleOffers(offers, previousOffers, validProducts);
offers.splice(0, offers.length, ...mergedOffers);

// Si toutes les sources échouent et qu'aucune ancienne offre n'existe,
// ne pas remplacer un relevé vide par un faux relevé de succès.
if (offers.length === 0) {
  console.error(`Aucune offre valide récupérée; relevé précédent conservé. Erreurs: ${errors.length}`);
  process.exitCode = 1;
} else {
  const productIds = validProducts.map(p => p.id);
  const output = {
    version:1,
    generated_at:offers.some(o => !o.stale) ? now : (previous.generated_at ?? now),
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

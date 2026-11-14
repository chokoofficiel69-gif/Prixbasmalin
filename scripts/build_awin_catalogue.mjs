import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = path.join(ROOT, "data", "awin-products.json");
const OUTPUT = path.join(ROOT, "data", "awin-catalogue.json");
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const VERIFIED_IMAGE_STATUSES = new Set([
  "manufacturer_verified",
  "official_press_image",
  "retailer_product_image",
  "authorized_feed_image"
]);

const PRODUCT_FIELDS = [
  "id", "name", "category", "brand", "color", "size", "product_type",
  "availability", "priceTaxStatus", "shippingPriceValue", "merchantUpdatedAt",
  "gtin", "mpn", "image", "merchant", "priceValue", "sourceUrl"
];

const OFFER_FIELDS = [
  "merchant", "priceValue", "url", "shippingPriceValue",
  "availability", "priceTaxStatus", "merchantUpdatedAt", "checked_at"
];

function pick(source, fields) {
  const output = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
      output[field] = source[field];
    }
  }
  return output;
}

function isHttps(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

export function isCatalogueImage(product) {
  const image = String(product?.image || "");
  return isHttps(image) &&
    !/unsplash\.com/i.test(image) &&
    VERIFIED_IMAGE_STATUSES.has(String(product?.imageStatus || "")) &&
    product?.imageKind !== "illustration";
}

function compactProduct(product) {
  if (!product || typeof product !== "object" ||
      !product.id || !product.name || !product.merchant ||
      !isHttps(product.sourceUrl) || !isCatalogueImage(product)) {
    return null;
  }

  const output = pick(product, PRODUCT_FIELDS);
  if (Array.isArray(product.offers)) {
    const distinctMerchants = new Set(product.offers
      .map(offer => String(offer?.merchant || "").trim().toLowerCase())
      .filter(Boolean));
    // Une offre unique est déjà représentée au niveau produit ; conserver le tableau
    // détaillé uniquement lorsqu'il apporte réellement plusieurs marchands.
    if (distinctMerchants.size > 1) {
      output.offers = product.offers.slice(0, 12)
        .filter(offer => offer && typeof offer === "object")
        .map(offer => pick(offer, OFFER_FIELDS));
    }
  }
  return output;
}

export function buildCompactFeed(feed) {
  if (!feed || feed.status !== "ok" || !feed.fetched_at || !Array.isArray(feed.products)) {
    throw new Error("Flux Awin source absent, invalide ou sans date.");
  }
  const products = feed.products.map(compactProduct).filter(Boolean);
  if (!products.length) {
    throw new Error("Aucune fiche Awin avec une image marchande vérifiée à publier.");
  }
  return {
    status: "ok",
    schema_version: 1,
    image_policy: "authorized_feed_images_only",
    fetched_at: feed.fetched_at,
    source_product_count: feed.products.length,
    products
  };
}

export function serializeCompactFeed(feed, maxBytes = MAX_OUTPUT_BYTES) {
  const data = buildCompactFeed(feed);
  const json = JSON.stringify(data);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > maxBytes) {
    throw new Error(`Flux catalogue léger trop volumineux : ${bytes} octets (limite ${maxBytes}).`);
  }
  return { data, json, bytes };
}

async function main() {
  const raw = await fs.readFile(INPUT, "utf8");
  const source = JSON.parse(raw);
  const compact = serializeCompactFeed(source);
  const temporary = OUTPUT + ".tmp";
  await fs.writeFile(temporary, compact.json + "\n", "utf8");
  await fs.rename(temporary, OUTPUT);
  const reduction = Math.round((1 - compact.bytes / Buffer.byteLength(raw, "utf8")) * 100);
  console.log(
    "Catalogue Awin navigateur :",
    compact.data.products.length, "fiches avec visuel autorisé ;",
    compact.bytes, "octets ; réduction", reduction + "%."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error("Construction du catalogue Awin léger impossible :", error.message);
    process.exitCode = 1;
  });
}

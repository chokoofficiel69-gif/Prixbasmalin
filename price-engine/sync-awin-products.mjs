import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "data", "awin-products.json");
const STATUS_OUTPUT = path.join(ROOT, "data", "awin-sync-status.json");
const TOKEN = process.env.AWIN_API_TOKEN || "";
const PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID || "3137386";
const LOCALE = process.env.AWIN_FEED_LOCALE || "fr_FR";
const MAX_PROGRAMMES = 100;
const MAX_PRODUCTS = 25000;
const MAX_PER_ADVERTISER = 3000;
const CONCURRENCY = 3;
const TIMEOUT_MS = 45000;

function log(message) { console.log("[Awin catalogue] " + message); }
function norm(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function httpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}
function parseMoney(value) {
  if (value == null) return null;
  const match = String(value).trim().match(/^([0-9]+(?:[.,][0-9]{1,2})?)\s*([A-Z]{3})$/i);
  if (!match || match[2].toUpperCase() !== "EUR") return null;
  const amount = Number(match[1].replace(",", "."));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}
function currentSalePrice(row, now) {
  const sale = parseMoney(row.sale_price);
  if (!sale) return null;
  const range = String(row.sale_price_effective_date || "").trim();
  if (!range) return sale;
  const [from, to] = range.split("/");
  const start = from ? Date.parse(from) : NaN;
  const end = to ? Date.parse(to) : NaN;
  if (Number.isFinite(start) && now < start) return null;
  if (Number.isFinite(end) && now > end) return null;
  return sale;
}
function imageList(row) {
  const extra = row.additional_image_link ?? row.additional_image_links ?? [];
  let values = Array.isArray(extra) ? extra : String(extra || "").split(/[|,;]/);
  const alternate = [row.alternate_image,row.alternate_image_two,row.alternate_image_three,row.large_image,row.aw_image_url,row.merchant_image_url];
  return [...new Set([row.image_link,row.merchant_image_url,row.large_image,row.aw_image_url,...values,...alternate].map(httpsUrl).filter(Boolean))].slice(0, 6);
}
function classifyCategory(text) {
  // Les familles explicites priment sur les mots du titre, souvent ambigus.
  if (/sport.*(sock|chaussette)|(sock|chaussette).*sport/.test(text)) return "sport";
  if (/baby|toys|toy|toys games|children|bebe|enfant|jouet|puericulture|nursery|kids/.test(text)) return "kids";
  if (/vehicle|automotive|auto|moto|car parts|car accessories|automobile/.test(text)) return "auto";
  if (/sock|chaussette|hosiery|collant|culotte|lingerie|underwear|tights|bas de |chausson|vetement|apparel|clothing|shoes|footwear|mode|chaussure|pantalon|robe|t shirt|tshirt|polo|fashion/.test(text)) return "fashion";
  if (/beauty|cosmetic|personal care|health|beaute|soin|parfum|perfume|fragrance|maquillage|makeup|skincare|cosmetique|eau de parfum|eau de toilette|shampoo|shampoing|conditioner|haircare|hair care|cheveux|capillaire|parapharmacie|supplement|nutrition|complement alimentaire|vitamin|vitamine/.test(text)) return "beauty";
  if (/home|garden|furniture|kitchen|household|maison|jardin|cuisine|bathroom|bath|salle de bain|soap|lotion dispenser|bathroom accessory|bedding|literie|decoration|deco|home decor|candle|bougie|diffuser|diffuseur|home fragrance|parfum d.?ambiance|wax melt/.test(text)) return "home";
  if (/electronics|electronic|computer|phone|mobile|audio|camera|television|informatique|electronique|video|gaming|laptop|smartphone|casque|ecouteur/.test(text)) return "tech";
  if (/sport|fitness|outdoor|sports equipment|running|cycling|training|gym|musculation/.test(text)) return "sport";
  if (/accessories|accessoire/.test(text)) return "fashion";
  return "other";
}
function categoryFor(row) {
  const metadata = norm([row.google_product_category, row.product_type, row.product_category].join(" "));
  const metadataCategory = classifyCategory(metadata);
  if (metadataCategory !== "other") return metadataCategory;
  // Certains flux Awin placent le nom dans "title" après normalisation CSV.
  return classifyCategory(norm([row.product_name, row.title, row.name].join(" ")));
}
function parseJsonl(body) {
  const rows = [];
  for (const [index, line] of body.split(/\r?\n/).entries()) {
    const value = line.trim();
    if (!value) continue;
    try {
      const row = JSON.parse(value);
      if (row && typeof row === "object" && !Array.isArray(row)) rows.push(row);
    } catch {
      log("Ligne JSON ignorée dans un flux (ligne " + (index + 1) + ").");
    }
  }
  return rows;
}
async function request(url, label, token = TOKEN) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json, application/x-ndjson" },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
          continue;
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(label + " : " + (lastError?.name || "réseau"));
}
const GTIN_FIELDS = [
  "gtin","ean","product_ean","product_gtin","upc","barcode","global_trade_item_number",
  "ean_8","ean_12","ean_13","ean_14","gtin_8","gtin_12","gtin_13","gtin_14",
  "product_ean_13","product_gtin_13","barcode_number"
];
const MPN_FIELDS = [
  "mpn","model_number","manufacturer_part_number","product_mpn",
  "manufacturer_sku","manufacturer_model_number","part_number",
  "manufacturer_part_no","mpn_number","product_model_number"
];
const BRAND_FIELDS = [
  "brand","brand_name","product_brand","product_brand_name",
  "manufacturer_name","manufacturer","manufacturer_brand"
];
function firstField(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}
function normalizedGtin(row) {
  const value = firstField(row, GTIN_FIELDS).replace(/[^0-9]/g, "");
  return isValidGtin(value) ? value : "";
}
function normalizedMpn(row) {
  return firstField(row, MPN_FIELDS).replace(/\s+/g, " ").trim();
}
function explicitPriceTaxStatus(row) {
  const status = norm(row?.price_tax_status || row?.priceTaxStatus || row?.tax_status || row?.taxStatus || row?.vat_status || row?.vatStatus || "");
  if (["included", "inclusive", "tax included", "vat included", "ttc"].includes(status)) return "included";
  const flag = row?.price_includes_tax ?? row?.priceIncludesTax ?? row?.vat_included ?? row?.vatIncluded ?? row?.tax_included ?? row?.taxIncluded;
  if (flag === true || /^(yes|true)$/i.test(String(flag ?? "").trim())) return "included";
  return "unspecified";
}
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("CSV Awin invalide : guillemet non refermé.");
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(item => item.some(cell => String(cell).trim() !== ""));
}
function objectRowsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(value => norm(value.replace(/^\uFEFF/, "")).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return rows.slice(1).map(cells => Object.fromEntries(headers.map((header,index) => [header,String(cells[index] ?? "").trim()])));
}

const DIRECT_FEED_HOSTS = new Set(["productdata.awin.com", "datafeed.api.productserve.com"]);

function validateDirectFeedUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("AWIN_PRODUCT_DATA_FEED_URL n'est pas une URL valide."); }
  if (url.protocol !== "https:" || !DIRECT_FEED_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Le flux Awin direct doit être une URL HTTPS officielle Awin.");
  }
  return url;
}

function parseFeedMoney(value, currency = "EUR", allowZero = false) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (allowZero && /^(0+(?:[.,]0+)?)(?:\s*(?:EUR|€))?$/i.test(raw)) return 0;
  if (allowZero && /^(free|gratuit|offert)$/i.test(raw)) return 0;
  let normalized = raw.replace(/€/g, " EUR").trim();
  if (!/[A-Z]{3}\s*$/i.test(normalized)) normalized += " " + String(currency || "").toUpperCase();
  const amount = parseMoney(normalized);
  return amount !== null && (allowZero || amount > 0) ? amount : null;
}

function stockValues(values) {
  return values
    .filter(value => value !== null && value !== undefined && String(value).trim() !== "")
    .map(value => String(value))
    .join(" ");
}

function stockState(value) {
  const stock = norm(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:out of stock|outofstock|no stock|sold out|discontinued|rupture|indisponible|unavailable|not available|not in stock|non disponible|non en stock|pas en stock|epuise|false|no)\b/.test(stock)) return "out_of_stock";
  if (/\b(?:in stock|instock|available|disponible|for sale|yes|true)\b/.test(stock)) return "in_stock";
  return "unknown";
}

function parseDirectFeedRow(row) {
  const currency = String(row.currency || "EUR").trim().toUpperCase();
  const price = parseFeedMoney(row.search_price || row.display_price || row.store_price || row.price || "", currency);
  const shippingPrice = parseFeedMoney(row.delivery_cost || row.shipping_cost || row.shipping || "", currency, true);
  const stock = stockState(stockValues([row.stock_status, row.availability, row.is_for_sale, row.in_stock]));
  const adultFlag = norm([row.adult, row.adult_content, row.is_adult].filter(Boolean).join(" "));
  const categoryText = norm([row.merchant_category, row.category_name, row.product_type, row.product_name, row.title, row.name].filter(Boolean).join(" "));
  if (/^(1|yes|true|adult)$/.test(adultFlag) || /adult products?|sex toys?|erotic|erotique/.test(categoryText)) return null;
  if (!price || currency !== "EUR" || stock === "out_of_stock") return null;
  const advertiser = String(row.merchant_id || row.advertiser_id || row.data_feed_id || "awin-standard").trim();
  const program = { name: String(row.merchant_name || ("Annonceur Awin " + advertiser)).trim() };
  const normalized = {
    id: row.aw_product_id || row.merchant_product_id || row.product_id || row.ean || row.gtin || "",
    title: row.product_name || row.title || "",
    description: row.description || row.product_short_description || "",
    brand: firstField(row, BRAND_FIELDS),
    product_type: row.merchant_category || row.category_name || row.google_product_category || row.product_type || "",
    google_product_category: row.google_product_category || row.category_name || row.merchant_category || "",
    color: row.colour || row.color || "",
    size: row.size || "",
    gtin: firstField(row, GTIN_FIELDS),
    mpn: firstField(row, MPN_FIELDS),
    image_link: row.merchant_image_url || row.aw_image_url || row.image_link || row.aw_thumb_url || "",
    additional_image_link: [row.alternate_image, row.alternate_image_two, row.alternate_image_three].filter(Boolean),
    price: price.toFixed(2) + " EUR",
    availability: stock,
    aw_deep_link: row.aw_deep_link || "",
    shipping_price_eur: shippingPrice,
    price_tax_status: explicitPriceTaxStatus(row),
    last_updated: row.last_updated || ""
  };
  return offerFromRow(normalized, program, advertiser, { allowUnknownAvailability: true });
}

async function loadDirectAwinFeed(rawOffers) {
  const initialUrl = validateDirectFeedUrl(process.env.AWIN_PRODUCT_DATA_FEED_URL);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let currentUrl = initialUrl;
      let response;
      for (let redirects = 0; redirects <= 3; redirects++) {
        response = await fetch(currentUrl.href, {
          headers: { Accept: "text/csv, application/gzip, application/octet-stream" },
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirection du flux Awin sans destination.");
        currentUrl = validateDirectFeedUrl(new URL(location, currentUrl).href);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) throw new Error("Trop de redirections du flux Awin.");
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 3) { await new Promise(resolve => setTimeout(resolve, 1200 * attempt)); continue; }
      }
      if (!response.ok) throw new Error("Téléchargement du flux Awin refusé (HTTP " + response.status + ").");
      let bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
      const csv = bytes.toString("utf8");
      if (/^\s*<(!doctype|html)/i.test(csv)) throw new Error("Awin a renvoyé une page HTML au lieu du fichier produits.");
      const rows = objectRowsFromCsv(csv);
      if (!rows.length) throw new Error("Le flux Awin est vide ou son CSV est illisible.");
      const headers = new Set(Object.keys(rows[0] || {}));
      log("En-têtes CSV Awin observés : " + [...headers].sort().join(", ") + ".");
      if (!headers.has("product_name") || !(headers.has("search_price") || headers.has("store_price") || headers.has("display_price"))) {
        throw new Error("Les colonnes produit/prix attendues sont absentes du flux Awin.");
      }
      const identityFields = {
        marque: BRAND_FIELDS,
        gtin: GTIN_FIELDS,
        mpn: MPN_FIELDS
      };
      const identityCoverage = Object.entries(identityFields).map(([label, fields]) => {
        const present = fields.filter(field => headers.has(field));
        const populated = rows.filter(row => fields.some(field => String(row[field] || "").trim())).length;
        return label + " " + populated + "/" + rows.length + " (colonnes : " + (present.join(", ") || "absentes") + ")";
      });
      log("Couverture des identifiants du flux Awin : " + identityCoverage.join(" ; ") + ".");
      const temporalHeaders = [...headers].filter(field => /(date|time|updated|modified|last)/i.test(field)).sort();
      const timestampNow = Date.now();
      const timestampCoverage = { fresh: 0, missing: 0, stale: 0, invalidOrFuture: 0 };
      for (const row of rows) {
        const value = String(row.last_updated || "").trim();
        if (!value) { timestampCoverage.missing++; continue; }
        const timestamp = Date.parse(value);
        if (!Number.isFinite(timestamp) || timestamp > timestampNow + 5 * 60 * 1000) {
          timestampCoverage.invalidOrFuture++;
        } else if (timestampNow - timestamp <= 48 * 60 * 60 * 1000) {
          timestampCoverage.fresh++;
        } else {
          timestampCoverage.stale++;
        }
      }
      log("Colonnes temporelles présentes dans le CSV Awin : " + (temporalHeaders.join(", ") || "aucune") + ".");
      log("last_updated : colonne " + (headers.has("last_updated") ? "présente" : "absente") + " ; couverture des lignes source : " + JSON.stringify(timestampCoverage) + " (fraîches = moins de 48 h).");
      const perAdvertiser = new Map();
      let imported = 0;
      for (const row of rows) {
        if (row.language && !/^(fr|french|fr_fr)$/i.test(String(row.language).trim())) continue;
        const advertiser = String(row.merchant_id || row.advertiser_id || row.data_feed_id || "awin-standard");
        const currentCount = perAdvertiser.get(advertiser) || 0;
        if (currentCount >= MAX_PER_ADVERTISER || rawOffers.length >= MAX_PRODUCTS) continue;
        const offer = parseDirectFeedRow(row);
        if (!offer) continue;
        rawOffers.push(offer);
        perAdvertiser.set(advertiser, currentCount + 1);
        imported++;
      }
      if (!imported) throw new Error("Aucune offre exploitable dans le flux Awin (prix EUR, image, lien HTTPS et données produit requis).");
      log(imported + " offre(s) importée(s) depuis le flux produits Awin direct.");
      return imported;
    } catch (error) {
      lastError = error;
      if (attempt < 3 && /réseau|timeout|fetch failed|HTTP 429|HTTP 5/i.test(String(error.message || error))) {
        await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Téléchargement du flux Awin impossible : " + String(lastError?.message || "erreur réseau"));
}


function parseFeedRow(row, program, advertiser) {
  const currency = row.currency || "EUR";
  const price = parseFeedMoney(row.search_price || row.display_price || row.store_price || row.price || "", currency);
  const stock = stockState(stockValues([row.stock_status,row.availability,row.is_for_sale,row.in_stock]));
  if (!price || String(currency).toUpperCase() !== "EUR" || stock !== "in_stock") return null;
  const extra = [row.alternate_image,row.alternate_image_two,row.alternate_image_three].filter(Boolean);
  const normalized = {
    id: row.aw_product_id || row.merchant_product_id || row.product_id || row.ean || row.product_gtin,
    title: row.product_name || row.title,
    description: row.description || row.product_short_description,
    brand: firstField(row, BRAND_FIELDS),
    product_type: row.merchant_category || row.category_name || row.product_type,
    google_product_category: row.category_name || row.merchant_category,
    color: row.colour || row.color,
    size: row.size,
    gtin: firstField(row, GTIN_FIELDS),
    mpn: firstField(row, MPN_FIELDS),
    image_link: row.merchant_image_url || row.image_link || row.large_image || row.aw_image_url || row.aw_thumb_url,
    additional_image_link: extra,
    price: price.toFixed(2) + " EUR",
    availability: "in_stock",
    aw_deep_link: row.aw_deep_link || row.merchant_deep_link || row.purl,
    shipping_price_eur: parseFeedMoney(row.delivery_cost || row.shipping, currency, true),
    price_tax_status: explicitPriceTaxStatus(row),
    last_updated: row.last_updated || ""
  };
  return offerFromRow(normalized,program,advertiser);
}

async function loadStandardAwinFeeds(rawOffers) {
  const key = process.env.AWIN_PRODUCT_DATA_API_KEY || "";
  if (!key) {
    log("Clé de flux Awin standard absente : aucun flux standard ne sera interrogé.");
    return 0;
  }
  const listUrl = "https://productdata.awin.com/datafeed/list/apikey/" + encodeURIComponent(key);
  const response = await fetch(listUrl,{headers:{Accept:"text/csv"},signal:AbortSignal.timeout(TIMEOUT_MS)});
  if (!response.ok) {
    log("Liste des flux standards Awin indisponible (HTTP "+response.status+").");
    return 0;
  }
  const listText = await response.text();
  const feedRows = objectRowsFromCsv(listText);
  const joined = feedRows.filter(row => /joined|soft member|auto.?join/.test(norm(row.membership_status || row.membership)) && /^(fr|french|fr_fr)$/.test(norm(row.language || row.feed_language)));
  log(joined.length+" flux standard(s) français accessibles dans la liste Awin.");
  let cursor = 0;
  let imported = 0;
  async function standardWorker() {
    while (cursor < joined.length && rawOffers.length < MAX_PRODUCTS) {
      const row = joined[cursor++];
      let feedUrl;
      try { feedUrl = new URL(row.url || row.download_url || row.feed_url); } catch { continue; }
      if (!["productdata.awin.com","datafeed.api.productserve.com"].includes(feedUrl.hostname) || !/^https?:$/.test(feedUrl.protocol)) continue;
      feedUrl.protocol = "https:";
      try {
        const feedResponse = await fetch(feedUrl.href,{headers:{Accept:"text/csv,application/gzip,application/octet-stream"},signal:AbortSignal.timeout(TIMEOUT_MS)});
        if (!feedResponse.ok) { log("Flux standard ignoré (HTTP "+feedResponse.status+")."); continue; }
        let bytes = Buffer.from(await feedResponse.arrayBuffer());
        if (bytes[0]===0x1f && bytes[1]===0x8b) bytes=gunzipSync(bytes);
        const rows = objectRowsFromCsv(bytes.toString("utf8"));
        const advertiser = String(row.advertiser_id || row.advertiserid || row.id || row.feed_id || "standard");
        const program = {name:row.advertiser_name || row.advertiser || ("Annonceur Awin "+advertiser)};
        let count = 0;
        for (const productRow of rows) {
          const offer = parseFeedRow(productRow,program,advertiser);
          if (!offer) continue;
          rawOffers.push(offer);
          imported++;
          count++;
          if (count>=MAX_PER_ADVERTISER || rawOffers.length>=MAX_PRODUCTS) break;
        }
        if (count) log(program.name+" (flux standard) : "+count+" offre(s) importée(s).");
      } catch (error) {
        log("Flux standard ignoré ("+String(error.message||"erreur").slice(0,100)+").");
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(2,joined.length)},standardWorker));
  return imported;
}

function advertiserId(program) {
  const value = program?.advertiserId ?? program?.advertiser_id ?? program?.advertiser?.id ?? program?.id;
  return String(value ?? "").trim();
}
function isValidGtin(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  let sum = 0;
  let weight = 3;
  for (let index = digits.length - 2; index >= 0; index--) {
    sum += Number(digits[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

function identityPart(value) {
  return norm(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function groupKey(row, advertiser) {
  const gtin = normalizedGtin(row);
  if (isValidGtin(gtin)) return "gtin:" + gtin;
  const brand = identityPart(firstField(row, BRAND_FIELDS));
  const mpn = identityPart(normalizedMpn(row));
  if (brand && mpn) {
    const color = identityPart(row.color || row.colour || "");
    const size = identityPart(row.size || "");
    const variant = identityPart(firstField(row, ["variant","product_variant","product_variant_name","variant_name","model_variant"]));
    if (color || size || variant) return "mpn:" + brand + ":" + mpn + ":" + color + ":" + size + ":" + variant;
  }
  return "awin:" + advertiser + ":" + String(row.id || row.product_id || "");
}

function offerFromRow(row, program, advertiser, { allowUnknownAvailability = false } = {}) {
  const name = String(row.title || row.product_name || "").trim().replace(/\s+/g, " ");
  const brand = firstField(row, BRAND_FIELDS);
  const gtin = normalizedGtin(row);
  const mpn = normalizedMpn(row);
  const images = imageList(row);
  const link = httpsUrl(row.aw_deep_link || row.link || row.mobile_link);
  const availability = stockState(stockValues([row.availability,row.stock_status,row.in_stock,row.is_for_sale]));
  const currency = String(row.currency || "EUR").trim().toUpperCase();
  const regular = parseMoney(row.price || row.search_price);
  const sale = currentSalePrice(row, Date.now());
  const price = sale || regular;
  if (!name || !images.length || !link || !price || currency !== "EUR" || availability === "out_of_stock" ||
      (availability !== "in_stock" && !allowUnknownAvailability)) return null;
  if (/^(yes|true|1|adult)$/i.test(String(row.adult || row.adult_content || ""))) return null;
  const merchant = String(program?.name || program?.displayName || program?.advertiserName || ("Annonceur Awin " + advertiser)).trim();
  return {
    id: String(row.id || row.product_id || row.gtin || ""),
    identity: groupKey({ ...row, brand, gtin, mpn }, advertiser),
    advertiser_id: advertiser,
    merchant,
    name,
    brand,
    description: String(row.description || row.product_short_description || "").trim(),
    category: categoryFor(row),
    product_type: String(row.product_type || row.google_product_category || "").trim(),
    color: String(row.color || row.colour || "").trim(),
    size: String(row.size || "").trim(),
    gtin,
    mpn,
    images,
    price_eur: price,
    regular_price_eur: regular && sale && regular > sale ? regular : null,
    availability,
    shipping: row.shipping || row.delivery_cost || null,
    shipping_price_eur: Number.isFinite(row.shipping_price_eur) ? row.shipping_price_eur : null,
    price_tax_status: explicitPriceTaxStatus(row),
    merchant_updated_at: row.last_updated || null,
    url: link
  };
}

function compareOfferCosts(a, b) {
  const aShippingKnown = Number.isFinite(a.shipping_price_eur) && a.shipping_price_eur >= 0;
  const bShippingKnown = Number.isFinite(b.shipping_price_eur) && b.shipping_price_eur >= 0;
  if (aShippingKnown !== bShippingKnown) return aShippingKnown ? -1 : 1;
  const aTotal = a.price_eur + (aShippingKnown ? a.shipping_price_eur : 0);
  const bTotal = b.price_eur + (bShippingKnown ? b.shipping_price_eur : 0);
  return aTotal - bTotal || a.price_eur - b.price_eur || String(a.merchant).localeCompare(String(b.merchant), "fr");
}

function aggregateOffers(rawOffers, fetchedAt) {
  const groups = new Map();
  for (const offer of rawOffers) {
    let group = groups.get(offer.identity);
    if (!group) {
      group = { identity: offer.identity, offers: [], first: offer };
      groups.set(offer.identity, group);
    }
    if (!group.offers.some(item => item.advertiser_id === offer.advertiser_id && item.id === offer.id)) {
      group.offers.push(offer);
    }
  }
  const result = [];
  for (const group of groups.values()) {
    const offers = group.offers.sort(compareOfferCosts);
    const best = offers[0];
    const first = group.first;
    result.push({
      id: "awin-" + group.identity.replace(/[^a-z0-9-]/gi, "-"),
      name: first.name,
      desc: [first.brand, first.color, first.size, first.product_type].filter(Boolean).join(" • "),
      query: [first.name, first.brand, first.color, first.size].filter(Boolean).join(" "),
      category: first.category,
      brand: first.brand,
      color: first.color,
      size: first.size,
      availability: best.availability,
      priceTaxStatus: best.price_tax_status || "unspecified",
      shippingPriceValue: best.shipping_price_eur,
      merchantUpdatedAt: best.merchant_updated_at,
      gtin: first.gtin,
      mpn: first.mpn,
      identityType: group.identity.startsWith("gtin:") ? "gtin" : group.identity.startsWith("mpn:") ? "brand_mpn" : "merchant_product",
      image: best.images[0] || first.images[0],
      images: [...new Set(group.offers.flatMap(item => item.images))].slice(0, 6),
      imageSource: best.url,
      imageSourceName: best.merchant,
      imageKind: "merchant_feed",
      imageStatus: "authorized_feed_image",
      merchant: best.merchant,
      priceValue: best.price_eur,
      price: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(best.price_eur),
      regularPriceValue: best.regular_price_eur,
      sourceUrl: best.url,
      offers: offers.slice(0, 12).map(item => ({
        merchant: item.merchant,
        priceValue: item.price_eur,
        price: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(item.price_eur),
        url: item.url,
        images: item.images,
        shipping: item.shipping,
        shippingPriceValue: item.shipping_price_eur,
        availability: item.availability,
        priceTaxStatus: item.price_tax_status || "unspecified",
        merchantUpdatedAt: item.merchant_updated_at
      })),
      isAwinProduct: true,
      priceSource: "Awin — flux marchand autorisé",
      fetchedAt
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}


async function fetchProgrammes(relationship, token) {
  const response = await request(
    "https://api.awin.com/publishers/" + encodeURIComponent(PUBLISHER_ID) +
      "/programmes?relationship=" + encodeURIComponent(relationship),
    "Programmes " + relationship,
    token
  );
  if (!response.ok) {
    const error = new Error("API Awin programmes " + relationship + " HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  const programmes = Array.isArray(payload)
    ? payload
    : (payload.programmes || payload.programs || payload.data || []);
  return Array.isArray(programmes) ? programmes : [];
}

async function loadEnhancedAwinFeeds(rawOffers, { optional = false, token = TOKEN } = {}) {
  const initialCount = rawOffers.length;
  let joinedCount = null;
  let pendingCount = null;
  let joinedError = null;

  if (token) {
    const [joinedResult, pendingResult] = await Promise.allSettled([
      fetchProgrammes("joined", token),
      fetchProgrammes("pending", token)
    ]);

    if (pendingResult.status === "fulfilled") {
      pendingCount = pendingResult.value.length;
      log(pendingCount + " demande(s) de partenariat en attente selon l’API Awin.");
    } else {
      log("Statut des demandes Awin en attente non vérifié (" + String(pendingResult.reason?.message || "erreur API").slice(0, 100) + ").");
    }

    if (joinedResult.status === "fulfilled") {
      const eligible = joinedResult.value
        .map(program => ({ program, id: advertiserId(program) }))
        .filter(item => /^\d+$/.test(item.id))
        .slice(0, MAX_PROGRAMMES);
      joinedCount = eligible.length;
      log(joinedCount + " partenariat(s) Awin rejoint(s) à examiner.");

      const statusCounts = {};
      let cursor = 0;
      async function worker() {
        while (cursor < eligible.length && rawOffers.length < MAX_PRODUCTS) {
          const item = eligible[cursor++];
          const url = "https://api.awin.com/publishers/" + encodeURIComponent(PUBLISHER_ID) +
            "/awinfeeds/download/" + encodeURIComponent(item.id + "-retail-" + LOCALE + ".jsonl");
          try {
            const response = await request(url, "Flux annonceur " + item.id, token);
            statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
            if (!response.ok) continue;
            const rows = parseJsonl(await response.text());
            let accepted = 0;
            for (const row of rows) {
              const offer = offerFromRow(row, item.program, item.id);
              if (!offer) continue;
              rawOffers.push(offer);
              accepted++;
              if (accepted >= MAX_PER_ADVERTISER || rawOffers.length >= MAX_PRODUCTS) break;
            }
            if (accepted) log((item.program?.name || "Annonceur " + item.id) + " : " + accepted + " offre(s) avec image, prix EUR, stock et lien.");
          } catch (error) {
            log("Flux " + item.id + " ignoré (" + String(error.message || "erreur").slice(0, 120) + ").");
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, eligible.length) }, worker));
      if (Object.keys(statusCounts).length) log("Codes HTTP des flux Enhanced Awin : " + JSON.stringify(statusCounts));
      if (!eligible.length) log("Aucun programme rejoint : les demandes en attente ne sont pas utilisées comme autorisation.");
    } else {
      joinedError = joinedResult.reason;
      log("Statut des partenariats Awin rejoints non vérifié (" + String(joinedError?.message || "erreur API").slice(0, 120) + ").");
      if ([401, 403].includes(joinedError?.status)) {
        log("Authentification Awin refusée (HTTP " + joinedError.status + "). Le flux direct existant n’est pas modifié par cet échec.");
      }
    }
  } else {
    log("AWIN_API_TOKEN absent : les relations joined/pending ne peuvent pas être vérifiées ce cycle.");
  }

  let standardImported = 0;
  let standardError = null;
  try {
    standardImported = await loadStandardAwinFeeds(rawOffers);
    if (standardImported) log(standardImported + " offre(s) supplémentaire(s) depuis les flux standards autorisés (joined/soft member/auto-join). ");
  } catch (error) {
    standardError = error;
    log("Liste des flux standards Awin indisponible (" + String(error.message || "erreur").slice(0, 120) + ").");
  }

  const importedOffers = rawOffers.length - initialCount;
  if (!importedOffers && !optional) {
    if (joinedError && !standardError) throw joinedError;
    if (standardError) throw standardError;
    throw new Error("Aucune offre Awin exploitable dans les programmes rejoints ou les flux standards autorisés.");
  }
  if (!importedOffers && optional) {
    log("Aucune offre Enhanced/standard supplémentaire ; les offres du flux direct sont conservées sans remplacement.");
  }
  return { joinedCount, pendingCount, importedOffers };
}

function buildSyncStatus({ fetchedAt, source, joinedCount, pendingCount, additionalOffers, counts }) {
  const programmesCheckStatus = joinedCount === null && pendingCount === null
    ? "not_verified"
    : joinedCount === null || pendingCount === null
      ? "partial"
      : "verified";
  return {
    schema_version: 1,
    status: "ok",
    fetched_at: fetchedAt,
    source,
    publisher_id: PUBLISHER_ID,
    locale: LOCALE,
    programmes_check_status: programmesCheckStatus,
    joined_advertisers_checked: joinedCount,
    pending_advertisers_detected: pendingCount,
    additional_authorized_offers_imported: additionalOffers,
    counts
  };
}

async function runSelfTests() {
  const sampleStatus = buildSyncStatus({
    fetchedAt: "2026-11-06T00:00:00.000Z",
    source: "Awin Direct Product Data Feed",
    joinedCount: 0,
    pendingCount: 6,
    additionalOffers: 0,
    counts: { products: 7, merchant_offers: 7 }
  });
  if (sampleStatus.programmes_check_status !== "verified" ||
      sampleStatus.joined_advertisers_checked !== 0 ||
      sampleStatus.pending_advertisers_detected !== 6 ||
      sampleStatus.additional_authorized_offers_imported !== 0) {
    throw new Error("TEST ÉCHEC : le rapport Awin doit distinguer joined, pending et offres supplémentaires.");
  }
  const unavailableStatus = buildSyncStatus({
    fetchedAt: "2026-11-06T00:00:00.000Z",
    source: "Awin Direct Product Data Feed",
    joinedCount: null,
    pendingCount: null,
    additionalOffers: 0,
    counts: {}
  });
  if (unavailableStatus.programmes_check_status !== "not_verified") {
    throw new Error("TEST ÉCHEC : un statut Awin non vérifié ne doit pas être présenté comme zéro programme.");
  }
  const sampleCsv = 'aw_deep_link,product_name,aw_product_id,merchant_product_id,merchant_image_url,merchant_category,search_price,merchant_name,merchant_id,currency,delivery_cost,language,last_updated,brand_name,gtin,manufacturer_part_number\n' +
    '"https://www.awin1.com/cread.php?awinmid=123&id=1","Casque Audio X","501","SKU-1","https://cdn.example/image.jpg","Audio","49.90","Boutique Test","123","EUR","4.99","fr","2026-11-04T10:00:00Z","AudioBrand","4006381333931","AB-X1"';
  const rows = objectRowsFromCsv(sampleCsv);
  for (const value of ["not in stock","unavailable","not available","non disponible","indisponible","out_of_stock","no stock","pas en stock","epuise"]) {
    if (stockState(value) !== "out_of_stock") throw new Error("TEST ÉCHEC : statut indisponible mal reconnu : " + value);
  }
  for (const value of ["in stock","instock","available","disponible","in_stock","yes","true"]) {
    if (stockState(value) !== "in_stock") throw new Error("TEST ÉCHEC : statut disponible mal reconnu : " + value);
  }
  const offer = parseDirectFeedRow(rows[0]);
  if (!offer) throw new Error("TEST ÉCHEC : un flux direct valide doit produire une offre.");
  if (offer.price_eur !== 49.9 || offer.shipping_price_eur !== 4.99 || offer.availability !== "unknown" ||
      offer.brand !== "AudioBrand" || offer.gtin !== "4006381333931" || offer.mpn !== "AB-X1" ||
      offer.price_tax_status !== "unspecified") {
    throw new Error("TEST ÉCHEC : prix, livraison, marque, GTIN, MPN ou disponibilité mal traités.");
  }
  const explicitOutOfStock = parseDirectFeedRow({ ...rows[0], is_for_sale: false });
  if (explicitOutOfStock) throw new Error("TEST ÉCHEC : un booléen is_for_sale=false ne doit jamais devenir une disponibilité inconnue.");
  const ttcOffer = parseDirectFeedRow({ ...rows[0], price_tax_status: "included" });
  if (!ttcOffer || ttcOffer.price_tax_status !== "included") {
    throw new Error("TEST ÉCHEC : seul un statut TVA explicitement inclus peut être reconnu.");
  }
  const aliasRow = {
    title: "Casque alias",
    brand_name: "AudioBrand",
    ean_13: "4006381333931",
    manufacturer_part_no: "AB-X1",
    image_link: "https://cdn.example/alias.jpg",
    aw_deep_link: "https://shop.example/alias",
    price: "49.90 EUR",
    availability: "in stock"
  };
  const aliasOffer = offerFromRow(aliasRow, {name:"Boutique Alias"}, "999");
  if (!aliasOffer || aliasOffer.gtin !== "4006381333931" || aliasOffer.mpn !== "AB-X1" ||
      aliasOffer.identity !== "gtin:4006381333931") {
    throw new Error("TEST ÉCHEC : les alias EAN-13/GTIN et manufacturer_part_no doivent être reconnus.");
  }
  const booleanOutOfStock = offerFromRow({...aliasRow,availability:false,stock_status:""}, {name:"Boutique Alias"}, "999", {allowUnknownAvailability:true});
  if (booleanOutOfStock) throw new Error("TEST ÉCHEC : availability=false ne doit pas être accepté comme stock inconnu.");
  const wrongCurrency = offerFromRow({...aliasRow,currency:"USD"}, {name:"Boutique Alias"}, "999", {allowUnknownAvailability:true});
  if (wrongCurrency) throw new Error("TEST ÉCHEC : une devise USD ne doit pas être convertie en offre EUR.");
  const standardAlias = parseFeedRow({
    product_name:"Casque alias",brand_name:"AudioBrand",ean_13:"4006381333931",
    manufacturer_part_no:"AB-X1",merchant_image_url:"https://cdn.example/alias.jpg",
    aw_deep_link:"https://shop.example/alias",search_price:"49.90",currency:"EUR",
    availability:"in stock"
  }, {name:"Boutique standard"}, "998");
  if (!standardAlias || standardAlias.gtin !== "4006381333931" || standardAlias.mpn !== "AB-X1") {
    throw new Error("TEST ÉCHEC : les alias GTIN/MPN doivent aussi être lus dans les flux CSV standards.");
  }
  const categoryCases = [
    [{ product_type: "Home & Garden, Bathroom Accessories, Soap & Lotion Dispensers" }, "home"],
    [{ product_type: "Parfums > Parfums pour Femme > Eau de Parfum Femme" }, "beauty"],
    [{ product_type: "Chaussettes de sport" }, "sport"],
    [{ product_type: "Chaussettes de maison" }, "fashion"],
    [{ product_type: "Kids Clothing > Children" }, "kids"],
    [{ product_type: "Home & Garden > Outdoor Furniture" }, "home"],
    [{ product_type: "Electronics > Audio > Headphones" }, "tech"],
    [{ product_type: "Sports & Fitness > Running" }, "sport"],
    [{ product_type: "Toys & Games > Children" }, "kids"],
    [{ product_type: "Cadeaux", title: "Shampoing hydratant cheveux 250 ml" }, "beauty"],
    [{ product_type: "Cadeaux", title: "Chaussettes à paillettes pour filles — 2 paires" }, "fashion"],
    [{ product_type: "Bougies", title: "Roses of the Pays de Grasse Scented Candle" }, "home"],
    [{ google_product_category: "Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne", title: "ANDALUSIAN GARDEN" }, "beauty"]
  ];
  for (const [row, expected] of categoryCases) {
    if (categoryFor(row) !== expected) {
      throw new Error("TEST ÉCHEC : catégorie attendue " + expected + " pour " + JSON.stringify(row));
    }
  }
  const normalizedMpnValue = normalizedMpn({ manufacturer_part_number: "  AB-X1   Pro  " });
  if (normalizedMpnValue !== "AB-X1 Pro") {
    throw new Error("TEST ÉCHEC : les espaces du MPN doivent être normalisés.");
  }
  if (!isValidGtin("4006381333931") || isValidGtin("4006381333932")) {
    throw new Error("TEST ÉCHEC : la validation du chiffre de contrôle GTIN est incorrecte.");
  }
  const gtinKeyA = groupKey({ gtin: "4006381333931", brand: "Marque A", mpn: "MODELE-A" }, "annonceur-1");
  const gtinKeyB = groupKey({ gtin: "4006381333931", brand: "Marque B", mpn: "MODELE-B" }, "annonceur-2");
  if (gtinKeyA !== gtinKeyB || !gtinKeyA.startsWith("gtin:")) {
    throw new Error("TEST ÉCHEC : le GTIN valide doit primer sur l'annonceur et le MPN.");
  }
  const mpnKeyA = groupKey({ brand: "AudioBrand", mpn: "AB-X1", color: "Noir", size: "" }, "annonceur-1");
  const mpnKeyB = groupKey({ brand: "AudioBrand", mpn: "AB-X1", color: "Noir", size: "" }, "annonceur-2");
  const mpnKeyDifferentVariant = groupKey({ brand: "AudioBrand", mpn: "AB-X1", color: "Blanc", size: "" }, "annonceur-3");
  const mpnKeyVariantA = groupKey({ brand: "AudioBrand", mpn: "AB-X1", variant: "Noir 128 Go" }, "annonceur-1");
  const mpnKeyVariantB = groupKey({ brand: "AudioBrand", mpn: "AB-X1", variant: "Noir 128 Go" }, "annonceur-2");
  const mpnKeyVariantDifferent = groupKey({ brand: "AudioBrand", mpn: "AB-X1", variant: "Blanc 128 Go" }, "annonceur-3");
  const mpnKeyMissingVariantA = groupKey({ brand: "AudioBrand", mpn: "AB-X1" }, "annonceur-1");
  const mpnKeyMissingVariantB = groupKey({ brand: "AudioBrand", mpn: "AB-X1" }, "annonceur-2");
  if (mpnKeyA !== mpnKeyB || mpnKeyA === mpnKeyDifferentVariant ||
      mpnKeyVariantA !== mpnKeyVariantB || mpnKeyVariantA === mpnKeyVariantDifferent ||
      mpnKeyMissingVariantA === mpnKeyMissingVariantB ||
      groupKey({ mpn: "AB-X1" }, "annonceur-1") === groupKey({ mpn: "AB-X1" }, "annonceur-2")) {
    throw new Error("TEST ÉCHEC : le rapprochement MPN doit exiger une marque et une variante exacte.");
  }
  const grouped = aggregateOffers([
    { identity: mpnKeyA, advertiser_id: "1", id: "1", merchant: "Boutique A", name: "Casque Audio X", brand: "AudioBrand", category: "tech", color: "Noir", size: "", gtin: "", mpn: "AB-X1", images: ["https://cdn.example/a.jpg"], price_eur: 45, shipping_price_eur: null, availability: "unknown", merchant_updated_at: null, url: "https://example.com/a" },
    { identity: mpnKeyA, advertiser_id: "2", id: "2", merchant: "Boutique B", name: "Casque Audio X", brand: "AudioBrand", category: "tech", color: "Noir", size: "", gtin: "", mpn: "AB-X1", images: ["https://cdn.example/b.jpg"], price_eur: 48, shipping_price_eur: 0, availability: "in_stock", merchant_updated_at: null, url: "https://example.com/b" }
  ], "2026-11-05T06:00:00.000Z")[0];
  if (!grouped || grouped.identityType !== "brand_mpn" || grouped.offers[0].merchant !== "Boutique B" ||
      grouped.imageKind !== "merchant_feed" || grouped.imageSourceName !== "Boutique B") {
    throw new Error("TEST ÉCHEC : comparaison MPN, priorité au total connu ou provenance image.");
  }
  if (parseDirectFeedRow({ ...rows[0], stock_status: "out_of_stock" }) !== null) {
    throw new Error("TEST ÉCHEC : une offre explicitement en rupture doit être rejetée.");
  }
  if (parseDirectFeedRow({ ...rows[0], currency: "USD" }) !== null) {
    throw new Error("TEST ÉCHEC : une offre non EUR doit être rejetée.");
  }
  let rejectsHttp = false;
  try { validateDirectFeedUrl("http://productdata.awin.com/feed.csv"); } catch { rejectsHttp = true; }
  if (!rejectsHttp) throw new Error("TEST ÉCHEC : une URL HTTP doit être rejetée.");

  const originalFetch = globalThis.fetch;
  const originalStandardKey = process.env.AWIN_PRODUCT_DATA_API_KEY;
  try {
    delete process.env.AWIN_PRODUCT_DATA_API_KEY;
    const requested = [];
    globalThis.fetch = async (url, options = {}) => {
      requested.push({ url: String(url), authorization: options.headers?.Authorization });
      if (String(url).includes("relationship=joined")) return new Response("[]", { status: 200 });
      if (String(url).includes("relationship=pending")) return new Response('[{"id":123,"name":"Pending test"}]', { status: 200 });
      throw new Error("URL inattendue dans le test Awin : " + url);
    };
    const directOnly = [{ id: "direct-feed-offer" }];
    const status = await loadEnhancedAwinFeeds(directOnly, { optional: true, token: "test-token" });
    if (status.joinedCount !== 0 || status.pendingCount !== 1 || status.importedOffers !== 0 ||
        directOnly.length !== 1 || requested.length !== 2 || requested.some(item => item.authorization !== "Bearer test-token")) {
      throw new Error("TEST ÉCHEC : le contrôle joined/pending doit conserver le flux direct sans fusionner les demandes en attente.");
    }

    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes("relationship=joined")) return new Response("refusé", { status: 403 });
      if (String(url).includes("relationship=pending")) return new Response("[]", { status: 200 });
      throw new Error("URL inattendue dans le test Awin 403 : " + url);
    };
    const preserved = [{ id: "direct-feed-preserved" }];
    const denied = await loadEnhancedAwinFeeds(preserved, { optional: true, token: "test-token" });
    if (denied.joinedCount !== null || denied.pendingCount !== 0 || preserved.length !== 1) {
      throw new Error("TEST ÉCHEC : un 403 API ne doit pas effacer le flux direct.");
    }

    process.env.AWIN_PRODUCT_DATA_API_KEY = "test-standard-key";
    let standardListRequested = false;
    globalThis.fetch = async (url, options = {}) => {
      const value = String(url);
      if (value.includes("datafeed/list/apikey/test-standard-key")) {
        standardListRequested = true;
        return new Response("advertiser_id,program_name,membership_status,language\\n", { status: 200 });
      }
      throw new Error("URL inattendue dans le test du flux standard : " + value);
    };
    const standardOnly = [{ id: "direct-feed-standard-fallback" }];
    const standardStatus = await loadEnhancedAwinFeeds(standardOnly, { optional: true, token: "" });
    if (!standardListRequested || standardStatus.joinedCount !== null || standardStatus.importedOffers !== 0 || standardOnly.length !== 1) {
      throw new Error("TEST ÉCHEC : le flux standard autorisé doit être interrogé même sans jeton Publisher API.");
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStandardKey === undefined) delete process.env.AWIN_PRODUCT_DATA_API_KEY;
    else process.env.AWIN_PRODUCT_DATA_API_KEY = originalStandardKey;
  }
  log("Autotests réussis : CSV, prix EUR, TVA explicite, livraison, GTIN valide, MPN+marque, variantes, catégories, liens, rupture, API joined/pending, conservation du flux direct après 403 et URL sécurisée.");
}

if (process.argv.includes("--self-test")) {
  await runSelfTests();
} else {
  const rawOffers = [];
  const directFeedConfigured = Boolean(process.env.AWIN_PRODUCT_DATA_FEED_URL);
  let joinedAdvertisersChecked = null;
  let pendingAdvertisersDetected = null;
  let additionalAwinOffers = 0;
  if (directFeedConfigured) {
    await loadDirectAwinFeed(rawOffers);
    const programmeStatus = await loadEnhancedAwinFeeds(rawOffers, { optional: true });
    joinedAdvertisersChecked = programmeStatus.joinedCount;
    pendingAdvertisersDetected = programmeStatus.pendingCount;
    additionalAwinOffers = programmeStatus.importedOffers;
  } else {
    const programmeStatus = await loadEnhancedAwinFeeds(rawOffers);
    joinedAdvertisersChecked = programmeStatus.joinedCount;
    pendingAdvertisersDetected = programmeStatus.pendingCount;
    additionalAwinOffers = programmeStatus.importedOffers;
  }
  if (!rawOffers.length) throw new Error("Aucune offre Awin exploitable : le catalogue précédent est conservé.");
const fetchedAt = new Date().toISOString();
const products = aggregateOffers(rawOffers, fetchedAt).slice(0, MAX_PRODUCTS);
const output = {
  schema_version: 1,
  source: directFeedConfigured
    ? (additionalAwinOffers ? "Awin Direct + flux programmes/standards autorisés" : "Awin Direct Product Data Feed")
    : "Awin Publisher Enhanced/standard feeds autorisés",
  publisher_id: PUBLISHER_ID,
  locale: LOCALE,
  fetched_at: fetchedAt,
  status: "ok",
  counts: {
    joined_advertisers_checked: joinedAdvertisersChecked,
    pending_advertisers_detected: pendingAdvertisersDetected,
    additional_authorized_offers_imported: additionalAwinOffers,
    products: products.length,
    merchant_offers: rawOffers.length,
    merchants: new Set(rawOffers.map(offer => norm(offer.merchant)).filter(Boolean)).size,
    brands: new Set(products.map(product => norm(product.brand)).filter(Boolean)).size,
    products_with_gtin: products.filter(product => isValidGtin(product.gtin)).length,
    products_with_mpn: products.filter(product => Boolean(String(product.mpn || "").trim())).length,
    products_with_brand_mpn: products.filter(product => Boolean(String(product.brand || "").trim() && String(product.mpn || "").trim())).length,
    multi_merchant_products: products.filter(product => new Set((product.offers || []).map(offer => norm(offer.merchant)).filter(Boolean)).size > 1).length,
    offers_with_shipping: rawOffers.filter(offer => Number.isFinite(offer.shipping_price_eur) && offer.shipping_price_eur >= 0).length,
    offers_with_availability: rawOffers.filter(offer => offer.availability && offer.availability !== "unknown").length,
    offers_with_tax_included: rawOffers.filter(offer => offer.price_tax_status === "included").length,
    products_other_category: products.filter(product => product.category === "other").length
  },
  products,
  attribution: "Données produits, prix, images et liens provenant des flux marchands Awin accessibles au compte éditeur Prix Malin. Prix et disponibilité à reconfirmer sur la fiche marchande."
};

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
const statusReport = buildSyncStatus({
  fetchedAt,
  source: output.source,
  joinedCount: joinedAdvertisersChecked,
  pendingCount: pendingAdvertisersDetected,
  additionalOffers: additionalAwinOffers,
  counts: output.counts
});
await fs.writeFile(OUTPUT, JSON.stringify(output) + "\n", "utf8");
await fs.writeFile(STATUS_OUTPUT, JSON.stringify(statusReport, null, 2) + "\n", "utf8");
log(products.length + " fiche(s) produits, " + rawOffers.length + " offre(s), " + output.counts.brands + " marque(s).");
log("Qualité du flux Awin : " + JSON.stringify(output.counts));
log("Statut partenariats Awin : joined=" + (joinedAdvertisersChecked === null ? "non vérifié" : joinedAdvertisersChecked) +
  " ; pending=" + (pendingAdvertisersDetected === null ? "non vérifié" : pendingAdvertisersDetected) + ".");
log("Catalogue autorisé mis à jour : data/awin-products.json");
}

import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "data", "awin-products.json");
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
function categoryFor(row) {
  const text = norm([row.google_product_category, row.product_type, row.product_category].join(" "));
  if (/apparel|clothing|shoes|footwear|accessories|mode|vetement|chaussure/.test(text)) return "fashion";
  if (/electronics|computer|phone|mobile|audio|camera|television|informatique|electronique/.test(text)) return "tech";
  if (/home|garden|furniture|kitchen|household|maison|jardin|cuisine/.test(text)) return "home";
  if (/sport|fitness|outdoor|sports equipment/.test(text)) return "sport";
  if (/beauty|cosmetic|personal care|health|beaute|soin/.test(text)) return "beauty";
  if (/baby|toys|toys & games|children|bebe|enfant|jouet/.test(text)) return "kids";
  if (/vehicle|automotive|auto|moto|car parts/.test(text)) return "auto";
  return "other";
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
async function request(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: "Bearer " + TOKEN, Accept: "application/json, application/x-ndjson" },
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
function parseFeedRow(row, program, advertiser) {
  const priceValue = row.search_price || row.store_price || row.price || "";
  const currency = row.currency || "EUR";
  const price = /[A-Z]{3}/i.test(String(priceValue)) ? priceValue : String(priceValue).replace(",", ".") + " " + currency;
  const stockRaw = norm([row.stock_status,row.availability,row.is_for_sale,row.in_stock].join(" "));
  const quantity = Number(row.stock_quantity || row.number_available || 0);
  const inStock = /in stock|in_stock|available|yes|true|for sale/.test(stockRaw) || quantity > 0;
  if (!inStock || /out of stock|out_of_stock|false|no/.test(stockRaw)) return null;
  const extra = [row.alternate_image,row.alternate_image_two,row.alternate_image_three].filter(Boolean);
  const normalized = {
    id: row.aw_product_id || row.merchant_product_id || row.product_id || row.ean || row.product_gtin,
    title: row.product_name || row.title,
    description: row.description || row.product_short_description,
    brand: row.brand_name || row.brand,
    product_type: row.merchant_category || row.category_name || row.product_type,
    google_product_category: row.category_name || row.merchant_category,
    color: row.colour || row.color,
    size: row.size,
    gtin: row.ean || row.product_gtin || row.upc,
    mpn: row.mpn || row.model_number,
    image_link: row.merchant_image_url || row.large_image || row.aw_image_url || row.aw_thumb_url,
    additional_image_link: extra,
    price,
    availability: "in_stock",
    aw_deep_link: row.aw_deep_link || row.merchant_deep_link || row.purl
  };
  return offerFromRow(normalized,program,advertiser);
}
async function loadStandardAwinFeeds(rawOffers) {
  const key = process.env.AWIN_PRODUCT_DATA_API_KEY || "";
  if (!key) {
    log("Clé de flux Awin standard absente : seuls les flux Enhanced accessibles par l'API éditeur seront lus.");
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
function groupKey(row, advertiser) {
  const gtin = String(row.gtin || row.product_gtin || row.product_GTIN || "").replace(/[^0-9]/g, "");
  if ([8, 12, 13, 14].includes(gtin.length)) return "gtin:" + gtin;
  return "awin:" + advertiser + ":" + String(row.id || row.product_id || "");
}
function offerFromRow(row, program, advertiser) {
  const name = String(row.title || row.product_name || "").trim().replace(/\s+/g, " ");
  const brand = String(row.brand || row.brand_name || "").trim();
  const images = imageList(row);
  const link = httpsUrl(row.aw_deep_link || row.link || row.mobile_link);
  const availability = String(row.availability || row.stock_status || "").toLowerCase();
  const regular = parseMoney(row.price || row.search_price);
  const sale = currentSalePrice(row, Date.now());
  const price = sale || regular;
  if (!name || !brand || !images.length || !link || !price || availability !== "in_stock") return null;
  if (String(row.adult || "").toLowerCase() === "yes") return null;
  const merchant = String(program?.name || program?.displayName || program?.advertiserName || ("Annonceur Awin " + advertiser)).trim();
  return {
    id: String(row.id || row.product_id || row.gtin || ""),
    identity: groupKey(row, advertiser),
    advertiser_id: advertiser,
    merchant,
    name,
    brand,
    description: String(row.description || row.product_short_description || "").trim(),
    category: categoryFor(row),
    product_type: String(row.product_type || row.google_product_category || "").trim(),
    color: String(row.color || row.colour || "").trim(),
    size: String(row.size || "").trim(),
    gtin: String(row.gtin || row.product_gtin || row.product_GTIN || "").trim(),
    mpn: String(row.mpn || row.model_number || "").trim(),
    images,
    price_eur: price,
    regular_price_eur: regular && sale && regular > sale ? regular : null,
    shipping: row.shipping || null,
    url: link
  };
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
    const offers = group.offers.sort((a, b) => a.price_eur - b.price_eur);
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
      gtin: first.gtin,
      mpn: first.mpn,
      image: best.images[0] || first.images[0],
      images: [...new Set(group.offers.flatMap(item => item.images))].slice(0, 6),
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
        shipping: item.shipping
      })),
      isAwinProduct: true,
      priceSource: "Awin — flux marchand autorisé",
      fetchedAt
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

if (!TOKEN) {
  log("BLOCAGE : secret AWIN_API_TOKEN absent. Le catalogue existant est conservé, mais aucune synchronisation Awin n'est possible.");
  throw new Error("AWIN_API_TOKEN absent : renseigner un jeton éditeur Awin valide dans les secrets GitHub Actions.");
}

const programmesResponse = await request(
  "https://api.awin.com/publishers/" + encodeURIComponent(PUBLISHER_ID) + "/programmes?relationship=joined",
  "Liste des partenariats"
);
if (!programmesResponse.ok) {
  if ([401,403].includes(programmesResponse.status)) {
    log("Accès Awin Publisher refusé (HTTP " + programmesResponse.status + "). Le jeton AWIN_API_TOKEN présent dans les secrets n'est pas accepté par l'API éditeur. Aucune donnée produit ni aucun prix n'a été modifié.");
    if (!process.env.AWIN_PRODUCT_DATA_API_KEY) {
      log("La clé séparée AWIN_PRODUCT_DATA_API_KEY pour les flux produits standards n'est pas configurée. Il faut rétablir le jeton Publisher et/ou ajouter cette clé distincte dans les secrets Actions du dépôt.");
    }
    throw new Error("Authentification Awin refusée (HTTP " + programmesResponse.status + "). Le catalogue existant a été conservé. Renouveler AWIN_API_TOKEN et vérifier les droits éditeur ; AWIN_PRODUCT_DATA_API_KEY est une clé distincte facultative pour les flux standards.");
  }
  throw new Error("API Awin programmes HTTP " + programmesResponse.status + " (aucune donnée catalogue écrite).");
}
const programmePayload = await programmesResponse.json();
const programmes = Array.isArray(programmePayload)
  ? programmePayload
  : (programmePayload.programmes || programmePayload.programs || programmePayload.data || []);
const eligible = programmes
  .map(program => ({ program, id: advertiserId(program) }))
  .filter(item => /^\d+$/.test(item.id))
  .slice(0, MAX_PROGRAMMES);

log(eligible.length + " partenariat(s) rejoint(s) à examiner.");
if (!eligible.length) {
  log("Aucun partenariat Awin rejoint : aucune fiche ni aucun prix artificiel ne sera créé.");
  process.exit(0);
}

const rawOffers = [];
const statusCounts = {};
let cursor = 0;
async function worker() {
  while (cursor < eligible.length && rawOffers.length < MAX_PRODUCTS) {
    const item = eligible[cursor++];
    const url = "https://api.awin.com/publishers/" + encodeURIComponent(PUBLISHER_ID) +
      "/awinfeeds/download/" + encodeURIComponent(item.id + "-retail-" + LOCALE + ".jsonl");
    try {
      const response = await request(url, "Flux annonceur " + item.id);
      statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
      if (!response.ok) continue;
      const body = await response.text();
      const rows = parseJsonl(body);
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
const standardImported = await loadStandardAwinFeeds(rawOffers);
if (standardImported) log(standardImported+" offre(s) supplémentaire(s) depuis les flux standards.");

if (!rawOffers.length) {
  log("Aucun flux Enhanced fr_FR exploitable parmi les partenariats rejoints. Le dernier catalogue valide est conservé.");
  log("Codes HTTP rencontrés : " + JSON.stringify(statusCounts));
  process.exit(0);
}

const fetchedAt = new Date().toISOString();
const products = aggregateOffers(rawOffers, fetchedAt).slice(0, MAX_PRODUCTS);
const output = {
  schema_version: 1,
  source: "Awin Publisher Enhanced Retail Feeds",
  publisher_id: PUBLISHER_ID,
  locale: LOCALE,
  fetched_at: fetchedAt,
  status: "ok",
  counts: {
    joined_advertisers_checked: eligible.length,
    products: products.length,
    merchant_offers: rawOffers.length,
    brands: new Set(products.map(product => norm(product.brand))).size
  },
  products,
  attribution: "Données produits, prix, images et liens provenant des flux marchands Awin accessibles au compte éditeur Prix Malin. Prix et disponibilité à reconfirmer sur la fiche marchande."
};

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, JSON.stringify(output) + "\n", "utf8");
log(products.length + " fiche(s) produits, " + rawOffers.length + " offre(s), " + output.counts.brands + " marque(s).");
log("Catalogue autorisé mis à jour : data/awin-products.json");

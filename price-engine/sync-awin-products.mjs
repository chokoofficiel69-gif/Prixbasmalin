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
  const text = norm([row.google_product_category, row.product_type, row.product_category, row.product_name].join(" "));
  // Les familles précises passent avant les mots génériques comme « accessories ».
  if (/sock|chaussette|hosiery|collant|culotte|lingerie|underwear|tights|bas de |chausson|vetement|apparel|clothing|shoes|footwear|mode|chaussure|pantalon|robe|t shirt|tshirt|polo|fashion/.test(text)) return "fashion";
  if (/electronics|electronic|computer|phone|mobile|audio|camera|television|informatique|electronique|video|gaming|laptop|smartphone|casque|ecouteur/.test(text)) return "tech";
  if (/home|garden|furniture|kitchen|household|maison|jardin|cuisine|bathroom|bath|salle de bain|soap|lotion dispenser|bathroom accessory|bedding|literie|decoration|deco|home decor/.test(text)) return "home";
  if (/beauty|cosmetic|personal care|health|beaute|soin|parfum|perfume|fragrance|maquillage|makeup|skincare|cosmetique|eau de parfum|eau de toilette/.test(text)) return "beauty";
  if (/sport|fitness|outdoor|sports equipment|running|cycling|training|gym|musculation/.test(text)) return "sport";
  if (/baby|toys|toy|toys games|children|bebe|enfant|jouet|puericulture|nursery/.test(text)) return "kids";
  if (/vehicle|automotive|auto|moto|car parts|car accessories|automobile/.test(text)) return "auto";
  if (/accessories|accessoire/.test(text)) return "fashion";
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

function stockState(value) {
  const stock = norm(value).replace(/[_-]+/g, " ");
  if (/out of stock|outofstock|rupture|discontinued|sold out|indisponible|false|\bno\b/.test(stock)) return "out_of_stock";
  if (/in stock|instock|available|disponible|for sale|\byes\b|\btrue\b/.test(stock)) return "in_stock";
  return "unknown";
}

function parseDirectFeedRow(row) {
  const currency = String(row.currency || "EUR").trim().toUpperCase();
  const price = parseFeedMoney(row.search_price || row.display_price || row.store_price || row.price || "", currency);
  const shippingPrice = parseFeedMoney(row.delivery_cost || row.shipping_cost || row.shipping || "", currency, true);
  const stock = stockState([row.stock_status, row.availability, row.is_for_sale, row.in_stock].filter(Boolean).join(" "));
  const adultFlag = norm([row.adult, row.adult_content, row.is_adult].filter(Boolean).join(" "));
  const categoryText = norm([row.merchant_category, row.category_name, row.product_type, row.product_name].filter(Boolean).join(" "));
  if (/^(1|yes|true|adult)$/.test(adultFlag) || /adult products?|sex toys?|erotic|erotique/.test(categoryText)) return null;
  if (!price || currency !== "EUR" || stock === "out_of_stock") return null;
  const advertiser = String(row.merchant_id || row.advertiser_id || row.data_feed_id || "awin-standard").trim();
  const program = { name: String(row.merchant_name || ("Annonceur Awin " + advertiser)).trim() };
  const normalized = {
    id: row.aw_product_id || row.merchant_product_id || row.product_id || row.ean || row.gtin || "",
    title: row.product_name || row.title || "",
    description: row.description || row.product_short_description || "",
    brand: row.brand_name || row.brand || row.product_brand || row.manufacturer_name || row.manufacturer || "",
    product_type: row.merchant_category || row.category_name || row.google_product_category || row.product_type || "",
    google_product_category: row.google_product_category || row.category_name || row.merchant_category || "",
    color: row.colour || row.color || "",
    size: row.size || "",
    gtin: row.gtin || row.ean || row.product_ean || row.product_gtin || row.upc || row.barcode || "",
    mpn: row.mpn || row.model_number || row.manufacturer_part_number || row.product_mpn || row.manufacturer_sku || row.part_number || "",
    image_link: row.merchant_image_url || row.aw_image_url || row.image_link || row.aw_thumb_url || "",
    additional_image_link: [row.alternate_image, row.alternate_image_two, row.alternate_image_three].filter(Boolean),
    price: price.toFixed(2) + " EUR",
    availability: stock,
    aw_deep_link: row.aw_deep_link || "",
    shipping_price_eur: shippingPrice,
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
      if (!headers.has("product_name") || !(headers.has("search_price") || headers.has("store_price") || headers.has("display_price"))) {
        throw new Error("Les colonnes produit/prix attendues sont absentes du flux Awin.");
      }
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
  const stock = stockState([row.stock_status,row.availability,row.is_for_sale,row.in_stock].filter(Boolean).join(" "));
  if (!price || String(currency).toUpperCase() !== "EUR" || stock !== "in_stock") return null;
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
    price: price.toFixed(2) + " EUR",
    availability: "in_stock",
    aw_deep_link: row.aw_deep_link || row.merchant_deep_link || row.purl,
    shipping_price_eur: parseFeedMoney(row.delivery_cost || row.shipping, currency, true),
    last_updated: row.last_updated || ""
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

function offerFromRow(row, program, advertiser, { allowUnknownAvailability = false } = {}) {
  const name = String(row.title || row.product_name || "").trim().replace(/\s+/g, " ");
  const brand = String(row.brand || row.brand_name || "").trim();
  const images = imageList(row);
  const link = httpsUrl(row.aw_deep_link || row.link || row.mobile_link);
  const availability = stockState(row.availability || row.stock_status || "");
  const regular = parseMoney(row.price || row.search_price);
  const sale = currentSalePrice(row, Date.now());
  const price = sale || regular;
  if (!name || !images.length || !link || !price || availability === "out_of_stock" ||
      (availability !== "in_stock" && !allowUnknownAvailability)) return null;
  if (/^(yes|true|1|adult)$/i.test(String(row.adult || row.adult_content || ""))) return null;
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
    availability,
    shipping: row.shipping || row.delivery_cost || null,
    shipping_price_eur: Number.isFinite(row.shipping_price_eur) ? row.shipping_price_eur : null,
    merchant_updated_at: row.last_updated || null,
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
      availability: best.availability,
      shippingPriceValue: best.shipping_price_eur,
      merchantUpdatedAt: best.merchant_updated_at,
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
        shipping: item.shipping,
        shippingPriceValue: item.shipping_price_eur,
        availability: item.availability,
        merchantUpdatedAt: item.merchant_updated_at
      })),
      isAwinProduct: true,
      priceSource: "Awin — flux marchand autorisé",
      fetchedAt
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}


async function loadEnhancedAwinFeeds(rawOffers) {
  if (!TOKEN) {
    throw new Error("Configurer AWIN_PRODUCT_DATA_FEED_URL (flux direct) ou AWIN_API_TOKEN (API éditeur Awin).");
  }
  const programmesResponse = await request(
    "https://api.awin.com/publishers/" + encodeURIComponent(PUBLISHER_ID) + "/programmes?relationship=joined",
    "Liste des partenariats"
  );
  if (!programmesResponse.ok) {
    if ([401,403].includes(programmesResponse.status)) {
      log("Accès Awin Publisher refusé (HTTP " + programmesResponse.status + "). Le jeton éditeur n'est pas accepté ; aucune donnée produit n'a été modifiée.");
      throw new Error("Authentification Awin Publisher refusée (HTTP " + programmesResponse.status + "). Vérifier AWIN_API_TOKEN et les droits éditeur.");
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
    throw new Error("Aucun partenariat Awin rejoint : ajouter AWIN_PRODUCT_DATA_FEED_URL ou obtenir l'approbation d'un programme marchand.");
  }
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
  const standardImported = await loadStandardAwinFeeds(rawOffers);
  if (standardImported) log(standardImported + " offre(s) supplémentaire(s) depuis les flux standards.");
  if (!rawOffers.length) {
    log("Aucune offre Awin exploitable. Codes HTTP : " + JSON.stringify(statusCounts));
    throw new Error("Aucune offre Awin exploitable : vérifier les partenariats, flux Enhanced et flux standards autorisés.");
  }
  return eligible.length;
}

function runSelfTests() {
  const sampleCsv = 'aw_deep_link,product_name,aw_product_id,merchant_product_id,merchant_image_url,merchant_category,search_price,merchant_name,merchant_id,currency,delivery_cost,language,last_updated,brand_name,gtin,manufacturer_part_number\n' +
    '"https://www.awin1.com/cread.php?awinmid=123&id=1","Casque Audio X","501","SKU-1","https://cdn.example/image.jpg","Audio","49.90","Boutique Test","123","EUR","4.99","fr","2026-11-04T10:00:00Z","AudioBrand","3701234567890","AB-X1"';
  const rows = objectRowsFromCsv(sampleCsv);
  const offer = parseDirectFeedRow(rows[0]);
  if (!offer) throw new Error("TEST ÉCHEC : un flux direct valide doit produire une offre.");
  if (offer.price_eur !== 49.9 || offer.shipping_price_eur !== 4.99 || offer.availability !== "unknown" ||
      offer.brand !== "AudioBrand" || offer.gtin !== "3701234567890" || offer.mpn !== "AB-X1") {
    throw new Error("TEST ÉCHEC : prix, livraison, marque, GTIN, MPN ou disponibilité mal traités.");
  }
  const categoryCases = [
    [{ product_type: "Home & Garden, Bathroom Accessories, Soap & Lotion Dispensers" }, "home"],
    [{ product_type: "Parfums > Parfums pour Femme > Eau de Parfum Femme" }, "beauty"],
    [{ product_type: "Chaussettes de sport" }, "fashion"],
    [{ product_type: "Electronics > Audio > Headphones" }, "tech"],
    [{ product_type: "Sports & Fitness > Running" }, "sport"],
    [{ product_type: "Toys & Games > Children" }, "kids"]
  ];
  for (const [row, expected] of categoryCases) {
    if (categoryFor(row) !== expected) {
      throw new Error("TEST ÉCHEC : catégorie attendue " + expected + " pour " + JSON.stringify(row));
    }
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
  log("Autotests réussis : CSV, prix EUR, livraison, statut inconnu, rupture, devise et URL sécurisée.");
}

if (process.argv.includes("--self-test")) {
  runSelfTests();
} else {
  const rawOffers = [];
  const directFeedConfigured = Boolean(process.env.AWIN_PRODUCT_DATA_FEED_URL);
  let joinedAdvertisersChecked = 0;
  if (directFeedConfigured) {
    await loadDirectAwinFeed(rawOffers);
  } else {
    joinedAdvertisersChecked = await loadEnhancedAwinFeeds(rawOffers);
  }
  if (!rawOffers.length) throw new Error("Aucune offre Awin exploitable : le catalogue précédent est conservé.");
const fetchedAt = new Date().toISOString();
const products = aggregateOffers(rawOffers, fetchedAt).slice(0, MAX_PRODUCTS);
const output = {
  schema_version: 1,
  source: directFeedConfigured ? "Awin Direct Product Data Feed" : "Awin Publisher Enhanced Retail Feeds",
  publisher_id: PUBLISHER_ID,
  locale: LOCALE,
  fetched_at: fetchedAt,
  status: "ok",
  counts: {
    joined_advertisers_checked: joinedAdvertisersChecked,
    products: products.length,
    merchant_offers: rawOffers.length,
    merchants: new Set(rawOffers.map(offer => norm(offer.merchant)).filter(Boolean)).size,
    brands: new Set(products.map(product => norm(product.brand)).filter(Boolean)).size,
    products_with_gtin: products.filter(product => /^(?:\\d{8}|\\d{12,14})$/.test(String(product.gtin || "").replace(/\\D/g, ""))).length,
    products_with_mpn: products.filter(product => Boolean(String(product.mpn || "").trim())).length,
    multi_merchant_products: products.filter(product => new Set((product.offers || []).map(offer => norm(offer.merchant)).filter(Boolean)).size > 1).length,
    offers_with_shipping: rawOffers.filter(offer => Number.isFinite(offer.shipping_price_eur) && offer.shipping_price_eur >= 0).length,
    offers_with_availability: rawOffers.filter(offer => offer.availability && offer.availability !== "unknown").length,
    products_other_category: products.filter(product => product.category === "other").length
  },
  products,
  attribution: "Données produits, prix, images et liens provenant des flux marchands Awin accessibles au compte éditeur Prix Malin. Prix et disponibilité à reconfirmer sur la fiche marchande."
};

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, JSON.stringify(output) + "\n", "utf8");
log(products.length + " fiche(s) produits, " + rawOffers.length + " offre(s), " + output.counts.brands + " marque(s).");
log("Catalogue autorisé mis à jour : data/awin-products.json");
}

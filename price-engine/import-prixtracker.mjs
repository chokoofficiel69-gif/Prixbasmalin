import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const args = process.argv.slice(2);
const inputFlag = args.indexOf("--input");
const outputFlag = args.indexOf("--output");
if (inputFlag < 0 || !args[inputFlag + 1]) {
  console.error("Usage: node price-engine/import-prixtracker.mjs --input <csv> [--output <json>]");
  process.exit(2);
}
const inputPath = path.resolve(args[inputFlag + 1]);
const outputPath = path.resolve(outputFlag >= 0 && args[outputFlag + 1]
  ? args[outputFlag + 1]
  : "data/prixtracker-prices.json");

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
  if (quoted) throw new Error("CSV invalide : guillemet non refermé.");
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

const required = [
  "date", "produit_id", "produit", "categorie", "marque", "marchand",
  "prix_min_eur_ttc", "prix_max_eur_ttc", "nb_releves", "source"
];
const raw = await fs.readFile(inputPath, "utf8");
const rows = parseCsv(raw);
if (rows.length < 2) throw new Error("CSV vide ou sans lignes de données.");
const headers = rows[0].map(value => value.trim().replace(/^\uFEFF/, ""));
const missing = required.filter(name => !headers.includes(name));
if (missing.length) throw new Error(`Colonnes manquantes : ${missing.join(", ")}`);
const index = Object.fromEntries(required.map(name => [name, headers.indexOf(name)]));
const offers = [];
const errors = [];
for (let line = 2; line <= rows.length; line++) {
  const cells = rows[line - 1];
  if (cells.length !== headers.length) {
    errors.push({line, reason: "Nombre de colonnes incorrect"});
    continue;
  }
  const get = name => String(cells[index[name]] ?? "").trim();
  const date = get("date");
  const productId = get("produit_id");
  const product = get("produit");
  const merchant = get("marchand");
  const minPrice = Number(get("prix_min_eur_ttc"));
  const maxPrice = Number(get("prix_max_eur_ttc"));
  const count = Number(get("nb_releves"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !productId || !product || !merchant ||
      !Number.isFinite(minPrice) || !Number.isFinite(maxPrice) ||
      minPrice <= 0 || maxPrice < minPrice || !Number.isInteger(count) || count < 1) {
    errors.push({line, reason: "Date, identité, prix ou nombre de relevés invalide"});
    continue;
  }
  offers.push({
    date,
    product_id: productId,
    product,
    category: get("categorie"),
    brand: get("marque"),
    merchant,
    min_price_eur_ttc: Math.round(minPrice * 100) / 100,
    max_price_eur_ttc: Math.round(maxPrice * 100) / 100,
    observation_count: count,
    source: get("source") || "PrixTracker"
  });
}
if (!offers.length) throw new Error("Aucune ligne valide : aucun fichier de sortie créé.");
const products = new Map();
for (const offer of offers) {
  if (!products.has(offer.product_id)) {
    products.set(offer.product_id, {
      id: offer.product_id, name: offer.product, category: offer.category, brand: offer.brand
    });
  }
}
const dates = offers.map(offer => offer.date).sort();
const output = {
  version: 1,
  dataset: "PrixTracker — prix par marchand",
  source_url: "https://prixtracker.fr/donnees/prix-par-marchand.csv",
  license: "Licence Ouverte 2.0",
  attribution: "Source : PrixTracker (prixtracker.fr), données réutilisées sous Licence Ouverte 2.0.",
  generated_at: new Date().toISOString(),
  dataset_period: {from: dates[0], to: dates[dates.length - 1]},
  status: "historical_reference",
  methodology: "Relevés historiques fournis par PrixTracker. Les prix ne sont pas des offres disponibles en temps réel. Aucun lien marchand ni frais de livraison n'est fourni par le CSV.",
  counts: {
    rows: offers.length,
    products: products.size,
    merchants: new Set(offers.map(offer => offer.merchant)).size,
    categories: new Set(offers.map(offer => offer.category)).size,
    rejected_rows: errors.length
  },
  products: [...products.values()].sort((a, b) => a.name.localeCompare(b.name, "fr")),
  offers: offers.sort((a, b) =>
    a.product_id.localeCompare(b.product_id) ||
    b.date.localeCompare(a.date) ||
    a.min_price_eur_ttc - b.min_price_eur_ttc ||
    a.merchant.localeCompare(b.merchant, "fr")
  ),
  import_errors: errors
};
await fs.mkdir(path.dirname(outputPath), {recursive: true});
await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(`Import PrixTracker terminé : ${output.counts.rows} lignes, ${output.counts.products} produits, ${output.counts.merchants} marchands, ${errors.length} ligne(s) rejetée(s).`);
console.log(`Sortie : ${outputPath}`);

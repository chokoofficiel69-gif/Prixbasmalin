import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const inputFlag = args.indexOf("--input");
const outputFlag = args.indexOf("--output");
if (inputFlag < 0 || !args[inputFlag + 1]) {
  console.error("Usage: node price-engine/import-prixtracker-best-daily.mjs --input <csv> [--output <json>]");
  process.exit(2);
}
const inputPath = path.resolve(args[inputFlag + 1]);
const outputPath = path.resolve(outputFlag >= 0 && args[outputFlag + 1]
  ? args[outputFlag + 1]
  : "data/prixtracker-best-daily.json");

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
  "date", "produit_id", "produit", "categorie", "marque",
  "marchand_du_meilleur_prix", "prix_eur_ttc", "source"
];
const rows = parseCsv(await fs.readFile(inputPath, "utf8"));
if (rows.length < 2) throw new Error("CSV vide ou sans lignes de données.");
const headers = rows[0].map(value => value.trim().replace(/^\uFEFF/, ""));
const missing = required.filter(name => !headers.includes(name));
if (missing.length) throw new Error(`Colonnes manquantes : ${missing.join(", ")}`);
const index = Object.fromEntries(required.map(name => [name, headers.indexOf(name)]));
const records = [];
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
  const merchant = get("marchand_du_meilleur_prix");
  const price = Number(get("prix_eur_ttc"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !productId || !product ||
      !merchant || !Number.isFinite(price) || price <= 0) {
    errors.push({line, reason: "Date, identité produit, marchand ou prix invalide"});
    continue;
  }
  records.push({
    date,
    product_id: productId,
    product,
    category: get("categorie"),
    brand: get("marque"),
    lowest_observed_merchant: merchant,
    lowest_observed_price_eur_ttc: Math.round(price * 100) / 100,
    source: get("source") || "PrixTracker"
  });
}
if (!records.length) throw new Error("Aucune ligne valide : aucun fichier de sortie créé.");
const productMap = new Map();
for (const item of records) {
  if (!productMap.has(item.product_id)) {
    productMap.set(item.product_id, {
      id: item.product_id, name: item.product, category: item.category, brand: item.brand
    });
  }
}
const dates = records.map(item => item.date).sort();
const output = {
  version: 1,
  dataset: "PrixTracker — meilleur prix du jour",
  source_url: "https://prixtracker.fr/donnees/meilleur-prix-du-jour.csv",
  license: "Licence Ouverte 2.0",
  attribution: "Source : PrixTracker (prixtracker.fr), données réutilisées sous Licence Ouverte 2.0.",
  generated_at: new Date().toISOString(),
  dataset_period: {from: dates[0], to: dates[dates.length - 1]},
  status: "historical_reference",
  methodology: "Historique du prix minimum observé par produit et par jour chez les marchands suivis. Ce relevé n'est pas une offre disponible en temps réel; le CSV ne fournit ni URL produit ni preuve de stock.",
  counts: {
    rows: records.length,
    products: productMap.size,
    merchants: new Set(records.map(item => item.lowest_observed_merchant)).size,
    categories: new Set(records.map(item => item.category)).size,
    unknown_merchant_rows: records.filter(item => /^(inconnu|unknown)$/i.test(item.lowest_observed_merchant)).length,
    rejected_rows: errors.length
  },
  products: [...productMap.values()].sort((a,b) => a.name.localeCompare(b.name,"fr")),
  records: records.sort((a,b) =>
    a.product_id.localeCompare(b.product_id) ||
    b.date.localeCompare(a.date) ||
    a.lowest_observed_price_eur_ttc - b.lowest_observed_price_eur_ttc
  ),
  import_errors: errors
};
await fs.mkdir(path.dirname(outputPath), {recursive:true});
await fs.writeFile(outputPath, JSON.stringify(output,null,2)+"\n");
console.log(`Import PrixTracker meilleur prix terminé : ${output.counts.rows} lignes, ${output.counts.products} produits, ${output.counts.merchants} marchands, ${errors.length} ligne(s) rejetée(s).`);
console.log(`Sortie : ${outputPath}`);

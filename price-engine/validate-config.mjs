import fs from "node:fs/promises";
import { secureUrl } from "./price-utils.mjs";

const configUrl = new URL("./products.json", import.meta.url);
const config = JSON.parse(await fs.readFile(configUrl, "utf8"));
const problems = [];
const products = config?.products;

if (!Array.isArray(products)) {
  console.error("Configuration invalide : « products » doit être un tableau.");
  process.exit(1);
}

const ids = new Set();
for (const [index, product] of products.entries()) {
  const prefix = `products[${index}]`;
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    problems.push(`${prefix} : fiche produit invalide.`);
    continue;
  }
  if (typeof product.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(product.id)) {
    problems.push(`${prefix}.id : identifiant manquant ou format invalide.`);
  } else if (ids.has(product.id)) {
    problems.push(`${prefix}.id : identifiant dupliqué « ${product.id} ».`);
  } else {
    ids.add(product.id);
  }
  if (typeof product.name !== "string" || !product.name.trim()) {
    problems.push(`${prefix}.name : nom exact du produit requis.`);
  }
  if (product.match_terms !== undefined &&
      (!Array.isArray(product.match_terms) || product.match_terms.some(term => typeof term !== "string" || !term.trim()))) {
    problems.push(`${prefix}.match_terms : chaque terme distinctif doit être un texte non vide.`);
  }
  if (!Array.isArray(product.sources) || product.sources.length === 0) {
    problems.push(`${prefix}.sources : au moins une source marchande HTTPS est requise.`);
    continue;
  }
  const retailers = new Set();
  for (const [sourceIndex, source] of product.sources.entries()) {
    const sourcePrefix = `${prefix}.sources[${sourceIndex}]`;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      problems.push(`${sourcePrefix} : source invalide.`);
      continue;
    }
    if (typeof source.retailer !== "string" || !source.retailer.trim()) {
      problems.push(`${sourcePrefix}.retailer : nom du marchand requis.`);
    } else if (retailers.has(source.retailer.trim().toLowerCase())) {
      problems.push(`${sourcePrefix}.retailer : marchand dupliqué pour ce produit.`);
    } else {
      retailers.add(source.retailer.trim().toLowerCase());
    }
    const url = secureUrl(source.url);
    if (!url) {
      problems.push(`${sourcePrefix}.url : URL HTTPS publique valide requise.`);
    } else {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname === "localhost" || hostname.endsWith(".localhost") ||
          hostname.endsWith(".local") || /^127\./.test(hostname) ||
          hostname === "0.0.0.0" || hostname === "::1" ||
          /^10\./.test(hostname) || /^192\.168\./.test(hostname) ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
        problems.push(`${sourcePrefix}.url : hôte local/privé refusé.`);
      }
    }
  }
}

if (problems.length) {
  console.error("Échec de validation de la configuration des prix :");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

if (products.length === 0) {
  console.log("Configuration valide, mais aucun produit n'est configuré : aucune offre réelle ne sera publiée.");
} else {
  console.log(`Configuration valide : ${products.length} produit(s), ${products.reduce((n, p) => n + p.sources.length, 0)} source(s) déclarée(s).`);
}

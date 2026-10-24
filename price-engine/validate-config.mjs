import fs from "node:fs/promises";
import { isSafeMerchantUrl } from "./price-utils.mjs";

export function isValidEan13(value) {
  if (typeof value !== "string" || !/^\\d{13}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

const configUrl = new URL("./products.json", import.meta.url);
const config = JSON.parse(await fs.readFile(configUrl, "utf8"));
const problems = [];
const products = config?.products;
if (!Array.isArray(products)) {
  console.error("Configuration invalide : « products » doit être un tableau.");
  process.exit(1);
}
const ids = new Set();
const eans = new Set();
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
  } else ids.add(product.id);
  if (typeof product.name !== "string" || !product.name.trim()) problems.push(`${prefix}.name : nom exact du produit requis.`);
  if (!isValidEan13(product.ean)) {
    problems.push(`${prefix}.ean : EAN-13 obligatoire, 13 chiffres et clé de contrôle valide.`);
  } else if (eans.has(product.ean)) {
    problems.push(`${prefix}.ean : EAN dupliqué « ${product.ean} ».`);
  } else eans.add(product.ean);
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
    } else retailers.add(source.retailer.trim().toLowerCase());
    if (!isSafeMerchantUrl(source.url)) problems.push(`${sourcePrefix}.url : domaine public HTTPS requis ; URL avec IP, hôte local, identifiants ou port non standard refusée.`);
  }
}
if (problems.length) {
  console.error("Échec de validation de la configuration des prix :");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(products.length === 0
  ? "Configuration valide, mais aucun produit n'est configuré : aucune offre réelle ne sera publiée."
  : `Configuration valide : ${products.length} produit(s), ${products.reduce((n, p) => n + p.sources.length, 0)} source(s) déclarée(s).`);

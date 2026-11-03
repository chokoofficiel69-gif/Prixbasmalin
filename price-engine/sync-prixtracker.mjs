import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const datasetSlug = "releves-quotidiens-de-prix-de-produits-high-tech-en-france-prixtracker";
const apiUrl = "https://www.data.gouv.fr/api/1/datasets/" + datasetSlug + "/";
const timeoutMs = 45000;

async function getJson(url) {
  const response = await fetch(url, {headers: {"accept":"application/json"}, signal:AbortSignal.timeout(timeoutMs)});
  if (!response.ok) throw new Error("API data.gouv.fr HTTP " + response.status + " (" + url + ")");
  return response.json();
}
async function fetchDataset() {
  try {
    const direct = await getJson(apiUrl);
    if (Array.isArray(direct.resources)) return direct;
  } catch (error) {
    console.warn("Accès direct au jeu de données impossible :", error.message);
  }
  const search = await getJson("https://www.data.gouv.fr/api/1/datasets/?q=PrixTracker&page_size=20");
  const rows = Array.isArray(search.data) ? search.data : [];
  const match = rows.find(item => item.slug === datasetSlug || item.page === "/datasets/" + datasetSlug);
  if (!match?.id) throw new Error("Jeu de données PrixTracker introuvable dans le catalogue data.gouv.fr");
  return getJson("https://www.data.gouv.fr/api/1/datasets/" + match.id + "/");
}
function norm(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
}
function findResource(resources, kind) {
  const allFamily = resources.filter(resource => {
    const title = norm([resource.title,resource.description,resource.type].join(" "));
    const format = norm(resource.format || resource.mime || "");
    return title.includes("toutes familles") && title.includes(kind) &&
      (!format || format.includes("csv") || String(resource.url || "").toLowerCase().includes(".csv"));
  });
  if (allFamily.length) return allFamily.sort((a,b) => String(b.last_modified || "").localeCompare(String(a.last_modified || "")))[0];
  throw new Error("Ressource CSV « " + kind + " — toutes familles » absente du jeu de données PrixTracker");
}
function resourceUrl(resource) {
  const candidates = [
    resource.latest?.url,
    typeof resource.latest === "string" ? resource.latest : null,
    resource.url,
    resource.file?.url
  ];
  const candidate = candidates.find(value => typeof value === "string" && /^https:\/\//i.test(value));
  if (!candidate) throw new Error("URL de téléchargement manquante pour " + (resource.title || "ressource"));
  return candidate;
}
async function downloadCsv(resource) {
  const url = resourceUrl(resource);
  const response = await fetch(url, {headers: {"accept":"text/csv,text/plain,*/*"},signal:AbortSignal.timeout(timeoutMs)});
  if (!response.ok) throw new Error("Téléchargement CSV HTTP " + response.status + " (" + url + ")");
  const text = await response.text();
  const header = text.split(/\r?\n/,1)[0].replace(/^\uFEFF/,"").toLowerCase();
  if (!header.includes("date") || !header.includes("produit_id") || !header.includes("marchand") || !header.includes("prix")) {
    throw new Error("Le fichier téléchargé ne présente pas l'en-tête CSV PrixTracker attendu.");
  }
  if (text.trim().split(/\r?\n/).length < 2) throw new Error("CSV PrixTracker vide : fichier de production non remplacé.");
  return {text,url:response.url || url};
}
function runImporter(script,input,output,sourceUrl) {
  const result = spawnSync(process.execPath,[path.join(root,"price-engine",script),"--input",input,"--output",output],{
    cwd:root,encoding:"utf8",env:{...process.env,PRIXTRACKER_SOURCE_URL:sourceUrl},timeout:90000
  });
  if (result.status !== 0) throw new Error("Import "+script+" échoué : "+(result.stderr||result.stdout||result.error?.message||"erreur inconnue").slice(-1600));
  return result.stdout.trim();
}

const dataset = await fetchDataset();
const resources = Array.isArray(dataset.resources) ? dataset.resources : [];
const perMerchantResource = findResource(resources,"prix par marchand");
const bestDailyResource = findResource(resources,"meilleur prix du jour");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(),"prixtracker-"));
try {
  const perMerchant = await downloadCsv(perMerchantResource);
  const bestDaily = await downloadCsv(bestDailyResource);
  const perMerchantCsv = path.join(tmp,"prix-par-marchand.csv");
  const bestDailyCsv = path.join(tmp,"meilleur-prix-du-jour.csv");
  const perMerchantJson = path.join(tmp,"prix-par-marchand.json");
  const bestDailyJson = path.join(tmp,"meilleur-prix-du-jour.json");
  await Promise.all([fs.writeFile(perMerchantCsv,perMerchant.text),fs.writeFile(bestDailyCsv,bestDaily.text)]);
  const logs = [
    runImporter("import-prixtracker.mjs",perMerchantCsv,perMerchantJson,perMerchant.url),
    runImporter("import-prixtracker-best-daily.mjs",bestDailyCsv,bestDailyJson,bestDaily.url)
  ];
  const [merchantData,bestData] = await Promise.all([
    fs.readFile(perMerchantJson,"utf8").then(JSON.parse),
    fs.readFile(bestDailyJson,"utf8").then(JSON.parse)
  ]);
  if (!merchantData.counts?.rows || !merchantData.counts?.products || !bestData.counts?.rows || !bestData.counts?.products) {
    throw new Error("Contrôle qualité : les exports PrixTracker ne contiennent aucune donnée produit exploitable.");
  }
  for (const data of [merchantData,bestData]) {
    data.source_dataset = "https://www.data.gouv.fr/datasets/" + datasetSlug;
    data.dataset_license = "Licence Ouverte 2.0";
    data.attribution = "Source : PrixTracker (prixtracker.fr/donnees), réutilisé sous Licence Ouverte 2.0 via data.gouv.fr.";
  }
  await fs.writeFile(path.join(root,"data/prixtracker-prices.json"),JSON.stringify(merchantData,null,2)+"\n");
  await fs.writeFile(path.join(root,"data/prixtracker-best-daily.json"),JSON.stringify(bestData,null,2)+"\n");
  console.log("Synchronisation PrixTracker terminée.");
  console.log("Prix par marchand :",merchantData.counts.rows,"relevés,",merchantData.counts.products,"produits,",merchantData.counts.merchants,"marchands.");
  console.log("Meilleur prix quotidien :",bestData.counts.rows,"relevés,",bestData.counts.products,"produits.");
  console.log("Ressources utilisées :",perMerchant.url,bestDaily.url);
  console.log(logs.join("\n"));
} finally {
  await fs.rm(tmp,{recursive:true,force:true});
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const script = new URL("./import-prixtracker.mjs", import.meta.url);
const header = "date,produit_id,produit,categorie,marque,marchand,prix_min_eur_ttc,prix_max_eur_ttc,nb_releves,source";
const row = '2026-11-19,p-1,"Casque, modèle X",audio,Marque,Marchand A,99.9,109.9,3,source';

async function runImporter(csv) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prixtracker-test-"));
  const input = path.join(dir, "input.csv");
  const output = path.join(dir, "output.json");
  await fs.writeFile(input, csv);
  const result = spawnSync(process.execPath, [script.pathname, "--input", input, "--output", output], {encoding:"utf8"});
  return {dir, output, result};
}

test("importe les champs CSV cités et conserve l'identité produit/marchand", async () => {
  const run = await runImporter(header + "\n" + row + "\n");
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    const data = JSON.parse(await fs.readFile(run.output, "utf8"));
    assert.equal(data.status, "historical_reference");
    assert.equal(data.counts.rows, 1);
    assert.equal(data.counts.products, 1);
    assert.equal(data.offers[0].product, "Casque, modèle X");
    assert.equal(data.offers[0].min_price_eur_ttc, 99.9);
    assert.equal(data.offers[0].date, "2026-11-19");
    assert.match(data.methodology, /historiques/);
    assert.equal(data.offers[0].url, undefined);
    assert.equal(data.offers[0].gtin, undefined);
  } finally {
    await fs.rm(run.dir, {recursive:true, force:true});
  }
});

test("rejette un fichier sans les colonnes obligatoires sans créer de snapshot", async () => {
  const run = await runImporter("date,produit\n2026-11-19,test\n");
  try {
    assert.notEqual(run.result.status, 0);
    await assert.rejects(fs.access(run.output));
  } finally {
    await fs.rm(run.dir, {recursive:true, force:true});
  }
});

test("ne remplace pas les prix par des offres en temps réel", async () => {
  const run = await runImporter(header + "\n" + row + "\n");
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    const data = JSON.parse(await fs.readFile(run.output, "utf8"));
    assert.equal(data.status, "historical_reference");
    assert.match(data.methodology, /pas des offres marchandes en direct/);
    assert.match(data.attribution, /PrixTracker/);
    assert.match(data.license, /Licence Ouverte 2.0/);
  } finally {
    await fs.rm(run.dir, {recursive:true, force:true});
  }
});

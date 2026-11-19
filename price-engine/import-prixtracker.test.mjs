import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, normalizeCsv } from "./import-prixtracker.mjs";

const header = "date,produit_id,produit,categorie,marque,marchand,prix_min_eur_ttc,prix_max_eur_ttc,nb_releves,source";
const row = '2026-11-19,p-1,"Casque, modèle X",audio,Marque,Marchand A,99.9,109.9,3,source';

test("parse CSV avec virgule dans un champ cité", () => {
  assert.equal(parseCsv(header + "\\n" + row)[1][2], "Casque, modèle X");
});

test("conserve les relevés TTC datés sans inventer de lien ni de GTIN", () => {
  const data = normalizeCsv(header + "\\n" + row, "2026-11-19T12:00:00Z");
  assert.equal(data.record_count, 1);
  assert.equal(data.records[0].min_price_eur_ttc, 99.9);
  assert.equal(data.records[0].date, "2026-11-19");
  assert.equal(data.source, "PrixTracker");
  assert.match(data.disclaimer, /Pas de GTIN/);
});

test("rejette les intervalles de prix incohérents", () => {
  assert.throws(() => normalizeCsv(header + "\\n" + row.replace("99.9,109.9", "110,109")), /Intervalle de prix invalide/);
});

test("rejette un CSV sans les colonnes obligatoires", () => {
  assert.throws(() => normalizeCsv("date,produit\\n2026-11-19,x"), /Colonne obligatoire absente/);
});

import test from "node:test";
import { appendPreviousFeedOffers } from "../scripts/import-tradedoubler-products.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("conserve les offres précédentes si la date du flux est absente", () => {
  const collected = [];
  const previous = new Map([[123, [{ feed_id: 123, price_eur: 19.99 }]]]);
  const count = appendPreviousFeedOffers(collected, previous, "123");
  assert.equal(count, 1);
  assert.deepEqual(collected, [{ feed_id: 123, price_eur: 19.99 }]);
});

test("refuse de remplacer un snapshot existant illisible", async () => {
  const source = await readFile(new URL("../scripts/import-tradedoubler-products.mjs", import.meta.url), "utf8");
  assert.match(source, /Snapshot Tradedoubler existant illisible ; aucun écrasement effectué/);
});
test("connecteur Tradedoubler : sécurité, filtrage FR/EUR et conservation de l'état", async () => {
  const source = await readFile(new URL("../scripts/import-tradedoubler-products.mjs", import.meta.url), "utf8");
  assert.match(source, /TRADEDOUBLER_PRODUCTS_TOKEN/);
  assert.match(source, /https:\/\/api\.tradedoubler\.com\/1\.0/);
  assert.match(source, /languageISOCode/);
  assert.match(source, /currencyISOCode/);
  assert.match(source, /lastUpdatedTime/);
  assert.match(source, /ancien snapshot conservé/);
  assert.match(source, /price_history/);
  assert.doesNotMatch(source, /process\.env\.TRADEDOUBLER_PRODUCTS_TOKEN\s*\|\|\s*["'].*token/i);
});

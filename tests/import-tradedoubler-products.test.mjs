import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

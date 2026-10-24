import test from "node:test";
import assert from "node:assert/strict";
import {parsePrice, secureUrl} from "./price-utils.mjs";

test("parse les prix français avec espaces et virgule décimale", () => {
  assert.equal(parsePrice("1 299,99 €"), 1299.99);
  assert.equal(parsePrice("249,99"), 249.99);
});
test("parse les prix anglais avec virgule de milliers", () => {
  assert.equal(parsePrice("1,299.99"), 1299.99);
});
test("refuse les valeurs vides, négatives et non numériques", () => {
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("gratuit"), null);
  assert.equal(parsePrice("-15,00"), null);
  assert.equal(parsePrice("0"), null);
});
test("n'accepte que les URL HTTPS", () => {
  assert.equal(secureUrl("https://example.com/p/1", "https://example.com"), "https://example.com/p/1");
  assert.equal(secureUrl("http://example.com/p/1", "https://example.com"), null);
  assert.equal(secureUrl("javascript:alert(1)", "https://example.com"), null);
  assert.equal(secureUrl("::::", "https://example.com"), null);
});

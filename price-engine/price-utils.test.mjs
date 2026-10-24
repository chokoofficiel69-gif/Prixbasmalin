import test from "node:test";
import assert from "node:assert/strict";
import {parsePrice, secureUrl, matchesProductIdentity, mergeFreshAndStaleOffers, parseExplicitEuroOffer, markOffersStale} from "./price-utils.mjs";

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
  assert.equal(secureUrl("::::", "not-a-url"), null);
});

test("n'accepte pas un autre modèle présent dans les données structurées", () => {
  assert.equal(matchesProductIdentity({name:"Apple AirPods Pro 2"}, {name:"Apple AirPods 4"}), false);
  assert.equal(matchesProductIdentity({name:"Apple AirPods 4"}, {name:"Apple AirPods 4"}), true);
});
test("permet une variante de titre seulement avec des termes distinctifs", () => {
  assert.equal(
    matchesProductIdentity({name:"Apple AirPods 4 — boîtier USB-C"},
      {name:"AirPods 4", match_terms:["AirPods 4", "USB-C"]}),
    true
  );
  assert.equal(
    matchesProductIdentity({name:"Apple AirPods Pro 2"},
      {name:"AirPods 4", match_terms:["AirPods 4"]}),
    false
  );
});

test("n'infère pas les euros quand la devise manque et ignore le prix agrégé", () => {
  assert.equal(parseExplicitEuroOffer({price:"79.99"}), null);
  assert.equal(parseExplicitEuroOffer({lowPrice:"79.99", priceCurrency:"EUR"}), null);
  assert.deepEqual(parseExplicitEuroOffer({price:"79,99", priceCurrency:"eur"}), {price:79.99, currency:"EUR"});
  assert.deepEqual(parseExplicitEuroOffer({priceSpecification:{price:"109.50",priceCurrency:"EUR"}}), {price:109.5,currency:"EUR"});
});

test("conserve une offre périmée si son marchand échoue, sans remplacer une offre fraîche", () => {
  const fresh = {product_id:"p1", retailer:"Darty", price_eur:120, stale:false};
  const oldDarty = {product_id:"p1", retailer:"Darty", price_eur:115, stale:false};
  const oldFnac = {product_id:"p1", retailer:"Fnac", price_eur:118, stale:false};
  const oldRemoved = {product_id:"p1", retailer:"Ancien marchand", price_eur:99, stale:false};
  const merged = mergeFreshAndStaleOffers(
    [fresh],
    [oldDarty, oldFnac, oldRemoved],
    [{id:"p1", sources:[{retailer:"Darty"},{retailer:"Fnac"}]}]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find(o=>o.retailer==="Darty").stale, false);
  assert.equal(merged.find(o=>o.retailer==="Fnac").stale, true);
  assert.equal(merged.some(o=>o.retailer==="Ancien marchand"), false);
});

test("marque périmées toutes les offres si aucune source ne réussit", () => {
  const old = {product_id:"p1", retailer:"Darty", price_eur:120};
  const merged = mergeFreshAndStaleOffers(
    [],
    [old],
    [{id:"p1", sources:[{retailer:"Darty"}]}]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].stale, true);
});

test("marque toutes les anciennes offres périmées sans modifier leurs prix", () => {
  const input = [{product_id:"p1",retailer:"Darty",price_eur:99.99,checked_at:"2026-01-01T00:00:00.000Z"}];
  const stale = markOffersStale(input, "Aucune source configurée");
  assert.equal(stale[0].price_eur, 99.99);
  assert.equal(stale[0].stale, true);
  assert.equal(stale[0].comparison_note, "Aucune source configurée");
  assert.equal(input[0].stale, undefined);
});

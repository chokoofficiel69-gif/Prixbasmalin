import test from "node:test";
import assert from "node:assert/strict";
import {parsePrice, secureUrl, isSafeMerchantUrl, resolveSafeRedirect, matchesProductIdentity, mergeFreshAndStaleOffers, parseExplicitEuroOffer, markOffersStale, extractOfferFromJsonLd, isOfferCurrent} from "./price-utils.mjs";

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
  assert.equal(parsePrice("prix : 79,99"), null);
  assert.equal(parsePrice("79,99 EUR"), null);
  assert.equal(parsePrice("£79.99"), null);
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

test("extrait une offre JSON-LD exacte avec prix EUR et URL HTTPS", () => {
  const jsonLd = {
    "@context":"https://schema.org",
    "@graph":[{
      "@type":"Product",
      "name":"Casque Audio Z 2",
      "url":"https://marchand.example/casque-z2",
      "offers":{
        "@type":"Offer",
        "price":"1 299,99",
        "priceCurrency":"EUR",
        "availability":"https://schema.org/InStock"
      }
    }]
  };
  const result = extractOfferFromJsonLd(
    jsonLd,
    {id:"headset-z2",name:"Casque Audio Z 2"},
    "Marchand",
    "https://marchand.example/casque-z2",
    "2026-10-24T10:00:00.000Z"
  );
  assert.equal(result.product_id, "headset-z2");
  assert.equal(result.price_eur, 1299.99);
  assert.equal(result.availability, "in_stock");
  assert.equal(result.product_url, "https://marchand.example/casque-z2");
  assert.equal(result.shipping_price_eur, null);
  assert.equal(result.stale, undefined);
});

test("refuse les produits proches mais différents, le prix agrégé et une URL HTTP", () => {
  const product = {id:"earbuds4",name:"Écouteurs Alpha 4"};
  const base = "https://marchand.example/alpha";
  const different = extractOfferFromJsonLd({
    "@type":"Product",name:"Écouteurs Alpha Pro 2",
    offers:{price:"89.99",priceCurrency:"EUR"}
  }, product, "Marchand", base, "2026-10-24T10:00:00.000Z");
  assert.equal(different, null);
  const aggregateOnly = extractOfferFromJsonLd({
    "@type":"Product",name:"Écouteurs Alpha 4",
    offers:{ "@type":"AggregateOffer", lowPrice:"49.99",priceCurrency:"EUR" }
  }, product, "Marchand", base, "2026-10-24T10:00:00.000Z");
  assert.equal(aggregateOnly, null);
  const insecure = extractOfferFromJsonLd({
    "@type":"Product",name:"Écouteurs Alpha 4",
    offers:{ "@type":"Offer", price:"49.99",priceCurrency:"EUR",url:"http://marchand.example/alpha" }
  }, product, "Marchand", base, "2026-10-24T10:00:00.000Z");
  assert.equal(insecure, null);
});

test("n'invente pas la devise quand elle manque dans JSON-LD", () => {
  const result = extractOfferFromJsonLd({
    "@type":"Product",name:"Écouteurs Alpha 4",
    offers:{ "@type":"Offer",price:"49.99" }
  }, {id:"earbuds4",name:"Écouteurs Alpha 4"}, "Marchand",
  "https://marchand.example/alpha","2026-10-24T10:00:00.000Z");
  assert.equal(result, null);
});

test("ignore les offres en rupture ou arrêtées", () => {
  const product = {id:"router-x",name:"Routeur X"};
  const responseUrl = "https://marchand.example/routeur-x";
  for (const availability of [
    "https://schema.org/OutOfStock",
    "https://schema.org/Discontinued",
    "https://schema.org/SoldOut"
  ]) {
    const result = extractOfferFromJsonLd({
      "@type":"Product",
      "name":"Routeur X",
      "offers":{"@type":"Offer","price":"89.90","priceCurrency":"EUR",availability}
    }, product, "Marchand", responseUrl, "2026-10-24T10:00:00.000Z");
    assert.equal(result, null);
  }
});

test("refuse explicitement un AggregateOffer même si des champs de prix y figurent", () => {
  const result = extractOfferFromJsonLd({
    "@type":"Product",
    "name":"Routeur X",
    "offers":{"@type":"AggregateOffer","price":"89.90","lowPrice":"79.90","priceCurrency":"EUR"}
  }, {id:"router-x",name:"Routeur X"}, "Marchand",
  "https://marchand.example/routeur-x","2026-10-24T10:00:00.000Z");
  assert.equal(result, null);
});

test("fusionne les offres marchandes sans dépendre des majuscules ou espaces", () => {
  const old = {product_id:"p1",retailer:" DARTY ",price_eur:120};
  const fresh = {product_id:"p1",retailer:"darty",price_eur:125,stale:false};
  const merged = mergeFreshAndStaleOffers(
    [fresh],
    [old],
    [{id:"p1",sources:[{retailer:"Darty"}]}]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].price_eur, 125);
  assert.equal(merged[0].stale, false);
});

test("accepte les URL marchandes HTTPS à nom de domaine public uniquement", () => {
  assert.equal(isSafeMerchantUrl("https://marchand.example/produit"), true);
  assert.equal(isSafeMerchantUrl("https://marchand.example:443/produit"), true);
});
test("rejette les URL HTTP, les adresses IP, les hôtes locaux et les ports non standards", () => {
  for (const url of [
    "http://marchand.example/produit",
    "https://127.0.0.1/produit",
    "https://192.168.1.20/produit",
    "https://[::1]/produit",
    "https://localhost/produit",
    "https://service.local/produit",
    "https://service.internal/produit",
    "https://user:password@marchand.example/produit",
    "https://marchand.example:8443/produit",
    "not-a-url"
  ]) assert.equal(isSafeMerchantUrl(url), false, url);
});

test("un prix n'est actuel que s'il a été vérifié dans les dernières 24 heures", () => {
  const now = Date.parse("2026-10-24T10:00:00.000Z");
  assert.equal(isOfferCurrent({checked_at:"2026-10-24T09:30:00.000Z"}, now), true);
  assert.equal(isOfferCurrent({checked_at:"2026-10-23T09:00:00.000Z"}, now), false);
  assert.equal(isOfferCurrent({checked_at:"2026-10-24T10:10:00.000Z"}, now), false);
  assert.equal(isOfferCurrent({checked_at:"2026-10-24T09:30:00.000Z",stale:true}, now), false);
  assert.equal(isOfferCurrent({price_eur:42}, now), false);
});

test("résout uniquement les redirections vers des URL HTTPS publiques", () => {
  const base = "https://marchand.example/produit";
  assert.equal(resolveSafeRedirect("/produit-v2", base), "https://marchand.example/produit-v2");
  assert.equal(resolveSafeRedirect("https://autre-marchand.example/p", base), "https://autre-marchand.example/p");
  assert.equal(resolveSafeRedirect("http://autre-marchand.example/p", base), null);
  assert.equal(resolveSafeRedirect("https://127.0.0.1/admin", base), null);
  assert.equal(resolveSafeRedirect("https://localhost/admin", base), null);
  assert.equal(resolveSafeRedirect("https://autre-marchand.example:8443/p", base), null);
  assert.equal(resolveSafeRedirect("", base), null);
});


import {extractShippingFromJsonLd, isValidEan13} from "./price-utils.mjs";
test("extrait les frais de livraison seulement s'ils sont explicitement présents en EUR", () => {
  assert.equal(extractShippingFromJsonLd({shippingDetails:{shippingRate:{value:"4.99",currency:"EUR"}}}),4.99);
  assert.equal(extractShippingFromJsonLd({shippingDetails:{shippingRate:{value:"4,90",currency:"EUR"}}}),4.9);
  assert.equal(extractShippingFromJsonLd({shippingDetails:{shippingRate:{value:"4.99",currency:"USD"}}}),null);
  assert.equal(extractShippingFromJsonLd({}),null);
});
test("valide la clé de contrôle EAN-13", () => {
  assert.equal(isValidEan13("0195949688591"), true);
  assert.equal(isValidEan13("0194253405395"), false);
});

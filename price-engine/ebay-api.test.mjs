import test from "node:test";
import assert from "node:assert/strict";
import {normalizeEbayListing, getEbayApplicationToken, searchEbayByGtin} from "./ebay-api.mjs";

test("normalise une annonce eBay avec prix EUR et livraison explicite", () => {
  const offer = normalizeEbayListing({
    title:"Apple AirPods 4 USB-C",
    price:{value:"129.99",currency:"EUR"},
    itemWebUrl:"https://www.ebay.fr/itm/123",
    shippingOptions:[{shippingCost:{value:"4.99",currency:"EUR"}}]
  }, {productId:"airpods4",productName:"Apple AirPods 4",ean:"0195949688591",matchTerms:["Apple AirPods 4","Boîtier de charge USB-C"],checkedAt:"2026-10-24T10:00:00.000Z"});
  assert.equal(offer.price_eur,129.99);
  assert.equal(offer.shipping_price_eur,4.99);
  assert.equal(offer.total_price_eur,134.98);
  assert.equal(offer.verification_status,"verified_ebay_api");
});

test("refuse une annonce dont le titre ne correspond pas à la variante attendue", () => {
  assert.equal(normalizeEbayListing({title:"Apple AirPods Pro 2",price:{value:"99",currency:"EUR"},itemWebUrl:"https://www.ebay.fr/itm/123"}, {matchTerms:["Apple AirPods 4","USB-C"]}),null);
});

test("refuse devise non EUR, prix absent et URL non HTTPS", () => {
  assert.equal(normalizeEbayListing({price:{value:"99",currency:"USD"},itemWebUrl:"https://ebay.fr/1"}),null);
  assert.equal(normalizeEbayListing({price:{value:"99",currency:"EUR"},itemWebUrl:"http://ebay.fr/1"}),null);
  assert.equal(normalizeEbayListing({price:{value:"0",currency:"EUR"},itemWebUrl:"https://ebay.fr/1"}),null);
});

test("OAuth refuse les identifiants manquants avant toute requête", async () => {
  await assert.rejects(() => getEbayApplicationToken({clientId:"",clientSecret:"",fetchImpl:async()=>{throw new Error("must not fetch")}}), /EBAY_CLIENT_ID/);
});

test("recherche GTIN refuse un identifiant mal formé", async () => {
  await assert.rejects(() => searchEbayByGtin({gtin:"not-an-ean",clientId:"x",clientSecret:"y",fetchImpl:async()=>{throw new Error("must not fetch")}}), /GTIN invalide/);
});

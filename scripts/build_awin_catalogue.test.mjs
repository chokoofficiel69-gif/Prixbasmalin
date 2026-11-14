import test from "node:test";
import assert from "node:assert/strict";
import { buildCompactFeed, isCatalogueImage, serializeCompactFeed } from "./build_awin_catalogue.mjs";

const validProduct = () => ({
  id: "awin-product-1",
  name: "Produit exact",
  desc: "Marque • variante",
  query: "Produit exact Marque",
  category: "tech",
  brand: "Marque",
  color: "noir",
  size: "standard",
  image: "https://merchant.example/image.jpg",
  imageSource: "https://merchant.example/product",
  imageSourceName: "Marchand",
  imageKind: "merchant_feed",
  imageStatus: "authorized_feed_image",
  merchant: "Marchand",
  priceValue: 42.5,
  price: "42,50 €",
  sourceUrl: "https://www.awin1.com/pclick.php?id=1",
  merchantUpdatedAt: null,
  priceTaxStatus: "unspecified",
  shippingPriceValue: 4.9,
  availability: "unknown",
  gtin: "4006381333931",
  mpn: "MODEL-1",
  identityType: "gtin",
  isAwinProduct: true,
  internalRawPayload: "NE DOIT PAS ÊTRE COPIÉ",
  offers: [{
    merchant: "Marchand",
    priceValue: 42.5,
    url: "https://www.awin1.com/pclick.php?id=1",
    shippingPriceValue: 4.9,
    availability: "unknown",
    priceTaxStatus: "unspecified",
    merchantUpdatedAt: null,
    internalRawPayload: "NE DOIT PAS ÊTRE COPIÉ",
    images: ["https://merchant.example/image.jpg"]
  }, {
    merchant: "Marchand B",
    priceValue: 43.5,
    url: "https://www.awin1.com/pclick.php?id=2",
    shippingPriceValue: 0,
    availability: "in_stock",
    priceTaxStatus: "included",
    merchantUpdatedAt: "2026-11-13T10:00:00Z"
  }]
});

const feed = products => ({
  status: "ok",
  fetched_at: "2026-11-13T13:49:11Z",
  products
});

test("conserve les champs utiles, l'identité et les vraies offres multi-marchands", () => {
  const result = buildCompactFeed(feed([validProduct()]));
  assert.equal(result.products.length, 1);
  const product = result.products[0];
  assert.equal(product.id, "awin-product-1");
  assert.equal(product.priceValue, 42.5);
  assert.equal(product.priceTaxStatus, "unspecified");
  assert.equal(product.merchantUpdatedAt, null);
  assert.equal(product.gtin, "4006381333931");
  assert.equal(product.offers.length, 2);
  assert.equal(product.offers[0].shippingPriceValue, 4.9);
  assert.equal(product.offers[0].priceTaxStatus, "unspecified");
  assert.equal("internalRawPayload" in product, false);
  assert.equal("internalRawPayload" in product.offers[0], false);
  assert.equal("images" in product, false);
  assert.equal("images" in product.offers[0], false);
});

test("n'ajoute pas un tableau redondant pour une seule offre marchande", () => {
  const product = validProduct();
  product.offers = [product.offers[0]];
  const compact = buildCompactFeed(feed([product])).products[0];
  assert.equal("offers" in compact, false);
  assert.equal(compact.merchant, "Marchand");
  assert.equal(compact.priceValue, 42.5);
});

test("exclut les visuels génériques, illustratifs, non HTTPS ou non vérifiés", () => {
  const generic = validProduct();
  generic.imageStatus = "generic_category_visual";
  const illustration = validProduct();
  illustration.imageKind = "illustration";
  const unsplash = validProduct();
  unsplash.image = "https://images.unsplash.com/photo.jpg";
  const http = validProduct();
  http.image = "http://merchant.example/image.jpg";
  assert.equal(isCatalogueImage(generic), false);
  assert.equal(isCatalogueImage(illustration), false);
  assert.equal(isCatalogueImage(unsplash), false);
  assert.equal(isCatalogueImage(http), false);
  assert.throws(() => buildCompactFeed(feed([generic, illustration, unsplash, http])), /Aucune fiche Awin/);
});

test("refuse une source absente, vide ou mal datée", () => {
  assert.throws(() => buildCompactFeed(null), /absent, invalide/);
  assert.throws(() => buildCompactFeed({ status: "ok", fetched_at: "", products: [] }), /absent, invalide/);
  assert.throws(() => buildCompactFeed(feed([])), /Aucune fiche/);
});

test("impose une limite de taille sans tronquer les données", () => {
  assert.throws(() => serializeCompactFeed(feed([validProduct()]), 10), /trop volumineux/);
  const result = serializeCompactFeed(feed([validProduct()]), 100000);
  assert.equal(JSON.parse(result.json).products[0].priceValue, 42.5);
});

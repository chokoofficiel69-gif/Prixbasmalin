import unittest
from pathlib import Path


CATALOGUE = Path(__file__).resolve().parents[1] / "catalogue.html"


class CatalogueComparablePriceTests(unittest.TestCase):
    def test_verified_offers_use_total_price_when_available(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("function verifiedComparablePrice(offer)", source)
        self.assertIn("if(Number.isFinite(total)&&total>=0)return total;", source)
        self.assertIn("return Number.isFinite(base)&&base>=0?base:NaN;", source)

    def test_verified_offers_prioritize_known_shipping_then_total_price(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("const byComparablePrice=(a,b)=>{", source)
        self.assertIn("const aKnown=shippingKnown(a),bKnown=shippingKnown(b);", source)
        self.assertIn("if(aKnown!==bKnown)return aKnown?-1:1;", source)
        self.assertIn("return verifiedComparablePrice(a)-verifiedComparablePrice(b);", source)
        self.assertIn("const fresh=rows.sort(byComparablePrice);", source)
        self.assertIn(".format(bestComparablePrice)", source)
        self.assertIn(".format(verifiedComparablePrice(offerData))", source)

    def test_known_shipping_cost_is_explained_to_the_user(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("function verifiedPriceBreakdown(offer)", source)
        self.assertIn('"Produit TTC "+money(base)+" + livraison "+money(shipping)', source)
        self.assertIn("Comparaison frais de livraison inclus lorsqu’ils sont connus.", source)

    def test_unknown_shipping_keeps_ttc_price_formatter_in_scope(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        start = source.index("function verifiedPriceBreakdown(offer)")
        end = source.index("\n}", start)
        function = source[start:end]
        self.assertLess(function.index("const money=value=>"), function.index("if(Number.isFinite(base)"))
        self.assertIn('return "Produit TTC "+(Number.isFinite(base)?money(base):"à vérifier")', function)

    def test_null_shipping_is_not_misread_as_free_delivery(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        start = source.index("function verifiedComparablePrice(offer)")
        end = source.index("\n}", start)
        comparable = source[start:end]
        self.assertIn("totalValue===null||totalValue===undefined?NaN", comparable)
        self.assertIn("shippingValue!==null&&shippingValue!==undefined", comparable)

        start = source.index("function verifiedPriceBreakdown(offer)")
        end = source.index("\n}", start)
        breakdown = source[start:end]
        self.assertIn("shippingValue!==null&&shippingValue!==undefined", breakdown)
        self.assertIn("livraison à confirmer", breakdown)

    def test_catalogue_uses_source_freshness_window_with_48_hour_fallback(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("offer.freshness_max_age_hours", source)
        self.assertIn("?configuredHours:48;", source)
        self.assertIn("age<=maxAgeHours*60*60*1000", source)

    def test_rakuten_loader_does_not_expose_internal_import_metrics(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertNotIn("pmRakutenFeedStatus", source)
        self.assertNotIn("import initial en attente de la connexion SFTP", source)
        self.assertNotIn("Flux Rakuten importé le", source)

    def test_feed_image_provenance_points_to_the_image_not_affiliate_url(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("product.imageSource=product.image;", source)
        self.assertIn("imageSource:p.image", source)

    def test_old_featured_observations_are_explicitly_marked_stale(self):
        import json
        from datetime import datetime, timezone, timedelta
        featured = Path(__file__).resolve().parents[1] / "data" / "featured-prices.json"
        data = json.loads(featured.read_text(encoding="utf-8"))
        now = datetime.now(timezone.utc)
        for product in data.get("products", []):
            for offer in product.get("offers", []):
                checked = datetime.fromisoformat(offer["checked_at"].replace("Z", "+00:00"))
                if now - checked > timedelta(hours=48):
                    self.assertTrue(offer.get("stale"), f"Offre ancienne non marquée stale: {product.get('id')}")

    def test_awin_prices_use_merchant_update_timestamp_not_feed_download_time(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("function pmAwinPriceIsFresh(value,now=Date.now())", source)
        self.assertIn("const priceFresh=hasPrice&&pmAwinPriceIsFresh(merchantUpdatedAt);", source)
        self.assertIn("checked_at:checkedAt,", source)
        self.assertIn("stale:!pmAwinPriceIsFresh(checkedAt)", source)
        self.assertNotIn("checked_at:product.fetchedAt||feed.fetched_at", source)
        self.assertIn("const updateValue=p.merchantUpdatedAt||p.sourceCreatedAt||null;", source)
        self.assertNotIn("const priceDateValue=updateValue||p.feedFetchedAt||null;", source)
        self.assertNotIn("const updateValue=p.merchantUpdatedAt||p.fetchedAt;", source)

    def test_old_or_tax_unconfirmed_awin_prices_are_excluded_from_current_offers(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('const priceStatus=!hasPrice?"unavailable":!priceFresh?"dated":!priceTaxIncluded?"tax_unconfirmed":"fresh";', source)
        self.assertIn('priceValue:priceStatus==="fresh"?Number(product.priceValue):null', source)
        self.assertIn('priceTaxStatus:priceTaxIncluded?"included":"unspecified"', source)
        self.assertIn('p.priceStatus==="fresh"', source)
        self.assertIn('taxStatus==="included"', source)
        self.assertIn("Dernier relevé marchand du ", source)
        self.assertIn("TVA non confirmée par la source : prix exclu des comparaisons.", source)

    def test_rakuten_comparison_uses_each_merchants_source_timestamp(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("const sourceFresh=fresh&&Boolean(sourceUpdatedAt)&&pmAwinPriceIsFresh(sourceUpdatedAt);", source)
        self.assertIn('products.filter(p=>fresh&&pmAwinPriceIsFresh(p.sourceCreatedAt)&&p.priceTaxStatus==="included"', source)
        self.assertIn("checked_at:p.sourceCreatedAt,currency:", source)


if __name__ == "__main__":
    unittest.main()

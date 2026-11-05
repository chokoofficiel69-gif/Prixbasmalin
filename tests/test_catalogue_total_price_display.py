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
        self.assertIn('"Produit "+money(base)+" + livraison "+money(shipping)', source)
        self.assertIn("Comparaison frais de livraison inclus lorsqu’ils sont connus.", source)

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
        self.assertIn("const priceFresh=pmAwinPriceIsFresh(merchantUpdatedAt);", source)
        self.assertIn('priceStatus:"stale",priceValue:null', source)
        self.assertIn('price.textContent=hasVerifiedPrice?money(p.priceValue):(p.priceStatus==="stale"?"Prix à vérifier chez le marchand"', source)
        self.assertIn("checked_at:checkedAt,", source)
        self.assertIn("stale:!pmAwinPriceIsFresh(checkedAt)", source)
        self.assertNotIn("checked_at:product.fetchedAt||feed.fetched_at", source)
        self.assertIn("const updateValue=p.merchantUpdatedAt||null;", source)
        self.assertNotIn("const updateValue=p.merchantUpdatedAt||p.fetchedAt;", source)


if __name__ == "__main__":
    unittest.main()

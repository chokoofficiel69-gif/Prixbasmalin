import datetime as dt
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("gtin_comparisons", ROOT / "scripts" / "build_gtin_comparisons.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 13, 12, 0, tzinfo=UTC)


def offer(merchant, price, name="Clive Christian 1872 Féminine 50 ml", brand="Clive Christian", gtin="00652638010168",
          checked_at="2026-11-13T06:00:00Z", tax="unspecified", source="awin", shipping=None):
    return {"gtin": gtin, "source": source, "merchant": merchant, "name": name, "brand": brand,
            "image": "https://img.example/x.jpg", "price_eur": price, "shipping_price_eur": shipping,
            "url": "https://merchant.example/p", "checked_at": checked_at, "checked_at_basis": "test",
            "price_tax_status": tax, "availability": "in_stock"}


class GtinComparisonTests(unittest.TestCase):
    def test_same_gtin_brand_and_quantity_from_two_merchants_is_compared(self):
        result = MODULE.build([
            offer("Perfumeria Comas FR", 350.0, name="I Woody Floral 50 ml", brand="CLIVE CHRISTIAN"),
            offer("Nicchia Luxury", 410.0, name="Clive Christian I Woody Floral Feminine 50 ml", source="rakuten"),
        ], NOW)
        self.assertEqual(result["counts"]["comparisons"], 1)
        product = result["products"][0]
        self.assertEqual(product["id"], "gtin-00652638010168")
        self.assertEqual([o["price_eur"] for o in product["offers"]], [350.0, 410.0])
        self.assertEqual(result["counts"]["comparisons_with_two_current_offers"], 1)

    def test_single_merchant_never_produces_a_comparison(self):
        result = MODULE.build([offer("A", 10.0), offer("A", 9.0)], NOW)
        self.assertEqual(result["products"], [])

    def test_different_brands_are_rejected(self):
        result = MODULE.build([offer("A", 10.0, brand="Kilian"), offer("B", 11.0, brand="")], NOW)
        self.assertEqual(result["products"], [])
        self.assertEqual(result["counts"]["rejected"], {"brand_mismatch": 1})

    def test_brand_legal_suffixes_do_not_block_a_true_match(self):
        self.assertTrue(MODULE.brands_match("HOUBIGANT PARFUMS", "Houbigant Paris"))
        self.assertFalse(MODULE.brands_match("Kilian", "Malbrum"))

    def test_same_gtin_with_different_volume_is_rejected(self):
        result = MODULE.build([
            offer("A", 100.0, name="KILIAN FUMANT CHAUD EPV 30ML", brand="Kilian"),
            offer("B", 120.0, name="Kilian Smoking Hot Eau de Parfum 50 ml", brand="Kilian"),
        ], NOW)
        self.assertEqual(result["counts"]["rejected"], {"quantity_mismatch": 1})

    def test_unrelated_names_veto_a_gtin_match(self):
        result = MODULE.build([
            offer("A", 100.0, name="Shameless Seducer 30 ml", brand="MALBRUM"),
            offer("B", 120.0, name="Malbrum Bagheera Extrait de Parfum 30 ml", brand="Malbrum"),
        ], NOW)
        self.assertEqual(result["counts"]["rejected"], {"name_mismatch": 1})

    def test_stale_or_undated_offers_are_flagged_and_not_counted_as_current(self):
        result = MODULE.build([
            offer("A", 10.0, checked_at=None),
            offer("B", 11.0, checked_at="2026-11-07T03:05:36Z"),
        ], NOW)
        self.assertEqual([o["stale"] for o in result["products"][0]["offers"]], [True, True])
        self.assertEqual(result["counts"]["comparisons_with_two_current_offers"], 0)

    def test_invalid_gtin_is_ignored(self):
        self.assertEqual(MODULE.gtin14("652638010169"), "")
        self.assertEqual(MODULE.gtin14("652638010168"), "00652638010168")

    def test_rakuten_tax_status_requires_snapshot_confirmation(self):
        product = {"gtin": "652638010168", "priceValue": 360, "sourceUrl": "https://click.linksynergy.com/x",
                   "merchant": "Nicchia Luxury", "priceTaxStatus": "included", "sourceCreatedAt": "2026-11-13T03:00:00Z"}
        unverified = list(MODULE.rakuten_offers({"products": [product]}))
        verified = list(MODULE.rakuten_offers({"priceTaxStatusVerified": True, "products": [product]}))
        self.assertEqual(unverified[0]["price_tax_status"], "unspecified")
        self.assertEqual(verified[0]["price_tax_status"], "included")

    def test_awin_download_time_is_never_used_as_price_date(self):
        feed = {"products": [{"gtin": "652638010168", "priceValue": 10, "merchant": "A", "name": "x",
                              "sourceUrl": "https://a.example", "fetchedAt": "2026-11-13T04:50:30Z"}]}
        self.assertIsNone(list(MODULE.awin_offers(feed))[0]["checked_at"])
        feed["products"][0]["feedUpdatedAt"] = "2026-11-13 02:00:00"
        row = list(MODULE.awin_offers(feed))[0]
        self.assertEqual(row["checked_at"], "2026-11-13T02:00:00Z")
        self.assertEqual(row["checked_at_basis"], "merchant_feed_update")

    def test_committed_comparisons_respect_the_public_contract(self):
        data = json.loads((ROOT / "data" / "gtin-comparisons.json").read_text(encoding="utf-8"))
        self.assertEqual(data["status"], "ok")
        for product in data["products"]:
            self.assertTrue(MODULE.is_valid_gtin(product["gtin"]))
            self.assertGreaterEqual(len({o["merchant"].casefold() for o in product["offers"]}), 2)
            for row in product["offers"]:
                self.assertEqual(row["currency"], "EUR")
                self.assertIn(row["price_tax_status"], ("included", "unspecified"))
                self.assertTrue(row["url"].startswith("https://"))
                self.assertGreater(row["price_eur"], 0)

    def test_catalogue_only_shows_current_offers_from_the_comparison_file(self):
        catalogue = (ROOT / "catalogue.html").read_text(encoding="utf-8")
        self.assertIn('fetch("/data/gtin-comparisons.json"', catalogue)
        self.assertIn("...pmGtinComparisonProducts]", catalogue)
        loader = catalogue[catalogue.index('id="pm-gtin-comparisons-loader"'):]
        loader = loader[:loader.index("</script>")]
        self.assertIn("renderVerifiedProducts(", loader)
        self.assertNotIn("innerHTML", loader)
        self.assertIn("function isCurrentVerifiedOffer(offer){\n  if(!offer||offer.stale", catalogue)


if __name__ == "__main__":
    unittest.main()

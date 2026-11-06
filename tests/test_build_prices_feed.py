import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_prices_feed.py"
SPEC = importlib.util.spec_from_file_location("build_prices_feed", SCRIPT)
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class PriceFeedValidationTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc).isoformat()
        self.base_offer = {
            "offer_id": "merchant-offer-1",
            "catalog_product_id": "t1",
            "product_name": "T-shirt blanc",
            "merchant_name": "Marchand test",
            "source": "Flux autorisé de test",
            "identity_type": "gtin",
            "identity_value": "4006381333931",
            "product_url": "https://merchant.example/product/1",
            "price": 12.50,
            "shipping_price": 0,
            "currency": "EUR",
            "price_tax_status": "included",
            "checked_at": self.now,
        }

    def run_builder(self, offers, config=None, previous=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "merchant-offers.json"
            output = root / "prices.json"
            catalogue = root / "catalogue.html"
            freshness_config = root / "source-freshness.json"
            source.write_text(json.dumps({
                "schema_version": 1,
                "offers": offers,
            }), encoding="utf-8")
            if previous is not None:
                output.write_text(json.dumps(previous), encoding="utf-8")
            freshness_config.write_text(json.dumps(config if config is not None else {
                "schema_version": 1,
                "default_max_age_hours": 48,
                "sources": {},
            }), encoding="utf-8")
            catalogue.write_text(
                'const productData=[{"id":"t1","name":"T-shirt blanc"}];',
                encoding="utf-8",
            )
            with patch.object(BUILDER, "INPUT", source), \
                 patch.object(BUILDER, "OUTPUT", output), \
                 patch.object(BUILDER, "CATALOGUE", catalogue), \
                 patch.object(BUILDER, "FRESHNESS_CONFIG", freshness_config), \
                 contextlib.redirect_stdout(io.StringIO()):
                BUILDER.main()
            return json.loads(output.read_text(encoding="utf-8"))

    def test_rejects_out_of_stock_offer(self):
        out_of_stock = dict(self.base_offer, availability="out_of_stock")
        result = self.run_builder([out_of_stock])
        self.assertEqual(result["products"], [])
        self.assertTrue(any("disponibilité non achetable" in error for error in result["errors"]))

    def test_rejects_prices_without_explicit_ttc_confirmation(self):
        unknown = dict(self.base_offer, price_tax_status="unspecified")
        result = self.run_builder([unknown])
        self.assertEqual(result["products"], [])
        self.assertTrue(any("prix TTC non confirmé" in error for error in result["errors"]))

    def test_publishes_explicit_eur_and_ttc_metadata(self):
        result = self.run_builder([self.base_offer])
        offer = result["offers"][0]
        self.assertEqual(offer["currency"], "EUR")
        self.assertEqual(offer["price_tax_status"], "included")
        self.assertEqual(offer["merchant"], "Marchand test")
        self.assertEqual(offer["url"], "https://merchant.example/product/1")
        self.assertEqual(offer["availability"], "unknown")

    def test_rejects_unknown_catalogue_ids_and_duplicate_offer_ids(self):
        duplicate = dict(self.base_offer, price=10.00)
        unknown = dict(self.base_offer, offer_id="merchant-offer-2", catalog_product_id="not-a-real-id")
        result = self.run_builder([self.base_offer, duplicate, unknown])

        self.assertEqual(len(result["products"]), 1)
        self.assertEqual(result["products"][0]["id"], "t1")
        self.assertEqual(result["products"][0]["offer_count"], 1)
        self.assertEqual(result["products"][0]["best_price_eur"], 12.50)
        self.assertEqual(result["products"][0]["identity"]["value"], "4006381333931")
        self.assertTrue(any("offer_id dupliqué" in error for error in result["errors"]))
        self.assertTrue(any("absent du catalogue" in error for error in result["errors"]))

    def test_ranks_same_exact_gtin_by_price_plus_shipping(self):
        cheaper_total = dict(
            self.base_offer,
            offer_id="merchant-offer-2",
            merchant_name="Autre marchand",
            product_url="https://other.example/product/1",
            price=10.00,
            shipping_price=1.50,
        )
        result = self.run_builder([self.base_offer, cheaper_total])

        self.assertEqual(len(result["products"]), 1)
        product = result["products"][0]
        self.assertEqual(product["offer_count"], 2)
        self.assertEqual(product["best_price_eur"], 11.50)
        self.assertEqual(product["offers"][0]["merchant_name"], "Autre marchand")

    def test_rejects_mixed_gtins_for_one_catalogue_card(self):
        other_identity = dict(
            self.base_offer,
            offer_id="merchant-offer-2",
            identity_value="5901234123457",
            merchant_name="Autre marchand",
            product_url="https://other.example/product/2",
        )
        result = self.run_builder([self.base_offer, other_identity])

        self.assertEqual(result["products"], [])
        self.assertEqual(result["offers"], [])
        self.assertTrue(any("identité produit différente" in error for error in result["errors"]))

    def test_rejects_invalid_gtin_check_digit(self):
        invalid = dict(self.base_offer, identity_value="4006381333932")
        result = self.run_builder([invalid])

        self.assertEqual(result["products"], [])
        self.assertTrue(any("clé de contrôle GTIN invalide" in error for error in result["errors"]))

    def test_requires_brand_for_mpn_identity(self):
        mpn_offer = dict(self.base_offer, identity_type="mpn", identity_value="MODEL-123")
        result = self.run_builder([mpn_offer])

        self.assertEqual(result["products"], [])
        self.assertTrue(any("brand obligatoire" in error for error in result["errors"]))


    def test_default_freshness_window_remains_48_hours(self):
        old_date = (datetime.now(timezone.utc) - timedelta(hours=49)).isoformat()
        stale = dict(self.base_offer, checked_at=old_date)
        result = self.run_builder([stale])

        self.assertEqual(result["products"], [])
        self.assertTrue(any("48 heures" in error for error in result["errors"]))

    def test_source_specific_freshness_window_overrides_default(self):
        old_date = (datetime.now(timezone.utc) - timedelta(hours=60)).isoformat()
        stale_by_default = dict(self.base_offer, checked_at=old_date)
        short_window = {
            "schema_version": 1,
            "default_max_age_hours": 48,
            "sources": {"Flux autorisé de test": 24},
        }
        short_result = self.run_builder([stale_by_default], config=short_window)
        self.assertEqual(short_result["products"], [])
        self.assertTrue(any("24 heures" in error for error in short_result["errors"]))

        long_window = {
            "schema_version": 1,
            "default_max_age_hours": 48,
            "sources": {"Flux autorisé de test": 72},
        }
        long_result = self.run_builder([stale_by_default], config=long_window)
        self.assertEqual(len(long_result["products"]), 1)
        self.assertEqual(long_result["products"][0]["offer_count"], 1)
        self.assertEqual(long_result["products"][0]["offers"][0]["freshness_max_age_hours"], 72)

    def test_empty_source_preserves_previous_valid_feed(self):
        previous = {
            "version": 1,
            "generated_at": "2026-11-04T10:00:00Z",
            "products": [{"id": "t1", "offers": [{"offer_id": "old-valid"}]}],
            "offers": [{"offer_id": "old-valid"}],
        }
        result = self.run_builder([], previous=previous)
        self.assertEqual(result, previous)

    def test_empty_source_does_not_rewrite_an_already_empty_feed(self):
        previous = {
            "version": 1,
            "generated_at": "2026-11-04T10:00:00Z",
            "products": [],
            "offers": [],
        }
        result = self.run_builder([], previous=previous)
        self.assertEqual(result, previous)

    def test_invalid_previous_feed_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "Flux précédent invalide"):
            self.run_builder([], previous={"version": 1, "products": "not-a-list", "offers": []})

    def test_invalid_source_freshness_config_fails_closed(self):
        invalid_config = {
            "schema_version": 1,
            "default_max_age_hours": 48,
            "sources": {"Flux autorisé de test": 0},
        }
        with self.assertRaisesRegex(ValueError, "entre 1 et 720"):
            self.run_builder([self.base_offer], config=invalid_config)

if __name__ == "__main__":
    unittest.main()

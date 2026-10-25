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
            "checked_at": self.now,
        }

    def run_builder(self, offers, config=None):
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
            freshness_config.write_text(json.dumps(config if config is not None else {
                "schema_version": 1,
                "default_max_age_hours": 48,
                "sources": {},
            }), encoding="utf-8")
            catalogue.write_text(
                'const productData=[{id:"t1",name:"T-shirt blanc"}];',
                encoding="utf-8",
            )
            with patch.object(BUILDER, "INPUT", source), \
                 patch.object(BUILDER, "OUTPUT", output), \
                 patch.object(BUILDER, "CATALOGUE", catalogue), \
                 patch.object(BUILDER, "FRESHNESS_CONFIG", freshness_config), \
                 contextlib.redirect_stdout(io.StringIO()):
                BUILDER.main()
            return json.loads(output.read_text(encoding="utf-8"))

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

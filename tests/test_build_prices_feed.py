import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_prices_feed.py"
SPEC = importlib.util.spec_from_file_location("build_prices_feed", SCRIPT)
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class PriceFeedValidationTests(unittest.TestCase):
    def test_rejects_unknown_catalogue_ids_and_duplicate_offer_ids(self):
        now = datetime.now(timezone.utc).isoformat()
        base_offer = {
            "offer_id": "merchant-offer-1",
            "catalog_product_id": "t1",
            "product_name": "T-shirt blanc",
            "merchant_name": "Marchand test",
            "source": "Flux autorisé de test",
            "product_url": "https://merchant.example/product/1",
            "price": 12.50,
            "shipping_price": 0,
            "currency": "EUR",
            "checked_at": now,
        }
        duplicate = dict(base_offer, price=10.00)
        unknown = dict(base_offer, offer_id="merchant-offer-2", catalog_product_id="not-a-real-id")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "merchant-offers.json"
            output = root / "prices.json"
            catalogue = root / "catalogue.html"
            source.write_text(json.dumps({
                "schema_version": 1,
                "offers": [base_offer, duplicate, unknown],
            }), encoding="utf-8")
            catalogue.write_text(
                'const productData=[{id:"t1",name:"T-shirt blanc"}];',
                encoding="utf-8",
            )
            with patch.object(BUILDER, "INPUT", source), \
                 patch.object(BUILDER, "OUTPUT", output), \
                 patch.object(BUILDER, "CATALOGUE", catalogue), \
                 contextlib.redirect_stdout(io.StringIO()):
                BUILDER.main()
            result = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(len(result["products"]), 1)
        self.assertEqual(result["products"][0]["id"], "t1")
        self.assertEqual(result["products"][0]["offer_count"], 1)
        self.assertEqual(result["products"][0]["best_price_eur"], 12.50)
        self.assertTrue(any("offer_id dupliqué" in error for error in result["errors"]))
        self.assertTrue(any("absent du catalogue" in error for error in result["errors"]))


if __name__ == "__main__":
    unittest.main()

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


class FeedSiteContractTests(unittest.TestCase):
    def test_generated_feed_has_fields_required_by_catalogue(self):
        now = datetime.now(timezone.utc).isoformat()
        offer = {
            "offer_id": "contract-offer-1",
            "catalog_product_id": "t1",
            "product_name": "T-shirt blanc modèle exact",
            "merchant_name": "Marchand contractuel",
            "source": "Test local du contrat catalogue",
            "identity_type": "gtin",
            "identity_value": "4006381333931",
            "product_url": "https://merchant.example/product/1",
            "price": 12.50,
            "shipping_price": 0,
            "currency": "EUR",
            "checked_at": now,
        }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "merchant-offers.json"
            output = root / "prices.json"
            catalogue = root / "catalogue.html"
            source.write_text(json.dumps({"schema_version": 1, "offers": [offer]}), encoding="utf-8")
            catalogue.write_text('const productData=[{id:"t1",name:"T-shirt blanc"}];', encoding="utf-8")
            with patch.object(BUILDER, "INPUT", source), \
                 patch.object(BUILDER, "OUTPUT", output), \
                 patch.object(BUILDER, "CATALOGUE", catalogue), \
                 contextlib.redirect_stdout(io.StringIO()):
                BUILDER.main()

            feed = json.loads(output.read_text(encoding="utf-8"))

        self.assertTrue(feed["products"], "le test doit produire un produit de test")
        for product in feed["products"]:
            self.assertTrue(product.get("name"), f"produit sans name: {product}")
        for item in feed["offers"]:
            self.assertTrue(item.get("retailer"), f"offre sans retailer: {item}")
            self.assertIn("total_price_eur", item, f"offre sans total_price_eur: {item}")
            self.assertIsInstance(item["total_price_eur"], (int, float))


if __name__ == "__main__":
    unittest.main()

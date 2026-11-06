import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_product_sheets", ROOT / "scripts" / "build_product_sheets.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class ProductSheetsTests(unittest.TestCase):
    def test_keeps_latest_price_per_merchant_and_sorts_offers(self):
        source = {"offers": [
            {"product_id": "x", "product": "Produit X", "brand": "B", "category": "audio", "merchant": "fnac", "date": "2026-10-01", "min_price_eur_ttc": 90},
            {"product_id": "x", "product": "Produit X", "brand": "B", "category": "audio", "merchant": "fnac", "date": "2026-10-05", "min_price_eur_ttc": 99},
            {"product_id": "x", "product": "Produit X", "brand": "B", "category": "audio", "merchant": "amazon", "date": "2026-10-04", "min_price_eur_ttc": 95},
            {"product_id": "solo", "product": "Seul", "merchant": "fnac", "date": "2026-10-04", "min_price_eur_ttc": 10},
        ]}
        data = builder.build(source, {"products": []})
        self.assertEqual(data["count"], 1, "un produit vu chez un seul marchand n'est pas une comparaison")
        sheet = data["products"][0]
        self.assertEqual([o["merchant"] for o in sheet["offers"]], ["amazon", "fnac"])
        self.assertEqual(sheet["offers"][1], {"merchant": "fnac", "price_eur": 99.0, "date": "2026-10-05"})
        self.assertEqual(sheet["min_price_eur"], 95.0)
        self.assertEqual([h["date"] for h in sheet["history"]], ["2026-10-01", "2026-10-04", "2026-10-05"])
        self.assertEqual(data["status"], "historical_reference")

    def test_only_verified_images_are_used(self):
        home = {"products": [
            {"name": "Produit X", "brand": "B", "image": "https://img.example/x.jpg", "imageStatus": "unverified"},
        ]}
        source = {"offers": [
            {"product_id": "x", "product": "Produit X", "brand": "B", "merchant": m, "date": "2026-10-01", "min_price_eur_ttc": 5}
            for m in ("fnac", "darty")
        ]}
        self.assertEqual(builder.build(source, home)["products"][0]["image"], "")

    def test_published_file_is_up_to_date(self):
        source = json.loads((ROOT / "data" / "prixtracker-prices.json").read_text(encoding="utf-8"))
        home = json.loads((ROOT / "data" / "home-products.json").read_text(encoding="utf-8"))
        expected = builder.build(source, home)
        published = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))
        self.assertEqual(published, expected)

    def test_product_page_dates_prices_and_credits_source(self):
        page = (ROOT / "produit.html").read_text(encoding="utf-8")
        self.assertIn('fetch("/data/fiches-produits.json"', page)
        self.assertIn("Relevé du ", page)
        self.assertIn("Licence Ouverte 2.0", page)
        self.assertIn('const AMAZON_TAG="prixbasmalin2-21";', page)
        self.assertIn('link.affiliate?"sponsored nofollow noopener":"nofollow noopener"', page)
        self.assertIn("Meilleur prix relevé", page)


if __name__ == "__main__":
    unittest.main()

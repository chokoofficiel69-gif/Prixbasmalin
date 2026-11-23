import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_rakuten_home", ROOT / "scripts" / "build-rakuten-home.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def product(i, merchant="M", price=10, regular=None, created="2026-11-10T00:00:00Z", **extra):
    p = {
        "id": f"{merchant}-{i}", "name": f"Produit {i:03d}", "merchant": merchant, "priceValue": price,
        "comparison_authorized": True,
        "regularPriceValue": regular, "priceTaxStatus": "included", "sourceCreatedAt": created,
        "image": "https://img.example/x.jpg", "sourceUrl": "https://click.linksynergy.com/link?x=" + str(i),
        "desc": "longue description",
    }
    p.update(extra)
    return p


class BuildRakutenHomeTest(unittest.TestCase):
    def test_keeps_metadata_and_drops_heavy_fields(self):
        out = mod.build({"status": "ok", "generated_at": "2026-11-10T00:00:00Z", "products": [product(1)]})
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["generated_at"], "2026-11-10T00:00:00Z")
        self.assertNotIn("desc", out["products"][0])

    def test_limits_per_merchant_but_keeps_best_deals(self):
        items = [product(i, created=f"2026-11-10T00:{i % 60:02d}:00Z") for i in range(100)]
        items.append(product(999, price=10, regular=100, created="2026-11-01T00:00:00Z"))
        out = mod.build({"products": items}, per_merchant=5)
        ids = {p["id"] for p in out["products"]}
        self.assertIn("M-999", ids)
        self.assertLessEqual(len(ids), 10)

    def test_keeps_tax_unconfirmed_products_for_discovery_without_confirming_tax(self):
        item = product(1, priceTaxStatus="unspecified")
        out = mod.build({"products": [item]})
        self.assertEqual(len(out["products"]), 1)
        self.assertEqual(out["products"][0]["priceTaxStatus"], "unspecified")

    def test_unapproved_products_are_excluded_from_public_discovery(self):
        approved = product(1, merchant="Decathlon National")
        unapproved = product(2, merchant="Nicchia Luxury", comparison_authorized=False)
        out = mod.build({"products": [approved, unapproved]})
        self.assertEqual([p["id"] for p in out["products"]], ["Decathlon National-1"])

    def test_committed_public_home_contains_only_authorized_products(self):
        data = __import__("json").loads((ROOT / "data" / "rakuten-home.json").read_text(encoding="utf-8"))
        self.assertTrue(all(p.get("comparison_authorized") is True for p in data["products"]))
        self.assertNotIn("Nicchia Luxury", {p.get("merchant") for p in data["products"]})
        self.assertFalse(data["source_stats"]["Nicchia Luxury"]["public_display_authorized"])
        self.assertEqual(data["source_stats"]["Nicchia Luxury"]["public_home_products"], 0)

    def test_homepage_rakuten_loaders_require_explicit_authorization(self):
        homepage = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertGreaterEqual(homepage.count("p.comparison_authorized===true"), 3)

    def test_rejects_products_without_safe_discovery_fields(self):
        bad = [product(1, price=0), product(2, image="http://x"), product(3, sourceUrl="http://merchant.example/x")]
        self.assertEqual(mod.build({"products": bad})["products"], [])


if __name__ == "__main__":
    unittest.main()

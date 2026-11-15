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

    def test_rejects_undisplayable_products(self):
        bad = [product(1, priceTaxStatus="unspecified"), product(2, price=0), product(3, image="http://x")]
        self.assertEqual(mod.build({"products": bad})["products"], [])


if __name__ == "__main__":
    unittest.main()

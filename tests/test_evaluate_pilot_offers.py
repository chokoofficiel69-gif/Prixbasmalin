import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import evaluate_pilot_offers as ev  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "pricesapi-pilot-airpods4-2026-11-09.json"
SHEETS = [{
    "id": "airpods-4", "name": "AirPods 4",
    "offers": [
        {"merchant": "amazon", "price_eur": 129.0, "date": "2026-11-06"},
        {"merchant": "topbizfr", "price_eur": 133.89, "date": "2026-11-06"},
        {"merchant": "fnac", "price_eur": 186.0, "date": "2026-11-05"},
        {"merchant": "vieux", "price_eur": 10.0, "date": "2026-09-01"},
    ],
}]


def offer(**kw):
    base = {"seller": "Boutique", "price": 130, "currency": "EUR", "product_title": "Apple AirPods 4", "url_present": True}
    base.update(kw)
    return base


class EvaluatePilotOffersTest(unittest.TestCase):
    def run_eval(self, offers, scraped_at="2026-11-09T10:00:00Z"):
        pilot = {"query": "Apple AirPods 4", "started_at": "2026-11-09T10:10:06Z",
                 "products": [{"scraped_at": scraped_at, "offers": offers}]}
        return ev.evaluate(pilot, SHEETS, "airpods-4")

    def test_reference_band_ignores_old_readings(self):
        result = self.run_eval([offer()])
        self.assertEqual(result["reference_band"]["min"], 129.0)
        self.assertEqual(result["reference_band"]["max"], 186.0)

    def test_parts_used_variant_and_outliers_are_rejected(self):
        rows = self.run_eval([
            offer(seller="iPaddy", price=69.37, product_title="Original AirPods 4 Loose Parts | Left earpiece"),
            offer(seller="Leboncoin", price=120, product_title="AirPod 4"),
            offer(seller="Wishibam", price=150, product_title="APPLE AirPods 4 Lightning - Neuf"),
            offer(seller="Shop", price=150, product_title="AirPods 4 avec réduction de bruit"),
            offer(seller="Shop", price=400, product_title="AirPods 4"),
            offer(seller="Shop", price=130, currency="USD"),
        ])["offers"]
        self.assertTrue(all(r["verdict"] == "rejetée" for r in rows), rows)

    def test_matching_prixtracker_price_is_noted_but_never_publishable(self):
        result = self.run_eval([offer(seller="Topbiz", price=133.89)], scraped_at=None)
        self.assertEqual(result["offers"][0]["verdict"], "plausible, à confirmer")
        self.assertIn("même prix que le relevé PrixTracker du marchand", result["offers"][0]["notes"])
        self.assertFalse(result["publishable"])
        self.assertTrue(any("scraped_at" in b for b in result["blockers"]))

    def test_vague_title_is_doubtful(self):
        rows = self.run_eval([offer(product_title="Écouteurs Bluetooth blancs puce H2")])["offers"]
        self.assertEqual(rows[0]["verdict"], "douteuse")

    def test_real_fixture_offline(self):
        pilot = json.loads(FIXTURE.read_text(encoding="utf-8"))
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]
        result = ev.evaluate(pilot, sheets, "airpods-4")
        by_seller = {r["seller"]: r["verdict"] for r in result["offers"]}
        self.assertEqual(len(result["offers"]), 10)
        for seller in ("iPaddy", "Leboncoin", "Wishibam"):
            self.assertEqual(by_seller[seller], "rejetée")
        self.assertFalse(result["publishable"])

    def test_script_makes_no_network_call(self):
        source = (ROOT / "scripts" / "evaluate_pilot_offers.py").read_text(encoding="utf-8")
        for forbidden in ("urllib", "requests", "http.client", "socket"):
            self.assertNotIn("import " + forbidden, source)


class AwinSameMerchantTest(unittest.TestCase):
    def test_awin_self_test_passes(self):
        out = subprocess.run(["node", str(ROOT / "price-engine" / "sync-awin-products.mjs"), "--self-test"],
                             capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertIn("un seul prix par marchand", out.stdout + out.stderr)

    def test_catalogue_dedupes_merchants_in_comparison_table(self):
        html = (ROOT / "catalogue.html").read_text(encoding="utf-8")
        self.assertIn("Un même marchand ne compte qu'une fois", html)


if __name__ == "__main__":
    unittest.main()

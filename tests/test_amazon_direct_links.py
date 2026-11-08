"""Liens Amazon directs (ASIN fournis par le propriétaire) et page Black Friday."""
import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


links = load("amazon_links")
seo = load("build_seo_pages")
SHEETS = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]
TEST_ASIN = "B0TESTTEST"  # identifiant fictif, uniquement en mémoire pour les tests


class AsinParsingTests(unittest.TestCase):
    def test_extracts_asin_from_product_addresses(self):
        for url in ["https://www.amazon.fr/Apple-AirPods-4/dp/B0TESTTEST/ref=sr_1_1?crid=X&keywords=airpods",
                    "https://www.amazon.fr/dp/b0testtest", "https://amazon.fr/gp/product/B0TESTTEST?th=1", "B0TESTTEST"]:
            self.assertEqual(links.asin_from(url), TEST_ASIN, url)

    def test_refuses_non_product_or_foreign_links(self):
        for bad in ["https://www.amazon.fr/s?k=airpods", "https://amzn.to/3abcdef", "https://www.amazon.com.evil.example/dp/B0TESTTEST",
                    "https://www.fnac.com/dp/B0TESTTEST", "pas une adresse"]:
            with self.assertRaises(ValueError, msg=bad):
                links.asin_from(bad)

    def test_product_url_always_carries_the_tag(self):
        url = links.product_url(TEST_ASIN)
        self.assertEqual(urlsplit(url).netloc, "www.amazon.fr")
        self.assertEqual(urlsplit(url).path, f"/dp/{TEST_ASIN}")
        self.assertEqual(parse_qs(urlsplit(url).query), {"tag": ["prixbasmalin2-21"]})

    def test_committed_asins_are_well_formed(self):
        data = json.loads((ROOT / "data" / "amazon-asins.json").read_text(encoding="utf-8"))
        ids = {p["id"] for p in SHEETS}
        for pid, entry in data["products"].items():
            self.assertIn(pid, ids)
            self.assertRegex(entry["asin"], r"^[A-Z0-9]{10}$")


class GeneratedPagesTests(unittest.TestCase):
    def setUp(self):
        self.saved = dict(seo.AMAZON_ASINS)

    def tearDown(self):
        seo.AMAZON_ASINS.clear()
        seo.AMAZON_ASINS.update(self.saved)

    def test_product_page_uses_direct_link_when_asin_known(self):
        p = next(s for s in SHEETS if s["id"] == "airpods-4")
        seo.AMAZON_ASINS.clear()
        without = seo.product_page(p, SHEETS, None)
        self.assertNotIn("/dp/", without)
        seo.AMAZON_ASINS["airpods-4"] = TEST_ASIN
        page = seo.product_page(p, SHEETS, None)
        self.assertIn(f"https://www.amazon.fr/dp/{TEST_ASIN}?tag=prixbasmalin2-21", page)
        self.assertIn("Voir sur Amazon", page)
        self.assertIn("Le bouton Amazon ouvre la fiche du produit", page)

    def test_black_friday_page_is_honest_and_tagged(self):
        page = (ROOT / "black-friday.html").read_text(encoding="utf-8").replace("&amp;", "&")
        self.assertIn("pas des prix promotionnels en direct", page)
        self.assertNotRegex(page, r"-\s?\d+\s?%|remise de|prix barré", "aucune remise inventée")
        amazon = re.findall(r'href="(https://www\.amazon\.fr/[^"]+)"', page)
        self.assertGreater(len(amazon), 10)
        for url in amazon:
            self.assertEqual(parse_qs(urlsplit(url).query).get("tag"), ["prixbasmalin2-21"], url)
        for pid in re.findall(r'href="/prix/([a-z0-9-]+)\.html"', page):
            self.assertTrue((ROOT / "prix" / f"{pid}.html").exists(), pid)
        self.assertIn("/js/cookie-consent.js", page)

    def test_homepage_and_guide_link_to_black_friday(self):
        self.assertIn('href="/black-friday.html"', (ROOT / "index.html").read_text(encoding="utf-8"))
        self.assertIn('href="/black-friday.html"', (ROOT / "guide-black-friday-2026.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

"""Balisage schema.org Product sur les fiches /prix/ : prix fidèles à la page et uniquement récents."""
import json
import re
import unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFURB = {"asgoodasnewfr", "friphonerycom", "backmarket", "backmarketfr"}


def product_blocks(html):
    out = []
    for raw in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        data = json.loads(raw)
        if data.get("@type") == "Product":
            out.append(data)
    return out


class ProductStructuredDataTests(unittest.TestCase):
    def setUp(self):
        self.sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]

    def test_every_sheet_has_one_product_block(self):
        for p in self.sheets:
            with self.subTest(product=p["id"]):
                html = (ROOT / "prix" / f"{p['id']}.html").read_text(encoding="utf-8")
                blocks = product_blocks(html)
                self.assertEqual(len(blocks), 1)
                self.assertEqual(blocks[0]["name"], p["name"])

    def test_historical_tracker_prices_are_not_published_as_current_offer_schema(self):
        for p in self.sheets:
            html = (ROOT / "prix" / f"{p['id']}.html").read_text(encoding="utf-8")
            block = product_blocks(html)[0]
            with self.subTest(product=p["id"]):
                self.assertNotIn("offers", block)
                self.assertIn("Plus bas relevé historique", html)


    def test_product_image_is_absolute_when_present(self):
        for p in self.sheets:
            html = (ROOT / "prix" / f"{p['id']}.html").read_text(encoding="utf-8")
            image = product_blocks(html)[0].get("image")
            if image:
                self.assertTrue(image.startswith("https://"), p["id"])


if __name__ == "__main__":
    unittest.main()


class HistoricalPriceHeadlineTests(unittest.TestCase):
    def test_headline_shows_lowest_historical_price_with_its_date(self):
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]
        for p in sheets:
            candidates = [o for o in p["offers"] if o["merchant"] not in REFURB]
            best = min(candidates or p["offers"], key=lambda o: (o["price_eur"], o["date"]))
            html = (ROOT / "prix" / f"{p['id']}.html").read_text(encoding="utf-8")
            match = re.search(r'<div class="from">Plus bas relevé historique, le ([^<]*)<strong>([^<]*)</strong>', html)
            with self.subTest(product=p["id"]):
                self.assertIsNotNone(match)
                shown = float(match.group(2).replace(" ", "").replace("\xa0", "").replace(" ", "").replace("€", "").replace(",", "."))
                self.assertEqual(shown, best["price_eur"])
                observed = date.fromisoformat(best["date"]).strftime("%d/%m/%Y")
                self.assertEqual(match.group(1), observed)


class BlackFridayGapTests(unittest.TestCase):
    def test_gap_section_lists_real_recent_gaps(self):
        html = (ROOT / "black-friday.html").read_text(encoding="utf-8")
        self.assertIn('id="ecarts"', html)
        start = html.index('id="ecarts"')
        section = html[start:html.index("</section>", start)]
        self.assertGreaterEqual(section.count('class="bf-card"'), 1)
        self.assertIn("d’écart entre marchands", section)


class RefurbishedTests(unittest.TestCase):
    def test_refurbished_never_shown_as_best_new_price(self):
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]
        names = {"asgoodasnewfr": "asgoodasnew", "friphonerycom": "Friphonery"}
        for p in sheets:
            html = (ROOT / "prix" / f"{p['id']}.html").read_text(encoding="utf-8")
            head = re.search(r'<div class="from">(.*?)</div>', html).group(1)
            for label in ("Friphonery", "asgoodasnew"):
                self.assertNotIn(label, head, p["id"])

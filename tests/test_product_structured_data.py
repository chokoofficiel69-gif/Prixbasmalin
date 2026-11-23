"""Balisage schema.org Product sur les fiches /prix/ : prix fidèles à la page et uniquement récents."""
import json
import re
import unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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

    def test_offer_prices_are_shown_on_the_page_and_recent(self):
        for p in self.sheets:
            html = (ROOT / "prix" / f"{p['id']}.html").read_text(encoding="utf-8")
            offers = product_blocks(html)[0].get("offers")
            if not offers:
                continue
            with self.subTest(product=p["id"]):
                last = date.fromisoformat(max(o["date"] for o in p["offers"]))
                recent = [o for o in p["offers"] if date.fromisoformat(o["date"]) >= last - timedelta(days=7)]
                self.assertEqual(offers["offerCount"], len(recent))
                self.assertEqual(float(offers["lowPrice"]), min(o["price_eur"] for o in recent))
                self.assertEqual(float(offers["highPrice"]), max(o["price_eur"] for o in recent))
                self.assertEqual(offers["priceCurrency"], "EUR")

    def test_product_image_is_absolute_when_present(self):
        for p in self.sheets:
            html = (ROOT / "prix" / f"{p['id']}.html").read_text(encoding="utf-8")
            image = product_blocks(html)[0].get("image")
            if image:
                self.assertTrue(image.startswith("https://"), p["id"])


if __name__ == "__main__":
    unittest.main()

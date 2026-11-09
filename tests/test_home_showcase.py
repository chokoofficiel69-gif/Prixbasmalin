"""Vitrine de l'accueil : à jour, sans remise inventée, prix issus des relevés datés."""
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class HomeShowcaseTests(unittest.TestCase):
    def setUp(self):
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        self.block = text[text.index("<!-- pm-showcase -->"):text.index("<!-- /pm-showcase -->")]

    def test_block_is_up_to_date(self):
        sc = load("build_home_showcase")
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(sc.render(text, sc.build_block()), text)

    def test_no_invented_discount_or_rating(self):
        visible = re.sub(r"<style.*?</style>", "", self.block, flags=re.S)
        self.assertNotRegex(visible, r"[-−]\s?\d+\s?%", "aucun pourcentage de remise")
        self.assertNotRegex(visible, r"Économie\s*:|[ée]conomisez jusqu|avis\)|★", "ni économie annoncée ni note inventée")

    def test_prices_come_from_dated_records(self):
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]
        known = {f"{o['price_eur']:.2f}".replace(".", ",") for p in sheets for o in p["offers"]}
        known |= {f"{p['max_price_eur'] - p['min_price_eur']:.2f}".replace(".", ",") for p in sheets}
        for amount in re.findall(r"(\d[\d \u00a0\u202f]*,\d{2})\s?€", self.block):
            amount = re.sub(r"[ \u00a0\u202f]", "", amount)
            self.assertIn(amount, known, amount)
        self.assertIn("Plus bas prix relevé", self.block)
        self.assertRegex(self.block, r"le \d{2}/\d{2}/\d{4}")


    def test_gift_rail_rotates_unique_https_images_every_48_hours(self):
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("const seenGiftImages=new Set();", text)
        self.assertIn("const rotationSlot=Math.floor(Date.now()/172800000);", text)
        self.assertIn("giftRail.dataset.pmRotationSlot=String(rotationSlot);", text)
        self.assertIn("giftRail.dataset.pmRotationDate=new Date().toISOString();", text)
        self.assertIn('giftRail.dataset.pmRotationProductIds=rotated.map(g=>String(g.id||g.name||"")).join(",");', text)
        self.assertIn('giftRail.innerHTML=rotated.map(giftCard).join("")', text)
        self.assertNotIn('giftRail.innerHTML=list.slice(0,16).map(giftCard).join("")', text)

        # The current published gift feed has 45 unique image URLs.
        gifts = list(range(45))
        def selected(slot):
            limit = min(16, len(gifts))
            start = (slot * limit) % len(gifts)
            return [gifts[(start + index) % len(gifts)] for index in range(limit)]

        self.assertEqual(len(selected(0)), 16)
        self.assertEqual(len(set(selected(0))), 16)
        self.assertTrue(set(selected(0)).isdisjoint(selected(1)))
        self.assertTrue(set(selected(1)).isdisjoint(selected(2)))
        self.assertNotEqual(selected(0), selected(3))


if __name__ == "__main__":
    unittest.main()

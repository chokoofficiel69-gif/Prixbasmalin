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
        sc = load("build_home_showcase")
        ref = max(p["last_date"] for p in sheets if p.get("last_date"))
        views = [v for v in (sc.fresh_view(p, ref) for p in sheets) if v]
        known |= {f"{v['max_price_eur'] - v['min_price_eur']:.2f}".replace(".", ",") for v in views}
        for amount in re.findall(r"(\d[\d \u00a0\u202f]*,\d{2})\s?€", self.block):
            amount = re.sub(r"[ \u00a0\u202f]", "", amount)
            self.assertIn(amount, known, amount)
        self.assertIn("Plus bas prix relevé", self.block)
        self.assertRegex(self.block, r"le \d{2}/\d{2}/\d{4}")


    def test_gaps_use_only_recent_new_offers(self):
        sc = load("build_home_showcase")
        p = {"id": "x", "image": "https://a/x.jpg", "offers": [
            {"merchant": "amazon", "price_eur": 100.0, "date": "2026-11-11"},
            {"merchant": "fnac", "price_eur": 120.0, "date": "2026-11-10"},
            {"merchant": "alternatefr", "price_eur": 80.0, "date": "2026-10-21"},
            {"merchant": "asgoodasnewfr", "price_eur": 60.0, "date": "2026-11-11"}]}
        v = sc.fresh_view(p, "2026-11-11")
        self.assertEqual([o["merchant"] for o in v["offers"]], ["amazon", "fnac"])
        self.assertEqual(v["max_price_eur"] - v["min_price_eur"], 20.0)
        self.assertIsNone(sc.fresh_view({**p, "offers": p["offers"][2:]}, "2026-11-11"))

    def test_gift_rail_rotates_unique_https_images_every_48_hours(self):
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("const seenGiftImages=new Set();", text)
        self.assertIn("const rotationSlot=Math.floor(Date.now()/172800000);", text)
        self.assertIn("giftRail.dataset.pmRotationSlot=String(rotationSlot);", text)
        self.assertIn("giftRail.dataset.pmRotationDate=new Date().toISOString();", text)
        self.assertIn('giftRail.dataset.pmRotationProductIds=rotated.map(g=>String(g.id||g.name||"")).join(",");', text)
        self.assertIn('giftRail.innerHTML=rotated.map(giftCard).join("")', text)
        self.assertNotIn('giftRail.innerHTML=list.slice(0,16).map(giftCard).join("")', text)

        # Use the current published feed, not a hard-coded image count.
        feed = json.loads((ROOT / "data" / "home-deals.json").read_text(encoding="utf-8"))
        gifts = list(dict.fromkeys(
            gift.get("image") for gift in feed.get("gifts", [])
            if isinstance(gift.get("image"), str) and gift["image"].startswith("https://")
        ))
        self.assertGreaterEqual(len(gifts), 16)

        def selected(slot):
            limit = min(16, len(gifts))
            start = (slot * limit) % len(gifts)
            return [gifts[(start + index) % len(gifts)] for index in range(limit)]

        self.assertEqual(len(selected(0)), 16)
        self.assertEqual(len(set(selected(0))), 16)
        self.assertTrue(set(selected(0)).isdisjoint(selected(1)))
        self.assertTrue(set(selected(1)).isdisjoint(selected(2)))
        self.assertNotEqual(selected(0), selected(3))


    def test_seasonal_theme_uses_paris_calendar_and_preserves_brand(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        for marker in ('id="pm-seasonal-theme-style"', 'id="pm-seasonal-theme-script"',
                       'timeZone:"Europe/Paris"', 'document.documentElement.dataset.pmSeason=season'):
            self.assertIn(marker, page)
        for boundary in ("month===11||(month===12&&day<=26)",
                         "(month===12&&day>=27)||(month===1&&day<=7)",
                         "(month===1&&day>=8)||month===2",
                         "month>=3&&month<=5",
                         "month===6||month===7||(month===8&&day<=15)",
                         "(month===8&&day>=16)||month===9",
                         "month===10"):
            self.assertIn(boundary, page)
        for visual in (".pmx.pm-season-noel", "#14532d", "#7f1d2d", "#d6b45a",
                       "radial-gradient", "❄  ✧  ❄"):
            self.assertIn(visual, page)
        self.assertIn('background-image:url("assets/prixmalin-publicite.webp")', page)
        self.assertIn("grid-auto-flow:column;gap:12px;overflow-x:auto", page)
        self.assertIn(".pmx-offers{grid-auto-columns:47%", page)
        self.assertIn("background:linear-gradient(100deg,var(--o2),var(--o))", page)


if __name__ == "__main__":
    unittest.main()

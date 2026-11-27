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
        # Coups de cœur partenaires : prix du flux marchand Awin, datés et « à confirmer ».
        picks, _ = sc.partner_picks()
        known |= {f"{p['price']:.2f}".replace(".", ",") for p in picks}
        for amount in re.findall(r"(\d[\d \u00a0\u202f]*,\d{2})\s?€", self.block):
            amount = re.sub(r"[ \u00a0\u202f]", "", amount)
            self.assertIn(amount, known, amount)
        self.assertIn("Plus bas prix relevé", self.block)
        self.assertRegex(self.block, r"le \d{2}/\d{2}/\d{4}")


    def test_partner_picks_need_verified_image_and_recent_feed(self):
        import datetime as dt
        sc = load("build_home_showcase")
        picks, day = sc.partner_picks()
        joined = sc.joined_advertisers()
        for p in picks:
            self.assertTrue(p["image_verified"])
            self.assertTrue(p["image"].startswith("https://"))
            self.assertIn(p["merchant"], sc.PARTNER_PRIORITY)
            mid = sc.advertiser_id(p["url"])
            self.assertEqual(p["program_joined"], joined is not None and mid is not None and mid in joined)
        late = dt.datetime.fromisoformat(day + "T00:00:00+00:00") + dt.timedelta(days=9) if day else None
        if late:
            self.assertEqual(sc.partner_picks(now=late)[0], [], "flux trop ancien : aucune carte")

    def test_awin_mid_is_extracted_without_guessing(self):
        sc = load("build_home_showcase")
        self.assertEqual(sc.advertiser_id("https://www.awin1.com/pclick.php?p=1&a=2&m=105475"), "105475")
        self.assertEqual(sc.advertiser_id("https://www.awin1.com/cread.php?awinmid=85523&awinaffid=2"), "85523")
        self.assertIsNone(sc.advertiser_id("https://merchant.example/product"))

    def test_joined_status_requires_recent_verified_snapshot(self):
        import datetime as dt
        sc = load("build_home_showcase")
        now = dt.datetime.fromisoformat("2026-11-27T09:00:00+00:00")
        status = {
            "status": "ok", "programmes_check_status": "verified",
            "fetched_at": "2026-11-26T14:16:30.022Z",
            "joined_advertisers": [{"id": "59933"}, {"id": "85523"}],
        }
        self.assertEqual(sc.joined_ids_from_status(status, now), {"59933", "85523"})
        self.assertIsNone(sc.joined_ids_from_status({**status, "programmes_check_status": "partial"}, now))
        self.assertIsNone(sc.joined_ids_from_status({**status, "fetched_at": "2026-11-22T00:00:00Z"}, now))

    def test_unjoined_pick_keeps_price_but_has_no_affiliate_link(self):
        sc = load("build_home_showcase")
        url = "https://www.awin1.com/pclick.php?p=1&a=3137386&m=105475"
        card = sc.partner_card({
            "merchant": "Perfumeria Comas FR", "name": "Laquerink Lipshine",
            "price": 24.50, "image": "https://merchant.example/image.jpg",
            "url": url, "program_joined": False,
        }, "26/11/2026")
        self.assertIn("24,50", card)
        self.assertIn("Programme non rejoint", card)
        self.assertIn("Flux · à confirmer", card)
        self.assertNotIn("href=", card)
        self.assertNotIn(url, card)

    def test_joined_pick_keeps_affiliate_link(self):
        sc = load("build_home_showcase")
        url = "https://www.awin1.com/pclick.php?p=1&a=3137386&m=59933"
        card = sc.partner_card({
            "merchant": "Jowissa", "name": "Montre test",
            "price": 269.90, "image": "https://merchant.example/image.jpg",
            "url": url, "program_joined": True,
        }, "26/11/2026")
        self.assertIn("Partenaire", card)
        self.assertIn(url, card)

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
        # Avec 48 images uniques, les trois créneaux de 16 sont disjoints ;
        # le quatrième créneau revient normalement au premier (cycle de 6 jours).
        if len(gifts) >= 48:
            self.assertTrue(set(selected(0)).isdisjoint(selected(2)))
        self.assertEqual(len(selected(3)), 16)
        self.assertEqual(len(set(selected(3))), 16)


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

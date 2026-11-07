import importlib.util
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_home_deals", ROOT / "scripts" / "build_home_deals.py")
deals = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deals)


def product(name, merchant, price, desc="Parfums", **extra):
    base = {"id": name, "name": name, "merchant": merchant, "priceValue": price, "desc": desc,
            "image": "https://img.example/" + name, "sourceUrl": "https://www.awin1.com/pclick.php?p=1"}
    base.update(extra)
    return base


class HomeDealsTests(unittest.TestCase):
    def test_gifts_need_image_price_link_and_exclude_medical_items(self):
        awin = {"fetched_at": "2026-11-06T13:00:00Z", "products": [
            product("Eau de parfum", "A", 59.9),
            product("Bandelettes de glycémie", "B", 30, desc="Bandelettes réactives"),
            product("Sans image", "A", 40, image=""),
            product("Trop bon marché", "A", 3),
            product("Sans lien", "A", 40, sourceUrl="http://insecure"),
        ]}
        gifts = deals.build_gifts(awin)
        self.assertEqual([g["name"] for g in gifts], ["Eau de parfum"])
        self.assertEqual(gifts[0]["price_date_kind"], "feed")
        self.assertEqual(gifts[0]["price_status"], "unverified")
        self.assertEqual(gifts[0]["price_status_reason"], "missing_merchant_date")
        self.assertIsNone(gifts[0]["price_eur"])
        self.assertEqual(gifts[0]["band"], "unverified")

    def test_gift_prices_require_fresh_merchant_date_and_explicit_ttc(self):
        now = datetime(2026, 11, 7, 9, 0, tzinfo=timezone.utc)
        fresh_date = (now - timedelta(hours=1)).isoformat()
        stale_date = (now - timedelta(hours=49)).isoformat()
        awin = {"fetched_at": now.isoformat(), "products": [
            product("Fresh TTC", "A", 59.9, merchantUpdatedAt=fresh_date, priceTaxStatus="included", shippingPriceValue=0),
            product("Stale TTC", "B", 49.9, merchantUpdatedAt=stale_date, priceTaxStatus="included", shippingPriceValue=0),
            product("Tax unclear", "C", 39.9, merchantUpdatedAt=fresh_date, priceTaxStatus="unspecified", shippingPriceValue=0),
        ]}
        gifts = {g["name"]: g for g in deals.build_gifts(awin, now=now)}
        self.assertEqual(gifts["Fresh TTC"]["price_status"], "verified_current")
        self.assertEqual(gifts["Fresh TTC"]["price_eur"], 59.9)
        self.assertEqual(gifts["Fresh TTC"]["shipping_eur"], 0)
        self.assertEqual(gifts["Fresh TTC"]["band"], "30-60")
        self.assertEqual(gifts["Stale TTC"]["price_status_reason"], "stale")
        self.assertIsNone(gifts["Stale TTC"]["price_eur"])
        self.assertEqual(gifts["Tax unclear"]["price_status_reason"], "tax_unconfirmed")
        self.assertIsNone(gifts["Tax unclear"]["price_eur"])

    def test_gifts_alternate_merchants(self):
        awin = {"products": [product(f"Parfum {i}", m, 20 + i) for m in ("A", "B") for i in range(3)]}
        merchants = [g["merchant"] for g in deals.build_gifts(awin)]
        self.assertEqual(merchants[:4], ["A", "B", "A", "B"])

    def test_top_has_no_misleading_gap_percent(self):
        data = json.loads((ROOT / "data" / "home-deals.json").read_text(encoding="utf-8"))
        self.assertTrue(data["top"])
        self.assertTrue(all("gap_percent" not in t and t["offer_count"] >= 8 for t in data["top"]))

    def test_published_file_is_up_to_date(self):
        awin = json.loads((ROOT / "data" / "awin-products.json").read_text(encoding="utf-8"))
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))
        published = json.loads((ROOT / "data" / "home-deals.json").read_text(encoding="utf-8"))
        self.assertEqual(published, deals.build(awin, sheets))

    def test_awin_and_prixtracker_publish_home_deals_under_one_safe_lock(self):
        awin = (ROOT / ".github" / "workflows" / "sync-awin-products.yml").read_text(encoding="utf-8")
        tracker = (ROOT / ".github" / "workflows" / "import-prixtracker.yml").read_text(encoding="utf-8")
        shared_group = "group: prix-malin-price-data-refresh"
        self.assertIn(shared_group, awin)
        self.assertIn(shared_group, tracker)
        self.assertIn('git rebase "origin/${GITHUB_REF_NAME}"', awin)
        self.assertIn('git rebase "origin/${GITHUB_REF_NAME}"', tracker)
        self.assertIn("trois tentatives", awin)
        self.assertIn("trois tentatives", tracker)
        self.assertIn("github.event.pull_request.head.sha || github.ref", tracker)

    def test_homepage_hides_unverified_gift_prices_and_budget_filters(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('g.price_status==="verified_current"', page)
        self.assertIn("Prix TTC actuel indisponible", page)
        self.assertIn("tab.hidden=!hasVerifiedGiftPrice", page)
        self.assertIn("Prix TTC vérifié", page)

    def test_404_historical_cards_do_not_use_art_placeholders(self):
        page = (ROOT / "404.html").read_text(encoding="utf-8")
        self.assertNotIn("pmProductArt(", page)
        self.assertNotIn("pm-product-art.js", page)
        self.assertIn('img.addEventListener("error"', page)

    def test_homepage_top_deals_are_explicitly_historical(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("Prix observés <span>(historique)</span>", page)
        self.assertIn("Relevés PrixTracker datés · pas des offres en direct", page)
        self.assertNotIn("Meilleurs prix <span>du moment</span>", page)

    def test_homepage_sections_partners_and_affiliate_rel(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        for marker in ('id="pm-partners"', 'id="pm-top-prices"', 'id="pm-gifts"', 'fetch("/data/home-deals.json"'):
            self.assertIn(marker, page)
        self.assertIn('href="https://www.amazon.fr/gp/goldbox?tag=prixbasmalin2-21"', page)
        # Les partenaires sans lien d'affiliation restent masqués.
        self.assertIn('data-partner="decathlon" data-href="" target="_blank" rel="sponsored nofollow noopener" hidden', page)
        self.assertIn(".pm-partner[hidden]{display:none!important}", page)
        self.assertIn('target="_blank" rel="sponsored nofollow noopener">\'+visual(g.image', page)


class ProductSheetOutlierTests(unittest.TestCase):
    def test_absurd_high_prices_are_dropped(self):
        spec2 = importlib.util.spec_from_file_location("bps", ROOT / "scripts" / "build_product_sheets.py")
        bps = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(bps)
        rows = [{"product_id": "p", "product": "P", "merchant": m, "date": "2026-11-01", "min_price_eur_ttc": v}
                for m, v in (("a", 100), ("b", 110), ("c", 120), ("d", 4800))]
        offers = bps.build({"offers": rows}, {"products": []})["products"][0]["offers"]
        self.assertEqual([o["merchant"] for o in offers], ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()

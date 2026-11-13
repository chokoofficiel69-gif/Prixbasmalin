import importlib.util
import json
import unittest
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
        self.assertFalse(gifts[0]["price_verified"])
        self.assertIsNone(gifts[0]["price_eur"])
        self.assertFalse(gifts[0]["image_verified"])
        self.assertEqual(gifts[0]["image_provenance"], "Flux marchand Awin autorisé")
        self.assertEqual(gifts[0]["price_date_kind"], "missing")
        self.assertEqual(gifts[0]["band"], "a-confirmer")

    def test_prm_coupons_couture_gift_families_use_product_type(self):
        fashion = product("Patron Know Me n°2137 – Blouse & veste stylée", "PRM Coupons Couture FR", 30,
                          desc="Patron de couture")
        home = product("Tissu d'ameublement velours", "PRM Coupons Couture FR", 30, desc="Tissu")
        unknown = product("PRM référence 123", "PRM Coupons Couture FR", 30, desc="")
        sewing = product("Aiguilles à coudre Bohin longues A1F", "PRM Coupons Couture FR", 30, desc="Mercerie")
        self.assertEqual(deals.gift_family(fashion)[0], "mode")
        self.assertEqual(deals.gift_family(home)[0], "maison")
        self.assertEqual(deals.gift_family(unknown)[0], "autre")
        self.assertEqual(deals.gift_family(sewing)[0], "mode")

    def test_gifts_exclude_known_placeholder_image_urls(self):
        awin = {"products": [
            product("Produit sans visuel", "Milk Bar Babystore", 30, desc="Mode",
                    image="https://images2.productserve.com/noimage.gif"),
            product("Eau de parfum", "A", 40, desc="Parfums",
                    image="https://img.example/parfum.webp"),
        ]}
        gifts = deals.build_gifts(awin)
        self.assertEqual([gift["name"] for gift in gifts], ["Eau de parfum"])
        self.assertFalse(any(deals.is_placeholder_image_url(gift["image"]) for gift in gifts))

    def test_published_gifts_do_not_mark_placeholder_images_as_usable(self):
        data = json.loads((ROOT / "data" / "home-deals.json").read_text(encoding="utf-8"))
        self.assertFalse(any(deals.is_placeholder_image_url(gift.get("image")) for gift in data["gifts"]))


    def test_gifts_preserve_recent_image_verification_by_exact_url(self):
        awin = {"fetched_at": "2026-11-11T12:00:00Z", "products": [
            product("Parfum vérifié", "A", 59.9, image="https://img.example/parfum.webp")
        ]}
        previous = [{"image": "https://img.example/parfum.webp", "image_verified": True,
                     "image_verified_at": "2026-11-10T12:00:00Z",
                     "image_checked_at": "2026-11-10T12:00:00Z",
                     "image_check_status": "ok"}]
        gifts = deals.build_gifts(awin, previous_gifts=previous)
        self.assertTrue(gifts[0]["image_verified"])
        self.assertEqual(gifts[0]["image_verified_at"], "2026-11-10T12:00:00Z")

    def test_gifts_show_price_only_with_fresh_merchant_date_and_explicit_ttc(self):
        awin = {"fetched_at": "2026-11-06T13:00:00Z", "products": [
            product("Parfum vérifié", "A", 59.9, merchantUpdatedAt="2026-11-06T12:30:00Z",
                    priceTaxStatus="included", shippingPriceValue=3.5)
        ]}
        gifts = deals.build_gifts(awin, now=deals.parse_utc("2026-11-06T13:00:00Z"))
        self.assertEqual(len(gifts), 1)
        self.assertTrue(gifts[0]["price_verified"])
        self.assertEqual(gifts[0]["price_eur"], 59.9)
        self.assertEqual(gifts[0]["shipping_eur"], 3.5)
        self.assertEqual(gifts[0]["band"], "30-60")
        self.assertEqual(gifts[0]["price_date_kind"], "merchant")

    def test_gifts_hide_stale_or_tax_unconfirmed_prices(self):
        awin = {"fetched_at": "2026-11-06T13:00:00Z", "products": [
            product("Parfum ancien", "A", 59.9, merchantUpdatedAt="2026-11-03T12:30:00Z",
                    priceTaxStatus="included", shippingPriceValue=0),
            product("Parfum TVA inconnue", "B", 49.9, merchantUpdatedAt="2026-11-06T12:30:00Z",
                    priceTaxStatus="unspecified", shippingPriceValue=0),
        ]}
        gifts = deals.build_gifts(awin, now=deals.parse_utc("2026-11-06T13:00:00Z"))
        self.assertEqual(len(gifts), 2)
        self.assertTrue(all(not gift["price_verified"] and gift["price_eur"] is None for gift in gifts))
        self.assertTrue(all(gift["shipping_eur"] is None and gift["band"] == "a-confirmer" for gift in gifts))

    def test_gifts_alternate_merchants(self):
        awin = {"products": [product(f"Parfum {i}", m, 20 + i) for m in ("A", "B") for i in range(3)]}
        merchants = [g["merchant"] for g in deals.build_gifts(awin)]
        self.assertEqual(merchants[:4], ["A", "B", "A", "B"])

    def test_top_has_no_misleading_gap_percent(self):
        data = json.loads((ROOT / "data" / "home-deals.json").read_text(encoding="utf-8"))
        self.assertTrue(data["top"])
        self.assertTrue(all("gap_percent" not in t and t["offer_count"] >= 8 for t in data["top"]))
        self.assertTrue(all(t["price_kind"] == "historical" for t in data["top"]))
        self.assertTrue(all(deals.has_verified_local_image(t) for t in data["top"]))

    def test_top_builder_skips_missing_or_uncredited_images(self):
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))
        top = deals.build_top(sheets)
        self.assertTrue(top)
        self.assertTrue(all(deals.has_verified_local_image(item) for item in top))
        self.assertNotIn("ipad-air-11-m3", {item["id"] for item in top})
        self.assertNotIn("dreame-x50-ultra", {item["id"] for item in top})

    def test_published_file_is_up_to_date(self):
        awin = json.loads((ROOT / "data" / "awin-products.json").read_text(encoding="utf-8"))
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))
        published = json.loads((ROOT / "data" / "home-deals.json").read_text(encoding="utf-8"))
        self.assertEqual(published, deals.build(awin, sheets, previous=published))

    def test_awin_and_prixtracker_publish_home_deals_under_one_safe_lock(self):
        awin = (ROOT / ".github" / "workflows" / "sync-awin-products.yml").read_text(encoding="utf-8")
        tracker = (ROOT / ".github" / "workflows" / "import-prixtracker.yml").read_text(encoding="utf-8")
        for workflow in (awin, tracker):
            self.assertIn("prix-malin-price-data-refresh", workflow)
            self.assertIn("github.event_name == 'pull_request'", workflow)
            self.assertIn("github.event.pull_request.number", workflow)
            self.assertIn("cancel-in-progress: false", workflow)
            self.assertIn('git rebase "origin/${GITHUB_REF_NAME}"', workflow)
            self.assertIn("trois tentatives", workflow)
        for line in awin.splitlines():
            if "${{" in line:
                self.assertEqual(line.count("${{"), line.count("}}"), line)
                self.assertTrue(line.endswith("}}") and not line.endswith("}}}"), line)
        self.assertIn("github.event.pull_request.head.sha || github.ref", tracker)

    def test_pending_awin_applications_are_not_published_as_active_partners(self):
        from html import unescape

        page = (ROOT / "index.html").read_text(encoding="utf-8")
        partners = json.loads((ROOT / "data" / "partners.json").read_text(encoding="utf-8"))
        start = page.index('<section id="pm-partners"')
        end = page.index("</section>", start)
        section = unescape(page[start:end]).casefold()

        pending = [
            entry for entry in partners.get("entries", [])
            if entry.get("network") == "Awin" and entry.get("approvalStatus") != "approved"
        ]
        self.assertTrue(pending)
        for entry in pending:
            name = entry.get("displayName") or entry.get("name", "")
            name = name.removesuffix(" FR")
            self.assertNotIn(name.casefold(), section)
        for logo_class in ("pm-logo-fiido", "pm-logo-jowissa", "pm-logo-lusini", "pm-logo-imou"):
            self.assertNotIn(logo_class, section)

        # Un lien affilié Awin/Rakuten n'est visible qu'après statut joined explicite.
        self.assertIn('a.getAttribute("data-authorization-status")==="joined"', page)
        self.assertIn("if(authorized && ", page)
        self.assertIn('data-partner="decathlon" data-authorization-status="pending"', section)
        self.assertIn('data-partner="nicchia-luxury" data-authorization-status="unverified"', section)
        self.assertIn('les demandes en attente ne sont pas des partenariats actifs.', section)

        footers = []
        cursor = 0
        while True:
            start_footer = page.find("<footer", cursor)
            if start_footer < 0:
                break
            end_footer = page.find("</footer>", start_footer)
            if end_footer < 0:
                break
            footers.append(page[start_footer:end_footer + len("</footer>")])
            cursor = end_footer + len("</footer>")
        self.assertTrue(footers)
        for footer in footers:
            visible = unescape(footer).casefold()
            for unapproved in ("<strong>decathlon</strong>", "<strong>nicchia luxury</strong>",
                               "<strong>lusini</strong>", "<strong>imou</strong>",
                               "<strong>jowissa</strong>", "<strong>ecovacs</strong>",
                               "<strong>mibro</strong>"):
                self.assertNotIn(unapproved, visible)

    def test_homepage_sections_partners_and_affiliate_rel(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        for marker in ('id="pm-partners"', 'id="pm-top-prices"', 'id="pm-gifts"', 'fetch("/data/home-deals.json"'):
            self.assertIn(marker, page)
        self.assertIn('href="https://www.amazon.fr/gp/goldbox?tag=prixbasmalin2-21"', page)
        # Les liens restent masqués tant que le statut joined n’est pas confirmé.
        self.assertIn('data-partner="decathlon" data-authorization-status="pending" data-href="https://click.linksynergy.com/deeplink?id=GnFjGr9kD3Y&amp;mid=44806&amp;murl=https%3A%2F%2Fwww.decathlon.fr%2F" target="_blank" rel="sponsored nofollow noopener" hidden', page)
        self.assertIn('data-partner="nicchia-luxury" data-authorization-status="unverified" data-href="https://click.linksynergy.com/deeplink?id=GnFjGr9kD3Y&amp;mid=54306', page)
        links = [line for line in page.splitlines() if "<a " in line and "data-href=" in line]
        self.assertTrue(links)
        for link in links:
            if 'data-authorization-status="joined"' not in link:
                self.assertIn(" hidden", link)
        # Promos partenaires : uniquement prix TTC frais, prix barré fourni par le marchand, liens affiliés.
        self.assertIn('id="pm-partner-deals"', page)
        self.assertIn('p.priceTaxStatus==="included"', page)
        self.assertIn('Number(p.regularPriceValue)>Number(p.priceValue)', page)
        self.assertIn(".pm-partner[hidden]{display:none!important}", page)
        self.assertIn('target="_blank" rel="sponsored nofollow noopener">\'+visual(image', page)
        self.assertIn("const giftPriceIsCurrent=g=>", page)
        self.assertIn("g.image_verified!==true", page)
        self.assertIn("Prix non vérifié", page)
        self.assertIn('giftRail.querySelectorAll("img")', page)
        self.assertIn("Prix observés", page)
        self.assertIn("prix affichés seulement si date marchande récente et TTC confirmé", page)
        product_page = (ROOT / "produit.html").read_text(encoding="utf-8")
        self.assertIn("Historique des prix", product_page)
        self.assertIn("Relevés historiques par marchand", product_page)
        self.assertIn("pas des offres actuelles", product_page)
        self.assertIn('label:"Rechercher"', product_page)


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

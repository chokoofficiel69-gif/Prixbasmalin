import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_seo_pages", ROOT / "scripts" / "build_seo_pages.py")
seo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seo)


class SeoPagesTests(unittest.TestCase):
    def test_published_pages_are_up_to_date(self):
        files = seo.build()
        stale = [rel for rel, text in files.items() if not (ROOT / rel).is_file() or (ROOT / rel).read_text(encoding="utf-8") != text]
        self.assertEqual(stale, [], "lancez python3 scripts/build_seo_pages.py")
        for path in (ROOT / "idees-cadeaux").glob("*.html"):
            if path.name != "index.html":
                self.assertIn(str(path.relative_to(ROOT)), files, str(path))

    def test_product_page_is_crawlable_and_dated(self):
        page = (ROOT / "prix" / "airpods-4.html").read_text(encoding="utf-8")
        self.assertIn('<link rel="canonical" href="https://prixbasmalin.fr/prix/airpods-4.html">', page)
        self.assertRegex(page, r"<h1>Historique des prix AirPods 4 : \d+ marchands relevés</h1>")
        self.assertIn("Plus bas relevé historique", page)
        self.assertNotIn("Meilleur prix récent", page)
        self.assertNotIn('"@type": "AggregateOffer"', page)
        self.assertRegex(page, r"<title>Prix AirPods 4 : ")
        self.assertIn("<tbody><tr", page)
        self.assertIn("pas des offres actuelles", page)
        self.assertIn("Relevés historiques par marchand", page)
        self.assertNotIn("au meilleur prix", page.lower())
        self.assertNotIn("Comparer les", page)
        self.assertIn('"@type": "BreadcrumbList"', page)
        self.assertIn("tag=prixbasmalin2-21", page)
        self.assertIn('rel="sponsored nofollow noopener"', page)
        # Bouton Amazon : fiche produit directe si l'ASIN a été fourni, sinon recherche.
        self.assertRegex(page, r"(Rechercher|Voir) sur Amazon ↗")
        self.assertNotIn("Voir le prix du jour sur Amazon", page)


    def test_only_explicit_fresh_ttc_merchant_timestamps_are_current(self):
        now = seo.parse_utc("2026-11-24T10:00:00Z")
        base = {
            "price_verified": True, "price_tax_status": "included",
            "price_date_kind": "merchant", "currency": "EUR", "price_eur": 99.0, "date": "2026-11-23",
        }
        offers = [
            {**base, "merchant": "fresh", "price_date": "2026-11-23T10:00:00Z"},
            {**base, "merchant": "stale", "price_date": "2026-11-22T09:59:00Z"},
            {**base, "merchant": "tax-unknown", "price_tax_status": "unspecified",
             "price_date": "2026-11-24T09:00:00Z"},
            {**base, "merchant": "feed-date", "price_date_kind": "feed",
             "price_date": "2026-11-24T09:00:00Z"},
            {**base, "merchant": "date-only", "price_date": "2026-11-24"},
        ]
        self.assertEqual(
            [offer["merchant"] for offer in seo.verified_current_offers({"offers": offers}, now=now)],
            ["fresh"],
        )

    def test_historical_product_page_keeps_prices_without_claiming_a_current_best_price(self):
        product = {
            "id": "test-historical", "name": "Produit historique", "brand": "Marque",
            "category": "console", "category_label": "Consoles", "image": "",
            "offer_count": 2, "min_price_eur": 99.0, "max_price_eur": 109.0,
            "last_date": "2026-11-21", "history": [],
            "offers": [
                {"merchant": "amazon", "price_eur": 99.0, "date": "2026-11-21"},
                {"merchant": "fnac", "price_eur": 109.0, "date": "2026-11-20"},
            ],
        }
        page = seo.product_page(
            product, [], None, now=seo.parse_utc("2026-11-24T10:00:00Z")
        )
        self.assertIn("Plus bas relevé historique", page)
        self.assertIn("99,00", page)
        self.assertIn("21/11/2026", page)
        self.assertIn("à confirmer chez le marchand", page)
        self.assertNotIn("Meilleur prix récent", page)
        self.assertNotIn("le plus bas de la semaine", page)
        self.assertNotIn('"@type": "AggregateOffer"', page)
        self.assertNotIn('<tr class="best">', page)

    def test_black_friday_page_links_to_popular_product_pages_and_rakuten_catalogue(self):
        page = seo.build()["black-friday.html"]
        for target in (
            "/prix/ps5-slim.html",
            "/prix/ps5-pro.html",
            "/prix/gta-6-ps5.html",
            "/prix/switch-2.html",
            "/prix/airpods-pro-3.html",
            "/prix/iphone-17.html",
            "/catalogue.html",
        ):
            self.assertIn(f'href="{target}"', page)
        self.assertIn("Références à suivre avant le Black Friday", page)
        self.assertIn("relevés historiques datés", page)
        self.assertIn("à confirmer", page)

    def test_black_friday_labels_old_prices_as_historical_without_hiding_them(self):
        product = {
            "id": "switch-2", "name": "Nintendo Switch 2", "brand": "Nintendo",
            "category": "console", "category_label": "Consoles", "image": "",
            "offers": [
                {"date": "2026-11-14", "price_eur": 367.59, "merchant": "aliexpress"},
                {"date": "2026-11-21", "price_eur": 399.99, "merchant": "darty"},
            ],
        }
        card = seo.bf_card(product, today=seo.date(2026, 11, 24))
        self.assertIn("Prix historique · à confirmer chez le marchand", card)
        self.assertIn("367,59", card)
        self.assertIn("chez AliExpress le 14/11/2026", card)

    def test_black_friday_gap_section_uses_the_real_last_seven_days(self):
        old_product = {
            "id": "switch-2", "name": "Nintendo Switch 2", "brand": "Nintendo",
            "category": "console", "category_label": "Consoles", "image": "",
            "offers": [
                {"date": "2026-11-14", "price_eur": 100.0, "merchant": "amazon"},
                {"date": "2026-11-15", "price_eur": 110.0, "merchant": "fnac"},
                {"date": "2026-11-16", "price_eur": 120.0, "merchant": "darty"},
            ],
        }
        today = seo.date(2026, 11, 24)
        self.assertEqual(seo.recent_gap(old_product, today=today), 0.0)
        self.assertEqual(seo.bf_gap_section([old_product], today=today), "")

        fresh_product = {
            **old_product,
            "offers": [
                {"date": "2026-11-20", "price_eur": 100.0, "merchant": "amazon"},
                {"date": "2026-11-21", "price_eur": 110.0, "merchant": "fnac"},
                {"date": "2026-11-22", "price_eur": 120.0, "merchant": "darty"},
            ],
        }
        section = seo.bf_gap_section([fresh_product], today=today)
        self.assertIn("Jusqu’à 20,00 € d’écart entre marchands", section)
        self.assertIn("Prix relevé récemment · à confirmer", section)
        self.assertNotIn("Meilleur prix récent", section)

    def test_sitemap_and_robots_list_seo_pages(self):
        sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
        self.assertIn("<loc>https://prixbasmalin.fr/prix/airpods-4.html</loc><lastmod>", sitemap)
        self.assertIn("<loc>https://prixbasmalin.fr/idees-cadeaux/</loc>", sitemap)
        self.assertIn("https://prixbasmalin.fr/guide-black-friday-2026.html", (ROOT / "sitemap.txt").read_text(encoding="utf-8"))
        robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
        self.assertIn("Sitemap: https://prixbasmalin.fr/sitemap.xml", robots)
        self.assertNotIn("sitemap-prix.xml", robots)

    def test_gift_pages_require_fresh_merchant_date_and_ttc(self):
        now = seo.parse_utc("2026-11-06T13:00:00Z")
        def gift(name, **extra):
            item = {
                "name": name, "merchant": "Marchand test", "price_verified": True,
                "price_eur": 25.0, "price_date_kind": "merchant",
                "price_tax_status": "included", "price_date": "2026-11-06T12:30:00Z",
                "image": "https://img.example/product.jpg", "url": "https://merchant.example/product",
                "shipping_eur": 0, "family_label": "Parfum",
            }
            item.update(extra)
            return item
        deals = {"gifts": [
            gift("Parfum vérifié"),
            gift("Bandelette glycémie", family_label="Santé"),
            gift("Culotte gainante", family_label="Mode"),
            gift("Parfum périmé", price_date="2026-11-03T12:30:00Z"),
            gift("Parfum TVA inconnue", price_tax_status="unspecified"),
            gift("Parfum sans date", price_date=None),
        ]}
        items = seo.gift_items(deals, 10, 30, now=now)
        self.assertEqual([item["name"] for item in items], ["Parfum vérifié"])
        card = seo.gift_card(items[0])
        self.assertIn("Prix TTC confirmé", card)
        self.assertIn("Relevé marchand du", card)

    def test_gift_index_explains_when_no_verified_offer_exists(self):
        page = seo.gift_index([("moins-de-30-euros", "Idées cadeaux moins de 30 €", 0, 30, [])])
        self.assertIn("Aucune offre avec prix TTC confirmé", page)
        self.assertNotIn("Toutes les idées ont une photo et le prix du marchand", page)

    def test_interactive_page_points_canonical_to_static_page(self):
        page = (ROOT / "produit.html").read_text(encoding="utf-8")
        self.assertIn('"https://prixbasmalin.fr/prix/"+encodeURIComponent(p.id)+".html"', page)


    def test_generated_seo_outputs_are_staged_by_data_workflows(self):
        awin = (ROOT / ".github" / "workflows" / "sync-awin-products.yml").read_text(encoding="utf-8")
        guides = (ROOT / ".github" / "workflows" / "ai-guides.yml").read_text(encoding="utf-8")
        awin_diff = next(line for line in awin.splitlines() if "git diff --quiet --" in line)
        awin_add = next(line for line in awin.splitlines() if line.strip().startswith("git add "))
        ai_add = next(line for line in guides.splitlines() if line.strip().startswith("git add "))
        for path in ("black-friday.html", "cyber-monday.html", "idees-cadeaux", "prix"):
            self.assertIn(path, awin_diff)
            self.assertIn(path, awin_add)
            self.assertIn(path, ai_add)
        generated = seo.build()
        self.assertIn("black-friday.html", generated)
        self.assertIn("idees-cadeaux/index.html", generated)
        self.assertIn("cyber-monday.html", generated)

    def test_internal_product_links_reach_existing_pages_and_every_sheet(self):
        import re, os
        targets = set()
        for f in list((ROOT / "prix").glob("*.html")) + [ROOT / "black-friday.html", ROOT / "cyber-monday.html"]:
            targets.update(re.findall(r'href="(/prix/[a-z0-9-]+\.html)"', f.read_text(encoding="utf-8")))
        missing = sorted(t for t in targets if not (ROOT / t.lstrip("/")).exists())
        self.assertEqual(missing, [], "lien interne vers une page absente (404 pour Google)")
        index = (ROOT / "prix" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="toutes-les-fiches"', index)
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]
        for sheet in sheets:
            self.assertIn(f'href="/prix/{sheet["id"]}.html"', index)

    def test_similar_products_spread_links_across_the_whole_category(self):
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]
        linked = {s["id"] for p in sheets for s in seo.similar_products(p, sheets)}
        multi = {p["id"] for p in sheets if sum(1 for s in sheets if s["category"] == p["category"]) > 1}
        self.assertEqual(multi - linked, set())

    def test_cyber_monday_page_is_indexable_and_linked_from_black_friday(self):
        page = (ROOT / "cyber-monday.html").read_text(encoding="utf-8")
        self.assertIn("<h1>Cyber Monday 2026", page)
        self.assertIn('rel="canonical" href="https://prixbasmalin.fr/cyber-monday.html"', page)
        self.assertNotIn('id="bf-countdown"', page)  # le compte à rebours Black Friday ne doit pas réécrire la date
        self.assertIn('href="/black-friday.html"', page)
        self.assertIn('href="/cyber-monday.html"', (ROOT / "black-friday.html").read_text(encoding="utf-8"))
        self.assertIn("https://prixbasmalin.fr/cyber-monday.html", (ROOT / "sitemap.xml").read_text(encoding="utf-8"))
        self.assertIn("tag=prixbasmalin2-21", page)


if __name__ == "__main__":
    unittest.main()

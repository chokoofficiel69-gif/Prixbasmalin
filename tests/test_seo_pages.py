import importlib.util
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
        self.assertIn("<h1>Historique des prix de AirPods 4</h1>", page)
        self.assertIn("<tbody><tr", page)
        self.assertIn("pas des offres actuelles", page)
        self.assertIn("Relevés historiques par marchand", page)
        self.assertNotIn("au meilleur prix", page.lower())
        self.assertNotIn("Comparer les", page)
        self.assertIn('"@type": "BreadcrumbList"', page)
        self.assertIn("tag=prixbasmalin2-21", page)
        self.assertIn('rel="sponsored nofollow noopener"', page)

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


if __name__ == "__main__":
    unittest.main()

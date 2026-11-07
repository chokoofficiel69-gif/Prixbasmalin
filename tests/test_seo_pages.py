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
        stale = [rel for rel, text in files.items() if (ROOT / rel).read_text(encoding="utf-8") != text]
        self.assertEqual(stale, [], "lancez python3 scripts/build_seo_pages.py")

    def test_product_page_is_crawlable_and_dated(self):
        page = (ROOT / "prix" / "airpods-4.html").read_text(encoding="utf-8")
        self.assertIn('<link rel="canonical" href="https://prixbasmalin.fr/prix/airpods-4.html">', page)
        self.assertIn("<h1>AirPods 4 au meilleur prix</h1>", page)
        self.assertIn("<tbody><tr", page)
        self.assertIn("Prix relevés chez chaque marchand entre le", page)
        self.assertIn('"@type": "BreadcrumbList"', page)
        self.assertIn("tag=prixbasmalin2-21", page)
        self.assertIn('rel="sponsored nofollow noopener"', page)
        # Bouton Amazon affilié bien visible, et liens de recherche honnêtement libellés.
        self.assertIn("Voir le prix du jour sur Amazon ↗", page)
        self.assertIn(">Rechercher</a>", page)
        self.assertNotIn(">Voir l’offre</a>", page)

    def test_sitemap_and_robots_list_seo_pages(self):
        sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
        self.assertIn("<loc>https://prixbasmalin.fr/prix/airpods-4.html</loc><lastmod>", sitemap)
        self.assertIn("<loc>https://prixbasmalin.fr/idees-cadeaux/</loc>", sitemap)
        self.assertIn("https://prixbasmalin.fr/guide-black-friday-2026.html", (ROOT / "sitemap.txt").read_text(encoding="utf-8"))
        robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
        self.assertIn("Sitemap: https://prixbasmalin.fr/sitemap.xml", robots)
        self.assertNotIn("sitemap-prix.xml", robots)

    def test_gift_pages_exclude_medical_and_lingerie(self):
        for rel in ("idees-cadeaux/moins-de-30-euros.html", "idees-cadeaux/30-a-60-euros.html"):
            page = (ROOT / rel).read_text(encoding="utf-8").lower()
            for word in ("bandelette", "glycémie", "culotte", "gaine"):
                self.assertNotIn(word, page, rel)

    def test_interactive_page_points_canonical_to_static_page(self):
        page = (ROOT / "produit.html").read_text(encoding="utf-8")
        self.assertIn('"https://prixbasmalin.fr/prix/"+encodeURIComponent(p.id)+".html"', page)


if __name__ == "__main__":
    unittest.main()

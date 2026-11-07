import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ErrorPagesTests(unittest.TestCase):
    def test_custom_404_page_is_useful_and_not_indexed(self):
        page = (ROOT / "404.html").read_text(encoding="utf-8")
        self.assertIn('<meta name="robots" content="noindex">', page)
        self.assertIn('action="/produit.html"', page)
        self.assertIn('fetch("/data/home-deals.json"', page)
        self.assertIn('location.replace("/prix/"+encodeURIComponent(m[1])+".html")', page)
        # Les sondes de robots (wp-login, admin…) ne préremplissent pas la recherche.
        self.assertIn("!/^(wp|admin|login|xmlrpc|cgi|env|config)/.test(words)", page)
        # Toutes les ressources en chemin absolu : la page est servie à n'importe quelle adresse.
        for ref in ('href="/css/pm-product-art.css"', 'src="/js/pm-product-art.js"', 'src="/assets/mascotte-malin.svg"'):
            self.assertIn(ref, page)

    def test_browser_icons_exist(self):
        for name in ("favicon.ico", "apple-touch-icon.png", "apple-touch-icon-precomposed.png"):
            self.assertGreater((ROOT / name).stat().st_size, 1000, name)

    def test_rakuten_file_exists_and_only_publishes_sourced_affiliate_offers(self):
        # Le fichier existe toujours (pas de 404) ; s'il contient des offres, chacune a sa source et sa date.
        data = json.loads((ROOT / "data" / "rakuten-products.json").read_text(encoding="utf-8"))
        if data["status"] != "ok":
            self.assertEqual(data["products"], [])
            return
        self.assertTrue(data["generated_at"])
        for product in data["products"]:
            self.assertTrue(product["sourceUrl"].startswith("https://click.linksynergy.com/"))
            self.assertTrue(product["sourceCreatedAt"])
            self.assertGreater(product["priceValue"], 0)

    def test_catalogue_accepts_query_from_url(self):
        page = (ROOT / "catalogue.html").read_text(encoding="utf-8")
        self.assertIn('new URLSearchParams(location.search).get("q")', page)


if __name__ == "__main__":
    unittest.main()

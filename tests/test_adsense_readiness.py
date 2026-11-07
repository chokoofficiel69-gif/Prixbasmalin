import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class AdsenseReadinessTests(unittest.TestCase):
    def test_privacy_page_discloses_google_ads_cookies_and_affiliation(self):
        page = (ROOT / "confidentialite.html").read_text(encoding="utf-8")
        self.assertIn("Google AdSense", page)
        self.assertIn("https://adssettings.google.com/", page)
        self.assertIn("En tant que Partenaire Amazon", page)

    def test_public_pages_link_to_privacy_and_about(self):
        for name in ("index.html", "catalogue.html", "produit.html", "a-propos.html", "404.html"):
            page = (ROOT / name).read_text(encoding="utf-8")
            self.assertIn('id="pm-site-footer"', page, name)
            self.assertIn('href="/confidentialite.html"', page, name)
            self.assertIn('href="/a-propos.html"', page, name)

    def test_ads_txt_matches_publisher(self):
        self.assertIn("pub-6459242759876759", (ROOT / "ads.txt").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

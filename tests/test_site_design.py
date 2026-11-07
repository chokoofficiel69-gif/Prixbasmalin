"""Étape 1 de l'harmonisation : en-tête commun, feuille de style commune, cartes et boutons communs."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


chrome = load("site_chrome")
sitemap = load("build_sitemap")


class SiteDesignTests(unittest.TestCase):
    def test_every_public_page_except_home_has_the_common_header_once(self):
        for rel, text in sitemap.public_pages():
            if rel == "index.html":
                continue  # l'accueil garde son en-tête complet (favoris, alertes, compte), référence visuelle
            with self.subTest(page=rel):
                self.assertEqual(text.count('class="pm-site-header'), 1)
                self.assertEqual(text.count("<header"), 1, "un seul en-tête")
                self.assertIn('<link rel="stylesheet" href="/css/pm-design.css">', text)
                self.assertIn('aria-label="Rubriques"', text)

    def test_hand_written_pages_are_up_to_date(self):
        for name, current in chrome.PAGES.items():
            text = (ROOT / name).read_text(encoding="utf-8")
            self.assertEqual(chrome.apply(text, current), text, f"lancez python3 scripts/site_chrome.py ({name})")

    def test_header_keeps_affiliate_and_search(self):
        html = chrome.header_html("compare")
        self.assertIn('href="https://www.amazon.fr/gp/goldbox?tag=prixbasmalin2-21" target="_blank" rel="sponsored nofollow noopener"', html)
        self.assertIn('action="/catalogue.html"', html)
        self.assertIn('<a href="/prix/" aria-current="page">', html)
        compact = chrome.header_html("catalogue", variant="compact")
        self.assertNotIn("pm-site-search", compact, "le catalogue garde sa propre recherche")

    def test_comparator_search_uses_common_header_field(self):
        page = (ROOT / "produit.html").read_text(encoding="utf-8")
        self.assertIn('document.getElementById("pm-site-q")', page)
        self.assertIn('document.getElementById("pm-site-search").addEventListener("submit"', page)

    def test_generated_pages_use_common_cards_and_buttons(self):
        product = (ROOT / "prix" / "airpods-4.html").read_text(encoding="utf-8")
        self.assertIn('class="cta pm-btn pm-btn-amazon pm-btn-block"', product)
        self.assertIn('class="grid pm-cards"', product)
        self.assertIn('class="card pm-card"', product)

    def test_rakuten_files_are_not_part_of_the_design_pass(self):
        self.assertNotIn("rakuten", " ".join(chrome.PAGES))


if __name__ == "__main__":
    unittest.main()

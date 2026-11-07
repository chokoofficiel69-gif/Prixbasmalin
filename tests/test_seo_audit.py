"""Contrôles SEO de toutes les pages publiques (titre, description, canonique, Open Graph, H1, alt, langue)."""
import html
import importlib.util
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sitemap = load("build_sitemap")
guides = load("build_guides")
INTERNAL = {"design-accueil-v2.html", "maquette-noire.html", "verification.html", "stats.html", "produit.html"}


class SeoAuditTests(unittest.TestCase):
    def test_every_public_page_meets_basic_seo_rules(self):
        titles = {}
        for rel, text in sitemap.public_pages():
            with self.subTest(page=rel):
                title = html.unescape(re.search(r"<title>(.*?)</title>", text, re.S).group(1).strip())
                desc = re.search(r'<meta name="description" content="([^"]*)"', text)
                self.assertTrue(0 < len(title) <= 60, f"titre {len(title)} car. : {title}")
                self.assertTrue(desc and 0 < len(html.unescape(desc.group(1))) <= 155, "description absente ou > 155 car.")
                self.assertIn('rel="canonical"', text)
                self.assertIn('property="og:title"', text)
                self.assertIn('property="og:image"', text)
                self.assertEqual(len(re.findall(r"<h1[\s>]", text)), 1, "un seul H1")
                self.assertIn('<html lang="fr"', text)
                self.assertFalse([i for i in re.findall(r"<img\b[^>]*>", text) if " alt=" not in i], "image sans alt")
                titles.setdefault(title, []).append(rel)
        self.assertEqual({t: r for t, r in titles.items() if len(r) > 1}, {}, "titres en double")

    def test_internal_pages_are_noindex_and_out_of_sitemap(self):
        listed = (ROOT / "sitemap.txt").read_text(encoding="utf-8")
        for name in INTERNAL:
            self.assertIn('content="noindex', (ROOT / name).read_text(encoding="utf-8"), name)
            self.assertNotIn("/" + name, listed, name)

    def test_sitemap_lists_every_public_page(self):
        listed = (ROOT / "sitemap.txt").read_text(encoding="utf-8").split()
        self.assertEqual(len(listed), len(sitemap.public_pages()))
        self.assertEqual(listed[0], "https://prixbasmalin.fr/")

    def test_homepage_structured_data(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('"@type": "WebSite"', page)
        self.assertIn('"@type": "SearchAction"', page)
        self.assertIn('"@type": "Organization"', page)
        for cat in ("high-tech.html", "maison-deco.html", "mode.html", "offres.html", "guides.html"):
            self.assertIn('"BreadcrumbList"', (ROOT / cat).read_text(encoding="utf-8"), cat)

    def test_guides_are_generated_and_substantial(self):
        files = guides.build()
        self.assertEqual(len(files), 6)
        for rel, text in files.items():
            self.assertEqual((ROOT / rel).read_text(encoding="utf-8"), text, f"{rel} à régénérer")
            if rel != "guides.html":
                words = len(re.sub(r"<[^>]+>", " ", re.search(r"<main>(.*)</main>", text, re.S).group(1)).split())
                self.assertGreater(words, 700, rel)
                self.assertNotRegex(re.sub(r"<script.*?</script>", "", text, flags=re.S), r"\d+,\d\d\s?€", f"{rel} ne doit citer aucun prix")

    def test_internal_linking(self):
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        for target in ("/guides.html", "/prix/", "/idees-cadeaux/", "/guide-black-friday-2026.html"):
            self.assertIn(f'href="{target}"', index)
        self.assertIn('href="/guide-choisir-aspirateur-robot.html"', (ROOT / "prix" / "aspirateurs.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

"""Page boutiques partenaires & codes promo : à jour, validation stricte, codes expirés masqués."""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bp = load("build_partners_page")
CODE = {"marchand": "Boutique Test", "code": "TESTCODE", "reduction": "-10 %", "conditions": "exemple fictif de test",
        "fin": "2026-12-31", "url": "https://exemple.invalid/"}


class PartnersPageTests(unittest.TestCase):
    def test_page_is_up_to_date_and_honest(self):
        text = (ROOT / "boutiques-partenaires.html").read_text(encoding="utf-8")
        self.assertEqual(bp.build(), text)
        self.assertIn("/js/cookie-consent.js", text)
        self.assertIn("prixbasmalin.contact@gmail.com", text)
        self.assertIn("SIRET", text)
        self.assertIn("BFCM35", text)
        self.assertIn("à confirmer", text)

    def test_committed_data_is_valid(self):
        bp.validate(json.loads(bp.DATA.read_text(encoding="utf-8")))
        bp.validate({"codes": bp.campaign_codes(), "boutiques": []})

    def test_jowissa_campaign_code_is_visible_with_exact_dates(self):
        page = bp.build(today="2026-11-23")
        self.assertIn("Jowissa · Awin", page)
        self.assertIn("BFCM35", page)
        self.assertIn("35 % de réduction", page)
        self.assertIn("Disponible du 26/11/2026 au 01/12/2026", page)
        self.assertIn("awin1.com/cread.php?awinmid=59933&amp;awinaffid=3137386", page)

    def test_rakuten_and_amazon_routes_are_visible(self):
        page = bp.build(today="2026-11-23")
        self.assertIn("Decathlon via Rakuten", page)
        self.assertIn('href="/catalogue.html"', page)
        self.assertIn('href="https://www.amazon.fr/gp/goldbox?tag=prixbasmalin2-21"', page)
        self.assertIn("Offres de nos réseaux partenaires", page)

    def test_jowissa_campaign_code_is_removed_after_expiry(self):
        page = bp.build(today="2026-12-02")
        self.assertNotIn("BFCM35", page)

    def test_incomplete_code_or_unverified_shop_is_refused(self):
        for bad in ({**CODE, "fin": ""}, {**CODE, "url": "http://x"}, {**CODE, "fin": "31/12/2026"}):
            with self.assertRaises(ValueError):
                bp.validate({"codes": [bad], "boutiques": []})
        shop = {"id": "x", "nom": "X", "description": "d", "commander": "https://x.invalid", "siret": False}
        with self.assertRaises(ValueError):
            bp.validate({"codes": [], "boutiques": [shop]})
        undated = {**shop, "siret": True, "produits": [{"nom": "p", "image": "/a.jpg", "prix_eur": 20}]}
        with self.assertRaises(ValueError):
            bp.validate({"codes": [], "boutiques": [undated]})

    def test_expired_codes_are_not_published(self):
        saved = bp.DATA.read_text(encoding="utf-8")
        try:
            data = json.loads(saved)
            data["codes"] = [CODE, {**CODE, "code": "PERIME", "fin": "2026-01-01"}]
            bp.DATA.write_text(json.dumps(data), encoding="utf-8")
            page = bp.build(today="2026-11-09")
        finally:
            bp.DATA.write_text(saved, encoding="utf-8")
        self.assertIn("TESTCODE", page)
        self.assertNotIn("PERIME", page)
        self.assertIn('rel="sponsored nofollow noopener"', page)

    def test_linked_from_home_and_footer(self):
        self.assertIn('href="/boutiques-partenaires.html"', (ROOT / "index.html").read_text(encoding="utf-8"))
        self.assertIn('href="/boutiques-partenaires.html"', (ROOT / "scripts" / "partials" / "site-footer.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

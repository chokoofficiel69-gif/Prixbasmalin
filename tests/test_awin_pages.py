import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_awin_pages as pages  # noqa: E402

NOW = datetime(2026, 11, 15, 10, 0, tzinfo=timezone.utc)


def product(i, **over):
    p = {
        "id": f"p{i}", "name": f"Produit &quot;{i}&quot;", "brand": "Marque", "merchant": f"Boutique {i % 2}",
        "category": "tech", "priceValue": 19.9 + i, "shippingPriceValue": 0.0, "gtin": "3000000000000",
        "image": f"https://img.example/{i}.jpg", "sourceUrl": f"https://www.awin1.com/pclick.php?p={i}",
        "merchantUpdatedAt": "2026-11-15 00:11:04", "feedUpdatedAt": "2026-11-15 00:11:04",
        "priceTaxStatus": "included",
    }
    p.update(over)
    return p


class AwinPagesTest(unittest.TestCase):
    def build(self, products):
        return pages.build({"status": "ok", "products": products}, now=NOW)

    def test_page_uses_individual_merchant_price_date_and_affiliate_notice(self):
        files = self.build([product(1), product(2)])
        page = files["produits/tech.html"]
        self.assertIn("Prix TTC indiqué par le marchand le 15/11/2026", page)
        self.assertIn('rel="sponsored nofollow noopener"', page)
        self.assertIn("Produit &quot;1&quot;", page)
        self.assertNotIn("&amp;quot;", page)
        self.assertIn("date individuelle de mise à jour", page)
        self.assertIn("produits/index.html", files)

    def test_feed_import_date_never_substitutes_for_merchant_price_date(self):
        files = self.build([
            product(1, merchantUpdatedAt=""),
            product(2, merchantUpdatedAt="2026-11-10 00:00:00"),
            product(3, merchantUpdatedAt="2026-11-16 00:00:00"),
        ])
        page = files["produits/tech.html"]
        self.assertEqual(page.count("<strong>Prix non affiché</strong>"), 3)
        self.assertNotIn("20,90", page)
        self.assertNotIn("21,90", page)
        self.assertNotIn("22,90", page)
        self.assertIn("Date individuelle du marchand absente ou supérieure à 48 h", page)

    def test_unconfirmed_tax_is_never_labelled_ttc(self):
        page = self.build([product(1, priceTaxStatus="unspecified")])["produits/tech.html"]
        self.assertIn("20,90", page)
        self.assertIn("TVA non confirmée", page)
        self.assertNotIn("Prix TTC indiqué par le marchand", page)
        self.assertIn("ne constitue pas un prix TTC vérifié", page)

    def test_old_undated_future_catalogue_rows_are_excluded(self):
        files = self.build([
            product(1, feedUpdatedAt="2026-11-01 00:00:00"),
            product(2, feedUpdatedAt=""),
            product(3, feedUpdatedAt="2026-11-16 00:00:00"),
            product(5, name="Shipping Protection"),
            product(6, name="Glucomètre portable"),
            product(7, sourceUrl="http://insecure.example"),
        ])
        self.assertEqual(files, {})

    def test_cheap_product_is_not_given_a_published_price(self):
        page = self.build([product(4, priceValue=2.0)])["produits/tech.html"]
        self.assertIn("<strong>Prix non affiché</strong>", page)
        self.assertNotIn("2,00", page)

    def test_selection_alternates_merchants_and_respects_limit(self):
        items = [product(i, merchant="A") for i in range(60)] + [product(100 + i, merchant="B") for i in range(3)]
        page = self.build(items)["produits/tech.html"]
        self.assertEqual(page.count('class="card pm-card"'), pages.PER_CATEGORY)
        self.assertEqual(page.count("<small>Marque · B</small>"), 3)

    def test_awin_sync_workflow_stages_generated_product_pages(self):
        workflow = (pages.ROOT / ".github" / "workflows" / "sync-awin-products.yml").read_text(encoding="utf-8")
        stage_commands = [line.strip() for line in workflow.splitlines() if line.strip().startswith("git add ")]
        self.assertTrue(stage_commands, "Le workflow doit contenir une commande git add.")
        self.assertTrue(any("produits" in command.split() for command in stage_commands),
                        "Les pages produits détectées par git diff doivent aussi être ajoutées au commit.")


if __name__ == "__main__":
    unittest.main()

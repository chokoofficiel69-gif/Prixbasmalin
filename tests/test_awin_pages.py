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
        "feedUpdatedAt": "2026-11-15 00:11:04",
    }
    p.update(over)
    return p


class AwinPagesTest(unittest.TestCase):
    def build(self, products):
        return pages.build({"status": "ok", "products": products}, now=NOW)

    def test_page_shows_feed_date_and_affiliate_notice(self):
        files = self.build([product(1), product(2)])
        page = files["produits/tech.html"]
        self.assertIn("Prix indiqué dans le flux du marchand du 15/11/2026", page)
        self.assertIn('rel="sponsored nofollow noopener"', page)
        self.assertIn("Produit &quot;1&quot;", page)  # entité décodée puis ré-échappée une seule fois
        self.assertNotIn("&amp;quot;", page)
        self.assertIn("produits/index.html", files)

    def test_old_undated_future_or_cheap_offers_are_excluded(self):
        files = self.build([
            product(1, feedUpdatedAt="2026-11-01 00:00:00"),
            product(2, feedUpdatedAt=""),
            product(3, feedUpdatedAt="2026-11-16 00:00:00"),
            product(4, priceValue=2.0),
            product(5, name="Shipping Protection"),
            product(6, name="Glucomètre portable"),
            product(7, sourceUrl="http://insecure.example"),
        ])
        self.assertEqual(files, {})

    def test_selection_alternates_merchants_and_respects_limit(self):
        items = [product(i, merchant="A") for i in range(60)] + [product(100 + i, merchant="B") for i in range(3)]
        page = self.build(items)["produits/tech.html"]
        self.assertEqual(page.count('class="card pm-card"'), pages.PER_CATEGORY)
        self.assertEqual(page.count("<small>Marque · B</small>"), 3)


if __name__ == "__main__":
    unittest.main()

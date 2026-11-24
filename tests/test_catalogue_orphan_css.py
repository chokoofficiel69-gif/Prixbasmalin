import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = (ROOT / "catalogue.html").read_text(encoding="utf-8")


class CatalogueOrphanCssTests(unittest.TestCase):
    def test_orphan_price_hiding_block_is_not_rendered_in_catalogue(self):
        self.assertNotIn(
            "Vitrine publique : les prix et détails de collecte restent masqués",
            CATALOGUE,
        )

    def test_public_price_and_date_styles_remain_available(self):
        self.assertIn('id="pm-card2-style"', CATALOGUE)
        self.assertIn(".pm-c2-price", CATALOGUE)
        self.assertIn(".pm-c2-date", CATALOGUE)
        self.assertIn("discovery-disclaimer", CATALOGUE)


if __name__ == "__main__":
    unittest.main()

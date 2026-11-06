import unittest
from pathlib import Path

INDEX = Path(__file__).resolve().parents[1] / "index.html"


class HomeProductImageTests(unittest.TestCase):
    def test_home_product_cards_require_verified_image_provenance(self):
        source = INDEX.read_text(encoding="utf-8")
        self.assertIn('const verifiedImageStatuses = new Set(["manufacturer_verified","official_press_image","retailer_product_image","authorized_feed_image"])', source)
        self.assertIn("!verifiedImageStatuses.has(product.imageStatus)", source)
        self.assertIn('product.imageKind === "illustration"', source)
        self.assertIn("/unsplash\\.com/i.test(imageUrl)", source)

    def test_home_product_cards_deduplicate_image_urls(self):
        source = INDEX.read_text(encoding="utf-8")
        self.assertIn("const usedImages = new Set();", source)
        self.assertIn("usedImages.has(imageUrl)", source)

    def test_home_customer_copy_shows_verified_image_count_not_catalogue_total(self):
        source = INDEX.read_text(encoding="utf-8")
        self.assertNotIn("341 références du catalogue", source)
        self.assertNotIn("produits illustrés du catalogue", source)
        self.assertIn("références avec visuel vérifié", source)

    def test_seasonal_image_rotation_has_its_own_provenance_scope(self):
        source = INDEX.read_text(encoding="utf-8")
        seasonal = source.split('<script id="pm-seasonal-campaign">', 1)[1].split("</script>", 1)[0]
        self.assertIn("const verifiedImageStatuses=new Set(", seasonal)
        self.assertIn("verifiedImageStatuses.has(p.imageStatus)", seasonal)


if __name__ == "__main__":
    unittest.main()

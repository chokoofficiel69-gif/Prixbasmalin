import unittest
from pathlib import Path

INDEX = Path(__file__).resolve().parents[1] / "index.html"


class HomeProductImageTests(unittest.TestCase):
    def test_home_product_cards_exclude_generic_or_illustrative_images(self):
        source = INDEX.read_text(encoding="utf-8")
        self.assertIn("const isGenericImage = /unsplash\\.com/i.test(imageUrl)", source)
        self.assertIn('product.imageKind === "illustration"', source)
        self.assertIn('product.imageStatus === "generic_category_visual"', source)

    def test_home_product_cards_deduplicate_image_urls(self):
        source = INDEX.read_text(encoding="utf-8")
        self.assertIn("const usedImages = new Set();", source)
        self.assertIn("usedImages.has(imageUrl)", source)

    def test_home_customer_copy_does_not_expose_catalogue_counts(self):
        source = INDEX.read_text(encoding="utf-8")
        self.assertNotIn("341 références du catalogue", source)
        self.assertNotIn("produits illustrés du catalogue", source)
        self.assertIn("Sélection de produits à découvrir", source)


if __name__ == "__main__":
    unittest.main()

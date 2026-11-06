import unittest

from scripts.build_home_products import build_feed, extract_products, has_verified_image


class BuildHomeProductsTests(unittest.TestCase):
    def test_preserves_image_provenance_without_copying_prices(self):
        html = '''
        const productData = [
          {"id":"one","name":"Produit exact","image":"https://img.example/one.jpg",
           "imageStatus":"manufacturer_verified","imageKind":"official",
           "imageSource":"https://brand.example/one","imageSourceName":"Fabricant",
           "sourceUrl":"https://shop.example/one","priceValue":99.99},
          {"id":"two","name":"Visuel générique","image":"https://images.unsplash.com/two.jpg",
           "imageStatus":"generic_category_visual","imageKind":"illustration",
           "sourceUrl":"https://shop.example/two"}
        ];
        '''
        feed = build_feed(html, generated_at="2026-11-06")
        self.assertEqual(feed["count"], 2)
        self.assertEqual(feed["verified_image_count"], 1)
        self.assertEqual(feed["unverified_image_count"], 1)
        first = feed["products"][0]
        self.assertEqual(first["imageStatus"], "manufacturer_verified")
        self.assertEqual(first["imageSourceName"], "Fabricant")
        self.assertNotIn("priceValue", first)

    def test_missing_or_generic_provenance_is_not_a_verified_photo(self):
        self.assertFalse(has_verified_image({
            "image":"https://img.example/product.jpg",
            "imageStatus":"generic_category_visual",
        }))
        self.assertFalse(has_verified_image({
            "image":"https://img.example/product.jpg",
        }))
        self.assertFalse(has_verified_image({
            "image":"https://images.unsplash.com/photo.jpg",
            "imageStatus":"manufacturer_verified",
        }))

    def test_duplicate_product_ids_are_rejected(self):
        html = 'const productData=[{"id":"x","name":"A"},{"id":"x","name":"B"}];'
        with self.assertRaisesRegex(ValueError, "dupliqué"):
            extract_products(html)


if __name__ == "__main__":
    unittest.main()

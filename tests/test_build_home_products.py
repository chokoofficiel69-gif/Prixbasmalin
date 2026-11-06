import unittest
from datetime import datetime, timezone

from scripts.build_home_products import (
    build_feed, extract_products, has_verified_image, select_awin_home_products,
)


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

    def test_fresh_awin_feed_adds_only_authorized_photo_cards_without_prices(self):
        now = datetime(2026, 11, 6, 13, 0, tzinfo=timezone.utc)
        feed = {
            "status": "ok",
            "fetched_at": "2026-11-06T12:00:00Z",
            "products": [
                {
                    "id": f"feed-{index}",
                    "name": f"Produit Awin {index}",
                    "merchant": f"Marchand {index % 4}",
                    "category": ("tech", "home", "fashion", "beauty")[index % 4],
                    "image": f"https://img.example/awin-{index}.jpg",
                    "sourceUrl": f"https://shop.example/product/{index}",
                    "imageSource": f"https://shop.example/product/{index}",
                    "imageSourceName": f"Marchand {index % 4}",
                    "imageStatus": "authorized_feed_image",
                    "imageKind": "merchant_feed",
                    "priceValue": 19.99,
                    "offers": [{"priceValue": 19.99}],
                }
                for index in range(8)
            ],
        }
        selected = select_awin_home_products(feed, existing_products=[], now=now)
        self.assertEqual(len(selected), 8)
        snapshot = build_feed(
            'const productData=[{"id":"static","name":"Produit statique","image":"https://img.example/static.jpg","imageStatus":"manufacturer_verified","imageKind":"official"}];',
            generated_at="2026-11-06",
            awin_products=selected,
        )
        self.assertEqual(snapshot["count"], 9)
        self.assertEqual(sum(p["id"].startswith("awin-home-") for p in snapshot["products"]), 8)
        for product in snapshot["products"]:
            self.assertNotIn("priceValue", product)
            self.assertNotIn("price", product)
            self.assertNotIn("offers", product)
        awin_card = next(p for p in snapshot["products"] if p["id"].startswith("awin-home-"))
        self.assertEqual(awin_card["imageStatus"], "authorized_feed_image")
        self.assertEqual(awin_card["imageKind"], "merchant_feed")
        self.assertTrue(awin_card["imageSourceName"].startswith("Marchand "))
        self.assertIn("Awin direct feed images only", snapshot["generated_from"])

    def test_awin_feed_images_are_deduplicated_and_categories_are_balanced(self):
        now = datetime(2026, 11, 6, 13, 0, tzinfo=timezone.utc)
        products = []
        for index in range(8):
            products.append({
                "id": f"feed-{index}",
                "name": f"Produit {index}",
                "merchant": "Marchand",
                "category": ("tech", "home", "fashion", "beauty")[index % 4],
                "image": f"https://img.example/{index}.jpg",
                "sourceUrl": f"https://shop.example/{index}",
                "imageSource": f"https://shop.example/{index}",
                "imageSourceName": "Marchand",
                "imageStatus": "authorized_feed_image",
                "imageKind": "merchant_feed",
            })
        products.append(dict(products[0], id="duplicate-image"))
        feed = {"status": "ok", "fetched_at": "2026-11-06T12:00:00Z", "products": products}
        selected = select_awin_home_products(feed, now=now)
        self.assertEqual(len(selected), 8)
        self.assertEqual(len({p["image"] for p in selected}), 8)
        counts = {}
        for product in selected:
            counts[product["category"]] = counts.get(product["category"], 0) + 1
        self.assertTrue(all(count <= 2 for count in counts.values()))

    def test_stale_or_insufficient_awin_feed_keeps_previous_photo_batch(self):
        now = datetime(2026, 11, 6, 13, 0, tzinfo=timezone.utc)
        base = {
            "id": "feed-1", "name": "Produit Awin", "merchant": "Marchand",
            "category": "tech", "image": "https://img.example/awin.jpg",
            "sourceUrl": "https://shop.example/awin", "imageSource": "https://shop.example/awin",
            "imageSourceName": "Marchand", "imageStatus": "authorized_feed_image",
            "imageKind": "merchant_feed",
        }
        stale = {"status": "ok", "fetched_at": "2026-11-03T12:00:00Z", "products": [dict(base) for _ in range(8)]}
        self.assertIsNone(select_awin_home_products(stale, now=now))
        insufficient = {"status": "ok", "fetched_at": "2026-11-06T12:00:00Z", "products": [dict(base, id=f"feed-{i}", image=f"https://img.example/{i}.jpg") for i in range(7)]}
        self.assertIsNone(select_awin_home_products(insufficient, now=now))

        previous_awin = dict(base, id="awin-home-previous")
        previous = {"products": [previous_awin]}
        snapshot = build_feed(
            'const productData=[{"id":"static","name":"Produit statique"}];',
            generated_at="2026-11-06",
            awin_products=None,
            previous=previous,
        )
        self.assertIn("awin-home-previous", [p["id"] for p in snapshot["products"]])


if __name__ == "__main__":
    unittest.main()

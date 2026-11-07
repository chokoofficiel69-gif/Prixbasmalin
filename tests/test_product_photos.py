"""Photos produits : hébergées sur le site, sous licence libre vérifiée, avec crédit."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ProductPhotosTests(unittest.TestCase):
    def setUp(self):
        self.images = json.loads((ROOT / "data" / "product-images.json").read_text(encoding="utf-8"))["images"]

    def test_every_photo_is_hosted_licensed_and_credited(self):
        self.assertGreaterEqual(len(self.images), 30)
        for pid, entry in self.images.items():
            with self.subTest(product=pid):
                self.assertTrue(entry["thumb"].startswith("/assets/produits/"))
                self.assertTrue((ROOT / entry["thumb"].lstrip("/")).is_file())
                words = re.sub(r"[^a-z0-9.]+", " ", entry["license"].lower()).split()
                self.assertNotIn("nc", words)
                self.assertNotIn("nd", words)
                self.assertRegex(entry["license"].lower(), r"^(cc0|public domain|cc by)")
                self.assertTrue(entry["author"])
                self.assertTrue(entry["file_page"].startswith("https://commons.wikimedia.org/wiki/File:"))
                self.assertEqual(entry["match"], "verifie_visuellement")

    def test_photos_reach_the_product_pages_with_credit(self):
        sheets = {p["id"]: p for p in json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]}
        for pid in self.images:
            self.assertEqual(sheets[pid]["image"], self.images[pid]["thumb"], pid)
            self.assertTrue(sheets[pid]["image_credit"]["license"], pid)
        page = (ROOT / "prix" / "airpods-4.html").read_text(encoding="utf-8")
        self.assertIn('src="/assets/produits/airpods-4.jpg"', page)
        self.assertIn("Wikimedia Commons", page)

    def test_rejected_proposals_are_not_published(self):
        proposals = json.loads((ROOT / "data" / "product-images-proposals.json").read_text(encoding="utf-8"))
        for pid in proposals["rejected"]:
            self.assertNotIn(pid, self.images, pid)

    def test_photo_workflow_never_writes_to_main(self):
        wf = (ROOT / ".github" / "workflows" / "fetch-product-photos.yml").read_text(encoding="utf-8")
        self.assertIn("if: github.ref != 'refs/heads/main'", wf)


if __name__ == "__main__":
    unittest.main()

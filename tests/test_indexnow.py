import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import indexnow_submit as ix  # noqa: E402

SITEMAP = """<urlset>
<url><loc>https://prixbasmalin.fr/</loc><lastmod>2026-11-21</lastmod></url>
<url><loc>https://prixbasmalin.fr/old.html</loc><lastmod>2026-10-01</lastmod></url>
<url><loc>https://evil.example/x</loc><lastmod>2026-11-21</lastmod></url>
<url><loc>https://prixbasmalin.fr/</loc><lastmod>2026-11-21</lastmod></url>
</urlset>"""


class IndexNowTest(unittest.TestCase):
    def test_filters_by_date_host_and_duplicates(self):
        self.assertEqual(ix.urls_from_sitemap(SITEMAP, date(2026, 11, 20)), ["https://prixbasmalin.fr/"])
        self.assertEqual(len(ix.urls_from_sitemap(SITEMAP)), 2)

    def test_key_file_matches_and_payload(self):
        self.assertEqual((ROOT / f"{ix.KEY}.txt").read_text().strip(), ix.KEY)
        p = ix.payload(["https://prixbasmalin.fr/"])
        self.assertEqual(p["keyLocation"], f"https://prixbasmalin.fr/{ix.KEY}.txt")

    def test_real_sitemap_parses(self):
        self.assertGreater(len(ix.urls_from_sitemap((ROOT / "sitemap.xml").read_text())), 50)


if __name__ == "__main__":
    unittest.main()

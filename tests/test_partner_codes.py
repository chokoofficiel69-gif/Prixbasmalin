import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_seo_pages as seo  # noqa: E402


class PartnerCodesTest(unittest.TestCase):
    def test_codes_file_is_valid(self):
        data = json.loads((ROOT / "data" / "partner-codes.json").read_text(encoding="utf-8"))
        for c in data["codes"]:
            self.assertTrue(c["url"].startswith("https://www.awin1.com/cread.php?"))
            self.assertLessEqual(c["start"], c["end"])
            self.assertTrue(c["source"])

    def test_section_shown_before_end_and_hidden_after(self):
        html = seo.partner_codes_section("2026-11-22")
        self.assertIn("BFCM35", html)
        self.assertIn('rel="sponsored nofollow noopener"', html)
        self.assertEqual(seo.partner_codes_section("2026-12-02"), "")


if __name__ == "__main__":
    unittest.main()

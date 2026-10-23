import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "import_partner_csv.py"
SPEC = importlib.util.spec_from_file_location("import_partner_csv", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


HEADER = "offer_id,catalog_product_id,product_name,merchant_name,source,identity_type,identity_value,brand,price,shipping_price,currency,product_url,tracking_url,checked_at\n"
ROW = "offer-1,headphones-1,Headphones,Shop,authorized_csv,asin,B012345678,Brand,49.99,4.90,EUR,https://shop.example/item,,2026-10-23T12:00:00+02:00\n"


class ImportPartnerCsvTests(unittest.TestCase):
    def write_csv(self, content):
        tmp = tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", delete=False)
        tmp.write(content)
        tmp.close()
        self.addCleanup(lambda: Path(tmp.name).unlink(missing_ok=True))
        return tmp.name

    def test_imports_valid_offer_and_normalizes_decimal_comma(self):
        path = self.write_csv(HEADER + ROW.replace("49.99,4.90", "49,99,4,90"))
        # Decimal commas require quoted CSV fields to avoid splitting columns.
        path = self.write_csv(HEADER + ROW.replace("49.99,4.90", '"49,99","4,90"'))
        result = MODULE.convert_csv(path)
        self.assertEqual(len(result["offers"]), 1)
        self.assertEqual(result["offers"][0]["price"], 49.99)
        self.assertEqual(result["offers"][0]["shipping_price"], 4.90)
        self.assertNotIn("tracking_url", result["offers"][0])

    def test_rejects_missing_required_column(self):
        path = self.write_csv("offer_id,price\nabc,12\n")
        with self.assertRaisesRegex(ValueError, "Colonnes manquantes"):
            MODULE.convert_csv(path)

    def test_rejects_duplicate_offer_id(self):
        path = self.write_csv(HEADER + ROW + ROW.replace("catalog_product_id", "catalog_product_id"))
        with self.assertRaisesRegex(ValueError, "offer_id dupliqué"):
            MODULE.convert_csv(path)

    def test_rejects_mpn_without_brand(self):
        row = ROW.replace("asin,B012345678,Brand", "mpn,MODEL-123,")
        path = self.write_csv(HEADER + row)
        with self.assertRaisesRegex(ValueError, "brand obligatoire"):
            MODULE.convert_csv(path)

    def test_rejects_non_https_url(self):
        path = self.write_csv(HEADER + ROW.replace("https://shop.example/item", "http://shop.example/item"))
        with self.assertRaisesRegex(ValueError, "URL HTTPS"):
            MODULE.convert_csv(path)


if __name__ == "__main__":
    unittest.main()

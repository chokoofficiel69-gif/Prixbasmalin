import datetime as dt
import gzip
import importlib.util
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import-rakuten-catalogue.py"
SPEC = importlib.util.spec_from_file_location("rakuten_import", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
UTC = dt.timezone.utc


def write_feed(path, created_on="11/05/2026 0:13:11", trailer=True, trailer_count=1,
               gtin="4006381333931", part_number="", image_url="https://images.example.test/item.jpg",
               product_url="https://click.linksynergy.com/deeplink?id=example", price_currency="EUR",
               shipping_currency="EUR", availability="in-stock"):
    root = ET.Element("catalog")
    header = ET.SubElement(root, "header")
    ET.SubElement(header, "createdOn").text = created_on
    product = ET.SubElement(root, "product", {
        "product_id": "item-1", "sku_number": "sku-1", "name": "Chaussures de running test",
        "manufacturer_name": "Marque Test", "part_number": part_number,
    })
    price = ET.SubElement(product, "price", {"currency": price_currency})
    ET.SubElement(price, "retail").text = "19.99"
    ET.SubElement(price, "sale").text = ""
    shipping = ET.SubElement(product, "shipping")
    ET.SubElement(shipping, "availability").text = availability
    cost = ET.SubElement(shipping, "cost")
    ET.SubElement(cost, "amount").text = "5.00"
    ET.SubElement(cost, "currency").text = shipping_currency
    category = ET.SubElement(product, "category")
    ET.SubElement(category, "primary").text = "Chaussures"
    ET.SubElement(category, "secondary").text = "Running"
    description = ET.SubElement(product, "description")
    ET.SubElement(description, "short").text = "Description test"
    urls = ET.SubElement(product, "URL")
    ET.SubElement(urls, "productImage").text = image_url
    ET.SubElement(urls, "product").text = product_url
    ET.SubElement(product, "brand").text = "Marque Test"
    ET.SubElement(product, "upc").text = gtin
    if trailer:
        tail = ET.SubElement(root, "trailer")
        ET.SubElement(tail, "numberOfProducts").text = str(trailer_count)
    with gzip.open(path, "wb") as stream:
        stream.write(ET.tostring(root, encoding="utf-8", xml_declaration=True))


class RakutenImportValidationTests(unittest.TestCase):
    def test_ambiguous_created_on_requires_explicit_date_format(self):
        with self.assertRaises(ValueError):
            MODULE.parse_source_timestamp("05/11/2026 0:13:11", "")

    def test_created_on_parses_both_supported_formats_explicitly(self):
        us = MODULE.parse_source_timestamp("05/11/2026 0:13:11", "MM/DD/YYYY")
        fr = MODULE.parse_source_timestamp("05/11/2026 0:13:11", "DD/MM/YYYY")
        self.assertEqual(us, dt.datetime(2026, 5, 11, 0, 13, 11, tzinfo=UTC))
        self.assertEqual(fr, dt.datetime(2026, 11, 5, 0, 13, 11, tzinfo=UTC))

    def test_gtin_check_digit_is_validated(self):
        self.assertTrue(MODULE.is_valid_gtin("4006381333931"))
        self.assertFalse(MODULE.is_valid_gtin("4006381333932"))
        self.assertFalse(MODULE.is_valid_gtin("12345"))

    def test_complete_fresh_feed_is_parsed_with_shipping_and_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "feed.xml.gz"
            write_feed(path)
            now = dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
            rows, source_created, stats = MODULE.parse_feed(
                path, "Decathlon National", "decathlon", "MM/DD/YYYY",
                now=now, max_age_hours=48, price_tax_status="unspecified"
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["priceValue"], 19.99)
        self.assertEqual(rows[0]["shippingPriceValue"], 5.0)
        self.assertEqual(rows[0]["gtin"], "4006381333931")
        self.assertEqual(rows[0]["priceTaxStatus"], "unspecified")
        self.assertEqual(rows[0]["imageStatus"], "authorized_feed_image")
        self.assertIsNone(rows[0]["regularPriceValue"])
        self.assertEqual(rows[0]["sourceCreatedAt"], "2026-11-05T00:13:11Z")
        self.assertEqual(stats["raw_products"], 1)
        self.assertEqual(source_created, dt.datetime(2026, 11, 5, 0, 13, 11, tzinfo=UTC))

    def test_missing_trailer_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "incomplete.xml.gz"
            write_feed(path, trailer=False)
            with self.assertRaisesRegex(ValueError, "Trailer XML absent"):
                MODULE.parse_feed(path, "Nicchia Luxury", "nicchia", "MM/DD/YYYY",
                                  now=dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC))

    def test_trailer_count_must_match_received_products(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mismatch.xml.gz"
            write_feed(path, trailer_count=2)
            with self.assertRaisesRegex(ValueError, "Trailer incohérent"):
                MODULE.parse_feed(path, "Decathlon National", "decathlon", "MM/DD/YYYY",
                                  now=dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC))

    def test_stale_feed_is_rejected_using_source_timestamp_not_download_time(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stale.xml.gz"
            write_feed(path, created_on="10/01/2026 0:13:11")
            with self.assertRaisesRegex(ValueError, "Flux périmé"):
                MODULE.parse_feed(path, "Decathlon National", "decathlon", "MM/DD/YYYY",
                                  now=dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC))

    def test_product_without_gtin_or_brand_mpn_is_not_publishable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "no-identity.xml.gz"
            write_feed(path, gtin="12345")
            with self.assertRaisesRegex(ValueError, "Aucune fiche exploitable"):
                MODULE.parse_feed(path, "Decathlon National", "decathlon", "MM/DD/YYYY",
                                  now=dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC))

    def test_brand_and_manufacturer_part_number_are_a_valid_exact_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "mpn.xml.gz"
            write_feed(path, gtin="12345", part_number="MPN-EXACT-1")
            rows, _, _ = MODULE.parse_feed(
                path, "Nicchia Luxury", "nicchia", "MM/DD/YYYY",
                now=dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
            )
        self.assertEqual(rows[0]["gtin"], "")
        self.assertEqual(rows[0]["mpn"], "MPN-EXACT-1")

    def test_non_eur_shipping_is_not_used_in_total_comparison(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "shipping.xml.gz"
            write_feed(path, shipping_currency="USD")
            rows, _, _ = MODULE.parse_feed(
                path, "Decathlon National", "decathlon", "MM/DD/YYYY",
                now=dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
            )
        self.assertIsNone(rows[0]["shippingPriceValue"])


    def test_partial_category_feed_without_trailer_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "54306_4768926_1_cmp.xml.gz"
            write_feed(path, trailer=False)
            rows, source_created, stats = MODULE.parse_feed(
                path, "Nicchia Luxury (flux catégorie)", "nicchia", "MM/DD/YYYY",
                now=dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC), require_trailer=False
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(stats["raw_products"], 1)
        self.assertEqual(source_created, dt.datetime(2026, 11, 5, 0, 13, 11, tzinfo=UTC))

    def test_workflow_downloads_category_feed_and_uses_one_explicit_french_date_default(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "import-rakuten-catalogue.yml").read_text(encoding="utf-8")
        self.assertIn('54306_4768926_1_cmp.xml.gz', workflow)
        self.assertIn('sftp://aftp.linksynergy.com/${mid}/', workflow)
        self.assertIn('44806_4768926_mp.xml.gz', workflow)
        self.assertIn('racine et dossier MID vérifiés', workflow)
        self.assertEqual(workflow.count("vars.RAKUTEN_DATE_FORMAT || 'MM/DD/YYYY'"), 2)
        self.assertNotIn("vars.RAKUTEN_DATE_FORMAT || 'DD/MM/YYYY'", workflow)
        self.assertIn('54306_4768926_mp.xml.gz', workflow)
        self.assertIn("vars.RAKUTEN_PRICE_TAX_STATUS || 'unspecified'", workflow)
        self.assertIn("vars.RAKUTEN_PRICE_TAX_STATUS_VERIFIED || 'false'", workflow)
        self.assertIn('--price-tax-status-verified "${RAKUTEN_PRICE_TAX_STATUS_VERIFIED:-false}"', workflow)
        self.assertIn('${RAKUTEN_PRICE_TAX_STATUS:-unspecified}', workflow)
        self.assertNotIn("'included'", workflow)
        self.assertIn("if: github.event_name != 'pull_request'", workflow)

    def test_ttc_requires_explicit_confirmation(self):
        self.assertEqual(MODULE.resolve_price_tax_status("included", False), "unspecified")
        self.assertEqual(MODULE.resolve_price_tax_status("included", True), "included")
        self.assertEqual(MODULE.resolve_price_tax_status("unspecified", True), "unspecified")

    def test_public_pages_require_verified_rakuten_tax_status(self):
        root = Path(__file__).resolve().parents[1]
        homepage = (root / "index.html").read_text(encoding="utf-8")
        catalogue = (root / "catalogue.html").read_text(encoding="utf-8")
        self.assertIn("rakuten?.priceTaxStatusVerified===true", homepage)
        self.assertIn("feed.priceTaxStatusVerified===true", catalogue)
        self.assertIn("taxStatusVerified&&pmAwinPriceIsFresh", catalogue)

    def test_workflow_requires_pinned_host_key_and_retries_atomic_downloads(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "import-rakuten-catalogue.yml").read_text(encoding="utf-8")
        self.assertIn('if [[ -z "${RAKUTEN_SFTP_KNOWN_HOSTS:-}" ]]', workflow)
        self.assertIn('ssh-keygen -F "aftp.linksynergy.com"', workflow)
        self.assertNotIn("ssh-keyscan", workflow)
        self.assertIn("--retry-all-errors", workflow)
        self.assertIn('temporary="${output}.part"', workflow)
        self.assertIn('gzip -t "$temporary"', workflow)

    def test_sftp_workflow_expands_secrets_and_shell_variables(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "import-rakuten-catalogue.yml").read_text(encoding="utf-8")
        self.assertNotIn(r"\${", workflow)
        self.assertIn("RAKUTEN_SFTP_USER: ${{ secrets.RAKUTEN_SFTP_USER }}", workflow)
        self.assertIn("RAKUTEN_SFTP_PASSWORD: ${{ secrets.RAKUTEN_SFTP_PASSWORD }}", workflow)
        self.assertIn("RAKUTEN_SFTP_KNOWN_HOSTS: ${{ vars.RAKUTEN_SFTP_KNOWN_HOSTS }}", workflow)
        self.assertIn('if [[ -z "${RAKUTEN_SFTP_USER:-}"', workflow)
        self.assertIn('if [[ "$RAKUTEN_DATE_FORMAT" != "MM/DD/YYYY"', workflow)

    def test_promotions_are_selected_first(self):
        rows = [
            {"id": "a", "category": "sport", "priceValue": 10.0, "regularPriceValue": None},
            {"id": "b", "category": "sport", "priceValue": 5.0, "regularPriceValue": 10.0},
            {"id": "c", "category": "sport", "priceValue": 8.0, "regularPriceValue": 10.0},
        ]
        self.assertEqual([r["id"] for r in MODULE.select_balanced(rows, 2)], ["b", "c"])

    def test_real_rakuten_header_date_is_day_first(self):
        # En-tête réel reçu le 7 novembre 2026 : "07/11/2026 0:11:13".
        parsed = MODULE.parse_source_timestamp("07/11/2026 0:11:13", "DD/MM/YYYY")
        self.assertEqual(parsed, dt.datetime(2026, 11, 7, 0, 11, 13, tzinfo=UTC))


if __name__ == "__main__":
    unittest.main()

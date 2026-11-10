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
        # En-tête réel « 07/11/2026 0:11:13 » : jour en premier. AUTO lève l'ambiguïté par la fenêtre de fraîcheur.
        self.assertEqual(workflow.count("vars.RAKUTEN_DATE_FORMAT || 'AUTO'"), 2)
        self.assertNotIn("vars.RAKUTEN_DATE_FORMAT || 'MM/DD/YYYY'", workflow)
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
        # La constante de 62 caractères (SHA1 + caractères parasites) ne doit plus servir d'empreinte.
        self.assertNotIn("d98a0cdd102177804f99a3534a4a04c6b31ce81622cb87103c1101134b4961", workflow)
        self.assertIn("vars.RAKUTEN_SSH_HOST_SHA256 || '6854993e0f41078a1f007d677d298c2a4f7d5f898de149f53e27d3159e4b2bdc'", workflow)
        self.assertIn('^[0-9a-fA-F]{64}$', workflow)
        self.assertIn('key_sha256_hex', workflow)
        self.assertIn('base64 -d | sha256sum', workflow)
        self.assertNotIn("StrictHostKeyChecking=no", workflow)
        self.assertNotIn("--insecure", workflow)
        self.assertIn("--continue-at -", workflow)
        self.assertIn('ssh-keyscan -T 10 -t rsa,ecdsa,ed25519 aftp.linksynergy.com', workflow)
        self.assertIn('ssh-keygen -F "aftp.linksynergy.com"', workflow)
        self.assertIn("--retry-all-errors", workflow)
        self.assertIn('temporary="${output}.part"', workflow)
        self.assertIn('gzip -t "$temporary"', workflow)

    def test_sftp_workflow_expands_secrets_and_shell_variables(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "import-rakuten-catalogue.yml").read_text(encoding="utf-8")
        self.assertNotIn(r"\${", workflow)
        self.assertIn("RAKUTEN_SFTP_USER: ${{ secrets.RAKUTEN_SFTP_USER }}", workflow)
        self.assertIn("RAKUTEN_SFTP_PASSWORD: ${{ secrets.RAKUTEN_SFTP_PASSWORD }}", workflow)
        self.assertIn('if [[ -z "${RAKUTEN_SFTP_USER:-}"', workflow)
        self.assertIn('if [[ "$RAKUTEN_DATE_FORMAT" != "AUTO"', workflow)

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


    def test_auto_date_format_reads_real_day_first_header(self):
        now = dt.datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
        parsed, detected = MODULE.resolve_source_timestamp("07/11/2026 0:11:13", "AUTO", now, 48)
        self.assertEqual(parsed, dt.datetime(2026, 11, 7, 0, 11, 13, tzinfo=UTC))
        self.assertEqual(detected, "DD/MM/YYYY")

    def test_auto_date_format_reads_month_first_header(self):
        now = dt.datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
        parsed, detected = MODULE.resolve_source_timestamp("11/07/2026 0:11:13", "AUTO", now, 48)
        self.assertEqual(parsed, dt.datetime(2026, 11, 7, 0, 11, 13, tzinfo=UTC))
        self.assertEqual(detected, "MM/DD/YYYY")

    def test_auto_date_format_rejects_stale_feed_in_both_readings(self):
        now = dt.datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
        with self.assertRaisesRegex(ValueError, "Flux périmé"):
            MODULE.resolve_source_timestamp("07/11/2026 0:11:13", "AUTO", now, 48)

    def test_auto_feed_parsing_with_day_first_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "feed.xml.gz"
            write_feed(path, created_on="07/11/2026 0:11:13")
            rows, source_created, stats = MODULE.parse_feed(
                path, "Decathlon National", "decathlon", "AUTO",
                now=dt.datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(stats["date_format_detected"], "DD/MM/YYYY")
        self.assertEqual(source_created, dt.datetime(2026, 11, 7, 0, 11, 13, tzinfo=UTC))

    def test_duplicate_products_and_gtins_are_published_once(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dupes.xml.gz"
            write_feed(path, trailer_count=1)
            tree = ET.ElementTree(ET.fromstring(gzip.open(path).read()))
            root = tree.getroot()
            original = root.find("product")
            same_id = ET.fromstring(ET.tostring(original))
            cheaper_same_gtin = ET.fromstring(ET.tostring(original))
            cheaper_same_gtin.set("product_id", "item-2")
            cheaper_same_gtin.find("price/retail").text = "15.00"
            trailer = root.find("trailer")
            root.remove(trailer)
            root.extend([same_id, cheaper_same_gtin, trailer])
            trailer.find("numberOfProducts").text = "3"
            with gzip.open(path, "wb") as stream:
                stream.write(ET.tostring(root, encoding="utf-8"))
            rows, _, stats = MODULE.parse_feed(
                path, "Decathlon National", "decathlon", "MM/DD/YYYY",
                now=dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["priceValue"], 15.0)
        self.assertEqual(stats["skipped"], {"duplicate_product_id": 1, "duplicate_gtin": 1})

    def test_variants_sharing_a_product_id_keep_distinct_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "variants.xml.gz"
            write_feed(path)
            root = ET.fromstring(gzip.open(path).read())
            variant = ET.fromstring(ET.tostring(root.find("product")))
            variant.find("upc").text = "4006381333948"
            trailer = root.find("trailer"); root.remove(trailer); root.extend([variant, trailer])
            trailer.find("numberOfProducts").text = "2"
            with gzip.open(path, "wb") as stream:
                stream.write(ET.tostring(root, encoding="utf-8"))
            rows, _, stats = MODULE.parse_feed(path, "Decathlon National", "decathlon", "MM/DD/YYYY",
                                               now=dt.datetime(2026, 11, 5, 12, 0, tzinfo=UTC))
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({row["id"] for row in rows}), 2)
        self.assertEqual({row["productId"] for row in rows}, {"item-1"})
        self.assertEqual(stats["skipped"], {})

    def test_partial_import_cannot_replace_complete_snapshot(self):
        previous = {"status": "ok", "source_stats": {
            "Decathlon National": {"raw_products": 65942},
            "Nicchia Luxury": {"raw_products": 6958},
        }}
        self.assertEqual(MODULE.check_against_previous_snapshot(previous, {
            "Decathlon National": {"raw_products": 65000},
            "Nicchia Luxury": {"raw_products": 6900},
        }), [])
        problems = MODULE.check_against_previous_snapshot(previous, {"Decathlon National": {"raw_products": 20000}})
        self.assertEqual(len(problems), 2)
        self.assertIn("Nicchia Luxury", problems[0] + problems[1])

    def test_main_keeps_previous_snapshot_when_a_merchant_disappears(self):
        import json, subprocess, sys
        with tempfile.TemporaryDirectory() as directory:
            write_feed(Path(directory) / "44806_4768926_mp.xml.gz",
                       created_on=dt.datetime.now(UTC).strftime("%m/%d/%Y %H:%M:%S"))
            output = Path(directory) / "rakuten-products.json"
            previous = {"status": "ok", "generated_at": "2026-11-07T00:11:13Z", "products": [{"id": "keep"}],
                        "source_stats": {"Decathlon National": {"raw_products": 1}, "Nicchia Luxury": {"raw_products": 1}}}
            output.write_text(json.dumps(previous), encoding="utf-8")
            result = subprocess.run([sys.executable, str(SCRIPT), "--directory", directory, "--output", str(output),
                                     "--date-format", "AUTO"], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Import incomplet refusé", result.stderr)
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), previous)

    def test_partner_deals_require_verified_tax_status(self):
        homepage = (Path(__file__).resolve().parents[1] / "index.html").read_text(encoding="utf-8")
        loader = homepage[homepage.index('id="pm-partner-deals-loader"'):]
        loader = loader[:loader.index("</script>")]
        self.assertIn("feed.priceTaxStatusVerified!==true", loader)


if __name__ == "__main__":
    unittest.main()

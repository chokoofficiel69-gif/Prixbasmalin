import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit_catalogue_identity.py"
SPEC = importlib.util.spec_from_file_location("audit_catalogue_identity", SCRIPT)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class CatalogueIdentityAuditTests(unittest.TestCase):
    def test_read_catalogue_parses_current_json_product_data(self):
        sample = 'const productData=[{"id":"one","name":"Produit A"},{"id":"two","name":"Produit B"}];'
        with patch.object(AUDIT, "CATALOGUE") as catalogue:
            catalogue.read_text.return_value = sample
            self.assertEqual(AUDIT.read_catalogue(), [{"id": "one", "name": "Produit A"}, {"id": "two", "name": "Produit B"}])

    def test_duplicate_product_ids_are_rejected(self):
        sample = 'const productData=[{"id":"same","name":"A"},{"id":"same","name":"B"}];'
        with patch.object(AUDIT, "CATALOGUE") as catalogue:
            catalogue.read_text.return_value = sample
            with self.assertRaisesRegex(ValueError, "dupliqués"):
                AUDIT.read_catalogue()
    def test_valid_gtin_mapping_is_accepted_by_shape(self):
        self.assertTrue(AUDIT.valid_mapping({"identity_type": "gtin", "identity_value": "4006381333931"}))

    def test_mpn_requires_brand(self):
        self.assertFalse(AUDIT.valid_mapping({"identity_type": "mpn", "identity_value": "MODEL-123"}))
        self.assertTrue(AUDIT.valid_mapping({"identity_type": "mpn", "identity_value": "MODEL-123", "brand": "Marque"}))

    def test_asin_requires_ten_alphanumeric_characters(self):
        self.assertTrue(AUDIT.valid_mapping({"identity_type": "asin", "identity_value": "B012345678"}))
        self.assertFalse(AUDIT.valid_mapping({"identity_type": "asin", "identity_value": "B0123"}))


if __name__ == "__main__":
    unittest.main()

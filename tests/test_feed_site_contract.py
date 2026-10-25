"""Contrat entre les flux de prix et la page catalogue.

catalogue.html lit les flux de prix et ignore silencieusement tout produit mal
formé : l'étagère « modèles exacts » reste alors vide, sans erreur visible.
Ces tests échouent bruyamment si un flux ne respecte plus ce que la page attend.
"""
import contextlib
import importlib.util
import io
import json
import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_prices_feed.py"
SPEC = importlib.util.spec_from_file_location("build_prices_feed_contract", SCRIPT)
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def contract_problems(product):
    """Liste ce qui empêcherait la page d'afficher correctement ce produit."""
    if not isinstance(product, dict):
        return ["produit: objet attendu"]
    label = str(product.get("id") or "<sans id>")
    problems = []
    for key in ("id", "name"):
        if not isinstance(product.get(key), str) or not product[key].strip():
            problems.append(f"{label}: {key} manquant")
    offers = product.get("offers")
    if not isinstance(offers, list) or not offers:
        return problems + [f"{label}: offers absent ou vide"]
    if product.get("offer_count") != len(offers):
        problems.append(f"{label}: offer_count ne correspond pas au nombre d'offres")
    totals = []
    for number, offer in enumerate(offers, 1):
        tag = f"{label} offre {number}"
        if not isinstance(offer, dict):
            problems.append(f"{tag}: objet attendu")
            continue
        if not isinstance(offer.get("retailer"), str) or not offer["retailer"].strip():
            problems.append(f"{tag}: retailer manquant")
        price = offer.get("price_eur")
        if not is_number(price) or price <= 0:
            problems.append(f"{tag}: price_eur doit être un nombre positif")
        else:
            total = offer.get("total_price_eur")
            totals.append(total if is_number(total) else price)
        try:
            checked_at = datetime.fromisoformat(str(offer.get("checked_at", "")).replace("Z", "+00:00"))
            if checked_at.tzinfo is None:
                problems.append(f"{tag}: checked_at sans fuseau horaire")
        except ValueError:
            problems.append(f"{tag}: checked_at illisible")
        url = urlparse(str(offer.get("product_url", "")))
        if url.scheme != "https" or not url.netloc:
            problems.append(f"{tag}: product_url HTTPS manquant")
    if totals:
        best = product.get("best_price_eur")
        if not is_number(best) or abs(best - min(totals)) > 0.005:
            problems.append(f"{label}: best_price_eur ne correspond pas au prix le plus bas")
    return problems


class FeedSiteContractTests(unittest.TestCase):
    def build_one_offer_feed(self):
        offer = {
            "offer_id": "contract-offer-1",
            "catalog_product_id": "t1",
            "product_name": "T-shirt blanc",
            "merchant_name": "Marchand test",
            "source": "Flux autorisé de test",
            "identity_type": "gtin",
            "identity_value": "4006381333931",
            "product_url": "https://merchant.example/product/1",
            "price": 12.50,
            "shipping_price": 1.50,
            "currency": "EUR",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "merchant-offers.json"
            output = root / "prices.json"
            catalogue = root / "catalogue.html"
            source.write_text(json.dumps({"schema_version": 1, "offers": [offer]}), encoding="utf-8")
            catalogue.write_text('const productData=[{id:"t1",name:"T-shirt blanc"}];', encoding="utf-8")
            with patch.object(BUILDER, "INPUT", source), \
                 patch.object(BUILDER, "OUTPUT", output), \
                 patch.object(BUILDER, "CATALOGUE", catalogue), \
                 contextlib.redirect_stdout(io.StringIO()):
                BUILDER.main()
            return json.loads(output.read_text(encoding="utf-8"))

    def test_builder_output_matches_site_contract(self):
        feed = self.build_one_offer_feed()
        self.assertEqual(len(feed["products"]), 1)
        for product in feed["products"]:
            self.assertEqual(contract_problems(product), [])
        self.assertEqual(feed["products"][0]["best_price_eur"], 14.00)
        for offer in feed["offers"]:
            self.assertIsInstance(offer["total_price_eur"], (int, float))

    def test_contract_check_detects_what_the_site_would_hide(self):
        broken = {
            "id": "x",
            "offer_count": 2,
            "best_price_eur": 5,
            "offers": [{"price_eur": 10, "checked_at": "2026-10-25T10:00:00", "product_url": "http://a.example"}],
        }
        problems = " | ".join(contract_problems(broken))
        for expected in ("name manquant", "offer_count", "retailer manquant", "sans fuseau", "product_url HTTPS", "best_price_eur"):
            self.assertIn(expected, problems)

    def assert_file_matches_contract(self, filename, allow_empty):
        path = ROOT / "data" / filename
        if not path.exists():
            self.skipTest(f"{filename} absent")
        products = json.loads(path.read_text(encoding="utf-8")).get("products", [])
        if not allow_empty:
            self.assertTrue(products, f"{filename}: aucun produit")
        ids = [product.get("id") for product in products]
        self.assertEqual(len(ids), len(set(ids)), f"{filename}: identifiants produits dupliqués")
        for product in products:
            self.assertEqual(contract_problems(product), [], filename)

    def test_published_prices_file_matches_site_contract(self):
        self.assert_file_matches_contract("prices.json", allow_empty=True)

    def test_featured_prices_file_matches_site_contract(self):
        self.assert_file_matches_contract("featured-prices.json", allow_empty=False)


if __name__ == "__main__":
    unittest.main()

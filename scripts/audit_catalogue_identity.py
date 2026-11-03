#!/usr/bin/env python3
"""Audit catalogue identity coverage without inventing product identifiers."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "catalogue.html"
IDENTITIES = ROOT / "data" / "catalogue-identities.json"


def read_catalogue():
    text = CATALOGUE.read_text(encoding="utf-8")
    match = re.search(r"const\s+productData\s*=\s*\[(.*?)\];", text, re.S)
    if not match:
        raise ValueError("Impossible de trouver productData dans catalogue.html")
    try:
        products = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise ValueError(f"productData n'est pas un tableau JSON valide: {exc}") from exc
    if not isinstance(products, list) or not products:
        raise ValueError("Aucune fiche produit reconnue dans productData")
    normalized = []
    for product in products:
        if not isinstance(product, dict) or not product.get("id") or not product.get("name"):
            raise ValueError("Fiche produit sans identifiant ou nom")
        normalized.append({"id": str(product["id"]), "name": str(product["name"])})
    ids = [product["id"] for product in normalized]
    if len(ids) != len(set(ids)):
        raise ValueError("Identifiants de fiches dupliqués dans productData")
    return normalized


def valid_mapping(mapping):
    if not isinstance(mapping, dict):
        return False
    kind = mapping.get("identity_type")
    value = mapping.get("identity_value")
    if kind not in {"gtin", "asin", "mpn"} or not isinstance(value, str) or not value.strip():
        return False
    if kind == "mpn" and not (isinstance(mapping.get("brand"), str) and mapping["brand"].strip()):
        return False
    if kind == "gtin" and not re.fullmatch(r"(?:\d{8}|\d{12,14})", value.strip()):
        return False
    if kind == "asin" and not re.fullmatch(r"[A-Za-z0-9]{10}", value.strip()):
        return False
    return True


def main():
    products = read_catalogue()
    raw = json.loads(IDENTITIES.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema_version") != 1 or not isinstance(raw.get("products"), dict):
        raise ValueError("Format invalide dans data/catalogue-identities.json")
    mappings = raw["products"]
    catalogue_ids = {product["id"] for product in products}
    unknown_ids = sorted(set(mappings) - catalogue_ids)
    invalid_ids = sorted(product_id for product_id, mapping in mappings.items()
                         if product_id in catalogue_ids and not valid_mapping(mapping))
    covered = sorted(product_id for product_id, mapping in mappings.items()
                     if product_id in catalogue_ids and valid_mapping(mapping))
    missing = [product for product in products if product["id"] not in covered]
    report = {
        "catalogue_products": len(products),
        "products_with_valid_identity": len(covered),
        "coverage_percent": round(len(covered) / len(products) * 100, 1),
        "missing_identity_count": len(missing),
        "invalid_mapping_ids": invalid_ids,
        "unknown_catalogue_ids": unknown_ids,
        "missing_products": missing,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if unknown_ids or invalid_ids:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

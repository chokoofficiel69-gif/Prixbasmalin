#!/usr/bin/env python3
"""Build the homepage product snapshot from catalogue.html without inventing prices."""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "catalogue.html"
OUTPUT = ROOT / "data" / "home-products.json"
FIELDS = (
    "id", "name", "desc", "category", "brand", "image", "sourceUrl",
    "imageStatus", "imageKind", "imageSource", "imageSourceName", "images",
)
VERIFIED_IMAGE_STATUSES = {
    "manufacturer_verified", "official_press_image",
    "retailer_product_image", "authorized_feed_image",
}


def extract_products(html):
    match = re.search(r"const\s+productData\s*=\s*(\[.*?\])\s*;", html, re.S)
    if not match:
        raise ValueError("Impossible de trouver le tableau productData dans catalogue.html")
    try:
        products = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise ValueError(f"productData JSON invalide : {exc}") from exc
    if not isinstance(products, list) or not products:
        raise ValueError("productData doit contenir au moins une fiche produit")
    normalized = []
    seen = set()
    for index, product in enumerate(products, 1):
        if not isinstance(product, dict):
            raise ValueError(f"Fiche #{index} invalide : objet attendu")
        product_id = product.get("id")
        name = product.get("name")
        if not isinstance(product_id, (str, int)) or not str(product_id).strip():
            raise ValueError(f"Fiche #{index} sans identifiant")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"Fiche #{index} sans nom")
        key = str(product_id).strip()
        if key in seen:
            raise ValueError(f"Identifiant produit dupliqué : {key}")
        seen.add(key)
        normalized.append({field: product[field] for field in FIELDS
                           if field in product and product[field] is not None})
    return normalized


def has_verified_image(product):
    image = product.get("image")
    return (
        product.get("imageStatus") in VERIFIED_IMAGE_STATUSES
        and isinstance(image, str)
        and image.startswith("https://")
        and "unsplash.com" not in image.lower()
        and product.get("imageKind") != "illustration"
    )


def build_feed(html, generated_at=None):
    products = extract_products(html)
    verified_count = sum(has_verified_image(product) for product in products)
    return {
        "version": 1,
        "generated_from": "catalogue.html productData",
        "generated_at": generated_at or datetime.now(timezone.utc).date().isoformat(),
        "count": len(products),
        "verified_image_count": verified_count,
        "unverified_image_count": len(products) - verified_count,
        "price_policy": "No price is displayed unless a verified merchant offer is available.",
        "image_policy": (
            "Promotional product photos are displayed only when imageStatus confirms "
            "manufacturer, press, retailer or authorized-feed provenance. "
            "Unverified references remain searchable without a product photo."
        ),
        "products": products,
    }


def comparable(feed):
    copy = dict(feed)
    copy.pop("generated_at", None)
    return copy


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = parser.parse_args()

    generated = build_feed(CATALOGUE.read_text(encoding="utf-8"))
    if args.check:
        try:
            existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("Flux home-products.json absent ou invalide") from exc
        if comparable(existing) != comparable(generated):
            raise SystemExit("ERREUR : home-products.json est désynchronisé de catalogue.html")
        print(
            f"OK : {generated['count']} fiches, "
            f"{generated['verified_image_count']} visuels vérifiés, "
            f"{generated['unverified_image_count']} sans visuel vérifié."
        )
        return

    if OUTPUT.exists():
        try:
            existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = None
        if isinstance(existing, dict) and comparable(existing) == comparable(generated):
            print("Aucune nouvelle référence ou image vérifiée ; snapshot précédent conservé.")
            return

    OUTPUT.write_text(
        json.dumps(generated, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Flux homepage actualisé : {generated['count']} fiches, "
        f"{generated['verified_image_count']} visuels vérifiés. Aucun prix ajouté."
    )


if __name__ == "__main__":
    main()

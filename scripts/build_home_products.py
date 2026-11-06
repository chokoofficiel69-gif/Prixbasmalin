#!/usr/bin/env python3
"""Build a price-free homepage photo snapshot from the catalogue and authorized Awin images."""
import argparse
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "catalogue.html"
AWIN_FEED = ROOT / "data" / "awin-products.json"
OUTPUT = ROOT / "data" / "home-products.json"
FIELDS = (
    "id", "name", "desc", "category", "brand", "merchant", "image", "sourceUrl",
    "imageStatus", "imageKind", "imageSource", "imageSourceName", "images",
)
VERIFIED_IMAGE_STATUSES = {
    "manufacturer_verified", "official_press_image",
    "retailer_product_image", "authorized_feed_image",
}
CATEGORY_ORDER = ("tech", "home", "fashion", "beauty", "sport", "kids")
MAX_AWIN_HOME_PRODUCTS = 12
MIN_AWIN_HOME_PRODUCTS = 8
AWIN_MAX_AGE = timedelta(hours=48)
FUTURE_CLOCK_TOLERANCE = timedelta(minutes=5)


def extract_products(html):
    match = re.search(r"const\\s+productData\\s*=\\s*(\\[.*?\\])\\s*;", html, re.S)
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


def parse_aware_timestamp(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def is_https_url(value):
    return isinstance(value, str) and value.startswith("https://") and len(value) > 8


def select_awin_home_products(feed, existing_products=None, now=None):
    """Select a small, category-balanced set of fresh Awin merchant photos only.

    Prices, offer timestamps, stock and affiliate status are deliberately not copied.
    None means the new batch is not trustworthy enough; callers should retain the
    previous Awin photo batch instead of replacing it with an empty/weak selection.
    """
    if not isinstance(feed, dict) or feed.get("status") != "ok" or not isinstance(feed.get("products"), list):
        return None
    fetched_at = parse_aware_timestamp(feed.get("fetched_at"))
    current = now or datetime.now(timezone.utc)
    if fetched_at is None:
        return None
    age = current.astimezone(timezone.utc) - fetched_at
    if age < -FUTURE_CLOCK_TOLERANCE or age > AWIN_MAX_AGE:
        return None

    existing_images = {
        product.get("image")
        for product in (existing_products or [])
        if isinstance(product, dict) and has_verified_image(product)
    }
    seen_images = set(existing_images)
    seen_ids = set()
    pools = {category: [] for category in CATEGORY_ORDER}

    for product in feed["products"]:
        if not isinstance(product, dict):
            continue
        product_id = str(product.get("id") or "").strip()
        name = str(product.get("name") or "").strip()
        merchant = str(product.get("merchant") or "").strip()
        category = str(product.get("category") or "").strip().lower()
        image = product.get("image")
        source_url = product.get("sourceUrl")
        image_source = product.get("imageSource")
        image_source_name = str(product.get("imageSourceName") or merchant).strip()

        if not product_id or not name or not merchant or category not in pools:
            continue
        if product.get("imageStatus") != "authorized_feed_image" or product.get("imageKind") != "merchant_feed":
            continue
        if not is_https_url(image) or "unsplash.com" in image.lower():
            continue
        if not is_https_url(source_url) or not is_https_url(image_source) or not image_source_name:
            continue
        if image in seen_images:
            continue

        safe_id = re.sub(r"[^a-z0-9-]+", "-", product_id.lower()).strip("-")
        normalized_id = "awin-home-" + safe_id
        if not safe_id or normalized_id in seen_ids:
            continue

        candidate = {
            "id": normalized_id,
            "name": name,
            "desc": str(product.get("desc") or f"{merchant} · Visuel marchand"),
            "category": category,
            "brand": str(product.get("brand") or merchant),
            "merchant": merchant,
            "image": image,
            "sourceUrl": source_url,
            "imageStatus": "authorized_feed_image",
            "imageKind": "merchant_feed",
            "imageSource": image_source,
            "imageSourceName": image_source_name,
        }
        pools[category].append(candidate)
        seen_images.add(image)
        seen_ids.add(normalized_id)

    for candidates in pools.values():
        candidates.sort(key=lambda item: (item["name"].casefold(), item["id"]))

    selected = []
    while len(selected) < MAX_AWIN_HOME_PRODUCTS:
        added = False
        for category in CATEGORY_ORDER:
            if pools[category] and len(selected) < MAX_AWIN_HOME_PRODUCTS:
                selected.append(pools[category].pop(0))
                added = True
        if not added:
            break

    return selected if len(selected) >= MIN_AWIN_HOME_PRODUCTS else None


def build_feed(html, generated_at=None, awin_products=None, previous=None):
    catalogue_products = extract_products(html)
    previous_products = previous.get("products", []) if isinstance(previous, dict) else []
    if awin_products is None:
        awin_products = [
            product for product in previous_products
            if isinstance(product, dict) and str(product.get("id", "")).startswith("awin-home-")
        ]

    merged = list(catalogue_products)
    seen_ids = {str(product.get("id")) for product in merged}
    seen_images = {
        product.get("image") for product in merged
        if has_verified_image(product)
    }
    for product in awin_products:
        if not isinstance(product, dict):
            continue
        product_id = str(product.get("id") or "").strip()
        image = product.get("image")
        if not product_id or product_id in seen_ids or image in seen_images or not has_verified_image(product):
            continue
        # The homepage snapshot is a discovery/photo source, never a price feed.
        normalized = {field: product[field] for field in FIELDS if field in product and product[field] is not None}
        merged.append(normalized)
        seen_ids.add(product_id)
        seen_images.add(image)

    verified_count = sum(has_verified_image(product) for product in merged)
    has_awin_images = any(str(product.get("id", "")).startswith("awin-home-") for product in merged)
    return {
        "version": 1,
        "generated_from": (
            "catalogue.html productData + data/awin-products.json images only"
            if has_awin_images else "catalogue.html productData"
        ),
        "generated_at": generated_at or datetime.now(timezone.utc).date().isoformat(),
        "count": len(merged),
        "verified_image_count": verified_count,
        "unverified_image_count": len(merged) - verified_count,
        "price_policy": "No price is copied into this homepage photo snapshot; current prices require a separate fresh, explicit-TTC merchant offer.",
        "image_policy": (
            "Product photos are displayed only with manufacturer, press, retailer or authorized-feed provenance. "
            "Awin feed entries are used for product images and discovery links only; no Awin price, stock, "
            "merchant-update date or partnership/commission status is copied."
        ),
        "products": merged,
    }


def comparable(feed):
    copy = dict(feed)
    copy.pop("generated_at", None)
    return copy


def read_existing_snapshot():
    try:
        existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return existing if isinstance(existing, dict) and isinstance(existing.get("products"), list) else None


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = parser.parse_args()

    existing = read_existing_snapshot()
    try:
        awin_feed = json.loads(AWIN_FEED.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        awin_feed = None
    awin_products = select_awin_home_products(
        awin_feed,
        existing_products=existing.get("products", []) if existing else [],
    )
    if awin_products is None:
        print("Flux Awin image absent, périmé ou insuffisant : dernière sélection Awin conservée.")

    generated = build_feed(
        CATALOGUE.read_text(encoding="utf-8"),
        awin_products=awin_products,
        previous=existing,
    )
    if args.check:
        if existing is None:
            raise ValueError("Flux home-products.json absent ou invalide")
        if comparable(existing) != comparable(generated):
            raise SystemExit("ERREUR : home-products.json est désynchronisé du catalogue ou du lot d'images Awin.")
        print(
            f"OK : {generated['count']} fiches, "
            f"{generated['verified_image_count']} visuels vérifiés, "
            f"{generated['unverified_image_count']} sans visuel vérifié."
        )
        return

    if existing is not None and comparable(existing) == comparable(generated):
        print("Aucune nouvelle référence ou image vérifiée ; snapshot précédent conservé.")
        return

    OUTPUT.write_text(
        json.dumps(generated, ensure_ascii=False, indent=2) + "\\n",
        encoding="utf-8",
    )
    awin_count = sum(str(product.get("id", "")).startswith("awin-home-") for product in generated["products"])
    print(
        f"Flux homepage actualisé : {generated['count']} fiches, "
        f"{generated['verified_image_count']} visuels vérifiés, "
        f"{awin_count} références Awin en visuel uniquement. Aucun prix ajouté."
    )


if __name__ == "__main__":
    main()

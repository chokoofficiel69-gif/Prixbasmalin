#!/usr/bin/env python3
"""Construit data/rakuten-home.json, une version légère du flux Rakuten pour la page d'accueil.

La page d'accueil n'affiche qu'une douzaine d'offres Rakuten (vitrine et « bonnes affaires »),
mais téléchargeait jusqu'ici les 3 000 produits de data/rakuten-products.json (~4,7 Mo), deux fois.
Ce fichier garde les mêmes métadonnées et, pour chaque marchand, seulement les produits qui peuvent
réellement être affichés : les plus récents et les plus fortes remises. Les filtres de fraîcheur
restent appliqués côté navigateur, exactement comme avant.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

VERIFIED_IMAGE_STATUSES = {
    "manufacturer_verified",
    "official_press_image",
    "retailer_product_image",
    "authorized_feed_image",
}
# Champs inutiles sur la page d'accueil (descriptions longues, traces d'import).
DROPPED_FIELDS = {"desc", "imageSource", "imageSourceName", "query", "sourceFile", "primaryCategory", "secondaryCategory"}
PER_MERCHANT = 40


def _price(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _https(value) -> bool:
    return bool(re.match(r"^https://", str(value or ""), re.I))


def displayable(p: dict) -> bool:
    """Filtres statiques communs aux deux blocs Rakuten de index.html."""
    return bool(
        p
        and p.get("name")
        and p.get("merchant")
        and _price(p.get("priceValue")) > 0
        and p.get("priceTaxStatus") == "included"
        and p.get("sourceCreatedAt")
        and _https(p.get("image"))
        and _https(p.get("sourceUrl"))
    )


def discount(p: dict) -> float:
    price, regular = _price(p.get("priceValue")), _price(p.get("regularPriceValue"))
    return 1 - price / regular if regular > price > 0 else 0.0


def build(feed: dict, per_merchant: int = PER_MERCHANT) -> dict:
    products = [p for p in feed.get("products") or [] if displayable(p)]
    by_merchant: dict[str, list[dict]] = {}
    for p in products:
        by_merchant.setdefault(p["merchant"], []).append(p)

    keep: dict[str, dict] = {}
    for items in by_merchant.values():
        # Vitrine : produits les plus récents (même tri que index.html).
        recent = sorted(items, key=lambda p: p.get("name") or "")
        recent = sorted(recent, key=lambda p: p.get("sourceCreatedAt") or "", reverse=True)
        # Bonnes affaires : plus fortes remises d'au moins 10 % sur un lien Rakuten.
        deals = [
            p for p in items
            if discount(p) >= 0.095 and str(p.get("sourceUrl", "")).startswith("https://click.linksynergy.com/")
        ]
        deals.sort(key=discount, reverse=True)
        for p in recent[:per_merchant] + deals[:per_merchant]:
            keep.setdefault(p["id"], p)

    # Ordre d'origine du flux conservé : les tris du navigateur départagent les égalités de la même façon.
    light = [{k: v for k, v in p.items() if k not in DROPPED_FIELDS} for p in products if p["id"] in keep]
    out = {k: v for k, v in feed.items() if k != "products"}
    out["derived_from"] = "data/rakuten-products.json"
    out["products"] = light
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="data/rakuten-products.json")
    parser.add_argument("--output", default="data/rakuten-home.json")
    args = parser.parse_args()
    feed = json.loads(Path(args.input).read_text(encoding="utf-8"))
    out = build(feed)
    Path(args.output).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(out['products'])} produits sur {len(feed.get('products') or [])} -> {args.output}")


if __name__ == "__main__":
    main()

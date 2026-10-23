#!/usr/bin/env python3
"""Build the catalogue price feed from a partner-authorized normalized offers file.

No network access or scraping is performed. Only fresh, explicitly supplied offers
with known shipping costs and a shared exact product identity are eligible for ranking.
"""
import json
import math
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data" / "merchant-offers.json"
OUTPUT = ROOT / "data" / "prices.json"
CATALOGUE = ROOT / "catalogue.html"
MAX_AGE = timedelta(hours=48)
IDENTITY_TYPES = {"gtin", "asin", "mpn"}


def parse_date(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label}: date manquante")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label}: date ISO 8601 invalide") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{label}: fuseau horaire obligatoire")
    return parsed.astimezone(timezone.utc)


def https_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def valid_money(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def normalize_identity(offer, label):
    identity_type = offer.get("identity_type")
    identity_value = offer.get("identity_value")
    brand = offer.get("brand")

    if identity_type not in IDENTITY_TYPES:
        raise ValueError(f"{label}: identity_type doit être gtin, asin ou mpn")
    if not isinstance(identity_value, str) or not identity_value.strip():
        raise ValueError(f"{label}: identity_value manquant")

    value = identity_value.strip().upper()
    normalized_brand = brand.strip().casefold() if isinstance(brand, str) else ""

    if identity_type == "gtin":
        if not re.fullmatch(r"(?:\d{8}|\d{12,14})", value):
            raise ValueError(f"{label}: GTIN invalide (8, 12, 13 ou 14 chiffres requis)")
        digits = [int(char) for char in value]
        check_digit = digits.pop()
        weighted_sum = sum(digit * (3 if offset % 2 == 0 else 1)
                           for offset, digit in enumerate(reversed(digits)))
        if (10 - weighted_sum % 10) % 10 != check_digit:
            raise ValueError(f"{label}: clé de contrôle GTIN invalide")
        return {"type": "gtin", "value": value}, ("gtin", value)

    if identity_type == "asin":
        if not re.fullmatch(r"[A-Z0-9]{10}", value):
            raise ValueError(f"{label}: ASIN invalide (10 caractères alphanumériques requis)")
        return {"type": "asin", "value": value}, ("asin", value)

    if not normalized_brand:
        raise ValueError(f"{label}: brand obligatoire pour une identité MPN")
    if len(value) > 100 or not re.fullmatch(r"[A-Z0-9][A-Z0-9._/-]*", value):
        raise ValueError(f"{label}: référence MPN invalide")
    return {"type": "mpn", "value": value, "brand": brand.strip()}, ("mpn", normalized_brand, value)


def main():
    now = datetime.now(timezone.utc)
    raw = json.loads(INPUT.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema_version") != 1 or not isinstance(raw.get("offers"), list):
        raise ValueError("Format invalide dans data/merchant-offers.json")

    catalogue_text = CATALOGUE.read_text(encoding="utf-8")
    catalogue_match = re.search(r"const\s+productData\s*=\s*\[(.*?)\];", catalogue_text, re.S)
    if not catalogue_match:
        raise ValueError("Impossible de lire les identifiants productData dans catalogue.html")
    catalogue_ids = set(re.findall(r"""\bid\s*:\s*["']([^"']+)["']""", catalogue_match.group(1)))
    if not catalogue_ids:
        raise ValueError("Aucun identifiant de produit trouvé dans catalogue.html")

    grouped = {}
    identities = {}
    conflicted_products = set()
    errors = []
    seen_offer_ids = set()
    for index, offer in enumerate(raw["offers"], 1):
        label = f"offre #{index}"
        if not isinstance(offer, dict):
            errors.append(f"{label}: entrée ignorée (objet attendu)")
            continue
        product_id = offer.get("catalog_product_id")
        if not isinstance(product_id, str) or not product_id.strip():
            errors.append(f"{label}: catalog_product_id manquant")
            continue
        product_id = product_id.strip()
        if product_id not in catalogue_ids:
            errors.append(f"{label}: catalog_product_id absent du catalogue")
            continue
        if product_id in conflicted_products:
            continue

        try:
            identity, identity_key = normalize_identity(offer, label)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if product_id in identities and identities[product_id][0] != identity_key:
            errors.append(
                f"{label}: identité produit différente pour {product_id}; "
                "toutes les offres de cette fiche sont écartées pour éviter une comparaison trompeuse"
            )
            conflicted_products.add(product_id)
            grouped.pop(product_id, None)
            identities.pop(product_id, None)
            continue
        identities[product_id] = (identity_key, identity)

        if not all(isinstance(offer.get(k), str) and offer[k].strip() for k in ("product_name", "merchant_name", "source")):
            errors.append(f"{label}: nom du produit, marchand ou source manquant")
            continue
        price = offer.get("price")
        shipping = offer.get("shipping_price")
        product_url = offer.get("product_url")
        if not valid_money(price) or not valid_money(shipping):
            errors.append(f"{label}: prix ou frais de livraison invalides/inconnus")
            continue
        if offer.get("currency") != "EUR":
            errors.append(f"{label}: devise EUR obligatoire")
            continue
        if not https_url(product_url):
            errors.append(f"{label}: URL produit HTTPS obligatoire")
            continue
        if offer.get("tracking_url") is not None and not https_url(offer["tracking_url"]):
            errors.append(f"{label}: URL de suivi HTTPS invalide")
            continue
        try:
            checked_at = parse_date(offer.get("checked_at"), f"{label}.checked_at")
        except ValueError as exc:
            errors.append(str(exc))
            continue
        age = now - checked_at
        if age < timedelta(0) or age > MAX_AGE:
            errors.append(f"{label}: relevé hors fenêtre de 48 heures")
            continue

        offer_id = offer.get("offer_id")
        if not isinstance(offer_id, str) or not offer_id.strip():
            errors.append(f"{label}: offer_id manquant")
            continue
        offer_id = offer_id.strip()
        if offer_id in seen_offer_ids:
            errors.append(f"{label}: offer_id dupliqué")
            continue
        seen_offer_ids.add(offer_id)
        normalized = {
            "offer_id": offer_id,
            "merchant_name": offer["merchant_name"].strip(),
            "source": offer["source"].strip(),
            "identity": identity,
            "price_eur": round(float(price), 2),
            "shipping_price_eur": round(float(shipping), 2),
            "total_price_eur": round(float(price) + float(shipping), 2),
            "product_url": product_url,
            "checked_at": checked_at.isoformat().replace("+00:00", "Z"),
        }
        if offer.get("tracking_url"):
            normalized["tracking_url"] = offer["tracking_url"]
        grouped.setdefault(product_id, []).append(normalized)

    products = []
    for product_id, offers in sorted(grouped.items()):
        if product_id in conflicted_products or not offers:
            continue
        offers.sort(key=lambda item: (item["total_price_eur"], item["checked_at"]))
        products.append({
            "id": product_id,
            "identity": identities[product_id][1],
            "best_price_eur": offers[0]["total_price_eur"],
            "offer_count": len(offers),
            "offers": offers,
        })

    result = {
        "version": 1,
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "schedule": "généré lors de la mise à jour du flux source autorisé",
        "methodology": "Offres autorisées, identité exacte commune et prix classés frais de livraison inclus. Aucune estimation ni collecte web automatique.",
        "products": products,
        "offers": [offer for product in products for offer in product["offers"]],
        "errors": errors,
        "previous_generated_at": None,
    }
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
            result["previous_generated_at"] = previous.get("generated_at")
        except (json.JSONDecodeError, OSError):
            pass
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Flux généré : {len(products)} produit(s), {sum(len(p['offers']) for p in products)} offre(s) admissible(s), {len(errors)} avertissement(s).")
    if not products:
        print("Aucun prix vérifié publié : le flux source ne contient pas d'offre fraîche et complète.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"ERREUR: {exc}", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Rapproche les offres de plusieurs marchands par GTIN, avec contrôles stricts.

Sources : flux autorisés déjà importés (Awin, Rakuten). Aucun prix, date, frais de
livraison ou statut TVA n'est inventé : chaque offre garde la valeur et la date de sa
source. Une offre sans date exploitable ou trop ancienne est marquée ``stale`` et n'est
jamais présentée comme actuelle par le site.

Clé de rapprochement : GTIN valide (clé de contrôle), forme canonique GTIN-14.
Le GTIN seul ne suffit pas : la marque doit concorder, la contenance (ml, g…) ne doit
pas différer et les noms doivent partager au moins un mot significatif. Ces contrôles
ne servent qu'à **refuser** un rapprochement ; le titre ne sert jamais à en créer un.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import html
import json
import os
import re
import unicodedata

UTC = dt.timezone.utc
DEFAULT_MAX_AGE_HOURS = 48
STOPWORDS = {
    "les", "des", "une", "pour", "avec", "sans", "and", "the", "for", "with", "eau", "edp", "edt",
    "parfum", "toilette", "spray", "vaporisateur", "coffret", "set", "pack", "lot", "new", "nouveau",
    "homme", "femme", "men", "women", "unisex", "mixte", "collection", "original", "edition",
}
UNIT_FACTORS = {"ml": 1.0, "cl": 10.0, "l": 1000.0, "g": 1.0, "kg": 1000.0, "oz": 29.5735}
UNIT_KIND = {"ml": "volume", "cl": "volume", "l": "volume", "oz": "volume", "g": "mass", "kg": "mass"}
QUANTITY_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(ml|cl|l|g|kg|oz)\b", re.I)


def is_valid_gtin(value) -> bool:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) not in (8, 12, 13, 14) or set(digits) == {"0"}:
        return False
    numbers = [int(char) for char in digits]
    check = numbers.pop()
    total = sum(n * w for n, w in zip(reversed(numbers), [3, 1] * 8))
    return (10 - total % 10) % 10 == check


def gtin14(value) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits.zfill(14) if is_valid_gtin(digits) else ""


def fold(text) -> str:
    text = html.unescape(str(text or ""))
    text = unicodedata.normalize("NFKD", text.replace("œ", "oe").replace("Œ", "OE"))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


BRAND_SUFFIXES = {"parfums", "parfum", "perfumes", "perfume", "paris", "london", "cosmetics", "beauty", "fragrances", "sa", "sas", "ltd", "inc"}


def brand_key(brand) -> str:
    words = fold(brand).split()
    while len(words) > 1 and words[-1] in BRAND_SUFFIXES:
        words.pop()
    return "".join(words)


def brands_match(a, b) -> bool:
    ka, kb = brand_key(a), brand_key(b)
    return bool(ka and kb) and (ka == kb or ka in kb or kb in ka)


def quantities(name) -> set:
    found = set()
    for number, unit in QUANTITY_RE.findall(html.unescape(str(name or ""))):
        unit = unit.lower()
        value = float(number.replace(",", ".")) * UNIT_FACTORS[unit]
        found.add((UNIT_KIND[unit], round(value)))
    return found


def quantities_conflict(a, b) -> bool:
    qa, qb = quantities(a), quantities(b)
    for kind in ("volume", "mass"):
        va = {v for k, v in qa if k == kind}
        vb = {v for k, v in qb if k == kind}
        if va and vb and not va & vb:
            return True
    return False


def name_tokens(name, brand) -> set:
    brand_words = set(fold(brand).split())
    tokens = set()
    for token in fold(QUANTITY_RE.sub(" ", html.unescape(str(name or "")))).split():
        if token in brand_words or token in STOPWORDS:
            continue
        if len(token) >= 3 or token.isdigit():
            tokens.add(token)
    return tokens


def names_compatible(a, b) -> bool:
    ta, tb = name_tokens(a["name"], a["brand"]), name_tokens(b["name"], b["brand"])
    # Si l'un des noms ne contient que la marque et la contenance, rien ne permet de refuser.
    return not ta or not tb or bool(ta & tb)


def parse_time(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?", raw):
        raw = raw.replace(" ", "T") + ("Z" if " " in raw or "T" in raw else "T00:00:00Z")
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def iso(moment):
    return moment.isoformat().replace("+00:00", "Z") if moment else None


def availability(value) -> str:
    key = fold(value).replace(" ", "_")
    if key in ("in_stock", "instock", "available", "en_stock", "disponible"):
        return "in_stock"
    if key in ("out_of_stock", "outofstock", "sold_out", "rupture", "indisponible", "discontinued"):
        return "out_of_stock"
    return "unknown"


def money(value):
    try:
        number = round(float(value), 2)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def awin_offers(feed):
    for product in feed.get("products") or []:
        offers = [o for o in product.get("offers") or [] if isinstance(o, dict)] or [product]
        for offer in offers:
            gtin = gtin14(offer.get("gtin") or product.get("gtin"))
            price = money(offer.get("priceValue"))
            url = str(offer.get("url") or offer.get("sourceUrl") or product.get("sourceUrl") or "")
            if not gtin or not price or not url.startswith("https://"):
                continue
            # Date de la ligne produit si le marchand la fournit, sinon date de mise à jour du flux marchand.
            # La date de téléchargement par Prix Malin n'est jamais utilisée comme date de prix.
            product_date = parse_time(offer.get("merchantUpdatedAt") or product.get("merchantUpdatedAt"))
            feed_date = parse_time(offer.get("feedUpdatedAt") or product.get("feedUpdatedAt"))
            checked = product_date or feed_date
            yield {
                "gtin": gtin,
                "source": "awin",
                "merchant": str(offer.get("merchant") or product.get("merchant") or "").strip(),
                "name": str(product.get("name") or "").strip(),
                "brand": str(product.get("brand") or "").strip(),
                "image": product.get("image") or "",
                "price_eur": price,
                "shipping_price_eur": money(offer.get("shippingPriceValue")),
                "url": url,
                "checked_at": iso(checked),
                "checked_at_basis": "merchant_product_update" if product_date else ("merchant_feed_update" if feed_date else None),
                "price_tax_status": "included" if (offer.get("priceTaxStatus") or product.get("priceTaxStatus")) == "included" else "unspecified",
                "availability": availability(offer.get("availability") or product.get("availability")),
            }


def rakuten_offers(feed):
    tax_verified = feed.get("priceTaxStatusVerified") is True
    for product in feed.get("products") or []:
        gtin = gtin14(product.get("gtin"))
        price = money(product.get("priceValue"))
        url = str(product.get("sourceUrl") or "")
        if not gtin or not price or not url.startswith("https://click.linksynergy.com/"):
            continue
        yield {
            "gtin": gtin,
            "source": "rakuten",
            "merchant": str(product.get("merchant") or "").strip(),
            "name": str(product.get("name") or "").strip(),
            "brand": str(product.get("brand") or "").strip(),
            "image": product.get("image") or "",
            "price_eur": price,
            "shipping_price_eur": money(product.get("shippingPriceValue")),
            "url": url,
            "checked_at": iso(parse_time(product.get("sourceCreatedAt"))),
            "checked_at_basis": "merchant_feed_creation",
            # Le TTC n'est retenu que si le snapshot porte la confirmation explicite.
            "price_tax_status": "included" if tax_verified and product.get("priceTaxStatus") == "included" else "unspecified",
            "availability": availability(product.get("availability")),
        }


def build(offers, now, max_age_hours=DEFAULT_MAX_AGE_HOURS):
    by_gtin = collections.defaultdict(dict)
    for offer in offers:
        if not offer["merchant"]:
            continue
        kept = by_gtin[offer["gtin"]].get(offer["merchant"].casefold())
        if kept is None or offer["price_eur"] < kept["price_eur"]:
            by_gtin[offer["gtin"]][offer["merchant"].casefold()] = offer

    rejected = collections.Counter()
    products = []
    for gtin, merchants in sorted(by_gtin.items()):
        if len(merchants) < 2:
            continue
        rows = sorted(merchants.values(), key=lambda o: (o["price_eur"], o["merchant"]))
        reference = rows[0]
        reason = None
        for other in rows[1:]:
            if not brands_match(reference["brand"], other["brand"]):
                reason = "brand_mismatch"
            elif quantities_conflict(reference["name"], other["name"]):
                reason = "quantity_mismatch"
            elif not names_compatible(reference, other):
                reason = "name_mismatch"
            if reason:
                break
        if reason:
            rejected[reason] += 1
            continue
        public_offers = []
        for row in rows:
            checked = parse_time(row["checked_at"])
            age = (now - checked) if checked else None
            stale = age is None or age < dt.timedelta(minutes=-5) or age > dt.timedelta(hours=max_age_hours)
            public_offers.append({
                "merchant": row["merchant"],
                "source": row["source"],
                "price_eur": row["price_eur"],
                "shipping_price_eur": row["shipping_price_eur"],
                "currency": "EUR",
                "url": row["url"],
                "checked_at": row["checked_at"],
                "checked_at_basis": row["checked_at_basis"],
                "price_tax_status": row["price_tax_status"],
                "availability": row["availability"],
                "freshness_max_age_hours": max_age_hours,
                "stale": stale,
            })
        name_source = max(rows, key=lambda o: len(o["name"]))
        products.append({
            "id": "gtin-" + gtin,
            "gtin": gtin,
            "name": html.unescape(name_source["name"]),
            "brand": html.unescape(reference["brand"]),
            "image": next((o["image"] for o in rows if str(o["image"]).startswith("https://")), ""),
            "identity": {"type": "gtin", "checks": ["gtin_check_digit", "brand", "quantity", "name_veto"]},
            "offers": public_offers,
        })

    fresh_comparisons = sum(
        1 for p in products
        if len({o["merchant"].casefold() for o in p["offers"] if not o["stale"]}) >= 2
    )
    return {
        "schema_version": 1,
        "status": "ok",
        "generated_at": iso(now),
        "freshness_max_age_hours": max_age_hours,
        "method": "GTIN valide commun à au moins deux marchands ; marque, contenance et nom contrôlés pour refuser les faux rapprochements.",
        "counts": {
            "gtins_with_two_merchants": len(products) + sum(rejected.values()),
            "comparisons": len(products),
            "comparisons_with_two_current_offers": fresh_comparisons,
            "offers": sum(len(p["offers"]) for p in products),
            "offers_stale_or_undated": sum(o["stale"] for p in products for o in p["offers"]),
            "offers_tax_confirmed": sum(o["price_tax_status"] == "included" for p in products for o in p["offers"]),
            "rejected": dict(rejected),
            "merchant_pairs": dict(collections.Counter(
                " / ".join(sorted({o["merchant"] for o in p["offers"]})) for p in products
            )),
        },
        "products": products,
    }


def load(path):
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, ValueError) as error:
        print(f"Source ignorée ({path}) : {error}")
        return None
    if not isinstance(data, dict) or data.get("status") != "ok":
        print(f"Source ignorée ({path}) : statut différent de ok")
        return None
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--awin", default="data/awin-products.json")
    parser.add_argument("--rakuten", default="data/rakuten-products.json")
    parser.add_argument("--output", default="data/gtin-comparisons.json")
    parser.add_argument("--max-age-hours", type=int, default=DEFAULT_MAX_AGE_HOURS)
    args = parser.parse_args()

    offers = []
    awin = load(args.awin)
    if awin:
        offers.extend(awin_offers(awin))
    rakuten = load(args.rakuten)
    if rakuten:
        offers.extend(rakuten_offers(rakuten))
    if not awin and not rakuten:
        raise SystemExit("Aucune source exploitable : fichier de comparaisons précédent conservé.")

    result = build(offers, dt.datetime.now(UTC), args.max_age_hours)
    temporary = args.output + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=1)
        stream.write("\n")
    os.replace(temporary, args.output)
    print(json.dumps(result["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()

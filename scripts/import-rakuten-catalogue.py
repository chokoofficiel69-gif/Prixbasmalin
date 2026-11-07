#!/usr/bin/env python3
"""Convert fresh, complete Rakuten product feeds into a safe public snapshot."""
import argparse
import collections
import datetime as dt
import gzip
import json
import os
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

UTC = dt.timezone.utc
FEEDS = [
    ("44806_4768926_mp.xml.gz", "Decathlon National", "decathlon"),
    # Flux complet Nicchia (avec trailer) en priorité ; flux catégorie en secours.
    ("54306_4768926_mp.xml.gz", "Nicchia Luxury", "nicchia"),
    ("54306_4768926_1_cmp.xml.gz", "Nicchia Luxury", "nicchia"),
]


def parse_source_timestamp(value, date_format):
    value = str(value or "").strip()
    if date_format not in ("MM/DD/YYYY", "DD/MM/YYYY"):
        raise ValueError("RAKUTEN_DATE_FORMAT doit être explicitement MM/DD/YYYY ou DD/MM/YYYY.")
    date_part = "%m/%d/%Y" if date_format == "MM/DD/YYYY" else "%d/%m/%Y"
    for time_part in ("%H:%M:%S", "%H:%M"):
        try:
            return dt.datetime.strptime(value, date_part + " " + time_part).replace(tzinfo=UTC)
        except ValueError:
            pass
    raise ValueError("Date createdOn illisible : " + value)


def parse_optional_datetime(value):
    value = str(value or "").strip()
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except ValueError:
        return None


def is_valid_gtin(value):
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) not in (8, 12, 13, 14):
        return False
    numbers = [int(char) for char in digits]
    check_digit = numbers.pop()
    total = sum(number * weight for number, weight in zip(reversed(numbers), [3, 1] * 8))
    return (10 - total % 10) % 10 == check_digit


def normalize_gtin(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits if is_valid_gtin(digits) else ""


def parse_eur(value, allow_zero=False):
    raw = str(value or "").strip().replace(",", ".")
    if not raw:
        return None
    try:
        number = round(float(raw), 2)
    except ValueError:
        return None
    if not number >= 0 or (number == 0 and not allow_zero):
        return None
    return number


def category_for(slug, name, primary, secondary):
    if slug == "nicchia":
        return "beauty"
    value = f"{name} {primary} {secondary}".lower()
    if any(k in value for k in ("chauss", "basket", "sneaker", "maillot", "short", "pantalon", "legging", "t-shirt", "t shirt", "veste", "survêtement", "sweat", "robe", "polo", "textile", "vêtement")):
        return "fashion"
    if any(k in value for k in ("vélo", "velo", "fitness", "musculation", "camping", "randonnée", "randonnee", "football", "tennis", "running", "sport", "natation", "pêche", "peche")):
        return "sport"
    if any(k in value for k in ("tente", "sac de couchage", "cuisine", "meuble", "maison")):
        return "home"
    return "sport"


def active_price(node, now):
    price_node = node.find("./price")
    if price_node is None or (price_node.get("currency") or "").upper() != "EUR":
        return None
    retail = parse_eur(price_node.findtext("retail"))
    if retail is None:
        return None
    sale_node = price_node.find("sale")
    sale = parse_eur((sale_node.text or "").strip()) if sale_node is not None else None
    if sale is None or sale >= retail:
        return retail
    begin_raw = sale_node.get("begin_date", "") if sale_node is not None else ""
    end_raw = sale_node.get("end_date", "") if sale_node is not None else ""
    begin = parse_optional_datetime(begin_raw)
    end = parse_optional_datetime(end_raw)
    if (begin_raw and begin is None) or (end_raw and end is None):
        return retail
    if begin and now < begin:
        return retail
    if end and now > end:
        return retail
    return sale


def parse_feed(path, merchant, slug, date_format, now=None, max_age_hours=48, price_tax_status="unspecified", require_trailer=True):
    now = now or dt.datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    else:
        now = now.astimezone(UTC)
    if price_tax_status not in ("included", "unspecified"):
        raise ValueError("RAKUTEN_PRICE_TAX_STATUS doit valoir included ou unspecified.")

    with gzip.open(path, "rb") as stream:
        root = ET.parse(stream).getroot()

    header = root.find("./header")
    created_on = header.findtext("createdOn") if header is not None else ""
    source_created = parse_source_timestamp(created_on, date_format)
    age = now - source_created
    if age < dt.timedelta(minutes=-5):
        raise ValueError("Flux daté dans le futur : " + created_on)
    if age > dt.timedelta(hours=max_age_hours):
        raise ValueError("Flux périmé : createdOn " + created_on + " (fenêtre " + str(max_age_hours) + " h).")

    product_nodes = root.findall("./product")
    trailer = root.find("./trailer")
    if require_trailer:
        if trailer is None:
            raise ValueError("Trailer XML absent : intégrité et exhaustivité du flux non vérifiables.")
        try:
            expected_count = int((trailer.findtext("numberOfProducts") or "").strip())
        except ValueError:
            raise ValueError("Nombre de produits du trailer absent ou invalide.")
        if expected_count != len(product_nodes):
            raise ValueError("Trailer incohérent : " + str(expected_count) + " annoncés, " + str(len(product_nodes)) + " reçus.")

    rows = []
    skipped = collections.Counter()
    for node in product_nodes:
        name = (node.get("name") or "").strip()
        product_id = (node.get("product_id") or "").strip()
        sku = (node.get("sku_number") or "").strip()
        brand = (node.findtext("./brand") or node.get("manufacturer_name") or "").strip()
        mpn = (node.get("part_number") or "").strip()
        gtin = normalize_gtin(node.findtext("./upc"))
        if not name or not product_id:
            skipped["identity"] += 1
            continue
        if not gtin and not (brand and mpn):
            skipped["no_exact_identity"] += 1
            continue

        price_node = node.find("./price")
        if price_node is None or (price_node.get("currency") or "").upper() != "EUR":
            skipped["currency"] += 1
            continue
        price = active_price(node, now)
        if price is None or price <= 0:
            skipped["price"] += 1
            continue
        regular = parse_eur(price_node.findtext("retail"))
        regular_price = regular if regular and regular > price else None

        image = (node.findtext("./URL/productImage") or "").strip()
        source_url = (node.findtext("./URL/product") or "").strip()
        image_parts = urlparse(image)
        link_parts = urlparse(source_url)
        if image_parts.scheme != "https" or not image_parts.netloc:
            skipped["image_url"] += 1
            continue
        if link_parts.scheme != "https" or link_parts.hostname != "click.linksynergy.com":
            skipped["affiliate_url"] += 1
            continue

        availability = (node.findtext("./shipping/availability") or "unknown").strip().lower()
        if availability in ("out-of-stock", "out of stock", "out_of_stock", "discontinued", "sold out"):
            skipped["out_of_stock"] += 1
            continue

        shipping_node = node.find("./shipping/cost")
        shipping = None
        if shipping_node is not None:
            shipping_raw = (shipping_node.findtext("amount") or "").strip()
            shipping_currency = (shipping_node.findtext("currency") or shipping_node.get("currency") or "").strip().upper()
            if shipping_raw and shipping_currency == "EUR":
                shipping = parse_eur(shipping_raw, allow_zero=True)

        primary = (node.findtext("./category/primary") or ("Beauté & parfums" if slug == "nicchia" else "Autres produits")).strip()
        secondary = (node.findtext("./category/secondary") or "").replace("~~", " / ").strip()
        description = (node.findtext("./description/short") or "").strip()
        rows.append({
            "id": f"{slug}-{product_id}",
            "name": name,
            "desc": description,
            "category": category_for(slug, name, primary, secondary),
            "brand": brand or merchant,
            "mpn": mpn,
            "query": name,
            "image": image,
            "imageSource": image,
            "imageSourceName": merchant,
            "imageKind": "merchant_feed",
            "imageStatus": "authorized_feed_image",
            "merchant": merchant,
            "priceValue": price,
            "regularPriceValue": regular_price,
            "priceTaxStatus": price_tax_status,
            "shippingPriceValue": shipping,
            "sourceUrl": source_url,
            "gtin": gtin,
            "sku": sku,
            "availability": availability,
            "primaryCategory": primary,
            "secondaryCategory": secondary,
            "sourceCreatedAt": source_created.isoformat().replace("+00:00", "Z"),
            "sourceFile": os.path.basename(path),
            "isRakutenProduct": True,
        })

    if not rows:
        raise ValueError("Aucune fiche exploitable après validation des identifiants, prix, images et liens.")
    stats = {
        "file": os.path.basename(path),
        "source_created_at": source_created.isoformat().replace("+00:00", "Z"),
        "raw_products": len(product_nodes),
        "eligible_products": len(rows),
        "with_gtin": sum(bool(row["gtin"]) for row in rows),
        "with_mpn": sum(bool(row["mpn"]) for row in rows),
        "with_shipping": sum(row["shippingPriceValue"] is not None for row in rows),
        "skipped": dict(skipped),
    }
    return rows, source_created, stats


def select_balanced(rows, limit):
    # Les promotions (prix barré fourni par le marchand) passent en premier, la plus forte remise d'abord.
    def discount(row):
        regular = row.get("regularPriceValue")
        return (regular - row["priceValue"]) / regular if regular else 0.0
    rows = sorted(rows, key=lambda row: -discount(row))
    by_category = collections.defaultdict(list)
    for row in rows:
        by_category[row["category"]].append(row)
    categories = sorted(by_category, key=lambda key: (-len(by_category[key]), key))
    if not categories:
        return []
    per_category = max(1, limit // len(categories))
    selected = []
    for category in categories:
        selected.extend(by_category[category][:per_category])
    seen = {row["id"] for row in selected}
    if len(selected) < limit:
        for row in rows:
            if row["id"] not in seen:
                selected.append(row)
                seen.add(row["id"])
                if len(selected) >= limit:
                    break
    return selected[:limit]


def resolve_price_tax_status(value, verified):
    """Ne confirme le TTC que sur un signal de confirmation explicite."""
    if value not in ("included", "unspecified"):
        raise ValueError("--price-tax-status doit valoir included ou unspecified.")
    if not isinstance(verified, bool):
        raise ValueError("La confirmation TVA doit être un booléen.")
    return "included" if value == "included" and verified else "unspecified"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default=".")
    parser.add_argument("--output", default="data/rakuten-products.json")
    parser.add_argument("--date-format", default=os.environ.get("RAKUTEN_DATE_FORMAT", ""))
    parser.add_argument("--max-age-hours", type=int, default=48)
    parser.add_argument("--price-tax-status", default=os.environ.get("RAKUTEN_PRICE_TAX_STATUS", "unspecified"))
    parser.add_argument("--price-tax-status-verified", choices=("true", "false"), default=os.environ.get("RAKUTEN_PRICE_TAX_STATUS_VERIFIED", "false"))
    parser.add_argument("--decathlon-limit", type=int, default=1500)
    parser.add_argument("--nicchia-limit", type=int, default=1500)
    args = parser.parse_args()

    if args.date_format not in ("MM/DD/YYYY", "DD/MM/YYYY"):
        raise SystemExit("Import bloqué : confirmer RAKUTEN_DATE_FORMAT (MM/DD/YYYY ou DD/MM/YYYY).")
    if args.max_age_hours < 1 or args.max_age_hours > 720:
        raise SystemExit("--max-age-hours doit être compris entre 1 et 720.")
    try:
        effective_price_tax_status = resolve_price_tax_status(
            args.price_tax_status, args.price_tax_status_verified == "true"
        )
    except ValueError as error:
        raise SystemExit(str(error))

    now = dt.datetime.now(UTC)
    all_products = []
    source_stats = {}
    source_dates = []
    loaded_slugs = set()
    for filename, merchant, slug in FEEDS:
        if slug in loaded_slugs:
            continue
        path = os.path.join(args.directory, filename)
        if not os.path.isfile(path):
            print("Source ignorée (fichier complet absent) : " + filename)
            continue
        try:
            rows, source_created, stats = parse_feed(
                path, merchant, slug, args.date_format, now, args.max_age_hours, effective_price_tax_status,
                require_trailer=not filename.endswith("_cmp.xml.gz")
            )
        except (OSError, EOFError, ET.ParseError, ValueError) as error:
            print("Source ignorée (" + filename + ") : " + str(error))
            continue
        limit = args.decathlon_limit if slug == "decathlon" else args.nicchia_limit
        selected = select_balanced(rows, limit)
        all_products.extend(selected)
        source_dates.append(source_created)
        stats["published_products"] = len(selected)
        source_stats[merchant] = stats
        loaded_slugs.add(slug)

    if not all_products:
        raise SystemExit("Aucun flux Rakuten complet, daté sans ambiguïté et frais de moins de " + str(args.max_age_hours) + " h. Fichier public précédent conservé.")

    all_products.sort(key=lambda row: (row["merchant"], row["name"].casefold(), row["id"]))
    generated_at = min(source_dates).isoformat().replace("+00:00", "Z")
    output = {
        "schema_version": 2,
        "status": "ok",
        "source": "Rakuten Advertising Product Catalog",
        "generated_at": generated_at,
        "priceTaxStatus": effective_price_tax_status,
        "priceTaxStatusVerified": effective_price_tax_status == "included",
        "source_stats": source_stats,
        "notes": [
            "Instantané issu de flux marchands autorisés et validés.",
            "La date generated_at est celle du flux marchand, pas celle de l'exécution du script.",
            "Prix en EUR communiqués par le marchand : prix de vente affiché aux particuliers sur son site.",
            "Le statut TTC n'est jamais déduit du seul fait que le marchand vend aux particuliers.",
            "priceTaxStatus=included et priceTaxStatusVerified=true exigent une confirmation explicite de la TVA par la source marchande.",
            "Sans confirmation explicite, priceTaxStatus=unspecified et le prix est exclu des comparaisons TTC.",
            "Frais de livraison conservés séparément ; aucun total n'est comparé lorsque la livraison est inconnue.",
            "Aucun rapprochement entre marchands sans GTIN valide commun ou identité fabricant exacte.",
        ],
        "products": all_products,
    }

    output_path = args.output
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    temporary = output_path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(output, stream, ensure_ascii=False, separators=(",", ":"))
    os.replace(temporary, output_path)

    print(json.dumps({
        "generated_at": generated_at,
        "priceTaxStatus": effective_price_tax_status,
        "priceTaxStatusVerified": effective_price_tax_status == "included",
        "sources": source_stats,
        "published_total": len(all_products),
        "with_gtin": sum(bool(row["gtin"]) for row in all_products),
        "with_shipping": sum(row["shippingPriceValue"] is not None for row in all_products),
        "categories": dict(collections.Counter(row["category"] for row in all_products)),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

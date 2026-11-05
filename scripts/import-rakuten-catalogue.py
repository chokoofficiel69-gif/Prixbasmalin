#!/usr/bin/env python3
"""Convert authorized Rakuten XML product feeds into a safe public catalogue snapshot."""
import argparse, collections, datetime as dt, gzip, json, os, re, xml.etree.ElementTree as ET

FEEDS = [
    ("44806_4768926_mp.xml.gz", "Decathlon National", "decathlon", "2026-11-05T00:13:11Z"),
    ("54306_4768926_1_cmp.xml.gz", "Nicchia Luxury", "nicchia", "2026-11-05T03:07:02Z"),
]

def category_for(slug, name, primary, secondary):
    if slug == "nicchia": return "beauty"
    value = f"{name} {primary} {secondary}".lower()
    if any(k in value for k in ("chauss", "basket", "sneaker", "maillot", "short", "pantalon", "legging", "t-shirt", "t shirt", "veste", "survêtement", "sweat", "robe", "polo", "textile", "vêtement")): return "fashion"
    if any(k in value for k in ("vélo", "velo", "fitness", "musculation", "camping", "randonnée", "randonnee", "football", "tennis", "running", "sport", "natation", "pêche", "peche")): return "sport"
    if any(k in value for k in ("tente", "sac de couchage", "cuisine", "meuble", "maison")): return "home"
    return "sport"

def parse_feed(path, merchant, slug, fallback_timestamp):
    with gzip.open(path, "rb") as stream:
        root = ET.parse(stream).getroot()
    header = root.find("./header")
    source_created = (header.findtext("createdOn") if header is not None else None) or fallback_timestamp
    rows = []
    for node in root.findall("./product"):
        name = (node.get("name") or "").strip()
        try: price = round(float(node.findtext("./price/retail") or ""), 2)
        except (TypeError, ValueError): continue
        image = (node.findtext("./URL/productImage") or "").strip()
        url = (node.findtext("./URL/product") or "").strip()
        if not name or price <= 0 or not image.startswith("https://") or not url.startswith("https://"): continue
        currency = (node.find("./price").get("currency") if node.find("./price") is not None else "") or ""
        if currency.upper() != "EUR": continue
        availability = (node.findtext("./shipping/availability") or "unknown").strip().lower()
        if availability not in ("in-stock", "instock", "in stock", "available", "unknown"): continue
        if slug == "decathlon" and re.search(r"\b(couteau|couteaux|poignard|machette|lame de chasse)\b", name, re.I): continue
        shipping_raw = node.findtext("./shipping/cost/amount")
        try: shipping = round(float(shipping_raw), 2) if shipping_raw is not None and shipping_raw.strip() else None
        except (TypeError, ValueError): shipping = None
        primary = (node.findtext("./category/primary") or ("Beauté & parfums" if slug == "nicchia" else "Autres produits")).strip()
        secondary = (node.findtext("./category/secondary") or "").replace("~~", " / ")
        sku = (node.get("sku_number") or "").strip()
        product_id = (node.get("product_id") or sku or str(len(rows))).strip()
        rows.append({
            "id": f"{slug}-{product_id}", "name": name,
            "desc": (node.findtext("./description/short") or "").strip(),
            "category": category_for(slug, name, primary, secondary),
            "brand": (node.findtext("./brand") or node.get("manufacturer_name") or merchant).strip(),
            "query": name, "image": image, "merchant": merchant,
            "priceValue": price, "shippingPriceValue": shipping, "sourceUrl": url,
            "gtin": (node.findtext("./upc") or "").strip(), "sku": sku,
            "availability": availability, "primaryCategory": primary,
            "secondaryCategory": secondary, "sourceCreatedAt": source_created,
            "isRakutenProduct": True,
        })
    return rows, source_created

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default=".")
    parser.add_argument("--output", default="data/rakuten-products.json")
    parser.add_argument("--decathlon-limit", type=int, default=5000)
    args = parser.parse_args()
    all_rows, source_stats = {}, {}
    for filename, merchant, slug, fallback in FEEDS:
        path = os.path.join(args.directory, filename)
        if not os.path.isfile(path): raise SystemExit(f"Flux manquant : {filename}")
        rows, source_created = parse_feed(path, merchant, slug, fallback)
        all_rows[merchant] = rows
        source_stats[merchant] = {"valid_products_in_feed": len(rows), "file": filename, "source_created_at": source_created}
    decathlon, nicchia = all_rows["Decathlon National"], all_rows["Nicchia Luxury"]
    by_category = collections.defaultdict(list)
    for row in decathlon: by_category[row["primaryCategory"]].append(row)
    ranked = sorted(by_category, key=lambda key: len(by_category[key]), reverse=True)
    selected, per_category = [], max(1, args.decathlon_limit // max(1, len(ranked)))
    for category in ranked: selected.extend(by_category[category][:per_category])
    if len(selected) < args.decathlon_limit:
        seen = {row["id"] for row in selected}
        for row in decathlon:
            if row["id"] not in seen:
                selected.append(row)
                if len(selected) >= args.decathlon_limit: break
    selected = selected[:args.decathlon_limit]
    products = selected + nicchia
    products.sort(key=lambda row: (row["merchant"], row["name"].casefold()))
    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    output = {
        "schema_version": 1, "status": "ok", "source": "Rakuten Advertising Product Catalog",
        "generated_at": generated, "source_stats": source_stats,
        "notes": [
            "Instantané issu des flux Rakuten autorisés téléchargés par SFTP.",
            "Prix retail du flux ; date de création du flux affichée et prix à revérifier chez le marchand.",
            "Frais de livraison conservés séparément ; comparaison du total uniquement lorsqu'ils sont connus.",
            "Aucun rapprochement entre marchands sans GTIN exact commun.",
        ], "products": products,
    }
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    temporary = args.output + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream: json.dump(output, stream, ensure_ascii=False, separators=(",", ":"))
    os.replace(temporary, args.output)
    print(json.dumps({
        "generated_at": generated, "valid_decathlon": len(decathlon), "valid_nicchia": len(nicchia),
        "published_decathlon": len(selected), "published_nicchia": len(nicchia), "published_total": len(products),
        "with_images": sum(bool(row["image"]) for row in products),
        "with_prices": sum(row["priceValue"] > 0 for row in products),
        "with_gtin": sum(bool(row["gtin"]) for row in products),
        "with_shipping": sum(row["shippingPriceValue"] is not None for row in products),
        "categories": dict(collections.Counter(row["category"] for row in products)),
    }, ensure_ascii=False))

if __name__ == "__main__": main()

#!/usr/bin/env python3
"""Construit data/fiches-produits.json à partir des relevés PrixTracker.

Chaque fiche regroupe, pour un produit, le dernier prix relevé chez chaque marchand,
l'historique du prix minimum par jour et une photo uniquement si elle est déjà
validée dans data/home-products.json. Les prix sont des relevés historiques
(Licence Ouverte 2.0) : ils sont datés et ne sont jamais présentés comme actuels.
"""
import argparse
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "prixtracker-prices.json"
HOME = ROOT / "data" / "home-products.json"
LICENSED = ROOT / "data" / "product-images.json"
ALLOWED_LICENSES = ("cc0", "public domain", "domaine public", "cc by", "partenaire")
OUTPUT = ROOT / "data" / "fiches-produits.json"

VERIFIED_IMAGE_STATUSES = {
    "manufacturer_verified",
    "official_press_image",
    "retailer_product_image",
    "authorized_feed_image",
}

CATEGORY_LABELS = {
    "smartphone": "Smartphones",
    "tablette": "Tablettes",
    "laptop": "Ordinateurs portables",
    "audio": "Écouteurs & casques",
    "enceinte": "Enceintes",
    "montre": "Montres connectées",
    "console": "Consoles",
    "accessoire-ps5": "Accessoires PS5",
    "accessoire-switch": "Accessoires Switch",
    "aspirateur": "Aspirateurs",
}


def norm(value):
    text = unicodedata.normalize("NFD", str(value or "")).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def verified_images(home):
    images = {}
    for product in home.get("products", []):
        if product.get("imageStatus") not in VERIFIED_IMAGE_STATUSES:
            continue
        image = str(product.get("image") or "")
        if not image.startswith("https://") or product.get("imageKind") == "illustration":
            continue
        name = norm(product.get("name"))
        brand = norm(product.get("brand"))
        for key in {name, norm(f"{brand} {name}"), name.removeprefix(brand + " ").strip()}:
            if key:
                images.setdefault(key, image)
    return images


def licensed_images(data):
    """Photos sous licence libre (ou fournies par un partenaire) avec leur crédit obligatoire."""
    out = {}
    for pid, entry in ((data or {}).get("images") or {}).items():
        url = str(entry.get("thumb") or entry.get("url") or "")
        license_name = str(entry.get("license") or "")
        # Photo hébergée sur le site (assets/produits/) ou adresse HTTPS.
        local_ok = url.startswith("/assets/produits/") and (ROOT / url.lstrip("/")).is_file()
        if not (url.startswith("https://") or local_ok) or not license_name:
            continue
        words = re.sub(r"[^a-z0-9.]+", " ", license_name.lower()).split()
        # Usage commercial et modifications autorisés : jamais NC (non commercial) ni ND (pas de modification).
        if not " ".join(words).startswith(ALLOWED_LICENSES) or "nc" in words or "nd" in words:
            continue
        out[pid] = {"image": url, "image_credit": {
            "author": entry.get("author") or "", "license": license_name,
            "file_page": entry.get("file_page") or "", "match": entry.get("match") or "exact"}}
    return out


def build(source, home, licensed=None):
    rows = source.get("offers", [])
    meta = {p["id"]: p for p in source.get("products", []) if p.get("id")}
    images = verified_images(home)
    licensed = licensed_images(licensed)
    latest = defaultdict(dict)  # product -> merchant -> (date, price)
    daily_min = defaultdict(dict)  # product -> date -> min price
    for row in rows:
        pid, merchant, date = row.get("product_id"), row.get("merchant"), row.get("date")
        try:
            price = float(row.get("min_price_eur_ttc"))
        except (TypeError, ValueError):
            continue
        if not pid or not merchant or not date or price <= 0:
            continue
        current = latest[pid].get(merchant)
        if current is None or date > current[0] or (date == current[0] and price < current[1]):
            latest[pid][merchant] = (date, price)
        if price < daily_min[pid].get(date, float("inf")):
            daily_min[pid][date] = price
        if pid not in meta:
            meta[pid] = {"id": pid, "name": row.get("product"), "brand": row.get("brand"), "category": row.get("category")}

    sheets = []
    for pid, merchants in latest.items():
        offers = sorted(
            ({"merchant": m, "price_eur": round(p, 2), "date": d} for m, (d, p) in merchants.items()),
            key=lambda o: (o["price_eur"], o["merchant"]),
        )
        # Écarter les relevés aberrants (plus de deux fois le prix médian : lot, erreur de saisie…).
        median = offers[len(offers) // 2]["price_eur"] if len(offers) % 2 else (offers[len(offers) // 2 - 1]["price_eur"] + offers[len(offers) // 2]["price_eur"]) / 2
        offers = [o for o in offers if o["price_eur"] <= 2 * median]
        if len(offers) < 2:
            continue
        info = meta.get(pid, {})
        name = info.get("name") or pid
        brand = info.get("brand") or ""
        history = [{"date": d, "min_price_eur": round(p, 2)} for d, p in sorted(daily_min[pid].items())]
        image = images.get(norm(name)) or images.get(norm(f"{brand} {name}")) or ""
        credit = None
        if pid in licensed:
            image, credit = licensed[pid]["image"], licensed[pid]["image_credit"]
        sheets.append({
            "id": pid,
            "name": name,
            "brand": brand,
            "category": info.get("category") or "",
            "category_label": CATEGORY_LABELS.get(info.get("category"), "High-Tech"),
            "image": image,
            "image_credit": credit,
            "offer_count": len(offers),
            "min_price_eur": offers[0]["price_eur"],
            "max_price_eur": offers[-1]["price_eur"],
            "last_date": max(o["date"] for o in offers),
            "offers": offers,
            "history": history,
        })
    sheets.sort(key=lambda s: (-s["offer_count"], s["name"]))
    return {
        "version": 1,
        "generated_from": "data/prixtracker-prices.json",
        "source_generated_at": source.get("generated_at"),
        "dataset_period": source.get("dataset_period"),
        "status": "historical_reference",
        "price_policy": "Prix relevés par PrixTracker (historique daté), à confirmer chez le marchand. Aucun prix n'est présenté comme actuel.",
        "attribution": source.get("attribution") or "Source : PrixTracker, Licence Ouverte 2.0.",
        "count": len(sheets),
        "products": sheets,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="échoue si le fichier publié n'est pas à jour")
    args = parser.parse_args()
    licensed = json.loads(LICENSED.read_text(encoding="utf-8")) if LICENSED.exists() else None
    data = build(json.loads(SOURCE.read_text(encoding="utf-8")), json.loads(HOME.read_text(encoding="utf-8")), licensed)
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != text:
            print("data/fiches-produits.json n'est pas à jour : lancez scripts/build_product_sheets.py", file=sys.stderr)
            return 1
        print(f"Fiches à jour : {data['count']} produits")
        return 0
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"{data['count']} fiches produits écrites dans {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Construit data/home-deals.json : la vitrine légère de la page d'accueil.

- « top » : les produits high-tech comparés (fiches PrixTracker) avec le plus d'offres
  et le plus grand écart de prix entre marchands.
- « gifts » : des idées cadeaux issues des flux Awin autorisés (photo du flux, prix
  public indiqué par le marchand, lien affilié), variées entre marchands et gammes de prix.

Aucun prix n'est inventé : chaque prix garde sa source et sa date.
"""
import argparse
import json
import math
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AWIN = ROOT / "data" / "awin-products.json"
SHEETS = ROOT / "data" / "fiches-produits.json"
OUTPUT = ROOT / "data" / "home-deals.json"

# Familles cadeaux reconnues dans les catégories des flux marchands.
GIFT_FAMILIES = [
    ("parfum", "Parfums", re.compile(r"parfum|perfume|cologne|eau de", re.I)),
    ("bougie", "Bougies & bien-être", re.compile(r"bougie|candle|savon|soap|cleanser|soin", re.I)),
    ("maison", "Maison", re.compile(r"home|kitchen|maison|cuisine|bath", re.I)),
    ("tech", "High-tech", re.compile(r"electroni|électroni|cam[eé]ra|photo|vid[eé]o", re.I)),
    ("mode", "Mode", re.compile(r"chaussette|collant|culotte|sock|fashion", re.I)),
]
# Pas de produits médicaux, ni de lingerie / gainant en vitrine cadeaux.
EXCLUDED = re.compile(r"bandelette|glyc[eé]mie|glucose|lancette|test strip|tensiom|culotte|gaine|spanx|collant|string|slip", re.I)
PRICE_BANDS = [(0, 30, "moins-30"), (30, 60, "30-60"), (60, 100, "60-100"), (100, 10_000, "plus-100")]


def gift_family(product):
    text = " ".join(str(product.get(k) or "") for k in ("desc", "name", "category"))
    for key, label, pattern in GIFT_FAMILIES:
        if pattern.search(text):
            return key, label
    return "autre", "Idées cadeaux"


def base_name(name):
    """Regroupe les déclinaisons (tailles, couleurs) d'un même article."""
    text = re.sub(r"\s+[–-]\s+.*$", "", str(name or ""))
    text = re.sub(r"\b\d+\s?(ml|g|cl|pcs)\b", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip().lower()


def parse_merchant_date(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def merchant_price_status(product, now=None, feed_is_fresh=True):
    """Un prix cadeau n'est publiable que si date marchand <48 h et TVA explicitement incluse."""
    price = product.get("priceValue")
    if not isinstance(price, (int, float)) or isinstance(price, bool) or not math.isfinite(price) or price <= 0:
        return "unverified", "invalid_price"
    if not feed_is_fresh:
        return "unverified", "stale_feed"

    merchant_date = product.get("merchantUpdatedAt") or product.get("merchant_updated_at")
    if not merchant_date:
        return "unverified", "missing_merchant_date"
    parsed = parse_merchant_date(merchant_date)
    if not parsed:
        return "unverified", "invalid_merchant_date"

    now = now or datetime.now(timezone.utc)
    age = now.astimezone(timezone.utc) - parsed
    if age < -timedelta(minutes=5) or age > timedelta(hours=48):
        return "unverified", "stale"

    tax_status = str(product.get("priceTaxStatus") or product.get("price_tax_status") or "").strip().lower()
    if tax_status != "included":
        return "unverified", "tax_unconfirmed"
    return "verified_current", "verified_current"


def build_gifts(awin, limit=48, now=None):
    fetched_at = awin.get("fetched_at")
    now = now or datetime.now(timezone.utc)
    feed_date = parse_merchant_date(fetched_at)
    feed_age = now.astimezone(timezone.utc) - feed_date if feed_date else None
    feed_is_fresh = feed_age is not None and timedelta(0) <= feed_age <= timedelta(hours=48)
    by_merchant = {}
    seen = set()
    for p in awin.get("products", []):
        price = p.get("priceValue")
        image = str(p.get("image") or "")
        url = str(p.get("sourceUrl") or "")
        if not isinstance(price, (int, float)) or isinstance(price, bool) or not 12 <= price <= 300:
            continue
        if not p.get("name") or not image.startswith("https://") or not url.startswith("https://") or not p.get("merchant"):
            continue
        if EXCLUDED.search(f"{p.get('name')} {p.get('desc')}"):
            continue
        key = (p["merchant"], base_name(p.get("name")))
        if key in seen:
            continue
        seen.add(key)
        family, family_label = gift_family(p)
        price_status, price_status_reason = merchant_price_status(p, now=now, feed_is_fresh=feed_is_fresh)
        merchant_date = p.get("merchantUpdatedAt") or p.get("merchant_updated_at")
        shipping = p.get("shippingPriceValue")
        verified = price_status == "verified_current"
        by_merchant.setdefault(p["merchant"], []).append({
            "id": p.get("id"),
            "name": p.get("name"),
            "merchant": p["merchant"],
            "price_eur": round(float(price), 2) if verified else None,
            "price_status": price_status,
            "price_status_reason": price_status_reason,
            "shipping_eur": round(float(shipping), 2) if verified and isinstance(shipping, (int, float)) and not isinstance(shipping, bool) and math.isfinite(shipping) and shipping >= 0 else None,
            "image": image,
            "url": url,
            "family": family,
            "family_label": family_label,
            "band": next((b for lo, hi, b in PRICE_BANDS if lo <= price < hi), "unverified") if verified else "unverified",
            "price_date": merchant_date or fetched_at,
            "price_date_kind": "merchant" if merchant_date else "feed",
        })
    # Les prix TTC frais d'abord ; sinon, conserver la fiche sans afficher son prix.
    for merchant, items in by_merchant.items():
        items.sort(key=lambda g: (
            g["price_status"] != "verified_current",
            g["shipping_eur"] is None,
            g["price_eur"] if g["price_eur"] is not None else float("inf"),
            g["name"],
        ))
        bands = {}
        for g in items:
            bands.setdefault(g["band"], []).append(g)
        mixed, lanes = [], [bands[b] for _, _, b in PRICE_BANDS if b in bands]
        if "unverified" in bands:
            lanes.append(bands["unverified"])
        while any(lanes):
            for lane in lanes:
                if lane:
                    mixed.append(lane.pop(len(lane) // 2))
        by_merchant[merchant] = mixed
    gifts, queues = [], [list(v) for _, v in sorted(by_merchant.items())]
    while len(gifts) < limit and any(queues):
        for q in queues:
            if q and len(gifts) < limit:
                gifts.append(q.pop(0))
    return gifts

def build_top(sheets, limit=12):
    """Les références PrixTracker les plus observées, présentées comme relevés historiques datés."""
    candidates = sorted((s for s in sheets.get("products", []) if s.get("offer_count", 0) >= 8),
                        key=lambda s: (not s.get("image"), -s["offer_count"], s["name"]))
    lanes = {}
    for s in candidates:
        lanes.setdefault(s["category"], []).append(s)
    ordered, queues = [], list(lanes.values())
    while len(ordered) < limit and any(queues):
        for q in queues:
            if q and len(ordered) < limit:
                ordered.append(q.pop(0))
    top = []
    for s in ordered:
        top.append({
            "id": s["id"], "name": s["name"], "brand": s["brand"], "category": s["category"],
            "category_label": s["category_label"], "image": s.get("image") or "", "image_credit": s.get("image_credit"),
            "min_price_eur": s["min_price_eur"], "max_price_eur": s["max_price_eur"],
            "offer_count": s["offer_count"], "last_date": s["last_date"],
        })
    return top


def build(awin, sheets, now=None):
    now = now or datetime.now(timezone.utc)
    generated_at = now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "version": 2,
        "generated_at": generated_at,
        "awin_fetched_at": awin.get("fetched_at"),
        "sheets_period": sheets.get("dataset_period"),
        "price_policy": "Les prix cadeaux ne sont affichés que si la date marchande est de moins de 48 h et si la TVA incluse est explicitement confirmée. Les fiches PrixTracker sont des relevés historiques, jamais des prix en direct.",
        "top": build_top(sheets),
        "gifts": build_gifts(awin, now=now),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = build(json.loads(AWIN.read_text(encoding="utf-8")), json.loads(SHEETS.read_text(encoding="utf-8")))
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != text:
            print("data/home-deals.json n'est pas à jour : lancez scripts/build_home_deals.py", file=sys.stderr)
            return 1
        return 0
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"Vitrine d'accueil : {len(data['top'])} références historiques, {len(data['gifts'])} idées cadeaux")
    return 0


if __name__ == "__main__":
    sys.exit(main())

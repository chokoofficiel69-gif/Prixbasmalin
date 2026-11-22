#!/usr/bin/env python3
"""Construit data/home-deals.json : la vitrine légère de la page d'accueil.

- « top » : les produits high-tech avec le plus de relevés historiques PrixTracker.
  Ces montants restent des observations passées, jamais des offres en direct.
- « gifts » : des idées cadeaux issues des flux Awin autorisés. Le prix numérique n'est
  conservé que si la date marchande a moins de 48 h et si le TTC est explicitement confirmé ;
  sinon la fiche reste visible sans prix, avec son lien marchand.

Aucun prix n'est inventé : chaque prix affiché garde sa source, sa date et son statut TTC.
"""
import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

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
ROTATION_INTERVAL = timedelta(hours=48)
ROTATION_RETRY_INTERVAL = timedelta(hours=12)
ROTATION_HISTORY_LIMIT = 1


def gift_family(product):
    text = " ".join(str(product.get(k) or "") for k in ("desc", "name", "category"))
    merchant = str(product.get("merchant") or "").casefold()
    if "imou" in merchant or "fiido technology development" in merchant:
        return "tech", "Tech"
    if "prm coupons couture" in merchant:
        if re.search(r"ameublement|rideau|coussin|linge de maison|nappe|d[eé]coration|tissu d.?ameublement", text, re.I):
            return "maison", "Maison"
        if re.search(r"patron|blouse|veste|robe|pantalon|chemise|jupe|jersey|denim|doublure|popeline|maille|viscose|molleton|drap de laine|mousseline|tulle|lycra|élasthanne|couture|agrafe|crochet|aiguille|fil|fermeture|bouton|ciseaux|canette|bobine|mercerie|broderie|machine a coudre|pied presseur|tirette|zip|rivet|oeillet|biais|ruban|passepoil|épingle|epingles|aimant en acier|baleine(?:s)? de col|bouclette de laine", text, re.I):
            return "mode", "Mode"
    for key, label, pattern in GIFT_FAMILIES:
        if pattern.search(text):
            return key, label
    return "autre", "Idées cadeaux"


PLACEHOLDER_IMAGE_PATTERN = re.compile(
    r"(?:^|[/_.-])(?:no[-_]?image|placeholder|missing[-_]?image)(?:[._/-]|$)",
    re.I,
)


def is_placeholder_image_url(url):
    """Reject merchant-feed placeholders even when the URL returns a valid image response."""
    try:
        path = urlsplit(str(url)).path.lower()
    except ValueError:
        return True
    return bool(PLACEHOLDER_IMAGE_PATTERN.search(path))


def base_name(name):
    """Regroupe les déclinaisons (tailles, couleurs) d'un même article."""
    text = re.sub(r"\s+[–-]\s+.*$", "", str(name or ""))
    text = re.sub(r"\b\d+\s?(ml|g|cl|pcs)\b", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip().lower()


def parse_utc(value):
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def verified_merchant_price(product, reference_time):
    """A numeric price is public only with a recent merchant timestamp and explicit TTC status."""
    price = product.get("priceValue")
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not 0 < price:
        return False
    tax_status = str(product.get("priceTaxStatus") or product.get("price_tax_status") or "").strip().lower()
    if tax_status != "included" or reference_time is None:
        return False
    updated_at = parse_utc(product.get("merchantUpdatedAt"))
    if updated_at is None:
        return False
    age = reference_time - updated_at
    return timedelta(minutes=-5) <= age <= timedelta(hours=48)


def gift_identity_key(gift):
    """Stable identity used only to avoid repeating recently displayed gift cards."""
    product_id = str(gift.get("id") or "").strip()
    if product_id:
        return product_id
    return f"{gift.get('merchant') or ''}|{base_name(gift.get('name'))}"


def image_fingerprint(url):
    """Store a non-reversible image identifier in the public rotation journal."""
    return hashlib.sha256(str(url or "").encode("utf-8")).hexdigest()


def iso_utc(value):
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def build_gifts(awin, limit=48, now=None, previous_gifts=None, exclude_ids=None, exclude_image_hashes=None):
    fetched_at = awin.get("fetched_at")
    reference_time = now or parse_utc(fetched_at)
    previous_images = {}
    for previous in previous_gifts or []:
        if not isinstance(previous, dict):
            continue
        previous_image = str(previous.get("image") or "")
        if previous_image and previous_image not in previous_images:
            previous_images[previous_image] = {
                "image_verified": previous.get("image_verified") is True,
                "image_verified_at": previous.get("image_verified_at"),
                "image_checked_at": previous.get("image_checked_at"),
                "image_check_status": previous.get("image_check_status") or "pending",
            }
    by_merchant = {}
    seen = set()
    for p in awin.get("products", []):
        price = p.get("priceValue")
        image = str(p.get("image") or "")
        url = str(p.get("sourceUrl") or "")
        if not isinstance(price, (int, float)) or not 12 <= price <= 300:
            continue
        if not image.startswith("https://") or not url.startswith("https://") or not p.get("merchant"):
            continue
        if is_placeholder_image_url(image):
            continue
        if EXCLUDED.search(f"{p.get('name')} {p.get('desc')}"):
            continue
        key = (p["merchant"], base_name(p.get("name")))
        if key in seen:
            continue
        seen.add(key)
        family, family_label = gift_family(p)
        price_verified = verified_merchant_price(p, reference_time)
        shipping = p.get("shippingPriceValue")
        merchant_updated_at = p.get("merchantUpdatedAt") or None
        by_merchant.setdefault(p["merchant"], []).append({
            "id": p.get("id"),
            "name": p.get("name"),
            "merchant": p["merchant"],
            "price_verified": price_verified,
            "price_eur": round(float(price), 2) if price_verified else None,
            "shipping_eur": round(float(shipping), 2) if price_verified and isinstance(shipping, (int, float)) and not isinstance(shipping, bool) and shipping >= 0 else None,
            "image": image,
            "image_provenance": "Flux marchand Awin autorisé",
            "image_verified": previous_images.get(image, {}).get("image_verified", False),
            "image_verified_at": previous_images.get(image, {}).get("image_verified_at"),
            "image_checked_at": previous_images.get(image, {}).get("image_checked_at"),
            "image_check_status": previous_images.get(image, {}).get("image_check_status", "pending"),
            "url": url,
            "family": family,
            "family_label": family_label,
            "band": next(b for lo, hi, b in PRICE_BANDS if lo <= price < hi) if price_verified else "a-confirmer",
            "price_date": merchant_updated_at,
            "price_date_kind": "merchant" if merchant_updated_at else "missing",
            "price_tax_status": str(p.get("priceTaxStatus") or p.get("price_tax_status") or "unspecified").strip().lower(),
        })
    # Dans chaque marchand : alterner les gammes de prix (livraison connue d'abord), puis alterner les marchands.
    for merchant, items in by_merchant.items():
        items.sort(key=lambda g: (
            g["shipping_eur"] is None,
            g["price_eur"] is None,
            g["price_eur"] if g["price_eur"] is not None else float("inf"),
            g["name"],
        ))
        bands = {}
        for g in items:
            bands.setdefault(g["band"], []).append(g)
        lane_keys = [b for _, _, b in PRICE_BANDS if b in bands]
        if "a-confirmer" in bands:
            lane_keys.append("a-confirmer")
        mixed, lanes = [], [bands[b] for b in lane_keys]
        while any(lanes):
            for lane in lanes:
                if lane:
                    mixed.append(lane.pop(len(lane) // 2))
        by_merchant[merchant] = mixed
    gifts, queues = [], [list(v) for _, v in sorted(by_merchant.items())]
    # Une même photo de flux ne doit apparaître qu'une fois dans la vitrine.
    # Les deux dernières sélections sont exclues lors d'une nouvelle rotation.
    excluded_ids = {str(value) for value in (exclude_ids or [])}
    excluded_image_hashes = {str(value) for value in (exclude_image_hashes or [])}
    seen_images = set()
    while len(gifts) < limit and any(queues):
        for q in queues:
            while q and len(gifts) < limit:
                candidate = q.pop(0)
                image_key = candidate["image"]
                identity = gift_identity_key(candidate)
                fingerprint = image_fingerprint(image_key)
                if identity in excluded_ids or fingerprint in excluded_image_hashes or image_key in seen_images:
                    continue
                seen_images.add(image_key)
                gifts.append(candidate)
                break
    return gifts


def has_verified_local_image(product):
    """A top historical card needs a present local asset and explicit visual/licence provenance."""
    image = str(product.get("image") or "")
    if not image.startswith("/assets/produits/"):
        return False
    relative = Path(image.lstrip("/"))
    if ".." in relative.parts or not (ROOT / relative).is_file():
        return False
    credit = product.get("image_credit")
    return (
        isinstance(credit, dict)
        and credit.get("match") == "verifie_visuellement"
        and all(str(credit.get(key) or "").strip() for key in ("author", "license", "file_page"))
    )


def has_verified_top_image(product):
    """Photo locale créditée, ou visuel officiel https déjà validé par build_product_sheets (statut vérifié)."""
    return has_verified_local_image(product) or str(product.get("image") or "").startswith("https://")


def build_top(sheets, limit=12):
    """Les produits les plus comparés, en alternant les catégories (pas de pourcentage d'écart affiché :
    les relevés mélangent parfois des packs ou des configurations différentes)."""
    candidates = sorted(
        (s for s in sheets.get("products", [])
         if s.get("offer_count", 0) >= 8 and has_verified_top_image(s)),
        key=lambda s: (-s["offer_count"], s["name"])
    )
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
            "offer_count": s["offer_count"], "last_date": s["last_date"], "price_kind": "historical",
        })
    return top


def rotation_record(gifts, rotated_at):
    return {
        "rotated_at": rotated_at,
        "product_ids": [gift_identity_key(gift) for gift in gifts],
        "image_hashes": [image_fingerprint(gift.get("image")) for gift in gifts],
    }


def with_listed_prices(gifts, awin):
    """Prix public du flux marchand actuel (demande du propriétaire, 22/11/2026) : affiché daté et
    « à confirmer », jamais comme prix vérifié. Marchands à prix HT (Lusini) exclus."""
    current = {p.get("id"): p for p in awin.get("products") or [] if isinstance(p, dict)}
    fetched_at = awin.get("fetched_at")
    out = []
    for gift in gifts:
        g = dict(gift)
        p = current.get(g.get("id")) or {}
        try:
            price = float(p.get("priceValue"))
        except (TypeError, ValueError):
            price = 0.0
        ok = price > 0 and fetched_at and "lusini" not in str(g.get("merchant", "")).lower()
        g["listed_price_eur"] = round(price, 2) if ok else None
        g["listed_price_date"] = fetched_at if ok else None
        out.append(g)
    return out


def build(awin, sheets, previous=None, rotation_now=None):
    previous = previous if isinstance(previous, dict) else {}
    reference_time = parse_utc(awin.get("fetched_at"))
    rotation_reference_time = rotation_now or reference_time
    previous_gifts = previous.get("gifts", []) if isinstance(previous.get("gifts"), list) else []
    previous_rotation = previous.get("rotation", {}) if isinstance(previous.get("rotation"), dict) else {}
    history = previous.get("rotation_history", [])
    history = history if isinstance(history, list) else []
    history = [entry for entry in history if isinstance(entry, dict)][-ROTATION_HISTORY_LIMIT:]

    if reference_time is None:
        gifts = previous_gifts or build_gifts(awin, previous_gifts=previous_gifts)
        rotation = dict(previous_rotation) or {
            "interval_hours": 48, "last_rotated_at": None,
            "status": "date_missing", "selected_count": len(gifts),
        }
    elif (
        rotation_reference_time is None
        or rotation_reference_time - reference_time > ROTATION_INTERVAL
        or rotation_reference_time - reference_time < timedelta(minutes=-5)
    ):
        gifts = previous_gifts
        rotation = dict(previous_rotation)
        rotation.update({
            "interval_hours": 48,
            "status": "held_stale_catalog",
            "selected_count": len(gifts),
            "last_attempt_at": iso_utc(rotation_reference_time),
        })
    elif not previous_gifts:
        gifts = build_gifts(awin, now=reference_time)
        rotation = {
            "interval_hours": 48,
            "last_rotated_at": iso_utc(rotation_reference_time),
            "status": "initial_selection",
            "selected_count": len(gifts),
        }
    else:
        last_rotated = (
            parse_utc(previous_rotation.get("last_rotated_at"))
            or parse_utc(previous.get("awin_fetched_at"))
            or rotation_reference_time
        )
        last_attempt = parse_utc(previous_rotation.get("last_attempt_at"))
        attempt_age = rotation_reference_time - last_attempt if last_attempt and rotation_reference_time else None
        retryable_statuses = {"held_previous_snapshot", "held_insufficient_candidates", "retry_cooldown"}
        if (
            previous_rotation.get("status") in retryable_statuses
            and attempt_age is not None
            and timedelta(0) <= attempt_age < ROTATION_RETRY_INTERVAL
        ):
            gifts = previous_gifts
            rotation = dict(previous_rotation)
            if attempt_age > timedelta(0):
                rotation["status"] = "retry_cooldown"
            rotation["selected_count"] = len(gifts)
        else:
            elapsed = rotation_reference_time - last_rotated
            if elapsed < ROTATION_INTERVAL:
                gifts = previous_gifts
                rotation = dict(previous_rotation)
                rotation.setdefault("interval_hours", 48)
                rotation.setdefault("last_rotated_at", iso_utc(last_rotated))
                rotation.setdefault("status", "baseline_initialized")
                if rotation.get("status") == "rotated" and elapsed > timedelta(0):
                    rotation["status"] = "waiting_48h"
                rotation["selected_count"] = len(gifts)
            else:
                excluded_ids = {gift_identity_key(gift) for gift in previous_gifts}
                excluded_image_hashes = {
                    image_fingerprint(gift.get("image")) for gift in previous_gifts
                }
                for entry in history:
                    excluded_ids.update(str(value) for value in (entry.get("product_ids") or []))
                    excluded_image_hashes.update(str(value) for value in (entry.get("image_hashes") or []))
                candidates = build_gifts(
                    awin,
                    limit=48,
                    now=reference_time,
                    previous_gifts=previous_gifts,
                    exclude_ids=excluded_ids,
                    exclude_image_hashes=excluded_image_hashes,
                )
                if len(candidates) >= 48:
                    history = (history + [rotation_record(previous_gifts, iso_utc(last_rotated))])[-ROTATION_HISTORY_LIMIT:]
                    gifts = candidates[:48]
                    rotation = {
                        "interval_hours": 48,
                        "last_rotated_at": iso_utc(rotation_reference_time),
                        "status": "rotated",
                        "selected_count": len(gifts),
                    }
                else:
                    gifts = previous_gifts
                    rotation = dict(previous_rotation)
                    rotation.update({
                        "interval_hours": 48,
                        "status": "held_insufficient_candidates",
                        "selected_count": len(gifts),
                        "last_attempt_at": iso_utc(rotation_reference_time),
                        "candidate_count": len(candidates),
                    })

    gifts = with_listed_prices(gifts, awin)
    return {
        "version": 1,
        "awin_fetched_at": awin.get("fetched_at"),
        "sheets_period": sheets.get("dataset_period"),
        "price_policy": "Les prix Awin ne sont affichables que si la date marchande a moins de 48 h et si le TTC est explicitement confirmé. Les données PrixTracker sont historiques, jamais des offres en direct.",
        "top": build_top(sheets),
        "gifts": gifts,
        "rotation": rotation,
        "rotation_history": history,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    previous = {}
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous = {}
    awin = json.loads(AWIN.read_text(encoding="utf-8"))
    sheets = json.loads(SHEETS.read_text(encoding="utf-8"))
    previous_rotation = previous.get("rotation", {}) if isinstance(previous.get("rotation"), dict) else {}
    if args.check:
        check_times = [
            parse_utc(previous_rotation.get("last_attempt_at")),
            parse_utc(previous_rotation.get("last_rotated_at")),
            parse_utc(awin.get("fetched_at")),
        ]
        rotation_now = max((value for value in check_times if value is not None), default=None)
    else:
        rotation_now = datetime.now(timezone.utc)
    data = build(awin, sheets, previous=previous, rotation_now=rotation_now)
    text = json.dumps(data, ensure_ascii=False, indent=1) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != text:
            print("data/home-deals.json n'est pas à jour : lancez scripts/build_home_deals.py", file=sys.stderr)
            return 1
        return 0
    OUTPUT.write_text(text, encoding="utf-8")
    print(f"Vitrine d'accueil : {len(data['top'])} meilleurs prix, {len(data['gifts'])} idées cadeaux")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Pages statiques « Sélection produits » construites depuis le flux Awin autorisé.

- /produits/<catégorie>.html : jusqu'à 48 produits par catégorie, lisibles par Google
  (le catalogue charge le flux en JavaScript, invisible pour les moteurs).
- /produits/index.html : sommaire des catégories.

Règles :
- feedUpdatedAt vérifie uniquement l'ancienneté du snapshot catalogue (7 jours maximum) ;
  il ne date jamais un prix.
- Un montant n'est affiché que si merchantUpdatedAt est une date individuelle valide
  fournie pour l'offre et âgée de moins de 48 h.
- Le libellé TTC exige priceTaxStatus="included" ; sinon le montant reste explicitement
  « prix source · TVA non confirmée », jamais un TTC vérifié.
- Les frais de livraison ne sont affichés que s'ils sont fournis et numériques.
- Aucune donnée inventée : nom, image, prix, marchand et lien viennent du flux.
- Les liens sont affiliés (rel="sponsored nofollow").
"""
import argparse
import html
import json
import re
import sys
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_seo_pages import date_fr, e, euro, fit_description, fit_title, layout  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FEED = ROOT / "data" / "awin-products.json"
FOLDER = "produits"
MAX_FEED_AGE = timedelta(days=7)
MAX_MERCHANT_PRICE_AGE = timedelta(hours=48)
PER_CATEGORY = 48
CATEGORIES = OrderedDict([
    ("tech", ("High-tech", "Objets connectés, caméras, accessoires et petits appareils high-tech")),
    ("home", ("Maison", "Maison, cuisine, décoration et équipement")),
    ("beauty", ("Beauté et parfums", "Parfums, soins et produits de beauté")),
    ("fashion", ("Mode", "Vêtements, chaussettes, accessoires de mode et mercerie")),
    ("kids", ("Enfants et bébé", "Puériculture, jouets et articles pour enfants")),
    ("sport", ("Sport et loisirs", "Vélo électrique, sport et loisirs")),
])
EXCLUDED = re.compile(r"bandelette|glyc[eé]mie|glucose|glucom|diab[eè]t|lancette|tensiom|lingerie|string|culotte|slip|shipping protection|protection|assurance|insurance|carte cadeau|gift ?card|e-?gift|frais de port|échantillon|sample", re.I)
MIN_PRICE = 5.0


def clean(text):
    return re.sub(r"\s+", " ", html.unescape(str(text or ""))).strip()


def parse_feed_time(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        moment = datetime.fromisoformat(raw.replace(" ", "T").replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def eligible(p, now):
    try:
        price = float(p.get("priceValue"))
    except (TypeError, ValueError):
        price = None
    image = str(p.get("image") or "")
    url = str(p.get("sourceUrl") or "")
    name = clean(p.get("name"))
    feed_time = parse_feed_time(p.get("feedUpdatedAt"))
    merchant_time = parse_feed_time(p.get("merchantUpdatedAt"))
    if not (name and p.get("merchant") and image.startswith("https://") and url.startswith("https://")):
        return None
    # feedUpdatedAt décrit l'import du flux, pas la date de mise à jour du prix.
    # Il sert uniquement à vérifier que le catalogue source n'est pas trop ancien.
    if feed_time is None or feed_time > now + timedelta(minutes=5) or now - feed_time > MAX_FEED_AGE:
        return None
    if EXCLUDED.search(name):
        return None
    price_is_fresh = (
        price is not None
        and price >= MIN_PRICE
        and merchant_time is not None
        and merchant_time <= now + timedelta(minutes=5)
        and now - merchant_time < MAX_MERCHANT_PRICE_AGE
    )
    tax_status = clean(p.get("priceTaxStatus") or p.get("price_tax_status") or "unspecified").casefold()
    if tax_status not in ("included", "unspecified"):
        tax_status = "unspecified"
    shipping = p.get("shippingPriceValue")
    return {
        "id": str(p.get("id")),
        "name": name,
        "brand": clean(p.get("brand")),
        "merchant": clean(p.get("merchant")),
        "image": image,
        "url": url,
        "price": round(price, 2) if price_is_fresh else None,
        "price_date": merchant_time.date().isoformat() if price_is_fresh else None,
        "price_time": merchant_time if price_is_fresh else None,
        "price_tax_status": tax_status if price_is_fresh else "unspecified",
        "shipping": shipping if price_is_fresh and isinstance(shipping, (int, float)) and not isinstance(shipping, bool) and shipping >= 0 else None,
        "feed_date": feed_time.date().isoformat(),
        "feed_time": feed_time,
        "has_gtin": bool(p.get("gtin")),
    }


def select(products, limit=PER_CATEGORY):
    """Produits les plus récents, en alternant les marchands pour une sélection variée."""
    by_merchant = OrderedDict()
    for p in sorted(products, key=lambda x: (not x["has_gtin"], -x["feed_time"].timestamp(), x["price"] if x["price"] is not None else float("inf"), x["id"])):
        by_merchant.setdefault(p["merchant"], []).append(p)
    picked, seen = [], set()
    while len(picked) < limit and any(by_merchant.values()):
        for items in by_merchant.values():
            while items:
                p = items.pop(0)
                key = (p["name"].casefold(), p["merchant"].casefold())
                if key not in seen:
                    seen.add(key)
                    picked.append(p)
                    break
            if len(picked) >= limit:
                break
    return picked


def card(p):
    if p["price"] is None:
        price_html = "<strong>Prix non affiché</strong>"
        price_note = "Date individuelle du marchand absente ou supérieure à 48 h · Livraison à vérifier"
    else:
        price_html = f"<strong>{euro(p['price'])}</strong>"
        if p["price_tax_status"] == "included":
            price_note = f"Prix TTC indiqué par le marchand le {date_fr(p['price_date'])}"
        else:
            price_note = f"Prix source du {date_fr(p['price_date'])} · TVA non confirmée"
        shipping = "Livraison gratuite" if p["shipping"] == 0 else (
            f"Livraison {euro(p['shipping'])}" if p["shipping"] is not None else "Livraison à vérifier")
        price_note += " · " + shipping
    brand = f"{e(p['brand'])} · " if p["brand"] else ""
    return (f'<a class="card pm-card" href="{e(p["url"])}" target="_blank" rel="sponsored nofollow noopener">'
            f'<div class="visual"><img src="{e(p["image"])}" alt="{e(p["name"])}" loading="lazy"></div>'
            f'<div class="c"><small>{brand}{e(p["merchant"])}</small><b>{e(p["name"])}</b>'
            f'{price_html}'
            f'<small>{e(price_note)}</small></div></a>')


NOTICE = ('<p class="source">Sélection de produits issus des flux Awin accessibles au compte éditeur. '
          'Un prix source n’est affiché que si le marchand fournit une date individuelle de mise à jour de moins de 48 h. '
          'Si la TVA n’est pas explicitement confirmée, la mention « TVA non confirmée » apparaît : ce montant ne constitue pas un prix TTC vérifié ni une comparaison multi-marchands. '
          'Les frais de livraison inconnus sont à vérifier. Le prix et la disponibilité peuvent changer : vérifiez-les chez le marchand. '
          'Liens affiliés : Prix Malin peut percevoir une commission, sans surcoût pour vous.</p>')


def category_page(slug, label, intro, items, others):
    links = " · ".join(f'<a href="/{FOLDER}/{s}.html">{e(l)}</a>' for s, l in others if s != slug)
    merchants = sorted({p["merchant"] for p in items})
    dated_prices = [p for p in items if p["price"] is not None]
    ttc_prices = [p for p in dated_prices if p["price_tax_status"] == "included"]
    latest_price_date = max((p["price_date"] for p in dated_prices), default=None)
    if dated_prices:
        price_summary = (
            f"{len(dated_prices)} prix sources avec date individuelle de moins de 48 h, "
            f"dont {len(ttc_prices)} explicitement TTC. "
            f"Dernière date marchande : {date_fr(latest_price_date)}."
        )
    else:
        price_summary = "Aucun prix n’est affiché : aucune date individuelle du marchand de moins de 48 h n’est disponible."
    body = f"""<section class="panel"><h1>{e(label)} : sélection de produits</h1>
<p>{e(intro)}. {len(items)} produits présents dans les flux Awin accessibles, issus de {len(merchants)} marchands. {price_summary}</p>
<p>Autres rayons : {links}</p>
<div class="grid pm-cards">{''.join(card(p) for p in items)}</div>
<p><a href="/catalogue.html">Rechercher dans tout le catalogue →</a></p></section>
{NOTICE}"""
    ld = {"@context": "https://schema.org", "@type": "ItemList", "name": label, "numberOfItems": len(items),
          "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": p["name"]} for i, p in enumerate(items)]}
    return layout(
        fit_title(f"{label} : sélection de produits | Prix Malin", f"{label} | Prix Malin", label),
        fit_description(f"Sélection {label.lower()} issue des flux Awin accessibles. Prix source daté affiché uniquement si une date individuelle du marchand de moins de 48 h est fournie."),
        f"/{FOLDER}/{slug}.html", body,
        [("Accueil", "/"), ("Sélection produits", f"/{FOLDER}/"), (label, f"/{FOLDER}/{slug}.html")],
        extra_head=f'<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>\n')


def index_page(groups):
    sections = "".join(
        f'<section class="panel"><h2><a style="color:inherit" href="/{FOLDER}/{slug}.html">{e(label)}</a></h2>'
        f'<div class="grid pm-cards">{"".join(card(p) for p in items[:6])}</div>'
        f'<p><a href="/{FOLDER}/{slug}.html">Voir les {len(items)} produits {e(label.lower())} →</a></p></section>'
        for slug, label, items in groups)
    total = sum(len(items) for _, _, items in groups)
    body = f"""<section class="panel"><h1>Sélection de produits issus des flux Awin accessibles</h1>
<p>{total} produits classés par rayon. Un prix source n’est affiché que si une date individuelle de mise à jour du marchand de moins de 48 h est fournie ; sinon, aucun montant n’est affiché. Cette sélection n’est pas une comparaison multi-marchands.</p></section>
{sections}{NOTICE}"""
    return layout(
        "Sélection produits des flux marchands | Prix Malin",
        fit_description(f"{total} produits issus de flux Awin accessibles, classés par rayon. Prix source affiché uniquement avec date individuelle du marchand de moins de 48 h."),
        f"/{FOLDER}/", body, [("Accueil", "/"), ("Sélection produits", f"/{FOLDER}/")])


def build(feed, now=None):
    now = now or datetime.now(timezone.utc)
    rows = [(p.get("category"), eligible(p, now)) for p in feed.get("products") or []]
    groups = []
    for slug, (label, intro) in CATEGORIES.items():
        items = select([p for cat, p in rows if cat == slug and p])
        if items:
            groups.append((slug, label, intro, items))
    others = [(slug, label) for slug, label, _, _ in groups]
    files = {f"{FOLDER}/{slug}.html": category_page(slug, label, intro, items, others) for slug, label, intro, items in groups}
    if groups:
        files[f"{FOLDER}/index.html"] = index_page([(s, l, items) for s, l, _, items in groups])
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--feed", default=str(FEED))
    args = parser.parse_args()
    feed = json.loads(Path(args.feed).read_text(encoding="utf-8"))
    if feed.get("status") != "ok":
        print("Flux Awin non exploitable : pages précédentes conservées.")
        return 0
    files = build(feed)
    if not files:
        print("Aucun produit Awin récent : pages précédentes conservées.")
        return 0
    folder = ROOT / FOLDER
    folder.mkdir(exist_ok=True)
    for rel, text in files.items():
        (ROOT / rel).write_text(text, encoding="utf-8")
    for old in folder.glob("*.html"):
        if f"{FOLDER}/{old.name}" not in files:
            old.unlink()
    print(f"{len(files)} pages « Sélection produits » générées")
    return 0


if __name__ == "__main__":
    sys.exit(main())

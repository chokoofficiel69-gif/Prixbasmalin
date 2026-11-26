#!/usr/bin/env python3
"""Génère des pages statiques pensées pour Google à partir des données du site.

- /prix/<produit>.html : fiches d'historique PrixTracker, jamais présentées comme des offres en direct.
- /prix/<catégorie>.html et /prix/index.html : sommaires des relevés historiques.
- /idees-cadeaux/<budget>.html : uniquement des offres Awin avec date marchande de moins de
  48 h et statut TTC explicitement confirmé.
- Le plan du site est construit par scripts/build_sitemap.py.

Les prix historiques restent des observations passées. Les prix Awin non datés ou sans
confirmation TTC ne sont jamais publiés comme des prix actuels.
"""
import argparse
import html
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent))
from site_chrome import CONSENT_SCRIPT, CSS_LINK, header_html  # noqa: E402  (en-tête commun)
import amazon_links  # noqa: E402  (liens Amazon directs, ASIN fournis par le propriétaire)

AMAZON_ASINS = amazon_links.load()

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://prixbasmalin.fr"
AMAZON_TAG = "prixbasmalin2-21"
SHEETS = ROOT / "data" / "fiches-produits.json"
DEALS = ROOT / "data" / "home-deals.json"
AI_GUIDES = ROOT / "data" / "ai-guides.json"


def load_ai_guides():
    """Conseils rédigés par IA (sans chiffres), validés par scripts/generate_ai_guides.py."""
    if not AI_GUIDES.exists():
        return {}
    return json.loads(AI_GUIDES.read_text(encoding="utf-8")).get("products", {})


def ai_guide_html(g):
    if not g:
        return ""
    items = "".join(f"<li>{e(c)}</li>" for c in g["criteres"])
    return (f'<section class="panel"><h2>Conseils avant d’acheter</h2><p>{e(g["intro"])}</p><ul>{items}</ul>'
            '<p class="source" style="color:#6b7280">Conseils généraux rédigés automatiquement par une IA, sans prix ni caractéristique inventés : '
            'vérifiez la fiche technique chez le marchand.</p></section>')

MERCHANTS = {
    "amazon": ("Amazon", lambda q: "https://www.amazon.fr/s?" + urlencode({"k": q, "tag": AMAZON_TAG})),
    "cdiscount": ("Cdiscount", lambda q: "https://www.cdiscount.com/search/10/" + quote(q) + ".html"),
    "fnac": ("Fnac", lambda q: "https://www.fnac.com/SearchResult/ResultList.aspx?" + urlencode({"Search": q})),
    "darty": ("Darty", lambda q: "https://www.darty.com/nav/recherche?" + urlencode({"text": q})),
    "boulanger": ("Boulanger", lambda q: "https://www.boulanger.com/resultats?" + urlencode({"tr": q})),
    "ebay": ("eBay", lambda q: "https://www.ebay.fr/sch/i.html?" + urlencode({"_nkw": q})),
    "aliexpress": ("AliExpress", lambda q: "https://fr.aliexpress.com/wholesale?" + urlencode({"SearchText": q})),
    "galaxusfr": ("Galaxus", lambda q: "https://www.galaxus.fr/fr/search?" + urlencode({"q": q})),
    "kauflandfr": ("Kaufland", lambda q: "https://www.kaufland.fr/s/?" + urlencode({"search_value": q})),
    "manomanofr": ("ManoMano", lambda q: "https://www.manomano.fr/recherche/" + quote(q)),
    "carrefourfr": ("Carrefour", lambda q: "https://www.carrefour.fr/s?" + urlencode({"q": q})),
    "eleclerchightechfr": ("E.Leclerc High-Tech", lambda q: "https://www.e.leclerc/recherche?" + urlencode({"q": q})),
    "eleclercfrmarketplac": ("E.Leclerc Marketplace", lambda q: "https://www.e.leclerc/recherche?" + urlencode({"q": q})),
}
NAMES = {
    "pixmaniafr": "Pixmania", "onbuycomfr": "OnBuy", "joybuyfr": "Joybuy", "alternatefr": "Alternate",
    "pccomponentesfr": "PcComponentes", "helloedgefr": "Hello Edge", "sonvideocom": "Son-Vidéo.com",
    "getgoodscomfr": "GetGoods", "inmacwstorecom": "Inmac wstore", "grouponfr": "Groupon", "topbizfr": "Topbiz",
    "xtremeinnfr": "Xtremeinn", "asgoodasnewfr": "asgoodasnew", "bixotocomfr": "Bixoto",
    "rueducommercefrmarke": "Rue du Commerce", "reicheltcomfr": "Reichelt", "maxiburofr": "Maxiburo",
    "cstechstorefr": "CS Tech Store", "photospecialistfr": "Photo Specialist", "mondofficefr": "Mondoffice",
    "ubaldimarketplace": "Ubaldi", "fibresetcablescomfr": "Fibres et Câbles", "cartouche24eu": "Cartouche24",
    "prindofr": "Prindo", "toner24fr": "Toner24", "hellorsefr": "Hellorse", "easyloungecom": "Easylounge",
}
CATEGORY_SLUGS = {
    "smartphone": "smartphones", "tablette": "tablettes", "laptop": "ordinateurs-portables",
    "audio": "ecouteurs-casques", "enceinte": "enceintes", "montre": "montres-connectees",
    "console": "consoles", "accessoire-ps5": "accessoires-ps5", "accessoire-switch": "accessoires-switch",
    "aspirateur": "aspirateurs",
}
GIFT_BUDGETS = [
    ("moins-de-30-euros", "Idées cadeaux à moins de 30 €", 0, 30),
    ("30-a-60-euros", "Idées cadeaux de 30 à 60 €", 30, 60),
    ("60-a-100-euros", "Idées cadeaux de 60 à 100 €", 60, 100),
    ("plus-de-100-euros", "Idées cadeaux à plus de 100 €", 100, 10_000),
]
GIFT_EXCLUDED = re.compile(r"bandelette|glyc[eé]mie|glucose|lancette|tensiom|culotte|gaine|spanx|collant|string|slip|support|fixation|boîtier|boitier|câble|cable|batterie", re.I)

e = html.escape


def fit_title(*candidates, limit=60):
    """Premier titre candidat qui tient dans la limite affichée par Google."""
    for c in candidates:
        if len(c) <= limit:
            return c
    return candidates[-1][: limit - 1].rstrip() + "…"


def fit_description(text, limit=155):
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    return cut[: cut.rfind(" ")].rstrip(" ,;:—-") + "…"


def euro(value):
    text = f"{value:,.2f}".replace(",", " ").replace(".", ",")
    return text.replace(" ", " ") + " €"


def date_fr(value):
    y, m, d = str(value)[:10].split("-")
    return f"{d}/{m}/{y}"


def merchant_name(mid):
    if mid in MERCHANTS:
        return MERCHANTS[mid][0]
    if mid in NAMES:
        return NAMES[mid]
    return re.sub(r"(comfr|fr|com|eu)$", "", str(mid), flags=re.I).capitalize() or "Marchand"


def amazon_link(p):
    """(url, libellé, direct) : fiche produit Amazon si l'ASIN est connu, sinon recherche."""
    asin = AMAZON_ASINS.get(p["id"])
    if asin:
        return amazon_links.product_url(asin), "Voir sur Amazon ↗", True
    return MERCHANTS["amazon"][1](query_for(p)), "Rechercher sur Amazon ↗", False


def merchant_link(mid, query, p=None):
    if mid == "amazon" and p is not None and AMAZON_ASINS.get(p["id"]):
        return amazon_links.product_url(AMAZON_ASINS[p["id"]]), "Voir le produit", True
    if mid in MERCHANTS:
        return MERCHANTS[mid][1](query), "Rechercher", mid == "amazon"
    return "https://www.google.com/search?" + urlencode({"q": merchant_name(mid) + " " + query}), "Rechercher", False


def query_for(p):
    brand = p.get("brand") or ""
    return (brand + " " if brand and brand.lower() not in p["name"].lower() else "") + p["name"]


HEAD_CSS = """*{box-sizing:border-box}html,body{margin:0;background:#080d14;color:#111827;font:16px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#0b63ce}.top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-bottom:1px solid #1f2a3a;background:#080d14}
.logo{display:flex;align-items:center;gap:8px;color:#fff;text-decoration:none;font-weight:900;font-size:22px}.logo img{width:34px;height:34px}.logo span{color:#ff7a1a}
.top nav a{color:#dbe3ee;font-weight:700;text-decoration:none;margin-left:12px;font-size:14px}
main{max-width:980px;margin:0 auto;padding:12px 16px 30px}.crumbs{font-size:13px;color:#c9d3e0;margin:6px 0 10px}.crumbs a{color:#fff}
.panel{background:#fff;border-radius:16px;padding:16px;margin-bottom:12px}
h1{margin:0 0 6px;font-size:clamp(23px,5.5vw,32px);line-height:1.2}h2{margin:0 0 10px;font-size:20px}
.hero{display:grid;grid-template-columns:1fr 150px;gap:14px;align-items:center}.visual{aspect-ratio:1/1;border-radius:12px;background:#f3f4f6;overflow:hidden;display:flex;align-items:center;justify-content:center}
.visual img{width:100%;height:100%;object-fit:contain;padding:10px;mix-blend-mode:multiply}
.from{color:#5b6474;margin-top:6px}.from strong{display:block;font-size:34px;font-weight:900;color:#f05a00;line-height:1.1}
.cta{display:flex;align-items:center;justify-content:center;min-height:48px;margin-top:12px;border-radius:10px;background:#0b63ce;color:#fff;font-weight:800;text-decoration:none}
.notice{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#fff7ec;border:1px solid #ffd7ad;color:#7a4510;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14.5px}th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5b6474;padding:6px 8px;border-bottom:2px solid #e3e7ee}
td{padding:10px 8px;border-bottom:1px solid #edf0f4;vertical-align:middle}td.p{font-weight:900;white-space:nowrap}tr.best td{background:#fff7f0}tr.best td.p{color:#f05a00}
td a.go{display:inline-flex;min-height:38px;align-items:center;padding:6px 12px;border-radius:8px;background:#22a861;color:#fff;font-weight:800;text-decoration:none;white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}.card{display:flex;flex-direction:column;border:1px solid #e3e7ee;border-radius:12px;overflow:hidden;text-decoration:none;color:#111827;background:#fff}
.card .visual{border-radius:0;aspect-ratio:4/3}.card div.c{padding:8px 10px 10px;display:flex;flex-direction:column;gap:2px}.card small{color:#6b7280;font-size:12px}.card b{font-size:14.5px;line-height:1.3}.card strong{color:#f05a00;font-size:19px}
dl{margin:0}dt{font-weight:800;margin-top:10px}dd{margin:2px 0 0;color:#374151}.source{color:#9aa6b8;font-size:12.5px;line-height:1.5}.source a{color:#ffad66}
@media(max-width:560px){.hero{grid-template-columns:1fr 110px}th.h,td.h{display:none}}"""


def layout(title, description, canonical, body, breadcrumbs, extra_head="", og_image="/assets/og-prix-malin.jpg"):
    crumbs_ld = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + u} for i, (n, u) in enumerate(breadcrumbs)],
    }
    crumbs_html = " › ".join(f'<a href="{e(u)}">{e(n)}</a>' for n, u in breadcrumbs[:-1]) + (" › " + e(breadcrumbs[-1][0]) if breadcrumbs else "")
    footer = (ROOT / "scripts" / "partials" / "site-footer.html").read_text(encoding="utf-8")
    return f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#080d14">
<title>{e(title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{SITE}{canonical}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Prix Bas Malin"><meta property="og:locale" content="fr_FR">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(description)}"><meta property="og:url" content="{SITE}{canonical}">
<meta property="og:image" content="{SITE}{og_image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/css/pm-product-art.css"><link rel="stylesheet" href="/css/pm-site-footer.css">
<style>{HEAD_CSS}</style>
{CSS_LINK}
{CONSENT_SCRIPT}
<script type="application/ld+json">{json.dumps(crumbs_ld, ensure_ascii=False)}</script>
{extra_head}<script src="/js/pm-product-art.js"></script>
</head>
<body>
{header_html("gift" if canonical.startswith("/idees-cadeaux/") else "compare")}
<main>
<nav class="crumbs" aria-label="Fil d’Ariane">{crumbs_html}</nav>
{body}
</main>
{footer}</body>
</html>
"""


def art(category, brand):
    return f'<div class="pm-art" role="img" aria-label="{e(brand)}"><b>{e(brand)}</b></div>'


def visual(p):
    if p.get("image"):
        return (f'<div class="visual"><img src="{e(p["image"])}" alt="{e(p["name"])}" loading="lazy" data-pm-art '
                f'data-category="{e(p["category"])}" data-brand="{e(p["brand"])}"></div>')
    return f'<div class="visual" data-art-category="{e(p["category"])}" data-art-brand="{e(p["brand"])}">{art(p["category"], p["brand"])}</div>'


ART_SCRIPT = """<script>document.querySelectorAll("[data-art-category]").forEach(function(el){if(window.pmProductArt)el.innerHTML=pmProductArt(el.dataset.artCategory,el.dataset.artBrand);});</script>"""


def recent_offers(p):
    """Relevés de moins de RECENT_OFFER_DAYS jours par rapport au dernier relevé du produit (triés par prix)."""
    offers = p.get("offers") or []
    if not offers:
        return []
    limit = (date.fromisoformat(max(o["date"] for o in offers)) - timedelta(days=RECENT_OFFER_DAYS)).isoformat()
    return sorted((o for o in offers if o["date"] >= limit and o["merchant"] not in REFURBISHED),
                  key=lambda o: (o["price_eur"], o["merchant"]))


def verified_current_offers(p, now=None):
    """Offres actuelles admissibles seulement si TTC, date marchande et fraîcheur sont prouvés."""
    reference_time = now or datetime.now(timezone.utc)
    eligible = []
    for offer in p.get("offers") or []:
        if offer.get("price_verified") is not True:
            continue
        if offer.get("price_tax_status") != "included" or offer.get("price_date_kind") != "merchant":
            continue
        if offer.get("currency") != "EUR" or offer.get("merchant") in REFURBISHED:
            continue
        raw_date = offer.get("price_date")
        if not offer.get("date") or not isinstance(raw_date, str) or "T" not in raw_date:
            continue
        updated_at = parse_utc(raw_date)
        if updated_at is None:
            continue
        age = reference_time - updated_at
        if age < timedelta(minutes=-5) or age > timedelta(hours=MAX_VERIFIED_PRICE_AGE_HOURS):
            continue
        price = offer.get("price_eur")
        if isinstance(price, bool) or not isinstance(price, (int, float)) or price <= 0:
            continue
        eligible.append(offer)
    return sorted(eligible, key=lambda o: (o["price_eur"], str(o.get("merchant") or "")))


def best_recent(p):
    """Meilleur relevé dans la fenêtre historique relative au dernier relevé du produit."""
    recent = recent_offers(p)
    if recent:
        return recent[0]
    new = [o for o in p["offers"] if o["merchant"] not in REFURBISHED]
    return new[0] if new else p["offers"][0]


def historical_lowest_offer(p):
    """Plus bas relevé historique disponible, hors vendeurs reconditionnés."""
    offers = [o for o in p.get("offers", []) if o.get("merchant") not in REFURBISHED]
    return min(offers or p["offers"], key=lambda o: (o["price_eur"], o.get("date", "")))


def product_card(p, now=None):
    current = verified_current_offers(p, now=now)
    best = current[0] if current else historical_lowest_offer(p)
    label = "Prix TTC confirmé" if current else "Plus bas relevé historique"
    return (f'<a class="card pm-card" href="/prix/{e(p["id"])}.html">{visual(p)}<div class="c"><small>{e(p["category_label"])} · {p["offer_count"]} marchands suivis</small>'
            f'<b>{e(p["name"])}</b><small>{label}</small><strong>{euro(best["price_eur"])}</strong><small>Relevé du {date_fr(best["date"])} chez {e(merchant_name(best["merchant"]))}</small></div></a>')


def trend_sentence(p):
    hist = p.get("history") or []
    if len(hist) < 2:
        return ""
    first, last = hist[0]["min_price_eur"], hist[-1]["min_price_eur"]
    low = min(h["min_price_eur"] for h in hist)
    low_day = next(h["date"] for h in hist if h["min_price_eur"] == low)
    diff = last - first
    if abs(diff) < 0.5:
        move = "est resté stable"
    elif diff < 0:
        move = f"a baissé de {euro(-diff)}"
    else:
        move = f"a augmenté de {euro(diff)}"
    return (f"Entre le {date_fr(hist[0]['date'])} et le {date_fr(hist[-1]['date'])}, le prix le plus bas relevé {move} "
            f"(de {euro(first)} à {euro(last)}). Le plus bas observé sur la période : {euro(low)}, le {date_fr(low_day)}.")


def chart_svg(p):
    hist = p.get("history") or []
    if len(hist) < 2:
        return ""
    w, h, pad = 640, 180, 26
    ys = [x["min_price_eur"] for x in hist]
    lo, hi = min(ys), max(ys)
    span = hi - lo or 1
    pts = [(pad + i * (w - 2 * pad) / (len(hist) - 1), h - pad - (y - lo) * (h - 2 * pad) / span) for i, y in enumerate(ys)]
    line = " ".join(("M" if i == 0 else "L") + f"{x:.1f} {y:.1f}" for i, (x, y) in enumerate(pts))
    return (f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="Évolution du prix le plus bas relevé" style="width:100%;height:auto">'
            f'<line x1="{pad}" y1="{h - pad}" x2="{w - pad}" y2="{h - pad}" stroke="#e3e7ee"/>'
            f'<text x="{pad}" y="15" font-size="13" fill="#5b6474">{e(euro(hi))}</text><text x="{pad}" y="{h - 6}" font-size="13" fill="#5b6474">{e(euro(lo))}</text>'
            f'<path d="{line}" fill="none" stroke="#f05a00" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>')


ICECAT_GTINS = ROOT / "data" / "icecat-gtins.json"
GTINS = (json.loads(ICECAT_GTINS.read_text(encoding="utf-8")).get("products") or {}) if ICECAT_GTINS.exists() else {}
RECENT_OFFER_DAYS = 7
MAX_VERIFIED_PRICE_AGE_HOURS = 48
# Vendeurs de reconditionné : affichés dans le tableau avec la mention, jamais comme « meilleur prix » du neuf.
REFURBISHED = {"asgoodasnewfr", "friphonerycom", "backmarket", "backmarketfr"}  # seuls les relevés de moins de 7 jours (par rapport au dernier relevé) vont dans le balisage


def product_ld(p, now=None):
    """Balisage Product ; AggregateOffer uniquement pour des offres TTC confirmées de moins de 48 h."""
    data = {"@context": "https://schema.org", "@type": "Product", "name": p["name"],
            "url": f"{SITE}/prix/{p['id']}.html", "sku": p["id"],
            "category": p.get("category_label") or ""}
    if p.get("brand"):
        data["brand"] = {"@type": "Brand", "name": p["brand"]}
    image = str(p.get("image") or "")
    if image:
        data["image"] = image if image.startswith("https://") else f"{SITE}{image}"
    gtin = GTINS.get(p["id"])
    if gtin:
        data["gtin"] = gtin.lstrip("0") if len(gtin) == 14 else gtin
    current = verified_current_offers(p, now=now)
    if current:
        prices = [o["price_eur"] for o in current]
        data["offers"] = {"@type": "AggregateOffer", "priceCurrency": "EUR",
                          "lowPrice": f"{min(prices):.2f}", "highPrice": f"{max(prices):.2f}",
                          "offerCount": len(current)}
    return data


def product_page(p, sheets, period, guide=None, now=None):
    q = query_for(p)
    current = verified_current_offers(p, now=now)
    best = current[0] if current else historical_lowest_offer(p)
    pool = current or p["offers"]
    cheapest = [o for o in pool if o["price_eur"] == best["price_eur"]]
    hist_low = p["offers"][0]
    cheapest_names = " et ".join(merchant_name(o["merchant"]) for o in cheapest[:2])
    gap = p["max_price_eur"] - p["min_price_eur"]
    rows = []
    for o in p["offers"]:
        url, label, aff = merchant_link(o["merchant"], q, p)
        rel = "sponsored nofollow noopener" if aff else "nofollow noopener"
        cls = ' class="best"' if current and o["price_eur"] == best["price_eur"] else ""
        refurb = ' <small style="color:#6b7280;font-weight:600">· reconditionné</small>' if o["merchant"] in REFURBISHED else ""
        if refurb:
            cls = ""
        rows.append(f'<tr{cls}><td><b>{e(merchant_name(o["merchant"]))}</b>{refurb}</td><td class="p">{euro(o["price_eur"])}</td>'
                    f'<td class="h">{date_fr(o["date"])}</td><td><a class="go" href="{e(url)}" target="_blank" rel="{rel}">{label}</a></td></tr>')
    similar = [s for s in sheets if s["category"] == p["category"] and s["id"] != p["id"]][:8]
    cat_slug = CATEGORY_SLUGS.get(p["category"], "high-tech")
    amz_url, amz_label, amz_direct = amazon_link(p)
    price = euro(best['price_eur'])
    merchant_count = len(current) if current else p["offer_count"]
    first_merchant = merchant_name(best["merchant"])
    if current:
        title = fit_title(f"Prix {p['name']} : {price} chez {first_merchant} · {merchant_count} marchands",
                          f"Prix {p['name']} : {price} · {merchant_count} marchands relevés",
                          f"Prix {p['name']} : {price} | Prix Bas Malin",
                          f"Prix {p['name']}")
        description = fit_description(f"Prix TTC confirmé pour {p['name']} : {price} chez {cheapest_names} le {date_fr(best['date'])}. "
                                      f"{len(current)} offre(s) marchande(s) datée(s) de moins de 48 h.")
        h1_text = f"Prix {p['name']} : offres TTC confirmées chez {len(current)} marchands"
        hero_label = f"Prix TTC confirmé, relevé le {date_fr(best['date'])}"
    else:
        title = fit_title(f"Prix {p['name']} : relevé historique {price} · {date_fr(best['date'])}",
                          f"Historique des prix {p['name']} | Prix Bas Malin",
                          f"Prix {p['name']} | Prix Bas Malin",
                          f"Prix {p['name']}")
        description = fit_description(f"Historique des prix {p['name']} : plus bas relevé {price} chez {cheapest_names} le {date_fr(best['date'])}. "
                                      "Observation passée PrixTracker, à confirmer chez le marchand ; vérifiez le prix actuel avant achat.")
        h1_text = f"Historique des prix {p['name']} : {p['offer_count']} marchands relevés"
        hero_label = f"Plus bas relevé historique, le {date_fr(best['date'])}"
    faq = [
        (f"Quel est le dernier prix observé pour {p['name']} ?",
         f"Au relevé du {date_fr(best['date'])}, le plus bas montant observé pour {p['name']} était de {euro(best['price_eur'])} chez {cheapest_names}. "
         "C’est une observation historique, pas un prix actuel garanti."),
        (f"Quel écart historique a été observé pour {p['name']} ?",
         f"Les relevés historiques vont de {euro(p['min_price_eur'])} à {euro(p['max_price_eur'])}, soit {euro(gap)} d’écart. "
         "Cet écart passé ne constitue pas une économie garantie aujourd’hui."),
        (f"Le prix de {p['name']} baisse-t-il ?", trend_sentence(p) or "L’historique disponible est encore trop court pour dégager une tendance."),
        ("D’où viennent ces prix ?",
         "Ce sont des relevés historiques publiés par PrixTracker sous licence ouverte (data.gouv.fr). Ils ne représentent pas des offres actuelles ; "
         + ("le bouton Amazon ouvre la fiche du produit et les autres liens une recherche chez le marchand." if amz_direct else "les liens ouvrent une recherche chez le marchand.")),
    ]
    if guide:
        faq += [(f["q"], f["a"]) for f in guide["faq"]]
    faq_html = "".join(f"<dt>{e(qq)}</dt><dd>{e(a)}</dd>" for qq, a in faq)
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage",
              "mainEntity": [{"@type": "Question", "name": qq, "acceptedAnswer": {"@type": "Answer", "text": a}} for qq, a in faq]}
    credit = ""
    if p.get("image_credit"):
        c = p["image_credit"]
        credit = f'<p class="source" style="color:#6b7280">Photo : {e(c.get("author") or "")} · {e(c.get("license") or "")} · <a style="color:#0b63ce" href="{e(c.get("file_page") or "")}">{"Wikimedia Commons" if "wikimedia.org" in (c.get("file_page") or "") else "Icecat"}</a></p>'
    body = f"""<article class="panel">
<div class="hero"><div><h1>{e(h1_text)}</h1><div style="color:#5b6474;font-weight:700">{e(p['brand'])} · {e(p['category_label'])}</div>
<div class="from">{e(hero_label)}<strong>{euro(best['price_eur'])}</strong>chez {e(cheapest_names)} · à confirmer chez le marchand</div></div>{visual(p)}</div>
{credit}<a class="cta pm-btn pm-btn-compare pm-btn-block" href="#prix">Voir les relevés historiques</a>
<a class="cta pm-btn pm-btn-amazon pm-btn-block" href="{e(amz_url)}" target="_blank" rel="sponsored nofollow noopener">{amz_label}</a>
<p class="notice">Historique PrixTracker : les montants ci-dessous sont des observations passées, pas des offres actuelles. {"Le bouton Amazon ouvre la fiche du produit ; les autres liens ouvrent une recherche chez le marchand" if amz_direct else "Les liens ouvrent une recherche chez le marchand"} ; vérifiez la référence exacte, le prix final, la disponibilité et la livraison.</p>
</article>
<section class="panel" id="prix"><h2>Relevés historiques par marchand pour {e(p['name'])}</h2>
<p>L’historique contient <strong>{p['offer_count']} relevés marchands</strong>. Le plus bas relevé de l’historique était de <strong>{euro(hist_low['price_eur'])}</strong> chez {e(merchant_name(hist_low['merchant']))} le {date_fr(hist_low['date'])} ; le plus haut relevé atteint {euro(p['max_price_eur'])}. Cet écart est historique, pas une comparaison de prix actuels.</p>
<table><thead><tr><th>Marchand</th><th>Prix observé</th><th class="h">Date du relevé</th><th><span style="position:absolute;left:-9999px">Recherche</span></th></tr></thead><tbody>{''.join(rows)}</tbody></table>
<p class="source" style="color:#6b7280">{"Le lien Amazon ouvre la fiche du produit ; les autres liens ouvrent une recherche chez le marchand. Aucun de ces liens n’est une offre garantie." if amz_direct else "Les liens ouvrent une recherche du produit chez le marchand, pas une offre produit garantie."}</p>
</section>
<section class="panel"><h2>Évolution des prix relevés</h2>{chart_svg(p)}<p>{e(trend_sentence(p))}</p>
<a class="cta pm-btn pm-btn-ghost pm-btn-block" href="/produit.html?id={e(p['id'])}#alerte">Créer une alerte prix gratuite</a></section>
{ai_guide_html(guide)}<section class="panel"><h2>Questions fréquentes</h2><dl>{faq_html}</dl></section>
{f'<section class="panel"><h2>Autres {e(p["category_label"].lower())} comparés</h2><div class="grid pm-cards">{"".join(product_card(s) for s in similar)}</div><p><a href="/prix/{cat_slug}.html">Tous les {e(p["category_label"].lower())} →</a></p></section>' if similar else ''}
<p class="source">À lire : <a href="/guide-black-friday-2026.html">repérer les vraies bonnes affaires</a> · <a href="/guide-payer-moins-cher-en-ligne.html">10 astuces pour payer moins cher</a> · <a href="/guides.html">tous nos guides</a></p>
<p class="source">Source : relevés historiques PrixTracker via <a href="https://www.data.gouv.fr/datasets/releves-quotidiens-de-prix-de-produits-high-tech-en-france-prixtracker" rel="noopener">data.gouv.fr</a>, Licence Ouverte 2.0. Ces montants ne sont pas des prix en direct. Prix Bas Malin peut percevoir une commission sur les liens affiliés, sans surcoût pour vous.</p>
{ART_SCRIPT}"""
    crumbs = [("Accueil", "/"), ("Historique des prix", "/prix/"), (p["category_label"], f"/prix/{cat_slug}.html"), (p["name"], f"/prix/{p['id']}.html")]
    # Identifiant produit lu par la mesure d'audience (produits consultés).
    extra = (f'<meta name="pm-product-id" content="{e(p["id"])}">\n<script type="application/ld+json">{json.dumps(faq_ld, ensure_ascii=False)}</script>\n'
             f'<script type="application/ld+json">{json.dumps(product_ld(p, now=now), ensure_ascii=False)}</script>\n')
    return layout(title, description, f"/prix/{p['id']}.html", body, crumbs, extra)


GENERIC_LABELS = {"cuisine": "Cuisine high-tech", "casque-vr": "Casques VR", "coiffure": "Appareils de coiffure",
                  "accessoire-ps5-jeu": "Jeux PS5", "casque": "Casques audio"}


def category_page(cat, label, items):
    slug = CATEGORY_SLUGS.get(cat, cat)
    if label == "High-Tech" and cat in GENERIC_LABELS:
        label = GENERIC_LABELS[cat]  # libellé générique partagé : titre unique par catégorie
    cheapest = min(items, key=lambda s: s["min_price_eur"])
    title = fit_title(f"Historique des prix {label.lower()} | Prix Bas Malin",
                      f"Historique des prix {label.lower()}", f"{label} : historique des prix")
    description = fit_description(f"{len(items)} produits {label.lower()} avec relevés historiques PrixTracker chez jusqu’à "
                                  f"{max(s['offer_count'] for s in items)} marchands. Données datées, pas des offres en direct.")
    guide = {"smartphone": ("/guide-choisir-smartphone.html", "Comment choisir un smartphone sans payer trop cher"),
             "audio": ("/guide-ecouteurs-sans-fil-petit-prix.html", "Bien choisir des écouteurs sans fil à petit prix"),
             "enceinte": ("/guide-ecouteurs-sans-fil-petit-prix.html", "Guide audio : écouteurs et enceintes"),
             "aspirateur": ("/guide-choisir-aspirateur-robot.html", "Comment choisir un aspirateur robot")}.get(cat, ("/guide-black-friday-2026.html", "Black Friday 2026 : repérer les vraies bonnes affaires"))
    body = f"""<section class="panel"><p style="margin:0 0 10px">📘 Notre guide : <a href="{guide[0]}">{e(guide[1])}</a> · <a href="/guides.html">tous les guides</a></p><h1>Historique des prix : {e(label)}</h1>
<p>{len(items)} produits avec relevés historiques PrixTracker. Les montants affichés sont des observations passées, pas des offres actuelles ni des prix en temps réel.</p>
<div class="grid pm-cards">{''.join(product_card(s) for s in items)}</div></section>
<p class="source">Source : PrixTracker via data.gouv.fr, Licence Ouverte 2.0. Relevés historiques à vérifier chez le marchand ; aucune disponibilité ou livraison actuelle n’est garantie.</p>{ART_SCRIPT}"""
    return slug, layout(title, description, f"/prix/{slug}.html", body, [("Accueil", "/"), ("Historique des prix", "/prix/"), (label, f"/prix/{slug}.html")])


def index_page(groups, total):
    sections = "".join(
        f'<section class="panel"><h2><a href="/prix/{CATEGORY_SLUGS.get(cat, cat)}.html" style="color:inherit">{e(label)}</a></h2>'
        f'<div class="grid pm-cards">{"".join(product_card(s) for s in items[:8])}</div>'
        f'<p><a href="/prix/{CATEGORY_SLUGS.get(cat, cat)}.html">Voir les {len(items)} {e(label.lower())} →</a></p></section>'
        for cat, label, items in groups)
    body = f"""<section class="panel"><h1>Historique des prix high-tech</h1>
<p>{total} produits avec relevés historiques PrixTracker chez plusieurs marchands : smartphones, consoles, écouteurs, tablettes, ordinateurs, montres connectées, enceintes et aspirateurs. Ces montants sont des observations passées, pas des offres en direct.</p></section>{sections}{ART_SCRIPT}"""
    return layout("Historique des prix high-tech | Prix Bas Malin",
                  fit_description(f"{total} produits high-tech avec relevés historiques PrixTracker, datés et sourcés. Ces montants ne sont pas des offres en temps réel."),
                  "/prix/", body, [("Accueil", "/"), ("Historique des prix", "/prix/")])


def parse_utc(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def gift_items(deals, lo, hi, limit=36, now=None):
    reference_time = now or datetime.now(timezone.utc)
    seen, by_merchant = set(), {}
    for p in deals.get("gifts", []):
        if p.get("price_verified") is not True or p.get("price_tax_status") != "included" or p.get("price_date_kind") != "merchant":
            continue
        price = p.get("price_eur")
        if isinstance(price, bool) or not isinstance(price, (int, float)) or not (lo <= price < hi) or price < 10:
            continue
        updated_at = parse_utc(p.get("price_date"))
        if updated_at is None:
            continue
        age = reference_time - updated_at
        if age < timedelta(minutes=-5) or age > timedelta(hours=48):
            continue
        image = str(p.get("image") or "")
        url = str(p.get("url") or "")
        if not image.startswith("https://") or not url.startswith("https://"):
            continue
        if GIFT_EXCLUDED.search(f"{p.get('name')} {p.get('family_label')}"):
            continue
        merchant = str(p.get("merchant") or "").strip()
        if not merchant:
            continue
        key = (merchant, re.sub(r"\s+[–-]\s+.*$", "", str(p.get("name"))).lower())
        if key in seen:
            continue
        seen.add(key)
        by_merchant.setdefault(merchant, []).append(p)
    out, queues = [], [
        sorted(v, key=lambda x: (
            x.get("shipping_eur") is None,
            x.get("price_eur") if x.get("price_eur") is not None else float("inf"),
            x.get("name") or "",
        ))
        for _, v in sorted(by_merchant.items())
    ]
    while len(out) < limit and any(queues):
        for queue in queues:
            if queue and len(out) < limit:
                out.append(queue.pop(0))
    return out


def gift_card(p):
    shipping = p.get("shipping_eur")
    shipping_label = "Livraison gratuite" if shipping == 0 else (
        f"Livraison {euro(shipping)}" if isinstance(shipping, (int, float)) and not isinstance(shipping, bool) else "Livraison à confirmer"
    )
    return (f'<a class="card pm-card" href="{e(p["url"])}" target="_blank" rel="sponsored nofollow noopener"><div class="visual"><img src="{e(p["image"])}" alt="{e(p["name"])}" loading="lazy"></div>'
            f'<div class="c"><small>{e(p.get("merchant") or "")}</small><b>{e(p["name"])}</b><strong>Prix TTC confirmé : {euro(p["price_eur"])}</strong><small>Relevé marchand du {date_fr(p["price_date"])} · {e(shipping_label)}</small></div></a>')


def gift_page(slug, label, items, all_budgets):
    links = " · ".join(
        f'<a href="/idees-cadeaux/{s}.html">{e(l.replace("Idées cadeaux ", ""))}</a>'
        for s, l, _, _, other_items in all_budgets if s != slug and other_items
    )
    dates = [parse_utc(item.get("price_date")) for item in items]
    dates = [d for d in dates if d is not None]
    latest = max(dates).date().isoformat() if dates else ""
    body = f"""<section class="panel"><h1>{e(label)}</h1>
<p>{len(items)} produits avec prix TTC explicitement confirmé et date marchande de moins de 48 h. Dernière date marchande de la sélection : {date_fr(latest) if latest else 'non disponible'}. Les prix peuvent évoluer et la livraison doit être vérifiée chez le marchand.</p>
<p>Autres budgets : {links}</p>
<div class="grid pm-cards">{''.join(gift_card(p) for p in items)}</div></section>
<p class="source">Offres issues des flux marchands autorisés ; chaque prix affiché est daté et déclaré TTC. Liens affiliés : Prix Bas Malin peut percevoir une commission, sans surcoût pour vous.</p>"""
    return layout(fit_title(f"{label} : prix TTC vérifiés | Prix Bas Malin", f"{label} | Prix Bas Malin", label),
                  fit_description(f"{label} : {len(items)} produits avec prix TTC confirmé et date marchande de moins de 48 h. À vérifier chez le marchand."),
                  f"/idees-cadeaux/{slug}.html", body, [("Accueil", "/"), ("Idées cadeaux", "/idees-cadeaux/"), (label, f"/idees-cadeaux/{slug}.html")])


def gift_index(budgets_with_items):
    sections = "".join(
        f'<section class="panel"><h2><a style="color:inherit" href="/idees-cadeaux/{s}.html">{e(l)}</a></h2><div class="grid pm-cards">{"".join(gift_card(p) for p in items[:6])}</div>'
        f'<p><a href="/idees-cadeaux/{s}.html">Voir les {len(items)} idées →</a></p></section>'
        for s, l, _, _, items in budgets_with_items if items
    )
    empty = "" if sections else (
        '<p class="notice">Aucune offre avec prix TTC confirmé et date marchande de moins de 48 h n’est disponible actuellement. '
        'Les prix incomplets ou périmés sont masqués. Consultez le catalogue pour découvrir les produits sans prix affiché.</p>'
    )
    body = f"""<section class="panel"><h1>Idées cadeaux de Noël par budget</h1>
<p>Les prix ne sont affichés que lorsque le flux marchand confirme le TTC et fournit une date marchande récente. Les montants peuvent évoluer ; vérifiez le prix final et la livraison avant achat.</p>{empty}</section>{sections}"""
    return layout("Idées cadeaux de Noël | Prix Bas Malin",
                  "Sélection de cadeaux issue de flux marchands autorisés. Les prix sont masqués si la date marchande récente ou le statut TTC ne sont pas confirmés.",
                  "/idees-cadeaux/", body, [("Accueil", "/"), ("Idées cadeaux", "/idees-cadeaux/")])



BF_BUDGETS = [
    ("moins-de-100", "Moins de 100 €", 0, 100),
    ("100-200", "De 100 à 200 €", 100, 200),
    ("200-500", "De 200 à 500 €", 200, 500),
    ("plus-de-500", "Plus de 500 €", 500, float("inf")),
]
BF_CSS = """<style>
.bf-gap{display:inline-block;margin:4px 0;padding:3px 8px;border-radius:8px;background:#e8f7ee;color:#0a7a3d;font-weight:800;font-size:12.5px}
.bf-hero{background:linear-gradient(120deg,#111827,#1f2937);color:#fff;border-radius:16px;padding:18px 16px;margin-bottom:12px}
.bf-hero h1{color:#fff}.bf-hero p{color:#dbe3ee;margin:6px 0 0}.bf-date{display:inline-block;margin-top:10px;padding:6px 10px;border-radius:999px;background:#ff650b;color:#fff;font-weight:900;font-size:14px}
.bf-jump{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.bf-jump a{padding:8px 12px;border-radius:999px;background:#fff;color:#111827;font-weight:800;text-decoration:none;font-size:14px}
.bf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:10px}
.bf-card{display:flex;flex-direction:column;border:1px solid #e3e7ee;border-radius:12px;overflow:hidden;background:#fff}
.bf-card .visual{border-radius:0;aspect-ratio:4/3}.bf-card .c{padding:8px 10px 10px;display:flex;flex-direction:column;gap:3px;flex:1}
.bf-card small{color:#6b7280;font-size:12px}.bf-card b{font-size:14.5px;line-height:1.3}.bf-card strong{color:#f05a00;font-size:19px}
.bf-card .bf-actions{display:flex;flex-direction:column;gap:6px;margin-top:auto;padding-top:6px}.bf-card .bf-actions a{min-height:40px!important;font-size:13px!important;padding:8px 6px!important}
</style>"""
BF_SCRIPT = """<script>(function(){var el=document.getElementById("bf-countdown");if(!el)return;var start=Date.UTC(2026,10,26,23),end=Date.UTC(2026,11,1,23),now=Date.now();
if(now<start){var d=Math.ceil((start-now)/864e5);el.textContent="Black Friday dans "+d+" jour"+(d>1?"s":"")+" · vendredi 27 novembre";}
else if(now<end){el.textContent="C’est le Black Friday · jusqu’au Cyber Monday 30 novembre";}
else{el.textContent="Black Friday terminé · les prix relevés restent consultables";}})();</script>"""


def bf_recent_offers(p, today=None):
    """Relevés réellement datés des 7 derniers jours, par rapport au jour du rendu."""
    today = today or datetime.now(timezone.utc).date()
    if isinstance(today, str):
        today = date.fromisoformat(today)
    cutoff = (today - timedelta(days=RECENT_OFFER_DAYS)).isoformat()
    end = today.isoformat()
    return sorted(
        (o for o in (p.get("offers") or [])
         if cutoff <= str(o.get("date") or "")[:10] <= end and o.get("merchant") not in REFURBISHED),
        key=lambda o: (o["price_eur"], o["merchant"]),
    )


def bf_price_label(offer, today=None):
    """Évite d'appeler « récent » un relevé de plus de 7 jours au jour du rendu."""
    today = today or datetime.now(timezone.utc).date()
    if isinstance(today, str):
        today = date.fromisoformat(today)
    observed = date.fromisoformat(str(offer["date"])[:10])
    age_days = (today - observed).days
    if age_days < 0:
        return "Date de relevé à vérifier"
    if age_days <= RECENT_OFFER_DAYS:
        return "Prix relevé récemment · à confirmer"
    return "Prix historique · à confirmer chez le marchand"


def bf_card(p, today=None, best_override=None):
    best = best_override or best_recent(p)
    label_text = bf_price_label(best, today=today)
    url, label, _ = amazon_link(p)
    return (f'<article class="bf-card">{visual(p)}<div class="c"><small>{e(p["category_label"])}</small><b>{e(p["name"])}</b>'
            f'<small>{e(label_text)}</small><strong>{euro(best["price_eur"])}</strong>'
            f'<small>chez {e(merchant_name(best["merchant"]))} le {date_fr(best["date"])}</small>'
            f'<div class="bf-actions"><a class="pm-btn pm-btn-compare pm-btn-block" href="/prix/{e(p["id"])}.html">Comparer les prix</a>'
            f'<a class="pm-btn pm-btn-amazon pm-btn-block" href="{e(url)}" target="_blank" rel="sponsored nofollow noopener">{e(label)}</a></div></div></article>')


def bf_selection(sheets, lo, hi, limit=8):
    items = [p for p in sheets if p.get("offers") and lo <= best_recent(p)["price_eur"] < hi]
    # Les produits suivis chez le plus de marchands d'abord (les plus recherchés), photo réelle en priorité.
    items.sort(key=lambda p: (not p.get("image"), -p["offer_count"], best_recent(p)["price_eur"], p["id"]))
    return items[:limit]


def recent_gap(p, today=None):
    """Écart entre marchands calculé uniquement sur les 7 derniers jours calendaires."""
    recent = bf_recent_offers(p, today=today)
    if len(recent) < 3:
        return 0.0
    return round(recent[-1]["price_eur"] - recent[0]["price_eur"], 2)


def bf_gap_section(sheets, limit=8, today=None):
    """Les produits où choisir le bon marchand fait économiser le plus sur les 7 derniers jours."""
    today = today or datetime.now(timezone.utc).date()
    items = [
        p for p in sheets
        if recent_gap(p, today=today) >= 10
        and recent_gap(p, today=today) <= 0.5 * bf_recent_offers(p, today=today)[0]["price_eur"]
    ]
    items.sort(key=lambda p: (not p.get("image"), -recent_gap(p, today=today), p["id"]))
    items = items[:limit]
    if not items:
        return ""
    cards = "".join(
        bf_card(p, today=today, best_override=bf_recent_offers(p, today=today)[0]).replace('<small>Prix relevé récemment · à confirmer</small>',
                           f'<span class="bf-gap">Jusqu’à {euro(recent_gap(p, today=today))} d’écart entre marchands</span><small>Prix relevé récemment · à confirmer</small>', 1)
        for p in items)
    return ('<section class="panel" id="ecarts"><h2>Le bon marchand fait la différence</h2>'
            '<p>Même produit, prix très différents selon le vendeur : écarts entre le moins cher et le plus cher des relevés de la dernière semaine.</p>'
            f'<div class="bf-grid">{cards}</div></section>')


def partner_codes_section(today=None):
    """Codes promo officiels des campagnes partenaires, affichés seulement pendant leur période."""
    path = ROOT / "data" / "partner-codes.json"
    if not path.exists():
        return ""
    today = today or date.today().isoformat()
    codes = [c for c in json.loads(path.read_text(encoding="utf-8")).get("codes", [])
             if c.get("code") and c.get("url", "").startswith("https://") and c.get("end", "") >= today]
    if not codes:
        return ""
    cards = "".join(
        f'<div class="card pm-code" data-start="{e(c["start"])}" data-end="{e(c["end"])}"><div class="c">'
        f'<small>{e(c["merchant"])} · du {date_fr(c["start"])} au {date_fr(c["end"])}</small>'
        f'<b>{e(c["description"])}</b><strong>Code : <code>{e(c["code"])}</code> ({e(c["discount"])})</strong>'
        f'<a class="buy" href="{e(c["url"])}" target="_blank" rel="sponsored nofollow noopener">Voir l’offre ↗</a></div></div>'
        for c in codes)
    script = ('<script>(function(){var d=new Date().toISOString().slice(0,10);'
              'document.querySelectorAll(".pm-code").forEach(function(el){'
              'if(d<el.dataset.start){el.querySelector("strong").textContent="Code disponible à partir du "+el.dataset.start.split("-").reverse().join("/");}'
              'if(d>el.dataset.end){el.remove();}});})();</script>')
    return (f'<section class="panel" id="codes-promo"><h2>Codes promo officiels de nos partenaires</h2>'
            f'<div class="grid pm-cards">{cards}</div>'
            f'<p class="source">Codes fournis par les marchands dans leurs campagnes officielles. Conditions et validité chez le marchand. Lien affilié.</p></section>{script}')


CYBER_MONDAY = {
    "path": "/cyber-monday.html",
    "crumb": "Cyber Monday 2026",
    "title": "Cyber Monday 2026 : high-tech par budget | Prix Bas Malin",
    "h1": "Cyber Monday 2026 : notre sélection high-tech par budget",
    "date": "Lundi 30 novembre 2026 · après le Black Friday du 27 novembre",
    "lead": "Cyber Monday 2026",
    "faq": [
        ("Quand a lieu le Cyber Monday 2026 ?", "Le lundi 30 novembre 2026, trois jours après le Black Friday du vendredi 27 novembre. Certaines offres durent tout le week-end."),
        ("Les prix affichés sont-ils des prix Cyber Monday ?", "Non. Ce sont les plus bas prix relevés avant l’événement, avec leur date et le marchand. Ils servent de repère : si une « promo » Cyber Monday est plus chère que ce repère, ce n’est pas une bonne affaire."),
        ("Cyber Monday ou Black Friday : quand acheter ?", "Comparez le prix du jour avec le plus bas prix relevé sur nos fiches. Si le repère est déjà atteint au Black Friday, inutile d’attendre ; sinon, le Cyber Monday peut offrir une seconde chance."),
    ],
}


def cyber_monday_page(sheets, today=None):
    return black_friday_page(sheets, today=today, event=CYBER_MONDAY)


def black_friday_page(sheets, today=None, event=None):
    today = today or datetime.now(timezone.utc).date()
    groups = [(slug, label, bf_selection(sheets, lo, hi)) for slug, label, lo, hi in BF_BUDGETS]
    groups = [g for g in groups if g[2]]
    latest = max((p.get("last_date") or "") for p in sheets)
    jump = "".join(f'<a href="#{slug}">{e(label)}</a>' for slug, label, _ in groups)
    sections = "".join(
        f'<section class="panel" id="{slug}"><h2>{e(label)}</h2><div class="bf-grid">{"".join(bf_card(p, today=today) for p in items)}</div></section>'
        for slug, label, items in groups)
    count = sum(len(items) for _, _, items in groups)
    popular_products = [
        ("ps5-slim", "PS5 Slim (édition disque)"),
        ("ps5-pro", "PS5 Pro"),
        ("gta-6-ps5", "GTA 6 (PS5)"),
        ("switch-2", "Nintendo Switch 2"),
        ("airpods-pro-3", "AirPods Pro 3"),
        ("iphone-17", "iPhone 17"),
    ]
    available_ids = {p.get("id") for p in sheets}
    popular_links = "".join(
        f'<a href="/prix/{e(product_id)}.html">{e(label)}</a>'
        for product_id, label in popular_products if product_id in available_ids
    )
    popular_section = (
        '<section class="panel" id="references-a-suivre"><h2>Références à suivre avant le Black Friday</h2>'
        '<p>Retrouvez les fiches de suivi PS5, GTA 6, Nintendo Switch 2, AirPods Pro 3 et iPhone 17. '
        'Les montants de ces fiches sont des relevés historiques datés, pas des offres en direct.</p>'
        f'<div class="bf-jump">{popular_links}</div>'
        '<p>Le <a href="/catalogue.html">catalogue marchand</a> présente aussi des références Decathlon issues du flux Rakuten ; '
        'les prix des flux sont datés et affichés « à confirmer ».</p></section>'
    )
    faq = [
        ("Quand a lieu le Black Friday 2026 ?", "Le vendredi 27 novembre 2026, suivi du Cyber Monday le lundi 30 novembre. Beaucoup de marchands lancent leurs offres plusieurs jours avant."),
        ("Les prix affichés sont-ils des prix Black Friday ?", "Non. Ce sont les plus bas prix relevés avant l’événement, avec leur date et le marchand. Ils servent de repère : si une « promo » Black Friday est plus chère que ce repère, ce n’est pas une bonne affaire."),
        ("Comment savoir si une promotion est réelle ?", "Comparez le prix proposé avec le plus bas prix relevé sur nos fiches et chez les autres marchands. En France, une réduction affichée doit être calculée à partir du prix le plus bas des 30 derniers jours chez ce vendeur."),
    ]
    if event:
        faq = event["faq"]
    faq_html = "".join(f"<dt>{e(q)}</dt><dd>{e(a)}</dd>" for q, a in faq)
    ld = [
        {"@context": "https://schema.org", "@type": "FAQPage",
         "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]},
        {"@context": "https://schema.org", "@type": "ItemList", "name": "Sélection high-tech " + (event["lead"] if event else "Black Friday 2026"),
         "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": f"{SITE}/prix/{p['id']}.html", "name": p["name"]}
                             for i, p in enumerate(p for _, _, items in groups for p in items)]},
    ]
    lead = event["lead"] if event else "Black Friday 2026"
    h1 = event["h1"] if event else "Black Friday 2026 : notre sélection high-tech par budget"
    date_line = event["date"] if event else "Vendredi 27 novembre 2026 · Cyber Monday le 30 novembre"
    sibling = ('<a href="/black-friday.html">Black Friday 2026</a>' if event
               else '<a href="/cyber-monday.html">Cyber Monday 2026</a>')
    extra = BF_CSS + "\n" + "\n".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld) + "\n"
    body = f"""<section class="bf-hero"><h1>{e(h1)}</h1>
<p>{count} produits très demandés, classés par budget, avec un prix relevé sur les 7 derniers jours lorsqu’il existe ; sinon, un relevé historique disponible reste affiché avec sa date. Le bon réflexe : vérifiez toujours le montant chez le marchand.</p>
<span class="bf-date"{"" if event else ' id="bf-countdown"'}>{e(date_line)}</span>
<div class="bf-jump"><a href="#ecarts">Plus gros écarts</a>{jump}{sibling}</div></section>
<p class="notice" style="margin:0 0 12px">Prix relevés avant le {e(lead.replace(" 2026", ""))} (dernier relevé : {date_fr(latest)}), pas des prix promotionnels en direct. Vérifiez toujours le prix final, le vendeur et la livraison chez le marchand.</p>
{bf_gap_section(sheets, today=today)}{popular_section}{partner_codes_section()}{sections}
<section class="panel"><h2>Éviter les fausses promotions</h2><p>Préparez votre liste, notez le prix repère de chaque produit et créez une alerte prix gratuite depuis la fiche du produit. Notre guide détaille la méthode : <a href="/guide-black-friday-2026.html">Black Friday 2026 : repérer les vraies bonnes affaires</a>.</p>
<p>Vous cherchez des idées cadeaux ? <a href="/idees-cadeaux/">Idées cadeaux par budget</a> · <a href="/prix/">Tout le comparateur</a></p></section>
<section class="panel"><h2>Questions fréquentes</h2><dl>{faq_html}</dl></section>
<p class="source">Source des prix : relevés historiques PrixTracker via <a href="https://www.data.gouv.fr/datasets/releves-quotidiens-de-prix-de-produits-high-tech-en-france-prixtracker" rel="noopener">data.gouv.fr</a>, Licence Ouverte 2.0. Liens affiliés : Prix Bas Malin peut percevoir une commission, sans surcoût pour vous.</p>
{ART_SCRIPT}{BF_SCRIPT}"""
    if event:
        return layout(event["title"],
                      fit_description(f"{lead} : repères datés pour PS5, GTA 6, Switch 2, AirPods Pro 3 et iPhone 17, plus {count} produits par budget."),
                      event["path"], body, [("Accueil", "/"), (event["crumb"], event["path"])], extra,
                      og_image="/assets/og-black-friday.jpg")
    return layout("Black Friday 2026 : high-tech par budget | Prix Bas Malin",
                  fit_description(f"Black Friday 2026 : repères datés pour PS5, GTA 6, Switch 2, AirPods Pro 3 et iPhone 17, plus {count} produits par budget."),
                  "/black-friday.html", body, [("Accueil", "/"), ("Black Friday 2026", "/black-friday.html")], extra,
                  og_image="/assets/og-black-friday.jpg")


def build():
    sheets_data = json.loads(SHEETS.read_text(encoding="utf-8"))
    sheets = sheets_data["products"]
    period = sheets_data["dataset_period"]
    deals = json.loads(DEALS.read_text(encoding="utf-8")) if DEALS.exists() else {"gifts": []}
    ai_guides = load_ai_guides()
    files = {}
    for p in sheets:
        files[f"prix/{p['id']}.html"] = product_page(p, sheets, period, ai_guides.get(p["id"]))
    groups = []
    for cat in dict.fromkeys(s["category"] for s in sheets):
        items = [s for s in sheets if s["category"] == cat]
        label = items[0]["category_label"]
        slug, page = category_page(cat, label, items)
        files[f"prix/{slug}.html"] = page
        groups.append((cat, label, items))
    files["prix/index.html"] = index_page(groups, len(sheets))
    files["black-friday.html"] = black_friday_page(sheets)
    files["cyber-monday.html"] = cyber_monday_page(sheets)
    budgets = []
    reference_time = datetime.now(timezone.utc)
    for slug, label, lo, hi in GIFT_BUDGETS:
        items = gift_items(deals, lo, hi, now=reference_time)
        budgets.append((slug, label, lo, hi, items))
    for slug, label, lo, hi, items in budgets:
        if items:
            files[f"idees-cadeaux/{slug}.html"] = gift_page(slug, label, items, budgets)
    files["idees-cadeaux/index.html"] = gift_index(budgets)
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    files = build()
    stale = []
    for rel, text in files.items():
        path = ROOT / rel
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                stale.append(rel)
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    if not args.check:
        # Supprimer les pages de produits qui n'existent plus dans les données.
        for folder in ("prix", "idees-cadeaux"):
            for old in (ROOT / folder).glob("*.html"):
                if f"{folder}/{old.name}" not in files:
                    old.unlink()
        print(f"{len(files)} fichiers générés (pages produits, catégories, idées cadeaux)")
        return 0
    if stale:
        print("Pages SEO à régénérer : " + ", ".join(stale[:5]), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

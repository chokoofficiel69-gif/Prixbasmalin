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
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlencode

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://prixbasmalin.fr"
AMAZON_TAG = "prixbasmalin2-21"
SHEETS = ROOT / "data" / "fiches-produits.json"
DEALS = ROOT / "data" / "home-deals.json"

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


def merchant_link(mid, query):
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


def layout(title, description, canonical, body, breadcrumbs, extra_head=""):
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
<meta property="og:type" content="website"><meta property="og:site_name" content="Prix Malin"><meta property="og:locale" content="fr_FR">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(description)}"><meta property="og:url" content="{SITE}{canonical}">
<meta property="og:image" content="{SITE}/assets/prixmalin-publicite.webp">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/css/pm-product-art.css"><link rel="stylesheet" href="/css/pm-site-footer.css">
<style>{HEAD_CSS}</style>
<script type="application/ld+json">{json.dumps(crumbs_ld, ensure_ascii=False)}</script>
{extra_head}<script src="/js/pm-product-art.js"></script>
</head>
<body>
<header class="top"><a class="logo" href="/"><img src="/assets/logo-sac-prix-malin.svg" alt="" width="34" height="34">Prix <span>Malin</span></a><nav><a href="/prix/">Historique des prix</a><a href="/idees-cadeaux/">Cadeaux</a></nav></header>
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


def product_card(p):
    return (f'<a class="card" href="/prix/{e(p["id"])}.html">{visual(p)}<div class="c"><small>{e(p["category_label"])} · {p["offer_count"]} marchands suivis</small>'
            f'<b>{e(p["name"])}</b><small>Plus bas relevé historique</small><strong>{euro(p["min_price_eur"])}</strong><small>Dernier relevé : {date_fr(p["last_date"])}</small></div></a>')


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


def product_page(p, sheets, period):
    q = query_for(p)
    best = p["offers"][0]
    cheapest = [o for o in p["offers"] if o["price_eur"] == best["price_eur"]]
    cheapest_names = " et ".join(merchant_name(o["merchant"]) for o in cheapest[:2])
    gap = p["max_price_eur"] - p["min_price_eur"]
    rows = []
    for o in p["offers"]:
        url, label, aff = merchant_link(o["merchant"], q)
        rel = "sponsored nofollow noopener" if aff else "nofollow noopener"
        cls = ' class="best"' if o["price_eur"] == best["price_eur"] else ""
        rows.append(f'<tr{cls}><td><b>{e(merchant_name(o["merchant"]))}</b></td><td class="p">{euro(o["price_eur"])}</td>'
                    f'<td class="h">{date_fr(o["date"])}</td><td><a class="go" href="{e(url)}" target="_blank" rel="{rel}">{label}</a></td></tr>')
    similar = [s for s in sheets if s["category"] == p["category"] and s["id"] != p["id"]][:8]
    cat_slug = CATEGORY_SLUGS.get(p["category"], "high-tech")
    price = euro(p['min_price_eur'])
    last_date = date_fr(p.get("last_date") or best["date"])
    title = fit_title(f"{p['name']} : dernier relevé {price} | Prix Malin",
                      f"Historique des prix de {p['name']} | Prix Malin",
                      f"Historique {p['name']}")
    description = fit_description(f"Dernier relevé historique du {last_date} : {price} chez {cheapest_names}. "
                                  f"Données PrixTracker passées, pas un prix en direct ; vérifiez le marchand.")
    faq = [
        (f"Quel est le dernier prix observé pour {p['name']} ?",
         f"Au relevé du {date_fr(best['date'])}, le plus bas montant observé pour {p['name']} était de {euro(best['price_eur'])} chez {cheapest_names}. "
         "C’est une observation historique, pas un prix actuel garanti."),
        (f"Quel écart historique a été observé pour {p['name']} ?",
         f"Les relevés historiques vont de {euro(p['min_price_eur'])} à {euro(p['max_price_eur'])}, soit {euro(gap)} d’écart. "
         "Cet écart passé ne constitue pas une économie garantie aujourd’hui."),
        (f"Le prix de {p['name']} baisse-t-il ?", trend_sentence(p) or "L’historique disponible est encore trop court pour dégager une tendance."),
        ("D’où viennent ces prix ?",
         "Ce sont des relevés historiques publiés par PrixTracker sous licence ouverte (data.gouv.fr). Ils ne représentent pas des offres actuelles ; les liens ouvrent une recherche chez le marchand."),
    ]
    faq_html = "".join(f"<dt>{e(qq)}</dt><dd>{e(a)}</dd>" for qq, a in faq)
    faq_ld = {"@context": "https://schema.org", "@type": "FAQPage",
              "mainEntity": [{"@type": "Question", "name": qq, "acceptedAnswer": {"@type": "Answer", "text": a}} for qq, a in faq]}
    credit = ""
    if p.get("image_credit"):
        c = p["image_credit"]
        credit = f'<p class="source" style="color:#6b7280">Photo : {e(c.get("author") or "")} · {e(c.get("license") or "")} · <a style="color:#0b63ce" href="{e(c.get("file_page") or "")}">Wikimedia Commons</a></p>'
    body = f"""<article class="panel">
<div class="hero"><div><h1>Historique des prix de {e(p['name'])}</h1><div style="color:#5b6474;font-weight:700">{e(p['brand'])} · {e(p['category_label'])}</div>
<div class="from">Dernier prix observé le {date_fr(best['date'])}<strong>{euro(p['min_price_eur'])}</strong>chez {e(cheapest_names)} · relevé historique</div></div>{visual(p)}</div>
{credit}<a class="cta" href="#prix">Voir les relevés historiques</a>
<p class="notice">Historique PrixTracker : les montants ci-dessous sont des observations passées, pas des offres actuelles. Les liens ouvrent une recherche chez le marchand ; vérifiez la référence exacte, le prix final, la disponibilité et la livraison.</p>
</article>
<section class="panel" id="prix"><h2>Relevés historiques par marchand pour {e(p['name'])}</h2>
<p>L’historique contient <strong>{p['offer_count']} relevés marchands</strong>. Le plus bas relevé était de <strong>{euro(best['price_eur'])}</strong> chez {e(cheapest_names)} le {date_fr(best['date'])} ; le plus haut relevé atteint {euro(p['max_price_eur'])}. Cet écart est historique, pas une comparaison de prix actuels.</p>
<table><thead><tr><th>Marchand</th><th>Prix observé</th><th class="h">Date du relevé</th><th><span style="position:absolute;left:-9999px">Recherche</span></th></tr></thead><tbody>{''.join(rows)}</tbody></table>
<p class="source" style="color:#6b7280">Les liens ouvrent une recherche du produit chez le marchand, pas une offre produit garantie.</p>
</section>
<section class="panel"><h2>Évolution des prix relevés</h2>{chart_svg(p)}<p>{e(trend_sentence(p))}</p>
<a class="cta" style="background:#fff;color:#0b63ce;border:2px solid #0b63ce" href="/produit.html?id={e(p['id'])}#alerte">Créer une alerte prix gratuite</a></section>
<section class="panel"><h2>Questions fréquentes</h2><dl>{faq_html}</dl></section>
{f'<section class="panel"><h2>Autres {e(p["category_label"].lower())} comparés</h2><div class="grid">{"".join(product_card(s) for s in similar)}</div><p><a href="/prix/{cat_slug}.html">Tous les {e(p["category_label"].lower())} →</a></p></section>' if similar else ''}
<p class="source">À lire : <a href="/guide-black-friday-2026.html">repérer les vraies bonnes affaires</a> · <a href="/guide-payer-moins-cher-en-ligne.html">10 astuces pour payer moins cher</a> · <a href="/guides.html">tous nos guides</a></p>
<p class="source">Source : relevés historiques PrixTracker via <a href="https://www.data.gouv.fr/datasets/releves-quotidiens-de-prix-de-produits-high-tech-en-france-prixtracker" rel="noopener">data.gouv.fr</a>, Licence Ouverte 2.0. Ces montants ne sont pas des prix en direct. Prix Malin peut percevoir une commission sur les liens affiliés, sans surcoût pour vous.</p>
{ART_SCRIPT}"""
    crumbs = [("Accueil", "/"), ("Historique des prix", "/prix/"), (p["category_label"], f"/prix/{cat_slug}.html"), (p["name"], f"/prix/{p['id']}.html")]
    extra = f'<script type="application/ld+json">{json.dumps(faq_ld, ensure_ascii=False)}</script>\n'
    return layout(title, description, f"/prix/{p['id']}.html", body, crumbs, extra)


def category_page(cat, label, items):
    slug = CATEGORY_SLUGS.get(cat, cat)
    cheapest = min(items, key=lambda s: s["min_price_eur"])
    title = fit_title(f"Historique des prix {label.lower()} | Prix Malin",
                      f"Historique des prix {label.lower()}", f"{label} : historique des prix")
    description = fit_description(f"{len(items)} produits {label.lower()} avec relevés historiques PrixTracker chez jusqu’à "
                                  f"{max(s['offer_count'] for s in items)} marchands. Données datées, pas des offres en direct.")
    guide = {"smartphone": ("/guide-choisir-smartphone.html", "Comment choisir un smartphone sans payer trop cher"),
             "audio": ("/guide-ecouteurs-sans-fil-petit-prix.html", "Bien choisir des écouteurs sans fil à petit prix"),
             "enceinte": ("/guide-ecouteurs-sans-fil-petit-prix.html", "Guide audio : écouteurs et enceintes"),
             "aspirateur": ("/guide-choisir-aspirateur-robot.html", "Comment choisir un aspirateur robot")}.get(cat, ("/guide-black-friday-2026.html", "Black Friday 2026 : repérer les vraies bonnes affaires"))
    body = f"""<section class="panel"><p style="margin:0 0 10px">📘 Notre guide : <a href="{guide[0]}">{e(guide[1])}</a> · <a href="/guides.html">tous les guides</a></p><h1>Historique des prix : {e(label)}</h1>
<p>{len(items)} produits avec relevés historiques PrixTracker. Les montants affichés sont des observations passées, pas des offres actuelles ni des prix en temps réel.</p>
<div class="grid">{''.join(product_card(s) for s in items)}</div></section>
<p class="source">Source : PrixTracker via data.gouv.fr, Licence Ouverte 2.0. Relevés historiques à vérifier chez le marchand ; aucune disponibilité ou livraison actuelle n’est garantie.</p>{ART_SCRIPT}"""
    return slug, layout(title, description, f"/prix/{slug}.html", body, [("Accueil", "/"), ("Historique des prix", "/prix/"), (label, f"/prix/{slug}.html")])


def index_page(groups, total):
    sections = "".join(
        f'<section class="panel"><h2><a href="/prix/{CATEGORY_SLUGS.get(cat, cat)}.html" style="color:inherit">{e(label)}</a></h2>'
        f'<div class="grid">{"".join(product_card(s) for s in items[:8])}</div>'
        f'<p><a href="/prix/{CATEGORY_SLUGS.get(cat, cat)}.html">Voir les {len(items)} {e(label.lower())} →</a></p></section>'
        for cat, label, items in groups)
    body = f"""<section class="panel"><h1>Historique des prix high-tech</h1>
<p>{total} produits avec relevés historiques PrixTracker chez plusieurs marchands : smartphones, consoles, écouteurs, tablettes, ordinateurs, montres connectées, enceintes et aspirateurs. Ces montants sont des observations passées, pas des offres en direct.</p></section>{sections}{ART_SCRIPT}"""
    return layout("Historique des prix high-tech | Prix Malin",
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
    return (f'<a class="card" href="{e(p["url"])}" target="_blank" rel="sponsored nofollow noopener"><div class="visual"><img src="{e(p["image"])}" alt="{e(p["name"])}" loading="lazy"></div>'
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
<div class="grid">{''.join(gift_card(p) for p in items)}</div></section>
<p class="source">Offres issues des flux marchands autorisés ; chaque prix affiché est daté et déclaré TTC. Liens affiliés : Prix Malin peut percevoir une commission, sans surcoût pour vous.</p>"""
    return layout(fit_title(f"{label} : prix TTC vérifiés | Prix Malin", f"{label} | Prix Malin", label),
                  fit_description(f"{label} : {len(items)} produits avec prix TTC confirmé et date marchande de moins de 48 h. À vérifier chez le marchand."),
                  f"/idees-cadeaux/{slug}.html", body, [("Accueil", "/"), ("Idées cadeaux", "/idees-cadeaux/"), (label, f"/idees-cadeaux/{slug}.html")])


def gift_index(budgets_with_items):
    sections = "".join(
        f'<section class="panel"><h2><a style="color:inherit" href="/idees-cadeaux/{s}.html">{e(l)}</a></h2><div class="grid">{"".join(gift_card(p) for p in items[:6])}</div>'
        f'<p><a href="/idees-cadeaux/{s}.html">Voir les {len(items)} idées →</a></p></section>'
        for s, l, _, _, items in budgets_with_items if items
    )
    empty = "" if sections else (
        '<p class="notice">Aucune offre avec prix TTC confirmé et date marchande de moins de 48 h n’est disponible actuellement. '
        'Les prix incomplets ou périmés sont masqués. Consultez le catalogue pour découvrir les produits sans prix affiché.</p>'
    )
    body = f"""<section class="panel"><h1>Idées cadeaux de Noël par budget</h1>
<p>Les prix ne sont affichés que lorsque le flux marchand confirme le TTC et fournit une date marchande récente. Les montants peuvent évoluer ; vérifiez le prix final et la livraison avant achat.</p>{empty}</section>{sections}"""
    return layout("Idées cadeaux de Noël | Prix Malin",
                  "Sélection de cadeaux issue de flux marchands autorisés. Les prix sont masqués si la date marchande récente ou le statut TTC ne sont pas confirmés.",
                  "/idees-cadeaux/", body, [("Accueil", "/"), ("Idées cadeaux", "/idees-cadeaux/")])



def build():
    sheets_data = json.loads(SHEETS.read_text(encoding="utf-8"))
    sheets = sheets_data["products"]
    period = sheets_data["dataset_period"]
    deals = json.loads(DEALS.read_text(encoding="utf-8")) if DEALS.exists() else {"gifts": []}
    files = {}
    for p in sheets:
        files[f"prix/{p['id']}.html"] = product_page(p, sheets, period)
    groups = []
    for cat in dict.fromkeys(s["category"] for s in sheets):
        items = [s for s in sheets if s["category"] == cat]
        label = items[0]["category_label"]
        slug, page = category_page(cat, label, items)
        files[f"prix/{slug}.html"] = page
        groups.append((cat, label, items))
    files["prix/index.html"] = index_page(groups, len(sheets))
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

#!/usr/bin/env python3
"""Vitrine du haut de la page d'accueil (style de la maquette du propriétaire), générée à partir
des vraies données du site.

- Aucun prix ni remise inventés : chaque montant vient d'un relevé PrixTracker daté
  (data/fiches-produits.json) et est affiché avec sa date et son marchand.
- Photos : uniquement des images déjà autorisées sur le site (photos libres de droits créditées,
  photos des flux marchands autorisés, mascotte du propriétaire).
- Le bloc est inséré dans index.html entre les marqueurs <!-- pm-showcase --> et
  <!-- /pm-showcase --> ; --check vérifie qu'il est à jour.
"""
import argparse
import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_seo_pages as seo  # noqa: E402  (noms de marchands, liens Amazon, formats)

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
START, END = "<!-- pm-showcase -->", "<!-- /pm-showcase -->"
ANCHOR = '<main class="wrap" id="main-content" tabindex="-1">'
e = lambda s: html.escape(str(s), quote=True)

TOP_IDS = ["airpods-4", "manette-switch-pro", "macbook-air-13-m5", "playstation-vr2", "iphone-17", "switch"]
COMPARE_ID = "airpods-4"


def first_image(items, category, prefix=("https://",)):
    for p in sorted(items, key=lambda x: str(x.get("id"))):
        img = str(p.get("image") or "")
        if p.get("category") == category and img.startswith(prefix):
            return img
    return ""


def categories():
    return [
        ("Idées<br>cadeaux", "/idees-cadeaux/", "idees-cadeaux"),
        ("High-Tech<br>& Multimédia", "/high-tech.html", "high-tech"),
        ("Maison<br>& Déco", "/maison-deco.html", "maison-deco"),
        ("Beauté<br>& Santé", "/catalogue.html?cat=beauty", "beaute-sante"),
        ("Mode<br>& Accessoires", "/mode.html", "mode"),
        ("Sport<br>& Loisirs", "/catalogue.html?cat=sport", "sport-loisirs"),
        ("Bébé<br>& Enfant", "/catalogue.html?cat=kids", "bebe-enfant"),
        ("Auto<br>& Moto", "/catalogue.html?cat=auto", "auto-moto"),
        ("Bricolage<br>& Jardin", "/catalogue.html?q=bricolage", "bricolage-jardin"),
        ("Électroménager", "/catalogue.html?q=%C3%A9lectrom%C3%A9nager", "electromenager"),
    ]


def offer_card(p):
    offers = p["offers"]
    best = offers[0]
    rows = "".join(
        f'<li class="{"b" if i == 0 else ""}"><span>{e(seo.merchant_name(o["merchant"]))}</span><b>{seo.euro(o["price_eur"])}</b></li>'
        for i, o in enumerate(offers[:3]))
    return (f'<article class="pmx-card"><span class="pmx-badge">{p["offer_count"]} marchands</span>'
            f'<a class="pmx-ph" href="/prix/{e(p["id"])}.html"><img src="{e(p["image"])}" alt="{e(p["name"])}" loading="lazy" decoding="async"></a>'
            f'<h3>{e(p["name"])}</h3><small>Plus bas prix relevé</small><strong>{seo.euro(best["price_eur"])}</strong>'
            f'<small>chez {e(seo.merchant_name(best["merchant"]))} · le {seo.date_fr(best["date"])}</small>'
            f'<span class="pmx-gap" title="Écart entre le plus bas et le plus haut prix relevés">Écart relevé : {seo.euro(p["max_price_eur"] - p["min_price_eur"])}</span>'
            f'<ul>{rows}</ul><a class="pmx-go" href="/prix/{e(p["id"])}.html">Comparer les prix →</a></article>')


def sparkline(p):
    hist = p.get("history") or []
    if len(hist) < 2:
        return ""
    ys = [h["min_price_eur"] for h in hist]
    lo, hi = min(ys), max(ys)
    span = (hi - lo) or 1
    pts = " ".join(f"{6 + i * 228 / (len(ys) - 1):.1f},{58 - (y - lo) * 46 / span:.1f}" for i, y in enumerate(ys))
    return (f'<svg viewBox="0 0 240 64" role="img" aria-label="Évolution du plus bas prix relevé">'
            f'<polyline points="{pts}" fill="none" stroke="#ffb02e" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>')


def compare_block(p):
    best = p["offers"][0]
    rows = "".join(
        f'<li><span class="m">{e(seo.merchant_name(o["merchant"]))}</span>'
        f'{"<em>Plus bas relevé</em>" if i == 0 else "<em class=\"x\"></em>"}'
        f'<b>{seo.euro(o["price_eur"])}</b><small>{seo.date_fr(o["date"])}</small>'
        f'<a href="/prix/{e(p["id"])}.html">Comparer →</a></li>'
        for i, o in enumerate(p["offers"][:4]))
    gap = p["max_price_eur"] - p["min_price_eur"]
    return f"""<section class="pmx-sec pmx-compare" aria-labelledby="pmx-compare-t">
<div class="pmx-head"><h2 id="pmx-compare-t">📊 Comparatif de prix <span>relevés</span></h2><small>Un exemple réel : prix relevés et datés, à confirmer chez le marchand</small></div>
<div class="pmx-cmp"><div class="pmx-cmp-p"><img src="{e(p["image"])}" alt="{e(p["name"])}" loading="lazy"><div><h3>{e(p["name"])}</h3><small>{p["offer_count"]} marchands suivis</small><a class="pmx-btn" href="/prix/{e(p["id"])}.html">Voir tous les relevés</a></div></div>
<ul class="pmx-cmp-l">{rows}</ul>
<div class="pmx-cmp-g"><small>Écart entre marchands</small><strong>{seo.euro(gap)}</strong><small>entre le plus bas et le plus haut relevé</small>{sparkline(p)}<small>Plus bas relevé : {seo.euro(best["price_eur"])} le {seo.date_fr(best["date"])}</small></div></div>
</section>"""


CSS = """<style id="pm-showcase-style">
.hero-reference,.pm-benefits-banner,.pm-bf-banner{display:none!important}
.pmx{--o:#ff650b;--o2:#ff8a2b;--card:#121a26;--line:#263142;--mut:#9aa6b8;color:#fff;margin:6px 0 4px}
.pmx-hero{position:relative;min-height:330px;border-radius:18px;overflow:hidden;background:#0b0e14;border:1px solid var(--line);display:flex;flex-direction:column;justify-content:space-between}
.pmx-hero-img{position:absolute;right:0;top:0;height:100%;width:68%;object-fit:cover;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 30%);mask-image:linear-gradient(90deg,transparent 0,#000 30%)}
.pmx-hero-txt{position:relative;padding:30px 28px 10px;max-width:560px}
.pmx-hero .t{font:900 clamp(30px,4.4vw,50px)/1.04 Inter,system-ui,sans-serif;letter-spacing:-1.5px;margin:0;text-shadow:0 2px 18px #000a}
.pmx-hero .t span{color:var(--o)}
.pmx-hero-txt p:not(.t){color:#e5e9f0;font-size:clamp(14px,1.5vw,17px);margin:12px 0 18px;line-height:1.45;text-shadow:0 1px 10px #000}
.pmx-cta{display:flex;gap:10px;flex-wrap:wrap}
.pmx-btn{display:inline-flex;align-items:center;min-height:46px;padding:0 20px;border-radius:10px;background:linear-gradient(100deg,var(--o2),var(--o));color:#fff!important;font-weight:850;text-decoration:none}
.pmx-btn.ghost{background:#000a;border:1px solid #ffffff44}
.pmx-trust{position:relative;display:flex;flex-wrap:wrap;gap:10px 26px;padding:12px 28px 18px;color:#e5e9f0;font-size:12.5px;font-weight:700;line-height:1.2}
.pmx-trust span{display:flex;align-items:center;gap:8px;text-shadow:0 1px 8px #000}
.pmx-trust i{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;border:2px solid #fff;font-style:normal;font-size:15px}
.pmx-sec{margin:22px 0 6px}
.pmx-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.pmx-head h2{margin:0;font:900 clamp(21px,2.4vw,28px)/1.15 Inter,system-ui,sans-serif;letter-spacing:-.6px;color:#fff}
.pmx-head h2 span{color:var(--o)}.pmx-head small{color:var(--mut);font-size:13px;width:100%}
.pmx-head a{color:var(--o2);font-weight:800;text-decoration:none;font-size:14px}
.pmx-rail{display:grid;grid-auto-flow:column;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:6px;-webkit-overflow-scrolling:touch}
.pmx-cats{grid-auto-columns:minmax(96px,1fr);gap:8px}
.pmx-cat{display:flex;flex-direction:column;border-radius:12px;overflow:hidden;scroll-snap-align:start;border:1px solid var(--line);background:#141b27;text-decoration:none}
.pmx-cat img{width:100%;aspect-ratio:4/5;object-fit:cover;transition:transform .3s}
.pmx-cat:hover img{transform:scale(1.05)}
.pmx-cat b{display:flex;align-items:center;justify-content:center;min-height:38px;padding:5px 4px;color:#fff;font-size:12.5px;line-height:1.15;text-align:center;font-weight:700}
.pmx-offers{grid-auto-columns:minmax(200px,1fr)}
.pmx-card{position:relative;display:flex;flex-direction:column;gap:3px;padding:10px;border-radius:16px;background:var(--card);border:1px solid var(--line);scroll-snap-align:start}
.pmx-badge{position:absolute;top:16px;left:16px;z-index:1;padding:4px 9px;border-radius:8px;background:#e5261e;font-size:12px;font-weight:900}
.pmx-gap{align-self:stretch;margin:4px 0 2px;padding:5px 8px;border-radius:8px;background:#16a34a;color:#fff;font-size:12px;font-weight:850;text-align:center}
.pmx-ph{display:block;aspect-ratio:1;border-radius:12px;overflow:hidden;background:#fff;margin-bottom:6px}
.pmx-ph img{width:100%;height:100%;object-fit:cover}
.pmx-card h3{margin:0;font-size:15px;line-height:1.25;color:#fff}
.pmx-card small{color:var(--mut);font-size:12px}
.pmx-card strong{color:#ff3b30;font-size:26px;font-weight:900;line-height:1.05}
.pmx-card ul,.pmx-cmp-l{list-style:none;margin:6px 0;padding:0}
.pmx-card li{display:flex;justify-content:space-between;gap:8px;padding:5px 2px;border-top:1px solid var(--line);font-size:13px;color:#dbe3ee}
.pmx-card li.b b{color:#ff3b30}
.pmx-go{margin-top:auto;display:flex;justify-content:center;align-items:center;min-height:40px;border-radius:10px;background:linear-gradient(100deg,var(--o2),var(--o));color:#fff!important;font-weight:850;text-decoration:none;font-size:14px}
.pmx-ban{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.pmx-b{position:relative;display:flex;flex-direction:column;justify-content:center;min-height:150px;padding:16px 18px;border-radius:14px;overflow:hidden;text-decoration:none;color:#fff;border:1px solid var(--line)}
.pmx-b.c1{background:linear-gradient(110deg,#5a1030,#2a0a18)}.pmx-b.c2{background:linear-gradient(110deg,#0f2550,#0a1430)}.pmx-b.c3{background:linear-gradient(110deg,#4a2a12,#24140a)}
.pmx-b img{position:absolute;right:0;top:0;width:52%;height:100%;object-fit:cover;-webkit-mask-image:linear-gradient(90deg,transparent,#000 35%);mask-image:linear-gradient(90deg,transparent,#000 35%)}
.pmx-b b,.pmx-b small,.pmx-b span{position:relative}
.pmx-b b{font-size:21px;font-weight:900}.pmx-b small{color:#e5e9f0;max-width:58%;margin:3px 0 12px;font-size:13px}
.pmx-b span{align-self:flex-start;padding:9px 14px;border-radius:9px;background:var(--o);font-weight:850;font-size:13px}
.pmx-cmp{display:grid;grid-template-columns:1fr 1.5fr .9fr;gap:12px;align-items:stretch}
.pmx-cmp>*{border-radius:16px;background:var(--card);border:1px solid var(--line);padding:14px}
.pmx-cmp-p{display:flex;gap:12px;align-items:center}.pmx-cmp-p img{width:120px;height:120px;border-radius:12px;object-fit:cover;background:#fff}
.pmx-cmp-p h3{margin:0 0 4px;font-size:17px}.pmx-cmp-p small{color:var(--mut);display:block;margin-bottom:10px}
.pmx-cmp-l li{display:grid;grid-template-columns:1fr auto auto auto auto;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:14px}
.pmx-cmp-l li:first-child{border-top:0}.pmx-cmp-l .m{font-weight:800}.pmx-cmp-l em{font-style:normal;font-size:11px;font-weight:900;padding:3px 8px;border-radius:7px;background:#16a34a}
.pmx-cmp-l em.x{background:none;padding:0}.pmx-cmp-l b{color:#ff7a1a}.pmx-cmp-l small{color:var(--mut)}
.pmx-cmp-l a{padding:7px 10px;border-radius:9px;background:var(--o);color:#fff;font-weight:800;font-size:12px;text-decoration:none}
.pmx-cmp-g{display:flex;flex-direction:column;gap:4px}.pmx-cmp-g strong{font-size:30px;color:#22c55e;font-weight:900}.pmx-cmp-g small{color:var(--mut);font-size:12px}
.pmx-note{color:var(--mut);font-size:12px;margin:8px 2px 0}
@media(max-width:860px){.pmx-hero{min-height:0}.pmx-hero-img{position:relative;width:100%;height:auto;aspect-ratio:987/541;order:2;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 28%);mask-image:linear-gradient(180deg,transparent 0,#000 28%);margin-top:-30px}
 .pmx-hero-txt{order:1;padding:20px 16px 0}.pmx-trust{order:3;padding:10px 16px 14px;gap:8px 14px;font-size:11.5px}.pmx-trust i{width:26px;height:26px;font-size:13px}
 .pmx-ban{grid-template-columns:1fr;gap:8px}.pmx-b{min-height:112px;padding:14px}.pmx-b b{font-size:18px}
 .pmx-cmp{grid-template-columns:1fr}.pmx-cmp-p img{width:84px;height:84px}
 .pmx-cmp-l li{grid-template-columns:1fr auto auto;gap:8px}.pmx-cmp-l small,.pmx-cmp-l em{display:none}
 .pmx-offers{grid-auto-columns:47%;gap:8px}.pmx-card{padding:8px}.pmx-badge{top:12px;left:12px;font-size:11px}
 .pmx-card h3{font-size:13.5px}.pmx-card strong{font-size:21px}.pmx-card li{font-size:12px;padding:4px 1px}.pmx-gap{font-size:11px;padding:4px 6px}.pmx-go{min-height:36px;font-size:13px}
 .pmx-cats{grid-auto-columns:23%;gap:6px}.pmx-cat b{font-size:11px;min-height:34px}}
@media(max-width:860px) and (min-width:520px){.pmx-offers{grid-auto-columns:31%}.pmx-cats{grid-auto-columns:18%}}
</style>"""


def build_block():
    sheets = {p["id"]: p for p in json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]}
    top = [sheets[i] for i in TOP_IDS if i in sheets and sheets[i].get("image")]
    cats = "".join(
        f'<a class="pmx-cat" href="{e(url)}"><img src="/assets/accueil/cat-{slug}.webp" alt="" loading="lazy" decoding="async"><b>{name}</b></a>'
        for name, url, slug in categories())
    latest = max(p["last_date"] for p in top)
    hero = """<section class="pmx-hero" aria-label="Prix Malin">
<img class="pmx-hero-img" src="/assets/accueil/hero.webp" alt="" fetchpriority="high">
<div class="pmx-hero-txt"><p class="t">Les meilleurs prix<br><span>au même endroit !</span></p>
<p>Comparez, économisez et trouvez les meilleures offres sur vos produits préférés, avec la date de chaque prix relevé.</p>
<div class="pmx-cta"><a class="pmx-btn" href="/prix/">Voir toutes les offres →</a><a class="pmx-btn ghost" href="/black-friday.html">Black Friday · 27 nov.</a></div></div>
<div class="pmx-trust"><span><i>⌕</i>Comparateur<br>de prix</span><span><i>€</i>Prix datés<br>et sourcés</span><span><i>✓</i>Sources<br>vérifiables</span><span><i>♥</i>100 % gratuit<br>sans inscription</span></div>
</section>"""
    body = f"""{START}
{CSS}
<div class="pmx">
{hero}
<section class="pmx-sec" aria-labelledby="pmx-cats-t"><div class="pmx-head"><h2 id="pmx-cats-t">Nos grandes <span>catégories</span></h2><a href="/catalogue.html">Voir tout le catalogue →</a></div>
<div class="pmx-rail pmx-cats">{cats}</div></section>
<section class="pmx-sec" aria-labelledby="pmx-top-t"><div class="pmx-head"><h2 id="pmx-top-t">🔥 Top offres <span>relevées</span></h2><a href="/prix/">Tout le comparateur →</a><small>Les produits les plus suivis, avec le plus bas prix relevé et les marchands les moins chers (dernier relevé : {seo.date_fr(latest)})</small></div>
<div class="pmx-rail pmx-offers">{"".join(offer_card(p) for p in top)}</div></section>
<section class="pmx-sec pmx-ban" aria-label="Sélections">
<a class="pmx-b c1" href="/idees-cadeaux/"><img src="/assets/accueil/ban-cadeaux.webp" alt="" loading="lazy"><b>Idées cadeaux</b><small>Pour toutes les occasions</small><span>Découvrir la sélection →</span></a>
<a class="pmx-b c2" href="/high-tech.html"><img src="/assets/accueil/ban-high-tech.webp" alt="" loading="lazy"><b>High-Tech</b><small>Les dernières nouveautés, prix comparés</small><span>Voir les offres →</span></a>
<a class="pmx-b c3" href="/maison-deco.html"><img src="/assets/accueil/ban-maison.webp" alt="" loading="lazy"><b>Maison &amp; Déco</b><small>Des idées pour un intérieur qui vous ressemble</small><span>Voir la sélection →</span></a>
</section>
{compare_block(sheets[COMPARE_ID])}
<p class="pmx-note">Prix relevés et datés (relevés PrixTracker, data.gouv.fr, Licence Ouverte 2.0), pas des offres en direct : vérifiez le prix final chez le marchand. Visuels Prix Malin et photos libres créditées. Certains liens sont affiliés.</p>
</div>
{END}"""
    return body


def render(text, block):
    if START in text:
        a, b = text.index(START), text.index(END) + len(END)
        return text[:a] + block + text[b:]
    assert text.count(ANCHOR) == 1, "ancre <main> introuvable"
    return text.replace(ANCHOR, ANCHOR + "\n" + block, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    text = INDEX.read_text(encoding="utf-8")
    new = render(text, build_block())
    if args.check:
        if new != text:
            print("index.html : vitrine à régénérer (python3 scripts/build_home_showcase.py)", file=sys.stderr)
            return 1
        return 0
    INDEX.write_text(new, encoding="utf-8")
    print("vitrine écrite dans index.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())

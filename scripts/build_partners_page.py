#!/usr/bin/env python3
"""Page /boutiques-partenaires.html : codes promo partenaires et vitrines de petites boutiques.

Données : data/boutiques-partenaires.json, saisies uniquement avec l'accord du commerçant
ou depuis les plateformes d'affiliation (Awin, Rakuten). Rien n'est inventé :
- un code doit avoir une réduction, des conditions et une date de fin ;
- un code expiré n'est pas publié (et il est masqué côté navigateur dès sa date de fin) ;
- les produits d'une boutique n'affichent un prix que s'il est fourni par le commerçant, daté.

Format d'un code :
  {"marchand": "Decathlon", "code": "MALIN10", "reduction": "-10 %", "conditions": "dès 50 € d'achat",
   "fin": "2026-12-31", "url": "https://…lien affilié…", "exclusif": false}
Format d'une boutique :
  {"id": "nom-boutique", "nom": "…", "description": "…", "ville": "…", "code": "MALIN-XXX",
   "reduction": "-10 %", "commander": "https://… (site, WhatsApp, Snapchat)", "siret": true,
   "produits": [{"nom": "…", "image": "/assets/…", "prix_eur": 20.0, "prix_date": "2026-11-09"}]}

  python3 scripts/build_partners_page.py          # écrit la page
  python3 scripts/build_partners_page.py --check  # vérifie qu'elle est à jour
"""
import argparse
import html
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_seo_pages as seo  # noqa: E402  (mise en page commune, en-tête, pied de page, consentement)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "boutiques-partenaires.json"
OUT = ROOT / "boutiques-partenaires.html"
e = lambda s: html.escape(str(s), quote=True)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate(data):
    errors = []
    for i, c in enumerate(data.get("codes", [])):
        for k in ("marchand", "code", "reduction", "conditions", "fin", "url"):
            if not str(c.get(k) or "").strip():
                errors.append(f"code {i}: champ « {k} » manquant")
        if c.get("fin") and not DATE_RE.match(str(c["fin"])):
            errors.append(f"code {i}: date de fin au format AAAA-MM-JJ attendue")
        if c.get("url") and not str(c["url"]).startswith("https://"):
            errors.append(f"code {i}: lien https:// attendu")
    for i, b in enumerate(data.get("boutiques", [])):
        for k in ("id", "nom", "description", "commander"):
            if not str(b.get(k) or "").strip():
                errors.append(f"boutique {i}: champ « {k} » manquant")
        if b.get("siret") is not True:
            errors.append(f"boutique {i}: SIRET non confirmé (boutique professionnelle requise)")
        for j, p in enumerate(b.get("produits", [])):
            if p.get("prix_eur") is not None and not DATE_RE.match(str(p.get("prix_date") or "")):
                errors.append(f"boutique {i} produit {j}: un prix doit être daté (prix_date)")
    if errors:
        raise ValueError("data/boutiques-partenaires.json invalide :\n- " + "\n- ".join(errors))


def code_card(c):
    excl = '<span class="bp-ex">Exclusif Prix Malin</span>' if c.get("exclusif") is True else ""
    return (f'<article class="bp-code" data-fin="{e(c["fin"])}">{excl}<small>{e(c["marchand"])}</small>'
            f'<strong>{e(c["reduction"])}</strong><p>{e(c["conditions"])}</p>'
            f'<div class="bp-copy"><code>{e(c["code"])}</code><button type="button" data-code="{e(c["code"])}">Copier</button></div>'
            f'<a class="bp-go" href="{e(c["url"])}" target="_blank" rel="sponsored nofollow noopener">Aller sur le site ↗</a>'
            f'<small>Valable jusqu’au {seo.date_fr(c["fin"])}</small></article>')


def shop_card(b):
    prods = "".join(
        f'<li><img src="{e(p["image"])}" alt="{e(p["nom"])}" loading="lazy"><b>{e(p["nom"])}</b>'
        + (f'<span>{seo.euro(p["prix_eur"])} · prix du {seo.date_fr(p["prix_date"])}</span>' if p.get("prix_eur") is not None else "")
        + "</li>" for p in b.get("produits", []) if p.get("image"))
    code = (f'<div class="bp-copy"><code>{e(b["code"])}</code><button type="button" data-code="{e(b["code"])}">Copier</button></div>'
            f'<small>{e(b.get("reduction") or "")} avec ce code, à donner au commerçant lors de la commande</small>') if b.get("code") else ""
    return (f'<article class="bp-shop" id="{e(b["id"])}"><h3>{e(b["nom"])}</h3><small>{e(b.get("ville") or "")}</small>'
            f'<p>{e(b["description"])}</p><ul class="bp-prods">{prods}</ul>{code}'
            f'<a class="bp-go" href="{e(b["commander"])}" target="_blank" rel="sponsored nofollow noopener">Commander chez {e(b["nom"])} ↗</a></article>')


CSS = """<style>
.bp-hero{background:linear-gradient(120deg,#111827,#1f2937);color:#fff;border-radius:16px;padding:20px 18px;margin-bottom:12px}
.bp-hero h1{color:#fff}.bp-hero p{color:#dbe3ee;margin:8px 0 0}
.bp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.bp-code,.bp-shop{display:flex;flex-direction:column;gap:6px;border:2px dashed #ffb27a;border-radius:16px;padding:14px;background:#fffaf6}
.bp-shop{border-style:solid;border-color:#e3e7ee;background:#fff}
.bp-code strong{font-size:30px;color:#f05a00;line-height:1.1}.bp-code small,.bp-shop small{color:#6b7280}
.bp-ex{align-self:flex-start;padding:3px 8px;border-radius:7px;background:#111827;color:#fff;font-size:12px;font-weight:800}
.bp-copy{display:flex;gap:6px;align-items:center}.bp-copy code{flex:1;padding:9px;border-radius:9px;background:#fff;border:1px solid #e3e7ee;font-weight:900;font-size:17px;letter-spacing:1px;text-align:center}
.bp-copy button{min-height:40px;padding:0 14px;border:0;border-radius:9px;background:#111827;color:#fff;font-weight:800;cursor:pointer}
.bp-go{display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:10px;background:#f05a00;color:#fff!important;font-weight:850;text-decoration:none}
.bp-prods{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:8px}.bp-prods li{display:flex;flex-direction:column;gap:2px;font-size:13px}
.bp-prods img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#f3f4f6}
.bp-empty{padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e3e7ee;color:#374151}
.bp-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}.bp-steps div{padding:12px;border-radius:12px;background:#fff7f0;border:1px solid #ffd7ad}
.bp-steps b{display:block;font-size:18px;margin-bottom:4px}
.bp-contact{display:flex;flex-wrap:wrap;gap:14px;align-items:center}.bp-contact img{width:180px;border-radius:12px;border:1px solid #e3e7ee}
.bp-mail{font-size:clamp(17px,4.4vw,22px);font-weight:900;word-break:break-all}
@media(max-width:640px){.bp-steps{grid-template-columns:1fr}}
</style>"""
SCRIPT = """<script>(function(){var t=new Date().toISOString().slice(0,10);
document.querySelectorAll(".bp-code[data-fin]").forEach(function(c){if(c.dataset.fin<t)c.remove();});
document.querySelectorAll("[data-code]").forEach(function(b){b.addEventListener("click",function(){var v=b.dataset.code;
function ok(){b.textContent="Copié !";setTimeout(function(){b.textContent="Copier";},1800);}
if(navigator.clipboard)navigator.clipboard.writeText(v).then(ok,ok);else ok();});});})();</script>"""


def build(today=None):
    today = today or date.today().isoformat()
    data = json.loads(DATA.read_text(encoding="utf-8"))
    validate(data)
    mail = data["contact_email"]
    codes = sorted((c for c in data.get("codes", []) if c["fin"] >= today), key=lambda c: c["fin"])
    shops = data.get("boutiques", [])
    codes_html = (f'<div class="bp-grid">{"".join(code_card(c) for c in codes)}</div>' if codes else
                  '<p class="bp-empty">Les premiers codes promo partenaires arrivent bientôt. Nous n’affichons que des codes '
                  'fournis par les marchands eux-mêmes, avec leurs conditions et leur date de fin.</p>')
    shops_html = (f'<div class="bp-grid">{"".join(shop_card(b) for b in shops)}</div>' if shops else
                  '<p class="bp-empty">Les premières boutiques partenaires arrivent bientôt : artisans, créateurs et petits '
                  'commerçants sélectionnés, avec un code promo réservé aux visiteurs de Prix Malin.</p>')
    body = f"""<section class="bp-hero"><h1>Boutiques partenaires &amp; codes promo</h1>
<p>Des petites boutiques sélectionnées et des codes promo obtenus auprès des marchands : grâce à Prix Malin, vous payez moins cher. Chaque code indique ses conditions et sa date de fin.</p></section>
<section class="panel" id="codes"><h2>Codes promo partenaires</h2>{codes_html}</section>
<section class="panel" id="boutiques"><h2>Boutiques partenaires</h2>{shops_html}</section>
<section class="panel" id="devenir-partenaire"><h2>Commerçant, artisan, créateur ? Devenez boutique partenaire</h2>
<p>Prix Malin met vos produits en avant sur prixbasmalin.fr et sur ses réseaux (TikTok, Instagram, Snapchat). Vous ne payez rien pour être présent : une commission, convenue ensemble, n’est due que sur les ventes que nous vous apportons.</p>
<div class="bp-steps"><div><b>1. Votre vitrine</b>Vos produits, vos photos et vos prix sur une page à votre nom.</div>
<div><b>2. Un code promo</b>Un code réservé aux visiteurs de Prix Malin : ils paient moins cher chez vous.</div>
<div><b>3. Une commission</b>Uniquement sur les nouvelles ventes réalisées avec ce code. Sans abonnement ni engagement.</div></div>
<p>Conditions : boutique professionnelle (numéro SIRET), produits conformes à la réglementation française, aucune allégation de santé non autorisée.</p>
<div class="bp-contact"><a href="/assets/partenaires-commercants/fiche-boutique-partenaire.jpg"><img src="/assets/partenaires-commercants/fiche-boutique-partenaire.jpg" alt="Fiche « Vendez plus avec Prix Malin »" loading="lazy"></a>
<div><p>Écrivez-nous :</p><p class="bp-mail"><a href="mailto:{e(mail)}?subject=Boutique%20partenaire%20Prix%20Malin">{e(mail)}</a></p>
<p><a href="/assets/partenaires-commercants/fiche-boutique-partenaire.jpg">Voir la fiche de présentation</a></p></div></div></section>
<p class="source">Liens partenaires : Prix Malin peut percevoir une commission sur les ventes, sans surcoût pour vous. Les réductions et conditions sont celles fixées par chaque marchand.</p>
{SCRIPT}"""
    return seo.layout("Boutiques partenaires & codes promo | Prix Malin",
                      seo.fit_description("Codes promo partenaires et petites boutiques sélectionnées par Prix Malin, avec leurs conditions et leur date de fin. Commerçants : devenez partenaire."),
                      "/boutiques-partenaires.html", body,
                      [("Accueil", "/"), ("Boutiques partenaires & codes promo", "/boutiques-partenaires.html")], CSS + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    text = build()
    if args.check:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != text:
            print("boutiques-partenaires.html à régénérer", file=sys.stderr)
            return 1
        return 0
    OUT.write_text(text, encoding="utf-8")
    print("boutiques-partenaires.html écrite")
    return 0


if __name__ == "__main__":
    sys.exit(main())

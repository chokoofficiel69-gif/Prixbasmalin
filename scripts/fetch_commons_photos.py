#!/usr/bin/env python3
"""Cherche sur Wikimedia Commons une photo libre de droits pour chaque produit comparé.

Exécuté par GitHub Actions (.github/workflows/fetch-product-photos.yml), qui a accès à Internet.

Pour chaque produit de data/fiches-produits.json :
- recherche de fichiers image sur Commons (API officielle, sans scraping) ;
- garde uniquement les licences qui autorisent l'usage commercial et la modification
  (CC0, domaine public, CC BY, CC BY-SA ; jamais NC ni ND) ;
- exige que le nom du fichier contienne le modèle exact (tous les mots et chiffres du nom) ;
- écarte logos, boîtes, captures d'écran, conférences, schémas ;
- télécharge la vignette (800 px) dans assets/produits/<id>.jpg pour l'héberger sur le site ;
- écrit les propositions avec auteur, licence et page source dans data/product-images-proposals.json
  et une planche contact docs/photo-review/planche-N.png pour vérification humaine.

Les propositions ne sont PAS publiées : elles ne passent dans data/product-images.json
qu'après vérification visuelle de chaque photo.
"""
import html
import io
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = "https://commons.wikimedia.org/w/api.php"
UA = "PrixMalinPhotoBot/1.0 (https://prixbasmalin.fr/a-propos.html; photos libres avec credit)"
OUT_JSON = ROOT / "data" / "product-images-proposals.json"
OUT_DIR = ROOT / "assets" / "produits"
REVIEW_DIR = ROOT / "docs" / "photo-review"

ALLOWED = re.compile(r"^(cc0|public domain|pd|cc by(-sa)?( \d(\.\d)?)?( [a-z]{2,})?)$", re.I)
EXCLUDE = re.compile(
    r"logo|icon|icône|box|boîte|packag|emballage|screenshot|capture|keynote|wwdc|event|conference|presentation|"
    r"diagram|schema|chart|map|poster|affiche|store|magasin|shop|ad\b|advert|mockup|render|teardown|ifixit|"
    r"broken|cassé|repair|réparation|svg|\bunbox", re.I)
STOP = {"edition", "édition", "de", "du", "la", "le", "les", "et", "avec", "paire", "complete", "usb", "c", "digitale",
        "disque", "pouces", "manette", "reduction", "réduction", "bruit"}
ORDINALS = {"2": {"2", "2nd", "ii", "second"}, "3": {"3", "3rd", "iii", "third"}, "4": {"4", "4th", "iv", "fourth"},
            "5": {"5", "5th", "v", "fifth"}}


def norm(text):
    text = unicodedata.normalize("NFD", str(text)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def required_tokens(name):
    """Mots qui doivent figurer dans le nom du fichier : le modèle exact."""
    base = re.sub(r"\(.*?\)", " ", name)
    return [t for t in norm(base).split() if t not in STOP and len(t) > 0]


def title_matches(title, tokens):
    words = set(norm(title).split())
    for t in tokens:
        options = ORDINALS.get(t, {t})
        if not words & options:
            return False
    return True


def api(params):
    params = dict(params, format="json", formatversion="2")
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def clean_html(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(text or "")))).strip()


def candidates(query):
    data = api({"action": "query", "generator": "search", "gsrnamespace": 6, "gsrlimit": 25,
                "gsrsearch": f"{query} filetype:bitmap", "prop": "imageinfo",
                "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 800})
    for page in (data.get("query") or {}).get("pages", []):
        info = (page.get("imageinfo") or [{}])[0]
        meta = info.get("extmetadata") or {}
        yield {
            "title": page.get("title", ""),
            "thumb": info.get("thumburl"),
            "file_page": info.get("descriptionurl"),
            "mime": info.get("mime", ""),
            "width": info.get("width", 0),
            "license": clean_html((meta.get("LicenseShortName") or {}).get("value")),
            "author": clean_html((meta.get("Artist") or {}).get("value"))[:120],
            "nc": "nc" in norm((meta.get("UsageTerms") or {}).get("value", "")).split(),
        }


def pick(product):
    tokens = required_tokens(product["name"])
    queries = [product["name"], f'{product["brand"]} {product["name"]}']
    seen, best = set(), None
    for q in queries:
        for c in candidates(q):
            if c["title"] in seen:
                continue
            seen.add(c["title"])
            lic = c["license"].strip()
            if not c["thumb"] or c["mime"] not in ("image/jpeg", "image/png", "image/webp") or c["width"] < 500:
                continue
            if not ALLOWED.match(lic) or c["nc"] or re.search(r"\b(nc|nd)\b", lic, re.I):
                continue
            if EXCLUDE.search(c["title"]) or not title_matches(c["title"], tokens):
                continue
            extra = len(set(norm(c["title"]).split()) - set(tokens) - {"file", "jpg", "jpeg", "png", "webp", norm(product["brand"])})
            score = (-extra, c["width"])
            if best is None or score > best[0]:
                best = (score, c)
        time.sleep(0.4)
    return best[1] if best else None


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    from PIL import Image  # installé par le workflow
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((800, 800))
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=84, optimize=True, progressive=True)


def contact_sheets(entries):
    from PIL import Image, ImageDraw
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    cell, per = 260, 24
    items = sorted(entries.items())
    for start in range(0, len(items), per):
        chunk = items[start:start + per]
        rows = (len(chunk) + 5) // 6
        sheet = Image.new("RGB", (6 * cell, rows * (cell + 46)), "white")
        draw = ImageDraw.Draw(sheet)
        for i, (pid, e) in enumerate(chunk):
            x, y = (i % 6) * cell, (i // 6) * (cell + 46)
            im = Image.open(ROOT / e["local"].lstrip("/"))
            im.thumbnail((cell - 10, cell - 10))
            sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
            draw.text((x + 4, y + cell + 2), pid[:34], fill="black")
            draw.text((x + 4, y + cell + 18), e["license"][:34], fill="#555555")
        sheet.save(REVIEW_DIR / f"planche-{start // per + 1}.png", optimize=True)


def main():
    sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]
    found, missing = {}, []
    for p in sheets:
        try:
            c = pick(p)
        except Exception as exc:  # une erreur réseau ne doit pas bloquer les autres produits
            print(f"ERREUR {p['id']}: {exc}", file=sys.stderr)
            c = None
        if not c:
            missing.append(p["id"])
            continue
        local = f"/assets/produits/{p['id']}.jpg"
        try:
            download(c["thumb"], ROOT / local.lstrip("/"))
        except Exception as exc:
            print(f"TÉLÉCHARGEMENT {p['id']}: {exc}", file=sys.stderr)
            missing.append(p["id"])
            continue
        found[p["id"]] = {"name": p["name"], "local": local, "commons_title": c["title"], "license": c["license"],
                          "author": c["author"] or "auteur sur Wikimedia Commons", "file_page": c["file_page"],
                          "source_thumb": c["thumb"], "match": "auto"}
        print(f"OK {p['id']}: {c['title']} ({c['license']})")
    OUT_JSON.write_text(json.dumps({"generated_by": "scripts/fetch_commons_photos.py", "status": "a_verifier",
                                    "found": found, "missing": missing}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if found:
        contact_sheets(found)
    print(f"{len(found)} photos proposées, {len(missing)} produits sans photo libre exacte")
    return 0


if __name__ == "__main__":
    sys.exit(main())

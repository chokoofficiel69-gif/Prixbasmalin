#!/usr/bin/env python3
"""Récupère les photos officielles des fabricants via l'API Open Icecat (gratuite pour les comparateurs).

Exécuté par GitHub Actions (.github/workflows/fetch-icecat-photos.yml), qui a accès à Internet.

Pour chaque produit de data/icecat-gtins.json :
- interroge l'API Open Icecat avec le GTIN vérifié ;
- prend la photo principale fournie par la marque (fond neutre, qualité studio) ;
- l'héberge sur le site dans assets/produits/<id>.jpg (fond blanc, 800 px max) ;
- l'enregistre dans data/product-images.json avec la source et la marque, pour le crédit.

Les marques qui restreignent leur contenu (Apple, Microsoft…) renvoient une erreur : le produit est ignoré.
"""
import io
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GTINS = ROOT / "data" / "icecat-gtins.json"
IMAGES = ROOT / "data" / "product-images.json"
OUT_DIR = ROOT / "assets" / "produits"
API = "https://live.icecat.biz/api"
UA = "PrixBasMalinPhotoBot/1.0 (https://prixbasmalin.fr; Open Icecat)"
LICENSE = "partenaire : Open Icecat (contenu officiel fourni par la marque)"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def fetch_product(username, gtin):
    query = urllib.parse.urlencode({"UserName": username, "Language": "fr", "GTIN": gtin})
    try:
        data = json.loads(get(f"{API}?{query}"))
    except Exception as exc:  # erreur HTTP (marque restreinte, produit absent…)
        return None, str(exc)
    info = (data or {}).get("data") or {}
    image = info.get("Image") or {}
    url = image.get("HighPic") or image.get("Pic500x500") or ""
    if not url.startswith("https://"):
        return None, "pas de photo"
    general = info.get("GeneralInfo") or {}
    page = ((info.get("CatalogObjectCloud") or {}).get("ProductPage") or {}).get("URL") or "https://icecat.biz/"
    return {"url": url, "title": general.get("Title") or "", "brand": general.get("Brand") or "",
            "icecat_id": general.get("IcecatId"), "page": page}, ""


def to_jpeg(raw):
    from PIL import Image
    img = Image.open(io.BytesIO(raw))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    img.thumbnail((800, 800))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85, optimize=True, progressive=True)
    return out.getvalue()


def main():
    cfg = json.loads(GTINS.read_text(encoding="utf-8"))
    store = json.loads(IMAGES.read_text(encoding="utf-8"))
    images = store.setdefault("images", {})
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    added, skipped = [], []
    for pid, gtin in cfg["products"].items():
        product, err = fetch_product(cfg["username"], gtin)
        if not product:
            skipped.append(f"{pid} ({err})")
            continue
        try:
            jpeg = to_jpeg(get(product["url"]))
        except Exception as exc:
            skipped.append(f"{pid} (image illisible : {exc})")
            continue
        (OUT_DIR / f"{pid}.jpg").write_bytes(jpeg)
        images[pid] = {
            "thumb": f"/assets/produits/{pid}.jpg",
            "license": LICENSE,
            "author": product["brand"] or "Fabricant",
            "file_page": product["page"],
            "source": "open_icecat",
            "gtin": gtin,
            "icecat_title": product["title"],
            "match": "gtin_icecat",
        }
        added.append(pid)
    IMAGES.write_text(json.dumps(store, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Photos Icecat ajoutées : {len(added)} -> {', '.join(added) or 'aucune'}")
    if skipped:
        print("Ignorés : " + " ; ".join(skipped))
    return 0


if __name__ == "__main__":
    sys.exit(main())

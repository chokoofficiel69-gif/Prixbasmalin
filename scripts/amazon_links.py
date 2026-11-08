#!/usr/bin/env python3
"""Liens Amazon directs (fiche produit) à la place des liens de recherche.

Les références Amazon (ASIN) sont stockées dans data/amazon-asins.json. Elles ne sont jamais
devinées : chacune vient d'une adresse de fiche produit Amazon copiée par le propriétaire.

Ajouter ou remplacer un produit :
    python3 scripts/amazon_links.py set airpods-4 "https://www.amazon.fr/Apple-AirPods-4/dp/B0XXXXXXXX/ref=..."
Lister :
    python3 scripts/amazon_links.py list

Ensuite, régénérer les pages : python3 scripts/build_seo_pages.py && python3 scripts/build_sitemap.py
"""
import json
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlencode, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ASINS = ROOT / "data" / "amazon-asins.json"
AMAZON_TAG = "prixbasmalin2-21"
ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")
_PATH_ASIN = re.compile(r"/(?:dp|gp/product|gp/aw/d|exec/obidos/asin|o/ASIN)/([A-Z0-9]{10})(?:[/?#]|$)", re.I)


def asin_from(text):
    """Extrait l'ASIN d'une adresse de fiche produit amazon.fr, ou d'un ASIN seul. Lève ValueError sinon."""
    text = (text or "").strip()
    if ASIN_RE.match(text.upper()):
        return text.upper()
    parts = urlsplit(text)
    host = (parts.hostname or "").lower()
    if not (host == "amazon.fr" or host.endswith(".amazon.fr")):
        raise ValueError("adresse non reconnue : il faut une fiche produit amazon.fr (les liens courts amzn.to ne sont pas acceptés)")
    m = _PATH_ASIN.search(parts.path + "/")
    if not m:
        raise ValueError("cette adresse Amazon n'est pas une fiche produit (pas de /dp/…)")
    return m.group(1).upper()


def product_url(asin):
    if not ASIN_RE.match(asin or ""):
        raise ValueError(f"ASIN invalide : {asin!r}")
    return f"https://www.amazon.fr/dp/{asin}?" + urlencode({"tag": AMAZON_TAG})


def load():
    if not ASINS.exists():
        return {}
    data = json.loads(ASINS.read_text(encoding="utf-8"))
    out = {}
    for pid, entry in (data.get("products") or {}).items():
        asin = entry.get("asin") if isinstance(entry, dict) else None
        if asin and ASIN_RE.match(asin):
            out[pid] = asin
    return out


def save(products):
    data = {
        "version": 1,
        "tag": AMAZON_TAG,
        "note": "Références Amazon copiées depuis les fiches produit amazon.fr par le propriétaire du site. Ne jamais deviner un ASIN.",
        "products": dict(sorted(products.items())),
    }
    ASINS.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main(argv):
    if len(argv) >= 1 and argv[0] == "list":
        for pid, asin in sorted(load().items()):
            print(pid, asin, product_url(asin))
        return 0
    if len(argv) == 3 and argv[0] == "set":
        pid, raw = argv[1], argv[2]
        sheets = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))["products"]
        if pid not in {p["id"] for p in sheets}:
            print(f"Produit inconnu : {pid}", file=sys.stderr)
            return 1
        asin = asin_from(raw)
        current = json.loads(ASINS.read_text(encoding="utf-8")).get("products", {}) if ASINS.exists() else {}
        current[pid] = {"asin": asin, "added": date.today().isoformat()}
        save(current)
        print(f"{pid} → {product_url(asin)}")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

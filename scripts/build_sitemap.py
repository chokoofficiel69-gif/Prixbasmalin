#!/usr/bin/env python3
"""Construit sitemap.xml et sitemap.txt avec toutes les pages publiques indexables.

- Pages racine *.html, /prix/*.html et /idees-cadeaux/*.html.
- Exclut les pages en noindex (maquettes, vérification, statistiques, 404, page interactive)
  et les fichiers de vérification Google.
- lastmod : date à laquelle le contenu de la page a changé pour la dernière fois, suivie dans
  data/sitemap-lastmod.json (empreinte du contenu → date). Elle ne bouge pas si la page est identique.
"""
import argparse
import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://prixbasmalin.fr"
STATE = ROOT / "data" / "sitemap-lastmod.json"
PRIORITY_FIRST = ["index.html", "prix/index.html", "idees-cadeaux/index.html", "guides.html", "catalogue.html"]


def url_for(rel):
    if rel == "index.html":
        return SITE + "/"
    if rel.endswith("/index.html"):
        return SITE + "/" + rel[: -len("index.html")]
    return SITE + "/" + rel


def public_pages():
    files = [p for p in ROOT.glob("*.html")] + list((ROOT / "prix").glob("*.html")) + list((ROOT / "idees-cadeaux").glob("*.html"))
    pages = []
    for p in files:
        rel = p.relative_to(ROOT).as_posix()
        if p.name.startswith("google") or p.name == "404.html":
            continue
        text = p.read_text(encoding="utf-8")
        if re.search(r'<meta name="robots" content="[^"]*noindex', text):
            continue
        pages.append((rel, text))
    order = {r: i for i, r in enumerate(PRIORITY_FIRST)}
    pages.sort(key=lambda x: (order.get(x[0], 99), x[0]))
    return pages


def build(today=None):
    today = today or dt.date.today().isoformat()
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    new_state, entries = {}, []
    for rel, text in public_pages():
        # Ignorer les lignes qui changent sans changer le contenu utile (dates de génération).
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        prev = state.get(rel)
        lastmod = prev["lastmod"] if prev and prev.get("hash") == digest else today
        new_state[rel] = {"hash": digest, "lastmod": lastmod}
        entries.append((url_for(rel), lastmod))
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    xml += [f"  <url><loc>{u}</loc><lastmod>{m}</lastmod></url>" for u, m in entries]
    xml.append("</urlset>")
    return {
        "sitemap.xml": "\n".join(xml) + "\n",
        "sitemap.txt": "\n".join(u for u, _ in entries) + "\n",
        "data/sitemap-lastmod.json": json.dumps(new_state, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="échoue si une page publique manque dans le sitemap")
    args = ap.parse_args()
    files = build()
    if args.check:
        current = (ROOT / "sitemap.xml").read_text(encoding="utf-8") if (ROOT / "sitemap.xml").exists() else ""
        missing = [u for u in re.findall(r"<loc>(.*?)</loc>", files["sitemap.xml"]) if f"<loc>{u}</loc>" not in current]
        if missing:
            print("Pages absentes du sitemap : " + ", ".join(missing[:5]), file=sys.stderr)
            return 1
        return 0
    for rel, text in files.items():
        (ROOT / rel).write_text(text, encoding="utf-8")
    print(f"sitemap.xml : {files['sitemap.txt'].count(chr(10))} pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())

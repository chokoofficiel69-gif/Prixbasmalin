#!/usr/bin/env python3
"""Signale les pages du plan du site aux moteurs IndexNow (Bing, Yandex, Seznam, Naver…).

Bing alimente aussi DuckDuckGo, Ecosia et la recherche de ChatGPT. Google n'utilise pas
IndexNow : pour Google, le plan du site reste déclaré dans la Search Console.

    python3 scripts/indexnow_submit.py --days 2      # pages modifiées depuis 2 jours
    python3 scripts/indexnow_submit.py --all         # toutes les pages
    python3 scripts/indexnow_submit.py --dry-run     # affiche sans envoyer
"""
import argparse
import json
import re
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = "prixbasmalin.fr"
KEY = "25ba6eb7b7f6a87b8675d786149ae50b"
ENDPOINT = "https://api.indexnow.org/indexnow"
ENTRY = re.compile(r"<loc>(https://prixbasmalin\.fr/[^<]*)</loc>(?:<lastmod>(\d{4}-\d{2}-\d{2})</lastmod>)?")


def urls_from_sitemap(text, since=None):
    out = []
    for loc, lastmod in ENTRY.findall(text):
        if since is None or (lastmod and date.fromisoformat(lastmod) >= since):
            out.append(loc)
    return list(dict.fromkeys(out))[:10000]


def payload(urls):
    return {"host": HOST, "key": KEY, "keyLocation": f"https://{HOST}/{KEY}.txt", "urlList": urls}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=2)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if (ROOT / f"{KEY}.txt").read_text(encoding="utf-8").strip() != KEY:
        print("Fichier de clé IndexNow absent ou différent : rien envoyé.")
        return 1
    since = None if args.all else date.today() - timedelta(days=args.days)
    urls = urls_from_sitemap((ROOT / "sitemap.xml").read_text(encoding="utf-8"), since)
    print(f"{len(urls)} page(s) à signaler")
    if not urls or args.dry_run:
        print("\n".join(urls[:20]))
        return 0
    req = urllib.request.Request(ENDPOINT, data=json.dumps(payload(urls)).encode(),
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"IndexNow : HTTP {resp.status}")
    except urllib.error.HTTPError as err:
        print(f"IndexNow : HTTP {err.code} {err.read()[:300]!r}")
        return 0 if err.code == 429 else 1  # 429 = trop de demandes, on réessaiera demain
    return 0


if __name__ == "__main__":
    sys.exit(main())

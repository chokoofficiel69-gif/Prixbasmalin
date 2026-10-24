#!/usr/bin/env python3
"""Inspect the official open fuel-price CSV feed without writing project data.

This is deliberately a read-only dry run: it downloads the public dataset into
memory, prints the schema and a few price/update fields, and never writes prices.json.
"""
import argparse
import csv
import io
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

DEFAULT_URL = (
    "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "prix-des-carburants-en-france-flux-instantane-v2/exports/csv"
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL, help="URL CSV officielle (optionnel)")
    parser.add_argument("--sample", type=int, default=3, help="Nombre de lignes d'exemple à afficher")
    args = parser.parse_args()
    if args.sample < 0 or args.sample > 10:
        parser.error("--sample doit être compris entre 0 et 10")

    parsed_url = urlparse(args.url)
    if parsed_url.scheme != "https" or parsed_url.hostname != "data.economie.gouv.fr" or parsed_url.username or parsed_url.password or parsed_url.port not in (None, 443):
        print("ERREUR : --url doit utiliser HTTPS sur le domaine exact data.economie.gouv.fr.", file=sys.stderr)
        return 2

    request = urllib.request.Request(args.url, headers={"User-Agent": "Prixbasmalin-dry-run/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            final_url = urlparse(response.geturl())
            if final_url.scheme != "https" or final_url.hostname != "data.economie.gouv.fr":
                print("ERREUR : redirection hors du domaine officiel refusée.", file=sys.stderr)
                return 2
            charset = response.headers.get_content_charset() or "utf-8"
            content = response.read().decode(charset, errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"ERREUR téléchargement du flux officiel : {exc}", file=sys.stderr)
        return 2

    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        print("ERREUR : aucun en-tête CSV détecté", file=sys.stderr)
        return 1
    fields = [field.strip() for field in reader.fieldnames if field]
    print("DRY-RUN UNIQUEMENT — aucun fichier projet modifié.")
    print(f"Source : {args.url}")
    print(f"Taille téléchargée : {len(content.encode(charset, errors='replace'))} octets")
    print("Colonnes : " + ", ".join(fields))
    selected = [field for field in fields if any(token in field.casefold() for token in ("prix", "maj", "carburant", "nom", "adresse", "id"))]
    count = 0
    for row in reader:
        count += 1
        if count <= args.sample:
            print(f"Exemple {count} : " + "; ".join(f"{key}={row.get(key, '')}" for key in selected[:12]))
    print(f"Lignes lues : {count}")
    print("Aucune conversion vers data/prices.json n'a été effectuée.")
    print("Note : les horodatages de prix du flux doivent être vérifiés individuellement; le téléchargement récent ne prouve pas que chaque prix est récent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

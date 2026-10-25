#!/usr/bin/env python3
"""Aperçu en lecture seule du flux officiel des prix des carburants.

Télécharge le flux public instantané de Roulez-Éco / Ministère chargé de l'énergie,
lit l'archive XML en mémoire et affiche uniquement un résumé. Ne modifie aucun fichier,
notamment data/prices.json. Aucun scraping de sites marchands.
"""
import argparse
import io
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

DEFAULT_URL = "https://donnees.roulez-eco.fr/opendata/instantane"
FUEL_NAMES = {"Gazole", "SP95", "SP98", "E10", "E85", "GPLc"}


def parse_xml(xml_bytes):
    root = ET.fromstring(xml_bytes)
    stations = 0
    prices = 0
    recent = []
    for station in root.iter("pdv"):
        stations += 1
        station_id = station.attrib.get("id", "")
        postal_code = station.attrib.get("cp", "")
        address = (station.findtext("adresse") or "").strip()
        city = (station.findtext("ville") or "").strip()
        for item in station.findall("prix"):
            name = item.attrib.get("nom", "")
            value = item.attrib.get("valeur", "")
            updated = item.attrib.get("maj", "")
            prices += 1
            if name in FUEL_NAMES and value and updated and len(recent) < 5:
                recent.append({
                    "station_id": station_id,
                    "postal_code": postal_code,
                    "city": city,
                    "address": address,
                    "fuel": name,
                    "price_eur_litre": value,
                    "updated_at": updated,
                })
    return {"stations": stations, "prices": prices, "sample": recent}


def load_xml(payload):
    if payload.lstrip().startswith(b"<"):
        return payload
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        candidates = [name for name in archive.namelist() if name.lower().endswith(".xml")]
        if not candidates:
            raise ValueError("L'archive officielle ne contient aucun fichier XML")
        return archive.read(candidates[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL, help="URL officielle du flux instantané")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    request = urllib.request.Request(args.url, headers={"User-Agent": "PrixMalin-open-data-preview/1.0"})
    with urllib.request.urlopen(request, timeout=args.timeout) as response:
        payload = response.read()
    summary = parse_xml(load_xml(payload))
    print("MODE APERÇU — aucune écriture de fichier")
    print(f"Source: {args.url}")
    print(f"Vérifié le: {datetime.now(timezone.utc).isoformat()}")
    print(f"Stations: {summary['stations']}; relevés prix: {summary['prices']}")
    print("Exemples de relevés (maximum 5):")
    for row in summary["sample"]:
        print(f"- {row['postal_code']} {row['city']} | {row['fuel']} {row['price_eur_litre']} €/L | maj={row['updated_at']}")
    print("Aucun prix n'a été ajouté au catalogue. Les identités de produits marchands ne sont pas inférées.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError) as exc:
        print(f"ERREUR flux carburants: {exc}", file=sys.stderr)
        raise SystemExit(1)

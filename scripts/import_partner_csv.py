#!/usr/bin/env python3
"""Convert an authorized partner CSV export into the normalized offer schema.

This tool performs no network requests and does not scrape merchant sites.
It only transforms a CSV file supplied by the user from an authorized source.
"""
import argparse
import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

REQUIRED_COLUMNS = {
    "offer_id", "catalog_product_id", "product_name", "merchant_name", "source",
    "identity_type", "identity_value", "price", "shipping_price", "currency",
    "product_url", "checked_at",
}
OPTIONAL_COLUMNS = {"brand", "tracking_url"}
ALLOWED_IDENTITIES = {"gtin", "asin", "mpn"}


def parse_money(value, label):
    text = (value or "").strip().replace(" ", "").replace(",", ".")
    if not text:
        raise ValueError(f"{label}: valeur manquante")
    try:
        amount = float(text)
    except ValueError as exc:
        raise ValueError(f"{label}: montant invalide") from exc
    if amount < 0 or amount != amount or amount in (float("inf"), float("-inf")):
        raise ValueError(f"{label}: montant invalide")
    return round(amount, 2)


def normalize_row(row, line_number):
    label = f"ligne {line_number}"
    result = {key: (row.get(key) or "").strip() for key in REQUIRED_COLUMNS | OPTIONAL_COLUMNS}
    for key in REQUIRED_COLUMNS:
        if not result[key]:
            raise ValueError(f"{label}: colonne obligatoire vide: {key}")
    if result["identity_type"].lower() not in ALLOWED_IDENTITIES:
        raise ValueError(f"{label}: identity_type doit être gtin, asin ou mpn")
    result["identity_type"] = result["identity_type"].lower()
    if result["identity_type"] == "mpn" and not result["brand"]:
        raise ValueError(f"{label}: brand obligatoire pour une identité MPN")
    if result["currency"].upper() != "EUR":
        raise ValueError(f"{label}: seules les offres en EUR sont acceptées")
    result["currency"] = "EUR"
    if not re.match(r"^https://[^\s/]+(?:/|$)", result["product_url"], re.I):
        raise ValueError(f"{label}: product_url doit être une URL HTTPS")
    if result["tracking_url"] and not re.match(r"^https://[^\s/]+(?:/|$)", result["tracking_url"], re.I):
        raise ValueError(f"{label}: tracking_url doit être une URL HTTPS")
    try:
        checked = datetime.fromisoformat(result["checked_at"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{label}: checked_at doit être une date ISO 8601 avec fuseau horaire") from exc
    if checked.tzinfo is None:
        raise ValueError(f"{label}: checked_at doit inclure un fuseau horaire")
    result["price"] = parse_money(result["price"], f"{label}.price")
    result["shipping_price"] = parse_money(result["shipping_price"], f"{label}.shipping_price")
    result["offer_id"] = result["offer_id"]
    result["source"] = result["source"]
    return {key: value for key, value in result.items() if key not in OPTIONAL_COLUMNS or value}


def convert_csv(input_path):
    offers = []
    errors = []
    seen_ids = set()
    with Path(input_path).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV vide ou sans en-têtes")
        headers = {name.strip() for name in reader.fieldnames if name}
        missing = sorted(REQUIRED_COLUMNS - headers)
        if missing:
            raise ValueError("Colonnes manquantes : " + ", ".join(missing))
        for line_number, row in enumerate(reader, start=2):
            if not any((value or "").strip() for value in row.values()):
                continue
            try:
                offer = normalize_row(row, line_number)
                if offer["offer_id"] in seen_ids:
                    raise ValueError(f"ligne {line_number}: offer_id dupliqué: {offer['offer_id']}")
                seen_ids.add(offer["offer_id"])
                offers.append(offer)
            except ValueError as exc:
                errors.append(str(exc))
    if errors:
        raise ValueError("Import annulé, aucune sortie écrite :\n- " + "\n- ".join(errors))
    return {"schema_version": 1, "generated_at": datetime.now().astimezone().isoformat(), "offers": offers}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_csv", help="Chemin du CSV exporté depuis une source marchande autorisée")
    parser.add_argument("--output", required=True, help="Chemin du JSON normalisé à créer (ne remplace jamais le flux de production par défaut)")
    args = parser.parse_args()
    result = convert_csv(args.input_csv)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Import préparé : {len(result['offers'])} offre(s). Fichier créé : {output}")
    print("Avant publication, vérifier les identités, les frais de livraison, les dates et les URL dans la source officielle.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        print(f"ERREUR: {exc}", file=sys.stderr)
        sys.exit(1)

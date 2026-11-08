#!/usr/bin/env python3
"""Prépare l'import d'un rapport officiel Amazon Partenaires (CSV) dans la table D1 amazon_reports.

Le script ne se connecte à rien : il lit le CSV exporté depuis partenaires.amazon.fr
(Rapports → tendances quotidiennes / gains, export CSV) et écrit un fichier SQL que le
propriétaire exécute lui-même, après relecture :

    python3 scripts/import_amazon_report.py rapport.csv --out import-amazon.sql
    npx wrangler d1 execute prixbasmalin-clicks --remote --file=import-amazon.sql

Seules les valeurs présentes dans le rapport sont importées : aucune commande ni commission
n'est jamais déduite des clics. Une ligne déjà importée (même date et même identifiant de
suivi) est mise à jour, jamais dupliquée.
"""
import argparse
import csv
import io
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

DEFAULT_TAG = "prixbasmalin2-21"
# En-têtes reconnus (français et anglais), comparés sans accents ni casse.
ALIASES = {
    "report_date": ["date", "jour", "day"],
    "tracking_id": ["tracking id", "identifiant de suivi", "id de suivi", "tag", "tracking-id"],
    "clicks": ["clicks", "clics"],
    "ordered_items": ["ordered items", "articles commandes", "items ordered", "produits commandes"],
    "shipped_items": ["shipped items", "items shipped", "articles expedies", "produits expedies"],
    "returned_items": ["returned items", "items returned", "articles retournes", "retours"],
    "revenue_eur": ["revenue", "revenus", "chiffre d'affaires", "chiffre daffaires", "ventes", "total des ventes"],
    "earnings_eur": ["earnings", "ad fees", "gains", "commissions", "frais publicitaires", "total des gains"],
}
INT_FIELDS = {"clicks", "ordered_items", "shipped_items", "returned_items"}
MONEY_FIELDS = {"revenue_eur", "earnings_eur"}


def norm(text):
    text = unicodedata.normalize("NFD", str(text)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", text.replace("﻿", "")).strip()


def map_headers(headers):
    mapping = {}
    for i, h in enumerate(headers):
        key = norm(h)
        for field, names in ALIASES.items():
            if field not in mapping.values() and key in names:
                mapping[i] = field
    return mapping


def parse_date(value):
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%m/%d/%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"date illisible : {value!r}")


def parse_number(value, money):
    text = str(value).strip().replace(" ", "").replace(" ", "").replace("€", "").replace("EUR", "")
    if text in ("", "-", "—"):
        return None
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".") if text.rfind(",") > text.rfind(".") else text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")
    number = float(text)
    if number < 0:
        raise ValueError(f"valeur négative inattendue : {value!r}")
    return round(number, 2) if money else int(round(number))


def parse_report(text, default_tag=DEFAULT_TAG):
    # Séparateur : celui qui apparaît le plus sur la ligne d'en-têtes (« ; » pour les exports français).
    header = next((l for l in text.splitlines() if "date" in norm(l) or "jour" in norm(l)), text[:500])
    delimiter = max(",;\t", key=header.count)
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    # Les exports Amazon peuvent commencer par des lignes de titre : chercher la ligne d'en-têtes.
    for start, row in enumerate(rows):
        mapping = map_headers(row)
        if "report_date" in mapping.values() and len(mapping) >= 2:
            break
    else:
        raise ValueError("en-têtes non reconnus : il faut au moins une colonne Date et une colonne de mesure (Clics, Articles commandés, Gains…)")
    out = []
    for row in rows[start + 1:]:
        if not any(cell.strip() for cell in row):
            continue
        record = {f: None for f in ALIASES}
        for i, field in mapping.items():
            if i >= len(row):
                continue
            cell = row[i]
            if field == "report_date":
                if norm(cell) in ("total", "totaux", ""):
                    record = None
                    break
                record[field] = parse_date(cell)
            elif field == "tracking_id":
                record[field] = cell.strip().lower() or None
            else:
                record[field] = parse_number(cell, field in MONEY_FIELDS)
        if record is None:
            continue
        record["tracking_id"] = record["tracking_id"] or default_tag
        if not re.fullmatch(r"[a-z0-9-]{1,30}", record["tracking_id"]):
            raise ValueError(f"identifiant de suivi invalide : {record['tracking_id']!r}")
        out.append(record)
    if not out:
        raise ValueError("aucune ligne de données trouvée")
    return out


def sql_value(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def to_sql(records, source_file):
    cols = ["report_date", "tracking_id", "clicks", "ordered_items", "shipped_items", "returned_items", "revenue_eur", "earnings_eur", "source_file"]
    lines = ["-- Import d'un rapport officiel Amazon Partenaires. Généré par scripts/import_amazon_report.py ; à relire avant exécution."]
    for r in records:
        values = [r.get(c) for c in cols[:-1]] + [source_file]
        updates = ", ".join(f"{c} = excluded.{c}" for c in cols[2:]) + ", imported_at = CURRENT_TIMESTAMP"
        lines.append(f"INSERT INTO amazon_reports ({', '.join(cols)}) VALUES ({', '.join(sql_value(v) for v in values)}) "
                     f"ON CONFLICT(report_date, tracking_id) DO UPDATE SET {updates};")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path)
    ap.add_argument("--out", type=Path, default=Path("import-amazon.sql"))
    ap.add_argument("--tracking-id", default=DEFAULT_TAG, help="identifiant de suivi si le rapport n'a pas de colonne dédiée")
    args = ap.parse_args()
    raw = args.csv.read_bytes()
    text = raw.decode("utf-8-sig", errors="strict") if raw[:3] == b"\xef\xbb\xbf" else raw.decode("utf-8", errors="replace")
    records = parse_report(text, args.tracking_id.lower())
    args.out.write_text(to_sql(records, args.csv.name), encoding="utf-8")
    total = lambda f: sum(r[f] or 0 for r in records)
    print(f"{len(records)} jour(s) lus — clics {total('clicks')}, articles commandés {total('ordered_items')}, "
          f"expédiés {total('shipped_items')}, gains {total('earnings_eur'):.2f} €. SQL écrit dans {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

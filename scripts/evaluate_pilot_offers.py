#!/usr/bin/env python3
"""Évalue hors ligne les offres d'un pilote externe (ex. PricesAPI) contre les
relevés PrixTracker déjà présents dans le dépôt.

- Aucune requête réseau, aucun crédit consommé.
- Ne modifie aucune donnée publiée : écrit seulement un rapport (Markdown/JSON).
- Une offre n'est jamais « publiable » ici : le script sert à mesurer la fiabilité
  d'une source avant toute décision de branchement en production.

Usage :
  python3 scripts/evaluate_pilot_offers.py \
      --pilot tests/fixtures/pricesapi-pilot-airpods4-2026-11-09.json \
      --reference-id airpods-4 [--markdown docs/pilote-pricesapi-airpods4.md]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SHEETS = ROOT / "data" / "fiches-produits.json"

# Termes qui signalent une pièce détachée, un accessoire ou un produit non neuf.
PART_TERMS = ["loose parts", "piece detachee", "pieces detachees", "earpiece", "ecouteur gauche",
              "ecouteur droit", "left earpiece", "right earpiece", "boitier seul", "charging case only",
              "rechter", "linker", "coque", "housse", "etui", "case cover", "replacement"]
USED_TERMS = ["occasion", "reconditionne", "refurbished", "used", "seconde main", "comme neuf"]
# Vendeurs dont les annonces sont surtout entre particuliers / d'occasion.
C2C_SELLERS = ["leboncoin", "vinted", "ebay", "back market", "backmarket", "rakuten occasion"]
# Règles propres à une fiche : variantes à ne pas confondre avec la référence.
PRODUCT_RULES = {
    "airpods-4": {
        "required_any": ["airpods 4", "airpod 4", "airpods4"],
        "forbidden": ["lightning", "pro", "max", "reduction de bruit", "anc", "noise cancel"],
    },
}
LOW_RATIO = 0.80   # sous 80 % du plus bas relevé PrixTracker : suspect
HIGH_RATIO = 1.25  # au-dessus de 125 % du plus haut relevé : suspect
REFERENCE_WINDOW_DAYS = 7


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text.lower())).strip()


def has_term(text: str, term: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(norm(term)) + r"(?![a-z0-9])", text) is not None


def reference_band(sheet: dict, as_of: date) -> dict:
    since = as_of - timedelta(days=REFERENCE_WINDOW_DAYS)
    prices, merchants = [], {}
    for offer in sheet.get("offers", []):
        try:
            when = date.fromisoformat(str(offer.get("date")))
            price = float(offer.get("price_eur"))
        except (TypeError, ValueError):
            continue
        if since <= when <= as_of and price > 0:
            prices.append(price)
            merchants[norm(offer.get("merchant"))] = price
    if not prices:
        return {"count": 0}
    return {"count": len(prices), "min": min(prices), "max": max(prices), "merchants": merchants,
            "window": f"{since.isoformat()} → {as_of.isoformat()}"}


def classify(offer: dict, rules: dict, band: dict) -> dict:
    title = norm(offer.get("product_title"))
    seller = norm(offer.get("seller"))
    reasons, notes = [], []
    if any(has_term(title, t) for t in PART_TERMS):
        reasons.append("pièce détachée ou accessoire")
    if any(has_term(title, t) for t in USED_TERMS):
        reasons.append("produit d'occasion ou reconditionné")
    if any(s in seller for s in C2C_SELLERS):
        reasons.append("vendeur entre particuliers / occasion")
    if rules.get("required_any") and not any(has_term(title, t) for t in rules["required_any"]):
        notes.append("titre trop vague pour confirmer le modèle")
    hit = [t for t in rules.get("forbidden", []) if has_term(title, t)]
    if hit:
        reasons.append("variante différente (" + ", ".join(hit) + ")")
    if str(offer.get("currency") or "").upper() != "EUR":
        reasons.append("devise non EUR")
    price = offer.get("price")
    if isinstance(price, (int, float)) and band.get("count"):
        if price < band["min"] * LOW_RATIO:
            reasons.append(f"prix anormalement bas (< {LOW_RATIO:.0%} du minimum relevé)")
        elif price > band["max"] * HIGH_RATIO:
            reasons.append(f"prix anormalement haut (> {HIGH_RATIO:.0%} du maximum relevé)")
        for merchant, ref_price in band.get("merchants", {}).items():
            if merchant and (merchant in seller.replace(" ", "") or seller.replace(" ", "") in merchant):
                if abs(ref_price - price) < 0.01:
                    notes.append("même prix que le relevé PrixTracker du marchand")
                else:
                    notes.append(f"relevé PrixTracker du marchand : {ref_price:.2f} €")
                break
    if not offer.get("url_present"):
        reasons.append("pas d'URL directe")
    if reasons:
        verdict = "rejetée"
    elif any("trop vague" in n for n in notes):
        verdict = "douteuse"
    else:
        verdict = "plausible, à confirmer"
    return {"seller": offer.get("seller"), "price": price, "title": offer.get("product_title"),
            "delivery_info": offer.get("delivery_info"), "verdict": verdict, "reasons": reasons, "notes": notes}


def evaluate(pilot: dict, sheets: list, reference_id: str) -> dict:
    sheet = next((s for s in sheets if s.get("id") == reference_id), None)
    if sheet is None:
        raise SystemExit(f"Fiche de référence introuvable : {reference_id}")
    started = str(pilot.get("started_at") or "")[:10]
    as_of = date.fromisoformat(started) if started else date.today()
    band = reference_band(sheet, as_of)
    rules = PRODUCT_RULES.get(reference_id, {})
    offers = [o for p in pilot.get("products", []) for o in p.get("offers", [])]
    rows = [classify(o, rules, band) for o in offers]
    blockers = []
    if any(p.get("scraped_at") in (None, "") for p in pilot.get("products", [])):
        blockers.append("date de relevé absente (scraped_at null) : fraîcheur non prouvée")
    if not any(o.get("url_present") for o in offers) or "url_values" in pilot.get("_provenance", {}):
        blockers.append("URL marchandes non conservées : impossible de vérifier la fiche exacte")
    blockers.append("TVA non indiquée par la source : prix TTC non prouvé")
    counts = {v: sum(1 for r in rows if r["verdict"] == v) for v in ("plausible, à confirmer", "douteuse", "rejetée")}
    return {"reference_id": reference_id, "reference_name": sheet.get("name"), "reference_band": {k: v for k, v in band.items() if k != "merchants"},
            "query": pilot.get("query"), "run_at": pilot.get("started_at"), "offers": rows, "counts": counts,
            "publishable": False, "blockers": blockers}


def to_markdown(result: dict) -> str:
    band = result["reference_band"]
    lines = [f"# Pilote PricesAPI — {result['reference_name']} (évaluation hors ligne)", "",
             f"- Requête d'origine : « {result['query']} », exécutée le {result['run_at']} (aucune nouvelle requête).",
             "- Référence : relevés PrixTracker du dépôt (Licence Ouverte 2.0)" +
             (f", {band['count']} relevés du {band['window']}, de {band['min']:.2f} € à {band['max']:.2f} €." if band.get("count") else " : aucun relevé récent."),
             f"- Résultat : {result['counts']['plausible, à confirmer']} plausibles, {result['counts']['douteuse']} douteuses, {result['counts']['rejetée']} rejetées sur {len(result['offers'])}.",
             "- **Publiable en production : non.**", "", "## Bloquants", ""]
    lines += [f"- {b}" for b in result["blockers"]]
    lines += ["", "## Offres", "", "| Vendeur | Prix | Verdict | Raisons / notes |", "|---|---:|---|---|"]
    for r in result["offers"]:
        detail = "; ".join(r["reasons"] + r["notes"]) or "—"
        price = f"{r['price']:.2f} €" if isinstance(r["price"], (int, float)) else "?"
        lines.append(f"| {r['seller']} | {price} | {r['verdict']} | {detail} |")
    lines += ["", "Les verdicts « plausible » ne valent pas vérification : il faudrait la fiche marchande exacte, la date du relevé et la mention TTC.", ""]
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pilot", required=True)
    ap.add_argument("--reference-id", required=True)
    ap.add_argument("--sheets", default=str(DEFAULT_SHEETS))
    ap.add_argument("--markdown")
    ap.add_argument("--json")
    args = ap.parse_args(argv)
    pilot = json.loads(Path(args.pilot).read_text(encoding="utf-8"))
    sheets = json.loads(Path(args.sheets).read_text(encoding="utf-8"))["products"]
    result = evaluate(pilot, sheets, args.reference_id)
    if args.markdown:
        Path(args.markdown).write_text(to_markdown(result), encoding="utf-8")
    if args.json:
        Path(args.json).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not args.markdown and not args.json:
        print(to_markdown(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())

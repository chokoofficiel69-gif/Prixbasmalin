#!/usr/bin/env python3
"""En-tête commun Prix Malin (étape 1 de l'harmonisation).

- header_html(current) : le HTML de l'en-tête, avec la rubrique courante mise en avant.
- Exécuté en script : remplace l'en-tête des pages écrites à la main (liste PAGES) par
  l'en-tête commun et ajoute la feuille css/pm-design.css. Idempotent ; --check échoue
  si une page n'est pas à jour.

L'accueil (index.html) et le catalogue (catalogue.html) gardent leur en-tête complet
(favoris, alertes, compte), qui sert de référence visuelle.
"""
import argparse
import re
import sys
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSS_LINK = '<link rel="stylesheet" href="/css/pm-design.css">'
# Gestionnaire de consentement : la mesure d'audience et le suivi des clics ne se chargent qu'après accord.
CONSENT_SCRIPT = '<script src="/js/cookie-consent.js" defer></script>'
START, END = "<!-- pm-site-header -->", "<!-- /pm-site-header -->"
AMAZON_DEALS = "https://www.amazon.fr/gp/goldbox?tag=prixbasmalin2-21"

ICONS = {
    "home": '<path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/>',
    "compare": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "catalogue": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    "gift": '<rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M12 9v12M3 13h18M12 9C10 4 6 5 7 7.5 8 9 12 9 12 9Zm0 0c2-5 6-4 5-1.5C16 9 12 9 12 9Z"/>',
    "guide": '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
    "deals": '<path d="M20 12 12 20 4 12V4h8z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
}
NAV = [
    ("home", "/", "Accueil"),
    ("compare", "/prix/", "Comparateur"),
    ("catalogue", "/catalogue.html", "Catalogue"),
    ("gift", "/idees-cadeaux/", "Cadeaux"),
    ("guide", "/guides.html", "Guides"),
    ("deals", "/offres.html", "Offres"),
]

# Page écrite à la main → rubrique mise en avant dans la navigation.
PAGES = {
    "mode.html": "catalogue", "high-tech.html": "catalogue", "maison-deco.html": "catalogue",
    "nouveautes.html": "catalogue", "grossistes.html": "deals", "offres.html": "deals",
    "services.html": None, "partenaires.html": None, "publicite.html": None,
    "historique-prix.html": "compare", "comparateur-historique.html": "compare", "produit.html": "compare",
    "guide-cadeaux.html": "guide", "guide-choisir-smartphone.html": "guide",
    "a-propos.html": None, "confidentialite.html": None, "credits-photos.html": None, "404.html": None,
    # Le catalogue a sa propre barre de recherche collante : en-tête non collant, sans seconde recherche.
    "catalogue.html": ("catalogue", "compact"),
}


def icon(name):
    return f'<svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>'


def header_html(current=None, query="", variant=""):
    nav = "".join(
        f'<a href="{href}"{" aria-current=\"page\"" if key == current else ""}>{icon(key)}{label}</a>'
        for key, href, label in NAV
    )
    compact = variant == "compact"
    search = "" if compact else f"""
  <form class="pm-sh-search" id="pm-site-search" role="search" action="/catalogue.html">
   <label class="pm-sr" for="pm-site-q">Rechercher un produit</label>
   <input id="pm-site-q" name="q" type="search" value="{escape(query)}" placeholder="Rechercher un produit, une marque…" autocomplete="off">
   <button type="submit" aria-label="Rechercher"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></button>
  </form>"""
    return f"""{START}
<header class="pm-site-header{" pm-sh-compact" if compact else ""}" id="pm-site-header">
 <div class="pm-sh-inner">
  <div class="pm-sh-top">
   <a class="pm-sh-brand" href="/" aria-label="Prix Malin, accueil"><img src="/assets/logo-sac-prix-malin-hq.webp" alt="" width="44" height="38"><span><b>Prix <span>Malin</span></b><small>Comparez · Trouvez · Économisez</small></span></a>
   <a class="pm-sh-deals" href="{AMAZON_DEALS}" target="_blank" rel="sponsored nofollow noopener">Offres Amazon ↗</a>
  </div>{search}
  <nav class="pm-sh-nav" aria-label="Rubriques">{nav}</nav>
 </div>
</header>
{END}"""


def apply(text, current):
    """Remplace le premier <header> (ou un en-tête commun déjà posé) et ajoute la feuille commune."""
    current, variant = current if isinstance(current, tuple) else (current, "")
    new_header = header_html(current, variant=variant)
    if START in text:
        text = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _m: new_header, text, count=1, flags=re.S)
    else:
        text, n = re.subn(r"<header\b.*?</header>", lambda _m: new_header, text, count=1, flags=re.S)
        if n != 1:
            raise ValueError("aucun <header> à remplacer")
    if "/js/cookie-consent.js" not in text:
        text = text.replace("</head>", CONSENT_SCRIPT + "\n</head>", 1)
    if CSS_LINK not in text:
        # La feuille commune est chargée en dernier dans <head> pour primer sur les styles anciens.
        text = text.replace("</head>", CSS_LINK + "\n</head>", 1)
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    stale = []
    for name, current in PAGES.items():
        path = ROOT / name
        before = path.read_text(encoding="utf-8")
        after = apply(before, current)
        if after != before:
            stale.append(name)
            if not args.check:
                path.write_text(after, encoding="utf-8")
    if args.check:
        if stale:
            print("En-tête commun à appliquer : " + ", ".join(stale), file=sys.stderr)
            return 1
        return 0
    print(f"En-tête commun appliqué à {len(stale)} page(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Affiliation Amazon, chargement de la mesure sur les pages publiques, import du rapport Amazon."""
import importlib.util
import re
import sqlite3
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
TAG = "prixbasmalin2-21"


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


report = load("import_amazon_report")
sitemap = load("build_sitemap")

AMAZON_URL = re.compile(r"https?://(?:[a-z0-9-]+\.)*amazon\.fr/(?:[^\s\"'<>\\]|'(?=[A-Za-z%]))*", re.I)  # « Levi's » oui, « '+ » non
SOURCES = [p for p in ROOT.glob("**/*") if p.suffix in {".html", ".json", ".js", ".py", ".mjs"}
           and not {".git", "node_modules", "tests"} & set(p.relative_to(ROOT).parts)]


class AmazonAffiliationTests(unittest.TestCase):
    def test_every_complete_amazon_url_carries_the_tag(self):
        bad = []
        for path in SOURCES:
            text = path.read_text(encoding="utf-8", errors="ignore").replace("&amp;", "&")
            for m in AMAZON_URL.finditer(text):
                url = m.group(0)
                if url.endswith(("?", "=")):
                    continue  # URL construite par code : vérifiée par le test suivant
                if "?" not in url and "/gp/" not in url:
                    continue
                if parse_qs(urlsplit(url).query).get("tag") != [TAG]:
                    bad.append(f"{path.relative_to(ROOT)}: {url[:100]}")
        self.assertEqual(bad, [], "liens Amazon sans le tag prixbasmalin2-21")

    def test_code_built_amazon_urls_append_the_tag(self):
        bad = []
        for path in SOURCES:
            text = path.read_text(encoding="utf-8", errors="ignore")
            for m in re.finditer(r"amazon\.fr/(?:s\?|gp/goldbox\?|gp/bestsellers\?)", text):
                window = text[m.start():m.start() + 320]
                if not re.search(r"tag\W{0,8}(prixbasmalin2-21|[A-Z_]*TAG\b|amazonTag)", window):
                    bad.append(f"{path.relative_to(ROOT)}: {window[:90]!r}")
        self.assertEqual(bad, [])

    def test_no_amazon_short_links_or_foreign_tags(self):
        for path in SOURCES:
            text = path.read_text(encoding="utf-8", errors="ignore")
            self.assertNotRegex(text, r"amzn\.(to|eu)/", str(path))
            for tag in re.findall(r"amazon\.fr/[^\s\"'<>]*[?&]tag=([a-z0-9-]+)", text):
                self.assertEqual(tag, TAG, str(path))


class MeasurementLoadingTests(unittest.TestCase):
    def test_every_public_page_loads_the_consent_manager(self):
        missing = [rel for rel, text in sitemap.public_pages() if "/js/cookie-consent.js" not in text]
        self.assertEqual(missing, [], "ces pages ne mesurent ni les visites ni les clics")

    def test_consent_loader_points_to_current_tracker(self):
        consent = (ROOT / "js" / "cookie-consent.js").read_text(encoding="utf-8")
        self.assertIn("/js/track-outbound.js?v=20261108-v2", consent)

    def test_product_pages_expose_product_id(self):
        page = (ROOT / "prix" / "airpods-4.html").read_text(encoding="utf-8")
        self.assertIn('<meta name="pm-product-id" content="airpods-4">', page)

    def test_migration_is_additive_only(self):
        sql = (ROOT / "migrations" / "2026-11-08-analytics-v2.sql").read_text(encoding="utf-8")
        statements = [s for s in re.sub(r"--.*", "", sql).upper().split(";") if s.strip()]
        for s in statements:
            self.assertRegex(s.strip(), r"^(ALTER TABLE \w+ ADD COLUMN|CREATE (UNIQUE )?INDEX IF NOT EXISTS|CREATE TABLE IF NOT EXISTS)")
        self.assertNotRegex(sql.upper(), r"\b(DROP|DELETE|UPDATE|TRUNCATE)\b(?![^\n]*--)")
        # La migration s'applique sur le schéma présumé sans perdre de lignes.
        db = sqlite3.connect(":memory:")
        db.executescript((ROOT / "migrations" / "0000-schema-reference.sql").read_text(encoding="utf-8"))
        db.executescript((ROOT / "migrations" / "2026-11-06-traffic-attribution-country.sql").read_text(encoding="utf-8"))
        db.execute("INSERT INTO page_views (page_path, visitor_id) VALUES ('/', 'ancienne-ligne-1')")
        # La base réelle possède déjà ses index created_at : la migration ne doit pas en ajouter de doublons.
        indexes_before = db.execute("SELECT tbl_name, COUNT(*) FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND sql LIKE '%created_at%' GROUP BY tbl_name ORDER BY tbl_name").fetchall()
        db.executescript(sql)
        indexes_after = db.execute("SELECT tbl_name, COUNT(*) FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND sql LIKE '%created_at%' GROUP BY tbl_name ORDER BY tbl_name").fetchall()
        self.assertEqual(indexes_after, indexes_before)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM page_views").fetchone()[0], 1)


class AmazonReportImportTests(unittest.TestCase):
    FRENCH = "Rapport tendances quotidiennes\n\nDate;Clics;Articles commandés;Articles expédiés;Revenus;Gains\n01/11/2026;12;1;1;49,90 €;1,50 €\n02/11/2026;9;0;0;0,00 €;0,00 €\nTotal;21;1;1;49,90;1,50\n"
    ENGLISH = "Date,Tracking ID,Clicks,Ordered Items,Shipped Items,Revenue,Earnings\n2026-11-03,prixbasmalin2-21,7,2,1,\"1,234.50\",30.10\n"

    def test_french_report(self):
        rows = report.parse_report(self.FRENCH)
        self.assertEqual(len(rows), 2, "la ligne Total est ignorée")
        self.assertEqual(rows[0]["report_date"], "2026-11-01")
        self.assertEqual(rows[0]["tracking_id"], TAG)
        self.assertEqual((rows[0]["clicks"], rows[0]["ordered_items"], rows[0]["earnings_eur"]), (12, 1, 1.5))

    def test_english_report_and_idempotent_sql(self):
        rows = report.parse_report(self.ENGLISH)
        self.assertEqual(rows[0]["revenue_eur"], 1234.5)
        sql = report.to_sql(rows, "rapport.csv")
        db = sqlite3.connect(":memory:")
        db.executescript((ROOT / "migrations" / "0000-schema-reference.sql").read_text(encoding="utf-8"))
        db.executescript((ROOT / "migrations" / "2026-11-06-traffic-attribution-country.sql").read_text(encoding="utf-8"))
        db.executescript((ROOT / "migrations" / "2026-11-08-analytics-v2.sql").read_text(encoding="utf-8"))
        db.executescript(sql)
        db.executescript(sql)  # réimporter le même rapport ne crée pas de doublon
        self.assertEqual(db.execute("SELECT COUNT(*), SUM(ordered_items) FROM amazon_reports").fetchone(), (1, 2))

    def test_unknown_format_is_refused(self):
        with self.assertRaises(ValueError):
            report.parse_report("Produit,Prix\nAirPods,129\n")


if __name__ == "__main__":
    unittest.main()

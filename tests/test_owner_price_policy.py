"""Garde-fou demandé par le propriétaire le 23/11/2026 (voir AGENTS.md) :
les prix des flux marchands restent affichés, datés et « à confirmer »."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class OwnerPricePolicyTest(unittest.TestCase):
    def test_gift_cards_keep_listed_feed_price(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("giftListedPrice", html)
        self.assertIn("à confirmer", html)

    def test_catalogue_keeps_listed_feed_price(self):
        html = (ROOT / "catalogue.html").read_text(encoding="utf-8")
        self.assertIn("pmListedPriceIsRecent", html)

    def test_partner_picks_keep_feed_price(self):
        src = (ROOT / "scripts" / "build_home_showcase.py").read_text(encoding="utf-8")
        self.assertIn("def partner_picks", src)
        self.assertIn("à confirmer", src)

    def test_awin_monitor_counts_listed_feed_prices_separately(self):
        workflow = (ROOT / ".github" / "workflows" / "sync-awin-products.yml").read_text(encoding="utf-8")
        self.assertIn("listed_price_eur", workflow)
        self.assertIn("listed_price_date", workflow)
        self.assertIn("prix du flux datés affichables", workflow)
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("giftListedPrice", html)
        self.assertIn("Flux marchand du", html)
        self.assertIn("à confirmer", html)

    def test_production_monitor_uses_current_seo_heading(self):
        workflow = (ROOT / ".github" / "workflows" / "monitor-production.yml").read_text(encoding="utf-8")
        self.assertIn("Prix AirPods 4 : comparatif", workflow)

    def test_agents_instructions_present(self):
        self.assertIn("NE PAS MASQUER", (ROOT / "AGENTS.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

"""Contrats de sécurité et de rendu des emplacements publicitaires partenaires."""
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "partner-ads.json"
SCRIPT = ROOT / "js" / "partner-ads.js"
STYLE = ROOT / "css" / "partner-ads.css"


class PartnerAdsTests(unittest.TestCase):
    def test_campaign_inventory_starts_empty_and_has_explicit_schema(self):
        data = json.loads(DATA.read_text(encoding="utf-8"))
        self.assertEqual(data.get("schema_version"), 1)
        self.assertEqual(data.get("campaigns"), [])
        self.assertTrue(data.get("notes"))

    def test_only_real_site_pages_expose_hidden_slots(self):
        pages = {
            "index.html": "home-top",
            "catalogue.html": "catalogue-inline",
        }
        for filename, placement in pages.items():
            html = (ROOT / filename).read_text(encoding="utf-8")
            self.assertIn(f'data-pm-ad-slot="{placement}"', html)
            self.assertIn('class="pm-partner-ad-slot"', html)
            self.assertIn('href="/css/partner-ads.css"', html)
            self.assertIn('src="/js/partner-ads.js"', html)
            self.assertRegex(html, r'<(?:aside|section)[^>]*data-pm-ad-slot="' + placement + r'"[^>]*hidden')

    def test_loader_requires_manual_approval_status_and_date_window(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('campaign.status !== "active"', source)
        self.assertIn("campaign.approved !== true", source)
        self.assertIn("Date.parse(campaign.starts_at || \"\")", source)
        self.assertIn("Date.parse(campaign.ends_at || \"\")", source)
        self.assertIn("start <= now && now <= end", source)

    def test_loader_restricts_destinations_and_creatives(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('url.protocol === "https:"', source)
        self.assertIn("url.origin !== window.location.origin", source)
        self.assertIn('url.pathname.startsWith("/assets/ads/")', source)
        self.assertIn('card.rel = "sponsored nofollow noopener noreferrer"', source)
        self.assertIn("slot.hidden = false", source)
        self.assertIn("slot.replaceChildren(card)", source)
        self.assertNotIn("innerHTML", source)

    def test_copy_is_inserted_as_text_and_script_is_valid(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("element.textContent = text", source)
        subprocess.run(["node", "--check", str(SCRIPT)], check=True)

    def test_styles_keep_slots_hidden_and_responsive(self):
        style = STYLE.read_text(encoding="utf-8")
        self.assertIn(".pm-partner-ad-slot[hidden]", style)
        self.assertIn("@media (max-width: 600px)", style)
        self.assertIn("grid-template-columns", style)


if __name__ == "__main__":
    unittest.main()

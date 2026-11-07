import unittest
from pathlib import Path

INDEX = Path(__file__).resolve().parents[1] / "index.html"
WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "monitor-production.yml"


class HomepageOffersTests(unittest.TestCase):
    def setUp(self):
        self.source = INDEX.read_text(encoding="utf-8")

    def test_loader_in_head_waits_for_the_product_list(self):
        loader = self.source.index('<script id="pm-history-comparisons-loader">')
        wait = self.source.index('document.addEventListener("DOMContentLoaded",resolve,{once:true})', loader)
        lookup = self.source.index('document.getElementById("pm-history-list")', loader)
        self.assertLess(wait, lookup)

    def test_each_price_comparison_has_an_affiliate_link(self):
        self.assertIn('buy.textContent="Voir sur Amazon ↗";', self.source)
        self.assertIn('more.textContent="Voir les "+sheet.offer_count+" relevés →";', self.source)
        self.assertIn('"&tag=prixbasmalin2-21"', self.source)
        self.assertIn('buy.rel="sponsored nofollow noopener noreferrer";', self.source)

    def test_historical_price_data_is_not_joined_to_home_cards_by_name(self):
        self.assertNotIn("sheetsReady", self.source)
        self.assertNotIn("pmPriced", self.source)
        self.assertNotIn("norm(s.name)", self.source)
        self.assertNotIn("cdn8.web4s.vn", self.source)

    def test_history_section_is_labelled_as_historical(self):
        self.assertIn("Relevés historiques PrixTracker chez 5 à 24 marchands", self.source)
        self.assertIn("Prix le plus bas observé", self.source)
        self.assertIn("Voir les "+'"+sheet.offer_count+"'+ " relevés", self.source)
        self.assertIn("Prix historiques ; liens marchands directs et stock non fournis", self.source)

    def test_merchant_ids_are_shown_with_readable_names(self):
        self.assertIn('shop.textContent=pmMerchantLabel(offer.merchant);', self.source)
        self.assertIn('bestShop.textContent="chez "+pmMerchantLabel(best.merchant);', self.source)

    def test_homepage_live_prices_require_fresh_merchant_dates_and_explicit_ttc(self):
        self.assertIn("fresh(p.merchantUpdatedAt)", self.source)
        self.assertIn('p.priceTaxStatus==="included"||p.price_tax_status==="included"', self.source)
        self.assertIn("fresh(p.sourceCreatedAt)", self.source)
        self.assertIn('p.priceTaxStatus==="included"', self.source)
        self.assertIn("liveCheckedAt:p.merchantUpdatedAt", self.source)
        self.assertNotIn("liveCheckedAt:p.merchantUpdatedAt||awin.fetched_at", self.source)
        self.assertNotIn("p.sourceCreatedAt||rakuten.generated_at", self.source)
        self.assertNotIn("liveDateFromFeed", self.source)
        self.assertIn("Aucun prix TTC frais et confirmé n'est actuellement disponible", self.source)

    def test_homepage_fallback_rotation_uses_only_unique_verified_photos(self):
        self.assertIn("const seenFallbackImages=new Set();", self.source)
        self.assertIn("!seenFallbackImages.has(p.image)", self.source)
        self.assertIn("const rotationSlot=Math.floor(now/maxAge);", self.source)
        self.assertIn("const fallbackBatchSize=Math.min(6,fallbackPool.length);", self.source)
        self.assertIn('list.dataset.pmRotationProductIds=chosen.map(p=>p.id).join(",");', self.source)

    def test_no_literal_backslash_n_is_rendered_in_the_page(self):
        self.assertNotIn("</script>\\n</head>", self.source)

    def test_post_publish_monitor_checks_new_home_and_catalogue_safeguards(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("Vérifier les garde-fous prix et le rail mobile après publication", workflow)
        self.assertIn("if: github.event_name != 'pull_request'", workflow)
        self.assertIn("pm-mobile-new-arrivals-rail", workflow)
        self.assertIn("Prix TTC vérifié indisponible", workflow)
        self.assertIn("Publication GitHub Pages encore en propagation", workflow)


if __name__ == "__main__":
    unittest.main()

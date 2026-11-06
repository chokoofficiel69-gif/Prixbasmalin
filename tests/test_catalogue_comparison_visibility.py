import unittest
from pathlib import Path

CATALOGUE = Path(__file__).resolve().parents[1] / "catalogue.html"


class CatalogueComparisonVisibilityTests(unittest.TestCase):
    def test_technical_feed_status_is_not_shown_to_visitors(self):
        # Décision produit : les diagnostics techniques du flux ne sont plus affichés au public.
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertNotIn('id="pmAwinFeedStatus"', source)
        self.assertIn('#pmAwinFeedStatus,', source)

    def test_verified_comparison_shelf_stays_hidden_until_it_has_offers(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('<section id="verifiedShelf" class="verified-shelf" aria-live="polite" hidden>', source)
        self.assertIn('verifiedShelf.hidden=false;', source)

    def test_comparison_requires_eur_ttc_and_recent_merchant_date(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('offer.currency!=="EUR"||offer.price_tax_status!=="included"', source)
        self.assertIn('age<=maxAgeHours*60*60*1000', source)

    def test_each_comparison_has_a_direct_merchant_link_and_availability(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('merchantLink.href=offerData.url||offerData.product_url;', source)
        self.assertIn('price_tax_status:offer.priceTaxStatus==="included"||offer.price_tax_status==="included"?', source)
        self.assertNotIn('||product.priceTaxStatus==="included"', source)
        self.assertIn('merchantLink.textContent="Voir chez le marchand ↗";', source)
        self.assertIn('const availability=offerData.availability||"unknown";', source)
        self.assertIn('o.merchant||o.merchant_name||o.retailer', source)
        self.assertIn('o.url||o.product_url', source)

    def test_merchant_offers_are_horizontal_and_scrollable(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('#verifiedProducts .verified-offers{display:flex!important;flex-flow:row nowrap!important;', source)
        self.assertIn('overflow-x:auto!important', source)
        self.assertIn('scroll-snap-type:x mandatory!important', source)


if __name__ == "__main__":
    unittest.main()

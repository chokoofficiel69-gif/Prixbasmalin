import unittest
from pathlib import Path

INDEX = Path(__file__).resolve().parents[1] / "index.html"


class HomepageOffersTests(unittest.TestCase):
    def setUp(self):
        self.source = INDEX.read_text(encoding="utf-8")

    def test_loader_in_head_waits_for_the_product_list(self):
        loader = self.source.index('<script id="pm-history-comparisons-loader">')
        wait = self.source.index('document.addEventListener("DOMContentLoaded",resolve,{once:true})', loader)
        lookup = self.source.index('document.getElementById("pm-history-list")', loader)
        self.assertLess(wait, lookup)

    def test_each_price_comparison_has_an_affiliate_link(self):
        self.assertIn('buy.textContent="Voir les offres sur Amazon ↗";', self.source)
        self.assertIn('"&tag=prixbasmalin2-21"', self.source)
        self.assertIn('buy.rel="sponsored nofollow noopener noreferrer";', self.source)

    def test_merchant_ids_are_shown_with_readable_names(self):
        self.assertIn('merchant.textContent=pmMerchantLabel(offer.merchant);', self.source)

    def test_older_feed_prices_are_dated_and_marked_to_confirm(self):
        self.assertIn("à confirmer chez le marchand", self.source)

    def test_no_literal_backslash_n_is_rendered_in_the_page(self):
        self.assertNotIn("</script>\\n</head>", self.source)


if __name__ == "__main__":
    unittest.main()

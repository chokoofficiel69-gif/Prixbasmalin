import unittest
from pathlib import Path

CATALOGUE = Path(__file__).resolve().parents[1] / "catalogue.html"


class CatalogueProductCardTests(unittest.TestCase):
    def setUp(self):
        self.source = CATALOGUE.read_text(encoding="utf-8")

    def test_card_shows_price_first_then_cta_then_comparison_table(self):
        self.assertIn("body.append(top,name,priceBox,note,amazonButton,compare,amazonSearchButton,specs);", self.source)
        self.assertIn('offerList.className="pm-c2-offers";', self.source)
        self.assertIn('best.textContent="Meilleur prix total";', self.source)

    def test_amazon_search_is_separate_from_real_merchant_offers(self):
        self.assertNotIn('rows.push({merchant:"Amazon",price:null,', self.source)
        self.assertIn('amazonSearchButton.textContent="Rechercher aussi sur Amazon (prix à confirmer) ↗";', self.source)
        self.assertIn('tag:"prixbasmalin2-21"', self.source)
        self.assertIn('const rawFeedOffers=Array.isArray(p.offers)', self.source)
        self.assertIn('taxStatus==="included"', self.source)

    def test_cheapest_label_requires_multiple_offers_with_known_shipping(self):
        self.assertIn("const canRankByTotal=rows.length>1&&rows.every(row=>row.shipping!==null);", self.source)
        self.assertIn("const isBest=canRankByTotal&&rowIndex===0;", self.source)

    def test_card_prices_require_fresh_merchant_date_and_explicit_ttc(self):
        self.assertIn('p.priceStatus==="fresh"', self.source)
        self.assertIn('p.priceTaxStatus==="included"', self.source)
        self.assertIn("pmAwinPriceIsFresh(updateValue)", self.source)
        self.assertIn('"Prix TTC vérifié indisponible"', self.source)

    def test_irrelevant_brand_chips_and_empty_sections_are_gone(self):
        self.assertNotIn('brandsLabel.textContent="Marques à comparer";', self.source)
        self.assertIn("if(!rail.children.length)return;", self.source)


    def test_filter_panel_uses_real_data_and_hooks_into_render(self):
        self.assertIn('<script id="pm-filter-panel">', self.source)
        self.assertIn('if(typeof window.pmFilterPasses==="function"&&!window.pmFilterPasses(p))return false;', self.source)
        self.assertIn('if(typeof window.pmSortOverride==="function")window.pmSortOverride(found);', self.source)
        self.assertIn('"🚚 Livraison gratuite"', self.source)
        # Pas de faux avis ni de fausses réductions : aucune donnée de ce type dans les flux.
        self.assertNotIn("4 étoiles et plus", self.source)


if __name__ == "__main__":
    unittest.main()

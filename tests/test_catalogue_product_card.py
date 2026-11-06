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
        self.assertIn('const taxStatus=offer.priceTaxStatus||offer.price_tax_status;', self.source)
        self.assertNotIn('offer.priceTaxStatus||offer.price_tax_status||p.priceTaxStatus', self.source)

    def test_cheapest_label_requires_multiple_offers_with_known_shipping(self):
        self.assertIn("const canRankByTotal=rows.length>1&&rows.every(row=>row.shipping!==null);", self.source)
        self.assertIn("const isBest=canRankByTotal&&rowIndex===0;", self.source)

    def test_card_prices_require_fresh_merchant_date_and_explicit_ttc(self):
        self.assertIn('p.priceStatus==="fresh"', self.source)
        self.assertIn('p.priceTaxStatus==="included"', self.source)
        self.assertIn("pmAwinPriceIsFresh(updateValue)", self.source)

    def test_listed_feed_price_is_shown_dated_but_never_ranked_best(self):
        # Compromis validé par le propriétaire : le prix public du flux reste visible avec sa date,
        # mais seules les offres TTC fraîches entrent dans les comparaisons et « Meilleur prix total ».
        self.assertIn("listedPriceValue:hasPrice?Number(product.priceValue):null", self.source)
        self.assertIn("priceValue:priceStatus===\"fresh\"?Number(product.priceValue):null", self.source)
        self.assertIn('listedSourceText+" — à confirmer sur son site."', self.source)
        self.assertIn('offer.className="pm-c2-offer pm-c2-offer-listed";', self.source)
        self.assertIn("const isBest=canRankByTotal&&rowIndex===0;", self.source)

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


    def test_browsing_only_shows_products_with_photo_and_price(self):
        self.assertIn("if(!q)return pmHasRealProductImage(p)&&pmProductHasAnyPrice(p);", self.source)
        self.assertIn("function pmProductHasAnyPrice(product){", self.source)

    def test_catalogue_products_reuse_comparison_sheets_by_exact_name(self):
        self.assertIn('<script id="pm-product-sheets-link">', self.source)
        self.assertIn("index.get(norm(product.name))||index.get(norm((product.brand||\"\")+\" \"+product.name))", self.source)
        self.assertIn('amazonButton.textContent="Comparer les "+sheet.offer_count+" offres →";', self.source)
        created = self.source.index('const merchantBadge=document.createElement("span")')
        overridden = self.source.index('if(sheet)merchantBadge.textContent=')
        sheet_defined = self.source.index("const sheet=!hasVerifiedPrice&&listedPrice===null")
        self.assertLess(created, overridden)
        self.assertLess(sheet_defined, overridden)


if __name__ == "__main__":
    unittest.main()

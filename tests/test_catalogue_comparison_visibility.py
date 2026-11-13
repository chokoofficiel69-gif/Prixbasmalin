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
        self.assertIn('if(!usable.length){\n    verifiedShelf.hidden=true;\n    verifiedProductsEl.innerHTML="";\n    return;\n  }', source)
        self.assertIn('verifiedShelf.hidden=false;', source)

    def test_verified_comparison_shelf_is_not_unconditionally_hidden_by_css(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('#verifiedShelf[hidden]', source)
        self.assertNotIn('#verifiedShelf,.pm-feed-status', source)
        self.assertNotIn('#verifiedShelf,', source)

    def test_comparison_requires_eur_and_recent_merchant_date_with_tax_warning(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('if(!offer||offer.stale||offer.currency!=="EUR")return false;', source)
        self.assertIn('TVA non confirmée', source)
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

    def test_awin_publication_check_matches_the_current_public_shelf(self):
        workflow = (CATALOGUE.parent / ".github" / "workflows" / "sync-awin-products.yml").read_text(encoding="utf-8")
        self.assertNotIn("grep -q 'id=\"pmAwinFeedStatus\"'", workflow)
        self.assertNotIn("Aucune comparaison multi-marchands exacte avec prix TTC confirmé", workflow)
        self.assertIn("grep -Fq 'id=\"verifiedShelf\" class=\"verified-shelf\" aria-live=\"polite\" hidden'", workflow)
        self.assertIn("grep -Fq 'verifiedShelf.hidden=true;'", workflow)
        self.assertIn('grep -Fq \'offer.currency!=="EUR")return false;\'', workflow)
        self.assertIn("grep -Fq 'TVA non confirmée'", workflow)
        self.assertIn("grep -Fq 'age<=maxAgeHours*60*60*1000'", workflow)

    def test_merchant_offers_are_horizontal_and_scrollable(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('#verifiedProducts .verified-offers{display:flex!important;flex-flow:row nowrap!important;', source)
        self.assertIn('overflow-x:auto!important', source)
        self.assertIn('scroll-snap-type:x mandatory!important', source)

    def test_search_ranking_counts_only_fresh_eur_ttc_offers(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("const pmVerifiedMerchantCount=product=>", source)
        self.assertIn('currency!=="EUR"', source)
        self.assertIn('taxStatus!=="included"', source)
        self.assertIn('!pmAwinPriceIsFresh(checkedAt)', source)
        self.assertIn("multiMerchant:hasPrice&&merchantCount>1", source)
        self.assertIn('const hasPrice=product.priceStatus==="fresh"&&', source)
        self.assertIn("shippingKnown,\n      total:hasPrice?", source)

    def test_each_merchant_offer_requires_its_own_fresh_timestamp(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('const checkedAt=offer.merchantUpdatedAt||offer.checked_at||"";', source)
        self.assertNotIn('offer.merchantUpdatedAt||offer.checked_at||p.merchantUpdatedAt||p.sourceCreatedAt', source)
        self.assertNotIn('offer.merchantUpdatedAt||product.merchantUpdatedAt', source)
        self.assertIn('const merchantUpdatedAt=product.merchantUpdatedAt||"";', source)
        self.assertNotIn('product.merchantUpdatedAt||product.sourceCreatedAt', source)
        self.assertNotIn('p.merchantUpdatedAt||p.sourceCreatedAt', source)
        self.assertIn('const url=offer.url||offer.product_url||"";', source)
        self.assertIn('const ship=shippingOf(offer.shippingPriceValue??offer.shipping_price_eur);', source)
        self.assertNotIn('offer.url||offer.product_url||p.sourceUrl', source)
        self.assertNotIn('offer.shipping_price_eur??p.shippingPriceValue', source)
        self.assertIn('Boolean(merchant)&&', source)

    def test_related_suggestions_are_only_added_when_no_exact_text_match_exists(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn('if(q&&exactMatchCount===0&&found.length<20&&relatedRule&&!selectedBrand)', source)
        self.assertIn('name.textContent=p.name+(p._pmRelatedSuggestion?" • suggestion proche":"");', source)


if __name__ == "__main__":
    unittest.main()

import unittest
from pathlib import Path

CATALOGUE = Path(__file__).resolve().parents[1] / "catalogue.html"


class CatalogueProductCardTests(unittest.TestCase):
    def setUp(self):
        self.source = CATALOGUE.read_text(encoding="utf-8")

    def test_card_shows_price_first_then_cta_then_comparison_table(self):
        self.assertIn("body.append(top,name,priceBox,note,amazonButton,compare,specs);", self.source)
        self.assertIn('table.className="pm-c2-table";', self.source)

    def test_comparison_table_adds_amazon_affiliate_search_without_inventing_a_price(self):
        self.assertIn('rows.push({merchant:"Amazon",price:null,', self.source)
        self.assertIn('tag:"prixbasmalin2-21"', self.source)
        self.assertIn('row.price!==null?money(row.price):"Voir le prix"', self.source)

    def test_cheapest_label_only_when_several_priced_offers(self):
        self.assertIn("rowIndex===0&&row.price!==null&&pricedCount>1", self.source)

    def test_irrelevant_brand_chips_and_empty_sections_are_gone(self):
        self.assertNotIn('brandsLabel.textContent="Marques à comparer";', self.source)
        self.assertIn("if(!rail.children.length)return;", self.source)


if __name__ == "__main__":
    unittest.main()

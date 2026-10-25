import unittest
from pathlib import Path


CATALOGUE = Path(__file__).resolve().parents[1] / "catalogue.html"


class CatalogueComparablePriceTests(unittest.TestCase):
    def test_verified_offers_use_total_price_when_available(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("function verifiedComparablePrice(offer)", source)
        self.assertIn("if(Number.isFinite(total)&&total>=0)return total;", source)
        self.assertIn("return Number.isFinite(base)&&base>=0?base:NaN;", source)

    def test_verified_offers_are_sorted_and_displayed_by_comparable_price(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("const byComparablePrice=(a,b)=>verifiedComparablePrice(a)-verifiedComparablePrice(b);", source)
        self.assertIn(".sort(byComparablePrice)", source)
        self.assertIn(".format(bestComparablePrice)", source)
        self.assertIn(".format(verifiedComparablePrice(offerData))", source)

    def test_known_shipping_cost_is_explained_to_the_user(self):
        source = CATALOGUE.read_text(encoding="utf-8")
        self.assertIn("function verifiedPriceBreakdown(offer)", source)
        self.assertIn('"Produit "+money(base)+" + livraison "+money(shipping)', source)
        self.assertIn("Comparaison frais de livraison inclus lorsqu’ils sont connus.", source)


if __name__ == "__main__":
    unittest.main()

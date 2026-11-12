import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


GOOD = {
    "intro": "Avant d’acheter, comparez la référence exacte et le prix final livraison comprise chez plusieurs marchands.",
    "criteres": ["Vérifiez la référence exacte du modèle.", "Comparez les frais de livraison.", "Lisez les conditions de retour."],
    "faq": [{"q": "Faut-il acheter neuf ou reconditionné ?", "a": "Le neuf offre la garantie constructeur complète."},
            {"q": "Comment éviter les mauvaises surprises ?", "a": "Contrôlez le vendeur et la politique de retour."}],
}


class AiGuidesTest(unittest.TestCase):
    def test_valid_guide_is_kept(self):
        g = load("generate_ai_guides")
        self.assertEqual(g.validate(GOOD)["criteres"][0], "Vérifiez la référence exacte du modèle.")

    def test_numbers_prices_and_promos_are_rejected(self):
        g = load("generate_ai_guides")
        for bad in ("Il coûte 129 € chez Amazon.", "Une remise de dix % est fréquente.", "Profitez de la promo du moment."):
            self.assertIsNone(g.validate({**GOOD, "intro": GOOD["intro"] + " " + bad}), bad)
        self.assertIsNone(g.validate({**GOOD, "intro": GOOD["intro"] + " <script>"}))
        self.assertIsNone(g.validate({**GOOD, "faq": GOOD["faq"][:1]}))
        self.assertIsNone(g.validate("pas un objet"))

    def test_only_explicitly_free_models_are_selected(self):
        g = load("generate_ai_guides")
        models = [
            "meta-llama/llama-3.3-70b-instruct",
            "openai/gpt-oss-120b",
            "meta-llama/llama-3.3-70b-instruct:free",
            "whisper-large-v3",
        ]
        self.assertEqual(g.pick_model(models, free_only=True), "meta-llama/llama-3.3-70b-instruct:free")
        self.assertIsNone(g.pick_model(["openai/gpt-oss-120b", "llama-3.3-70b"], free_only=True))
        self.assertIsNone(g.pick_model(["whisper-large-v3"], free_only=True))

    def test_call_refuses_paid_or_unapproved_providers_before_network(self):
        g = load("generate_ai_guides")
        with self.assertRaises(ValueError):
            g.call(("groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1", "llama-3.3-70b"), {})
        with self.assertRaises(ValueError):
            g.call(("openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", "meta-llama/llama-3.3-70b-instruct"), {})

    def test_no_key_means_no_change(self):
        g = load("generate_ai_guides")
        import os
        saved = {k: os.environ.pop(k) for k in [p[1] for p in g.PROVIDERS] if k in os.environ}
        try:
            self.assertEqual(g.main(), 0)
        finally:
            os.environ.update(saved)

    def test_product_page_shows_guide_and_faq(self):
        seo = load("build_seo_pages")
        data = json.loads((ROOT / "data" / "fiches-produits.json").read_text(encoding="utf-8"))
        p = data["products"][0]
        html = seo.product_page(p, data["products"], data["dataset_period"], GOOD)
        self.assertIn("Conseils avant d’acheter", html)
        self.assertIn("Faut-il acheter neuf ou reconditionné ?", html)
        self.assertIn('"name": "Faut-il acheter neuf ou reconditionné ?"', html)
        self.assertNotIn("Conseils avant d’acheter", seo.product_page(p, data["products"], data["dataset_period"]))



    def test_empty_or_missing_model_content_is_a_recoverable_value_error(self):
        import io
        import os
        from unittest.mock import patch

        g = load("generate_ai_guides")
        provider = ("openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", "example:free")
        product = {"name": "Produit test", "brand": "Marque test", "category_label": "Audio", "offer_count": 1}
        payloads = [
            {"choices": [{"message": {"content": None}}]},
            {"choices": [{"message": {"content": ""}}]},
            {"choices": []},
            None,
        ]
        for payload in payloads:
            with self.subTest(payload=payload), patch.dict(os.environ, {"OPENROUTER_API_KEY": "test"}):
                response = io.BytesIO(json.dumps(payload).encode("utf-8"))
                with patch.object(g.urllib.request, "urlopen", return_value=response):
                    with self.assertRaisesRegex(ValueError, "sans contenu textuel exploitable"):
                        g.call(provider, product)

if __name__ == "__main__":
    unittest.main()

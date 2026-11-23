from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "docs" / "black-friday-social-pack-2026.md"


class BlackFridaySocialPackTests(unittest.TestCase):
    def test_countdown_targets_the_five_days_before_black_friday(self):
        text = PACK.read_text(encoding="utf-8")
        self.assertIn("Sprint prioritaire du 23 au 27 novembre 2026", text)
        for target in (
            "/prix/ps5-slim.html",
            "/prix/ps5-pro.html",
            "/prix/gta-6-ps5.html",
            "/prix/switch-2.html",
            "/prix/airpods-pro-3.html",
            "/prix/iphone-17.html",
        ):
            self.assertIn(target, text)
        self.assertIn("BFCM35", text)
        self.assertIn("35 % de réduction", text)
        self.assertIn("26 novembre au 1er décembre 2026", text)

    def test_each_countdown_link_has_network_specific_utm_parameters(self):
        text = PACK.read_text(encoding="utf-8")
        contents = (
            "ps5-gta6",
            "switch2-countdown",
            "airpodspro3-countdown",
            "jowissa-bfcm35",
            "iphone17-blackfriday",
        )
        for content in contents:
            for source in ("facebook", "instagram", "tiktok"):
                self.assertIn(
                    f"utm_source={source}&utm_medium=social&utm_campaign=black_friday_2026&utm_content={content}",
                    text,
                )

    def test_social_posts_keep_visitors_on_prix_malin(self):
        text = PACK.read_text(encoding="utf-8")
        sprint = text.split("## Sprint prioritaire du 23 au 27 novembre 2026", 1)[1].split("## Banque de 7 publications", 1)[0]
        self.assertNotIn("awin1.com", sprint)
        self.assertIn("https://prixbasmalin.fr/black-friday.html#codes-promo", sprint)


if __name__ == "__main__":
    unittest.main()

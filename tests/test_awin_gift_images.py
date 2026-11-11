import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "check_awin_gift_images", ROOT / "scripts" / "check_awin_gift_images.py"
)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class FakeResponse:
    def __init__(self, status=206, content_type="image/webp", content_length="2048",
                 content_range="bytes 0-2047/4096", sample=b"image-bytes"):
        self.status = status
        self.headers = {
            "Content-Type": content_type,
            "Content-Length": content_length,
            "Content-Range": content_range,
        }
        self.sample = sample

    def getcode(self):
        return self.status

    def read(self, size):
        return self.sample[:size]

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class AwinGiftImageTests(unittest.TestCase):
    def test_accepts_reachable_image_range_response(self):
        with patch.object(checker, "urlopen", return_value=FakeResponse()):
            self.assertEqual(checker.check_image_url("https://cdn.example/item.webp"), "ok")

    def test_rejects_html_empty_and_oversized_images(self):
        with patch.object(checker, "urlopen", return_value=FakeResponse(content_type="text/html")):
            self.assertEqual(checker.check_image_url("https://cdn.example/page"), "invalid")
        with patch.object(checker, "urlopen", return_value=FakeResponse(sample=b"")):
            self.assertEqual(checker.check_image_url("https://cdn.example/empty.webp"), "invalid")
        with patch.object(checker, "urlopen", return_value=FakeResponse(status=200, content_length=str(13 * 1024 * 1024))):
            self.assertEqual(checker.check_image_url("https://cdn.example/huge.webp"), "invalid")

    def test_distinguishes_permanent_http_failure_from_temporary_failure(self):
        permanent = HTTPError("https://cdn.example/missing.webp", 404, "Not Found", None, None)
        temporary = HTTPError("https://cdn.example/busy.webp", 503, "Service Unavailable", None, None)
        with patch.object(checker, "urlopen", side_effect=permanent):
            self.assertEqual(checker.check_image_url("https://cdn.example/missing.webp"), "invalid")
        with patch.object(checker, "urlopen", side_effect=temporary):
            self.assertEqual(checker.check_image_url("https://cdn.example/busy.webp"), "transient")

    def test_transient_error_preserves_only_recently_verified_images(self):
        now = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)
        data = {"gifts": [
            {"image": "https://cdn.example/recent.webp", "image_verified": True,
             "image_verified_at": "2026-11-10T12:00:00Z"},
            {"image": "https://cdn.example/old.webp", "image_verified": True,
             "image_verified_at": "2026-11-08T12:00:00Z"},
            {"image": "https://cdn.example/new.webp", "image_verified": False},
        ]}
        checked, summary = checker.apply_image_checks(data, {
            "https://cdn.example/recent.webp": "transient",
            "https://cdn.example/old.webp": "transient",
            "https://cdn.example/new.webp": "transient",
        }, now=now)
        recent, old, new = checked["gifts"]
        self.assertTrue(recent["image_verified"])
        self.assertEqual(recent["image_check_status"], "transient-preserved")
        self.assertFalse(old["image_verified"])
        self.assertFalse(new["image_verified"])
        self.assertEqual(summary["preserved_after_transient"], 1)

    def test_success_marks_duplicate_cards_verified_without_touching_prices(self):
        now = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)
        url = "https://cdn.example/shared.webp"
        data = {"gifts": [
            {"image": url, "price_verified": False, "price_eur": None},
            {"image": url, "price_verified": False, "price_eur": None},
        ]}
        checked, summary = checker.apply_image_checks(data, {url: "ok"}, now=now)
        self.assertTrue(all(gift["image_verified"] for gift in checked["gifts"]))
        self.assertTrue(all(gift["image_provenance"] == "Flux marchand Awin autorisé" for gift in checked["gifts"]))
        self.assertTrue(all(gift["price_eur"] is None and not gift["price_verified"] for gift in checked["gifts"]))
        self.assertEqual(summary["unique_urls"], 1)
        self.assertEqual(summary["verified_gifts"], 2)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Check that every verified homepage product image is actually reachable."""
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FEED = ROOT / "data" / "home-products.json"
VERIFIED_IMAGE_STATUSES = {
    "manufacturer_verified", "official_press_image",
    "retailer_product_image", "authorized_feed_image",
}


def main():
    feed = json.loads(FEED.read_text(encoding="utf-8"))
    urls = {}
    for product in feed.get("products", []):
        image = product.get("image")
        if (
            product.get("imageStatus") in VERIFIED_IMAGE_STATUSES
            and isinstance(image, str)
            and image.startswith("https://")
            and "unsplash.com" not in image.lower()
            and product.get("imageKind") != "illustration"
        ):
            urls.setdefault(image, []).append(str(product.get("id", "sans-id")))

    if not urls:
        raise SystemExit("ERREUR : aucun visuel produit vérifié à contrôler")

    failures = []
    for image_url, product_ids in urls.items():
        request = Request(
            image_url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; PrixMalinImageCheck/1.0)",
                "Range": "bytes=0-2047",
            },
        )
        try:
            with urlopen(request, timeout=12) as response:
                status = response.getcode()
                content_type = (response.headers.get("Content-Type") or "").split(";")[0].lower()
                sample = response.read(2048)
                if status not in (200, 206) or not content_type.startswith("image/") or not sample:
                    failures.append((product_ids, status, content_type, "réponse non image ou vide"))
                else:
                    print(f"OK {status} {content_type} — {', '.join(product_ids)}")
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            code = getattr(exc, "code", "réseau")
            failures.append((product_ids, code, "", str(exc)[:180]))

    passed = len(urls) - len(failures)
    print(f"Images vérifiées : {len(urls)} uniques, {passed} accessibles, {len(failures)} en échec.")
    for product_ids, status, content_type, reason in failures:
        print(f"ECHEC {status} {content_type} — {', '.join(product_ids)} — {reason}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Vérifie les images des idées cadeaux Awin sans toucher aux prix ni aux liens."""
import ipaddress
import json
import re
import socket
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
FEED = ROOT / "data" / "home-deals.json"
MAX_IMAGE_BYTES = 12 * 1024 * 1024
PRESERVE_HOURS = 48
TRANSIENT_HTTP = {429, 500, 502, 503, 504}


def public_https_url_status(url):
    """Allow only public HTTPS endpoints; treat DNS outages as transient."""
    try:
        parsed = urlsplit(str(url))
        if parsed.scheme.lower() != "https" or not parsed.hostname:
            return "invalid"
        if parsed.username is not None or parsed.password is not None:
            return "invalid"
        if parsed.port not in (None, 443):
            return "invalid"
        host = parsed.hostname.rstrip(".").lower()
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            return "invalid"
        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            try:
                records = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
            except (socket.gaierror, OSError):
                return "transient"
            addresses = {record[4][0].split("%", 1)[0] for record in records}
            if not addresses:
                return "transient"
            for address in addresses:
                try:
                    if not ipaddress.ip_address(address).is_global:
                        return "invalid"
                except ValueError:
                    return "invalid"
        else:
            if not literal.is_global:
                return "invalid"
        return "ok"
    except (TypeError, ValueError):
        return "invalid"


class SafeHTTPSRedirectHandler(HTTPRedirectHandler):
    """Reject downgrade and private-network redirects before following them."""
    max_redirections = 5
    max_repeats = 2

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        status = public_https_url_status(newurl)
        if status == "transient":
            raise URLError("DNS temporairement indisponible pour la redirection image")
        if status != "ok":
            raise HTTPError(newurl, code, "Redirection image non publique ou non HTTPS", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_image_request(request, timeout):
    return build_opener(SafeHTTPSRedirectHandler()).open(request, timeout=timeout)


def parse_utc(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


PLACEHOLDER_IMAGE_PATTERN = re.compile(
    r"(?:^|[/_.-])(?:no[-_]?image|placeholder|missing[-_]?image)(?:[._/-]|$)",
    re.I,
)


def is_placeholder_image_url(url):
    """Reject known no-image assets before making any network request."""
    try:
        path = urlsplit(str(url)).path.lower()
    except ValueError:
        return True
    return bool(PLACEHOLDER_IMAGE_PATTERN.search(path))


def check_image_url(url, timeout=8):
    if not isinstance(url, str):
        return "invalid"
    if is_placeholder_image_url(url):
        return "invalid"
    initial_status = public_https_url_status(url)
    if initial_status != "ok":
        return initial_status
    request = Request(url, headers={
        "User-Agent": "PrixMalinImageHealth/1.0",
        "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "Range": "bytes=0-2047",
    })
    try:
        with open_image_request(request, timeout=timeout) as response:
            status = response.getcode()
            final_url = response.geturl() if hasattr(response, "geturl") else url
            if public_https_url_status(final_url) != "ok":
                return "invalid"
            content_type = (response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            sample = response.read(2048)
            if status not in (200, 206) or not content_type.startswith("image/") or not sample:
                return "invalid"
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_IMAGE_BYTES:
                return "invalid"
            content_range = response.headers.get("Content-Range") or ""
            if "/" in content_range:
                total = content_range.rsplit("/", 1)[1].strip()
                if total.isdigit() and int(total) > MAX_IMAGE_BYTES:
                    return "invalid"
            return "ok"
    except HTTPError as error:
        return "transient" if error.code in TRANSIENT_HTTP else "invalid"
    except (URLError, TimeoutError, OSError, ValueError):
        return "transient"


def recently_verified(gift, now):
    if gift.get("image_verified") is not True:
        return False
    verified_at = parse_utc(gift.get("image_verified_at"))
    if verified_at is None:
        return False
    age = now - verified_at
    return timedelta(minutes=-5) <= age <= timedelta(hours=PRESERVE_HOURS)


def apply_image_checks(data, results, now=None):
    now = now or datetime.now(timezone.utc)
    checked_at = now.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    preserved = 0
    for gift in data.get("gifts", []):
        image = str(gift.get("image") or "")
        result = results.get(image, "invalid")
        gift["image_provenance"] = "Flux marchand Awin autorisé"
        gift["image_checked_at"] = checked_at
        if result == "ok":
            gift["image_verified"] = True
            gift["image_verified_at"] = checked_at
            gift["image_check_status"] = "ok"
        elif result == "transient" and recently_verified(gift, now):
            gift["image_verified"] = True
            gift["image_check_status"] = "transient-preserved"
            preserved += 1
        else:
            gift["image_verified"] = False
            gift["image_check_status"] = result if result in ("invalid", "transient") else "invalid"
    summary = {
        "unique_urls": len(results),
        "reachable_urls": sum(value == "ok" for value in results.values()),
        "invalid_urls": sum(value == "invalid" for value in results.values()),
        "transient_urls": sum(value == "transient" for value in results.values()),
        "preserved_after_transient": preserved,
        "verified_gifts": sum(gift.get("image_verified") is True for gift in data.get("gifts", [])),
    }
    return data, summary


def check_urls(urls, max_workers=8):
    results = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(check_image_url, url): url for url in urls}
        for future in as_completed(futures):
            url = futures[future]
            try:
                results[url] = future.result()
            except Exception:
                results[url] = "transient"
    return results


def main():
    if not FEED.exists():
        print("data/home-deals.json absent : vérification des images impossible.", file=sys.stderr)
        return 1
    try:
        data = json.loads(FEED.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"Flux idées cadeaux invalide : {error}", file=sys.stderr)
        return 1
    gifts = data.get("gifts", [])
    urls = sorted({
        gift.get("image")
        for gift in gifts
        if isinstance(gift, dict) and isinstance(gift.get("image"), str) and gift["image"].startswith("https://")
    })
    results = check_urls(urls)
    data, summary = apply_image_checks(data, results)
    FEED.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(
        "Images idées cadeaux Awin : "
        f"{summary['unique_urls']} URL uniques testées, "
        f"{summary['reachable_urls']} accessibles, "
        f"{summary['invalid_urls']} invalides masquées, "
        f"{summary['transient_urls']} erreurs temporaires, "
        f"{summary['preserved_after_transient']} visuels conservés grâce à une vérification de moins de 48 h, "
        f"{summary['verified_gifts']} cartes utilisables."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

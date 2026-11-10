#!/usr/bin/env python3
"""Lit des lignes ssh-keyscan sur stdin et compare toutes les formes d'empreinte
aux empreintes officielles Rakuten. Diagnostic uniquement : n'accorde aucune confiance."""
import base64, hashlib, sys
from cryptography.hazmat.primitives import serialization
OFFICIAL = {"6854993e0f41078a1f007d677d298c2a4f7d5f898de149f53e27d3159e4b2bdc": "SHA256 officielle",
            "d98a0cdd102177804f99a3534a4a04c6b31ce816": "SHA1 officielle"}
hits = 0
for line in sys.stdin:
    parts = line.split()
    if len(parts) < 3 or line.startswith("#"):
        continue
    host, ktype, b64 = parts[:3]
    blob = base64.b64decode(b64)
    forms = {"blob": blob, "openssh_line": f"{ktype} {b64}".encode(), "base64_text": b64.encode()}
    try:
        pub = serialization.load_ssh_public_key(f"{ktype} {b64}".encode())
        forms["der_spki"] = pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        forms["pem_spki"] = pub.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        try:
            forms["der_pkcs1"] = pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.PKCS1)
        except Exception:
            pass
        try:
            forms["raw"] = pub.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        except Exception:
            pass
    except Exception as exc:
        print(f"{ktype}: conversion DER impossible ({exc})")
    print(f"== {ktype} ({len(blob)} octets)")
    for label, data in forms.items():
        h = {"sha256": hashlib.sha256(data).hexdigest(), "sha1": hashlib.sha1(data).hexdigest(), "md5": hashlib.md5(data).hexdigest()}
        print(f"   {label:12} SHA256={h['sha256']} SHA1={h['sha1']} MD5={h['md5']}")
        for v in h.values():
            if v in OFFICIAL:
                hits += 1
                print(f"   >>> CORRESPONDANCE {OFFICIAL[v]} : {ktype} / {label}")
print("RÉSULTAT :", f"{hits} correspondance(s)" if hits else "AUCUNE CORRESPONDANCE")

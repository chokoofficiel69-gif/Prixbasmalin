#!/usr/bin/env python3
"""Diagnostic en lecture seule des clés hôtes SFTP Rakuten.

Récupère chaque type de clé proposé par le serveur (une connexion par algorithme),
calcule toutes les représentations d'empreinte courantes et les compare aux
empreintes officielles. N'écrit aucun known_hosts, ne s'authentifie jamais.
"""
import base64, hashlib, socket, sys
import paramiko
from cryptography.hazmat.primitives import serialization

HOST = sys.argv[1] if len(sys.argv) > 1 else "aftp.linksynergy.com"
PORTS = [int(p) for p in (sys.argv[2] if len(sys.argv) > 2 else "22").split(",")]
OFFICIAL = {
    "sha256_hex": "6854993e0f41078a1f007d677d298c2a4f7d5f898de149f53e27d3159e4b2bdc",
    "sha1_hex": "d98a0cdd102177804f99a3534a4a04c6b31ce816",
}
KEY_TYPES = ["ssh-rsa", "rsa-sha2-256", "rsa-sha2-512", "ssh-dss", "ecdsa-sha2-nistp256",
             "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "ssh-ed25519"]

def variants(key):
    blob = key.asbytes()
    out = {"blob": blob}
    try:
        crypto = key.public_numbers if False else None
        pub = None
        if hasattr(key, "key") and hasattr(key.key, "public_bytes"):
            pub = key.key
        elif hasattr(key, "verifying_key"):
            pub = key.verifying_key
        if pub is not None:
            out["der_spki"] = pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
            try:
                out["der_pkcs1"] = pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.PKCS1)
            except Exception:
                pass
    except Exception as exc:
        print(f"  (variantes DER indisponibles : {exc})")
    out["openssh_line"] = f"{key.get_name()} {key.get_base64()}".encode()
    out["base64_text"] = key.get_base64().encode()
    return out

def fetch(port, ktype):
    sock = socket.create_connection((HOST, port), timeout=15)
    t = paramiko.Transport(sock)
    t.get_security_options().key_types = [ktype]
    try:
        t.start_client(timeout=15)
        return t.get_remote_server_key(), t.remote_version
    finally:
        t.close()

seen, matched = {}, []
for port in PORTS:
    for kt in KEY_TYPES:
        try:
            key, banner = fetch(port, kt)
        except Exception as exc:
            print(f"port {port} {kt}: non proposé ({type(exc).__name__})")
            continue
        fp = (port, key.get_name(), key.get_base64())
        if fp in seen:
            print(f"port {port} {kt}: même clé que {seen[fp]}")
            continue
        seen[fp] = kt
        print(f"port {port} {kt}: clé {key.get_name()} {key.get_bits()} bits — bannière {banner}")
        for label, data in variants(key).items():
            s256, s1, md5 = (hashlib.sha256(data).hexdigest(), hashlib.sha1(data).hexdigest(), hashlib.md5(data).hexdigest())
            b64 = base64.b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")
            print(f"   {label:13} SHA256_hex={s256}  SHA256_b64={b64}  SHA1={s1}  MD5={':'.join(md5[i:i+2] for i in range(0,32,2))}")
            for name, value in OFFICIAL.items():
                if value in (s256, s1):
                    matched.append((port, kt, label, name))
print()
if matched:
    for m in matched:
        print(f"CORRESPONDANCE : port {m[0]} type {m[1]} forme {m[2]} ↔ empreinte officielle {m[3]}")
else:
    print("AUCUNE CORRESPONDANCE avec les empreintes officielles, pour aucun type de clé ni aucune forme.")

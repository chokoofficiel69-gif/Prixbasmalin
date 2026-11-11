#!/usr/bin/env python3
"""Rédige des conseils d'achat et une FAQ pour les fiches /prix/<id>.html avec une IA gratuite.

Règles de sécurité éditoriale :
- l'IA ne reçoit que le nom, la marque, la catégorie et le nombre de marchands relevés ;
- elle n'a le droit d'écrire AUCUN chiffre, prix, pourcentage ni date : les montants affichés
  sur la page viennent uniquement des relevés datés (PrixTracker) ;
- tout texte qui enfreint ces règles est rejeté et n'est pas publié.

Fournisseurs essayés dans l'ordre, selon les clés présentes (secrets GitHub) :
FREELLMAPI_API_KEY (passerelle FreeLLMAPI de Prix Malin), GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY.
Sans aucune clé, le script ne fait rien et sort sans erreur.
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHEETS = ROOT / "data" / "fiches-produits.json"
OUT = ROOT / "data" / "ai-guides.json"
MAX_PER_RUN = int(os.environ.get("AI_GUIDES_MAX", "20"))
REFRESH_DAYS = 60

PROVIDERS = [
    ("freellmapi", "FREELLMAPI_API_KEY", os.environ.get("FREELLMAPI_BASE_URL", "https://freellmapi.prixbasmalin.prod.page/v1"), os.environ.get("FREELLMAPI_MODEL")),
    ("groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1", os.environ.get("GROQ_MODEL")),
    ("gemini", "GEMINI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/openai", os.environ.get("GEMINI_MODEL")),
    ("cerebras", "CEREBRAS_API_KEY", "https://api.cerebras.ai/v1", os.environ.get("CEREBRAS_MODEL")),
    ("mistral", "MISTRAL_API_KEY", "https://api.mistral.ai/v1", os.environ.get("MISTRAL_MODEL")),
    ("openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1", os.environ.get("OPENROUTER_MODEL")),
]

# Modèles préférés, dans l'ordre, cherchés dans la liste /models de chaque fournisseur.
PREFERRED = [r"gpt-oss-120b", r"gemini-[\d.]+-flash$", r"gemini-flash-latest", r"llama-4-maverick", r"llama-3\.3-70b",
             r"qwen3?-.*\d+b", r"mistral-(small|medium)-latest", r"llama-4-scout", r"gpt-oss-20b", r"llama", r"gemini-.*flash"]
EXCLUDED = re.compile(r"embed|tts|whisper|guard|audio|image|live|vision|ocr|moderation|transcri|speech|aqa|imagen|veo|lyria|learnlm|gemma", re.I)


def pick_model(ids, free_only=False):
    ids = [i.removeprefix("models/") for i in ids if not EXCLUDED.search(i)]
    if free_only:
        ids = [i for i in ids if i.endswith(":free")]
    for pattern in PREFERRED:
        hits = sorted((i for i in ids if re.search(pattern, i, re.I)), key=lambda i: ("preview" in i or "exp" in i, -len(re.findall(r"\d", i)), i))
        if hits:
            return hits[0]
    return ids[0] if ids else None


def resolve(provider):
    """Choisit un modèle disponible chez le fournisseur (liste /models), sauf modèle imposé."""
    name, env, base, model = provider
    if model:
        return provider
    req = urllib.request.Request(base + "/models", headers={"Authorization": "Bearer " + os.environ[env], "User-Agent": "PrixMalin-guides/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ids = [m.get("id", "") for m in json.load(r).get("data", [])]
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        print(f"{name} : liste des modèles indisponible ({exc})")
        return None
    chosen = pick_model(ids, free_only=(name == "openrouter"))
    print(f"{name} : modèle choisi {chosen} parmi {len(ids)}")
    return (name, env, base, chosen) if chosen else None


SYSTEM = (
    "Tu rédiges des conseils d'achat neutres, en français, pour un comparateur de prix. "
    "Règles absolues : n'écris AUCUN chiffre (ni prix, ni pourcentage, ni date, ni capacité, ni durée), "
    "aucun symbole €, n'invente aucune caractéristique technique précise du produit, aucune promotion, "
    "aucun avis client. Donne des conseils généraux et vérifiables pour bien choisir ce type de produit "
    "et comparer les offres (référence exacte, garantie, frais de livraison, retour, reconditionné ou neuf). "
    "Réponds uniquement en JSON."
)

FORBIDDEN = re.compile(r"\d|€|%|\b(?:promo|promotion|soldes?|garanti(?:e)? le moins cher|meilleur prix garanti|avis clients?)\b", re.I)


def prompt_for(p):
    return (
        f"Produit : {p['name']}\nMarque : {p['brand']}\nCatégorie : {p['category_label']}\n"
        f"Nombre de marchands dont le prix a été relevé : {p.get('offer_count', 0)} (n'écris pas ce nombre).\n\n"
        "Renvoie un objet JSON avec exactement ces clés :\n"
        '- "intro" : deux ou trois phrases de conseil pour acheter ce produit au bon prix ;\n'
        '- "criteres" : liste de trois points à vérifier avant d\'acheter (une phrase chacun) ;\n'
        '- "faq" : liste de deux objets {"q": question, "a": réponse en deux phrases maximum}.'
    )


def validate(data):
    """Renvoie le guide nettoyé, ou None s'il enfreint une règle."""
    if not isinstance(data, dict):
        return None
    intro = data.get("intro")
    crit = data.get("criteres")
    faq = data.get("faq")
    if not isinstance(intro, str) or not isinstance(crit, list) or not isinstance(faq, list):
        return None
    crit = [c.strip() for c in crit if isinstance(c, str) and c.strip()][:3]
    faq = [{"q": f["q"].strip(), "a": f["a"].strip()} for f in faq
           if isinstance(f, dict) and isinstance(f.get("q"), str) and isinstance(f.get("a"), str)][:2]
    texts = [intro.strip(), *crit, *(x for f in faq for x in (f["q"], f["a"]))]
    if len(crit) < 3 or len(faq) < 2 or not 60 <= len(intro) <= 700:
        return None
    if any(FORBIDDEN.search(t) or len(t) > 450 or "<" in t or ">" in t for t in texts):
        return None
    return {"intro": intro.strip(), "criteres": crit, "faq": faq}


def call(provider, p):
    name, env, base, model = provider
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt_for(p)}],
        "temperature": 0.4,
        "max_tokens": 700,
        "response_format": {"type": "json_object"},
    }).encode()
    req = urllib.request.Request(base + "/chat/completions", data=body, method="POST", headers={
        "Authorization": "Bearer " + os.environ[env], "Content-Type": "application/json",
        "User-Agent": "PrixMalin-guides/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        content = json.load(r)["choices"][0]["message"]["content"]
    content = re.sub(r"^```(?:json)?|```$", "", content.strip()).strip()
    return json.loads(content), f"{name}:{model}"


def due(entry, today):
    if not entry:
        return True
    try:
        return (today - dt.date.fromisoformat(entry["generated_at"][:10])).days >= REFRESH_DAYS
    except (KeyError, ValueError):
        return True


def main():
    providers = [r for r in (resolve(pr) for pr in PROVIDERS if os.environ.get(pr[1])) if r]
    if not providers:
        print("Aucune clé IA configurée : rien à générer.")
        return 0
    sheets = json.loads(SHEETS.read_text(encoding="utf-8"))["products"]
    guides = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"products": {}}
    known = guides.setdefault("products", {})
    today = dt.datetime.now(dt.timezone.utc).date()
    todo = sorted((p for p in sheets if p.get("offers") and due(known.get(p["id"]), today)),
                  key=lambda p: (p["id"] in known, -p.get("offer_count", 0), p["id"]))[:MAX_PER_RUN]
    done = rejected = 0
    for p in todo:
        for prov in providers:
            try:
                raw, used = call(prov, p)
            except urllib.error.HTTPError as exc:
                detail = ""
                try:
                    err = json.loads(exc.read().decode("utf-8", "replace"))
                    detail = str((err.get("error") or {}).get("message") if isinstance(err.get("error"), dict) else err.get("error") or err)
                except Exception:  # noqa: BLE001 - message d'erreur facultatif
                    pass
                print(f"{p['id']} : {prov[0]} refus HTTP {exc.code} {re.sub(r'[\r\n\t]+', ' ', detail)[:200]}")
                continue
            except (urllib.error.URLError, TimeoutError, KeyError, ValueError, json.JSONDecodeError) as exc:
                print(f"{p['id']} : {prov[0]} indisponible ({type(exc).__name__})")
                continue
            guide = validate(raw)
            if guide:
                known[p["id"]] = {**guide, "model": used, "generated_at": today.isoformat()}
                done += 1
            else:
                rejected += 1
                print(f"{p['id']} : texte rejeté (règles non respectées) par {used}")
            break
        time.sleep(2.5)  # reste sous les limites gratuites (requêtes par minute)
    guides["updated_at"] = today.isoformat()
    OUT.write_text(json.dumps(guides, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Guides IA : {done} écrits, {rejected} rejetés, {len(known)} au total.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

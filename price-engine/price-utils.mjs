// Utilitaires partagés et testables du moteur de prix.
export function parsePrice(value) {
  if (value == null) return null;
  let s = String(value).trim().replace(/[\s\u00a0\u202f€]/g, "").replace(/[^0-9,.-]/g, "");
  if (!s || s === "-" || s === "." || s === ",") return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function secureUrl(value, base) {
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeProductName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Ne retient que le produit explicitement nommé, ou les fiches validées
// par des termes distinctifs configurés pour ce produit. Échec = pas d'offre.
export function matchesProductIdentity(node, product) {
  const actual = normalizeProductName(node?.name);
  const expected = normalizeProductName(product?.name);
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  const terms = Array.isArray(product?.match_terms)
    ? product.match_terms.map(normalizeProductName).filter(Boolean)
    : [];
  return terms.length > 0 && terms.every(term => actual.includes(term));
}

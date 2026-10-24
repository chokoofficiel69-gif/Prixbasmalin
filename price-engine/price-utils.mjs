// Utilitaires testables du moteur de prix.
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

// Comping / punch — logique pure (sans navigateur), testable.
// Les « prises » d'une même piste sont alignées sur la même timeline (même offset),
// donc l'échantillon i d'une prise correspond au même instant que l'échantillon i d'une autre.

/** Normalise des choix {a,b,take} (secondes→échantillons déjà faits) en segments contigus
 *  couvrant [0,total], les trous étant comblés par la prise de base. */
export function planComp(total, choices = [], baseTake = 0) {
  const sorted = choices.filter(c => c && c.b > c.a).map(c => ({ take: c.take | 0, a: Math.max(0, Math.round(c.a)), b: Math.min(total, Math.round(c.b)) })).sort((x, y) => x.a - y.a);
  const segs = []; let cursor = 0;
  for (const c of sorted) {
    const a = Math.max(cursor, c.a), b = c.b;
    if (b <= a) continue;
    if (a > cursor) segs.push({ take: baseTake, a: cursor, b: a });
    segs.push({ take: c.take, a, b }); cursor = b;
  }
  if (cursor < total) segs.push({ take: baseTake, a: cursor, b: total });
  if (!segs.length) segs.push({ take: baseTake, a: 0, b: total });
  return segs;
}

/** Assemble un mono Float32Array à partir des prises et des segments, avec fondus
 *  enchaînés (puissance constante) de `fade` échantillons aux coutures. */
export function stitchMono(takes, segments, total, fade = 441) {
  const out = new Float32Array(total);
  const at = (t, i) => { const a = takes[t]; return (a && i >= 0 && i < a.length) ? a[i] : 0; };
  for (const seg of segments) for (let i = seg.a; i < seg.b && i < total; i++) out[i] = at(seg.take, i);
  for (let k = 1; k < segments.length; k++) {
    const p = segments[k].a, A = segments[k - 1].take, Bt = segments[k].take;
    if (A === Bt) continue;
    const f = Math.max(1, Math.min(fade, segments[k].b - segments[k].a, segments[k - 1].b - segments[k - 1].a));
    const half = Math.floor(f / 2);
    for (let i = 0; i < f; i++) {
      const idx = p - half + i; if (idx < 0 || idx >= total) continue;
      const w = (i + 0.5) / f, ga = Math.cos(w * Math.PI / 2), gb = Math.sin(w * Math.PI / 2);
      out[idx] = at(A, idx) * ga + at(Bt, idx) * gb;
    }
  }
  return out;
}

/** Découpe l'enregistrement d'une boucle en prises d'une durée de boucle chacune. */
export function splitLoopTakes(totalSamples, loopSamples) {
  if (!(loopSamples > 0)) return [{ a: 0, b: totalSamples }];
  const out = [];
  for (let a = 0; a < totalSamples; a += loopSamples) out.push({ a, b: Math.min(totalSamples, a + loopSamples) });
  // ignore une dernière tranche trop courte (< 20 % d'une boucle)
  if (out.length > 1 && (out[out.length - 1].b - out[out.length - 1].a) < loopSamples * 0.2) out.pop();
  return out;
}

/** Remplace la région [inSec,outSec] de `base` par `patch` (aligné sur base), fondus de `fade`. */
export function punchInMono(base, patch, inSample, outSample, fade = 441) {
  const total = base.length, out = Float32Array.from(base);
  const a = Math.max(0, Math.min(total, inSample | 0)), b = Math.max(a, Math.min(total, outSample | 0));
  const at = (arr, i) => (arr && i >= 0 && i < arr.length) ? arr[i] : 0;
  for (let i = a; i < b; i++) out[i] = at(patch, i);
  const f = Math.max(1, Math.min(fade, (b - a) || 1));
  for (let i = 0; i < f; i++) { // fondu d'entrée
    const idx = a + i; if (idx >= total) break;
    const w = (i + 0.5) / f, go = Math.cos(w * Math.PI / 2), gi = Math.sin(w * Math.PI / 2);
    out[idx] = at(base, idx) * go + at(patch, idx) * gi;
  }
  for (let i = 0; i < f; i++) { // fondu de sortie
    const idx = b - f + i; if (idx < 0 || idx >= total) continue;
    const w = (i + 0.5) / f, gp = Math.cos(w * Math.PI / 2), gb = Math.sin(w * Math.PI / 2);
    out[idx] = at(patch, idx) * gp + at(base, idx) * gb;
  }
  return out;
}

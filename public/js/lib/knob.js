// Molette façon hardware pro (Antares/Headrush) : corps anthracite, anneau de valeur
// lumineux, pointeur cyan. Glisser haut/bas, molette souris ou flèches. Double-clic = défaut.
import { h } from './core.js';

export function knob({ label, min, max, step = 0.01, value, def = value, fmt = (v) => v, onInput }) {
  let v = value;
  const frac = () => (max - min ? (v - min) / (max - min) : 0);
  const ang = () => -135 + 270 * frac();
  const ind = h('i.knob-ind');
  const body = h('div.knob-body', { tabIndex: 0, title: `${label} : glisse vers le haut ou le bas (double-clic = défaut)` }, ind);
  const ring = h('div.knob-ring');
  const dial = h('div.knob', ring, body);
  const val = h('b.small.knob-val', fmt(v));
  const set = (nv, fire = true) => {
    nv = Math.max(min, Math.min(max, Math.round(nv / step) * step));
    v = Number(nv.toFixed(4));
    body.style.transform = `rotate(${ang()}deg)`;
    ring.style.setProperty('--p', (frac() * 270) + 'deg');
    val.textContent = fmt(v);
    if (fire) onInput?.(v);
  };
  let drag = null;
  body.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, v }; body.setPointerCapture(e.pointerId); body.focus(); });
  body.addEventListener('pointermove', (e) => { if (!drag) return; const range = max - min; set(drag.v + (drag.y - e.clientY) / 160 * range * (e.shiftKey ? 0.2 : 1)); });
  body.addEventListener('pointerup', () => { drag = null; });
  body.addEventListener('wheel', (e) => { e.preventDefault(); set(v + (e.deltaY < 0 ? 1 : -1) * Math.max(step, (max - min) / 50)); }, { passive: false });
  body.addEventListener('dblclick', () => set(def));
  body.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); set(v + (max - min) / 50); } if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); set(v - (max - min) / 50); } });
  set(v, false);
  const el = h('div.knob-wrap', h('span.tiny.knob-label', { style: { textAlign: 'center' } }, label), dial, val);
  return { el, set, get value() { return v; } };
}

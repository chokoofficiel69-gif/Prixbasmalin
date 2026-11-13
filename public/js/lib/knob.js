// Molette de réglage façon table de mixage : glisser vers le haut/bas, molette de la souris ou flèches.
// Double-clic = valeur par défaut.
import { h } from './core.js';

export function knob({ label, min, max, step = 0.01, value, def = value, fmt = (v) => v, onInput }) {
  let v = value;
  const ang = () => -135 + 270 * (v - min) / (max - min);
  const ind = h('i', { style: { position: 'absolute', left: '50%', top: '6px', width: '3px', height: '14px', marginLeft: '-1.5px', borderRadius: '2px', background: 'var(--accent, #6366f1)' } });
  const dial = h('div', { tabIndex: 0, title: `${label} : glisse vers le haut ou le bas (double-clic = défaut)`, style: { position: 'relative', width: '54px', height: '54px', borderRadius: '50%', cursor: 'ns-resize', touchAction: 'none', margin: '0 auto',
    background: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,.35), rgba(0,0,0,.15)), var(--card, #ddd)', boxShadow: 'inset 0 0 0 2px rgba(127,127,127,.35), 0 2px 6px rgba(0,0,0,.25)' } }, ind);
  const val = h('b.small', fmt(v));
  const set = (nv, fire = true) => {
    nv = Math.max(min, Math.min(max, Math.round(nv / step) * step));
    v = Number(nv.toFixed(4)); dial.style.transform = `rotate(${ang()}deg)`; val.textContent = fmt(v);
    if (fire) onInput?.(v);
  };
  let drag = null;
  dial.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, v }; dial.setPointerCapture(e.pointerId); dial.focus(); });
  dial.addEventListener('pointermove', (e) => { if (!drag) return; const range = max - min; set(drag.v + (drag.y - e.clientY) / 160 * range * (e.shiftKey ? 0.2 : 1)); });
  dial.addEventListener('pointerup', () => { drag = null; });
  dial.addEventListener('wheel', (e) => { e.preventDefault(); set(v + (e.deltaY < 0 ? 1 : -1) * Math.max(step, (max - min) / 50)); }, { passive: false });
  dial.addEventListener('dblclick', () => set(def));
  dial.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); set(v + (max - min) / 50); } if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); set(v - (max - min) / 50); } });
  set(v, false);
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: '78px' } }, h('span.tiny', { style: { textAlign: 'center' } }, label), dial, val);
  return { el, set, get value() { return v; } };
}

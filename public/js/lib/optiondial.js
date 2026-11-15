// Molette d'options façon boîtier vocal : un rotor (glisser / molette / flèches) qui
// fait défiler une liste, avec afficheur LCD « 01 · Nom » comme sur le matériel.
import { h } from './core.js';

export function optionDial({ items, index = 0, onChange, label = 'PRESET' }) {
  let list = items.slice();
  let i = Math.max(0, Math.min(index, list.length - 1));
  const lcdNum = h('span.od-num', '01');
  const lcdName = h('span.od-name', '');
  const ring = h('div.knob-ring');
  const body = h('div.knob-body', { tabIndex: 0, title: 'Tourne (glisse / molette / flèches) pour changer de preset' });
  const dial = h('div.knob.od-dial', ring, body);
  const frac = () => (list.length > 1 ? i / (list.length - 1) : 0);
  const set = (ni, fire = true) => {
    const n = list.length || 1;
    i = ((Math.round(ni) % n) + n) % n;
    const it = list[i] || {};
    body.style.transform = `rotate(${-135 + 270 * frac()}deg)`;
    ring.style.setProperty('--p', frac() * 270 + 'deg');
    lcdNum.textContent = String(it.n ?? i + 1).padStart(2, '0');
    lcdName.textContent = it.name || '';
    if (fire) onChange?.(i, it);
  };
  let drag = null;
  body.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, i }; body.setPointerCapture(e.pointerId); body.focus(); });
  body.addEventListener('pointermove', (e) => { if (!drag) return; set(drag.i + (drag.y - e.clientY) / 14); });
  body.addEventListener('pointerup', () => { drag = null; });
  body.addEventListener('wheel', (e) => { e.preventDefault(); set(i + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  body.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); set(i + 1); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); set(i - 1); }
  });
  const prev = h('button.btn.small.ghost', { type: 'button', title: 'Précédent', onclick: () => set(i - 1) }, '◀');
  const next = h('button.btn.small.ghost', { type: 'button', title: 'Suivant', onclick: () => set(i + 1) }, '▶');
  const lcd = h('div.od-lcd', h('span.od-label', label), h('div.od-read', lcdNum, lcdName));
  const el = h('div.option-dial', dial, h('div.od-side', lcd, h('div.row.od-nav', prev, next)));
  set(i, false);
  return {
    el, set,
    setItems(newItems, keep = 0) { list = newItems.slice(); set(keep); },
    get index() { return i; },
    get item() { return list[i]; },
  };
}

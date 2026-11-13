// Vue « studio » : toutes les pistes sur une même ligne de temps (façon logiciel de studio).
// Clic = placer la tête de lecture · outil ✋ = déplacer une prise · outil ⬚ = sélectionner un passage.
import { h, fmtTime } from '../lib/core.js';
import { drawWave } from '../lib/audio.js';
import { colorForTrack, snapToGrid } from '../lib/daw.js';

const HEAD = 236;
const fmtPos = (t) => `${fmtTime(t)}.${String(Math.floor((Math.max(0, t) % 1) * 10))}`;

export function createTimeline(o) {
  let pps = Number(localStorage.getItem('studio.tl.pps')) || 30; // pixels par seconde
  let ROW = Number(localStorage.getItem('studio.tl.row')) || 84;  // hauteur d'une piste (zoom vertical)
  let snap = localStorage.getItem('studio.tl.snap') === '1';      // aimantation sur la grille (BPM)
  let tool = 'select';
  let selTrack = null; // piste de la sélection
  const scroller = h('div', { style: { overflowX: 'auto', overflowY: 'hidden', position: 'relative', border: '1px solid var(--line, rgba(127,127,127,.25))', borderRadius: '10px', background: 'var(--bg)' } });
  const inner = h('div', { style: { position: 'relative', minHeight: '60px' } });
  const playhead = h('div', { style: { position: 'absolute', top: 0, bottom: 0, width: '2px', background: '#f59e0b', zIndex: 3, pointerEvents: 'none', left: HEAD + 'px' } });
  scroller.append(inner);
  const posLbl = h('b', { style: { fontVariantNumeric: 'tabular-nums', fontSize: '1.15em', minWidth: '70px', display: 'inline-block' } }, '0:00.0');
  const selBar = h('div.row', { style: { display: 'none', flexWrap: 'wrap', gap: '6px', alignItems: 'center' } });
  const toolBtns = {};
  const setTool = (t) => { tool = t; for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('primary', k === t); };
  toolBtns.select = h('button.btn.small', { onclick: () => setTool('select'), title: 'Glisser sur une prise pour sélectionner un passage' }, '⬚ Sélectionner');
  toolBtns.move = h('button.btn.small', { onclick: () => setTool('move'), title: 'Glisser une prise vers la gauche ou la droite pour la caler' }, '✋ Déplacer');
  setTool('select');
  const zoom = (f) => { pps = Math.max(4, Math.min(400, pps * f)); localStorage.setItem('studio.tl.pps', pps); render(); };
  const vzoom = (f) => { ROW = Math.max(44, Math.min(200, Math.round(ROW * f))); localStorage.setItem('studio.tl.row', ROW); render(); };
  const fit = () => { const tot = total(); if (tot > 0) { pps = Math.max(4, Math.min(400, (scroller.clientWidth - HEAD - 30) / tot)); render(); } };
  const snapBtn = h('button.btn.small' + (snap ? '.primary' : '.ghost'), { title: 'Aimanter les prises sur la grille du tempo', onclick: (e) => { snap = !snap; localStorage.setItem('studio.tl.snap', snap ? '1' : '0'); e.currentTarget.classList.toggle('primary', snap); e.currentTarget.classList.toggle('ghost', !snap); } }, '🧲 Aimant');
  const tools = h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, toolBtns.select, toolBtns.move, snapBtn,
    h('button.btn.small.ghost', { onclick: () => zoom(1 / 1.5), title: 'Dézoomer (horizontal)' }, '🔍−'), h('button.btn.small.ghost', { onclick: () => zoom(1.5), title: 'Zoomer (horizontal)' }, '🔍+'),
    h('button.btn.small.ghost', { onclick: () => vzoom(1 / 1.3), title: 'Pistes plus fines' }, '↕−'), h('button.btn.small.ghost', { onclick: () => vzoom(1.3), title: 'Pistes plus hautes' }, '↕+'),
    h('button.btn.small.ghost', { onclick: fit }, '↔ Tout voir'));

  const minOff = () => Math.min(0, ...o.tracks.map(t => t.offset || 0));
  const total = () => Math.max(10, ...o.tracks.map(t => (t.offset || 0) - minOff() + t.buffer.duration));
  const gx = (g) => HEAD + g * pps;

  function header(t, i) {
    const sel = i === o.getSelected();
    const dB = h('b', `${t.gainDb} dB`);
    const btn = (label, on, title, fn) => h('button.btn.small' + (on ? '.primary' : '.ghost'), { title, style: { padding: '2px 8px', minWidth: '30px' }, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
    return h('div', { style: { position: 'sticky', left: 0, zIndex: 2, width: HEAD + 'px', minWidth: HEAD + 'px', height: ROW + 'px', boxSizing: 'border-box', padding: '6px 8px', background: sel ? 'color-mix(in srgb, var(--accent) 18%, var(--card, #fff))' : 'var(--card, #fff)', borderRight: '1px solid rgba(127,127,127,.3)', borderBottom: '1px solid rgba(127,127,127,.2)', display: 'flex', flexDirection: 'column', gap: '4px', cursor: 'pointer' }, onclick: () => o.select(i) },
      h('div.row', { style: { gap: '4px', flexWrap: 'nowrap' } },
        h('span', t.kind === 'instru' ? '🥁' : t.kind === 'voix' ? '🎤' : '🔊'),
        h('input', { value: t.name, title: 'Renommer', style: { flex: 1, minWidth: 0, padding: '2px 6px', fontSize: '.85em', fontWeight: 600 }, onclick: (e) => e.stopPropagation(), onchange: (e) => { t.name = e.target.value || t.name; o.changed('name'); } }),
        h('button.btn.small', { title: 'Armer : la prochaine prise ira dans cette piste', style: { padding: '2px 7px', color: t.armed ? '#fff' : '#ef4444', background: t.armed ? '#ef4444' : '' }, onclick: (e) => { e.stopPropagation(); const on = !t.armed; o.tracks.forEach(x => { x.armed = false; }); t.armed = on; o.changed('arm', t); } }, '●'),
        btn('M', t.mute, 'Muet', () => { t.mute = !t.mute; o.changed('mute', t); }),
        btn('S', t.solo, 'Solo (n’écouter que cette piste)', () => { t.solo = !t.solo; o.changed('solo', t); }),
        btn('✕', false, 'Supprimer la piste', () => o.remove(i))),
      h('div.row', { style: { gap: '6px', flexWrap: 'nowrap', alignItems: 'center' } },
        h('span.tiny', 'Vol'), h('input', { type: 'range', min: -30, max: 12, step: 0.5, value: t.gainDb, style: { flex: 1 }, onclick: (e) => e.stopPropagation(), oninput: (e) => { t.gainDb = Number(e.target.value); dB.textContent = `${t.gainDb} dB`; o.changed('gain', t); } }), h('span.tiny', dB)),
      h('div.row', { style: { gap: '6px', flexWrap: 'nowrap', alignItems: 'center' } },
        h('span.tiny', 'G'), h('input', { type: 'range', min: -1, max: 1, step: 0.05, value: t.pan || 0, title: 'Panoramique (gauche / droite)', style: { flex: 1 }, onclick: (e) => e.stopPropagation(), oninput: (e) => { t.pan = Number(e.target.value); o.changed('pan', t); } }), h('span.tiny', 'D'),
        h('select', { style: { fontSize: '.75em', padding: '1px 4px' }, onclick: (e) => e.stopPropagation(), onchange: (e) => { t.kind = e.target.value; o.changed('kind', t); } },
          ...[['voix', 'Voix'], ['instru', 'Instru'], ['autre', 'Autre']].map(([v, l]) => h('option', { value: v, selected: t.kind === v }, l)))));
  }

  function lane(t, i, minO) {
    const g0 = (t.offset || 0) - minO, w = Math.max(2, t.buffer.duration * pps);
    const col = colorForTrack(t, i);
    const cv = h('canvas', { style: { width: '100%', height: '100%', display: 'block' } });
    const clip = h('div', { title: tool === 'move' ? 'Glisse pour déplacer la prise' : 'Glisse pour sélectionner un passage', style: { position: 'absolute', top: '6px', bottom: '6px', left: g0 * pps + 'px', width: w + 'px', borderRadius: '6px', overflow: 'hidden', touchAction: 'none',
      background: col + '38', border: `1px solid ${col}`, opacity: o.effMute(t) ? 0.35 : 1, cursor: tool === 'move' ? 'grab' : 'text' } },
      h('span.tiny', { style: { position: 'absolute', top: '2px', left: '6px', pointerEvents: 'none', fontWeight: 600, textShadow: '0 0 3px var(--bg)' } }, t.name), cv);
    const laneEl = h('div', { style: { position: 'relative', height: ROW + 'px', width: Math.max(total() * pps + 200, 200) + 'px', borderBottom: '1px solid rgba(127,127,127,.2)' } },
      t.empty ? h('span.small.muted', { style: { position: 'absolute', left: g0 * pps + 8 + 'px', top: '30px' } }, t.armed ? '● Piste vide armée : place la tête de lecture et appuie sur ⏺ Enregistrer' : 'Piste vide : arme-la (●) pour enregistrer dedans') : clip);
    const draw = () => { drawWave(cv, t.buffer, { sel: selTrack === t ? o.getSel() : null, color: col }); };
    requestAnimationFrame(draw);
    let start = null;
    clip.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); clip.setPointerCapture(e.pointerId);
      if (o.getSelected() !== i) o.select(i, true);
      const r = clip.getBoundingClientRect();
      start = { x: e.clientX, off: t.offset || 0, local: Math.max(0, Math.min(t.buffer.duration, (e.clientX - r.left) / pps)), moved: false };
    });
    clip.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x; if (Math.abs(dx) > 4) start.moved = true; if (!start.moved) return;
      if (tool === 'move') { let no = start.off + dx / pps; if (snap && o.bpm?.() > 0) no = snapToGrid(no, o.bpm(), 1); t.offset = no; clip.style.left = ((t.offset || 0) - minO) * pps + 'px'; o.moving?.(t); }
      else { const b = Math.max(0, Math.min(t.buffer.duration, start.local + dx / pps)); selTrack = t; o.setSel([Math.min(start.local, b), Math.max(start.local, b)]); draw(); showSel(); }
    });
    clip.addEventListener('pointerup', () => {
      if (!start) return;
      const s = start; start = null;
      if (!s.moved) { if (tool === 'select') { selTrack = null; o.setSel(null); showSel(); draw(); } o.seek((t.offset || 0) - minO + s.local); return; }
      if (tool === 'move') o.changed('offset', t); // re-rendu complet (le début de la ligne de temps peut bouger)
    });
    laneEl.addEventListener('pointerdown', (e) => { const r = inner.getBoundingClientRect(); o.seek(Math.max(0, (e.clientX - r.left - HEAD) / pps)); });
    return laneEl;
  }

  function ruler(minO) {
    const tot = total(), cv = h('canvas', { style: { display: 'block', height: '24px', width: (tot * pps + 200) + 'px' } });
    const wrap = h('div', { style: { display: 'flex', height: '24px', borderBottom: '1px solid rgba(127,127,127,.3)', cursor: 'pointer' } },
      h('div', { style: { position: 'sticky', left: 0, zIndex: 2, width: HEAD + 'px', minWidth: HEAD + 'px', background: 'var(--card, #fff)', borderRight: '1px solid rgba(127,127,127,.3)', fontSize: '.75em', padding: '4px 8px', boxSizing: 'border-box' } }, 'Pistes'), cv);
    requestAnimationFrame(() => {
      cv.width = Math.min(30000, Math.round(tot * pps + 200)); cv.height = 24;
      const c = cv.getContext('2d'); c.fillStyle = getComputedStyle(document.body).color || '#888'; c.font = '10px sans-serif'; c.globalAlpha = 0.7;
      const step = pps > 60 ? 1 : pps > 25 ? 2 : pps > 10 ? 5 : pps > 5 ? 10 : 30;
      for (let s = 0; s * pps < cv.width; s += step) { const x = s * pps; c.fillRect(x, 14, 1, 10); c.fillText(fmtTime(s + minO), x + 3, 11); }
    });
    wrap.addEventListener('pointerdown', (e) => { const r = inner.getBoundingClientRect(); o.seek(Math.max(0, (e.clientX - r.left - HEAD) / pps)); });
    return wrap;
  }

  function showSel() {
    const s = o.getSel(), t = selTrack;
    selBar.innerHTML = '';
    if (!s || !t || s[1] - s[0] < 0.02) { selBar.style.display = 'none'; return; }
    selBar.style.display = 'flex';
    selBar.append(h('span.small', `Sélection sur « ${t.name} » : ${fmtPos(s[0])} → ${fmtPos(s[1])} (${(s[1] - s[0]).toFixed(1)} s)`),
      h('button.btn.small', { onclick: () => o.edit('delete') }, '✂️ Supprimer ce passage'),
      h('button.btn.small', { onclick: () => o.edit('keep') }, 'Garder seulement ce passage'),
      h('button.btn.small', { onclick: () => o.edit('silence') }, '🔇 Mettre en silence'),
      h('button.btn.small', { onclick: () => o.edit('play') }, '▶ Écouter ce passage'),
      h('button.btn.small.ghost', { onclick: () => { selTrack = null; o.setSel(null); render(); } }, '✕'));
  }

  function render() {
    pps = Math.min(pps, 30000 / ((window.devicePixelRatio || 1) * total()));
    const minO = minOff();
    inner.innerHTML = '';
    inner.style.width = (HEAD + total() * pps + 200) + 'px';
    // Grille de mesures calée au tempo (lignes de mesure + temps)
    const bpmV = o.bpm?.() || 0, bpb = 4;
    if (bpmV > 0) {
      const barPx = Math.max(6, (60 / bpmV * bpb) * pps), beatPx = barPx / bpb;
      inner.style.backgroundImage = `repeating-linear-gradient(90deg, color-mix(in srgb, var(--line) 85%, transparent) 0 1px, transparent 1px ${barPx}px), repeating-linear-gradient(90deg, color-mix(in srgb, var(--line) 28%, transparent) 0 1px, transparent 1px ${beatPx}px)`;
      inner.style.backgroundPosition = `${HEAD}px 0`; inner.style.backgroundRepeat = 'repeat';
    } else { inner.style.backgroundImage = 'none'; }
    inner.append(ruler(minO));
    if (!o.tracks.length) inner.append(h('p.muted.small', { style: { padding: '12px' } }, 'Aucune piste. Importe ton instru (📥) puis enregistre (⏺), ou dis-le à l’assistant.'));
    o.tracks.forEach((t, i) => inner.append(h('div', { style: { display: 'flex' } }, header(t, i), lane(t, i, minO))));
    inner.append(playhead);
    for (const [mi, m] of (o.markers?.() || []).entries()) {
      const x = gx(m.t);
      inner.append(h('div', { title: m.name + ' — clic : aller · double-clic : renommer / supprimer', style: { position: 'absolute', left: x + 'px', top: 0, bottom: 0, width: '2px', background: 'var(--accent2)', zIndex: 4, cursor: 'pointer' },
        onclick: (e) => { e.stopPropagation(); o.seek(m.t); }, ondblclick: (e) => { e.stopPropagation(); o.editMarker?.(mi); } },
        h('span', { style: { position: 'absolute', top: 0, left: '2px', fontSize: '10px', fontWeight: 700, background: 'var(--accent2)', color: '#06121f', padding: '0 4px', borderRadius: '0 4px 4px 0', whiteSpace: 'nowrap' } }, '🚩 ' + m.name)));
    }
    if (selTrack && !o.tracks.includes(selTrack)) { selTrack = null; o.setSel(null); }
    showSel();
  }

  // tête de lecture qui suit la lecture (et fait défiler la vue)
  let raf = 0;
  const loop = () => {
    const p = o.position();
    playhead.style.left = gx(p) + 'px'; posLbl.textContent = fmtPos(p);
    if (o.isPlaying()) { const x = gx(p) - scroller.scrollLeft; if (x > scroller.clientWidth - 40 || x < HEAD) scroller.scrollLeft = gx(p) - HEAD - 40; }
    raf = requestAnimationFrame(loop);
  };
  loop();

  return { el: scroller, tools, selBar, posLbl, render, fit, edit: (k) => o.edit(k), setSelTrack: (t) => { selTrack = t; }, clearSel: () => { selTrack = null; o.setSel(null); showSel(); }, selTrack: () => selTrack, destroy: () => cancelAnimationFrame(raf) };
}

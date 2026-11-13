// Éditeur de notes (façon Melodyne) : on voit les notes chantées, Studio propose la meilleure note pour
// chacune (gamme et accords de l'instru), on peut en déplacer une à la souris, on écoute, on applique.
import { h, toast, toastErr } from '../lib/core.js';
import { analyzeNotes, renderNotes, midiName, keyName } from '../lib/voicefx.js';

export function createNoteEditor(o) {
  // o: { track(), chords(t) → Promise, keyOpt(), apply(t, buffer, label), preview(buffer) }
  let an = null, anBuf = null, pps = 60, selNote = -1, keep = 0.25, glide = 30;
  const info = h('span.small.muted', 'Clique « Analyser » pour voir tes notes.');
  const cv = h('canvas', { style: { display: 'block', height: '240px', touchAction: 'none', cursor: 'ns-resize' } });
  const wrap = h('div', { style: { overflowX: 'auto', border: '1px solid rgba(127,127,127,.3)', borderRadius: '8px', background: 'var(--bg)' } }, cv);
  const range = () => { const ms = an.notes.segs.flatMap(s => [s.med, s.t]); return [Math.floor(Math.min(...ms)) - 2, Math.ceil(Math.max(...ms)) + 2]; };
  const yOf = (m, lo, hi, H) => H - ((m - lo) / (hi - lo)) * H;
  function draw() {
    if (!an) return;
    const segs = an.notes.segs, dur = anBuf.duration, W = Math.max(600, Math.min(30000, Math.round(dur * pps))), H = 240;
    cv.style.width = W + 'px'; cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), [lo, hi] = range(), txt = getComputedStyle(document.body).color || '#888';
    g.clearRect(0, 0, W, H);
    for (let m = lo; m <= hi; m++) { const y = yOf(m, lo, hi, H); g.fillStyle = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12) ? 'rgba(127,127,127,.10)' : 'rgba(127,127,127,.03)'; g.fillRect(0, y - H / (hi - lo) / 2, W, H / (hi - lo)); }
    g.font = '10px sans-serif';
    // trace chantée
    g.strokeStyle = 'rgba(127,127,127,.7)'; g.lineWidth = 1.5; g.beginPath(); let pen = false;
    const m = an.notes.m;
    for (let i = 0; i < m.length; i++) { if (!m[i]) { pen = false; continue; } const x = i / an.rate * pps, y = yOf(m[i], lo, hi, H); if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y); }
    g.stroke();
    segs.forEach((s, i) => {
      const x = s.a / an.rate * pps, w = Math.max(3, (s.b - s.a) / an.rate * pps), y = yOf(s.t, lo, hi, H), hh = Math.max(6, H / (hi - lo) * 0.8);
      const off = Math.abs(s.med - s.t);
      g.fillStyle = i === selNote ? '#f59e0b' : s.t !== s.auto ? '#8b5cf6' : off > 0.35 ? '#ef4444' : '#22c55e';
      g.globalAlpha = 0.85; g.fillRect(x, y - hh / 2, w, hh); g.globalAlpha = 1;
      if (w > 22) { g.fillStyle = txt; g.fillText(midiName(s.t), x + 2, y - hh / 2 - 2); }
    });
  }
  const hit = (e) => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, fr = x / pps * an.rate; return an.notes.segs.findIndex(s => fr >= s.a && fr <= s.b); };
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { if (!an) return; const i = hit(e); selNote = i; if (i >= 0) { drag = { y: e.clientY, t: an.notes.segs[i].t }; cv.setPointerCapture(e.pointerId); } draw(); showSel(); });
  cv.addEventListener('pointermove', (e) => { if (!drag || selNote < 0) return; const [lo, hi] = range(), step = 240 / (hi - lo); const nt = drag.t + Math.round((drag.y - e.clientY) / step); if (nt !== an.notes.segs[selNote].t) { an.notes.segs[selNote].t = nt; draw(); showSel(); } });
  cv.addEventListener('pointerup', () => { drag = null; });
  const selLbl = h('span.small');
  function showSel() { const s = an?.notes.segs[selNote]; selLbl.textContent = s ? `Note choisie : tu chantes ${midiName(s.med)} (${s.med > Math.round(s.med) ? '+' : ''}${Math.round((s.med - Math.round(s.med)) * 100)} cents) → corrigée en ${midiName(s.t)}. Glisse-la vers le haut / bas.` : ''; }

  async function analyse(btn) {
    const t = o.track(); if (!t || t.kind === 'instru') return toast('Choisis une piste de voix.');
    btn.disabled = true; info.innerHTML = '<span class="spinner"></span> Écoute de tes notes…';
    try {
      const chords = await o.chords(t);
      an = await analyzeNotes(t.buffer, { key: o.keyOpt(), chords, onProgress: (p) => { info.innerHTML = `<span class="spinner"></span> Écoute de tes notes ${Math.round(p * 100)} %`; } });
      anBuf = t.buffer; selNote = -1;
      const n = an.notes.segs.length, off = an.notes.segs.filter(s => Math.abs(s.med - s.t) > 0.35).length;
      info.textContent = `${n} notes · tonalité ${keyName(an.key)} · ${off} note(s) à côté (en rouge) · vert = juste · violet = changée par toi`;
      draw(); showSel();
    } catch (e) { info.textContent = ''; toastErr(e); }
    btn.disabled = false;
  }
  const best = () => { if (!an) return; an.notes.segs.forEach(s => { s.t = s.auto; }); draw(); showSel(); toast('Meilleures notes proposées remises ✓'); };
  async function result(say) {
    const t = o.track(); if (!an || t?.buffer !== anBuf) throw new Error('Analyse d’abord la piste (elle a changé).');
    return renderNotes(t.buffer, an, { keep, glide, onProgress: (p) => say?.(`Correction ${Math.round(p * 100)} %`) });
  }
  const keepLbl = h('b', `${Math.round(keep * 100)} %`), glideLbl = h('b', `${glide} ms`);
  const el = h('div.stack',
    h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } },
      h('button.btn.small.primary', { onclick: (e) => analyse(e.target) }, '🔍 Analyser mes notes'),
      h('button.btn.small', { onclick: best }, '🎯 Meilleures notes'),
      h('button.btn.small', { onclick: async (e) => { e.target.disabled = true; try { o.preview(await result((m) => { info.textContent = m; })); info.textContent = '▶ Écoute du résultat (toute la piste)'; } catch (err) { toastErr(err); } e.target.disabled = false; } }, '▶ Écouter le résultat'),
      h('button.btn.small.primary', { onclick: async () => { try { const t = o.track(); const b = await result(); o.apply(t, b, 'Notes corrigées'); an = null; info.textContent = 'Appliqué ✓ (↩ Annuler pour revenir)'; draw(); } catch (err) { toastErr(err); } } }, '✅ Appliquer')),
    h('div.sliders',
      h('label', h('span', '🌿 Naturel (garde ton vibrato) ', keepLbl), h('input', { type: 'range', min: 0, max: 0.7, step: 0.05, value: keep, oninput: (e) => { keep = Number(e.target.value); keepLbl.textContent = `${Math.round(keep * 100)} %`; } })),
      h('label', h('span', '⚡ Vitesse d’attaque ', glideLbl), h('input', { type: 'range', min: 0, max: 120, step: 1, value: glide, oninput: (e) => { glide = Number(e.target.value); glideLbl.textContent = `${glide} ms`; } }))),
    info, wrap, selLbl,
    h('p.tiny.muted', 'Chaque barre = une note que tu chantes. Rouge = à côté, vert = juste. Studio propose la meilleure note (gamme et accords de ton instru). Tu peux attraper une barre et la monter / descendre d’un demi-ton. Puis « Écouter le résultat » (toute la piste) et « Appliquer ».'));
  return { el, reset: () => { an = null; info.textContent = 'Clique « Analyser » pour voir tes notes.'; const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); } };
}

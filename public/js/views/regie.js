// Régie Pro — nouvelle page isolée (phase 1 : la coquille + la Timeline réelle).
// NON destructive : lit le MÊME projet que la page Enregistrement (IndexedDB « rec:<projet> »),
// affiche de VRAIES formes d'onde (drawWave) et joue un vrai mix local. 100 % local, 0 €.
// Les autres onglets sont des APERÇUS visuels de la maquette validée, clairement signalés,
// avec un lien vers les pages réelles existantes — ils seront câblés aux phases suivantes.
import { h, state, toast, toastErr, currentProject, audioCtx, pickLocalFiles, startRecorder } from '../lib/core.js';
import { getItem, putItem, unpackBuffer, packBuffer } from '../lib/session.js';
import { decodeBlob, drawWave } from '../lib/audio.js';

// ---------------------------------------------------------------- styles (tout préfixé .regie)
const CSS = `
.regie{--rbg:#070711;--rpan:#13132a;--rpan2:#181833;--rline:#262348;--rpur:#a855f7;--rpur2:#7c3aed;--rcy:#22d3ee;--rpk:#ec4899;--rgr:#34e39a;--rgold:#f0b429;--rtxt:#eceefc;--rmut:#8a8fb5;
  flex:1;min-height:0;display:grid;grid-template-columns:250px 1fr;grid-template-rows:50px 1fr 56px;
  color:var(--rtxt);background:radial-gradient(1100px 650px at 72% -12%,rgba(124,58,237,.20),transparent 55%),radial-gradient(800px 560px at -5% 112%,rgba(34,211,238,.12),transparent 55%),var(--rbg);
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;transition:grid-template-columns .2s}
.regie.collapsed{grid-template-columns:60px 1fr}
.regie *{box-sizing:border-box}
.regie .rtop{grid-column:1/3;display:flex;align-items:center;gap:6px;padding:0 12px;background:linear-gradient(180deg,#0d0d1e,#090914);border-bottom:1px solid var(--rline)}
.regie .rburger{width:34px;height:34px;border-radius:9px;background:var(--rpan2);border:1px solid var(--rline);display:grid;place-items:center;font-size:15px;cursor:pointer;flex:none}
.regie .rbrand{display:flex;align-items:center;gap:9px;width:150px;flex:none;overflow:hidden}
.regie .rbrand .wf{width:30px;height:22px;flex:none;background:linear-gradient(90deg,var(--rpur),var(--rcy));-webkit-mask:repeating-linear-gradient(90deg,#000 0 3px,transparent 3px 6px);mask:repeating-linear-gradient(90deg,#000 0 3px,transparent 3px 6px)}
.regie .rbrand b{font-size:14px;line-height:1}.regie .rbrand small{font-size:9px;color:var(--rmut);display:block}
.regie.collapsed .rbrand{width:0}
.regie .rtabs{display:flex;gap:3px;overflow:auto;flex:1}
.regie .rtab{padding:7px 12px;border-radius:9px;font-size:12.5px;font-weight:600;color:#c3c6e6;white-space:nowrap;cursor:pointer;display:flex;gap:6px;align-items:center;border:1px solid transparent}
.regie .rtab:hover{background:rgba(255,255,255,.05)}
.regie .rtab.on{background:linear-gradient(120deg,var(--rpur2),var(--rpur));color:#fff;box-shadow:0 6px 18px rgba(168,85,247,.4)}
.regie .rpill{display:inline-flex;gap:6px;align-items:center;font-size:11px;padding:5px 10px;border-radius:99px;background:rgba(52,227,154,.14);border:1px solid rgba(52,227,154,.4);color:#bff5db;flex:none}
.regie .dot{width:8px;height:8px;border-radius:50%;background:var(--rgr);box-shadow:0 0 7px var(--rgr)}
.regie .rside{grid-row:2/4;overflow:auto;background:linear-gradient(180deg,#0c0c1a,#080812);border-right:1px solid var(--rline);padding:11px 9px;display:flex;flex-direction:column;gap:6px}
.regie .rside::-webkit-scrollbar{width:8px}.regie .rside::-webkit-scrollbar-thumb{background:#242146;border-radius:9px}
.regie .dgrp{border:1px solid var(--rline);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.015)}
.regie .dgh{display:flex;align-items:center;gap:9px;padding:9px 11px;font-size:12.5px;font-weight:700;cursor:pointer}
.regie .dgh .ico{width:18px;text-align:center}.regie .dgh .ch{margin-left:auto;color:var(--rmut);font-size:11px;transition:transform .15s}
.regie .dgrp.closed .ch{transform:rotate(-90deg)}.regie .dgrp.closed .dgb{display:none}
.regie .dgb{padding:3px 7px 8px}
.regie .ditem{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;font-size:12.5px;color:#d2d5f0;cursor:pointer}
.regie .ditem:hover{background:rgba(255,255,255,.05)}
.regie .ditem.on{background:linear-gradient(90deg,rgba(168,85,247,.26),transparent);box-shadow:inset 0 0 0 1px rgba(168,85,247,.45)}
.regie .ditem .led{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 7px currentColor}
.regie .ditem .cnt{margin-left:auto;font-size:10px;color:var(--rmut)}
.regie.collapsed .rside{padding:11px 5px}
.regie.collapsed .dgh span:not(.ico),.regie.collapsed .dgb,.regie.collapsed .dgh .ch{display:none}
.regie.collapsed .dgh{justify-content:center}
.regie .rmain{overflow:hidden;position:relative}
.regie .rview{position:absolute;inset:0;overflow:auto;padding:12px}
.regie .rview::-webkit-scrollbar{width:9px;height:9px}.regie .rview::-webkit-scrollbar-thumb{background:#242146;border-radius:9px}
.regie .panel{background:linear-gradient(180deg,var(--rpan),#0c0c18);border:1px solid #221f45;border-radius:14px;position:relative;box-shadow:0 14px 40px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.05)}
.regie .panel::after{content:'';position:absolute;left:13px;right:13px;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(168,85,247,.6),rgba(34,211,238,.5),transparent);opacity:.7;pointer-events:none}
.regie .ph{display:flex;align-items:center;gap:9px;padding:10px 13px;font-size:13px;font-weight:700;border-bottom:1px solid rgba(255,255,255,.06)}
.regie .ph .r{margin-left:auto;font-size:10px;color:var(--rmut);font-weight:600}
.regie .pb{padding:12px}
.regie .grid{display:grid;gap:12px}
.regie .rbtn{padding:7px 12px;border-radius:9px;font-size:12.5px;font-weight:700;background:transparent;border:1px solid var(--rline);color:#d2d5f0;cursor:pointer}
.regie .rbtn:hover{background:rgba(255,255,255,.05)}
.regie .rbtn.p{background:linear-gradient(120deg,var(--rpur2),var(--rpur));border-color:transparent;color:#fff;box-shadow:0 6px 16px rgba(168,85,247,.35)}
.regie .rbtn.g{background:linear-gradient(120deg,#16a34a,var(--rgr));border-color:transparent;color:#042}
.regie .chip{font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:99px;background:#15152b;border:1px solid var(--rline);color:#c3c6e6;cursor:pointer}
.regie .chip.on{background:linear-gradient(120deg,var(--rpur2),var(--rpur));border-color:transparent;color:#fff}
.regie .apercu{display:inline-flex;gap:6px;align-items:center;font-size:10px;font-weight:700;padding:4px 9px;border-radius:99px;background:rgba(240,180,41,.14);border:1px solid rgba(240,180,41,.4);color:#ffd789}
/* knobs (aperçu) */
.regie .kn{text-align:center}
.regie .kn .k{border-radius:50%;margin:0 auto 6px;position:relative;background:radial-gradient(circle at 40% 28%,rgba(255,255,255,.24),transparent 44%),radial-gradient(circle at 50% 120%,rgba(0,0,0,.6),transparent 60%),linear-gradient(180deg,#262745,#0c0d1c);border:1px solid #05060c;box-shadow:inset 0 2px 4px rgba(255,255,255,.16),inset 0 -5px 11px rgba(0,0,0,.6),0 6px 15px rgba(0,0,0,.5)}
.regie .kn .k::before{content:'';position:absolute;inset:-5px;border-radius:50%;background:conic-gradient(from 220deg,var(--kc,#22d3ee) 0 var(--p,150deg),rgba(255,255,255,.07) 0 100%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 0);mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 0);filter:drop-shadow(0 0 6px var(--kc,#22d3ee))}
.regie .kn .k i{position:absolute;left:50%;top:6px;width:3px;height:13px;margin-left:-1.5px;border-radius:2px;background:#fff;box-shadow:0 0 7px var(--kc,#22d3ee)}
.regie .kn .nm{font-size:11.5px;color:var(--rmut)}.regie .kn .vv{font-size:12.5px;font-weight:800;margin-top:1px}
.regie .kbig .k i{height:24px}.regie .kbig .vv{font-size:15px}
/* timeline */
.regie .tl-ruler{position:relative;height:18px;margin-left:160px;border-bottom:1px solid var(--rline);font-size:10px;color:var(--rmut)}
.regie .tl-ruler span{position:absolute;top:2px;transform:translateX(-1px);border-left:1px solid #2b2850;padding-left:3px}
.regie .trk{display:flex;gap:10px;margin-bottom:8px}
.regie .thead{width:150px;flex:none;border-radius:11px;padding:8px 9px;background:#111128;border:1px solid var(--rline);border-left:4px solid var(--tc,#888)}
.regie .thead .nm{font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.regie .thead .ctrls{display:flex;gap:4px;margin-top:7px}
.regie .tbtn{width:23px;height:21px;border-radius:6px;background:#1b1b38;border:1px solid var(--rline);font-size:10px;font-weight:800;display:grid;place-items:center;color:var(--rmut);cursor:pointer}
.regie .tbtn.on.m{background:rgba(34,211,238,.2);color:var(--rcy);border-color:rgba(34,211,238,.5)}
.regie .tbtn.on.s{background:rgba(245,180,41,.22);color:var(--rgold);border-color:rgba(245,180,41,.5)}
.regie .tbtn.on.a{background:rgba(239,68,68,.25);color:#ff8a8a;border-color:rgba(239,68,68,.5)}
.regie .thead input[type=range]{width:100%;margin-top:7px;accent-color:var(--tc,#888);height:4px}
.regie .thead .lab{display:flex;justify-content:space-between;font-size:9px;color:var(--rmut);margin-top:2px}
.regie .lane{flex:1;position:relative;min-height:64px;border-radius:10px;border:1px solid rgba(255,255,255,.07);background:repeating-linear-gradient(90deg,rgba(255,255,255,.02) 0 1px,transparent 1px var(--beat,80px));overflow:hidden}
.regie .clip{position:absolute;top:4px;bottom:4px;border-radius:8px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.04),transparent);border:1px solid rgba(255,255,255,.1)}
.regie .clip canvas{display:block;width:100%;height:100%}
.regie .clip .cnm{position:absolute;left:6px;top:4px;font-size:9px;color:rgba(255,255,255,.7);pointer-events:none}
.regie .playhead{position:absolute;top:0;bottom:0;width:2px;background:#fff;box-shadow:0 0 8px #fff,0 0 18px var(--rcy);z-index:4;pointer-events:none}
.regie .emptytl{border:1px dashed var(--rline);border-radius:12px;padding:30px;text-align:center;color:var(--rmut)}
/* transport */
.regie .transport{grid-column:1/3;display:flex;align-items:center;gap:12px;padding:0 16px;background:linear-gradient(180deg,#0d0d1e,#090914);border-top:1px solid var(--rline)}
.regie .rb{width:38px;height:38px;border-radius:50%;background:var(--rpan2);border:1px solid var(--rline);display:grid;place-items:center;font-size:14px;cursor:pointer;color:#d2d5f0}
.regie .rb:hover{background:#20203f}
.regie .rb.pl{width:46px;height:46px;font-size:17px;background:radial-gradient(circle at 40% 30%,#b47bff,#7c3aed);box-shadow:0 0 18px rgba(168,85,247,.5);color:#fff;border-color:transparent}
.regie .rb.rec{color:#ff6b7a}
.regie .lcd{font-variant-numeric:tabular-nums;font-size:15px;background:linear-gradient(#0a0618,#0e0a20);border:1px solid #2a2150;border-radius:8px;padding:5px 11px;color:#d7b3ff}
.regie .muted{color:var(--rmut);font-size:12px}
.regie .vu{height:8px;border-radius:5px;background:linear-gradient(90deg,#1a1530,#1a1530);position:relative;overflow:hidden}
.regie .vu i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,var(--rgr),var(--rgold) 72%,#ef4444)}
.regie .msg{max-width:92%;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.45;margin-bottom:9px}
.regie .msg.ai{background:linear-gradient(180deg,#171636,#121028);border:1px solid #2a2752}
.regie .msg.me{background:linear-gradient(120deg,rgba(168,85,247,.3),rgba(34,211,238,.16));margin-left:auto;border:1px solid rgba(168,85,247,.4)}
.regie .orb{width:50px;height:50px;border-radius:50%;flex:none;background:radial-gradient(circle at 36% 30%,#eafaff,#22d3ee 30%,#0a3b63 75%);box-shadow:0 0 24px rgba(34,211,238,.55)}
.regie .vcard{border:1px solid var(--rline);border-radius:12px;padding:12px;background:linear-gradient(180deg,#141430,#0d0d1e)}
.regie .vcard h4{margin:0 0 4px;font-size:14px}.regie .vcard p{margin:0 0 10px;font-size:11.5px;color:var(--rmut);line-height:1.4}
@media(max-width:1050px){.regie{grid-template-columns:60px 1fr}.regie .rbrand{width:0}}
`;

function injectCss() {
  if (!document.getElementById('regie-css')) {
    const s = document.createElement('style');
    s.id = 'regie-css'; s.textContent = CSS; document.head.append(s);
  }
}

// ---------------------------------------------------------------- helpers maquette (aperçus)
function waveSvgPath(w, hh, dens, seed) {
  let r = seed || 1; const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  const mid = hh / 2, n = Math.floor(w / dens); let top = '', bot = '';
  for (let i = 0; i <= n; i++) { const x = (i / n * w).toFixed(1); const env = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.09 + seed)) * (0.6 + 0.4 * rnd()); const a = env * (mid - 2) * (0.5 + 0.5 * rnd()); top += (i ? 'L' : 'M') + x + ' ' + (mid - a).toFixed(1) + ' '; }
  for (let i = n; i >= 0; i--) { const x = (i / n * w).toFixed(1); const env = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.09 + seed)) * (0.6 + 0.4 * ((r = (r * 9301 + 49297) % 233280) / 233280)); const a = env * (mid - 2) * (0.5 + 0.5 * ((r = (r * 9301 + 49297) % 233280) / 233280)); bot += 'L' + x + ' ' + (mid + a).toFixed(1) + ' '; }
  return top + bot + 'Z';
}
const clipSvg = (color, seed) => `<svg viewBox="0 0 1000 60" preserveAspectRatio="none" style="width:100%;height:100%"><defs><linearGradient id="rg${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".55"/><stop offset=".5" stop-color="${color}" stop-opacity=".2"/><stop offset="1" stop-color="${color}" stop-opacity=".55"/></linearGradient></defs><path d="${waveSvgPath(1000, 60, 5, seed)}" fill="url(#rg${seed})" stroke="${color}" stroke-width=".6"/></svg>`;
const knobHtml = (nm, val, color, pct, big) => `<div class="kn ${big ? 'kbig' : ''}"><div class="k" style="--kc:${color};--p:${Math.round(pct * 2.7)}deg;width:${big ? 112 : 56}px;height:${big ? 112 : 56}px"><i></i></div><div class="nm">${nm}</div><div class="vv">${val}</div></div>`;
const spec3d = () => `<svg viewBox="0 0 520 150" preserveAspectRatio="none" style="width:100%;height:100%"><defs><linearGradient id="row" x1="0" x2="1"><stop offset="0" stop-color="#ec4899"/><stop offset=".5" stop-color="#a855f7"/><stop offset="1" stop-color="#22d3ee"/></linearGradient><filter id="og"><feGaussianBlur stdDeviation="2.3"/></filter></defs><g filter="url(#og)"><path d="M0 150 L0 96 L40 100 L75 60 L110 92 L150 40 L185 88 L220 54 L260 96 L300 46 L340 90 L380 66 L420 100 L460 72 L520 104 L520 150Z" fill="rgba(34,211,238,.22)"/><path d="M0 150 L0 112 L45 108 L85 74 L120 104 L160 60 L200 100 L235 72 L275 108 L315 64 L355 102 L395 82 L435 112 L475 88 L520 116 L520 150Z" fill="rgba(168,85,247,.3)"/><path d="M0 150 L0 126 L50 122 L95 96 L135 120 L175 86 L215 118 L255 92 L295 122 L335 88 L375 118 L415 100 L455 124 L495 106 L520 126 L520 150Z" fill="rgba(236,72,153,.42)"/></g><path d="M0 96 L40 100 L75 60 L110 92 L150 40 L185 88 L220 54 L260 96 L300 46 L340 90 L380 66 L420 100 L460 72 L520 104" fill="none" stroke="url(#row)" stroke-width="1.6" opacity=".9"/></svg>`;
const eqCurveSvg = () => `<svg viewBox="0 0 500 110" preserveAspectRatio="none" style="width:100%;height:100%"><defs><linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a855f7" stop-opacity=".5"/><stop offset="1" stop-color="#a855f7" stop-opacity="0"/></linearGradient></defs><path d="M0 70 C80 66 110 40 170 50 C240 62 270 90 340 62 C410 38 450 54 500 46 L500 110 L0 110Z" fill="url(#eqg)"/><path d="M0 70 C80 66 110 40 170 50 C240 62 270 90 340 62 C410 38 450 54 500 46" fill="none" stroke="#c98bff" stroke-width="2"/><circle cx="170" cy="50" r="5" fill="#22d3ee"/><circle cx="340" cy="62" r="5" fill="#ec4899"/></svg>`;
const levelBar = (w = '100%') => `<div style="height:9px;border-radius:5px;width:${w};background:linear-gradient(90deg,#34e39a,#f0b429 70%,#ef4444)"></div>`;

// ---------------------------------------------------------------- utilitaires timeline réelle
function trackColor(t, i) {
  const n = (t.name || '').toLowerCase(), k = (t.kind || '').toLowerCase();
  if (k === 'instru' || n.includes('instru') || n.includes('beat') || n.includes('prod')) return '#f59e0b';
  if (n.includes('lead') || n.includes('princip')) return '#ec4899';
  if (n.includes('double')) return '#22d3ee';
  if (n.includes('harmon')) return '#a855f7';
  if (n.includes('ad-lib') || n.includes('adlib') || n.includes('ad lib')) return '#34e39a';
  const pal = ['#ec4899', '#22d3ee', '#a855f7', '#34e39a', '#f59e0b', '#7c6cff'];
  return pal[i % pal.length];
}
const fmtLcd = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s - Math.floor(s)) * 1000); return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`; };

// ================================================================ vue principale
export async function render(el, { params }) {
  injectCss();
  const projectId = state.projectId || 'perso';
  const SKEY = `rec:${projectId}`;
  const proj = currentProject();

  let tracks = [];          // {name,kind,gainDb,pan,offset,mute,solo,armed,empty,fxDone,fx,fileId,buffer,original}
  let sessionSelected = 0;
  let cur = (params && params.get && params.get('tab')) || 'regie';
  let pxPerSec = 80;        // zoom horizontal
  // lecture
  let playing = false, srcs = [], ctxRef = null, startedAt = 0, startOffset = 0, playTotal = 0, raf = 0, analyser = null, anaData = null, masterGain = null;

  async function load() {
    tracks = [];
    try {
      const s = await getItem(SKEY);
      sessionSelected = s?.selected ?? 0;
      for (const t of s?.tracks || []) {
        const buffer = unpackBuffer(t.buf); if (!buffer) continue;
        tracks.push({ name: t.name, kind: t.kind, gainDb: t.gainDb ?? 0, pan: t.pan ?? 0, offset: t.offset ?? 0, mute: !!t.mute, solo: !!t.solo, armed: !!t.armed, empty: !!t.empty, fxDone: t.fxDone || [], fx: t.fx || null, fileId: t.fileId, buffer, original: unpackBuffer(t.orig) || buffer });
      }
    } catch (e) { /* projet vide */ }
  }

  // Sauvegarde dans le MÊME format que la page Enregistrement (round-trip garanti).
  async function save() {
    try {
      await putItem(SKEY, {
        v: 1, at: Date.now(), selected: sessionSelected,
        tracks: tracks.map(t => ({ name: t.name, kind: t.kind, gainDb: t.gainDb, pan: t.pan, offset: t.offset, mute: t.mute, solo: !!t.solo, armed: !!t.armed, empty: !!t.empty, fxDone: t.fxDone || [], fx: t.fx || null, fileId: t.fileId, buf: packBuffer(t.buffer), orig: t.original === t.buffer ? null : packBuffer(t.original) })),
      });
    } catch (e) { toast('Sauvegarde impossible (mémoire du navigateur ?)', 'bad'); }
  }

  const totalDuration = () => tracks.reduce((m, t) => Math.max(m, (t.offset || 0) + (t.buffer ? t.buffer.duration : 0)), 0);

  // ---------- lecture réelle d'un mix local ----------
  function stopPlay() {
    playing = false;
    for (const s of srcs) { try { s.stop(); } catch {} }
    srcs = []; cancelAnimationFrame(raf); raf = 0; analyser = null; masterGain = null;
    paintTransport();
  }
  function startPlay(from = 0) {
    if (playing) { stopPlay(); return; }
    const audible = tracks.filter(t => t.buffer);
    if (!audible.length) { toast('Aucune piste à lire.', 'bad'); return; }
    const ctx = audioCtx(); ctxRef = ctx;
    playTotal = totalDuration(); startOffset = Math.max(0, Math.min(from, playTotal));
    masterGain = ctx.createGain(); masterGain.gain.value = 1;
    analyser = ctx.createAnalyser(); analyser.fftSize = 1024; anaData = new Float32Array(analyser.fftSize);
    masterGain.connect(analyser); masterGain.connect(ctx.destination);
    const anySolo = tracks.some(t => t.solo);
    const t0 = ctx.currentTime + 0.05; startedAt = t0;
    for (const t of audible) {
      const on = anySolo ? t.solo : !t.mute; if (!on) continue;
      const src = ctx.createBufferSource(); src.buffer = t.buffer;
      const g = ctx.createGain(); g.gain.value = 10 ** ((t.gainDb || 0) / 20);
      let node = g;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, t.pan || 0)); g.connect(p); node = p; }
      src.connect(g); node.connect(masterGain);
      const off0 = t.offset || 0;
      const when = t0 + Math.max(0, off0 - startOffset);
      const into = Math.max(0, startOffset - off0);
      if (into < t.buffer.duration) { try { src.start(when, into); srcs.push(src); } catch {} }
    }
    playing = true; tick();
  }
  function tick() {
    if (!playing || !ctxRef) return;
    const pos = startOffset + (ctxRef.currentTime - startedAt);
    if (pos >= playTotal) { stopPlay(); movePlayhead(0); return; }
    movePlayhead(pos);
    // vumètre de sortie réel
    if (analyser && outMeter) {
      analyser.getFloatTimeDomainData(anaData);
      let s = 0; for (const x of anaData) s += x * x;
      const rms = Math.sqrt(s / anaData.length);
      const pct = Math.min(100, Math.max(0, (20 * Math.log10(rms + 1e-6) + 60) / 60 * 100));
      outMeter.style.width = pct.toFixed(0) + '%';
    }
    raf = requestAnimationFrame(tick);
  }

  // ---------- refs DOM partagées ----------
  let playheadEl = null, lcdEl = null, outMeter = null, playBtn = null, laneWrap = null;
  function movePlayhead(pos) {
    const x = 160 + pos * pxPerSec;
    if (playheadEl) playheadEl.style.left = x + 'px';
    if (lcdEl) lcdEl.textContent = `${fmtLcd(pos)} / ${fmtLcd(totalDuration())}`;
  }
  function paintTransport() {
    if (playBtn) playBtn.textContent = playing ? '⏸' : '▶';
    if (!playing && outMeter) outMeter.style.width = '0%';
  }

  // ---------- rendu de la Timeline réelle ----------
  function drawClip(canvas, t, i) {
    try { drawWave(canvas, t.buffer, { color: trackColor(t, i) }); } catch {}
  }
  function buildTimeline(container) {
    container.innerHTML = '';
    const total = totalDuration();
    if (!tracks.length) {
      container.append(h('div.emptytl',
        h('div', { style: { fontSize: '15px', fontWeight: '700', marginBottom: '6px' } }, '🎼 Aucune piste dans ce projet pour le moment'),
        h('p.muted', { style: { maxWidth: '460px', margin: '0 auto 14px' } }, 'La Régie lit le même projet que la page Enregistrement. Enregistre ou importe une piste pour la voir ici, avec sa vraie forme d’onde.'),
        h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
          h('a.rbtn.p', { href: '#/enregistrement' }, '🎙️ Aller enregistrer'),
          h('button.rbtn', { onclick: importTrack }, '📥 Importer un audio'))));
      return;
    }
    const beat = Math.max(40, pxPerSec); // repère visuel (1 s)
    const laneW = Math.max(300, total * pxPerSec);
    // règle temporelle
    const ruler = h('div.tl-ruler', { style: { width: (160 + laneW) + 'px' } });
    const stepSec = pxPerSec >= 120 ? 1 : pxPerSec >= 60 ? 2 : pxPerSec >= 30 ? 5 : 10;
    for (let s = 0; s <= total + stepSec; s += stepSec) ruler.append(h('span', { style: { left: (s * pxPerSec) + 'px' } }, fmtLcd(s).replace(/\.\d+$/, '')));
    container.append(ruler);

    playheadEl = h('div.playhead', { style: { left: '160px' } });
    const rows = h('div', { style: { position: 'relative' } });
    tracks.forEach((t, i) => {
      const color = trackColor(t, i);
      const mB = h('span.tbtn.m' + (t.mute ? '.on' : ''), 'M');
      const sB = h('span.tbtn.s' + (t.solo ? '.on' : ''), 'S');
      const aB = h('span.tbtn.a' + (t.armed ? '.on' : ''), '●');
      mB.onclick = () => { t.mute = !t.mute; mB.classList.toggle('on', t.mute); save(); };
      sB.onclick = () => { t.solo = !t.solo; sB.classList.toggle('on', t.solo); save(); };
      aB.onclick = () => { t.armed = !t.armed; aB.classList.toggle('on', t.armed); save(); };
      const vol = h('input', { type: 'range', min: -24, max: 6, step: 0.5, value: t.gainDb ?? 0, title: 'Volume (dB)' });
      const volLab = h('span', `${(t.gainDb ?? 0) > 0 ? '+' : ''}${t.gainDb ?? 0} dB`);
      vol.oninput = () => { t.gainDb = +vol.value; volLab.textContent = `${t.gainDb > 0 ? '+' : ''}${t.gainDb} dB`; };
      vol.onchange = save;
      const pan = h('input', { type: 'range', min: -1, max: 1, step: 0.1, value: t.pan ?? 0, title: 'Panoramique' });
      const panLab = h('span', panTxt(t.pan ?? 0));
      pan.oninput = () => { t.pan = +pan.value; panLab.textContent = panTxt(t.pan); };
      pan.onchange = save;
      const head = h('div.thead', { style: { '--tc': color } },
        h('div.nm', h('span', { style: { color } }, t.kind === 'instru' ? '🥁' : '🎤'), t.name || `Piste ${i + 1}`),
        h('div.ctrls', mB, sB, aB),
        vol, h('div.lab', 'Vol', volLab),
        pan, h('div.lab', 'Pan', panLab));

      const lane = h('div.lane', { style: { '--beat': beat + 'px', width: laneW + 'px' } });
      if (t.buffer) {
        const clipW = Math.max(8, t.buffer.duration * pxPerSec);
        const canvas = h('canvas');
        const clip = h('div.clip', { style: { left: ((t.offset || 0) * pxPerSec) + 'px', width: clipW + 'px' } }, canvas, h('div.cnm', t.name || ''));
        lane.append(clip);
        // dessin après insertion (clientWidth disponible)
        setTimeout(() => { canvas.style.width = clipW + 'px'; canvas.style.height = '100%'; drawClip(canvas, t, i); }, 0);
      }
      // clic sur la lane = placer la tête de lecture
      lane.onclick = (e) => {
        const rect = lane.getBoundingClientRect();
        const pos = Math.max(0, (e.clientX - rect.left) / pxPerSec);
        if (playing) { stopPlay(); startPlay(pos); } else movePlayhead(pos);
        startOffset = pos;
      };
      rows.append(h('div.trk', head, lane));
    });
    rows.append(playheadEl);
    container.append(rows);
    // bouton ajouter / importer
    container.append(h('div', { style: { display: 'flex', gap: '10px', marginTop: '6px' } },
      h('button.rbtn', { onclick: importTrack, style: { width: '158px' } }, '➕ Importer une piste')));
    movePlayhead(startOffset);
  }
  const panTxt = (p) => p === 0 ? 'C' : (p < 0 ? `G${Math.round(-p * 100)}` : `D${Math.round(p * 100)}`);

  async function importTrack() {
    const files = await pickLocalFiles('audio/*', false);
    if (!files || !files.length) return;
    try {
      toast('Décodage de l’audio…');
      const buffer = await decodeBlob(files[0]);
      tracks.push({ name: files[0].name.replace(/\.[^.]+$/, '') || 'Import', kind: 'voix', gainDb: 0, pan: 0, offset: 0, mute: false, solo: false, armed: false, empty: false, fxDone: [], fx: null, fileId: null, buffer, original: buffer });
      await save();
      toast('Piste importée ✓ (partagée avec la page Enregistrement)', 'ok');
      if (cur === 'timeline') go('timeline'); else if (cur === 'regie') go('regie');
    } catch (e) { toastErr(e); }
  }

  // ---------- enregistrement RÉEL (réutilise le moteur micro de core.js) ----------
  const recOpt = { countIn: 1, metro: false, playInstru: true, monitor: false, monVol: 0.7, bpm: 90, arm: 'new' };
  let rec = null, recording = false, monNode = null, instruSrc = null, metroTimer = null, inMeterFill = null, recBtnEl = null, recStatusEl = null;
  const isInstru = (t) => t.kind === 'instru' || /instru|beat|prod/i.test(t.name || '');
  function setInMeter(l) { if (inMeterFill) inMeterFill.style.width = Math.min(100, Math.round((20 * Math.log10((l || 0) + 1e-6) + 60) / 60 * 100)) + '%'; }
  function updateRecUI() {
    if (recBtnEl) { recBtnEl.textContent = recording ? '⏹' : '⏺'; recBtnEl.style.background = recording ? 'radial-gradient(circle at 40% 30%,#ff8a8a,#d11)' : ''; }
    if (recStatusEl) recStatusEl.textContent = recording ? '🔴 Enregistrement en cours… (clique pour arrêter)' : 'Prêt à enregistrer';
  }
  function clickAt(ctx, when, accent) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1600 : 1000; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(recOpt.monVol * 0.5 + 0.2, when + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.start(when); o.stop(when + 0.06);
  }
  async function playCountIn(bpm, bars) {
    const ctx = audioCtx(), beat = 60 / Math.max(40, bpm), t0 = ctx.currentTime + 0.12;
    for (let i = 0; i < bars * 4; i++) clickAt(ctx, t0 + i * beat, i % 4 === 0);
    await new Promise(r => setTimeout(r, bars * 4 * beat * 1000 + 80));
  }
  function startMon(stream) {
    try { const ctx = audioCtx(), src = ctx.createMediaStreamSource(stream), g = ctx.createGain(); g.gain.value = recOpt.monVol; src.connect(g).connect(ctx.destination); monNode = { src, g }; } catch {}
  }
  function stopMon() { try { monNode?.src.disconnect(); monNode?.g.disconnect(); } catch {} monNode = null; }
  async function startRecording() {
    if (recording) return;
    try {
      if (recOpt.countIn > 0) { if (recStatusEl) recStatusEl.textContent = '① Décompte…'; await playCountIn(recOpt.bpm, recOpt.countIn); }
      rec = await startRecorder({ onLevel: setInMeter });
      recording = true; updateRecUI();
      const ctx = audioCtx(), t0 = ctx.currentTime + 0.08;
      if (recOpt.playInstru) { const ins = tracks.find(isInstru); if (ins?.buffer) { try { instruSrc = ctx.createBufferSource(); instruSrc.buffer = ins.buffer; const g = ctx.createGain(); g.gain.value = 10 ** ((ins.gainDb || 0) / 20); instruSrc.connect(g).connect(ctx.destination); instruSrc.start(t0); } catch {} } }
      if (recOpt.metro) { const beat = 60 / Math.max(40, recOpt.bpm); let n = 0; metroTimer = setInterval(() => clickAt(ctx, audioCtx().currentTime + 0.02, (n++) % 4 === 0), beat * 1000); }
      if (recOpt.monitor) startMon(rec.stream);
    } catch (e) { recording = false; rec = null; updateRecUI(); toast('Micro inaccessible : ' + (e?.message || e), 'bad'); }
  }
  async function stopRecording() {
    if (!rec) return;
    const r = rec; rec = null; recording = false;
    stopMon(); try { instruSrc?.stop(); } catch {} instruSrc = null; clearInterval(metroTimer); metroTimer = null;
    updateRecUI(); if (inMeterFill) inMeterFill.style.width = '0%';
    try {
      const blob = await r.stop();
      const buffer = await decodeBlob(blob);
      if (!buffer || buffer.duration < 0.2) { toast('Prise trop courte, réessaie.', 'bad'); return; }
      if (recOpt.arm !== 'new' && tracks[+recOpt.arm]) { const t = tracks[+recOpt.arm]; t.buffer = buffer; t.original = buffer; t.empty = false; }
      else tracks.push({ name: `Voix ${tracks.filter(t => !isInstru(t)).length + 1}`, kind: 'voix', gainDb: 0, pan: 0, offset: 0, mute: false, solo: false, armed: true, empty: false, fxDone: [], fx: null, fileId: null, buffer, original: buffer });
      await save();
      toast(`Prise enregistrée ✓ (${buffer.duration.toFixed(1)} s) — visible dans la Timeline`, 'ok');
      go(cur);
    } catch (e) { toastErr(e); }
  }
  function stopAllRec() { try { rec?.stop(); } catch {} rec = null; recording = false; stopMon(); try { instruSrc?.stop(); } catch {} instruSrc = null; clearInterval(metroTimer); }

  // ================================================================ onglets
  function viewTimeline() {
    const wrap = h('div.panel', { style: { height: 'calc(100% - 2px)', display: 'flex', flexDirection: 'column' } });
    const zoomOut = h('button.rbtn', { onclick: () => { pxPerSec = Math.max(12, pxPerSec / 1.5); buildTimeline(body); }, title: 'Dézoomer' }, '🔍−');
    const zoomIn = h('button.rbtn', { onclick: () => { pxPerSec = Math.min(600, pxPerSec * 1.5); buildTimeline(body); }, title: 'Zoomer (jusqu’à la syllabe)' }, '🔍+');
    wrap.append(h('div.ph', '🎵 Timeline multipiste',
      h('span.r', `${tracks.length} piste(s) · ${fmtLcd(totalDuration()).replace(/\.\d+$/, '')} · projet « ${proj.name} »`),
      h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' } },
        zoomOut, h('span.muted', `${pxPerSec | 0} px/s`), zoomIn,
        h('button.rbtn.p', { onclick: () => startPlay(startOffset) }, '▶ Lire'),
        h('button.rbtn', { onclick: () => { stopPlay(); movePlayhead(0); startOffset = 0; } }, '⏹'))));
    const body = h('div.pb', { style: { flex: '1', overflow: 'auto' } });
    wrap.append(body);
    laneWrap = body;
    setTimeout(() => buildTimeline(body), 0);
    return wrap;
  }

  function viewRegie() {
    const root = h('div');
    const check = (x) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:7px;font-size:13px"><span style="width:18px;height:18px;border-radius:50%;background:#34e39a;display:grid;place-items:center;color:#042;font-weight:900;font-size:11px">✓</span><span style="flex:1">${x.split('|')[0]}</span><b>${x.split('|')[1]}</b></div>`;
    const proc = (x) => `<div style="display:flex;gap:9px;align-items:center;margin-bottom:9px;font-size:12px"><span style="width:16px;height:16px;border-radius:50%;background:#34e39a;display:grid;place-items:center;color:#042;font-weight:900;font-size:10px">✓</span>${x}<span style="flex:1;height:6px;border-radius:4px;background:#1b1440;overflow:hidden"><i style="display:block;height:100%;background:linear-gradient(90deg,#a855f7,#34e39a)"></i></span><small class="muted">100%</small></div>`;
    root.innerHTML = `
     <div class="grid" style="grid-template-columns:1.05fr 1.05fr 1.5fr 150px">
      <div class="panel"><div class="ph">📊 Analyse vocale IA <span class="r" style="color:#8a8fb5">aperçu</span></div><div class="pb" style="display:flex;gap:12px;align-items:center">
       <svg viewBox="0 0 88 88" style="width:82px;height:82px;flex:none"><circle cx="44" cy="44" r="36" fill="none" stroke="#1b1440" stroke-width="8"/><circle cx="44" cy="44" r="36" fill="none" stroke="#34e39a" stroke-width="8" stroke-linecap="round" stroke-dasharray="226" stroke-dashoffset="16" transform="rotate(-90 44 44)" style="filter:drop-shadow(0 0 6px #34e39a)"/><text x="44" y="49" text-anchor="middle" font-size="19" font-weight="800" fill="#fff">96%</text></svg>
       <div style="flex:1">${['Justesse|98%', 'Clarté|97%', 'Dynamique|95%', 'Sibilances|92%'].map(check).join('')}</div></div></div>
      <div class="panel"><div class="ph">⚙️ Traitement IA <span class="r" style="color:#8a8fb5">aperçu</span></div><div class="pb">${['Auto-Tune', 'EQ intelligent', 'Compression', 'Réverbération', 'Mastering IA'].map(proc).join('')}</div></div>
      <div class="panel"><div class="ph">🌈 Spectre temps réel · réduction de bruit <span class="r" style="color:#8a8fb5">aperçu</span></div><div class="pb"><div style="height:150px;border-radius:11px;overflow:hidden;background:#07041a;border:1px solid var(--rline);position:relative">${spec3d()}<div style="position:absolute;right:12px;top:10px;text-align:right"><b style="font-size:17px">−24 dB</b><div class="muted" style="font-size:10px">Réduction bruit</div></div></div></div></div>
      <div class="panel"><div class="ph">🎚️ Niveaux</div><div class="pb">
       <div style="display:flex;gap:9px;align-items:center;font-size:11px;margin-bottom:9px"><span class="muted" style="width:44px">Entrée</span>${levelBar()}<b>−6.2</b></div>
       <div style="display:flex;gap:9px;align-items:center;font-size:11px;margin-bottom:9px"><span class="muted" style="width:44px">Sortie</span>${levelBar()}<b>−3.1</b></div>
       <div style="text-align:center;background:#120d02;border:1px solid #4a3410;border-radius:9px;padding:9px"><b style="font-size:20px;color:#ffd37a">−8.9</b><div class="muted" style="font-size:9px">LUFS INTÉGRÉ</div></div></div></div>
     </div>
     <div class="panel" style="margin-top:12px"><div class="ph">🎛️ Rack · aperçu des modules <span class="r">8 modules · onglet « Effets » pour éditer</span></div><div class="pb"><div class="grid" style="grid-template-columns:repeat(8,1fr)">
      ${knobHtml('Auto-Tune', '10', '#22d3ee', 55)}${knobHtml('EQ', '+2.5 dB', '#f0b429', 62)}${knobHtml('Comp', '4:1', '#22d3ee', 72)}${knobHtml('De-Ess', '−18', '#22c55e', 48)}${knobHtml('Satur.', '12%', '#ff6b3d', 30)}${knobHtml('Reverb', '28%', '#a855f7', 40)}${knobHtml('Delay', '22%', '#22d3ee', 36)}${knobHtml('Stéréo', '140%', '#ec4899', 80)}
     </div></div></div>`;
    // ligne du bas : Timeline RÉELLE + Marco
    const mini = h('div.pb');
    const bottom = h('div.grid', { style: { gridTemplateColumns: '1.6fr 1fr', marginTop: '12px' } },
      h('div.panel', h('div.ph', '🎵 Timeline', h('span.r', 'onglet « Timeline » pour le plein écran')), mini),
      h('div.panel', { html: `<div class="ph">🧠 Ingé son IA — Marco</div><div class="pb"><div style="display:flex;gap:11px;align-items:center;margin-bottom:10px"><div class="orb"></div><div><b>Marco · IA</b><div class="muted" style="font-size:12px">Tonalité détectée : <b style="color:#bff5db">Do# mineure</b></div></div></div><div class="msg ai">« Ta voix est juste à 98 %. Je te propose +2 dB de présence et un de-esser léger. Tu veux la version <b>naturelle</b>, <b>pro</b> ou <b>créative</b> ? »</div><div style="display:flex;gap:7px"><span class="rbtn p" style="flex:1;text-align:center">Naturelle</span><span class="rbtn" style="flex:1;text-align:center">Pro</span><span class="rbtn" style="flex:1;text-align:center">Créative</span></div></div>` }));
    root.append(bottom);
    setTimeout(() => buildTimeline(mini), 0);
    return root;
  }

  function viewRec() {
    const root = h('div');
    const ins = tracks.find(isInstru);
    // gros bouton REC réel
    recBtnEl = h('div.rb.rec', { style: { width: '68px', height: '68px', fontSize: '28px', cursor: 'pointer', boxShadow: '0 0 26px rgba(239,68,68,.4)' }, onclick: () => recording ? stopRecording() : startRecording() }, recording ? '⏹' : '⏺');
    recStatusEl = h('div.muted', { style: { fontSize: '12px' } }, recording ? '🔴 Enregistrement en cours…' : 'Prêt à enregistrer');
    // choix de la piste à enregistrer
    const armSel = h('select', { style: selStyle(), onchange: (e) => { recOpt.arm = e.target.value; } },
      h('option', { value: 'new', selected: recOpt.arm === 'new' }, '➕ Nouvelle piste voix'),
      ...tracks.map((t, i) => isInstru(t) ? null : h('option', { value: String(i), selected: recOpt.arm === String(i) }, `↻ Remplacer : ${t.name || 'Piste ' + (i + 1)}`)));
    // chips options (réelles)
    const chip = (label, key) => { const c = h('span.chip' + (recOpt[key] ? '.on' : ''), label); c.onclick = () => { recOpt[key] = !recOpt[key]; c.classList.toggle('on', recOpt[key]); }; return c; };
    const countSel = h('select', { style: selStyle(), onchange: (e) => { recOpt.countIn = +e.target.value; } },
      [0, 1, 2].map(n => h('option', { value: n, selected: recOpt.countIn === n }, n === 0 ? 'Décompte : non' : `Décompte : ${n} mesure${n > 1 ? 's' : ''}`)));
    const bpmIn = h('input', { type: 'number', min: 40, max: 220, value: recOpt.bpm, style: { ...selStyle(), width: '66px' }, onchange: (e) => { recOpt.bpm = Math.max(40, Math.min(220, +e.target.value || 90)); } });
    // mètre d'entrée réel
    inMeterFill = h('i', { style: { position: 'absolute', left: '0', top: '0', bottom: '0', width: '0%', background: 'linear-gradient(90deg,#34e39a,#f0b429 72%,#ef4444)', transition: 'width .05s' } });
    const inMeter = h('div', { style: { position: 'relative', height: '12px', borderRadius: '6px', background: '#141230', overflow: 'hidden', flex: '1' } }, inMeterFill);
    // monitoring réel
    const monChip = h('span.chip' + (recOpt.monitor ? '.on' : ''), '🎧 M’entendre dans le casque');
    monChip.onclick = () => { recOpt.monitor = !recOpt.monitor; monChip.classList.toggle('on', recOpt.monitor); if (recording) { recOpt.monitor ? startMon(rec.stream) : stopMon(); } };
    const monVol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: recOpt.monVol, oninput: (e) => { recOpt.monVol = +e.target.value; if (monNode) monNode.g.gain.value = recOpt.monVol; } });

    const left = h('div.panel',
      h('div.ph', '🎙️ Prise de son', h('span.r', 'prise brute conservée · casque conseillé')),
      h('div.pb',
        h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '14px' } },
          recBtnEl,
          h('div', { style: { flex: '1' } },
            h('div', { style: { fontSize: '15px', fontWeight: '700', marginBottom: '4px' } }, 'Enregistrer la voix'),
            recStatusEl,
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '9px' } }, h('span.muted', { style: { fontSize: '11px', width: '42px' } }, 'Niveau'), inMeter))),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' } },
          h('span.muted', { style: { fontSize: '12px' } }, 'Piste :'), armSel, countSel, h('span.muted', { style: { fontSize: '12px' } }, 'BPM'), bpmIn,
          chip('🥁 Jouer l’instru', 'playInstru'), chip('🎵 Métronome', 'metro')),
        ins ? h('div', { style: { border: '1px solid var(--rline)', borderRadius: '11px', overflow: 'hidden', background: '#0c0a1e' } },
          h('div', { style: { padding: '7px 11px', fontSize: '11px', color: 'var(--rmut)' }, html: `🥁 ${ins.name || 'Instru'} — jouée pendant la prise` }),
          h('div', { style: { height: '54px' }, html: clipSvg('#f59e0b', 7) }))
          : h('p.muted', { style: { fontSize: '12px' } }, 'Astuce : importe un instru dans la Timeline pour chanter dessus.')));

    const right = h('div.panel',
      h('div.ph', '🎧 Écoute en direct (monitoring)'),
      h('div.pb',
        monChip,
        h('div', { style: { display: 'flex', gap: '9px', alignItems: 'center', margin: '14px 0', fontSize: '12px' } }, h('span.muted', { style: { width: '92px' } }, 'Volume casque'), monVol),
        h('div.muted', { style: { fontSize: '10px', lineHeight: '1.4' } }, '⚠️ Mets un casque filaire : sans casque, le micro réentend les haut-parleurs (effet larsen). L’autotune complet se calcule après la prise.')));

    root.append(h('div.grid', { style: { gridTemplateColumns: '1.3fr .9fr' } }, left, right));
    updateRecUI();
    return root;
  }
  const selStyle = () => ({ padding: '6px 9px', borderRadius: '8px', background: '#0c0c1a', border: '1px solid var(--rline)', color: 'var(--rtxt)', fontSize: '12px' });

  function viewFx() {
    const scaleKbd = () => {
      const chips = ['Chromatique', 'Majeure', 'Mineure', 'Dorien', 'Blues'].map((s, i) => `<span class="chip ${i === 2 ? 'on' : ''}">${s}</span>`).join('');
      const keys = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'].map((n, i) => `<div style="flex:1;border-radius:0 0 5px 5px;border:1px solid #05060c;display:flex;align-items:flex-end;justify-content:center;padding-bottom:5px;font-size:9px;background:${[2, 5, 6].includes(i) ? 'linear-gradient(180deg,#14324e,#10243c);color:#bfe9ff;box-shadow:inset 0 0 10px rgba(34,211,238,.4)' : 'linear-gradient(180deg,#1b1b32,#101020);color:#6b6f90'}">${n}</div>`).join('');
      return `<div style="margin-top:12px;border-top:1px solid rgba(255,255,255,.06);padding-top:11px"><div class="muted" style="font-size:11px;margin-bottom:8px">🎹 Gamme · <b style="color:#bff5db">Do# mineure</b> — notes exactes</div><div style="display:flex;gap:6px;flex-wrap:wrap">${chips}</div><div style="display:flex;gap:3px;margin-top:9px;height:60px">${keys}</div></div>`;
    };
    const mods = [
      { t: '🎤 Auto-Tune Pro', c: '#a855f7', scale: 1, k: [['Retune', '10', '#22d3ee', 55, 1], ['Humanize', '35%', '#22d3ee', 38], ['Flex', '20%', '#22d3ee', 22], ['Formant', '0', '#22d3ee', 50], ['Vibrato', 'nat.', '#22d3ee', 40]] },
      { t: '🎚️ Égaliseur', c: '#3b82f6', eq: 1, k: [['Low', '−2 dB', '#22d3ee', 45], ['Mid', '+2.5 dB', '#ec4899', 60], ['High', '+3 dB', '#a855f7', 66], ['Air', '+4 dB', '#22d3ee', 70]] },
      { t: '🗜️ Compression', c: '#f0b429', gr: 1, k: [['Thresh', '−18', '#f0b429', 40], ['Ratio', '4:1', '#f0b429', 55], ['Attack', '10 ms', '#f0b429', 30], ['Makeup', '+3 dB', '#f0b429', 58]] },
      { t: '🌫️ Réverbe', c: '#a855f7', k: [['Taille', '72%', '#a855f7', 72], ['Decay', '3.2 s', '#a855f7', 55], ['Mix', '28%', '#a855f7', 28]] },
      { t: '🔁 Delay / Écho', c: '#22d3ee', k: [['Time', '1/8', '#22d3ee', 40], ['Feedback', '35%', '#22d3ee', 35], ['Mix', '22%', '#22d3ee', 22]] },
      { t: '🎼 Harmonies', c: '#ec4899', k: [['Tierce', 'on', '#ec4899', 60], ['Quinte', 'on', '#ec4899', 55], ['Octave', 'on', '#ec4899', 45], ['Niveau', '50%', '#ec4899', 50]] },
      { t: '🔥 Saturation', c: '#ff6b3d', k: [['Drive', '22%', '#ff6b3d', 22], ['Ton', 'warm', '#ff6b3d', 45], ['Mix', '40%', '#ff6b3d', 40]] },
      { t: '🧼 De-Esser', c: '#22c55e', k: [['Fréq', '6.8k', '#22c55e', 55], ['Dose', '−4 dB', '#22c55e', 40]] },
    ];
    let html = '<div class="grid" style="grid-template-columns:1fr 1fr">';
    for (const m of mods) {
      html += `<div class="panel"><div class="ph"><span style="width:11px;height:11px;border-radius:50%;background:${m.c};box-shadow:0 0 8px ${m.c};flex:none"></span>${m.t}<span class="r" style="margin-left:auto;color:#8a8fb5">aperçu</span></div><div class="pb">`;
      if (m.eq) html += `<div style="height:108px;border-radius:10px;overflow:hidden;border:1px solid var(--rline);margin-bottom:12px;background:#0b0b1a">${eqCurveSvg()}</div>`;
      html += `<div class="grid" style="grid-template-columns:repeat(${m.k.length},1fr)">${m.k.map(k => knobHtml(k[0], k[1], k[2], k[3], k[4])).join('')}</div>`;
      if (m.gr) html += `<div style="display:flex;gap:9px;align-items:center;margin-top:12px;font-size:11px;color:var(--rmut)"><span>GR</span><div style="flex:1;height:8px;border-radius:4px;background:#1c1710;overflow:hidden"><i style="display:block;height:100%;width:36%;float:right;background:linear-gradient(90deg,#ff6b3d,#f0b429)"></i></div><b style="color:#f0b429">−4.2 dB</b></div>`;
      if (m.scale) html += scaleKbd();
      html += '</div></div>';
    }
    html += '</div>';
    const root = h('div'); root.innerHTML = html; return root;
  }

  function viewRepo() {
    const CATS = { 'Références': ['Jul · mélodique', 'Naza · puissant', 'LJK · hard tune'], 'Autotune (60)': ['Rap FR Pro', 'Drill sombre', 'Trap 808', 'Hard snap', 'Soft melodic'], 'Vraies voix (36)': ['Chant velours', 'Voix grave', 'Voix aiguë', 'Voix féminine'], 'Ambiances (30)': ['Club', 'Nuit', 'Live', 'Radio', 'Téléphone'], 'Effets (60+)': ['Vocoder', 'Robot', 'Lo-Fi', 'Tube', 'Mega'] };
    const FX_CHAIN = [['🎤 Auto-Tune', '#a855f7', 1], ['🎚️ EQ', '#3b82f6', 1], ['🗜️ Compression', '#f0b429', 1], ['🧼 De-Esser', '#22c55e', 1], ['🔥 Saturation', '#ff6b3d', 0], ['🎼 Harmonies', '#ec4899', 1], ['🌫️ Réverbe', '#a855f7', 1], ['🔁 Delay', '#22d3ee', 1]];
    let lib = '';
    for (const cat in CATS) lib += `<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:800;color:#c9b6ff;margin-bottom:8px;letter-spacing:.04em">${cat.toUpperCase()}</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${CATS[cat].map((p, i) => `<div class="vcard" style="padding:10px;display:flex;gap:9px;align-items:center${cat.includes('Réf') && i === 0 ? ';border-color:var(--rpur);box-shadow:0 0 14px rgba(168,85,247,.3)' : ''}"><div style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--rpur),var(--rcy));flex:none"></div><div style="min-width:0"><b style="font-size:13px">${p}</b><div class="muted" style="font-size:10px">${cat.split(' ')[0]}</div></div></div>`).join('')}</div></div>`;
    const chips = ['Tous', 'Références', 'Autotune', 'Vraies voix', 'Ambiances', 'Transposer', 'Timbre', 'Vocodeur', 'Styles', 'Effets'].map((c, i) => `<span class="chip ${i === 0 ? 'on' : ''}">${c}</span>`).join('');
    const fxchain = FX_CHAIN.map(f => `<div style="display:flex;gap:10px;align-items:center;padding:8px 9px;border-radius:9px;margin-bottom:5px;font-size:13px;font-weight:600;${f[2] ? 'background:linear-gradient(90deg,rgba(168,85,247,.16),transparent)' : ''}"><span style="width:11px;height:11px;border-radius:50%;background:${f[2] ? f[1] : 'transparent'};box-shadow:0 0 7px ${f[2] ? f[1] : 'transparent'};border:1.5px solid ${f[1]};flex:none"></span>${f[0]}<span style="margin-left:auto;color:#3b3a60;letter-spacing:-2px">⠿</span></div>`).join('');
    const root = h('div');
    root.innerHTML = `<div class="grid" style="grid-template-columns:1fr 300px">
       <div class="panel"><div class="ph">📚 Bibliothèque de presets <span class="r">235 presets</span></div><div class="pb" style="max-height:calc(100vh - 230px);overflow:auto"><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${chips}</div>${lib}</div></div>
       <div style="display:grid;gap:12px;align-content:start">
         <div class="panel"><div class="ph">🎛️ Chaîne d'effets</div><div class="pb">${fxchain}</div></div>
         <div class="panel" data-projects><div class="ph">🗂️ Mes projets</div><div class="pb"></div></div>
       </div></div>`;
    // vrais projets cliquables
    const pbox = root.querySelector('[data-projects] .pb');
    for (const p of state.projects || []) pbox.append(h('div.ditem' + (p.id === projectId ? '.on' : ''), { style: { marginBottom: '4px' }, onclick: () => { state.projectId = p.id; localStorage.setItem('studio.project', p.id); location.hash = '#/regie'; } }, `${p.icon || '🗂️'} ${p.name}`));
    return root;
  }

  function viewIA() {
    const root = h('div');
    root.innerHTML = `<div class="grid" style="grid-template-columns:1.3fr 1fr">
      <div class="panel" style="display:flex;flex-direction:column"><div class="ph">🧠 Ingé son IA — Marco <span class="r" style="color:#8a8fb5">aperçu · branchement en phase 5</span></div>
       <div class="pb" style="flex:1;overflow:auto">
        <div style="display:flex;gap:10px;margin-bottom:12px"><div class="orb"></div><div class="msg ai" style="margin:0">Salut ! J'ai écouté ta prise. <b>Tonalité : Do# mineure</b>, tempo 90 BPM. Ta voix est juste (98 %), un peu de sifflantes à maîtriser. Je te prépare 3 versions.</div></div>
        <div class="msg me">Mets-moi un truc propre pour du rap mélodique.</div>
        <div style="display:flex;gap:10px;margin-bottom:12px"><div class="orb"></div><div class="msg ai" style="margin:0">Parfait. J'ai calé l'Auto-Tune sur Do# mineure, posé un de-esser léger et +2 dB de présence. Écoute les 3 rendus ci-contre 👉</div></div>
       </div>
       <div class="pb" style="border-top:1px solid var(--rline);display:flex;gap:9px"><input style="flex:1;padding:8px 10px;border-radius:9px;background:#0c0c1a;border:1px solid var(--rline);color:var(--rtxt)" placeholder="Écris à Marco… « nettoie et cale sur le beat »…"><a href="#/parler" class="rbtn p" style="text-decoration:none">Parler aux IA</a></div>
      </div>
      <div style="display:grid;gap:12px;align-content:start">
       <div class="panel"><div class="ph">🎯 Analyse automatique <span class="r" style="color:#8a8fb5">aperçu</span></div><div class="pb" style="font-size:12.5px">
         ${[['Tonalité détectée', 'Do# mineure'], ['Tempo', '90 BPM'], ['Justesse', '98 %'], ['Sibilantes', 'à réduire'], ['Bruit de fond', '−58 dBFS (propre)']].map(x => `<div style="display:flex;margin-bottom:8px"><span class="muted">${x[0]}</span><b style="margin-left:auto;color:#bff5db">${x[1]}</b></div>`).join('')}
       </div></div>
       <div class="panel"><div class="ph">✨ 3 propositions</div><div class="pb"><div class="grid" style="grid-template-columns:repeat(3,1fr)">
         <div class="vcard"><h4>🫧 Naturelle</h4><p>Correction douce, voix transparente.</p><span class="rbtn" style="width:100%;text-align:center">▶ Écouter</span></div>
         <div class="vcard" style="border-color:var(--rpur);box-shadow:0 0 14px rgba(168,85,247,.3)"><h4>🎧 Pro</h4><p>EQ + comp + de-ess calés, prêt mix.</p><span class="rbtn p" style="width:100%;text-align:center">▶ Écouter</span></div>
         <div class="vcard"><h4>🚀 Créative</h4><p>Autotune marqué + delay + air.</p><span class="rbtn" style="width:100%;text-align:center">▶ Écouter</span></div>
       </div><div style="text-align:center;margin-top:12px"><span class="rbtn g" style="padding:10px 18px">✓ Appliquer la version choisie</span></div></div></div>
      </div></div>`;
    return root;
  }

  const VIEWS = {
    regie: { t: '🧩 Régie générale', r: viewRegie },
    timeline: { t: '🎵 Timeline', r: viewTimeline },
    rec: { t: '🎙️ Enregistrement', r: viewRec },
    fx: { t: '🎛️ Effets & molettes', r: viewFx },
    repo: { t: '📚 Répertoire', r: viewRepo },
    ia: { t: '🧠 IA Expert', r: viewIA },
  };

  // ---------- squelette ----------
  const root = h('div.regie');
  const tabsBar = h('div.rtabs');
  const main = h('div.rmain');
  const side = h('div.rside');

  function renderTabs() {
    tabsBar.innerHTML = '';
    for (const k of Object.keys(VIEWS)) tabsBar.append(h('div.rtab' + (k === cur ? '.on' : ''), { onclick: () => go(k) }, VIEWS[k].t));
  }
  function go(k) {
    if (playing && k !== 'timeline' && k !== 'regie') stopPlay();
    if (recording && cur === 'rec' && k !== 'rec') stopRecording();
    cur = k; renderTabs();
    main.innerHTML = '';
    const view = h('div.rview'); view.append(VIEWS[k].r());
    main.append(view);
  }

  function renderSidebar() {
    const groups = [
      { ic: '🗂️', t: 'Projet', items: [['🎚️', 'Timeline', () => go('timeline')], ['🎙️', 'Enregistrer', () => go('rec')], ['📤', 'Exporter (bientôt)', null]] },
      { ic: '🎵', t: `Pistes (${tracks.length})`, items: tracks.map((t, i) => [null, t.name || `Piste ${i + 1}`, () => go('timeline'), trackColor(t, i)]) },
      { ic: '🎛️', t: 'Modules', items: [['🎤', 'Auto-Tune', () => go('fx')], ['🎚️', 'Égaliseur', () => go('fx')], ['🗜️', 'Compression', () => go('fx')], ['🌫️', 'Réverbe', () => go('fx')], ['🔁', 'Delay', () => go('fx')], ['🎼', 'Harmonies', () => go('fx')]] },
      { ic: '📚', t: 'Presets (235)', items: [['⭐', 'Références', () => go('repo')], ['🎤', 'Autotune', () => go('repo')], ['🗣️', 'Vraies voix', () => go('repo')], ['🌈', 'Ambiances', () => go('repo')]] },
      { ic: '🧠', t: 'IA Expert', items: [['🎯', 'Analyser (bientôt)', () => go('ia')], ['🎹', 'Tonalité (bientôt)', () => go('ia')], ['✨', '3 versions (bientôt)', () => go('ia')]] },
    ];
    side.innerHTML = '';
    groups.forEach((g, gi) => {
      const grp = h('div.dgrp' + (gi > 2 ? '.closed' : ''));
      const head = h('div.dgh', { onclick: () => grp.classList.toggle('closed') }, h('span.ico', g.ic), h('span', g.t), h('span.ch', '▾'));
      const body = h('div.dgb');
      for (const it of g.items) {
        const [ic, label, fn, color] = it;
        const item = h('div.ditem', { onclick: fn || (() => toast('Disponible dans une prochaine phase')) },
          color ? h('span.led', { style: { color } }) : (ic ? h('span', { style: { width: '16px', textAlign: 'center' } }, ic) : null),
          h('span', { style: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, label));
        body.append(item);
      }
      grp.append(head, body); side.append(grp);
    });
  }

  // top bar
  const burger = h('div.rburger', { onclick: () => root.classList.toggle('collapsed') }, '☰');
  const top = h('div.rtop', burger,
    h('div.rbrand', h('div.wf'), h('div', h('b', 'Studio IA'), h('small', 'Régie Pro'))),
    tabsBar,
    h('span.rpill', h('span.dot'), 'Moteur local · 0 €'));

  // transport
  playBtn = h('div.rb.pl', { onclick: () => startPlay(startOffset) }, '▶');
  lcdEl = h('div.lcd', '00:00.000 / 00:00.000');
  outMeter = h('i');
  const transport = h('div.transport',
    h('span.dot'), h('b', { style: { fontSize: '13px' } }, proj.name), h('span.muted', '44.1 kHz · flottant'),
    h('div', { style: { flex: '1' } }),
    h('div.rb', { onclick: () => { stopPlay(); movePlayhead(0); startOffset = 0; } }, '⏮'),
    playBtn,
    h('div.rb', { onclick: () => { stopPlay(); movePlayhead(0); startOffset = 0; } }, '⏹'),
    h('div.rb.rec', { title: 'Enregistrer dans la Régie', onclick: () => go('rec') }, '⏺'),
    lcdEl,
    h('div', { style: { flex: '1' } }),
    h('span.muted', 'Sortie'),
    h('div.vu', { style: { width: '160px' } }, outMeter));

  root.append(top, side, main, transport);
  el.append(root);

  await load();
  renderSidebar();
  renderTabs();
  go(cur);

  // nettoyage
  return () => { stopPlay(); stopAllRec(); };
}

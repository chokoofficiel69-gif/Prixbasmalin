// Régie Pro — nouvelle page isolée (phase 1 : la coquille + la Timeline réelle).
// NON destructive : lit le MÊME projet que la page Enregistrement (IndexedDB « rec:<projet> »),
// affiche de VRAIES formes d'onde (drawWave) et joue un vrai mix local. 100 % local, 0 €.
// Les autres onglets sont des APERÇUS visuels de la maquette validée, clairement signalés,
// avec un lien vers les pages réelles existantes — ils seront câblés aux phases suivantes.
import { h, state, toast, toastErr, currentProject, audioCtx, pickLocalFiles, startRecorder, sse } from '../lib/core.js';
import { getItem, putItem, unpackBuffer, packBuffer } from '../lib/session.js';
import { decodeBlob, drawWave, voiceChain, denoise, detectBeats, normalize, gate, antipop, limit, master, mix, encodeWav } from '../lib/audio.js';
import { applyChain, detectPitch, detectKey, keyName, KEY_CHOICES } from '../lib/voicefx.js';

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
.regie .rctx{position:fixed;z-index:99999;min-width:220px;padding:6px;background:#111126;border:1px solid #51458b;border-radius:10px;box-shadow:0 16px 42px rgba(0,0,0,.55);display:none;color:#eceefc}
.regie .rctx.open{display:block}.regie .rctx button{display:flex;width:100%;align-items:center;gap:10px;padding:8px 10px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;font:12px inherit;cursor:pointer}
.regie .rctx button:hover{background:rgba(168,85,247,.2)}.regie .rctx button:disabled{opacity:.35;cursor:not-allowed}
.regie .rctx .sep{height:1px;background:#302b52;margin:4px 3px}
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
      const head = h('div.thead', { style: { '--tc': color, cursor: 'context-menu' }, oncontextmenu: (e) => showContextMenu(e, 'track', i) },
        h('div.nm', h('span', { style: { color } }, t.kind === 'instru' ? '🥁' : '🎤'), t.name || `Piste ${i + 1}`),
        h('div.ctrls', mB, sB, aB),
        vol, h('div.lab', 'Vol', volLab),
        pan, h('div.lab', 'Pan', panLab));

      const lane = h('div.lane', { style: { '--beat': beat + 'px', width: laneW + 'px' } });
      if (t.buffer) {
        const clipW = Math.max(8, t.buffer.duration * pxPerSec);
        const canvas = h('canvas');
        const clip = h('div.clip', { style: { left: ((t.offset || 0) * pxPerSec) + 'px', width: clipW + 'px' } }, canvas, h('div.cnm', t.name || ''));
        clip.style.cursor = 'context-menu';
        clip.addEventListener('contextmenu', (e) => showContextMenu(e, 'clip', i));
        lane.append(clip);
        // dessin après insertion (clientWidth disponible)
        setTimeout(() => { canvas.style.width = clipW + 'px'; canvas.style.height = '100%'; drawClip(canvas, t, i); }, 0);
      }
      lane.addEventListener('contextmenu', (e) => { if (e.target === lane) showContextMenu(e, 'empty', -1); });
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

  // ---------- Auto-Tune RÉEL (réutilise applyChain + détection de tonalité) ----------
  const atOpt = { speed: 60, strength: 1, formant: 0, key: '' };
  let previewSrc = null, atBusy = false;
  const voixTracks = () => tracks.map((t, i) => ({ t, i })).filter(x => !isInstru(x.t));
  function stopPreview() { try { previewSrc?.stop(); } catch {} previewSrc = null; }
  function playBuffer(buf) { if (!buf) return; stopPreview(); stopPlay(); const ctx = audioCtx(); previewSrc = ctx.createBufferSource(); previewSrc.buffer = buf; previewSrc.connect(ctx.destination); previewSrc.start(); }
  const parseKey = (v) => { if (!v) return null; const [root, mode] = v.split('|'); return { root: +root, mode }; };
  async function analyzeKey(track, status, keyLabel) {
    if (!track?.buffer) { toast('Choisis une piste voix.', 'bad'); return; }
    try { status.textContent = 'Analyse de la tonalité…'; const pitch = await detectPitch(track.original || track.buffer, p => status.textContent = `Analyse ${Math.round(p * 100)} %`); const k = detectKey(pitch); keyLabel.textContent = keyName(k); status.textContent = 'Tonalité détectée ✓'; }
    catch (e) { status.textContent = 'Analyse impossible'; toastErr(e); }
  }
  async function applyAutotune(track, status, keyLabel) {
    if (!track?.buffer) { toast('Choisis une piste voix.', 'bad'); return; }
    if (atBusy) return; atBusy = true;
    try {
      const src = track.original || track.buffer;
      const res = await applyChain(src, [{ t: 'tune', strength: atOpt.strength, speed: atOpt.speed, formant: atOpt.formant }], { key: parseKey(atOpt.key), onProgress: (m) => status.textContent = m });
      if (!track.original) track.original = src;
      track.buffer = res.buffer; track.fxDone = [...(track.fxDone || []), 'autotune'];
      keyLabel.textContent = keyName(res.key);
      status.textContent = '✓ Auto-Tune appliqué — écoute « Après »';
      await save(); toast('Auto-Tune appliqué ✓', 'ok');
    } catch (e) { status.textContent = 'Erreur'; toastErr(e); }
    finally { atBusy = false; }
  }
  function revertTrack(track, status) { if (track?.original) { track.buffer = track.original; track.fxDone = []; save(); status.textContent = 'Piste rétablie (voix brute)'; toast('Original rétabli', 'ok'); } }

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
    const duration = totalDuration();
    const ready = tracks.filter(t => t.buffer);
    const selected = ready[sessionSelected] || ready[0] || null;
    const measure = (buffer) => {
      if (!buffer) return null;
      let peak = 0, sum = 0, count = 0;
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const d = buffer.getChannelData(ch);
        for (let i = 0; i < d.length; i++) { const v = d[i]; const av = Math.abs(v); if (av > peak) peak = av; sum += v * v; count++; }
      }
      return { peakDb: peak ? 20 * Math.log10(peak) : -Infinity, rmsDb: sum && count ? 10 * Math.log10(sum / count) : -Infinity };
    };
    const m = measure(selected?.buffer);
    const metric = (label, value, hint) => h('div.panel',
      h('div.ph', label),
      h('div.pb', h('div', { style: { fontSize: '22px', fontWeight: '800' } }, value),
        h('div.muted', { style: { fontSize: '11px', marginTop: '4px' } }, hint)));
    const action = (label, desc, tab, icon) => h('button.rbtn', {
      style: { textAlign: 'left', padding: '13px', minHeight: '74px', display: 'flex', flexDirection: 'column', gap: '6px' },
      onclick: () => go(tab)
    }, h('b', icon + ' ' + label), h('span.muted', desc));
    root.append(
      h('div.panel', h('div.ph', '🎛️ STUDIO — session en cours',
        h('span.r', tracks.length ? 'Audio chargé' : 'Aucune piste chargée')),
        h('div.pb', h('div', { style: { fontSize: '20px', fontWeight: '800', marginBottom: '5px' } }, proj.name || 'Projet audio'),
          h('div.muted', `${ready.length} piste(s) audio · durée totale ${fmtLcd(duration).replace(/\\.\\d+$/, '')}`))),
      h('div.grid', { style: { gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginTop: '12px' } },
        metric('Pistes audio', String(ready.length), 'Pistes réellement chargées'),
        metric('Durée session', fmtLcd(duration).replace(/\\.\\d+$/, ''), 'Positionnement et longueur du mix'),
        metric('Crête piste sélectionnée', m && Number.isFinite(m.peakDb) ? m.peakDb.toFixed(1) + ' dBFS' : 'Non mesurée', selected ? selected.name : 'Sélectionne une piste'),
        metric('Niveau RMS', m && Number.isFinite(m.rmsDb) ? m.rmsDb.toFixed(1) + ' dBFS' : 'Non mesuré', 'Calculé sur la piste sélectionnée')),
      h('div.panel', { style: { marginTop: '12px' } },
        h('div.ph', 'Outils du studio', h('span.r', 'Ouvre un module pour travailler le son')),
        h('div.pb', h('div.grid', { style: { gridTemplateColumns: 'repeat(3,minmax(0,1fr))' } },
          action('Timeline multipiste', 'Déplacer, écouter, régler volume et panoramique', 'timeline', '🎚️'),
          action('Enregistrement', 'Enregistrer une prise depuis le microphone', 'rec', '🎙️'),
          action('Effets audio', 'Traitements et correction de voix', 'fx', '🎛️'),
          action('Ingénieur du son IA', 'Demander un traitement sur une piste', 'ia', '🧠'),
          action('Références', 'Bibliothèque de presets disponible', 'repo', '📚')))),
      h('div.panel', { style: { marginTop: '12px' } },
        h('div.ph', 'État de la session'),
        h('div.pb', selected
          ? h('div', h('b', selected.name || 'Piste sélectionnée'),
              h('div.muted', { style: { marginTop: '5px' } }, `Durée : ${selected.buffer.duration.toFixed(2)} s · ${selected.buffer.sampleRate} Hz · ${selected.buffer.numberOfChannels} canal(aux)`),
              h('div.muted', { style: { marginTop: '5px' } }, selected.fxDone?.length ? 'Traitements enregistrés : ' + selected.fxDone.join(', ') : 'Aucun traitement enregistré sur cette piste.'))
          : h('div.muted', 'Importe un fichier audio dans la Timeline pour commencer.'))));
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

  function autotunePanel() {
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i) }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix — enregistre d’abord'));
    const curTrack = () => tracks[+sel.value];
    const keyLabel = h('b', { style: { color: '#bff5db' } }, '—');
    const keySel = h('select', { style: selStyle(), onchange: (e) => { atOpt.key = e.target.value; } }, KEY_CHOICES.map(k => h('option', { value: k.v }, k.label)));
    const status = h('div.muted', { style: { fontSize: '11px', minHeight: '15px', marginTop: '6px' } }, vt.length ? '' : 'Va dans Enregistrement pour créer une piste voix.');
    // réglages réels
    const speedLab = h('b', `${atOpt.speed} ms`);
    const strLab = h('b', `${Math.round(atOpt.strength * 100)} %`);
    const forLab = h('b', `${atOpt.formant}`);
    const ctl = (label, lab, input) => h('div', { style: { display: 'flex', gap: '9px', alignItems: 'center', margin: '9px 0', fontSize: '12px' } }, h('span.muted', { style: { width: '110px' } }, label), input, h('span', { style: { width: '54px', textAlign: 'right' } }, lab));
    const speed = h('input', { type: 'range', min: 0, max: 200, step: 5, value: atOpt.speed, style: { flex: '1' }, oninput: (e) => { atOpt.speed = +e.target.value; speedLab.textContent = `${atOpt.speed} ms`; } });
    const str = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: atOpt.strength, style: { flex: '1' }, oninput: (e) => { atOpt.strength = +e.target.value; strLab.textContent = `${Math.round(atOpt.strength * 100)} %`; } });
    const formant = h('input', { type: 'range', min: -4, max: 4, step: 1, value: atOpt.formant, style: { flex: '1' }, oninput: (e) => { atOpt.formant = +e.target.value; forLab.textContent = `${atOpt.formant}`; } });
    // presets réels
    const presets = [['Naturel', 0.8, 120], ['Pop propre', 1, 60], ['R&B', 1, 35], ['Trap mélodique', 1, 15], ['Hard (robot)', 1, 0]];
    const presetRow = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '4px 0 10px' } },
      presets.map(([nm, st, sp]) => h('span.chip', { onclick: () => { atOpt.strength = st; atOpt.speed = sp; str.value = st; speed.value = sp; strLab.textContent = `${Math.round(st * 100)} %`; speedLab.textContent = `${sp} ms`; } }, nm)));
    const btns = h('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '10px' } },
      h('button.rbtn', { onclick: () => analyzeKey(curTrack(), status, keyLabel) }, '🎹 Détecter la tonalité'),
      h('button.rbtn.p', { onclick: () => applyAutotune(curTrack(), status, keyLabel) }, '✨ Appliquer l’Auto-Tune'),
      h('button.rbtn', { onclick: () => { const t = curTrack(); playBuffer(t?.original || t?.buffer); } }, '▶ Avant'),
      h('button.rbtn', { onclick: () => playBuffer(curTrack()?.buffer) }, '▶ Après'),
      h('button.rbtn', { onclick: () => playBuffer(null) || stopPreview() }, '⏹'),
      h('button.rbtn', { onclick: () => revertTrack(curTrack(), status) }, '↩ Original'));
    return h('div.panel',
      h('div.ph', h('span', { style: { width: '11px', height: '11px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px #a855f7', flex: 'none' } }), '🎤 Auto-Tune Pro', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'RÉEL')),
      h('div.pb',
        h('div', { style: { display: 'flex', gap: '9px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Piste :'), sel, h('span.muted', { style: { fontSize: '12px' } }, 'Tonalité :'), keyLabel, keySel),
        presetRow,
        ctl('Vitesse (retune)', speedLab, speed),
        ctl('Force', strLab, str),
        ctl('Timbre (formant)', forLab, formant),
        btns, status,
        h('div.muted', { style: { fontSize: '10px', marginTop: '8px', lineHeight: '1.4' } }, '0 ms = effet robot (hard-tune) · plus de ms = plus naturel. « Avant/Après » pour comparer. La voix brute est conservée (bouton Original).')));
  }

  function viewFx() {
    const root = h('div');
    const grid = h('div.grid', { style: { gridTemplateColumns: '1fr 1fr' } });
    grid.append(autotunePanel());
    const mods = [
      { t: '🎚️ Égaliseur', c: '#3b82f6', eq: 1, k: [['Low', '−2 dB', '#22d3ee', 45], ['Mid', '+2.5 dB', '#ec4899', 60], ['High', '+3 dB', '#a855f7', 66], ['Air', '+4 dB', '#22d3ee', 70]] },
      { t: '🗜️ Compression', c: '#f0b429', gr: 1, k: [['Thresh', '−18', '#f0b429', 40], ['Ratio', '4:1', '#f0b429', 55], ['Attack', '10 ms', '#f0b429', 30], ['Makeup', '+3 dB', '#f0b429', 58]] },
      { t: '🌫️ Réverbe', c: '#a855f7', k: [['Taille', '72%', '#a855f7', 72], ['Decay', '3.2 s', '#a855f7', 55], ['Mix', '28%', '#a855f7', 28]] },
      { t: '🔁 Delay / Écho', c: '#22d3ee', k: [['Time', '1/8', '#22d3ee', 40], ['Feedback', '35%', '#22d3ee', 35], ['Mix', '22%', '#22d3ee', 22]] },
      { t: '🎼 Harmonies', c: '#ec4899', k: [['Tierce', 'on', '#ec4899', 60], ['Quinte', 'on', '#ec4899', 55], ['Octave', 'on', '#ec4899', 45], ['Niveau', '50%', '#ec4899', 50]] },
    ];
    for (const m of mods) {
      let html = '';
      if (m.eq) html += `<div style="height:108px;border-radius:10px;overflow:hidden;border:1px solid var(--rline);margin-bottom:12px;background:#0b0b1a">${eqCurveSvg()}</div>`;
      html += `<div class="grid" style="grid-template-columns:repeat(${m.k.length},1fr)">${m.k.map(k => knobHtml(k[0], k[1], k[2], k[3], k[4])).join('')}</div>`;
      if (m.gr) html += `<div style="display:flex;gap:9px;align-items:center;margin-top:12px;font-size:11px;color:var(--rmut)"><span>GR</span><div style="flex:1;height:8px;border-radius:4px;background:#1c1710;overflow:hidden"><i style="display:block;height:100%;width:36%;float:right;background:linear-gradient(90deg,#ff6b3d,#f0b429)"></i></div><b style="color:#f0b429">−4.2 dB</b></div>`;
      grid.append(h('div.panel', h('div.ph', { html: `<span style="width:11px;height:11px;border-radius:50%;background:${m.c};box-shadow:0 0 8px ${m.c};flex:none"></span>${m.t}<span class="r" style="margin-left:auto;color:#8a8fb5">aperçu</span>` }), h('div.pb', { html })));
    }
    root.append(grid);
    return root;
  }

  async function applyLibraryPreset(p) {
    const ready = tracks.filter(t => t.buffer), track = ready[sessionSelected] || ready[0];
    if (!track) { toast('Importe une piste audio avant d’appliquer un preset.', 'bad'); return; }
    if (playing) stopPlay();
    const status = document.getElementById('regie-preset-status');
    if (status) status.textContent = 'Application de ' + p.name + '…';
    try {
      const source = track.buffer;
      if (!track.original) track.original = source;
      let rendered;
      if (p.kind === 'tune') rendered = (await applyChain(source, [{ t: 'tune', strength: p.strength, speed: p.speed, formant: p.formant || 0 }], { onProgress: x => { if(status) status.textContent=x; } })).buffer;
      else if (p.kind === 'fx') rendered = (await applyChain(source, p.chain, { onProgress: x => { if(status) status.textContent=x; } })).buffer;
      else rendered = await voiceChain(source, p.params || {});
      track.buffer = rendered;
      track.fxDone = [...(track.fxDone || []), p.name];
      track.fx = { ...(track.fx || {}), lastPreset: p.name };
      await save();
      if(status) status.textContent = p.name + ' appliqué sur ' + track.name;
      toast('Preset « ' + p.name + ' » appliqué à ' + track.name, 'ok');
    } catch(e) { if(status) status.textContent='Échec : '+(e.message||e); toastErr(e); }
  }

  function viewRepo() {
    const presets = [
      {name:'Rap FR Pro',cat:'Autotune',kind:'tune',strength:1,speed:60},
      {name:'Drill sombre',cat:'Autotune',kind:'tune',strength:1,speed:18},
      {name:'Trap 808',cat:'Autotune',kind:'tune',strength:1,speed:8},
      {name:'Hard snap',cat:'Autotune',kind:'tune',strength:1,speed:0},
      {name:'Soft melodic',cat:'Autotune',kind:'tune',strength:.75,speed:150},
      {name:'Chant velours',cat:'Vraies voix',kind:'voice',params:{highpass:75,low:1,presence:2,air:2,deess:3,comp:.45,reverb:.1}},
      {name:'Voix grave',cat:'Vraies voix',kind:'voice',params:{highpass:65,low:2,presence:1,air:0,deess:2,comp:.55,reverb:.08}},
      {name:'Voix aiguë',cat:'Vraies voix',kind:'voice',params:{highpass:110,low:-1,presence:1,air:1,deess:5,comp:.4,reverb:.12}},
      {name:'Voix féminine',cat:'Vraies voix',kind:'voice',params:{highpass:100,low:0,presence:2,air:3,deess:4,comp:.45,reverb:.13}},
      {name:'Club',cat:'Ambiances',kind:'fx',chain:[{t:'fx',kind:'reverb',size:1.4,mix:.12},{t:'fx',kind:'delay',time:.25,fb:.2,mix:.1}]},
      {name:'Nuit',cat:'Ambiances',kind:'voice',params:{highpass:80,low:-1,presence:1,air:0,deess:3,comp:.5,reverb:.22}},
      {name:'Live',cat:'Ambiances',kind:'fx',chain:[{t:'fx',kind:'reverb',size:2.5,mix:.22}]},
      {name:'Radio',cat:'Effets',kind:'voice',params:{highpass:260,low:-5,presence:3,air:-3,deess:2,comp:.8,reverb:0}},
      {name:'Téléphone',cat:'Effets',kind:'voice',params:{highpass:420,low:-6,presence:4,air:-6,deess:1,comp:.7,reverb:0}},
      {name:'Vocodeur',cat:'Effets',kind:'fx',chain:[{t:'vocoder',bands:24,voices:[0],blend:.12}]},
      {name:'Robot',cat:'Effets',kind:'tune',strength:1,speed:0},
      {name:'Lo-Fi',cat:'Effets',kind:'voice',params:{highpass:180,low:-3,presence:-1,air:-5,deess:2,comp:.6,reverb:.04}},
      {name:'Tube',cat:'Effets',kind:'fx',chain:[{t:'fx',kind:'saturation',drive:1.4,mix:.18}]},
      {name:'Mega',cat:'Effets',kind:'voice',params:{highpass:80,low:2,presence:4,air:3,deess:4,comp:.8,reverb:.08}},
      {name:'Jul · mélodique',cat:'Références',kind:'tune',strength:.9,speed:75},
      {name:'Naza · puissant',cat:'Références',kind:'voice',params:{highpass:75,low:2,presence:3,air:1,deess:3,comp:.72,reverb:.08}},
      {name:'LJK · hard tune',cat:'Références',kind:'tune',strength:1,speed:0}
    ];
    const cats=['Tous','Références','Autotune','Vraies voix','Ambiances','Effets'];
    let active='Tous';
    const root=h('div'), list=h('div.grid',{style:{gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:'9px'}});
    const count=h('span.r',presets.length+' presets fonctionnels');
    const chips=h('div',{style:{display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'14px'}});
    const status=h('div.muted',{id:'regie-preset-status',style:{marginTop:'10px',minHeight:'18px'}},'Choisis une piste puis clique sur un preset pour appliquer le traitement.');
    function drawCards(){
      list.innerHTML='';
      const shown=presets.filter(p=>active==='Tous'||p.cat===active);
      for(const p of shown) list.append(h('button.vcard',{type:'button',style:{padding:'11px',display:'flex',gap:'9px',alignItems:'center',textAlign:'left',cursor:'pointer',color:'inherit',background:'transparent',border:'1px solid var(--rline)',borderRadius:'12px'},onclick:()=>applyLibraryPreset(p)},
        h('span',{style:{width:'32px',height:'32px',borderRadius:'9px',background:'linear-gradient(135deg,var(--rpur),var(--rcy))',flex:'none'}}),
        h('span',{style:{minWidth:'0'}},h('b',{style:{fontSize:'13px'}},p.name),h('span.muted',{style:{display:'block',fontSize:'10px'}},p.cat+' · appliquer'))));
      count.textContent=shown.length+' / '+presets.length+' presets';
    }
    for(const cat of cats) chips.append(h('button.chip'+(cat===active?'.on':''),{onclick:()=>{active=cat;for(const el of chips.children)el.classList.toggle('on',el.textContent===active);drawCards();}},cat));
    drawCards();
    const side=h('div',{style:{display:'grid',gap:'12px',alignContent:'start'}},
      h('div.panel',h('div.ph','Chaîne d’effets'),h('div.pb',h('div.muted','Les presets compatibles appliquent de vrais traitements sur la piste sélectionnée. Les autres modules ne sont pas simulés.'))),
      h('div.panel',{'data-projects':''},h('div.ph','Mes projets'),h('div.pb')));
    root.append(h('div.grid',{style:{gridTemplateColumns:'minmax(0,1fr) 300px'}},
      h('div.panel',h('div.ph','Bibliothèque de presets',count),h('div.pb',chips,list,status)),side));
    const pbox=root.querySelector('[data-projects] .pb');
    for(const p of state.projects||[])pbox.append(h('div.ditem'+(p.id===projectId?'.on':''),{style:{marginBottom:'4px'},onclick:()=>{state.projectId=p.id;localStorage.setItem('studio.project',p.id);location.hash='#/regie';}},`${p.icon||'🗂️'} ${p.name}`));
    return root;
  }

  function viewIA() {
    const root = h('div');
    const voiceOptions = voixTracks();
    const trackSel = h('select', { style: selStyle() },
      voiceOptions.length ? voiceOptions.map(x => h('option', { value: String(x.i) }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const trackNow = () => tracks[Number(trackSel.value)];
    const chat = h('div', { style: { minHeight: '230px', maxHeight: '44vh', overflow: 'auto', padding: '10px', background: '#090916', border: '1px solid var(--rline)', borderRadius: '10px' } });
    const input = h('textarea', { rows: 3, placeholder: 'Dis à ton ingénieur ce que tu veux : « nettoie la voix, Auto-Tune naturel en La mineur, compression légère, EQ avec présence, réverbération courte et delay discret. Fais aussi ressortir l’instru sans masquer la voix. »', style: { width: '100%', resize: 'vertical', padding: '11px', borderRadius: '9px', background: '#0c0c1a', border: '1px solid var(--rline)', color: 'var(--rtxt)' } });
    const masterStyle = h('select', { style: selStyle() },
      ...[['streaming','Streaming standard'],['spotify','Spotify / Deezer'],['youtube','YouTube'],['apple','Apple Music'],['tiktok','TikTok / Reels'],['podcast','Podcast / voix'],['rap','Rap / Trap punchy'],['club','Club / puissant'],['doux','Doux / acoustique']].map(([v,l]) => h('option', { value:v }, l)));
    const effectChoices = [
      ['denoise','Nettoyage du souffle / bruit'],['antipop','Anti-pop'],['gate','Porte de bruit'],['autotune','Auto-Tune / correction de justesse'],
      ['voice','EQ + compression + de-esser + réverbération'],['normalize','Normalisation'],['limit','Limiteur / sécurité crêtes'],
      ['master','Mastering final'],['reverse','Inverser le son'],['fadeIn','Fondu entrant'],['fadeOut','Fondu sortant']
    ];
    const effectChecks = new Map(effectChoices.map(([v,l]) => [v, h('input', { type:'checkbox', checked:false })]));
    const selectedEffects = () => [...effectChecks].filter(([,el]) => el.checked).map(([v]) => v);
    const effectPicker = h('div', { style:{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:'7px',padding:'10px',margin:'8px 0',background:'#0b0b19',border:'1px solid var(--rline)',borderRadius:'9px'} },
      h('div', { style:{gridColumn:'1/-1',fontWeight:'700',fontSize:'12px'} }, 'Choisis plusieurs effets à appliquer (facultatif)'),
      ...effectChoices.map(([v,l]) => h('label', { style:{display:'flex',alignItems:'center',gap:'7px',fontSize:'11px',color:'var(--rtxt)'} }, effectChecks.get(v), l)));
    const status = h('div.muted', { style: { minHeight: '20px', marginTop: '8px' } }, 'L’ingénieur peut préparer un plan, puis appliquer les traitements disponibles au son.');
    const planBox = h('div', { style: { display: 'grid', gap: '6px', marginTop: '8px' } });
    const send = h('button.rbtn.p', '🧠 Demander à l’ingénieur');
    const applyBtn = h('button.rbtn.g', { disabled: true }, '✓ Exécuter les modifications');
    const undoBtn = h('button.rbtn', { disabled: true }, '↩ Restaurer l’original');
    let pendingPlan = null, busy = false;
    const say = (who, txt) => chat.append(h('div', { style: { margin: '7px 0', padding: '9px 11px', borderRadius: '10px', background: who === 'expert' ? '#171636' : 'rgba(168,85,247,.18)', border: '1px solid var(--rline)', whiteSpace: 'pre-wrap', fontSize: '12px', lineHeight: '1.5' } }, h('b', who === 'expert' ? '🎧 Ingénieur IA' : 'Vous'), h('div', { style: { marginTop: '4px' } }, txt)));
    const parsePlan = (raw, chosen = []) => {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const obj = JSON.parse(cleaned);
      if (!obj || !Array.isArray(obj.actions)) throw new Error('Plan IA invalide : liste d’actions absente.');
      const allowed = new Set(['denoise','antipop','gate','voice','autotune','normalize','limit','master','reverse','fadeIn','fadeOut']);
      for (const a of obj.actions) if (!allowed.has(a.type)) throw new Error('Action non autorisée ou non prise en charge : ' + a.type);
      if (chosen.length && obj.actions.some(a => !chosen.includes(a.type))) throw new Error('Le plan contient un effet que tu n’as pas sélectionné. Relance la demande.');
      return obj;
    };
    const askExpert = async () => {
      const request = input.value.trim(), t = trackNow();
      if (!request || busy) return;
      if (!t?.buffer) { toast('Sélectionne d’abord une piste audio.', 'bad'); return; }
      busy = true; send.disabled = true; applyBtn.disabled = true; pendingPlan = null;
      planBox.innerHTML = ''; say('user', request); input.value = '';
      status.textContent = 'L’ingénieur analyse ta demande et prépare les opérations…';
      try {
        const b = t.original || t.buffer;
        let peak = 0, rms = 0, n = 0;
        for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i += 16) { peak = Math.max(peak, Math.abs(d[i])); rms += d[i]*d[i]; n++; } }
        const context = { piste: t.name, duree_secondes: +b.duration.toFixed(2), sampleRate: b.sampleRate, peakDbfs: +(20*Math.log10(Math.max(peak,1e-7))).toFixed(1), rmsDbfs: +(20*Math.log10(Math.sqrt(rms/Math.max(1,n)))).toFixed(1), autres_pistes: tracks.map(x=>({nom:x.name,type:x.kind,duree:x.buffer?.duration||0,volumeDb:x.gainDb||0,pan:x.pan||0,mute:!!x.mute})) };
        const chosen = selectedEffects();
        const chosenLine = chosen.length ? `Effets expressément sélectionnés par l’utilisateur (n’en ajoute aucun autre) : ${chosen.join(', ')}.` : 'Aucun effet imposé : choisis les traitements adaptés à la demande.';
        const targetMaster = masterStyle.value;
        const agents = [
          { name: 'Diagnostic audio', role: 'analyseur audio : interprète les mesures fournies, repère les problèmes probables sans inventer de mesures' },
          { name: 'Spécialiste nettoyage', role: 'réduction du bruit, souffle, clics, pops et artefacts' },
          { name: 'Ingénieur vocal', role: 'correction de justesse, tonalité, formants et naturel de la voix' },
          { name: 'Égalisation', role: 'EQ correctif et tonal, masquage fréquentiel et intelligibilité' },
          { name: 'Dynamique', role: 'compression, gate, de-esser, contrôle des transitoires et crêtes' },
          { name: 'Effets spatiaux', role: 'réverbération, delay, profondeur, largeur et placement stéréo' },
          { name: 'Mixage', role: 'équilibre voix/instrumental, gain staging, panoramique et cohérence du mix' },
          { name: 'Mastering', role: 'préparation du master selon le profil cible, sonie et true peak' },
          { name: 'Direction artistique', role: 'intention sonore, références stylistiques, choix entre naturel, professionnel et créatif' },
          { name: 'Contrôle qualité', role: 'auditeur critique : détecte les risques, traitements excessifs, incohérences et valide la chaîne proposée' }
        ];
        const task = `Tu es le cerveau principal et l'ingénieur du son en chef. Tu gardes une seule conversation avec l'utilisateur et tu coordonnes les dix spécialistes disponibles en coulisses. Ne renvoie jamais l'utilisateur vers un autre agent ou un autre onglet. Fais intervenir les spécialistes utiles, confronte leurs avis si nécessaire, puis décide toi-même de la chaîne finale.
Demande utilisateur : ${request}
Piste sélectionnée : ${JSON.stringify(context)}
Effets choisis par l'utilisateur : ${chosen.length ? chosen.join(', ') : 'choix automatique par le chef'}
Profil mastering demandé : ${targetMaster}
Contraintes moteur DSP réellement disponibles : denoise, antipop, gate, voice, autotune, normalize, limit, master, reverse, fadeIn, fadeOut.
Le livrable final doit être UNIQUEMENT un JSON valide de cette forme :
{"message":"explication courte en français","actions":[{"type":"...","params":{}}]}
Types autorisés : denoise amount 0..1; antipop amount 0..1; gate thresholdDb -60..-25 et floorDb -60..-10; voice highpass 40..180, low/presence/air -6..6, deess 0..8, comp 0..1, reverb 0..0.35, gainDb -6..6; autotune speed 0..200, strength 0..1, formant -4..4, key facultative "root|mode"; normalize targetDb -3..-1; limit ceilingDb -2..-0.3; master preset streaming|spotify|youtube|apple|tiktok|podcast|rap|club|doux; reverse; fadeIn; fadeOut.
Si des effets sont cochés, ne retourne aucun autre type. Si mastering est coché, utilise exactement le preset demandé. Maximum 10 actions. N'invente aucune mesure, aucun traitement ni aucune écoute. Une seule piste est traitée dans cette opération. Le contrôle qualité doit vérifier que chaque action est supportée.`;
        let raw = '';
        const agentStatus = new Map();
        await sse('/api/agents/run', { projectId: state.projectId, task, agents, mode: 'chef', rounds: 1, synthModel: 'auto' }, ev => {
          if (ev.type === 'step') {
            agentStatus.set(ev.id, ev.agent + ' — ' + (ev.title || 'travail'));
            status.textContent = 'Équipe en cours : ' + [...agentStatus.values()].slice(-3).join(' · ');
          }
          if (ev.type === 'delta' && ev.content) raw += ev.content;
          if (ev.type === 'final' && ev.content) raw = ev.content;
          if (ev.type === 'error') throw new Error(ev.error);
          if (ev.type === 'done' && ev.error) say('expert', ev.agent + ' indisponible : ' + ev.error);
        });
        pendingPlan = parsePlan(raw, chosen);
        say('expert', pendingPlan.message || 'Plan de traitement prêt. Vérifie les opérations avant exécution.');
        for (const a of pendingPlan.actions) planBox.append(h('div', { style: { padding: '8px 10px', background: '#101027', border: '1px solid var(--rline)', borderRadius: '8px', fontSize: '12px' } }, '• ' + a.type + ' — ' + JSON.stringify(a.params || {})));
        applyBtn.disabled = !pendingPlan.actions.length;
        status.textContent = pendingPlan.actions.length + ' opération(s) prêtes. Clique sur Exécuter pour modifier le son.';
      } catch (e) { say('expert', 'Je n’ai pas pu préparer un plan exécutable : ' + (e?.message || e)); status.textContent = 'Erreur IA. Vérifie la disponibilité du modèle et réessaie.'; }
      finally { busy = false; send.disabled = false; }
    };
    const execute = async () => {
      const t = trackNow(); if (!t?.buffer || !pendingPlan || busy) return;
      busy = true; applyBtn.disabled = true; send.disabled = true;
      try {
        if (!t.original) t.original = cloneAudioBuffer(t.buffer);
        let b = cloneAudioBuffer(t.buffer);
        for (const a of pendingPlan.actions) {
          const p = a.params || {};
          status.textContent = 'Application : ' + a.type + '…';
          if (a.type === 'denoise') b = await denoise(b, Math.max(0,Math.min(1,Number(p.amount ?? .55))));
          else if (a.type === 'antipop') b = antipop(b, Math.max(0,Math.min(1,Number(p.amount ?? .8))));
          else if (a.type === 'gate') b = gate(b, Number(p.thresholdDb ?? -45), Number(p.floorDb ?? -30));
          else if (a.type === 'voice') b = await voiceChain(b, p);
          else if (a.type === 'autotune') {
            const key = typeof p.key === 'string' && /^\d{1,2}\|(majeur|mineur)$/.test(p.key) ? (() => { const [root,mode]=p.key.split('|'); return {root:+root,mode}; })() : null;
            const tuned = await applyChain(b, [{t:'tune',strength:Math.max(0,Math.min(1,Number(p.strength ?? .8))),speed:Math.max(0,Math.min(200,Number(p.speed ?? 80))),formant:Math.max(-4,Math.min(4,Number(p.formant ?? 0)))}], {key});
            b = tuned.buffer;
          } else if (a.type === 'normalize') b = normalize(b, Math.max(-3,Math.min(-1,Number(p.targetDb ?? -1))));
          else if (a.type === 'limit') b = limit(b, Math.max(-2,Math.min(-.3,Number(p.ceilingDb ?? -1))));
          else if (a.type === 'master') b = (await master(b, ['streaming','spotify','youtube','apple','tiktok','podcast','rap','club','doux'].includes(p.preset) ? p.preset : masterStyle.value)).buffer;
          else if (a.type === 'reverse') for (let c=0;c<b.numberOfChannels;c++) b.getChannelData(c).reverse();
          else if (a.type === 'fadeIn' || a.type === 'fadeOut') fadeClip(b, a.type === 'fadeIn');
        }
        t.buffer = b; t.fxDone = [...(t.fxDone || []), ...pendingPlan.actions.map(a=>a.type)];
        await save(); renderSidebar(); if (cur === 'timeline') go('timeline');
        undoBtn.disabled = false;
        say('expert', 'Traitements appliqués à « ' + (t.name || 'la piste') + ' ». La prise originale est conservée : tu peux la restaurer.');
        status.textContent = 'Terminé. Écoute le résultat et demande les corrections que tu veux.';
        pendingPlan = null; planBox.innerHTML = '';
      } catch (e) { say('expert', 'Erreur pendant le traitement : ' + (e?.message || e)); status.textContent = 'Traitement interrompu. L’original est conservé.'; }
      finally { busy = false; send.disabled = false; applyBtn.disabled = !pendingPlan; }
    };
    send.onclick = askExpert; applyBtn.onclick = execute;
    undoBtn.onclick = () => { const t = trackNow(); if (t?.original) { t.buffer = cloneAudioBuffer(t.original); t.fxDone = []; save(); if (cur === 'timeline') go('timeline'); status.textContent = 'Prise originale restaurée.'; } };
    root.append(h('div.grid', { style: { gridTemplateColumns: '1fr 280px' } },
      h('div.panel', h('div.ph', '🧠 Ingénieur du son IA', h('span.r', 'planifie et exécute les traitements')),
        h('div.pb', h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '9px' } }, h('span.muted', 'Piste cible'), trackSel), chat,
          h('div', { style: { display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap',margin:'10px 0' } }, h('b', { style:{fontSize:'12px'} }, 'Style de mastering'), masterStyle),
          effectPicker,
          h('div', { style: { marginTop: '10px' } }, input),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } }, send, applyBtn, undoBtn),
          status, planBox)),
      h('div.panel', h('div.ph', '🎚️ Ce qu’il peut faire maintenant'), h('div.pb',
        ...['Nettoyer le souffle et les bruits', 'Régler la voix et sa présence', 'Ajouter compression et réverbération', 'Corriger la justesse et la tonalité', 'Normaliser et limiter les crêtes', 'Masteriser avec un preset', 'Inverser ou faire des fondus', 'Enchaîner plusieurs traitements'].map(x => h('div.ditem', '✓ ' + x)),
        h('div.muted', { style: { marginTop: '10px', fontSize: '11px', lineHeight: '1.5' } }, 'Les opérations sont calculées localement après le plan IA. L’IA choisit les traitements, le moteur audio les exécute. Les actions disponibles dépendent de la piste sélectionnée.')))));
    if (!voiceOptions.length) say('expert', 'Commence par importer ou enregistrer une piste audio dans la Timeline. Ensuite, décris-moi le résultat sonore que tu veux.');
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
  const contextMenu = h('div.rctx');
  let audioClipboard = null;
  function cloneAudioBuffer(buffer) {
    if (!buffer) return null;
    const copy = audioCtx().createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) copy.copyToChannel(new Float32Array(buffer.getChannelData(ch)), ch);
    return copy;
  }
  function sliceAudioBuffer(buffer, from, to) {
    if (!buffer) return null;
    const start = Math.max(0, Math.min(buffer.length, Math.floor(from * buffer.sampleRate)));
    const end = Math.max(start, Math.min(buffer.length, Math.floor(to * buffer.sampleRate)));
    if (end <= start) return null;
    const part = audioCtx().createBuffer(buffer.numberOfChannels, end - start, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) part.copyToChannel(buffer.getChannelData(ch).slice(start, end), ch);
    return part;
  }
  function refreshAfterEdit(message) {
    save(); renderSidebar();
    if (cur === 'timeline') go('timeline');
    if (message) toast(message, 'ok');
  }
  function closeContextMenu() { contextMenu.classList.remove('open'); contextMenu.innerHTML = ''; }
  function pasteAudio() {
    if (!audioClipboard || !audioClipboard.buffer) return;
    const buffer = cloneAudioBuffer(audioClipboard.buffer);
    tracks.push({ name: audioClipboard.name + ' (copie)', kind: audioClipboard.kind || 'voix', gainDb: audioClipboard.gainDb || 0, pan: audioClipboard.pan || 0, offset: startOffset, mute: false, solo: false, armed: false, empty: false, fxDone: [], fx: null, fileId: null, buffer, original: cloneAudioBuffer(buffer) });
    refreshAfterEdit('Audio collé à la position du curseur');
  }

  function preserveOriginal(track) {
    if (track && track.buffer && (!track.original || track.original === track.buffer)) track.original = cloneAudioBuffer(track.buffer);
  }
  function processClip(index, processor, label) {
    const track = tracks[index]; if (!track || !track.buffer) return;
    preserveOriginal(track);
    const edited = cloneAudioBuffer(track.buffer);
    processor(edited);
    track.buffer = edited;
    refreshAfterEdit(label);
  }
  function peakNormalize(buffer) {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    if (!peak) return;
    const gain = 0.98 / peak;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] *= gain;
    }
  }
  function fadeClip(buffer, fadeIn) {
    const n = Math.min(buffer.length, Math.floor(buffer.sampleRate * Math.min(2, buffer.duration * 0.25)));
    if (n < 2) return;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const ramp = i / (n - 1);
        const idx = fadeIn ? i : data.length - n + i;
        data[idx] *= fadeIn ? ramp : 1 - ramp;
      }
    }
  }
  function splitTrackAtCursor(index) {
    const track = tracks[index]; if (!track || !track.buffer) return;
    const local = startOffset - (track.offset || 0);
    const sourceOriginal = track.original || track.buffer;
    const left = sliceAudioBuffer(track.buffer, 0, local), right = sliceAudioBuffer(track.buffer, local, track.buffer.duration);
    const leftOriginal = sliceAudioBuffer(sourceOriginal, 0, local), rightOriginal = sliceAudioBuffer(sourceOriginal, local, sourceOriginal.duration);
    if (!left || !right || !leftOriginal || !rightOriginal) return;
    tracks.splice(index, 1,
      { ...track, name: (track.name || 'Piste') + ' · A', buffer: left, original: leftOriginal },
      { ...track, name: (track.name || 'Piste') + ' · B', offset: startOffset, buffer: right, original: rightOriginal });
    refreshAfterEdit('Clip découpé en deux pistes');
  }
  function showContextMenu(event, type, index) {
    event.preventDefault(); event.stopPropagation(); contextMenu.innerHTML = '';
    const track = index >= 0 ? tracks[index] : null;
    const add = (label, action, disabled) => contextMenu.append(h('button', { type: 'button', disabled: !!disabled, onclick: () => { closeContextMenu(); action(); } }, label));
    const sep = () => contextMenu.append(h('div.sep'));
    if (type === 'track' && track) {
      add('✏️ Renommer la piste', () => { const n = window.prompt('Nom de la piste', track.name || 'Piste'); if (n && n.trim()) { track.name = n.trim(); refreshAfterEdit('Piste renommée'); } });
      add(track.mute ? '🔊 Réactiver la piste' : '🔇 Mettre en sourdine', () => { track.mute = !track.mute; refreshAfterEdit('État Mute modifié'); });
      add(track.solo ? '◉ Désactiver Solo' : '◉ Activer Solo', () => { track.solo = !track.solo; refreshAfterEdit('État Solo modifié'); });
      add('🎚️ Régler le volume…', () => { const v = window.prompt('Volume en dB (-60 à +12)', String(track.gainDb || 0)); if (v !== null && Number.isFinite(Number(v))) { track.gainDb = Math.max(-60, Math.min(12, Number(v))); refreshAfterEdit('Volume réglé'); } });
      add('↔️ Régler le panoramique…', () => { const v = window.prompt('Panoramique : -1 gauche, 0 centre, +1 droite', String(track.pan || 0)); if (v !== null && Number.isFinite(Number(v))) { track.pan = Math.max(-1, Math.min(1, Number(v))); refreshAfterEdit('Panoramique réglé'); } });
      add('🎚️ Réinitialiser volume et panoramique', () => { track.gainDb = 0; track.pan = 0; refreshAfterEdit('Réglages réinitialisés'); });
      add('⬆️ Monter la piste', () => { if (index > 0) { tracks.splice(index, 1); tracks.splice(index - 1, 0, track); refreshAfterEdit('Piste déplacée vers le haut'); } }, index === 0);
      add('⬇️ Descendre la piste', () => { if (index < tracks.length - 1) { tracks.splice(index, 1); tracks.splice(index + 1, 0, track); refreshAfterEdit('Piste déplacée vers le bas'); } }, index === tracks.length - 1);

      sep();
      add('📄 Dupliquer la piste', () => { tracks.splice(index + 1, 0, { ...track, name: (track.name || 'Piste') + ' (copie)', buffer: cloneAudioBuffer(track.buffer), original: cloneAudioBuffer(track.original || track.buffer), fxDone: [...(track.fxDone || [])] }); refreshAfterEdit('Piste dupliquée'); });
      add('📋 Copier le clip', () => { audioClipboard = { name: track.name || 'Audio', kind: track.kind, buffer: cloneAudioBuffer(track.buffer), gainDb: track.gainDb, pan: track.pan }; toast('Clip copié', 'ok'); }, !track.buffer);
      add('✂️ Couper le clip', () => { audioClipboard = { name: track.name || 'Audio', kind: track.kind, buffer: cloneAudioBuffer(track.buffer), gainDb: track.gainDb, pan: track.pan }; tracks.splice(index, 1); refreshAfterEdit('Clip coupé'); }, !track.buffer);
      add('📌 Coller à la position du curseur', pasteAudio, !audioClipboard);
      sep();
      add('🗑️ Supprimer la piste', () => { if (window.confirm('Supprimer cette piste ?')) { tracks.splice(index, 1); refreshAfterEdit('Piste supprimée'); } });
    } else if (type === 'clip' && track) {
      add('▶ Placer le curseur au début du clip', () => { startOffset = track.offset || 0; movePlayhead(startOffset); });
      add('✏️ Renommer le clip', () => { const n = window.prompt('Nom du clip', track.name || 'Clip'); if (n && n.trim()) { track.name = n.trim(); refreshAfterEdit('Clip renommé'); } });
      add('⏮️ Aligner le clip au début du projet', () => { track.offset = 0; refreshAfterEdit('Clip déplacé au début'); });
      add('🎚️ Normaliser le volume du clip', () => processClip(index, peakNormalize, 'Clip normalisé'));
      add('↩️ Inverser le clip (Reverse)', () => processClip(index, (b) => { for (let ch = 0; ch < b.numberOfChannels; ch++) b.getChannelData(ch).reverse(); }, 'Clip inversé'));
      add('🌅 Fondu entrant', () => processClip(index, (b) => fadeClip(b, true), 'Fondu entrant appliqué'));
      add('🌇 Fondu sortant', () => processClip(index, (b) => fadeClip(b, false), 'Fondu sortant appliqué'));
      add('↩️ Restaurer la prise originale', () => { if (track.original) { track.buffer = cloneAudioBuffer(track.original); refreshAfterEdit('Prise originale restaurée'); } }, !track.original);

      add('📋 Copier le clip', () => { audioClipboard = { name: track.name || 'Audio', kind: track.kind, buffer: cloneAudioBuffer(track.buffer), gainDb: track.gainDb, pan: track.pan }; toast('Clip copié', 'ok'); }, !track.buffer);
      add('✂️ Couper le clip', () => { audioClipboard = { name: track.name || 'Audio', kind: track.kind, buffer: cloneAudioBuffer(track.buffer), gainDb: track.gainDb, pan: track.pan }; tracks.splice(index, 1); refreshAfterEdit('Clip coupé'); }, !track.buffer);
      add('📄 Dupliquer le clip à la suite', () => { tracks.splice(index + 1, 0, { ...track, name: (track.name || 'Clip') + ' (copie)', buffer: cloneAudioBuffer(track.buffer), original: cloneAudioBuffer(track.original || track.buffer), offset: (track.offset || 0) + track.buffer.duration, fxDone: [...(track.fxDone || [])] }); refreshAfterEdit('Clip dupliqué'); }, !track.buffer);
      add('📌 Coller à la position du curseur', pasteAudio, !audioClipboard);
      sep();
      const local = startOffset - (track.offset || 0), validCut = !!track.buffer && local > 0 && local < track.buffer.duration;
      add('✂️ Découper au curseur', () => splitTrackAtCursor(index), !validCut);
      add('◁ Rogner le début jusqu’au curseur', () => { const sourceOriginal = track.original || track.buffer; const b = sliceAudioBuffer(track.buffer, local, track.buffer.duration); const original = sliceAudioBuffer(sourceOriginal, local, sourceOriginal.duration); if (b && original) { track.buffer = b; track.original = original; track.offset = startOffset; refreshAfterEdit('Début rogné'); } }, !validCut);
      add('▷ Rogner la fin au curseur', () => { const sourceOriginal = track.original || track.buffer; const b = sliceAudioBuffer(track.buffer, 0, local); const original = sliceAudioBuffer(sourceOriginal, 0, local); if (b && original) { track.buffer = b; track.original = original; refreshAfterEdit('Fin rognée'); } }, !validCut);
      sep();
      add('⚙️ Ouvrir Auto-Tune et effets', () => go('fx'));
      add('🗑️ Supprimer le clip', () => { if (window.confirm('Supprimer ce clip audio ?')) { tracks.splice(index, 1); refreshAfterEdit('Clip supprimé'); } });
    } else {
      add('➕ Importer un fichier audio', () => importTrack());
      add('📌 Coller à la position du curseur', pasteAudio, !audioClipboard);
      add('➕ Ajouter une piste vide', () => { tracks.push({ name: 'Piste ' + (tracks.length + 1), kind: 'voix', gainDb: 0, pan: 0, offset: startOffset, mute: false, solo: false, armed: false, empty: true, fxDone: [], fx: null, fileId: null, buffer: null, original: null }); refreshAfterEdit('Piste vide ajoutée'); });
    }
    contextMenu.style.left = Math.min(event.clientX, window.innerWidth - 245) + 'px';
    contextMenu.style.top = Math.min(event.clientY, window.innerHeight - 300) + 'px';
    contextMenu.classList.add('open');
  }

  root.append(contextMenu);
  document.addEventListener('click', closeContextMenu);

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

  async function exportMix() {
    const audible = tracks.filter(t => t.buffer);
    if (!audible.length) { toast('Aucune piste audio à exporter.', 'bad'); return; }
    const anySolo = audible.some(t => t.solo);
    try {
      toast('Préparation du mix WAV…');
      const mixTracks = audible.map(t => ({ ...t, mute: anySolo ? !t.solo : !!t.mute }));
      const rendered = await mix(mixTracks, 44100);
      const blob = encodeWav(rendered, 24);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (proj.name || 'projet').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'projet';
      a.href = url; a.download = safeName + '-mix-24bit.wav';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('Mix WAV 24 bits exporté.', 'ok');
    } catch (e) {
      toastErr(e);
      toast('Échec de l’export WAV.', 'bad');
    }
  }

  function renderSidebar() {
    const groups = [
      { ic: '🗂️', t: 'Projet', items: [['🎚️', 'Timeline', () => go('timeline')], ['🎙️', 'Enregistrer', () => go('rec')], ['📤', 'Exporter le mix WAV 24 bits', exportMix]] },
      { ic: '🎵', t: `Pistes (${tracks.length})`, items: tracks.map((t, i) => [null, t.name || `Piste ${i + 1}`, () => go('timeline'), trackColor(t, i)]) },
      { ic: '🎛️', t: 'Modules', items: [['🎤', 'Auto-Tune', () => go('fx')], ['🎚️', 'Égaliseur', () => go('fx')], ['🗜️', 'Compression', () => go('fx')], ['🌫️', 'Réverbe', () => go('fx')], ['🔁', 'Delay', () => go('fx')], ['🎼', 'Harmonies', () => go('fx')]] },
      { ic: '📚', t: 'Presets (235)', items: [['⭐', 'Références', () => go('repo')], ['🎤', 'Autotune', () => go('repo')], ['🗣️', 'Vraies voix', () => go('repo')], ['🌈', 'Ambiances', () => go('repo')]] },
      { ic: '🧠', t: 'IA Expert', items: [['🎯', 'Analyser la piste', () => go('ia')], ['🎹', 'Détecter la tonalité', () => go('ia')], ['✨', 'Préparer 3 propositions', () => go('ia')]] },
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
  return () => { document.removeEventListener('click', closeContextMenu); closeContextMenu(); stopPlay(); stopAllRec(); stopPreview(); };
}

// Régie Pro — nouvelle page isolée (phase 1 : la coquille + la Timeline réelle).
// NON destructive : lit le MÊME projet que la page Enregistrement (IndexedDB « rec:<projet> »),
// affiche de VRAIES formes d'onde (drawWave) et joue un vrai mix local. 100 % local, 0 €.
// Les autres onglets sont des APERÇUS visuels de la maquette validée, clairement signalés,
// avec un lien vers les pages réelles existantes — ils seront câblés aux phases suivantes.
import { h, state, toast, toastErr, currentProject, audioCtx, pickLocalFiles, startRecorder, downloadBlob, confirmBox } from '../lib/core.js';
import { getItem, putItem, unpackBuffer, packBuffer } from '../lib/session.js';
import { decodeBlob, drawWave, denoise, antipop, voiceChain, normalize, loudness, encodeWav, master, cloneBuffer } from '../lib/audio.js';
import { applyChain, detectPitch, detectKey, keyName, KEY_CHOICES } from '../lib/voicefx.js';
import { analyzeSamples, buildVoiceProposals, antipopFor } from '../lib/ingexpert.js';
import { scoreVoice } from '../lib/voicescore.js';
import { mountAssistant } from './assistant.js';
import { knob } from '../lib/knob.js';

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
.rgmenu{position:fixed;z-index:9999;min-width:210px;background:linear-gradient(180deg,#15152e,#0d0d1c);border:1px solid #2a2752;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.6);padding:6px;color:#eceefc;font-family:'Segoe UI',system-ui,sans-serif;animation:rgpop .12s}
@keyframes rgpop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
.rgmenu .rgmi{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;font-size:13px;cursor:pointer;white-space:nowrap}
.rgmenu .rgmi:hover{background:linear-gradient(90deg,rgba(168,85,247,.28),rgba(34,211,238,.12))}
.rgmenu .rgmi.danger:hover{background:rgba(239,68,68,.25)}
.rgmenu .rgsep{height:1px;background:#2a2752;margin:5px 4px}
.rgmenu .rghead{font-size:10px;color:#8a8fb5;padding:4px 11px 6px;text-transform:uppercase;letter-spacing:.05em}
.regie .preset{display:flex;gap:9px;align-items:center;padding:9px 10px;border-radius:10px;border:1px solid var(--rline);background:linear-gradient(180deg,#141430,#0d0d1e);cursor:pointer;transition:transform .08s,box-shadow .12s}
.regie .preset:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(168,85,247,.25);border-color:var(--rpur)}
.regie .preset .pav{width:30px;height:30px;border-radius:8px;flex:none;display:grid;place-items:center;font-size:15px;background:linear-gradient(135deg,var(--rpur),var(--rcy))}
.regie .preset b{font-size:12.5px}.regie .preset .po{font-size:10px;color:var(--rmut)}
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
      head.oncontextmenu = (e) => trackMenu(i, e);
      lane.oncontextmenu = (e) => trackMenu(i, e);
      head.title = 'Clic droit : nettoyer, effets, volume, supprimer…';
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
      proposalCache = {};
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
      proposalCache = {};
      await save();
      toast(`Prise enregistrée ✓ (${buffer.duration.toFixed(1)} s) — visible dans la Timeline`, 'ok');
      go(cur);
      if (recViaAssistant) { recViaAssistant = false; try { ast?.onRecordStopped?.(); } catch {} }
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

  // ---------- Ingé son IA : NETTOYER & MIXER la voix (sans autotune) ----------
  // Débruitage → anti-plosives → EQ/compression/de-esser/présence/air/réverbe → niveau.
  // Réglages adaptés aux mesures réelles de la voix (buildVoiceProposals).
  let proposalCache = {}; // `${trackIdx}:${id}` -> AudioBuffer traité
  let mixBusy = false;
  function analyzeVoix(track) {
    const buf = track.original || track.buffer;
    const m = analyzeSamples(buf.getChannelData(0), buf.sampleRate);
    return m;
  }
  async function cleanMix(srcBuf, settings, m) {
    let cur = srcBuf;
    cur = await denoise(cur, 0.5);                       // réduction du bruit de fond
    cur = antipop(cur, antipopFor(m.lowRatio || 0));     // atténue les plosives (p/b/t)
    cur = await voiceChain(cur, settings);               // EQ + compression + de-esser + présence + air + réverbe légère
    cur = normalize(cur, -1);                            // met au niveau
    return cur;
  }
  async function buildProposal(track, idx, prop, status) {
    const key = `${idx}:${prop.id}`;
    if (proposalCache[key]) return proposalCache[key];
    const m = analyzeVoix(track);
    if (status) status.textContent = `Préparation « ${prop.name} »…`;
    const out = await cleanMix(track.original || track.buffer, prop.settings, m);
    proposalCache[key] = out;
    if (status) status.textContent = '';
    return out;
  }
  async function applyCleanMix(track, idx, prop, status) {
    if (!track?.buffer) { toast('Choisis une piste voix.', 'bad'); return; }
    if (mixBusy) return; mixBusy = true;
    try {
      if (status) status.textContent = `Nettoyage & mixage « ${prop.name} »…`;
      const out = await buildProposal(track, idx, prop, status);
      if (!track.original) track.original = track.buffer;
      track.buffer = out; track.fxDone = [...(track.fxDone || []).filter(x => x !== 'mix'), 'mix'];
      await save();
      if (status) status.textContent = `✓ Voix nettoyée & mixée (${prop.name}) — écoute « Après »`;
      toast('Voix nettoyée & mixée ✓', 'ok');
    } catch (e) { if (status) status.textContent = 'Erreur'; toastErr(e); }
    finally { mixBusy = false; }
  }

  // ---------- Mixage (rendu offline) + master + export ----------
  const VOICE_PRESETS = {
    rap: { highpass: 90, low: -1, presence: 4, air: 3, deess: 4, comp: 0.75, reverb: 0.08 },
    chant: { highpass: 80, low: 1, presence: 2.5, air: 3, deess: 3, comp: 0.5, reverb: 0.22 },
    propre: { highpass: 85, low: 0, presence: 3, air: 2, deess: 3, comp: 0.5, reverb: 0.06 },
  };
  let lastMaster = null;
  async function renderMix() {
    const audible = tracks.filter(t => t.buffer); if (!audible.length) return null;
    const sr = audible[0].buffer.sampleRate, total = totalDuration();
    const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((total + 0.3) * sr)), sr);
    const anySolo = tracks.some(t => t.solo);
    for (const t of audible) {
      const on = anySolo ? t.solo : !t.mute; if (!on) continue;
      const s = ctx.createBufferSource(); s.buffer = t.buffer;
      const g = ctx.createGain(); g.gain.value = 10 ** ((t.gainDb || 0) / 20); let node = g;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, t.pan || 0)); g.connect(p); node = p; }
      s.connect(g); node.connect(ctx.destination); s.start(t.offset || 0);
    }
    return await ctx.startRendering();
  }
  const masterKey = (p) => { const s = String(p || '').toLowerCase(); if (/club|fort|boum|boom/.test(s)) return 'club'; if (/rap|punch/.test(s)) return 'rap'; return 'streaming'; };
  async function doMasterExport(preset = 'streaming', download = true) {
    const mix = await renderMix(); if (!mix) throw new Error('aucune piste à mixer');
    const out = await master(mix, preset); lastMaster = out?.buffer || out;
    if (download) downloadBlob(encodeWav(lastMaster, 16), `${(proj.name || 'studio').replace(/\s+/g, '-')}-master.wav`);
    return lastMaster;
  }

  // ---------- Assistant ingé expert EN DIRECT (voix + texte + actions réelles) ----------
  let ast = null, recViaAssistant = false, selVoixIdx = -1;
  const lastVoixIdx = () => { let idx = -1; tracks.forEach((t, i) => { if (!isInstru(t)) idx = i; }); return idx; };
  const curVoix = () => { let i = (selVoixIdx >= 0 && tracks[selVoixIdx] && !isInstru(tracks[selVoixIdx])) ? selVoixIdx : lastVoixIdx(); if (i < 0) throw new Error('aucune piste voix — enregistre d’abord'); return { t: tracks[i], i }; };
  function buildAssistantS() {
    return {
      isRecording: () => recording,
      snapshot: () => ({
        enregistrement_en_cours: recording,
        pistes: tracks.map((t, i) => ({ n: i + 1, nom: t.name, type: t.kind, duree_s: t.buffer ? Math.round(t.buffer.duration * 10) / 10 : 0, volume_db: t.gainDb, muet: t.mute, effets_appliques: t.fxDone || [] })),
        piste_selectionnee: (lastVoixIdx() + 1) || 1, instru_presente: tracks.some(isInstru),
      }),
      record: async () => { recViaAssistant = true; const ci = recOpt.countIn; recOpt.countIn = 0; try { await startRecording(); } finally { recOpt.countIn = ci; } },
      do: {
        stop: async () => { if (recording) return stopRecording(); stopPlay(); stopPreview(); },
        pause: async () => { stopPlay(); stopPreview(); },
        play: async (x) => { if (x?.what === 'voix') { const { t } = curVoix(); playBuffer(t.buffer); } else startPlay(0); },
        select: async (x) => { const n = Number(x.track); if (n >= 1 && tracks[n - 1]) selVoixIdx = n - 1; },
        clean: async () => { const { t, i } = curVoix(); const p = buildVoiceProposals(analyzeVoix(t), 'rap').find(z => z.id === 'premium'); await applyCleanMix(t, i, p, null); },
        voice: async (x) => { const { t } = curVoix(); const v = VOICE_PRESETS[x.preset] || VOICE_PRESETS.rap; const src = t.original || t.buffer; const out = await voiceChain(src, v); if (!t.original) t.original = t.buffer; t.buffer = out; t.fxDone = [...(t.fxDone || []), 'voix']; proposalCache = {}; await save(); },
        tune: async (x) => { const { t } = curVoix(); const lvl = String(x.level || '').toLowerCase(); atOpt.speed = /fort|robot|hard|t.?pain/.test(lvl) ? 0 : /moyen|melod|drake/.test(lvl) ? 25 : /leger|l.ger|naturel/.test(lvl) ? 120 : 55; atOpt.strength = 1; await applyAutotune(t, { textContent: '' }, { textContent: '' }); },
        effect: async (x) => { const { t } = curVoix(); if (!Array.isArray(x.chain) || !x.chain.length) throw new Error('effet non reconnu'); const src = t.buffer; const res = await applyChain(src, x.chain); if (!t.original) t.original = t.buffer; t.buffer = res.buffer; t.fxDone = [...(t.fxDone || []), 'effet']; proposalCache = {}; await save(); },
        volume: async (x) => { let i = x.track === 'instru' ? tracks.findIndex(isInstru) : x.track === 'voix' ? lastVoixIdx() : Number(x.track) - 1; if (i < 0 || !tracks[i]) throw new Error('pas de piste'); const g = x.delta !== undefined ? (tracks[i].gainDb || 0) + Number(x.delta) : Number(x.db) || 0; tracks[i].gainDb = Math.max(-30, Math.min(12, g)); await save(); },
        mute: async (x) => { let i = x.track === 'instru' ? tracks.findIndex(isInstru) : x.track === 'voix' ? lastVoixIdx() : Number(x.track) - 1; if (tracks[i]) { tracks[i].mute = x.on !== false; await save(); } },
        normalize: async () => { const { t } = curVoix(); const src = t.original || t.buffer; if (!t.original) t.original = t.buffer; t.buffer = normalize(cloneBuffer(src), -1); proposalCache = {}; await save(); },
        original: async () => { const { t } = curVoix(); if (t.original) { t.buffer = t.original; t.fxDone = []; proposalCache = {}; await save(); } },
        master: async (x) => { await doMasterExport(masterKey(x.preset), false); toast('Mix & master prêt — dis « télécharge »', 'ok'); },
        save: async () => { await doMasterExport('streaming', true); },
        download: async () => { await doMasterExport('streaming', true); },
        all: async () => { const { t, i } = curVoix(); const p = buildVoiceProposals(analyzeVoix(t), 'rap').find(z => z.id === 'premium'); await applyCleanMix(t, i, p, null); await doMasterExport('streaming', false); toast('Nettoyé, mixé & masterisé ✓', 'ok'); },
      },
    };
  }

  // ---------- Répertoire de presets RÉELS + actions directes (clic droit) ----------
  const FXP = {
    at_leger: { cat: 'Autotune', emo: '🎤', name: 'Autotune léger', chain: [{ t: 'tune', strength: 1, speed: 120 }] },
    at_melo: { cat: 'Autotune', emo: '🎤', name: 'Rap mélodique', chain: [{ t: 'tune', strength: 1, speed: 25 }] },
    at_hard: { cat: 'Autotune', emo: '🤖', name: 'Hard tune (robot)', chain: [{ t: 'tune', strength: 1, speed: 0 }] },
    v_rap: { cat: 'Voix', emo: '🎙️', name: 'Voix rap pro', voice: VOICE_PRESETS.rap },
    v_chant: { cat: 'Voix', emo: '🎵', name: 'Voix chant douce', voice: VOICE_PRESETS.chant },
    v_propre: { cat: 'Voix', emo: '🧼', name: 'Voix propre', voice: VOICE_PRESETS.propre },
    v_radio: { cat: 'Voix', emo: '📻', name: 'Radio', chain: [{ t: 'fx', kind: 'band', lo: 400, hi: 3200, drive: 2 }] },
    v_phone: { cat: 'Voix', emo: '📞', name: 'Téléphone', chain: [{ t: 'fx', kind: 'band', lo: 500, hi: 2800, drive: 3 }] },
    e_reverb: { cat: 'Effets', emo: '🌫️', name: 'Réverbe', chain: [{ t: 'fx', kind: 'reverb', size: 2.2, mix: 0.3 }] },
    e_delay: { cat: 'Effets', emo: '🔁', name: 'Écho (delay)', chain: [{ t: 'fx', kind: 'delay', time: 0.32, fb: 0.35, mix: 0.3 }] },
    e_pp: { cat: 'Effets', emo: '🏓', name: 'Écho ping-pong', chain: [{ t: 'fx', kind: 'pingpong', time: 0.24, mix: 0.3 }] },
    e_chorus: { cat: 'Effets', emo: '🌊', name: 'Chorus', chain: [{ t: 'fx', kind: 'chorus', mix: 0.4 }] },
    e_tube: { cat: 'Effets', emo: '🔊', name: 'Chaleur (tube)', chain: [{ t: 'fx', kind: 'tube', amt: 2 }] },
    e_air: { cat: 'Effets', emo: '✨', name: 'Air / brillance', chain: [{ t: 'fx', kind: 'air', gain: 4 }] },
    e_sat: { cat: 'Effets', emo: '🔥', name: 'Saturation', chain: [{ t: 'fx', kind: 'distort', amt: 3, tone: 8000 }] },
    e_lofi: { cat: 'Effets', emo: '📼', name: 'Lo-Fi', chain: [{ t: 'fx', kind: 'lofi', bits: 8, hi: 6000 }] },
    h_tierce: { cat: 'Harmonies', emo: '🎼', name: 'Harmonie tierce', chain: [{ t: 'harmony', steps: [2] }] },
    h_quinte: { cat: 'Harmonies', emo: '🎶', name: 'Tierce + quinte', chain: [{ t: 'harmony', steps: [2, 4] }] },
    h_double: { cat: 'Harmonies', emo: '👥', name: 'Doublage', chain: [{ t: 'double', steps: [0, 0] }] },
    h_oct: { cat: 'Harmonies', emo: '⬇️', name: 'Octave grave', chain: [{ t: 'double', steps: [-12], gain: 0.5 }] },
  };
  // Banque d'effets (tous réels, appliqués via applyChain)
  const EFFECTS_BANK = [
    ['Hard Tune', '🎤', [{ t: 'tune', strength: 1, speed: 0 }]],
    ['Soft Tune', '🎶', [{ t: 'tune', strength: 1, speed: 120 }]],
    ['Double', '👥', [{ t: 'double', steps: [0, 0] }]],
    ['Harmonie', '🎼', [{ t: 'harmony', steps: [2] }]],
    ['Tierce+Quinte', '🎹', [{ t: 'harmony', steps: [2, 4] }]],
    ['Octave grave', '⬇️', [{ t: 'double', steps: [-12], gain: 0.5 }]],
    ['Octave aiguë', '⬆️', [{ t: 'double', steps: [12], gain: 0.35 }]],
    ['Vocoder', '🤖', [{ t: 'vocoder' }]],
    ['Robot', '🔧', [{ t: 'tune', strength: 1, speed: 0 }, { t: 'fx', kind: 'tube', amt: 1.5 }]],
    ['Chorus', '🌊', [{ t: 'fx', kind: 'chorus', mix: 0.4 }]],
    ['Flanger', '🛸', [{ t: 'fx', kind: 'flanger', mix: 0.5 }]],
    ['Chaleur', '🔥', [{ t: 'fx', kind: 'warm' }]],
    ['Tube', '🔊', [{ t: 'fx', kind: 'tube', amt: 2 }]],
    ['Bande', '📼', [{ t: 'fx', kind: 'tape', amt: 2 }]],
    ['Exciter', '✨', [{ t: 'fx', kind: 'exciter', mix: 0.3 }]],
    ['Air', '💨', [{ t: 'fx', kind: 'air', gain: 4 }]],
    ['Distorsion', '⚡', [{ t: 'fx', kind: 'distort', amt: 4, tone: 8000 }]],
    ['Lo-Fi', '🎛️', [{ t: 'fx', kind: 'lofi', bits: 8, hi: 6000 }]],
    ['Radio', '📻', [{ t: 'fx', kind: 'band', lo: 400, hi: 3200, drive: 2 }]],
    ['Téléphone', '📞', [{ t: 'fx', kind: 'band', lo: 500, hi: 2800, drive: 3 }]],
    ['Reverb Hall', '🏛️', [{ t: 'fx', kind: 'reverb', size: 3, mix: 0.35 }]],
    ['Reverb Plate', '🪞', [{ t: 'fx', kind: 'reverb', size: 1.5, mix: 0.28 }]],
    ['Delay', '🔁', [{ t: 'fx', kind: 'delay', time: 0.32, fb: 0.35, mix: 0.3 }]],
    ['Ping-Pong', '🏓', [{ t: 'fx', kind: 'pingpong', time: 0.24, mix: 0.3 }]],
  ];
  async function processPreset(src, p) { let cur = src; if (p.chain) cur = (await applyChain(cur, p.chain)).buffer; if (p.voice) cur = await voiceChain(cur, p.voice); return cur; }
  let busyFx = false;
  async function applyPresetTo(i, p) {
    const t = tracks[i]; if (!t?.buffer) return;
    if (busyFx) { toast('Un traitement est déjà en cours…'); return; } busyFx = true;
    toast(`${p.emo} ${p.name}…`);
    try { const out = await processPreset(t.buffer, p); if (!t.original) t.original = t.buffer; t.buffer = out; t.fxDone = [...(t.fxDone || []), p.name]; proposalCache = {}; await save(); toast(`${p.name} appliqué ✓`, 'ok'); if (cur === 'timeline' || cur === 'regie') go(cur); }
    catch (e) { toastErr(e); } finally { busyFx = false; }
  }
  async function quickCleanIdx(i) { const t = tracks[i]; if (!t) return; const p = buildVoiceProposals(analyzeVoix(t), 'rap').find(z => z.id === 'premium'); if (busyFx) return; busyFx = true; try { await applyCleanMix(t, i, p, null); if (cur === 'timeline' || cur === 'regie') go(cur); } finally { busyFx = false; } }
  function quickRevertIdx(i) { const t = tracks[i]; if (t?.original) { t.buffer = t.original; t.fxDone = []; proposalCache = {}; save(); toast('Original rétabli', 'ok'); if (cur === 'timeline' || cur === 'regie') go(cur); } }
  function adjustVol(i, d) { const t = tracks[i]; if (!t) return; t.gainDb = Math.max(-30, Math.min(12, (t.gainDb || 0) + d)); save(); if (cur === 'timeline' || cur === 'regie') go(cur); }
  function toggleMuteIdx(i) { const t = tracks[i]; if (!t) return; t.mute = !t.mute; save(); if (cur === 'timeline' || cur === 'regie') go(cur); }
  function toggleSoloIdx(i) { const t = tracks[i]; if (!t) return; t.solo = !t.solo; save(); if (cur === 'timeline' || cur === 'regie') go(cur); }
  async function deleteTrackIdx(i) { const t = tracks[i]; if (!t) return; if (!(await confirmBox(`Supprimer la piste « ${t.name || 'Piste ' + (i + 1)} » ?`, 'Supprimer', true))) return; tracks.splice(i, 1); proposalCache = {}; await save(); toast('Piste supprimée', 'ok'); go(cur); }

  // ---------- menu contextuel (clic droit) ----------
  let menuEl = null;
  function closeMenu() { try { menuEl?.remove(); } catch {} menuEl = null; }
  function showMenu(x, y, items) {
    closeMenu();
    menuEl = h('div.rgmenu', items.map(it => it === '-' ? h('div.rgsep') : it.head ? h('div.rghead', it.head) : h('div.rgmi' + (it.danger ? '.danger' : ''), { onclick: (e) => { e.stopPropagation(); closeMenu(); try { it.fn(); } catch (err) { toastErr(err); } } }, it.label)));
    menuEl.style.left = x + 'px'; menuEl.style.top = y + 'px';
    document.body.append(menuEl);
    requestAnimationFrame(() => { if (!menuEl) return; const r = menuEl.getBoundingClientRect(); if (r.right > innerWidth) menuEl.style.left = Math.max(6, innerWidth - r.width - 8) + 'px'; if (r.bottom > innerHeight) menuEl.style.top = Math.max(6, innerHeight - r.height - 8) + 'px'; });
    setTimeout(() => document.addEventListener('pointerdown', closeMenu, { once: true }), 0);
  }
  function trackMenu(i, ev) {
    ev.preventDefault(); ev.stopPropagation();
    const t = tracks[i]; if (!t) return;
    const vx = !isInstru(t);
    const items = [
      { head: t.name || `Piste ${i + 1}` },
      { label: '▶ Lire cette piste', fn: () => playBuffer(t.buffer) },
      { label: '⏹ Stop', fn: () => stopPreview() },
      '-',
    ];
    if (vx) items.push(
      { label: '🧼 Nettoyer & mixer', fn: () => quickCleanIdx(i) },
      { label: '🎤 Autotune léger', fn: () => applyPresetTo(i, FXP.at_leger) },
      { label: '🎤 Autotune fort (robot)', fn: () => applyPresetTo(i, FXP.at_hard) },
      { label: '🌫️ Réverbe', fn: () => applyPresetTo(i, FXP.e_reverb) },
      { label: '🔁 Écho (delay)', fn: () => applyPresetTo(i, FXP.e_delay) },
      { label: '✨ Air / brillance', fn: () => applyPresetTo(i, FXP.e_air) },
      { label: '🎼 Harmonies', fn: () => applyPresetTo(i, FXP.h_tierce) },
      '-');
    items.push(
      { label: '🔊 Volume +2 dB', fn: () => adjustVol(i, 2) },
      { label: '🔉 Volume −2 dB', fn: () => adjustVol(i, -2) },
      { label: t.mute ? '🔈 Réactiver le son' : '🔇 Rendre muet', fn: () => toggleMuteIdx(i) },
      { label: t.solo ? '◻ Retirer le solo' : '⭐ Solo', fn: () => toggleSoloIdx(i) },
    );
    if (vx) items.push({ label: '↩ Revenir à l’original', fn: () => quickRevertIdx(i) });
    items.push('-', { label: '🗑️ Supprimer la piste', danger: true, fn: () => deleteTrackIdx(i) });
    showMenu(ev.clientX, ev.clientY, items);
  }

  // ---------- RACK LIVE : écouter et régler EN DIRECT ----------
  const LF = { vol: 0, hp: 85, low: 0, mid: 2.5, high: 3, comp: 0.4, reverb: 0.1, delay: 0, drive: 0 };
  let live = null;
  function makeImpulse(ctx, dur = 1.8, decay = 3) { const len = Math.floor(ctx.sampleRate * dur); const imp = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); } return imp; }
  function driveCurve(amount) { const k = amount * 60, n = 1024, curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); } return curve; }
  function liveSet(k, v) {
    LF[k] = v; if (!live) return; const n = live.nodes, now = live.ctx.currentTime, T = (p, val) => p.setTargetAtTime(val, now, 0.02);
    if (k === 'vol') T(n.master.gain, 10 ** (v / 20));
    else if (k === 'hp') T(n.hp.frequency, v);
    else if (k === 'low') T(n.low.gain, v);
    else if (k === 'mid') T(n.mid.gain, v);
    else if (k === 'high') T(n.high.gain, v);
    else if (k === 'comp') { T(n.comp.threshold, -10 - v * 20); T(n.comp.ratio, 2 + v * 4); T(n.makeup.gain, 10 ** ((v * 6) / 20)); }
    else if (k === 'reverb') T(n.revG.gain, v);
    else if (k === 'delay') T(n.delG.gain, v);
    else if (k === 'drive') n.drive.curve = driveCurve(v);
  }
  function startLive(i) {
    stopLive(); const t = tracks[i]; if (!t?.buffer) { toast('Choisis une piste voix.', 'bad'); return false; }
    stopPreview(); stopPlay();
    const ctx = audioCtx();
    const src = ctx.createBufferSource(); src.buffer = t.buffer; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = LF.hp; hp.Q.value = 0.7;
    const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200; low.gain.value = LF.low;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 2500; mid.Q.value = 0.8; mid.gain.value = LF.mid;
    const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 9000; high.gain.value = LF.high;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10 - LF.comp * 20; comp.ratio.value = 2 + LF.comp * 4; comp.attack.value = 0.005; comp.release.value = 0.12; comp.knee.value = 6;
    const drive = ctx.createWaveShaper(); drive.curve = driveCurve(LF.drive); drive.oversample = '2x';
    const makeup = ctx.createGain(); makeup.gain.value = 10 ** ((LF.comp * 6) / 20);
    const master = ctx.createGain(); master.gain.value = 10 ** (LF.vol / 20);
    const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx); const revG = ctx.createGain(); revG.gain.value = LF.reverb;
    const dl = ctx.createDelay(1.0); dl.delayTime.value = 0.3; const fb = ctx.createGain(); fb.gain.value = 0.3; const delG = ctx.createGain(); delG.gain.value = LF.delay;
    src.connect(hp).connect(low).connect(mid).connect(high).connect(comp).connect(drive).connect(makeup);
    makeup.connect(master);
    makeup.connect(revG); revG.connect(conv).connect(master);
    makeup.connect(delG); delG.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(master);
    master.connect(ctx.destination);
    src.start();
    live = { ctx, src, nodes: { hp, low, mid, high, comp, drive, makeup, master, conv, revG, dl, fb, delG }, i };
    return true;
  }
  function stopLive() { if (!live) return; try { live.src.stop(); } catch {} try { Object.values(live.nodes).forEach(n => n.disconnect && n.disconnect()); } catch {} live = null; }
  async function bakeLive(i) {
    const t = tracks[i]; if (!t?.buffer) { toast('Choisis une piste voix.', 'bad'); return; }
    if (busyFx) return; busyFx = true; toast('Gravure des réglages sur la piste…');
    try {
      let cur = await voiceChain(t.buffer, { highpass: LF.hp, low: LF.low, presence: LF.mid, air: LF.high, deess: 3, comp: LF.comp, reverb: LF.reverb, gainDb: LF.vol });
      const chain = []; if (LF.delay > 0) chain.push({ t: 'fx', kind: 'delay', time: 0.3, fb: 0.3, mix: LF.delay }); if (LF.drive > 0) chain.push({ t: 'fx', kind: 'distort', amt: 1 + LF.drive * 6, tone: 8000 });
      if (chain.length) cur = (await applyChain(cur, chain)).buffer;
      if (!t.original) t.original = t.buffer; t.buffer = cur; t.fxDone = [...(t.fxDone || []), 'réglages live']; proposalCache = {}; await save();
      toast('Réglages gravés sur la piste ✓', 'ok');
    } catch (e) { toastErr(e); } finally { busyFx = false; }
  }

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

  const scoreColor = (s) => s === 'ok' ? '#34e39a' : s === 'warn' ? '#f0b429' : '#ef4444';
  function viewRegie() {
    const root = h('div');
    const vi = lastVoixIdx(); const vt = vi >= 0 ? tracks[vi] : null;
    let m = null, sc = { overall: null, items: [] };
    if (vt?.buffer) { try { m = analyzeSamples((vt.original || vt.buffer).getChannelData(0), vt.buffer.sampleRate); sc = scoreVoice(m); } catch {} }
    const ov = sc.overall;
    const dash = (sc.overall ?? 226 * (ov || 0) / 100);
    const gauge = `<svg viewBox="0 0 88 88" style="width:82px;height:82px;flex:none"><circle cx="44" cy="44" r="36" fill="none" stroke="#1b1440" stroke-width="8"/><circle cx="44" cy="44" r="36" fill="none" stroke="${ov == null ? '#3a3a55' : scoreColor(sc.items[0] ? (ov >= 80 ? 'ok' : ov >= 60 ? 'warn' : 'bad') : 'warn')}" stroke-width="8" stroke-linecap="round" stroke-dasharray="226" stroke-dashoffset="${226 - 226 * (ov || 0) / 100}" transform="rotate(-90 44 44)" style="filter:drop-shadow(0 0 6px currentColor)"/><text x="44" y="49" text-anchor="middle" font-size="18" font-weight="800" fill="#fff">${ov == null ? '—' : ov + '%'}</text></svg>`;
    const items = sc.items.length ? sc.items.map(it => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:7px;font-size:13px"><span style="width:16px;height:16px;border-radius:50%;background:${scoreColor(it.status)};flex:none"></span><span style="flex:1">${it.label}</span><b>${it.pct}%</b></div>`).join('') : '<p class="muted" style="font-size:12px">Enregistre une voix pour l’analyser.</p>';
    const fx = (vt?.fxDone || []); const uniq = [...new Set(fx)];
    const proc = uniq.length ? uniq.map(x => `<div style="display:flex;gap:9px;align-items:center;margin-bottom:9px;font-size:12px"><span style="width:16px;height:16px;border-radius:50%;background:#34e39a;display:grid;place-items:center;color:#042;font-weight:900;font-size:10px">✓</span>${x}</div>`).join('') : '<p class="muted" style="font-size:12px">Aucun traitement appliqué.<br>Utilise le Rack LIVE, le clic droit ou l’ingé IA.</p>';
    const peakPct = m ? Math.min(100, Math.max(0, (m.peakDb + 40) / 40 * 100)) : 0;
    const rmsPct = m ? Math.min(100, Math.max(0, (m.rmsDb + 50) / 50 * 100)) : 0;
    root.innerHTML = `
     <div class="grid" style="grid-template-columns:1.05fr 1.05fr 1.5fr 160px">
      <div class="panel"><div class="ph">📊 Analyse vocale <span class="r" style="color:#bff5db">mesures réelles</span></div><div class="pb" style="display:flex;gap:12px;align-items:center">
       ${gauge}<div style="flex:1">${items}</div></div></div>
      <div class="panel"><div class="ph">⚙️ Traitements appliqués</div><div class="pb">${proc}</div></div>
      <div class="panel"><div class="ph">🌈 Spectre (visuel)</div><div class="pb"><div style="height:150px;border-radius:11px;overflow:hidden;background:#07041a;border:1px solid var(--rline);position:relative">${spec3d()}</div></div></div>
      <div class="panel"><div class="ph">🎚️ Niveaux</div><div class="pb">
       <div style="display:flex;gap:9px;align-items:center;font-size:11px;margin-bottom:9px"><span class="muted" style="width:40px">Crête</span><div style="flex:1;height:9px;border-radius:5px;background:#141230;overflow:hidden"><i style="display:block;height:100%;width:${peakPct}%;background:linear-gradient(90deg,#34e39a,#f0b429 72%,#ef4444)"></i></div><b>${m ? m.peakDb : '—'}</b></div>
       <div style="display:flex;gap:9px;align-items:center;font-size:11px;margin-bottom:9px"><span class="muted" style="width:40px">Moyen</span><div style="flex:1;height:9px;border-radius:5px;background:#141230;overflow:hidden"><i style="display:block;height:100%;width:${rmsPct}%;background:linear-gradient(90deg,#34e39a,#f0b429 72%,#ef4444)"></i></div><b>${m ? m.rmsDb : '—'}</b></div>
       <div style="text-align:center;background:#0d1702;border:1px solid #2a4a10;border-radius:9px;padding:9px"><b style="font-size:20px;color:#bff5db">${m ? m.crestDb : '—'}</b><div class="muted" style="font-size:9px">DYNAMIQUE (dB)</div></div></div></div>
     </div>
     <div class="panel" style="margin-top:12px"><div class="ph">🎛️ Rack · aperçu <span class="r">onglet « Effets » pour le rack LIVE</span></div><div class="pb"><div class="grid" style="grid-template-columns:repeat(8,1fr)">
      ${knobHtml('Auto-Tune', '—', '#22d3ee', 50)}${knobHtml('EQ', '—', '#f0b429', 50)}${knobHtml('Comp', '—', '#22d3ee', 50)}${knobHtml('De-Ess', '—', '#22c55e', 50)}${knobHtml('Satur.', '—', '#ff6b3d', 40)}${knobHtml('Reverb', '—', '#a855f7', 40)}${knobHtml('Delay', '—', '#22d3ee', 36)}${knobHtml('Stéréo', '—', '#ec4899', 60)}
     </div></div></div>`;
    // ligne du bas : Timeline RÉELLE + Marco
    const mini = h('div.pb');
    const bottom = h('div.grid', { style: { gridTemplateColumns: '1.6fr 1fr', marginTop: '12px' } },
      h('div.panel', h('div.ph', '🎵 Timeline', h('span.r', 'onglet « Timeline » pour le plein écran')), mini),
      h('div.panel',
        h('div.ph', '🧠 Ingé son IA'),
        h('div.pb',
          h('div', { style: { display: 'flex', gap: '11px', alignItems: 'center', marginBottom: '10px' } }, h('div.orb'), h('div', h('b', 'Marco · IA'), h('div.muted', { style: { fontSize: '12px' } }, 'assistant en direct'))),
          h('div.msg.ai', { style: { margin: '0 0 10px' } }, 'Parle-moi ou écris-moi pour piloter le studio, ou laisse-moi nettoyer et mixer ta voix.'),
          h('button.rbtn.p', { style: { width: '100%', textAlign: 'center' }, onclick: () => go('ia') }, 'Ouvrir l’ingé IA →'))));
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

  const dbF = (v) => `${v > 0 ? '+' : ''}${v.toFixed(v % 1 ? 1 : 0)} dB`;
  const pcF = (v) => `${Math.round(v * 100)} %`;

  function liveRackPanel() {
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i) }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curIdx = () => +sel.value;
    const playBtn = h('button.rbtn.p', { style: { fontWeight: '800', whiteSpace: 'nowrap' } }, '▶ Écouter en direct');
    const refreshPlay = () => { playBtn.textContent = live ? '⏹ Arrêter' : '▶ Écouter en direct'; };
    playBtn.onclick = () => { if (live) { stopLive(); } else { startLive(curIdx()); } refreshPlay(); };
    sel.onchange = () => { if (live) { startLive(curIdx()); refreshPlay(); } };
    const K = (label, key, min, max, step, def, fmt) => knob({ label, min, max, step, value: LF[key], def, fmt, onInput: (v) => liveSet(key, v) }).el;
    const knobs = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '14px', justifyContent: 'space-between', margin: '6px 4px' } },
      K('VOLUME', 'vol', -12, 6, 0.5, 0, dbF),
      K('GRAVE (HP)', 'hp', 40, 160, 5, 85, v => `${v | 0} Hz`),
      K('LOW', 'low', -6, 6, 0.5, 0, dbF),
      K('MID', 'mid', -6, 8, 0.5, 2.5, dbF),
      K('AIGU', 'high', -6, 8, 0.5, 3, dbF),
      K('COMPRESSION', 'comp', 0, 1, 0.05, 0.4, pcF),
      K('RÉVERBE', 'reverb', 0, 0.6, 0.02, 0.1, pcF),
      K('DELAY', 'delay', 0, 0.5, 0.02, 0, pcF),
      K('SATURATION', 'drive', 0, 1, 0.05, 0, pcF));
    return h('div.panel',
      h('div.ph', h('span', { style: { width: '11px', height: '11px', borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 8px #22d3ee', flex: 'none' } }), '🎛️ Rack LIVE — écoute et règle en direct', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'TEMPS RÉEL')),
      h('div.pb',
        h('div', { style: { display: 'flex', gap: '9px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' } },
          h('span.muted', { style: { fontSize: '12px' } }, 'Piste :'), sel, playBtn,
          h('button.rbtn.g', { style: { whiteSpace: 'nowrap' }, onclick: () => bakeLive(curIdx()) }, '💾 Graver'),
          h('button.rbtn', { style: { whiteSpace: 'nowrap' }, onclick: () => revertTrack(tracks[curIdx()], { textContent: '' }) }, '↩ Original')),
        knobs,
        h('div.muted', { style: { fontSize: '10px', marginTop: '6px', lineHeight: '1.4' } }, 'Clique « Écouter en direct » : la piste tourne en boucle, bouge les molettes → tu entends le changement tout de suite. « Graver » enregistre ces réglages sur la piste (voix brute conservée).')));
  }

  function autotunePanel() {
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i) }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curTrack = () => tracks[+sel.value];
    const keyLabel = h('b', { style: { color: '#bff5db' } }, '—');
    const keySel = h('select', { style: selStyle(), onchange: (e) => { atOpt.key = e.target.value; } }, KEY_CHOICES.map(k => h('option', { value: k.v }, k.label)));
    const status = h('div.muted', { style: { fontSize: '11px', minHeight: '15px', marginTop: '6px' } }, '');
    const kSpeed = knob({ label: 'VITESSE', min: 0, max: 200, step: 5, value: atOpt.speed, def: 60, fmt: v => `${v | 0} ms`, onInput: v => atOpt.speed = v });
    const kStr = knob({ label: 'FORCE', min: 0, max: 1, step: 0.05, value: atOpt.strength, def: 1, fmt: pcF, onInput: v => atOpt.strength = v });
    const kFor = knob({ label: 'TIMBRE', min: -4, max: 4, step: 1, value: atOpt.formant, def: 0, fmt: v => `${v}`, onInput: v => atOpt.formant = v });
    const presets = [['Naturel', 0.8, 120], ['Pop', 1, 60], ['R&B', 1, 35], ['Trap mélo', 1, 15], ['Hard', 1, 0]];
    const presetRow = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '4px 0 10px' } },
      presets.map(([nm, st, sp]) => h('span.chip', { onclick: () => { atOpt.strength = st; atOpt.speed = sp; kStr.set(st, false); kSpeed.set(sp, false); } }, nm)));
    return h('div.panel',
      h('div.ph', h('span', { style: { width: '11px', height: '11px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px #a855f7', flex: 'none' } }), '🎤 Auto-Tune Pro', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'RÉEL')),
      h('div.pb',
        h('div', { style: { display: 'flex', gap: '9px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Piste :'), sel, h('span.muted', { style: { fontSize: '12px' } }, 'Tonalité :'), keyLabel, keySel),
        presetRow,
        h('div', { style: { display: 'flex', gap: '18px', justifyContent: 'center', margin: '6px 0 4px' } }, kSpeed.el, kStr.el, kFor.el),
        h('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '10px' } },
          h('button.rbtn', { onclick: () => analyzeKey(curTrack(), status, keyLabel) }, '🎹 Détecter la tonalité'),
          h('button.rbtn.p', { onclick: () => applyAutotune(curTrack(), status, keyLabel) }, '✨ Appliquer'),
          h('button.rbtn', { onclick: () => { const t = curTrack(); playBuffer(t?.original || t?.buffer); } }, '▶ Avant'),
          h('button.rbtn', { onclick: () => playBuffer(curTrack()?.buffer) }, '▶ Après'),
          h('button.rbtn', { onclick: () => stopPreview() }, '⏹')),
        status,
        h('div.muted', { style: { fontSize: '10px', marginTop: '8px', lineHeight: '1.4' } }, 'L’auto-tune se calcule puis s’applique (pas en direct). 0 ms = robot, plus de ms = naturel.')));
  }

  const hzF = (v) => `${v | 0} Hz`;
  function viewFx() {
    const root = h('div');
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i) }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curIdx = () => +sel.value;
    const playBtn = h('button.rbtn.p', { style: { whiteSpace: 'nowrap', fontWeight: '800' } }, '▶ Écouter en direct');
    const refreshPlay = () => { playBtn.textContent = live ? '⏹ Arrêter' : '▶ Écouter en direct'; };
    playBtn.onclick = () => { if (live) stopLive(); else startLive(curIdx()); refreshPlay(); };
    sel.onchange = () => { if (live) { startLive(curIdx()); refreshPlay(); } };
    const liveKnob = (label, key, min, max, step, def, fmt) => knob({ label, min, max, step, value: LF[key], def, fmt, onInput: (v) => liveSet(key, v) }).el;
    // barre live
    const bar = h('div.panel', h('div.pb', { style: { display: 'flex', gap: '9px', alignItems: 'center', flexWrap: 'wrap' } },
      h('span', { style: { width: '9px', height: '9px', borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 8px #22d3ee' } }),
      h('b', { style: { fontSize: '13px' } }, 'Chaîne vocale en direct'), h('span.muted', { style: { fontSize: '12px' } }, '· piste :'), sel, playBtn,
      h('button.rbtn.g', { style: { whiteSpace: 'nowrap' }, onclick: () => bakeLive(curIdx()) }, '💾 Graver'),
      h('button.rbtn', { style: { whiteSpace: 'nowrap' }, onclick: () => revertTrack(tracks[curIdx()], { textContent: '' }) }, '↩ Original'),
      h('span.muted', { style: { fontSize: '10px', flexBasis: '100%' } }, 'Lance la lecture puis tourne les molettes : le son change en direct. « Graver » enregistre les réglages sur la piste.')));
    // modules live
    const eqPanel = h('div.panel', h('div.ph', h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 7px #3b82f6', flex: 'none' } }), '🎚️ Égaliseur paramétrique', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'LIVE')),
      h('div.pb', h('div', { style: { height: '96px', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--rline)', background: '#0b0b1a', marginBottom: '10px' }, html: eqCurveSvg() }),
        h('div', { style: { display: 'flex', justifyContent: 'space-around' } }, liveKnob('GRAVE', 'hp', 40, 160, 5, 85, hzF), liveKnob('LOW', 'low', -6, 6, 0.5, 0, dbF), liveKnob('MID', 'mid', -6, 8, 0.5, 2.5, dbF), liveKnob('AIGU', 'high', -6, 8, 0.5, 3, dbF))));
    const compPanel = h('div.panel', h('div.ph', h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: '#f0b429', boxShadow: '0 0 7px #f0b429', flex: 'none' } }), '🗜️ Compression', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'LIVE')),
      h('div.pb', h('div', { style: { display: 'flex', justifyContent: 'space-around', alignItems: 'center' } }, liveKnob('TAUX', 'comp', 0, 1, 0.05, 0.4, pcF), liveKnob('VOLUME', 'vol', -12, 6, 0.5, 0, dbF))));
    const revPanel = h('div.panel', h('div.ph', h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 7px #a855f7', flex: 'none' } }), '🌫️ Réverbe & Delay', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'LIVE')),
      h('div.pb', h('div', { style: { display: 'flex', justifyContent: 'space-around', alignItems: 'center' } }, liveKnob('RÉVERBE', 'reverb', 0, 0.6, 0.02, 0.1, pcF), liveKnob('DELAY', 'delay', 0, 0.5, 0.02, 0, pcF), liveKnob('SATUR.', 'drive', 0, 1, 0.05, 0, pcF))));
    // banque d'effets
    const bank = h('div.panel', h('div.ph', '⭐ Banque d’effets', h('span.r', `${EFFECTS_BANK.length} effets · clic = appliquer`)),
      h('div.pb', h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))', gap: '8px' } },
        EFFECTS_BANK.map(([nm, emo, chain]) => h('div.preset', { style: { flexDirection: 'column', textAlign: 'center', padding: '10px 6px', gap: '4px' }, onclick: () => { const i = curIdx(); if (!tracks[i]) { toast('Choisis une piste voix.', 'bad'); return; } applyPresetTo(i, { emo, name: nm, chain }); } },
          h('div', { style: { fontSize: '20px' } }, emo), h('b', { style: { fontSize: '11px' } }, nm))))));
    root.append(bar, h('div', { style: { height: '12px' } }),
      autotunePanel(), h('div', { style: { height: '12px' } }),
      h('div.grid', { style: { gridTemplateColumns: '1.2fr 1fr 1fr' } }, eqPanel, compPanel, revPanel),
      h('div', { style: { height: '12px' } }), bank);
    return root;
  }

  function viewRepo() {
    const root = h('div');
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i) }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const status = h('span.muted', { style: { fontSize: '11px' } }, vt.length ? '' : 'Enregistre une voix pour appliquer un preset.');
    const CATS = {
      '🎤 Autotune': [FXP.at_leger, FXP.at_melo, FXP.at_hard],
      '🎙️ Vraies voix': [FXP.v_rap, FXP.v_chant, FXP.v_propre, FXP.v_radio, FXP.v_phone],
      '🌈 Effets': [FXP.e_reverb, FXP.e_delay, FXP.e_pp, FXP.e_chorus, FXP.e_tube, FXP.e_air, FXP.e_sat, FXP.e_lofi],
      '🎼 Harmonies': [FXP.h_tierce, FXP.h_quinte, FXP.h_double, FXP.h_oct],
    };
    const lib = h('div');
    for (const cat in CATS) {
      lib.append(h('div', { style: { fontSize: '12px', fontWeight: '800', color: '#c9b6ff', margin: '6px 0 8px', letterSpacing: '.04em' } }, cat.toUpperCase()));
      const grid = h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', marginBottom: '12px' } });
      for (const p of CATS[cat]) grid.append(h('div.preset', { onclick: () => { const i = +sel.value; if (!tracks[i]) { toast('Choisis une piste voix.', 'bad'); return; } applyPresetTo(i, p); } },
        h('div.pav', p.emo), h('div', { style: { minWidth: '0' } }, h('b', p.name), h('div.po', 'clic = appliquer'))));
      lib.append(grid);
    }
    const left = h('div.panel',
      h('div.ph', '📚 Répertoire de presets', h('span.r', 'clique pour appliquer')),
      h('div.pb', { style: { maxHeight: 'calc(100vh - 200px)', overflow: 'auto' } },
        h('div', { style: { display: 'flex', gap: '9px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Piste cible :'), sel, status,
          h('button.rbtn', { onclick: () => playBuffer(tracks[+sel.value]?.buffer) }, '▶'),
          h('button.rbtn', { onclick: () => { stopPreview(); revertTrack(tracks[+sel.value], { textContent: '' }); } }, '↩ Original')),
        lib));
    const projPanel = h('div.panel', h('div.ph', '🗂️ Mes projets'), h('div.pb'));
    const pbox = projPanel.querySelector('.pb');
    for (const p of state.projects || []) pbox.append(h('div.ditem' + (p.id === projectId ? '.on' : ''), { style: { marginBottom: '4px' }, onclick: () => { state.projectId = p.id; localStorage.setItem('studio.project', p.id); location.hash = '#/regie'; } }, `${p.icon || '🗂️'} ${p.name}`));
    root.append(h('div.grid', { style: { gridTemplateColumns: '1fr 280px' } }, left, h('div', { style: { display: 'grid', gap: '12px', alignContent: 'start' } }, projPanel)));
    return root;
  }

  function viewIA() {
    const root = h('div');
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i) }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curTrack = () => tracks[+sel.value];
    const status = h('div.muted', { style: { fontSize: '11px', minHeight: '15px', marginTop: '6px' } }, vt.length ? 'Choisis une piste et clique « Nettoyer & mixer ».' : 'Enregistre d’abord une voix (onglet Enregistrement).');
    const analysisBox = h('div.pb', { style: { fontSize: '12.5px' } }, h('p.muted', 'Clique « Analyser » pour mesurer ta voix.'));
    const PROPS_META = { natural: { emo: '🫧', name: 'Naturelle', obj: 'Propre, timbre respecté' }, premium: { emo: '🎧', name: 'Pro (recommandé)', obj: 'Dense, présente, prête au mix' }, modern: { emo: '🚀', name: 'Moderne', obj: 'Plus brillante et ferme' } };

    async function doAnalyze() {
      const t = curTrack(); if (!t?.buffer) { toast('Choisis une piste voix.', 'bad'); return; }
      status.textContent = 'Analyse de la voix…';
      try {
        const m = analyzeVoix(t); let lufs = null; try { lufs = Math.round((await loudness(t.original || t.buffer)) * 10) / 10; } catch {}
        const rows = [
          ['Niveau crête', `${m.peakDb} dBFS`],
          ['Niveau moyen', `${m.rmsDb} dBFS`],
          ['Dynamique', `${m.crestDb} dB${m.crestDb > 18 ? ' (très dynamique)' : m.crestDb < 8 ? ' (compressée)' : ''}`],
          ['Saturation', m.clipPct > 0.01 ? `${m.clipPct} % ⚠️` : 'aucune'],
          ['Sifflantes (estim.)', m.brightness > 0.6 ? 'fortes' : m.brightness > 0.35 ? 'moyennes' : 'faibles'],
          ['Graves/plosives', m.lowRatio > 0.5 ? 'présentes' : 'maîtrisées'],
          m.resonanceHz ? ['Résonance', `vers ${m.resonanceHz} Hz`] : null,
          lufs != null ? ['Sonie', `${lufs} LUFS`] : null,
        ].filter(Boolean);
        analysisBox.innerHTML = rows.map(x => `<div style="display:flex;margin-bottom:8px"><span class="muted">${x[0]}</span><b style="margin-left:auto;color:#bff5db">${x[1]}</b></div>`).join('');
        status.textContent = 'Analyse terminée ✓';
      } catch (e) { status.textContent = 'Analyse impossible'; toastErr(e); }
    }

    // cartes des 3 rendus réels
    const propCards = h('div.grid', { style: { gridTemplateColumns: 'repeat(3,1fr)' } });
    const rebuildCards = () => {
      propCards.innerHTML = '';
      const t = curTrack();
      const props = t?.buffer ? buildVoiceProposals(analyzeVoix(t), 'rap') : [];
      for (const id of ['natural', 'premium', 'modern']) {
        const prop = props.find(p => p.id === id) || { id, name: PROPS_META[id].name, settings: {} };
        const meta = PROPS_META[id];
        const card = h('div.vcard' + (id === 'premium' ? '' : ''), id === 'premium' ? { style: { borderColor: 'var(--rpur)', boxShadow: '0 0 14px rgba(168,85,247,.3)' } } : {},
          h('h4', `${meta.emo} ${meta.name}`), h('p', meta.obj),
          h('div', { style: { display: 'flex', gap: '5px' } },
            h('button.rbtn', { style: { flex: '1', fontSize: '11px' }, onclick: async () => { const tt = curTrack(); if (!tt) return; status.textContent = `Préparation « ${meta.name} »…`; try { playBuffer(await buildProposal(tt, +sel.value, prop, status)); status.textContent = `▶ ${meta.name}`; } catch (e) { toastErr(e); } } }, '▶ Écouter'),
            h('button.rbtn' + (id === 'premium' ? '.p' : ''), { style: { flex: '1', fontSize: '11px' }, onclick: () => applyCleanMix(curTrack(), +sel.value, prop, status) }, '✓ Appliquer')));
        propCards.append(card);
      }
    };
    sel.onchange = () => { rebuildCards(); analysisBox.innerHTML = '<p class="muted">Clique « Analyser » pour mesurer ta voix.</p>'; };

    const premiumProp = () => buildVoiceProposals(analyzeVoix(curTrack()), 'rap').find(p => p.id === 'premium');
    root.append(h('div.grid', { style: { gridTemplateColumns: '1.25fr 1fr' } },
      h('div.panel', { style: { display: 'flex', flexDirection: 'column' } },
        h('div.ph', '🧠 Ingé son IA — assistant en direct', h('span.r', { style: { color: '#bff5db' } }, 'RÉEL · voix + texte · 0 €')),
        h('div.pb', { style: { flex: '1' } },
          h('div', { style: { display: 'flex', gap: '10px', marginBottom: '12px' } }, h('div.orb'),
            h('div.msg.ai', { style: { margin: '0' } }, 'Parle-moi ou écris-moi, je pilote le studio : « enregistre »… « stop » · « nettoie ma voix » · « mets un autotune léger » · « monte la voix de 2 dB » · « mixe et masterise » · « télécharge ». Clique « Mains libres » pour me parler.')),
          ast ? h('div', { style: { marginBottom: '12px' } }, ast.card) : h('p.muted', 'Assistant indisponible dans ce navigateur.'),
          h('div', { style: { display: 'flex', gap: '9px', alignItems: 'center', margin: '4px 0 6px', flexWrap: 'wrap' } },
            h('span.muted', { style: { fontSize: '12px' } }, 'Piste :'), sel,
            h('button.rbtn', { onclick: doAnalyze }, '🔎 Analyser')),
          h('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '6px' } },
            h('button.rbtn.g', { style: { padding: '10px 16px', fontWeight: '800' }, onclick: () => { const p = premiumProp(); p && applyCleanMix(curTrack(), +sel.value, p, status); } }, '✨ Nettoyer & mixer ma voix'),
            h('button.rbtn', { onclick: () => { const t = curTrack(); playBuffer(t?.original || t?.buffer); } }, '▶ Avant'),
            h('button.rbtn', { onclick: () => playBuffer(curTrack()?.buffer) }, '▶ Après'),
            h('button.rbtn', { onclick: () => stopPreview() }, '⏹'),
            h('button.rbtn', { onclick: () => revertTrack(curTrack(), status) }, '↩ Original')),
          status,
          h('div.muted', { style: { fontSize: '10px', marginTop: '10px', lineHeight: '1.4' } }, 'Tout se calcule en local, gratuitement. La voix brute est toujours conservée (bouton Original). « Avant/Après » pour comparer.'))),
      h('div', { style: { display: 'grid', gap: '12px', alignContent: 'start' } },
        h('div.panel', h('div.ph', '🎯 Analyse de ta voix', h('span.r', { style: { color: '#bff5db' } }, 'mesures réelles')), analysisBox),
        h('div.panel', h('div.ph', '✨ 3 rendus (adaptés à ta voix)'), h('div.pb', propCards)))));
    rebuildCards();
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
    if (cur === 'fx' && k !== 'fx') stopLive();
    stopPreview(); closeMenu();
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
    h('span.rpill', h('span.dot'), 'Moteur local · 0 € · build LIVE6'));

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
  try { ast = mountAssistant(buildAssistantS()); } catch (e) { ast = null; }
  renderSidebar();
  renderTabs();
  go(cur);

  // nettoyage
  return () => { stopPlay(); stopAllRec(); stopPreview(); stopLive(); closeMenu(); try { ast?.destroy?.(); } catch {} };
}

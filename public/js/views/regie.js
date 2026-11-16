// Régie Pro — nouvelle page isolée (phase 1 : la coquille + la Timeline réelle).
// NON destructive : lit le MÊME projet que la page Enregistrement (IndexedDB « rec:<projet> »),
// affiche de VRAIES formes d'onde (drawWave) et joue un vrai mix local. 100 % local, 0 €.
// Les autres onglets sont des APERÇUS visuels de la maquette validée, clairement signalés,
// avec un lien vers les pages réelles existantes — ils seront câblés aux phases suivantes.
import { h, state, toast, toastErr, currentProject, audioCtx, pickLocalFiles, startRecorder, downloadBlob, confirmBox } from '../lib/core.js';
import { getItem, putItem, unpackBuffer, packBuffer } from '../lib/session.js';
import { decodeBlob, drawWave, denoise, antipop, voiceChain, normalize, loudness, encodeWav, master, cloneBuffer } from '../lib/audio.js';
import { applyChain, detectPitch, detectKey, keyName, KEY_CHOICES, PRESETS, PRESET_CATS } from '../lib/voicefx.js';
import { analyzeSamples, buildVoiceProposals, antipopFor } from '../lib/ingexpert.js';
import { scoreVoice } from '../lib/voicescore.js';
import { mountAssistant } from './assistant.js';
import { knob } from '../lib/knob.js';
import { expertFace } from '../lib/expertface.js';

// ---------------------------------------------------------------- styles (tout préfixé .regie)
const CSS = `
.regie{--rbg:#070711;--rpan:#13132a;--rpan2:#181833;--rline:#262348;--rpur:#a855f7;--rpur2:#7c3aed;--rcy:#22d3ee;--rpk:#ec4899;--rgr:#34e39a;--rgold:#f0b429;--rtxt:#eceefc;--rmut:#8a8fb5;
  flex:1;min-height:0;display:grid;grid-template-columns:250px 1fr;grid-template-rows:50px 1fr 56px;
  color:var(--rtxt);background:radial-gradient(1100px 650px at 72% -12%,rgba(124,58,237,.20),transparent 55%),radial-gradient(800px 560px at -5% 112%,rgba(34,211,238,.12),transparent 55%),var(--rbg);
  font-family:'Segoe UI',system-ui,-apple-system,sans-serif;transition:grid-template-columns .2s}
.regie.collapsed{grid-template-columns:60px 1fr}
.regie *{box-sizing:border-box}
/* curseur personnalisé : un micro (studio vocal) */
.regie{cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Crect x='9' y='2' width='8' height='13' rx='4' fill='%23a855f7' stroke='%2322d3ee' stroke-width='1.4'/%3E%3Cpath d='M6 12 a7 7 0 0 0 14 0' fill='none' stroke='%2322d3ee' stroke-width='1.7'/%3E%3Cpath d='M13 19 L13 24 M9 24 L17 24' stroke='%2322d3ee' stroke-width='1.7' stroke-linecap='round'/%3E%3C/svg%3E") 13 3, auto}
.regie input,.regie textarea{cursor:text}
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
.regie .rbtn{width:auto;height:auto;min-height:32px;display:inline-flex;align-items:center;justify-content:center;gap:5px;box-shadow:none;padding:7px 12px;border-radius:9px;font-size:12.5px;font-weight:700;background:transparent;border:1px solid var(--rline);color:#d2d5f0;cursor:pointer;flex:none;white-space:nowrap}
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
.regie .thead{width:150px;flex:none;position:sticky;left:0;z-index:5;border-radius:11px;padding:8px 9px;background:#111128;border:1px solid var(--rline);border-left:4px solid var(--tc,#888)}
.regie .thead .nm{font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.regie .thead .ctrls{display:flex;gap:4px;margin-top:7px}
.regie .tbtn{width:23px;height:21px;border-radius:6px;background:#1b1b38;border:1px solid var(--rline);font-size:10px;font-weight:800;display:grid;place-items:center;color:var(--rmut);cursor:pointer}
.regie .tbtn.on.m{background:rgba(34,211,238,.2);color:var(--rcy);border-color:rgba(34,211,238,.5)}
.regie .tbtn.on.s{background:rgba(245,180,41,.22);color:var(--rgold);border-color:rgba(245,180,41,.5)}
.regie .tbtn.del:hover{background:rgba(239,68,68,.25);color:#ff8a8a;border-color:rgba(239,68,68,.5)}
.regie .selh{position:absolute;top:0;bottom:0;width:10px;background:#22d3ee;opacity:.85;border-radius:3px}
.regie .selh.l{left:-6px}.regie .selh.r{right:-6px}
.regie.seltouch .lane{touch-action:none}
.regie .selbox{position:absolute;top:0;bottom:0;background:rgba(34,211,238,.18);border-left:2px solid #22d3ee;border-right:2px solid #22d3ee;z-index:3;pointer-events:none}
.regie .lane{touch-action:pan-x pan-y;user-select:none;cursor:text}
.regie .selbar{display:none;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--rline);background:rgba(34,211,238,.07)}
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
.rgmenu{position:fixed;z-index:9999;max-height:calc(100vh - 12px);overflow-y:auto;min-width:210px;background:linear-gradient(180deg,#15152e,#0d0d1c);border:1px solid #2a2752;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.6);padding:6px;color:#eceefc;font-family:'Segoe UI',system-ui,sans-serif;animation:rgpop .12s}
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
.regie .rmain{position:relative;overflow:hidden}
.regie .rpane{display:flex;flex-direction:column;height:100%;background:linear-gradient(180deg,#0e0e20,#0a0a14)}
.regie .rpaneh{display:flex;align-items:center;gap:10px;padding:12px 16px;font-weight:800;border-bottom:1px solid var(--rline);background:linear-gradient(180deg,rgba(168,85,247,.16),transparent);flex:none}
.regie .rpanebody{flex:1;overflow:auto;padding:16px}
.regie .rgwin{position:absolute;min-width:240px;min-height:90px;max-width:98%;background:linear-gradient(180deg,#13132b,#0c0c18);border:1px solid #2a2752;border-radius:14px;box-shadow:0 22px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;resize:both}
.regie .rgwin.min{height:auto!important;min-height:0;resize:none}
.regie .rgwin.min .rgwbody{display:none}
.regie .rgwin::after{content:'';position:absolute;right:2px;bottom:2px;width:12px;height:12px;border-right:2px solid rgba(255,255,255,.25);border-bottom:2px solid rgba(255,255,255,.25);border-radius:0 0 4px 0;pointer-events:none}
.regie .rgwh{display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:grab;background:linear-gradient(180deg,rgba(168,85,247,.25),transparent);font-size:13px;font-weight:700;user-select:none;border-bottom:1px solid rgba(255,255,255,.07);flex:none}
.regie .rgwh:active{cursor:grabbing}
.regie .rgwbody{padding:12px;overflow:auto;flex:1}
.regie .rgwbtn{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;background:#1b1b38;border:1px solid var(--rline);cursor:pointer;font-size:12px;flex:none}
.regie .rgwbtn:hover{background:#2a2658}
.regie .section{margin-bottom:12px;border:1px solid #221f45;border-radius:14px;overflow:hidden;background:linear-gradient(180deg,#101024,#0b0b16)}
.regie .secth{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;font-size:14px;font-weight:700;user-select:none;background:linear-gradient(180deg,rgba(168,85,247,.12),transparent)}
.regie .secth:hover{background:linear-gradient(180deg,rgba(168,85,247,.2),transparent)}
.regie .secth .chev{margin-left:auto;color:var(--rmut);font-size:12px;transition:transform .15s}
.regie .secbody{padding:12px}
.regie .secbody.closed{display:none}
/* ===== La Zone : espace IA pleine largeur, sans colonne écrasée ===== */
.regie .la-zone-workspace{width:100%;min-width:0;min-height:100%;padding:clamp(10px,1.4vw,20px)}
.regie .la-zone-workspace>.la-zone-main-grid{width:100%;min-width:0;grid-template-columns:minmax(0,1.2fr) minmax(380px,.8fr)!important;gap:14px}
.regie .la-zone-workspace>.la-zone-main-grid>.panel{min-width:0;width:100%}
.regie .la-zone-workspace .pb{min-width:0}
.regie .la-zone-workspace .vcard{min-width:0}
.regie .la-zone-workspace .vcard .rbtn{white-space:normal}
@media(max-width:1100px){
 .regie .la-zone-workspace>.la-zone-main-grid{grid-template-columns:minmax(0,1fr)!important}
}
@media(min-width:1500px){
 .regie .la-zone-workspace>.la-zone-main-grid{grid-template-columns:minmax(0,1.3fr) minmax(420px,.7fr)!important;gap:18px}
 .regie .la-zone-workspace>.la-zone-main-grid>.panel{min-height:100%}
}
@media(max-width:1050px){.regie{grid-template-columns:60px 1fr}.regie .rbrand{width:0}}
/* ===== plan de travail : tuiles redimensionnables qui se réorganisent (jamais cachées) ===== */
.regie .rwork{height:100%;overflow-y:auto;overflow-x:hidden;padding:12px;display:flex;flex-wrap:wrap;gap:12px;align-content:flex-start;background:#060610}
.regie .rwork::-webkit-scrollbar{width:9px}.regie .rwork::-webkit-scrollbar-thumb{background:#242146;border-radius:9px}
.regie .rtile{position:relative;display:flex;flex-direction:column;background:linear-gradient(180deg,#0e0e20,#0a0a14);border:1px solid var(--rline);border-radius:12px;overflow:hidden;min-height:150px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
.regie .rtile.free{box-shadow:0 0 0 1px var(--rpur),0 14px 36px rgba(0,0,0,.55)}
.regie .rgrip{position:absolute;z-index:6;touch-action:none}
.regie .rg-e{top:38px;right:0;width:14px;height:calc(100% - 38px);cursor:ew-resize}
.regie .rg-w{top:38px;left:0;width:12px;height:calc(100% - 38px);cursor:ew-resize}
.regie .rg-s{left:0;bottom:0;height:14px;width:100%;cursor:ns-resize}
.regie .rg-se{right:0;bottom:0;width:22px;height:22px;cursor:nwse-resize;z-index:7}
.regie .rgrip:hover{background:rgba(168,85,247,.22)}
/* poignées VISIBLES : petite barre d'accroche (bord droit = étirer la longueur) */
.regie .rg-e::after{content:'';position:absolute;top:50%;right:3px;transform:translateY(-50%);width:4px;height:42px;border-radius:3px;background:rgba(168,85,247,.55);box-shadow:0 0 8px rgba(168,85,247,.4)}
.regie .rg-s::after{content:'';position:absolute;left:50%;bottom:3px;transform:translateX(-50%);height:4px;width:42px;border-radius:3px;background:rgba(168,85,247,.55);box-shadow:0 0 8px rgba(168,85,247,.4)}
.regie .rg-e:hover::after,.regie .rg-s:hover::after{background:var(--rcy);box-shadow:0 0 10px var(--rcy)}
.regie .rg-se::after{content:'';position:absolute;right:4px;bottom:4px;width:10px;height:10px;border-right:2px solid rgba(34,211,238,.7);border-bottom:2px solid rgba(34,211,238,.7)}
.regie .rtile.s{flex:1 1 300px;max-width:380px}
.regie .rtile.m{flex:1 1 440px;max-width:600px}
.regie .rtile.l{flex:3 1 640px}
.regie .rtile.xl{flex:1 1 100%}
.regie .rtileh{display:flex;align-items:center;gap:8px;padding:8px 10px;background:linear-gradient(180deg,rgba(168,85,247,.16),#0c0c1c);border-bottom:1px solid var(--rline);cursor:grab;user-select:none;touch-action:none}
.regie .rtileh:active{cursor:grabbing}
.regie .rtileh .rgrab{color:var(--rmut);font-size:13px;cursor:grab;flex:none}
.regie .rtile.dragging{opacity:.82;box-shadow:0 0 0 2px var(--rcy),0 24px 60px rgba(0,0,0,.6);z-index:20}
.regie .rtile.dropzone{outline:2px dashed rgba(34,211,238,.5);outline-offset:-4px}
.regie .rtileh b{font-size:13px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.regie .rtileb{flex:1;overflow:hidden;position:relative}
.regie .rtfit{padding:16px;transform-origin:top left}
.regie .rtsz{display:flex;gap:3px}
.regie .rtsz span{width:24px;height:21px;display:grid;place-items:center;border:1px solid var(--rline);border-radius:5px;font-size:11px;cursor:pointer;color:var(--rmut);background:#0d0d1e;line-height:1}
.regie .rtsz span:hover{color:#fff}
.regie .rtsz span.on{color:#fff;border-color:var(--rpur);background:rgba(168,85,247,.25)}
.regie .rtx{cursor:pointer;color:var(--rmut);font-size:15px;padding:0 6px;border-radius:5px}
.regie .rtx:hover{color:#fff;background:rgba(236,72,153,.3)}
.regie .rtile.flash{animation:rtfl .9s ease}
@keyframes rtfl{0%,100%{box-shadow:0 10px 30px rgba(0,0,0,.45)}35%{box-shadow:0 0 0 2px var(--rpur),0 0 26px rgba(168,85,247,.55)}}
.regie .rwempty{margin:auto;text-align:center;color:var(--rmut);font-size:13px;padding:30px;line-height:1.5}
/* ===== fond noir bord à bord + espace maximal quand la Régie est active ===== */
body.regie-max .topbar{display:none!important}
body.regie-max #view,body.regie-max .view{padding:0!important;background:#060610}
body.regie-max{background:#060610}
`;

function injectCss() {
  if (!document.getElementById('regie-css-live33')) {
    ['regie-css', 'regie-css-live25', 'regie-css-live26', 'regie-css-live27', 'regie-css-live28', 'regie-css-live29', 'regie-css-live30', 'regie-css-live31', 'regie-css-live32'].forEach(id => document.getElementById(id)?.remove());
    const s = document.createElement('style');
    s.id = 'regie-css-live33'; s.textContent = CSS; document.head.append(s);
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
  const PPS_MIN = 10, PPS_MAX = 3000;
  let pxPerSec = Math.max(PPS_MIN, Math.min(PPS_MAX, Number(localStorage.getItem('regie.pps')) || 80)); // zoom horizontal
  let selRange = null;      // sélection : { i (piste), a, b } en secondes sur la timeline
  let zoomLblEl = null, zoomRangeEl = null, selBarEl = null;
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
  // Dessine seulement le morceau [t0, t1] (s) d'un buffer : évite les canvas géants
  // qui restaient vides quand on zoomait (limite navigateur ~32 000 px).
  function drawSegment(canvas, buffer, t0, t1, color) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), hg = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = w; canvas.height = hg;
    const g = canvas.getContext('2d'); g.clearRect(0, 0, w, hg); g.fillStyle = color;
    const d = buffer.getChannelData(0), sr = buffer.sampleRate;
    const s0 = Math.floor(t0 * sr), s1 = Math.min(d.length, Math.ceil(t1 * sr)), per = (s1 - s0) / w;
    for (let x = 0; x < w; x++) {
      const a = s0 + Math.floor(x * per), b = Math.max(a + 1, s0 + Math.floor((x + 1) * per));
      let mn = 1, mx = -1;
      for (let k = a; k < b && k < d.length; k++) { const v = d[k]; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (mx < mn) continue;
      g.fillRect(x, ((1 - mx) / 2) * hg, 1, Math.max(1, ((mx - mn) / 2) * hg));
    }
  }
  const TILE = 1500; // largeur (px) d'un morceau de forme d'onde
  // Morceaux de forme d'onde : seuls ceux visibles (± 800 px) sont dessinés,
  // calculé à partir du défilement (fiable même aux très forts zooms).
  let waveTiles = [], tilesRaf = 0;
  function tiledWave(clip, t, i, clipW) {
    const color = trackColor(t, i), left = (t.offset || 0) * pxPerSec;
    for (let x = 0; x < clipW; x += TILE) {
      const w = Math.min(TILE, clipW - x);
      const c = h('canvas', { style: { position: 'absolute', left: x + 'px', top: '0', width: w + 'px', height: '100%' } });
      c.width = 1; c.height = 1;
      clip.append(c);
      waveTiles.push({ c, x0: left + x, x1: left + x + w, t0: x / pxPerSec, t1: (x + w) / pxPerSec, buf: t.buffer, color, drawn: false });
    }
  }
  function refreshTiles(container) {
    const sl = (container?.scrollLeft || 0) - 160 - 800, sr = sl + (container?.clientWidth || innerWidth) + 1600;
    const scrolls = !!container && container.scrollWidth > container.clientWidth + 2;
    for (const z of waveTiles) {
      if (!z.c.isConnected) continue;
      const vis = !scrolls || (z.x1 > sl && z.x0 < sr);
      if (vis && !z.drawn) { z.drawn = true; try { drawSegment(z.c, z.buf, z.t0, z.t1, z.color); } catch {} }
      else if (!vis && z.drawn) { z.drawn = false; z.c.width = 1; z.c.height = 1; }
    }
  }

  // ---------- zoom ----------
  function setZoom(next, anchorSec = null, anchorScreenX = null) {
    const sc = laneWrap;
    const ax = anchorScreenX ?? (sc ? sc.clientWidth / 2 : 0);
    const anchor = anchorSec ?? (sc ? Math.max(0, (sc.scrollLeft + ax - 160) / pxPerSec) : 0);
    pxPerSec = Math.max(PPS_MIN, Math.min(PPS_MAX, next));
    try { localStorage.setItem('regie.pps', String(pxPerSec)); } catch {}
    if (zoomLblEl) zoomLblEl.textContent = `${Math.round(pxPerSec)} px/s`;
    if (zoomRangeEl) zoomRangeEl.value = String(Math.round(Math.log(pxPerSec) * 100));
    if (sc) { buildTimeline(sc); sc.scrollLeft = Math.max(0, 160 + anchor * pxPerSec - ax); refreshTiles(sc); }
  }
  function fitZoom() { const sc = laneWrap; const tot = totalDuration(); if (!sc || !tot) return; setZoom((sc.clientWidth - 180) / tot, 0, 0); sc.scrollLeft = 0; refreshTiles(sc); }
  function zoomToSel() { if (!selRange || !laneWrap) return; const len = Math.max(0.05, selRange.b - selRange.a); setZoom((laneWrap.clientWidth - 220) / len); laneWrap.scrollLeft = Math.max(0, 160 + selRange.a * pxPerSec - 30); refreshTiles(laneWrap); }

  // ---------- sélection d'un passage ----------
  const fmtS = (s) => fmtLcd(s);
  let selTouchMode = false; // au doigt : glisser = sélectionner (au lieu de défiler)
  const STEP_MS = [1, 10, 100];
  let nudgeStep = 10;
  function setEdge(which, v) {
    if (!selRange) return;
    const tot = totalDuration();
    if (which === 'a') selRange.a = Math.max(0, Math.min(v, selRange.b - 0.001));
    else selRange.b = Math.min(tot, Math.max(v, selRange.a + 0.001));
    paintSel();
  }
  function paintSelBar() {
    if (!selBarEl) return;
    selBarEl.innerHTML = '';
    if (!selRange || !tracks[selRange.i]) { selBarEl.style.display = 'none'; return; }
    const t = tracks[selRange.i];
    selBarEl.style.display = 'flex';
    const num = (which) => h('input', { type: 'number', step: '0.001', min: '0', value: selRange[which].toFixed(3), title: which === 'a' ? 'Début (secondes)' : 'Fin (secondes)',
      style: { width: '92px', padding: '6px', borderRadius: '8px', background: '#0c0c1a', border: '1px solid var(--rline)', color: 'var(--rtxt)', fontSize: '13px' },
      onchange: (e) => setEdge(which, +e.target.value || 0) });
    const nud = (which, sign) => h('button.rbtn', { title: `${sign < 0 ? 'Reculer' : 'Avancer'} de ${nudgeStep} ms`, onclick: () => setEdge(which, selRange[which] + sign * nudgeStep / 1000) }, sign < 0 ? '◀' : '▶');
    const stepSel = h('select', { title: 'Pas des flèches', style: { width: 'auto', flex: 'none', padding: '6px', borderRadius: '8px', background: '#0c0c1a', border: '1px solid var(--rline)', color: 'var(--rtxt)' }, onchange: (e) => { nudgeStep = +e.target.value; paintSelBar(); } },
      STEP_MS.map(v => h('option', { value: String(v), selected: v === nudgeStep }, `pas ${v} ms`)));
    const grp = (label, which) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } }, h('b', { style: { fontSize: '12px' } }, label), nud(which, -1), num(which), nud(which, 1));
    selBarEl.append(
      h('div', { style: { width: '100%', fontSize: '12px' } }, `Sélection · ${t.name || 'Piste ' + (selRange.i + 1)} · durée ${((selRange.b - selRange.a) * 1000).toFixed(0)} ms`),
      grp('Début', 'a'), grp('Fin', 'b'), stepSel,
      h('div', { style: { width: '100%', display: 'flex', flexWrap: 'wrap', gap: '6px' } },
        h('button.rbtn', { onclick: playSel }, '▶ Écouter'),
        h('button.rbtn', { onclick: zoomToSel }, '🔍 Zoomer dessus'),
        h('button.rbtn', { title: 'Le son monte doucement du silence', onclick: () => editSel('fadein') }, '📈 Fondu entrée'),
        h('button.rbtn', { title: 'Le son descend doucement vers le silence', onclick: () => editSel('fadeout') }, '📉 Fondu sortie'),
        h('button.rbtn', { onclick: () => editSel('gainup') }, '🔊 +3 dB'),
        h('button.rbtn', { onclick: () => editSel('gaindown') }, '🔉 −3 dB'),
        h('button.rbtn', { title: 'Remonte le passage au niveau optimal', onclick: () => editSel('normalize') }, '🎚️ Normaliser'),
        h('button.rbtn', { onclick: () => editSel('silence') }, '🔇 Silence'),
        h('button.rbtn', { style: { borderColor: '#ef4444' }, onclick: () => editSel('cut') }, '✂️ Supprimer'),
        h('button.rbtn', { onclick: () => { selRange = null; paintSel(); } }, '✕')));
  }
  function paintSel() {
    document.querySelectorAll('.regie .selbox').forEach(b => b.remove());
    if (selRange && laneWrap) {
      const lane = laneWrap.querySelectorAll('.lane')[selRange.i];
      if (lane) lane.append(h('div.selbox', { style: { left: (selRange.a * pxPerSec) + 'px', width: Math.max(2, (selRange.b - selRange.a) * pxPerSec) + 'px' } }, h('i.selh.l'), h('i.selh.r')));
    }
    paintSelBar();
  }
  function selSlice() {
    const t = tracks[selRange?.i]; if (!t?.buffer) return null;
    const off = t.offset || 0, sr = t.buffer.sampleRate;
    let s0 = Math.max(0, Math.round((selRange.a - off) * sr)), s1 = Math.min(t.buffer.length, Math.round((selRange.b - off) * sr));
    // cale chaque bord sur le passage à zéro le plus proche (≤ 1 ms, à l'intérieur de la sélection) : coupe sans « clic »
    const d = t.buffer.getChannelData(0), lim = Math.round(sr * 0.001);
    const zc = (pos, dir) => { for (let k = 0; k <= lim; k++) { const q = pos + dir * k; if (q <= 0 || q >= d.length) return pos; if ((d[q - 1] <= 0) !== (d[q] <= 0)) return q; } return pos; };
    if (s1 - s0 > 2 * lim + 2) { s0 = zc(s0, 1); s1 = zc(s1, -1); }
    return s1 > s0 ? { t, s0, s1 } : null;
  }
  function playSel() {
    const z = selSlice(); if (!z) { toast('Rien à écouter dans ce passage.', 'bad'); return; }
    const ctx = audioCtx(), b = z.t.buffer, out = ctx.createBuffer(b.numberOfChannels, z.s1 - z.s0, b.sampleRate);
    for (let c = 0; c < b.numberOfChannels; c++) out.getChannelData(c).set(b.getChannelData(c).subarray(z.s0, z.s1));
    playBuffer(out);
  }
  async function editSel(mode) {
    const z = selSlice(); if (!z) { toast('Ce passage ne contient pas d’audio.', 'bad'); return; }
    const ctx = audioCtx(), b = z.t.buffer, n = z.s1 - z.s0;
    const len = mode === 'cut' ? b.length - n : b.length;
    if (len < 1) { toast('Impossible : la piste serait vide. Supprime plutôt la piste.', 'bad'); return; }
    const out = ctx.createBuffer(b.numberOfChannels, len, b.sampleRate);
    const clip = (v) => v > 1 ? 1 : v < -1 ? -1 : v;
    const g = mode === 'gainup' ? 1.4125 : mode === 'gaindown' ? 0.7079 : 1; // ±3 dB
    // pic de la sélection pour « normaliser »
    let peak = 0;
    if (mode === 'normalize') for (let c = 0; c < b.numberOfChannels; c++) { const s = b.getChannelData(c); for (let k = z.s0; k < z.s1; k++) { const a = Math.abs(s[k]); if (a > peak) peak = a; } }
    const normG = mode === 'normalize' ? (peak > 1e-4 ? 0.97 / peak : 1) : 1;
    const denom = Math.max(1, n - 1);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const src = b.getChannelData(c), dst = out.getChannelData(c);
      if (mode === 'cut') { dst.set(src.subarray(0, z.s0), 0); dst.set(src.subarray(z.s1), z.s0); continue; }
      dst.set(src);
      if (mode === 'silence') dst.fill(0, z.s0, z.s1);
      else if (mode === 'fadein') for (let k = z.s0; k < z.s1; k++) dst[k] = src[k] * ((k - z.s0) / denom);
      else if (mode === 'fadeout') for (let k = z.s0; k < z.s1; k++) dst[k] = src[k] * (1 - (k - z.s0) / denom);
      else if (mode === 'gainup' || mode === 'gaindown') for (let k = z.s0; k < z.s1; k++) dst[k] = clip(src[k] * g);
      else if (mode === 'normalize') for (let k = z.s0; k < z.s1; k++) dst[k] = clip(src[k] * normG);
    }
    if (!z.t.original) z.t.original = b; // garde la version d'origine pour « Revenir à l'original »
    z.t.buffer = out; proposalCache = {};
    selRange = mode === 'cut' ? null : selRange;
    await save();
    const MSG = { cut: 'Passage supprimé', silence: 'Passage muet', fadein: 'Fondu d’entrée appliqué', fadeout: 'Fondu de sortie appliqué', gainup: 'Passage +3 dB', gaindown: 'Passage −3 dB', normalize: 'Passage normalisé' };
    toast((MSG[mode] || 'Appliqué') + ' ✓', 'ok');
    if (laneWrap) buildTimeline(laneWrap);
  }
  // glisser sur une piste = sélectionner · simple clic = déplacer la tête de lecture
  function bindLane(lane, i) {
    let st = null;
    const posOf = (e) => Math.max(0, Math.min(totalDuration(), (e.clientX - lane.getBoundingClientRect().left) / pxPerSec));
    lane.onpointerdown = (e) => {
      if (e.button !== 0) return;
      const x = e.clientX - lane.getBoundingClientRect().left, touch = e.pointerType === 'touch', grab = touch ? 18 : 8;
      let edge = null;
      if (selRange && selRange.i === i) {
        if (Math.abs(x - selRange.a * pxPerSec) <= grab) edge = 'a';
        else if (Math.abs(x - selRange.b * pxPerSec) <= grab) edge = 'b';
      }
      const selecting = !touch || selTouchMode || edge;
      st = { x0: e.clientX, a: posOf(e), moved: false, touch, edge, selecting, lp: null };
      if (touch && !selecting) st.lp = setTimeout(() => { if (st && !st.moved) { const s = st; st = null; trackMenu(i, { preventDefault() {}, stopPropagation() {}, clientX: s.x0, clientY: e.clientY }); } }, 550);
      if (selecting) { lane.setPointerCapture?.(e.pointerId); if (touch) e.preventDefault(); }
    };
    lane.onpointermove = (e) => {
      if (!st) return;
      if (!st.moved && Math.abs(e.clientX - st.x0) < (st.edge ? 1 : 5)) return;
      if (!st.selecting) { clearTimeout(st.lp); st = null; return; } // au doigt hors mode sélection : glisser = défiler
      st.moved = true;
      const p = posOf(e);
      if (st.edge) setEdge(st.edge, p);
      else { selRange = { i, a: Math.min(st.a, p), b: Math.max(st.a, p) }; paintSel(); }
    };
    lane.onpointerup = () => {
      if (!st) return; clearTimeout(st.lp);
      const s = st; st = null;
      if (s.moved || s.edge) return;
      const pos = s.a;
      if (selRange) { selRange = null; paintSel(); }
      if (playing) { stopPlay(); startPlay(pos); } else movePlayhead(pos);
      startOffset = pos;
    };
    lane.onpointercancel = () => { if (st) clearTimeout(st.lp); st = null; };
  }
  function buildTimeline(container) {
    container.innerHTML = '';
    waveTiles = waveTiles.filter(z => z.c.isConnected && !container.contains(z.c));
    container.onscroll = () => { cancelAnimationFrame(tilesRaf); tilesRaf = requestAnimationFrame(() => refreshTiles(container)); };
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
      const dB = h('span.tbtn.del', { title: 'Supprimer la piste' }, '🗑');
      dB.onclick = (e) => { e.stopPropagation(); deleteTrackIdx(i); };
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
        h('div.ctrls', mB, sB, aB, dB),
        vol, h('div.lab', 'Vol', volLab),
        pan, h('div.lab', 'Pan', panLab));

      const lane = h('div.lane', { style: { '--beat': beat + 'px', width: laneW + 'px', flex: '0 0 ' + laneW + 'px' } });
      if (t.buffer) {
        const clipW = Math.max(8, Math.round(t.buffer.duration * pxPerSec));
        const clip = h('div.clip', { style: { left: ((t.offset || 0) * pxPerSec) + 'px', width: clipW + 'px' } });
        lane.append(clip);
        // dessin par morceaux, seulement la partie visible (marche à tous les zooms)
        tiledWave(clip, t, i, clipW); clip.append(h('div.cnm', t.name || ''));
      }
      // glisser = sélectionner un passage · clic = placer la tête de lecture
      bindLane(lane, i);
      head.oncontextmenu = (e) => trackMenu(i, e);
      lane.oncontextmenu = (e) => trackMenu(i, e);
      head.title = 'Clic droit : nettoyer, effets, volume, supprimer…';
      rows.append(h('div.trk', { style: { width: (160 + laneW) + 'px' } }, head, lane));
    });
    rows.append(playheadEl);
    container.append(rows);
    // bouton ajouter / importer
    container.append(h('div', { style: { display: 'flex', gap: '10px', marginTop: '6px' } },
      h('button.rbtn', { onclick: importTrack, style: { width: '158px' } }, '➕ Importer une piste')));
    movePlayhead(startOffset);
    if (container === laneWrap) paintSel();
    requestAnimationFrame(() => refreshTiles(container));
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
      refreshViews(); renderSidebar();
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
      refreshViews(); renderSidebar();
      if (recViaAssistant) { recViaAssistant = false; try { ast?.onRecordStopped?.(); } catch {} }
    } catch (e) { toastErr(e); }
  }
  function stopAllRec() { try { rec?.stop(); } catch {} rec = null; recording = false; stopMon(); try { instruSrc?.stop(); } catch {} instruSrc = null; clearInterval(metroTimer); }

  // ---------- Auto-Tune RÉEL (réutilise applyChain + détection de tonalité) ----------
  const atOpt = { speed: 60, strength: 1, formant: 0, key: '', mode: 'dure', humanize: 0.25, glide: 30, keep: 0.15 };
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
      const step = atOpt.mode === 'douce'
        ? { t: 'tune', mode: 'notes', strength: atOpt.strength, keep: atOpt.keep, glide: atOpt.glide, humanize: atOpt.humanize, formant: atOpt.formant }
        : { t: 'tune', strength: atOpt.strength, speed: atOpt.speed, formant: atOpt.formant };
      const res = await applyChain(src, [step], { key: parseKey(atOpt.key), onProgress: (m) => status.textContent = m });
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
  let exporting = false;
  async function exportMix() {
    if (exporting) return; if (!tracks.some(t => t.buffer)) { toast('Aucune piste à exporter.', 'bad'); return; }
    exporting = true; toast('Préparation de l’export (mix + master)…');
    try { await doMasterExport('streaming', true); toast('🎧 Export WAV téléchargé ✓', 'ok'); }
    catch (e) { toastErr(e); } finally { exporting = false; }
  }

  // ---------- Assistant ingé expert EN DIRECT (voix + texte + actions réelles) ----------
  let ast = null, recViaAssistant = false, selVoixIdx = -1;
  const lastVoixIdx = () => { let idx = -1; tracks.forEach((t, i) => { if (!isInstru(t)) idx = i; }); return idx; };
  const defVoix = () => (selVoixIdx >= 0 && tracks[selVoixIdx] && !isInstru(tracks[selVoixIdx])) ? selVoixIdx : lastVoixIdx();
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
    ['Voix grave', '🧔', [{ t: 'shift', semi: -5, formant: -2 }]],
    ['Voix aiguë', '🐿️', [{ t: 'shift', semi: 5, formant: 2 }]],
    ['Voix enfant', '🧒', [{ t: 'shift', semi: 7, formant: 3 }]],
    ['Voix géant', '👹', [{ t: 'shift', semi: -8, formant: -3 }]],
    ['Chipmunk', '🐹', [{ t: 'shift', semi: 12, formant: 4 }]],
    ['Présence', '🔆', [{ t: 'fx', kind: 'peak', f: 3000, q: 1, gain: 4 }]],
    ['Chaleur grave', '🟤', [{ t: 'fx', kind: 'peak', f: 150, q: 0.8, gain: 3 }]],
    ['Mégaphone', '📣', [{ t: 'fx', kind: 'band', lo: 600, hi: 3500, drive: 4 }, { t: 'fx', kind: 'distort', amt: 3, tone: 6000 }]],
    ['Cathédrale', '⛪', [{ t: 'fx', kind: 'reverb', size: 5, mix: 0.4 }]],
    ['Room', '🚪', [{ t: 'fx', kind: 'reverb', size: 0.8, mix: 0.2 }]],
    ['Slapback', '↩️', [{ t: 'fx', kind: 'delay', time: 0.12, fb: 0.15, mix: 0.25 }]],
    ['Dub echo', '🔊', [{ t: 'fx', kind: 'delay', time: 0.45, fb: 0.55, mix: 0.35 }]],
    ['Vinyle', '💿', [{ t: 'fx', kind: 'lofi', bits: 9, hi: 8000 }, { t: 'fx', kind: 'tape', amt: 2 }]],
    ['T-Pain', '🎙️', [{ t: 'tune', strength: 1, speed: 0 }, { t: 'fx', kind: 'air', gain: 4 }]],
    ['Travis', '🌌', [{ t: 'tune', strength: 1, speed: 10 }, { t: 'fx', kind: 'reverb', size: 2.5, mix: 0.3 }]],
    ['Ange', '😇', [{ t: 'harmony', steps: [4, 7] }, { t: 'fx', kind: 'reverb', size: 3, mix: 0.3 }]],
    ['Doubleur large', '👬', [{ t: 'double', steps: [0, 0], gain: 0.6 }, { t: 'fx', kind: 'chorus', mix: 0.3 }]],
    ['Trap 808', '🔊', [{ t: 'fx', kind: 'warm' }, { t: 'fx', kind: 'air', gain: 3 }]],
    ['Drill sombre', '🌑', [{ t: 'tune', strength: 1, speed: 8 }, { t: 'fx', kind: 'peak', f: 200, q: 1, gain: 2 }]],
    ['Old school', '🧢', [{ t: 'fx', kind: 'band', lo: 300, hi: 5000, drive: 2 }, { t: 'fx', kind: 'tape', amt: 2 }]],
    ['Clean pro', '💎', [{ t: 'fx', kind: 'air', gain: 3 }, { t: 'fx', kind: 'peak', f: 3000, q: 1, gain: 2 }]],
    ['Nasillard', '👃', [{ t: 'fx', kind: 'peak', f: 1200, q: 2, gain: 5 }]],
    ['Sous-marin', '🌊', [{ t: 'fx', kind: 'band', lo: 200, hi: 1500, drive: 1 }, { t: 'fx', kind: 'reverb', size: 3, mix: 0.3 }]],
    ['Stade', '🏟️', [{ t: 'fx', kind: 'reverb', size: 4.5, mix: 0.45 }, { t: 'fx', kind: 'delay', time: 0.3, fb: 0.3, mix: 0.2 }]],
    ['Chuchotement', '🤫', [{ t: 'fx', kind: 'air', gain: 5 }, { t: 'fx', kind: 'peak', f: 200, q: 1, gain: -4 }]],
    ['Monstre', '😈', [{ t: 'shift', semi: -10, formant: -4 }, { t: 'fx', kind: 'distort', amt: 2, tone: 5000 }]],
    ['Fée', '🧚', [{ t: 'shift', semi: 8, formant: 3 }, { t: 'fx', kind: 'reverb', size: 2.5, mix: 0.3 }]],
    ['Double octave', '🎚️', [{ t: 'double', steps: [-12, 12], gain: 0.4 }]],
    ['Vintage', '🎞️', [{ t: 'fx', kind: 'tape', amt: 3 }, { t: 'fx', kind: 'lofi', bits: 10, hi: 9000 }]],
  ];
  async function processPreset(src, p) { let cur = src; if (p.chain) cur = (await applyChain(cur, p.chain)).buffer; if (p.voice) cur = await voiceChain(cur, p.voice); return cur; }
  let busyFx = false;
  // AUDITION : chaque preset repart de la voix D'ORIGINE (il REMPLACE le précédent, ne s'empile pas),
  // puis s'écoute tout de suite. Tu essaies autant d'options que tu veux ; celle que tu gardes est validée,
  // « ↩ Original » efface tout. (Pour cumuler volontairement : bouton « + Cumuler ».)
  async function applyPresetTo(i, p, opt) {
    const t = tracks[i]; if (!t?.buffer) return;
    if (busyFx) { toast('Un traitement est déjà en cours…'); return; } busyFx = true;
    toast(`${p.emo} ${p.name}…`);
    try {
      if (!t.original) t.original = t.buffer;
      const base = (opt && opt.cumuler) ? t.buffer : t.original;   // par défaut : depuis l'original
      const out = await processPreset(base, p);
      t.buffer = out;
      t.fxDone = (opt && opt.cumuler) ? [...(t.fxDone || []), p.name] : [p.name];
      proposalCache = {}; await save();
      toast(`${p.name} ✓ — écoute`, 'ok'); refreshViews();
      if (!opt || opt.play !== false) { try { stopPreview(); playBuffer(out); } catch {} }
    }
    catch (e) { toastErr(e); } finally { busyFx = false; }
  }
  async function quickCleanIdx(i) { const t = tracks[i]; if (!t) return; const p = buildVoiceProposals(analyzeVoix(t), 'rap').find(z => z.id === 'premium'); if (busyFx) return; busyFx = true; try { await applyCleanMix(t, i, p, null); refreshViews(); } finally { busyFx = false; } }
  function quickRevertIdx(i) { const t = tracks[i]; if (t?.original) { t.buffer = t.original; t.fxDone = []; proposalCache = {}; save(); toast('Original rétabli', 'ok'); refreshViews(); } }
  function adjustVol(i, d) { const t = tracks[i]; if (!t) return; t.gainDb = Math.max(-30, Math.min(12, (t.gainDb || 0) + d)); save(); refreshViews(); }
  function toggleMuteIdx(i) { const t = tracks[i]; if (!t) return; t.mute = !t.mute; save(); refreshViews(); }
  function toggleSoloIdx(i) { const t = tracks[i]; if (!t) return; t.solo = !t.solo; save(); refreshViews(); }
  async function deleteTrackIdx(i) { const t = tracks[i]; if (!t) return; if (!(await confirmBox(`Supprimer la piste « ${t.name || 'Piste ' + (i + 1)} » ?`, 'Supprimer', true))) return; tracks.splice(i, 1); proposalCache = {}; await save(); toast('Piste supprimée', 'ok'); refreshViews(); renderSidebar(); }

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
      { label: '🗑️ Supprimer la piste', danger: true, fn: () => deleteTrackIdx(i) },
      '-',
    ];
    if (selRange && selRange.i === i) items.push(
      { head: `Sélection ${fmtS(selRange.a)} → ${fmtS(selRange.b)}` },
      { label: '▶ Écouter la sélection', fn: playSel },
      { label: '🔍 Zoomer sur la sélection', fn: zoomToSel },
      { label: '📈 Fondu d’entrée (du bas vers le haut)', fn: () => editSel('fadein') },
      { label: '📉 Fondu de sortie (du haut vers le bas)', fn: () => editSel('fadeout') },
      { label: '🔊 Monter ce passage (+3 dB)', fn: () => editSel('gainup') },
      { label: '🔉 Baisser ce passage (−3 dB)', fn: () => editSel('gaindown') },
      { label: '🎚️ Normaliser ce passage', fn: () => editSel('normalize') },
      { label: '🔇 Rendre muet ce passage', fn: () => editSel('silence') },
      { label: '✂️ Supprimer ce passage', danger: true, fn: () => editSel('cut') },
      '-');
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
    showMenu(ev.clientX, ev.clientY, items);
  }

  // ---------- RACK LIVE : écouter et régler EN DIRECT ----------
  const LF = { vol: 0, hp: 85, low: 0, mid: 2.5, high: 3, comp: 0.4, compAtk: 5, compRel: 120, reverb: 0.1, delay: 0, drive: 0 };
  let live = null, eqRedraw = null;
  function makeImpulse(ctx, dur = 1.8, decay = 3) { const len = Math.floor(ctx.sampleRate * dur); const imp = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); } return imp; }
  function driveCurve(amount) { const k = amount * 60, n = 1024, curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); } return curve; }
  function liveSet(k, v) {
    LF[k] = v;
    if (['hp', 'low', 'mid', 'high'].includes(k)) { try { eqRedraw && eqRedraw(); } catch {} }
    if (!live) return; const n = live.nodes, now = live.ctx.currentTime, T = (p, val) => p.setTargetAtTime(val, now, 0.02);
    if (k === 'vol') T(n.master.gain, 10 ** (v / 20));
    else if (k === 'hp') T(n.hp.frequency, v);
    else if (k === 'low') T(n.low.gain, v);
    else if (k === 'mid') T(n.mid.gain, v);
    else if (k === 'high') T(n.high.gain, v);
    else if (k === 'comp') { T(n.comp.threshold, -10 - v * 20); T(n.comp.ratio, 2 + v * 4); T(n.makeup.gain, 10 ** ((v * 6) / 20)); }
    else if (k === 'compAtk') { try { n.comp.attack.value = v / 1000; } catch {} }
    else if (k === 'compRel') { try { n.comp.release.value = v / 1000; } catch {} }
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
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10 - LF.comp * 20; comp.ratio.value = 2 + LF.comp * 4; comp.attack.value = LF.compAtk / 1000; comp.release.value = LF.compRel / 1000; comp.knee.value = 6;
    const drive = ctx.createWaveShaper(); drive.curve = driveCurve(LF.drive); drive.oversample = '2x';
    const makeup = ctx.createGain(); makeup.gain.value = 10 ** ((LF.comp * 6) / 20);
    const master = ctx.createGain(); master.gain.value = 10 ** (LF.vol / 20);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6; master.connect(analyser);
    const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx); const revG = ctx.createGain(); revG.gain.value = LF.reverb;
    const dl = ctx.createDelay(1.0); dl.delayTime.value = 0.3; const fb = ctx.createGain(); fb.gain.value = 0.3; const delG = ctx.createGain(); delG.gain.value = LF.delay;
    src.connect(hp).connect(low).connect(mid).connect(high).connect(comp).connect(drive).connect(makeup);
    makeup.connect(master);
    makeup.connect(revG); revG.connect(conv).connect(master);
    makeup.connect(delG); delG.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(master);
    master.connect(ctx.destination);
    src.start();
    live = { ctx, src, analyser, nodes: { hp, low, mid, high, comp, drive, makeup, master, conv, revG, dl, fb, delG, analyser }, i };
    return true;
  }
  function stopLive() { if (!live) return; try { live.src.stop(); } catch {} try { Object.values(live.nodes).forEach(n => n.disconnect && n.disconnect()); } catch {} live = null; }
  const liveKnobEl = (label, key, min, max, step, def, fmt) => knob({ label, min, max, step, value: LF[key], def, fmt, onInput: (v) => liveSet(key, v) }).el;
  // courbe d'égaliseur qui réagit en direct aux molettes
  function makeEqCurve() {
    const box = h('div', { style: { height: '96px', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--rline)', background: '#0b0b1a', marginBottom: '10px' } });
    const redraw = () => {
      const y = (db) => Math.max(6, Math.min(90, 48 - db * 3));
      const lo = y(LF.low).toFixed(1), mi = y(LF.mid).toFixed(1), hi = y(LF.high).toFixed(1);
      box.innerHTML = `<svg viewBox="0 0 500 96" preserveAspectRatio="none" style="width:100%;height:100%"><defs><linearGradient id="eqg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a855f7" stop-opacity=".5"/><stop offset="1" stop-color="#a855f7" stop-opacity="0"/></linearGradient></defs><line x1="0" y1="48" x2="500" y2="48" stroke="#2a2750" stroke-width="1"/><path d="M0 ${lo} C110 ${lo} 150 ${mi} 250 ${mi} C350 ${mi} 400 ${hi} 500 ${hi} L500 96 L0 96 Z" fill="url(#eqg2)"/><path d="M0 ${lo} C110 ${lo} 150 ${mi} 250 ${mi} C350 ${mi} 400 ${hi} 500 ${hi}" fill="none" stroke="#c98bff" stroke-width="2.2"/><circle cx="110" cy="${lo}" r="5" fill="#22d3ee"/><circle cx="250" cy="${mi}" r="5" fill="#ec4899"/><circle cx="400" cy="${hi}" r="5" fill="#a855f7"/></svg>`;
    };
    redraw();
    return { el: box, redraw };
  }
  // spectrogramme temps réel (lié au lecteur live)
  function viridis(v) { v = Math.max(0, Math.min(1, v)); const r = Math.round(255 * Math.min(1, Math.max(0, 1.4 * v - 0.2))); const g = Math.round(255 * Math.min(1, Math.max(0, 1.6 * v - 0.1))); const b = Math.round(255 * Math.min(1, Math.max(0, 1 - 1.6 * Math.abs(v - 0.35)))); return [r + 20 * (1 - v) | 0, g, Math.max(b, 30 + 60 * (1 - v)) | 0]; }
  function makeSpectro(h2 = 128) {
    const cv = h('canvas'); cv.width = 640; cv.height = h2;
    cv.style.cssText = `width:100%;height:${h2}px;display:block;border-radius:10px;background:#06030f;border:1px solid var(--rline)`;
    const g = cv.getContext('2d'); g.fillStyle = '#06030f'; g.fillRect(0, 0, cv.width, cv.height);
    let raf = 0; const data = new Uint8Array(512);
    const loop = () => {
      if (!cv.isConnected) { cancelAnimationFrame(raf); raf = 0; return; }
      const img = g.getImageData(1, 0, cv.width - 1, cv.height); g.putImageData(img, 0, 0);
      const x = cv.width - 1;
      if (live && live.analyser) {
        const n = live.analyser.frequencyBinCount; live.analyser.getByteFrequencyData(data);
        for (let y = 0; y < cv.height; y++) { const f = Math.pow(y / cv.height, 1.8); const bin = Math.min(n - 1, Math.floor(f * n)); const c = viridis(data[bin] / 255); g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(x, cv.height - 1 - y, 1, 1); }
      } else { g.fillStyle = '#06030f'; g.fillRect(x, 0, 1, cv.height); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return cv;
  }
  // clavier (piano) pour choisir la tonalité de l'auto-tune
  const NOTE_NAMES = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  function pianoEl(getMode, onPick) {
    const row = h('div', { style: { display: 'flex', gap: '3px', height: '74px', marginTop: '6px' } });
    const keys = [];
    NOTE_NAMES.forEach((nm, root) => {
      const black = nm.includes('♯');
      const k = h('div', { style: { flex: black ? '0.72' : '1', borderRadius: '0 0 6px 6px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '5px', fontSize: '9px', fontWeight: '800', cursor: 'pointer', border: '1px solid #05060c', background: black ? 'linear-gradient(180deg,#1b1b32,#0a0a16)' : 'linear-gradient(180deg,#eceafc,#b9b3d9)', color: black ? '#aab0d8' : '#2a2440', transition: 'box-shadow .1s' }, onclick: () => { onPick(root, nm); highlight(root); } }, nm);
      keys.push(k); row.append(k);
    });
    function highlight(root) { keys.forEach((k, i) => { const on = i === root; k.style.boxShadow = on ? '0 0 12px #a855f7, inset 0 0 10px rgba(168,85,247,.5)' : 'none'; }); }
    return { el: row, highlight };
  }
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
    const zoomOut = h('button.rbtn', { onclick: () => setZoom(pxPerSec / 1.5), title: 'Dézoomer' }, '🔍−');
    const zoomIn = h('button.rbtn', { onclick: () => setZoom(pxPerSec * 1.5), title: 'Zoomer (jusqu’à la syllabe)' }, '🔍+');
    zoomLblEl = h('span.muted', { style: { minWidth: '62px', textAlign: 'center', fontSize: '12px' } }, `${Math.round(pxPerSec)} px/s`);
    zoomRangeEl = h('input', { type: 'range', min: String(Math.round(Math.log(PPS_MIN) * 100)), max: String(Math.round(Math.log(PPS_MAX) * 100)), value: String(Math.round(Math.log(pxPerSec) * 100)), title: 'Zoom précis', style: { width: '120px', accentColor: '#a855f7' },
      oninput: (e) => setZoom(Math.exp(+e.target.value / 100)) });
    wrap.append(h('div.ph', { style: { flexWrap: 'wrap', gap: '6px' } }, '🎵 Timeline multipiste',
      h('span.r', `${tracks.length} piste(s) · ${fmtLcd(totalDuration()).replace(/\.\d+$/, '')} · projet « ${proj.name} »`),
      h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
        zoomOut, zoomRangeEl, zoomIn, zoomLblEl,
        h('button.rbtn', { onclick: fitZoom, title: 'Voir tout le morceau' }, '↔ Tout voir'),
        (() => { const b = h('button.rbtn', { title: 'Au doigt : glisser sélectionne au lieu de défiler' }, '✋ Doigt : défiler');
          const paint = () => { b.textContent = selTouchMode ? '⬚ Doigt : sélectionner' : '✋ Doigt : défiler'; b.classList.toggle('p', selTouchMode); document.querySelector('.regie')?.classList.toggle('seltouch', selTouchMode); };
          b.onclick = () => { selTouchMode = !selTouchMode; paint(); }; setTimeout(paint, 0); return b; })(),
        h('button.rbtn.p', { onclick: () => startPlay(startOffset) }, '▶ Lire'),
        h('button.rbtn', { onclick: () => { stopPlay(); movePlayhead(0); startOffset = 0; } }, '⏹'))));
    selBarEl = h('div.selbar');
    wrap.append(selBarEl);
    wrap.append(h('div.muted', { style: { fontSize: '11px', padding: '4px 12px' } }, 'Astuces : glisse sur une piste pour sélectionner un passage · clic = placer la lecture · Ctrl + molette = zoom · clic droit (ou appui long) = menu · touche Suppr = supprimer le passage · tire les poignées bleues pour ajuster au millimètre · flèches = déplacer la fin (Ctrl = le début, Alt = 1 ms, Maj = 100 ms)'));
    const body = h('div.pb', { style: { flex: '1', overflow: 'auto' }, tabIndex: 0 });
    // Ctrl + molette (ou pincer sur pavé tactile) = zoom autour de la souris
    body.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return; e.preventDefault();
      const r = body.getBoundingClientRect(), ax = e.clientX - r.left;
      setZoom(pxPerSec * (e.deltaY < 0 ? 1.25 : 0.8), Math.max(0, (body.scrollLeft + ax - 160) / pxPerSec), ax);
    }, { passive: false });
    body.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRange) { e.preventDefault(); editSel('cut'); }
      else if (e.key === 'Escape' && selRange) { selRange = null; paintSel(); }
      else if (selRange && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.altKey ? 1 : e.shiftKey ? 100 : 10) / 1000; setEdge(e.ctrlKey || e.metaKey ? 'a' : 'b', selRange[e.ctrlKey || e.metaKey ? 'a' : 'b'] + d); }
    });
    wrap.append(body);
    laneWrap = body;
    setTimeout(() => buildTimeline(body), 0);
    return wrap;
  }

  const scoreColor = (s) => s === 'ok' ? '#34e39a' : s === 'warn' ? '#f0b429' : '#ef4444';
  // ===== Dashboard : TOUT sur une seule page =====
  function viewRegie() {
    const root = h('div');
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i), selected: x.i === defVoix() }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curIdx = () => +sel.value;
    const vi = lastVoixIdx(); const vtr = vi >= 0 ? tracks[vi] : null;
    let m = null, sc = { overall: null, items: [] };
    if (vtr?.buffer) { try { m = analyzeSamples((vtr.original || vtr.buffer).getChannelData(0), vtr.buffer.sampleRate); sc = scoreVoice(m); } catch {} }
    const ov = sc.overall;
    const gauge = `<svg viewBox="0 0 96 96" style="width:92px;height:92px;flex:none"><circle cx="48" cy="48" r="40" fill="none" stroke="#1b1440" stroke-width="9"/><circle cx="48" cy="48" r="40" fill="none" stroke="${ov == null ? '#3a3a55' : scoreColor(ov >= 80 ? 'ok' : ov >= 60 ? 'warn' : 'bad')}" stroke-width="9" stroke-linecap="round" stroke-dasharray="251" stroke-dashoffset="${251 - 251 * (ov || 0) / 100}" transform="rotate(-90 48 48)" style="filter:drop-shadow(0 0 7px currentColor)"/><text x="48" y="54" text-anchor="middle" font-size="22" font-weight="800" fill="#fff">${ov == null ? '—' : ov + '%'}</text></svg>`;
    const items = sc.items.length ? sc.items.map(it => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;font-size:12.5px"><span style="width:15px;height:15px;border-radius:50%;background:${scoreColor(it.status)};flex:none"></span><span style="flex:1">${it.label}</span><b>${it.pct}%</b></div>`).join('') : '<p class="muted" style="font-size:12px">Enregistre/importe une voix pour l’analyser.</p>';
    const peakPct = m ? Math.min(100, Math.max(0, (m.peakDb + 40) / 40 * 100)) : 0;
    const rmsPct = m ? Math.min(100, Math.max(0, (m.rmsDb + 50) / 50 * 100)) : 0;
    // visage de La Rue, ingénieur du son
    let face = null; try { face = expertFace(); } catch {}
    // lecture live
    const playBtn = h('button.rbtn.p', { style: { whiteSpace: 'nowrap', fontWeight: '800' } }, '▶ Jouer');
    const refreshPlay = () => { playBtn.textContent = live ? '⏹ Stop' : '▶ Jouer'; };
    playBtn.onclick = () => { if (live) stopLive(); else startLive(curIdx()); refreshPlay(); };
    sel.onchange = () => { if (live) { startLive(curIdx()); refreshPlay(); } };

    // ROW 1 : La Rue | Analyse | Niveaux
    const marcoPanel = h('div.panel', h('div.ph', '🧠 Ingé son IA — La Rue', h('span.r', { style: { color: '#bff5db' } }, 'assistant')),
      h('div.pb', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
        face ? face.el : h('div.orb'),
        h('div', { style: { flex: '1' } },
          h('div.msg.ai', { style: { margin: '0 0 10px' } }, 'Parle-moi ou écris-moi, je pilote le studio et je mixe ta voix.'),
          h('button.rbtn.p', { style: { width: '100%' }, onclick: () => go('ia') }, 'Ouvrir l’ingé IA →'))));
    const analysePanel = h('div.panel', { html: `<div class="ph">📊 Analyse vocale <span class="r" style="color:#bff5db">réel</span></div><div class="pb" style="display:flex;gap:12px;align-items:center">${gauge}<div style="flex:1">${items}</div></div>` });
    const nivPanel = h('div.panel', { html: `<div class="ph">🎚️ Niveaux</div><div class="pb"><div style="display:flex;gap:9px;align-items:center;font-size:11px;margin-bottom:9px"><span class="muted" style="width:40px">Crête</span><div style="flex:1;height:9px;border-radius:5px;background:#141230;overflow:hidden"><i style="display:block;height:100%;width:${peakPct}%;background:linear-gradient(90deg,#34e39a,#f0b429 72%,#ef4444)"></i></div><b>${m ? m.peakDb : '—'}</b></div><div style="display:flex;gap:9px;align-items:center;font-size:11px;margin-bottom:9px"><span class="muted" style="width:40px">Moyen</span><div style="flex:1;height:9px;border-radius:5px;background:#141230;overflow:hidden"><i style="display:block;height:100%;width:${rmsPct}%;background:linear-gradient(90deg,#34e39a,#f0b429 72%,#ef4444)"></i></div><b>${m ? m.rmsDb : '—'}</b></div><div style="text-align:center;background:#0d1702;border:1px solid #2a4a10;border-radius:9px;padding:8px"><b style="font-size:19px;color:#bff5db">${m ? m.crestDb : '—'}</b><div class="muted" style="font-size:9px">DYNAMIQUE (dB)</div></div></div>` });
    root.append(h('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' } },
      h('button.rbtn.g', { style: { fontWeight: '800' }, onclick: () => exportMix() }, '📤 Exporter le mix (WAV)'),
      h('button.rbtn', { onclick: () => go('rec') }, '🎙️ Enregistrer'),
      h('button.rbtn', { onclick: () => go('fx') }, '🎛️ Effets & molettes'),
      h('button.rbtn', { onclick: () => go('ia') }, '🧠 Ingé IA')));
    root.append(h('div.grid', { style: { gridTemplateColumns: '1.2fr 1.2fr 150px' } }, marcoPanel, analysePanel, nivPanel));
    root.append(h('div.panel', { style: { marginTop: '12px' } }, h('div.ph', '🌈 Spectrogramme', h('span.r', { style: { color: '#bff5db' } }, 'temps réel pendant la lecture')), h('div.pb', makeSpectro(110))));
    void playBtn; void curIdx;
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
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i), selected: x.i === defVoix() }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curIdx = () => +sel.value;
    const playBtn = h('button.rbtn.p', { style: { fontWeight: '800', whiteSpace: 'nowrap' } }, '▶ Jouer');
    const refreshPlay = () => { playBtn.textContent = live ? '⏹ Stop' : '▶ Jouer'; };
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
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i), selected: x.i === defVoix() }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curTrack = () => tracks[+sel.value];
    const keyLabel = h('b', { style: { color: '#bff5db' } }, '—');
    const keySel = h('select', { style: selStyle(), onchange: (e) => { atOpt.key = e.target.value; } }, KEY_CHOICES.map(k => h('option', { value: k.v }, k.label)));
    const status = h('div.muted', { style: { fontSize: '11px', minHeight: '15px', marginTop: '6px' } }, '');
    const kSpeed = knob({ label: 'RETUNE', min: 0, max: 200, step: 5, value: atOpt.speed, def: 60, fmt: v => `${v | 0} ms`, onInput: v => atOpt.speed = v });
    const kStr = knob({ label: 'FORCE', min: 0, max: 1, step: 0.05, value: atOpt.strength, def: 1, fmt: pcF, onInput: v => atOpt.strength = v });
    const kFor = knob({ label: 'FORMANT', min: -4, max: 4, step: 1, value: atOpt.formant, def: 0, fmt: v => `${v > 0 ? '+' : ''}${v}`, onInput: v => atOpt.formant = v });
    const kHum = knob({ label: 'HUMANIZE', min: 0, max: 1, step: 0.05, value: atOpt.humanize, def: 0.25, fmt: pcF, onInput: v => atOpt.humanize = v });
    const kGli = knob({ label: 'GLISSANDO', min: 0, max: 200, step: 5, value: atOpt.glide, def: 30, fmt: v => `${v | 0} ms`, onInput: v => atOpt.glide = v });
    const kKeep = knob({ label: 'NATUREL', min: 0, max: 0.8, step: 0.05, value: atOpt.keep, def: 0.15, fmt: pcF, onInput: v => atOpt.keep = v });
    // type de correction : dure (robot/net) ou douce (naturel, notes)
    const typeChips = [['dure', 'Dure (net)'], ['douce', 'Douce (naturel)']].map(([mm, lab]) => { const c = h('span.chip' + (mm === atOpt.mode ? '.on' : ''), lab); c.onclick = () => { atOpt.mode = mm; typeChips.forEach(x => x.classList.toggle('on', x === c)); }; return c; });
    const presets = [['Naturel', { mode: 'douce', strength: 0.9, keep: 0.25, glide: 60, humanize: 0.4 }], ['Pop', { mode: 'dure', strength: 1, speed: 60 }], ['R&B', { mode: 'douce', strength: 1, keep: 0.12, glide: 30, humanize: 0.2 }], ['Trap mélo', { mode: 'dure', strength: 1, speed: 15 }], ['Hard (robot)', { mode: 'dure', strength: 1, speed: 0 }]];
    const presetRow = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '4px 0 10px' } },
      presets.map(([nm, p]) => h('span.chip', { onclick: () => { Object.assign(atOpt, p); kStr.set(atOpt.strength, false); kSpeed.set(atOpt.speed, false); kHum.set(atOpt.humanize, false); kGli.set(atOpt.glide, false); kKeep.set(atOpt.keep, false); typeChips.forEach(x => x.classList.toggle('on', x.textContent.toLowerCase().startsWith(atOpt.mode === 'dure' ? 'dure' : 'douce'))); toast(`Preset « ${nm} » chargé`); } }, nm)));
    // gamme + clavier (piano) pour choisir la tonalité
    let mode = 'mineur';
    const modeChips = ['mineur', 'majeur'].map(mm => { const c = h('span.chip' + (mm === mode ? '.on' : ''), mm === 'mineur' ? 'Mineure' : 'Majeure'); c.onclick = () => { mode = mm; modeChips.forEach(x => x.classList.toggle('on', x === c)); if (atOpt.key) { atOpt.key = atOpt.key.split('|')[0] + '|' + mode; keyLabel.textContent = NOTE_NAMES[+atOpt.key.split('|')[0]] + ' ' + mode; } }; return c; });
    const piano = pianoEl(() => mode, (root, nm) => { atOpt.key = `${root}|${mode}`; keyLabel.textContent = `${nm} ${mode}`; });
    const pianoBox = h('div', { style: { marginTop: '10px' } },
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '2px' } }, h('span.muted', { style: { fontSize: '11px' } }, '🎹 Gamme :'), ...modeChips, h('span.muted', { style: { fontSize: '11px', marginLeft: 'auto' } }, 'clique une touche = tonalité')),
      piano.el);
    return h('div.panel',
      h('div.ph', h('span', { style: { width: '11px', height: '11px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px #a855f7', flex: 'none' } }), '🎤 Auto-Tune Pro', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'RÉEL')),
      h('div.pb',
        h('div', { style: { display: 'flex', gap: '9px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Piste :'), sel, h('span.muted', { style: { fontSize: '12px' } }, 'Tonalité :'), keyLabel),
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' } }, h('span.muted', { style: { fontSize: '11px' } }, 'Correction :'), ...typeChips),
        presetRow,
        h('div', { style: { display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', margin: '6px 0 4px' } }, kSpeed.el, kStr.el, kHum.el, kGli.el, kKeep.el, kFor.el),
        pianoBox,
        h('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '10px' } },
          h('button.rbtn', { onclick: () => analyzeKey(curTrack(), status, keyLabel) }, '🎹 Détecter la tonalité'),
          h('button.rbtn.p', { onclick: () => applyAutotune(curTrack(), status, keyLabel) }, '✨ Appliquer'),
          h('button.rbtn', { onclick: () => { const t = curTrack(); playBuffer(t?.original || t?.buffer); } }, '▶ Avant'),
          h('button.rbtn', { onclick: () => playBuffer(curTrack()?.buffer) }, '▶ Après'),
          h('button.rbtn', { onclick: () => stopPreview() }, '⏹')),
        status,
        h('div.muted', { style: { fontSize: '10px', marginTop: '8px', lineHeight: '1.4' } }, 'Dure : RETUNE 0 ms = robot, plus de ms = doux. Douce : GLISSANDO = transitions, NATUREL = garde un peu de ta justesse, HUMANIZE = micro-variations. FORMANT = timbre. Choisis la tonalité au piano.')));
  }

  const hzF = (v) => `${v | 0} Hz`;
  function viewFx() {
    const root = h('div');
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i), selected: x.i === defVoix() }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curIdx = () => +sel.value;
    const playBtn = h('button.rbtn.p', { style: { whiteSpace: 'nowrap', fontWeight: '800' } }, '▶ Jouer');
    const refreshPlay = () => { playBtn.textContent = live ? '⏹ Stop' : '▶ Jouer'; };
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
    const eqView = makeEqCurve(); eqRedraw = eqView.redraw;
    const eqPanel = h('div.panel', h('div.ph', h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 7px #3b82f6', flex: 'none' } }), '🎚️ Égaliseur paramétrique', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'LIVE · réactif')),
      h('div.pb', eqView.el,
        h('div', { style: { display: 'flex', justifyContent: 'space-around' } }, liveKnob('GRAVE', 'hp', 40, 160, 5, 85, hzF), liveKnob('LOW', 'low', -6, 6, 0.5, 0, dbF), liveKnob('MID', 'mid', -6, 8, 0.5, 2.5, dbF), liveKnob('AIGU', 'high', -6, 8, 0.5, 3, dbF))));
    const compPanel = h('div.panel', h('div.ph', h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: '#f0b429', boxShadow: '0 0 7px #f0b429', flex: 'none' } }), '🗜️ Compression', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'LIVE')),
      h('div.pb', h('div', { style: { display: 'flex', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: '8px' } }, liveKnob('TAUX', 'comp', 0, 1, 0.05, 0.4, pcF), liveKnob('ATTAQUE', 'compAtk', 1, 80, 1, 5, v => `${v | 0} ms`), liveKnob('RELEASE', 'compRel', 30, 400, 10, 120, v => `${v | 0} ms`), liveKnob('VOLUME', 'vol', -12, 6, 0.5, 0, dbF))));
    const revPanel = h('div.panel', h('div.ph', h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 7px #a855f7', flex: 'none' } }), '🌫️ Réverbe & Delay', h('span.r', { style: { marginLeft: 'auto', color: '#bff5db' } }, 'LIVE')),
      h('div.pb', h('div', { style: { display: 'flex', justifyContent: 'space-around', alignItems: 'center' } }, liveKnob('RÉVERBE', 'reverb', 0, 0.6, 0.02, 0.1, pcF), liveKnob('DELAY', 'delay', 0, 0.5, 0.02, 0, pcF), liveKnob('SATUR.', 'drive', 0, 1, 0.05, 0, pcF))));
    // banque d'effets
    const bank = h('div.panel', h('div.ph', '⭐ Banque d’effets', h('span.r', `${EFFECTS_BANK.length} effets · clic = appliquer`)),
      h('div.pb', h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))', gap: '8px' } },
        EFFECTS_BANK.map(([nm, emo, chain]) => h('div.preset', { style: { flexDirection: 'column', textAlign: 'center', padding: '10px 6px', gap: '4px' }, onclick: () => { const i = curIdx(); if (!tracks[i]) { toast('Choisis une piste voix.', 'bad'); return; } applyPresetTo(i, { emo, name: nm, chain }); } },
          h('div', { style: { fontSize: '20px' } }, emo), h('b', { style: { fontSize: '11px' } }, nm))))));
    const spectro = h('div.panel', h('div.ph', '🌈 Spectrogramme', h('span.r', { style: { color: '#bff5db' } }, 'temps réel pendant la lecture')),
      h('div.pb', makeSpectro(128)));
    root.append(bar, h('div', { style: { height: '12px' } }),
      spectro, h('div', { style: { height: '12px' } }),
      autotunePanel(), h('div', { style: { height: '12px' } }),
      h('div.grid', { style: { gridTemplateColumns: '1.2fr 1fr 1fr' } }, eqPanel, compPanel, revPanel),
      h('div', { style: { height: '12px' } }), bank);
    return root;
  }

  function viewRepo() {
    const root = h('div');
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i), selected: x.i === defVoix() }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
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
    const root = h('div.la-zone-workspace');
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i), selected: x.i === defVoix() }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
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
    root.append(h('div.grid.la-zone-main-grid', { style: { gridTemplateColumns: 'minmax(0, 1.2fr) minmax(380px, .8fr)', width: '100%', alignItems: 'start' } },
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

  // ---------- UNE SEULE PAGE : modules repliables ----------
  // ---------- squelette ----------
  const root = h('div.regie');
  const tabsBar = h('div.rtabs');
  const main = h('div.rmain');
  const side = h('div.rside');

  // ======= BOÎTIERS : fenêtres de modules déplaçables =======
  function winConsole() {
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i), selected: x.i === defVoix() }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curIdx = () => +sel.value;
    const playBtn = h('button.rbtn.p', { style: { whiteSpace: 'nowrap', fontWeight: '800' } }, live ? '⏹ Stop' : '▶ Jouer');
    playBtn.onclick = () => { if (live) stopLive(); else startLive(curIdx()); playBtn.textContent = live ? '⏹ Stop' : '▶ Jouer'; };
    sel.onchange = () => { if (live) startLive(curIdx()); };
    return h('div',
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Piste :'), sel, playBtn,
        h('button.rbtn.g', { onclick: () => bakeLive(curIdx()) }, '💾 Graver'),
        h('button.rbtn', { onclick: () => revertTrack(tracks[curIdx()], { textContent: '' }) }, '↩ Original')),
      h('div', { style: { display: 'flex', justifyContent: 'space-around' } }, liveKnobEl('VOLUME', 'vol', -12, 6, 0.5, 0, dbF), liveKnobEl('SATUR.', 'drive', 0, 1, 0.05, 0, pcF)),
      h('div.muted', { style: { fontSize: '10px', marginTop: '10px', lineHeight: '1.4' } }, 'Lance la lecture, puis ouvre les boîtiers Égaliseur / Compresseur / Réverbe depuis le répertoire : tes molettes changent le son EN DIRECT.'));
  }
  function winEq() { const eqView = makeEqCurve(); eqRedraw = eqView.redraw; return h('div', eqView.el, h('div', { style: { display: 'flex', justifyContent: 'space-around' } }, liveKnobEl('GRAVE', 'hp', 40, 160, 5, 85, hzF), liveKnobEl('LOW', 'low', -6, 6, 0.5, 0, dbF), liveKnobEl('MID', 'mid', -6, 8, 0.5, 2.5, dbF), liveKnobEl('AIGU', 'high', -6, 8, 0.5, 3, dbF))); }
  function winComp() { return h('div', { style: { display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '10px' } }, liveKnobEl('TAUX', 'comp', 0, 1, 0.05, 0.4, pcF), liveKnobEl('ATTAQUE', 'compAtk', 1, 80, 1, 5, v => `${v | 0} ms`), liveKnobEl('RELEASE', 'compRel', 30, 400, 10, 120, v => `${v | 0} ms`), liveKnobEl('VOLUME', 'vol', -12, 6, 0.5, 0, dbF)); }
  function winRev() { return h('div', { style: { display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: '10px' } }, liveKnobEl('RÉVERBE', 'reverb', 0, 0.6, 0.02, 0.1, pcF), liveKnobEl('DELAY', 'delay', 0, 0.5, 0.02, 0, pcF), liveKnobEl('SATUR.', 'drive', 0, 1, 0.05, 0, pcF)); }
  const emojiOf = (cat) => { const m = (cat || '').match(/^(\p{Extended_Pictographic})/u); return m ? m[1] : '🎛️'; };
  function winBank() {
    const vt = voixTracks();
    const sel = h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i), selected: x.i === defVoix() }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix'));
    const curIdx = () => +sel.value;
    let cumuler = false;
    const catSel = h('select', { style: selStyle() }, h('option', { value: '' }, `Toutes les catégories (${PRESETS.length})`), ...PRESET_CATS.map(c => h('option', { value: c }, `${c} (${PRESETS.filter(p => p.cat === c).length})`)));
    const count = h('span.muted', { style: { fontSize: '11px' } }, '');
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '8px' } });
    const search = h('input', { placeholder: '🔎 Rechercher (nom ou style)…', style: { ...selStyle(), flex: '1', minWidth: '160px' } });
    const fill = () => {
      const q = (search.value || '').trim().toLowerCase(), cat = catSel.value;
      grid.innerHTML = '';
      const list = PRESETS.filter(p => (!cat || p.cat === cat) && (!q || p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q)));
      count.textContent = `${list.length} preset${list.length > 1 ? 's' : ''}`;
      for (const p of list) grid.append(h('div.preset', { title: p.cat, style: { flexDirection: 'column', textAlign: 'center', padding: '10px 6px', gap: '4px' }, onclick: () => { const i = curIdx(); if (!tracks[i]) { toast('Choisis une piste voix.', 'bad'); return; } applyPresetTo(i, { emo: emojiOf(p.cat), name: p.name, chain: p.chain, voice: p.voice }, { cumuler }); } },
        h('div', { style: { fontSize: '18px' } }, emojiOf(p.cat)), h('b', { style: { fontSize: '10.5px', lineHeight: '1.2' } }, p.name)));
    };
    search.oninput = fill; catSel.onchange = fill;
    const cumChip = h('span.chip', '➕ Cumuler : non');
    cumChip.onclick = () => { cumuler = !cumuler; cumChip.classList.toggle('on', cumuler); cumChip.textContent = cumuler ? '➕ Cumuler : OUI' : '➕ Cumuler : non'; };
    fill();
    return h('div',
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Piste :'), sel,
        h('button.rbtn', { onclick: () => { const t = tracks[curIdx()]; stopPreview(); playBuffer(t?.original || t?.buffer); } }, '▶ Avant'),
        h('button.rbtn', { onclick: () => { stopPreview(); playBuffer(tracks[curIdx()]?.buffer); } }, '▶ Après'),
        h('button.rbtn', { onclick: () => stopPreview() }, '⏹'),
        h('button.rbtn', { onclick: () => { stopPreview(); quickRevertIdx(curIdx()); } }, '↩ Original')),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' } }, catSel, search, cumChip, count),
      h('p.muted', { style: { fontSize: '10.5px', margin: '0 0 8px', lineHeight: '1.4' } }, 'Clique un preset : tu l’entends tout de suite. Chaque essai REMPLACE le précédent (tu auditionnes tranquillement). « Cumuler : OUI » pour les empiler. « ↩ Original » efface tout.'),
      grid);
  }
  const winSpectro = () => makeSpectro(150);
  // helpers boîtiers
  const trackSel = () => { const vt = voixTracks(); return h('select', { style: selStyle() }, vt.length ? vt.map(x => h('option', { value: String(x.i), selected: x.i === defVoix() }, x.t.name || `Piste ${x.i + 1}`)) : h('option', { value: '' }, 'Aucune piste voix')); };
  const selRow = (sel) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Piste :'), sel);
  const btnRow = (arr) => h('div', { style: { display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '10px' } }, arr.map(([l, fn, cls]) => h('button.rbtn' + (cls ? '.' + cls : ''), { onclick: fn }, l)));
  async function applyChainTo(t, chain, label, status) {
    if (!t?.buffer) { toast('Choisis une piste voix.', 'bad'); return; }
    if (busyFx) return; busyFx = true; if (status) status.textContent = 'Traitement…';
    try { const res = await applyChain(t.buffer, chain); if (!t.original) t.original = t.buffer; t.buffer = res.buffer; t.fxDone = [...(t.fxDone || []), label]; proposalCache = {}; await save(); if (status) status.textContent = '✓ Appliqué — écoute « Après »'; toast(`${label} appliqué ✓`, 'ok'); refreshViews(); }
    catch (e) { toastErr(e); if (status) status.textContent = 'Erreur'; } finally { busyFx = false; }
  }
  function winPitch() {
    const sel = trackSel(); const cur = () => tracks[+sel.value]; const status = h('div.muted', { style: { fontSize: '11px', minHeight: '14px', marginTop: '6px' } }, '');
    let semi = 0, formant = 0;
    const kSemi = knob({ label: 'HAUTEUR', min: -12, max: 12, step: 1, value: 0, def: 0, fmt: v => `${v > 0 ? '+' : ''}${v} st`, onInput: v => semi = v });
    const kFor = knob({ label: 'FORMANT', min: -5, max: 5, step: 1, value: 0, def: 0, fmt: v => `${v > 0 ? '+' : ''}${v}`, onInput: v => formant = v });
    return h('div', selRow(sel), h('div', { style: { display: 'flex', gap: '18px', justifyContent: 'center', margin: '8px 0' } }, kSemi.el, kFor.el),
      btnRow([['✨ Appliquer', () => applyChainTo(cur(), [{ t: 'shift', semi, formant }], 'hauteur', status), 'p'], ['▶ Avant', () => { const t = cur(); playBuffer(t?.original || t?.buffer); }], ['▶ Après', () => playBuffer(cur()?.buffer)], ['⏹', () => stopPreview()], ['↩ Original', () => quickRevertIdx(+sel.value)]]), status,
      h('div.muted', { style: { fontSize: '10px', marginTop: '8px' } }, 'Change la hauteur sans toucher le tempo (±12 demi-tons). FORMANT change le grain de la voix.'));
  }
  function winHarmo() {
    const sel = trackSel(); const cur = () => tracks[+sel.value]; const status = h('div.muted', { style: { fontSize: '11px', minHeight: '14px', marginTop: '6px' } }, '');
    const opts = { tierce: true, quinte: false, octave: false, double: false }; let level = 0.45;
    const chips = [['tierce', 'Tierce'], ['quinte', 'Quinte'], ['octave', 'Octave ↑'], ['double', 'Doublage']].map(([k, l]) => { const c = h('span.chip' + (opts[k] ? '.on' : ''), l); c.onclick = () => { opts[k] = !opts[k]; c.classList.toggle('on', opts[k]); }; return c; });
    const kLev = knob({ label: 'NIVEAU', min: 0.1, max: 0.8, step: 0.05, value: 0.45, def: 0.45, fmt: pcF, onInput: v => level = v });
    const apply = () => { const chain = []; const steps = []; if (opts.tierce) steps.push(2); if (opts.quinte) steps.push(4); if (steps.length) chain.push({ t: 'harmony', steps, gain: level }); if (opts.octave) chain.push({ t: 'double', steps: [12], gain: level * 0.7 }); if (opts.double) chain.push({ t: 'double', steps: [0, 0], gain: level }); if (!chain.length) { toast('Choisis au moins une harmonie.', 'bad'); return; } applyChainTo(cur(), chain, 'harmonies', status); };
    return h('div', selRow(sel), h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '8px 0' } }, ...chips), h('div', { style: { display: 'flex', justifyContent: 'center' } }, kLev.el),
      btnRow([['✨ Appliquer', apply, 'p'], ['▶ Après', () => playBuffer(cur()?.buffer)], ['⏹', () => stopPreview()], ['↩ Original', () => quickRevertIdx(+sel.value)]]), status);
  }
  function winDeess() {
    const sel = trackSel(); const cur = () => tracks[+sel.value]; const status = h('div.muted', { style: { fontSize: '11px', minHeight: '14px', marginTop: '6px' } }, '');
    let dose = 4, freq = 6800;
    const kDose = knob({ label: 'DOSE', min: 0, max: 10, step: 0.5, value: 4, def: 4, fmt: v => `-${v} dB`, onInput: v => dose = v });
    const kFreq = knob({ label: 'FRÉQ', min: 4000, max: 10000, step: 200, value: 6800, def: 6800, fmt: v => `${(v / 1000).toFixed(1)}k`, onInput: v => freq = v });
    return h('div', selRow(sel), h('div', { style: { display: 'flex', gap: '18px', justifyContent: 'center', margin: '8px 0' } }, kDose.el, kFreq.el),
      btnRow([['✨ Appliquer', () => applyChainTo(cur(), [{ t: 'fx', kind: 'peak', f: freq, q: 3, gain: -dose }], 'de-esser', status), 'p'], ['▶ Après', () => playBuffer(cur()?.buffer)], ['⏹', () => stopPreview()], ['↩ Original', () => quickRevertIdx(+sel.value)]]), status,
      h('div.muted', { style: { fontSize: '10px', marginTop: '8px' } }, 'Réduit les sifflantes « sss » en atténuant la zone aiguë choisie.'));
  }
  function winMaster() {
    let preset = 'streaming';
    const chips = [['streaming', 'Streaming'], ['rap', 'Rap'], ['club', 'Club']].map(([k, l]) => { const c = h('span.chip' + (k === preset ? '.on' : ''), l); c.onclick = () => { preset = k; chips.forEach(x => x.classList.toggle('on', x === c)); }; return c; });
    return h('div', h('p.muted', { style: { fontSize: '12px' } }, 'Mixe toutes les pistes + master, puis télécharge le WAV final.'),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', margin: '8px 0' } }, h('span.muted', { style: { fontSize: '12px' } }, 'Rendu :'), ...chips),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button.rbtn.g', { style: { fontWeight: '800' }, onclick: async () => { toast('Mastering + export…'); try { await doMasterExport(preset, true); toast('🎧 Master WAV téléchargé ✓', 'ok'); } catch (e) { toastErr(e); } } }, '📤 Masteriser & télécharger'),
        h('button.rbtn', { onclick: async () => { try { toast('Rendu…'); await doMasterExport(preset, false); if (lastMaster) playBuffer(lastMaster); } catch (e) { toastErr(e); } } }, '▶ Écouter le master')));
  }
  const WINDEF = {
    regie: { t: '🧩 Vue d’ensemble', r: viewRegie, w: 720, h: 430 },
    timeline: { t: '🎵 Timeline', r: viewTimeline, w: 920, h: 380 },
    rec: { t: '🎙️ Enregistrement', r: viewRec, w: 760, h: 450 },
    console: { t: '🎚️ Console live', r: winConsole, w: 440, h: 300 },
    autotune: { t: '🎤 Auto-Tune Pro', r: autotunePanel, w: 600, h: 600 },
    eq: { t: '🎚️ Égaliseur', r: winEq, w: 480, h: 280 },
    comp: { t: '🗜️ Compresseur', r: winComp, w: 470, h: 210 },
    rev: { t: '🌫️ Réverbe & FX', r: winRev, w: 470, h: 210 },
    bank: { t: '⭐ Banque d’effets', r: winBank, w: 660, h: 440 },
    spectro: { t: '🌈 Spectrogramme', r: winSpectro, w: 580, h: 240 },
    repo: { t: '📚 Répertoire', r: viewRepo, w: 660, h: 470 },
    ia: { t: '🧠 Ingé IA', r: viewIA, w: 680, h: 560 },
    pitch: { t: '🎚️ Hauteur / Pitch', r: winPitch, w: 440, h: 300 },
    harmo: { t: '🎼 Harmoniseur', r: winHarmo, w: 470, h: 330 },
    deess: { t: '🧼 De-Esser', r: winDeess, w: 440, h: 300 },
    master: { t: '🏁 Mastering', r: winMaster, w: 500, h: 240 },
  };
  const TAB_ORDER = ['regie', 'timeline', 'rec', 'console', 'autotune', 'eq', 'comp', 'rev', 'deess', 'pitch', 'harmo', 'bank', 'spectro', 'master', 'repo', 'ia'];
  const openWins = {}; let zTop = 10, winOffset = 0;
  function makeWinContent(key) { const el = h('div'); try { el.append(WINDEF[key].r()); } catch (e) { console.error(e); el.append(h('div.notice.bad', 'Erreur : ' + (e && e.message))); } return el; }
  // ===== Plan de travail : des TUILES redimensionnables qui se réorganisent (jamais cachées) =====
  // Le répertoire à gauche POSE un module dans la zone. Chaque tuile a 4 tailles (S/M/L/XL) ;
  // quand on la rapetisse/agrandit, les autres tuiles se réorganisent autour — rien n'est recouvert.
  const SIZES = ['s', 'm', 'l', 'xl'];
  const SZICON = { s: '▪', m: '◧', l: '▬', xl: '■' };
  let curKey = 'regie';
  let openTiles = [];
  const tileSize = {};
  const tileFree = {}; // key -> {w,h} : taille libre réglée à la poignée
  try { const st = JSON.parse(localStorage.getItem('regie.tiles') || 'null'); if (st && Array.isArray(st.open)) { openTiles = st.open.filter(k => WINDEF[k]); Object.assign(tileSize, st.size || {}); Object.assign(tileFree, st.free || {}); } } catch {}
  if (!openTiles.length) openTiles = ['regie'];
  const saveTiles = () => { try { localStorage.setItem('regie.tiles', JSON.stringify({ open: openTiles, size: tileSize, free: tileFree })); } catch {} };
  const tileEl = (key) => main.querySelector('.rtile[data-key="' + key + '"]');
  function applyFree(tile, key) { const f = tileFree[key]; if (f) { SIZES.forEach(c => tile.classList.remove(c)); tile.classList.add('free'); tile.style.flex = '0 0 auto'; tile.style.width = f.w + 'px'; tile.style.height = f.h + 'px'; } }
  // Mise à l'échelle « tout voir » : le contenu se dézoome pour tenir en entier dans la tuile,
  // au lieu d'être coupé. Plus la tuile est petite, plus le module est réduit — mais toujours visible.
  // Seuls les panneaux STATIQUES (molettes) se dézooment pour tout montrer.
  // Les modules INTERACTIFS (clics/glissers sur une forme d'onde, un piano, un canvas)
  // ne doivent JAMAIS être mis à l'échelle : ça décalerait les clics. Eux défilent.
  const SCALABLE = new Set(['eq', 'comp', 'rev', 'pitch', 'harmo', 'deess', 'master', 'console']);
  function fitTile(tile) {
    const body = tile.querySelector('.rtileb'), fitw = tile.querySelector('.rtfit');
    if (!body || !fitw) return;
    if (!SCALABLE.has(tile.dataset.key)) { body.style.overflow = 'auto'; fitw.style.width = ''; fitw.style.transform = 'none'; return; }
    body.style.overflow = 'hidden';
    const availW = body.clientWidth, availH = body.clientHeight;
    if (availW < 4 || availH < 4) return;
    const MINW = 340, layoutW = Math.max(availW, MINW);
    fitw.style.width = layoutW + 'px'; fitw.style.transform = 'none';
    const natH = fitw.scrollHeight || 1;
    const s = Math.min(availW / layoutW, availH / natH, 1);
    fitw.style.transform = s < 0.999 ? 'scale(' + s + ')' : 'none';
  }
  const fitAll = () => { try { main.querySelectorAll('.rtile').forEach(fitTile); } catch {} };
  let fitRAF = 0;
  const fitSoon = () => { cancelAnimationFrame(fitRAF); fitRAF = requestAnimationFrame(fitAll); };

  function buildTile(key) {
    const def = WINDEF[key];
    if (!tileFree[key] && !tileSize[key]) tileSize[key] = 'xl';
    const sz = tileSize[key] || 'xl';
    const tile = h('div.rtile.' + sz, { 'data-key': key });
    const szBtns = SIZES.map(s => h('span' + (!tileFree[key] && s === sz ? '.on' : ''), { title: 'Taille ' + s.toUpperCase(), onclick: () => setTileSize(key, s) }, SZICON[s]));
    const body = h('div.rtileb');
    const fitw = h('div.rtfit');
    try { fitw.append(def.r()); } catch (e) { console.error(e); fitw.append(h('div.notice.bad', 'Erreur : ' + (e && e.message))); }
    body.append(fitw);
    const head = h('div.rtileh', h('span.rgrab', { title: 'Glisser pour déplacer' }, '⠿'), h('b', def.t), h('div.rtsz', ...szBtns), h('span.rtx', { title: 'Fermer', onclick: () => closeTile(key) }, '✕'));
    head.onpointerdown = (ev) => startDrag(ev, key);
    tile.append(head, body);
    // poignées : on étire la tuile en large (bords G/D), en long (bord bas) ou au coin.
    // Elles ne changent QUE la taille — le contenu du module n'est jamais reconstruit.
    for (const dir of ['e', 'w', 's', 'se']) tile.append(h('div.rgrip.rg-' + dir, { onpointerdown: (ev) => startResize(ev, key, dir) }));
    applyFree(tile, key);
    return tile;
  }
  // Glisser-déposer : attrape la tuile par sa barre du haut et déplace-la (haut/bas/gauche/droite).
  // On DÉPLACE le nœud DOM (insertBefore) — le module n'est jamais reconstruit, ton réglage en cours reste intact.
  function startDrag(ev, key) {
    if (ev.button != null && ev.button !== 0) return;
    if (ev.target.closest('.rtsz') || ev.target.closest('.rtx')) return; // boutons : pas de déplacement
    const work = main.querySelector('.rwork'); const dragTile = tileEl(key); if (!work || !dragTile) return;
    const sx = ev.clientX, sy = ev.clientY; let active = false;
    const begin = () => { active = true; dragTile.classList.add('dragging'); dragTile.style.pointerEvents = 'none'; document.body.style.userSelect = 'none'; };
    const move = (e) => {
      if (!active) { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 6) return; begin(); }
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const over = under && under.closest('.rtile');
      if (over && over !== dragTile && over.parentElement === work) {
        const rect = over.getBoundingClientRect();
        const after = (e.clientY > rect.top + rect.height / 2) || (e.clientX > rect.left + rect.width / 2);
        work.insertBefore(dragTile, after ? over.nextSibling : over);
        openTiles = [...work.querySelectorAll('.rtile')].map(t => t.dataset.key);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (active) { dragTile.classList.remove('dragging'); dragTile.style.pointerEvents = ''; document.body.style.userSelect = ''; saveTiles(); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function startResize(ev, key, dir) {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const tile = tileEl(key); if (!tile) return;
    const r = tile.getBoundingClientRect();
    const sx = ev.clientX, sy = ev.clientY, sw = r.width, sh = r.height;
    SIZES.forEach(c => tile.classList.remove(c)); tile.classList.add('free'); tile.style.flex = '0 0 auto'; tile.style.width = sw + 'px'; tile.style.height = sh + 'px';
    tile.querySelectorAll('.rtsz span').forEach(b => b.classList.remove('on'));
    const minW = 240, minH = 140, maxW = Math.max(minW, (main.clientWidth || 1200) - 28);
    const move = (e) => {
      let w = sw, hh = sh;
      if (dir.includes('e')) w = sw + (e.clientX - sx);
      if (dir.includes('w')) w = sw - (e.clientX - sx);
      if (dir.includes('s')) hh = sh + (e.clientY - sy);
      tile.style.width = Math.max(minW, Math.min(maxW, w)) + 'px';
      tile.style.height = Math.max(minH, hh) + 'px';
      fitSoon();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const rr = tile.getBoundingClientRect(); tileFree[key] = { w: Math.round(rr.width), h: Math.round(rr.height) }; delete tileSize[key]; saveTiles();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function renderWork() {
    main.innerHTML = '';
    const work = h('div.rwork');
    if (!openTiles.length) work.append(h('div.rwempty', '👈 Choisis un module dans le répertoire à gauche pour le poser ici.', h('br'), 'Tu peux en poser plusieurs et les redimensionner (S / M / L / XL).'));
    for (const k of openTiles) work.append(buildTile(k));
    main.append(work);
    renderTabs(); highlightSide(); fitSoon();
  }
  function setTileSize(key, s) {
    delete tileFree[key]; tileSize[key] = s; saveTiles();
    const t = tileEl(key); if (!t) return;
    t.style.flex = ''; t.style.width = ''; t.style.height = '';
    t.className = 'rtile ' + s;
    t.querySelectorAll('.rtsz span').forEach((b, i) => b.classList.toggle('on', SIZES[i] === s));
    fitSoon();
  }
  function closeTile(key) {
    openTiles = openTiles.filter(k => k !== key); delete tileSize[key]; delete tileFree[key]; saveTiles();
    if (curKey === key) curKey = openTiles[openTiles.length - 1] || 'regie';
    renderWork();
  }
  function flashTile(key) { const t = tileEl(key); if (!t) return; t.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); }
  // Pose le module (ou le met en avant s'il est déjà là) — ne recouvre jamais les autres.
  function showModule(key) {
    if (!WINDEF[key]) return;
    curKey = key; try { localStorage.setItem('regie.module', key); } catch {}
    let work = main.querySelector('.rwork');
    if (!work) { renderWork(); work = main.querySelector('.rwork'); }
    if (!openTiles.includes(key)) {
      openTiles.push(key); if (!tileSize[key]) tileSize[key] = 'xl'; saveTiles();
      work.querySelector('.rwempty')?.remove();
      work.append(buildTile(key)); fitSoon();
    }
    renderTabs(); highlightSide(); flashTile(key);
  }
  const openWindow = (k) => showModule(k);
  const go = (k) => showModule(k);
  function openAt(key, s) { showModule(key); setTileSize(key, s); flashTile(key); }
  // Clic droit sur un item du répertoire : poser / mettre en avant / régler la taille / fermer.
  function sideMenu(key, ev) {
    ev.preventDefault(); ev.stopPropagation();
    const open = openTiles.includes(key);
    const items = [{ head: WINDEF[key].t.replace(/^\S+\s/, '') }];
    items.push({ label: open ? '👁️ Mettre en avant' : '➕ Poser le module', fn: () => showModule(key) });
    items.push('-', { head: 'Taille' },
      { label: '▪ Petit (S)', fn: () => openAt(key, 's') },
      { label: '◧ Moyen (M)', fn: () => openAt(key, 'm') },
      { label: '▬ Grand (L)', fn: () => openAt(key, 'l') },
      { label: '■ Pleine largeur (XL)', fn: () => openAt(key, 'xl') });
    if (open) items.push('-', { label: '✕ Fermer', danger: true, fn: () => closeTile(key) });
    if (openTiles.length > 1) items.push({ label: '🧹 Ne garder que celui-ci', fn: () => { openTiles = [key]; saveTiles(); curKey = key; renderWork(); } });
    showMenu(ev.clientX, ev.clientY, items);
  }
  // Recâble les tuiles « vivantes » (timeline / vue d'ensemble) après un traitement, sans tout reconstruire.
  function refreshViews() {
    for (const k of ['timeline', 'regie']) {
      if (!openTiles.includes(k)) continue;
      const t = tileEl(k); if (!t) continue;
      const b = t.querySelector('.rtfit'); if (!b) continue;
      b.innerHTML = ''; try { b.append(WINDEF[k].r()); } catch (e) { console.error(e); }
    }
    fitSoon();
  }
  function renderTabs() { tabsBar.innerHTML = ''; for (const k of TAB_ORDER) tabsBar.append(h('div.rtab' + (openTiles.includes(k) ? '.on' : ''), { onclick: () => showModule(k) }, WINDEF[k].t)); }
  function highlightSide() { try { side.querySelectorAll('.ditem').forEach(d => d.classList.toggle('on', openTiles.includes(d.dataset.key))); } catch {} }

  function renderSidebar() {
    const groups = [
      { ic: '🏠', t: 'Studio', items: [['🧩', 'Vue d’ensemble', () => go('regie'), null, 'regie'], ['🎵', 'Timeline', () => go('timeline'), null, 'timeline'], ['🎙️', 'Enregistrement', () => go('rec'), null, 'rec'], ['📤', 'Exporter le mix (WAV)', () => exportMix()]] },
      { ic: '🎵', t: `Pistes (${tracks.length})`, items: tracks.map((t, i) => [null, t.name || `Piste ${i + 1}`, () => { if (!isInstru(t)) selVoixIdx = i; go('timeline'); refreshViews(); toast('🎯 Piste cible : ' + (t.name || `Piste ${i + 1}`)); }, trackColor(t, i)]) },
      { ic: '🎛️', t: 'Modules', items: [['🎚️', 'Console live', () => go('console'), null, 'console'], ['🎤', 'Auto-Tune Pro', () => go('autotune'), null, 'autotune'], ['🎚️', 'Égaliseur', () => go('eq'), null, 'eq'], ['🗜️', 'Compresseur', () => go('comp'), null, 'comp'], ['🌫️', 'Réverbe & FX', () => go('rev'), null, 'rev'], ['🧼', 'De-Esser', () => go('deess'), null, 'deess'], ['🎚️', 'Hauteur / Pitch', () => go('pitch'), null, 'pitch'], ['🎼', 'Harmoniseur', () => go('harmo'), null, 'harmo'], ['🌈', 'Spectrogramme', () => go('spectro'), null, 'spectro'], ['⭐', 'Banque d’effets', () => go('bank'), null, 'bank'], ['🏁', 'Mastering', () => go('master'), null, 'master']] },
      { ic: '📚', t: 'Répertoire', items: [['📚', 'Presets (répertoire)', () => go('repo'), null, 'repo']] },
      { ic: '🧠', t: 'IA Expert', items: [['🧠', 'Ouvrir l’ingé IA', () => go('ia'), null, 'ia']] },
    ];
    side.innerHTML = '';
    groups.forEach((g, gi) => {
      const grp = h('div.dgrp' + (gi > 2 ? '.closed' : ''));
      const head = h('div.dgh', { onclick: () => grp.classList.toggle('closed') }, h('span.ico', g.ic), h('span', g.t), h('span.ch', '▾'));
      const body = h('div.dgb');
      for (const it of g.items) {
        const [ic, label, fn, color, key] = it;
        const item = h('div.ditem', { onclick: fn || (() => toast('Disponible dans une prochaine phase')) },
          color ? h('span.led', { style: { color } }) : (ic ? h('span', { style: { width: '16px', textAlign: 'center' } }, ic) : null),
          h('span', { style: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, label));
        if (key) { item.dataset.key = key; item.oncontextmenu = (e) => sideMenu(key, e); }
        body.append(item);
      }
      grp._body = body;
      grp.append(head, body); side.append(grp);
    });
  }

  // top bar
  const burger = h('div.rburger', { onclick: () => root.classList.toggle('collapsed') }, '☰');
  const toggleFs = () => { try { if (!document.fullscreenElement) (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root); else (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch {} };
  const fsBtn = h('div.rburger', { title: 'Plein écran', onclick: toggleFs, style: { fontSize: '17px' } }, '⛶');
  const resetLayout = () => { openTiles = ['regie']; for (const k in tileSize) delete tileSize[k]; tileSize.regie = 'xl'; for (const k in tileFree) delete tileFree[k]; curKey = 'regie'; saveTiles(); renderWork(); toast('Disposition réinitialisée', 'ok'); };
  const resetBtn = h('div.rburger', { title: 'Réinitialiser la disposition (tout remettre propre)', onclick: resetLayout, style: { fontSize: '16px' } }, '↺');
  const top = h('div.rtop', burger,
    h('div.rbrand', h('div.wf'), h('div', h('b', 'Studio IA'), h('small', 'Régie Pro'))),
    tabsBar, resetBtn, fsBtn,
    h('span.rpill', h('span.dot'), 'Moteur local · 0 € · build LIVE33'));

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

  // Mode « noir bord à bord / espace maximal » : on efface la barre de titre de l'app pendant la Régie.
  try { document.body.classList.add('regie-max'); } catch {}

  await load();
  try { ast = mountAssistant(buildAssistantS()); } catch (e) { ast = null; }
  renderSidebar();
  renderWork();
  // recalcule l'échelle quand la zone change (plein écran, menu replié, fenêtre redimensionnée)
  const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => fitSoon()) : null;
  try { ro?.observe(main); } catch {}

  // nettoyage
  return () => { try { ro?.disconnect(); } catch {} try { document.body.classList.remove('regie-max'); } catch {} stopPlay(); stopAllRec(); stopPreview(); stopLive(); closeMenu(); try { ast?.destroy?.(); } catch {} };
}

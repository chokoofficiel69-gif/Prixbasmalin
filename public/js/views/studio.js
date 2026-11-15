// Studio Pro — cockpit sur un seul écran (sans scroll), tous les modules câblés au
// moteur local : presets, Auto-Tune, EQ, Compression, De-Esser, Reverb, Delay, banque
// d'effets, analyse vocale, niveaux, mastering. Palette orange/jaune. 100 % local, 0 €.
import { h, toast, toastErr } from '../lib/core.js';
import { knob } from '../lib/knob.js';
import { expertFace } from '../lib/expertface.js';
import { QUICK_VIBES, buildVibe, UNITS, buildFx } from '../lib/vocalunits.js';
import { scoreVoice } from '../lib/voicescore.js';
import { analyzeSamples } from '../lib/ingexpert.js';
import { decodeBlob, encodeWav, master, bufferPlayer, voiceChain } from '../lib/audio.js';
import { applyChain } from '../lib/voicefx.js';

const DEF = { tuneOn: true, speed: 0.6, humanize: 0.35, formant: 0, low: 0, mid: 2, air: 2, comp: 0.4, deess: 3, reverb: 0.12, delay: 0, sat: 0 };
const TUNE_MODES = {
  naturel: { speed: 0.3, humanize: 0.5, strength: 0.5 },
  rap: { speed: 0.5, humanize: 0.35, strength: 0.7 },
  melo: { speed: 0.75, humanize: 0.3, strength: 0.85 },
  robot: { speed: 1, humanize: 0, strength: 1 },
  hard: { speed: 1, humanize: 0, strength: 1 },
};
const EFFECTS = [
  ['🎵', 'Hard Tune', { tuneOn: true, speed: 1, humanize: 0 }], ['🎶', 'Soft Tune', { tuneOn: true, speed: 0.4, humanize: 0.5 }],
  ['👥', 'Double', { reverb: 0.1, mid: 3 }], ['🎼', 'Harmonie', { reverb: 0.2, air: 3 }], ['🤖', 'Vocoder', { tuneOn: true, speed: 1, humanize: 0, sat: 0.3 }],
  ['📻', 'Radio', { low: -6, air: -6, mid: 4, sat: 0.3 }], ['📞', 'Phone', { low: -10, air: -8, mid: 5 }], ['🔊', 'Tube', { sat: 0.5, low: 2 }],
  ['🌫️', 'Reverb', { reverb: 0.4 }], ['🔁', 'Delay', { delay: 0.35 }], ['✨', 'Air', { air: 5 }], ['🥊', 'Punch', { comp: 0.7 }],
];

export async function render(el) {
  const fx = { ...DEF };
  let raw = null, processed = null, lastEm = null, busy = false;
  const player = bufferPlayer((t, ended) => { if (ended) playBtn.textContent = '▶'; });

  // ---- état -> traitement réel ----
  async function process(buf) {
    let cur = buf;
    if (fx.tuneOn) cur = (await applyChain(cur, [{ t: 'tune', strength: 1, speed: fx.speed, humanize: fx.humanize, formant: fx.formant }])).buffer;
    cur = await voiceChain(cur, { highpass: 85, low: fx.low, presence: fx.mid, air: fx.air, deess: fx.deess, comp: fx.comp, reverb: fx.reverb });
    if (fx.delay > 0) cur = (await applyChain(cur, [{ t: 'fx', kind: 'delay', time: 0.3, feedback: 0.3, mix: fx.delay }])).buffer;
    return cur;
  }

  // ---- composants ----
  const face = expertFace();
  const say = (msg) => { faceStatus.textContent = msg; };
  let faceStatus;

  const knobs = {};
  const mk = (key, label, min, max, step, fmt) => {
    const k = knob({ label, min, max, step, value: fx[key], def: DEF[key], fmt, onInput: (v) => { fx[key] = v; processed = null; } });
    knobs[key] = k; return k.el;
  };
  const dbF = (v) => `${v > 0 ? '+' : ''}${v} dB`;
  const pcF = (v) => `${Math.round(v * 100)} %`;
  const refreshKnobs = () => { for (const k in knobs) knobs[k].set(fx[k], false); };

  // Auto-Tune : grand cadran (speed) + humanize/formant/flex
  const bigDial = mk('speed', 'RETUNE SPEED', 0, 1, 0.02, (v) => `${Math.round(v * 400)} ms`);
  bigDial.classList.add('big');
  const modeBtns = Object.entries({ naturel: 'Naturel', rap: 'Rap', melo: 'Mélodique', robot: 'Robot', hard: 'Hard' }).map(([id, lab]) =>
    h('button.cbtn', { 'data-mode': id, onclick: () => { const m = TUNE_MODES[id]; fx.speed = m.speed; fx.humanize = m.humanize; fx.tuneOn = true; processed = null; refreshKnobs(); document.querySelectorAll('.cbtn[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === id)); } }, lab));

  // EQ curve (visuelle, reflète low/mid/air)
  const eqSvg = h('div.eqcurve');
  const drawEq = () => {
    const y = (db) => 55 - db * 3.2;
    eqSvg.innerHTML = `<svg viewBox="0 0 300 110" preserveAspectRatio="none" style="width:100%;height:100%">
      <defs><linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity=".5"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></linearGradient></defs>
      <g stroke="#3a2e12" stroke-width="1"><line x1="0" y1="27" x2="300" y2="27"/><line x1="0" y1="55" x2="300" y2="55"/><line x1="0" y1="83" x2="300" y2="83"/></g>
      <path d="M0 ${y(fx.low)} C60 ${y(fx.low)} 90 ${y(fx.mid)} 150 ${y(fx.mid)} C210 ${y(fx.mid)} 250 ${y(fx.air)} 300 ${y(fx.air)} L300 110 L0 110 Z" fill="url(#eqg)"/>
      <path d="M0 ${y(fx.low)} C60 ${y(fx.low)} 90 ${y(fx.mid)} 150 ${y(fx.mid)} C210 ${y(fx.mid)} 250 ${y(fx.air)} 300 ${y(fx.air)}" fill="none" stroke="#fbbf24" stroke-width="2"/>
    </svg>`;
  };
  // redessine l'EQ en continu (reflète low/mid/air)
  let eqRaf = 0;
  const eqWatch = () => { drawEq(); eqRaf = requestAnimationFrame(eqWatch); };

  // Analyse : jauge + barres
  const gauge = h('div.cgauge');
  const scoreList = h('div.cscore');
  function renderScore(em) {
    const r = scoreVoice(em || {});
    const ov = r.overall;
    if (ov == null) { gauge.innerHTML = `<div class="cg-empty">—</div>`; scoreList.innerHTML = '<div class="tiny muted">Analyse une prise pour voir la qualité.</div>'; return; }
    const circ = 2 * Math.PI * 40, off = circ * (1 - ov / 100);
    const col = ov >= 80 ? '#22e39a' : ov >= 60 ? '#fbbf24' : '#ef4444';
    gauge.innerHTML = `<svg viewBox="0 0 96 96" style="width:100%;height:100%"><circle cx="48" cy="48" r="40" fill="none" stroke="#2a2410" stroke-width="8"/><circle cx="48" cy="48" r="40" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 48 48)" style="filter:drop-shadow(0 0 6px ${col})"/><text x="48" y="46" text-anchor="middle" font-size="24" font-weight="800" fill="#fff">${ov}</text><text x="48" y="60" text-anchor="middle" font-size="7" fill="#b0a079">QUALITÉ %</text></svg>`;
    scoreList.innerHTML = '';
    for (const it of r.items) {
      const row = h('div.cscore-row', { 'data-s': it.status }, h('span.cscore-l', it.label), h('span.cscore-b', (() => { const i = h('i'); i.style.width = it.pct + '%'; return i; })()), h('span.cscore-v', it.pct + '%'));
      scoreList.append(row);
    }
  }

  // ---- actions audio ----
  const fileInput = h('input', { type: 'file', accept: 'audio/*', style: { display: 'none' }, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { say('Chargement…'); face.setState('thinking'); raw = await decodeBlob(f); processed = null; lastEm = null; renderScore(null); say('Voix chargée'); face.setState('idle'); toast('Voix importée. Appuie sur ▶ pour écouter avec les effets.', 'ok'); }
    catch (err) { toastErr(err); face.setState('idle'); }
  } });

  async function doPlay() {
    if (!raw) { fileInput.click(); return; }
    if (player.playing) { player.pause(); playBtn.textContent = '▶'; return; }
    if (!processed) {
      if (busy) return; busy = true; face.setState('thinking'); say('Traitement…'); playBtn.textContent = '…';
      try { processed = await process(raw); player.load(processed); }
      catch (e) { toastErr(e); busy = false; face.setState('idle'); playBtn.textContent = '▶'; return; }
      busy = false; face.setState('idle'); say('Prêt');
    }
    player.play(); playBtn.textContent = '⏸';
  }
  async function doAnalyse() {
    if (!raw) return toast('Importe d’abord une voix.');
    face.setState('thinking'); say('Analyse…');
    try { const ch = raw.getChannelData(0); lastEm = analyzeSamples(ch, raw.sampleRate); renderScore(lastEm); face.setState('speaking'); say('Analyse terminée'); setTimeout(() => face.setState('idle'), 4000); }
    catch (e) { toastErr(e); face.setState('idle'); }
  }
  async function doMaster() {
    if (!raw) return toast('Importe d’abord une voix.');
    face.setState('thinking'); say('Mastering…');
    try { if (!processed) processed = await process(raw); const r = await master(processed, 'rap', (m) => say(m)); const blob = new Blob([encodeWav(r.buffer)], { type: 'audio/wav' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'studio-master.wav'; a.click(); say(`Master ${r.after} LUFS`); face.setState('idle'); toast('Master téléchargé (WAV).', 'ok'); }
    catch (e) { toastErr(e); face.setState('idle'); }
  }

  function applyState(partial, label) {
    Object.assign(fx, partial); processed = null; refreshKnobs();
    if (label) toast(`${label} appliqué`, 'ok');
  }

  // ---- presets (vibes) ----
  const vibeTiles = QUICK_VIBES.map(v => h('button.cpreset', { title: v.hint, onclick: () => {
    const b = buildVibe(v.id); const p = { tuneOn: true };
    if (b.fx.tune != null) p.speed = b.tune.speed, p.humanize = b.tune.humanize;
    for (const kk of ['low', 'mid', 'air', 'comp', 'reverb']) if (b.fx[kk] != null) p[kk] = kk === 'mid' ? b.fx.pres ?? b.fx.mid : b.fx[kk];
    if (b.fx.pres != null) p.mid = b.fx.pres;
    if (b.fx.echo != null) p.delay = b.fx.echo;
    applyState(p, `${v.emoji} ${v.name}`);
    document.querySelectorAll('.cpreset').forEach(x => x.classList.remove('on'));
  } }, h('span.cp-ic', v.emoji), h('span.cp-n', v.name)));

  const effectTiles = EFFECTS.map(([e, n, patch]) => h('button.ctile', { onclick: () => applyState(patch, n) }, h('span.ct-e', e), h('span.ct-n', n)));

  // ---- transport ----
  const playBtn = h('button.rbtn.play', { onclick: doPlay }, '▶');
  const transport = h('div.ctransport',
    h('button.rbtn', { onclick: () => { player.stop(); playBtn.textContent = '▶'; } }, '⏹'),
    playBtn,
    h('button.rbtn.rec', { onclick: () => fileInput.click(), title: 'Importer une voix' }, '⇪'),
    h('div.clcd', '00:00 / 00:00'),
    h('div.grow'),
    h('button.cbtn.prim', { onclick: doAnalyse }, '🧠 Analyser'),
    h('button.cbtn.prim', { onclick: doMaster }, '🎚️ Masteriser (WAV)'),
    h('span.tiny.muted', '44.1 kHz · local · 0 €'),
  );

  // ---- panneau générique ----
  const panel = (title, ...kids) => h('div.cpanel', h('div.cph', h('span.cled'), title, h('span.cpwr')), h('div.cpbody', ...kids));

  // ---- assemblage cockpit ----
  const cockpit = h('div.cockpit',
    // colonne gauche
    h('div.ccol studio-left',
      panel('Presets vocaux', h('div.cpresets', ...vibeTiles)),
    ),
    // colonne centrale : avatar expert en grand, puis chaîne de traitement
    h('div.ccol studio-center',
      panel('IA EXPERT VOCAL · INGÉNIEUR EN LIGNE', face.el, (faceStatus = h('div.tiny', { style: { marginTop: '8px', color: '#b8caff' } }, 'Prêt à analyser ta voix')), h('div.tiny.muted', { style: { marginTop: '5px' } }, 'Analyse la prise, explique les corrections et prépare une chaîne vocale.')),
      panel('Auto-Tune Pro', h('div.cauto',
        h('div.cdial', bigDial),
        h('div.cknobs3',
          mk('humanize', 'Humanize', 0, 1, 0.02, pcF),
          mk('formant', 'Formant', -5, 5, 1, (v) => `${v > 0 ? '+' : ''}${v}`),
          mk('deess', 'De-Esser', 0, 8, 0.5, (v) => `${v}`),
        )),
        h('div.cmodes', ...modeBtns),
      ),
      h('div.crow2',
        panel('Égaliseur', eqSvg, h('div.cknobs3',
          mk('low', 'Low', -12, 12, 0.5, dbF), mk('mid', 'Mid', -12, 12, 0.5, dbF), mk('air', 'Air', -12, 12, 0.5, dbF))),
        panel('Dynamique & Espace', h('div.cknobs4',
          mk('comp', 'Comp', 0, 1, 0.02, pcF), mk('sat', 'Satur.', 0, 1, 0.02, pcF), mk('reverb', 'Reverb', 0, 0.7, 0.01, pcF), mk('delay', 'Delay', 0, 0.6, 0.01, pcF))),
      ),
      panel('Banque d’effets', h('div.ctiles', ...effectTiles)),
    ),
    // colonne droite
    h('div.ccol',
      panel('Analyse vocale', h('div.canalyse', gauge, scoreList)),
      panel('Niveaux & Mastering',
        h('div.tiny.muted', 'Preset master : Rap punchy (−10 LUFS)'),
        h('div.cmeter'), h('div.cmeter'),
        h('button.cbtn.prim', { style: { marginTop: '8px', width: '100%' }, onclick: doMaster }, '⚡ Masteriser pour export'),
      ),
    ),
    transport,
    fileInput,
  );
  el.append(cockpit);
  drawEq(); eqWatch(); renderScore(null);
  // init mode actif
  const rapBtn = cockpit.querySelector('.cbtn[data-mode="rap"]'); if (rapBtn) rapBtn.classList.add('on');

  return () => { try { player.stop(); } catch {} cancelAnimationFrame(eqRaf); };
}

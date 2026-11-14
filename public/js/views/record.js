import { api, h, state, toast, toastErr, uploadFile, downloadBlob, pickLocalFiles, pickFromLibrary, fetchFileBlob, fmtTime, startRecorder, audioCtx, transcribe, fileUrl, modal, parseJsonLoose, confirmBox, promptBox } from '../lib/core.js';
import { mountAssistant } from './assistant.js';
import { createTimeline } from './timeline.js';
import { knob } from '../lib/knob.js';
import { createNoteEditor } from './notes.js';
import { putItem, getItem, delItem, packBuffer, unpackBuffer } from '../lib/session.js';
import { PRESETS as VFX, PRESET_CATS as VFX_CATS, KEY_CHOICES, applyChain, keyName, detectChords, keyFromChords, detectPitch, detectKey } from '../lib/voicefx.js';
import { decodeBlob, encodeWav, denoise, antipop, gate, voiceChain, mix, master, MASTER_PRESETS, drawWave, bufferPlayer, sliceBuffer, cloneBuffer, normalize, loudness, makeBuffer, onsetStrength, onsetPeaks, bestAlignShift, detectBeats } from '../lib/audio.js';
import { ROLES, ROLE_ORDER, proposeRole, adlibPan, roleChain, micAdvice, justesse, buildReport, tipsPrompt, fallbackTips, mergePrefs, peakDbOf, rmsDbOf, noiseFloorDb } from '../lib/ingesong.js';
import { VOICE_TYPES, VOICE_TYPE_ORDER, PRO_PRESETS, PRO_PRESET_ORDER, DEFAULT_PRO, clampPro, buildTuneStep, applyPreset, formantForVoice, proName } from '../lib/autotunepro.js';
import { clampBpm, fmtBarsBeats, countInDuration, beatClickTimes, colorForTrack, dbToMeterPct } from '../lib/daw.js';
import { planComp, stitchMono, splitLoopTakes, punchInMono } from '../lib/comp.js';
import { analyzeSamples, STYLES, STYLE_ORDER, expertChain, instruDuckDb, expertReport, expertTipsPrompt, CONSULTATIONS, buildConsult, buildVoiceProposals } from '../lib/ingexpert.js';
import { analyzeMaster, compareToRef } from '../lib/meters.js';
import { analyzeVoiceDsp, voiceDspRecommendations } from '../lib/ingexpert-dsp.js';

const VOICE_PRESETS = {
  rap: { label: 'Voix rap claire et présente', highpass: 90, low: -1, presence: 4, air: 3, deess: 4, comp: 0.75, reverb: 0.08 },
  chant: { label: 'Voix chantée douce', highpass: 80, low: 1, presence: 2.5, air: 3, deess: 3, comp: 0.5, reverb: 0.22 },
  podcast: { label: 'Parole / podcast', highpass: 85, low: 1.5, presence: 3, air: 1, deess: 3, comp: 0.7, reverb: 0 },
  brut: { label: 'Neutre (juste compresser)', highpass: 60, low: 0, presence: 0, air: 0, deess: 0, comp: 0.4, reverb: 0 },
};

// ---------- Réglages sur mesure décrits en français (IA) ----------
const FX_KINDS = {
  reverb: { size: [0.3, 5], mix: [0, 0.6], decay: [1, 5] }, delay: { time: [0.05, 0.8], fb: [0, 0.6], mix: [0, 0.5] },
  pingpong: { time: [0.08, 0.6], mix: [0, 0.5] }, chorus: { mix: [0, 0.7] }, flanger: { mix: [0, 0.7] },
  warm: {}, tube: { amt: [1, 3] }, tape: { amt: [1, 3] }, exciter: { mix: [0, 0.5] }, air: { gain: [0, 6] },
  peak: { f: [40, 12000], q: [0.4, 4], gain: [-8, 8] }, distort: { amt: [1, 10], tone: [3000, 12000] },
  band: { lo: [100, 1000], hi: [2000, 10000], drive: [0, 8] }, lofi: { bits: [4, 10], hi: [3000, 10000] },
};
const clampN = (v, [a, b], d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
export function sanitizeChain(chain) {
  const out = [];
  for (const s of Array.isArray(chain) ? chain.slice(0, 6) : []) {
    if (!s || typeof s !== 'object') continue;
    if (s.t === 'tune') out.push(s.mode === 'notes' ? { t: 'tune', mode: 'notes', strength: clampN(s.strength, [0, 1], 1), keep: clampN(s.keep, [0, 0.8], 0.2), glide: clampN(s.glide, [0, 200], 30) } : { t: 'tune', strength: clampN(s.strength, [0, 1], 1), speed: clampN(s.speed, [0, 200], 30) });
    else if (s.t === 'shift') out.push({ t: 'shift', semi: Math.round(clampN(s.semi, [-12, 12], 0)), formant: clampN(s.formant, [-4, 4], 0) });
    else if (s.t === 'double') out.push({ t: 'double', steps: (Array.isArray(s.steps) ? s.steps : [0, 0]).slice(0, 2).map(x => [-12, 0, 12].includes(+x) ? +x : 0), gain: clampN(s.gain, [0.2, 0.8], 0.55) });
    else if (s.t === 'harmony') { const st = (Array.isArray(s.steps) ? s.steps : [2]).slice(0, 2).map(x => Math.round(clampN(x, [-4, 4], 2))).filter(Boolean); if (st.length) out.push({ t: 'harmony', steps: st, gain: clampN(s.gain, [0.2, 0.7], 0.45) }); }
    else if (s.t === 'fx' && FX_KINDS[s.kind]) {
      const o = { t: 'fx', kind: s.kind };
      for (const [k, range] of Object.entries(FX_KINDS[s.kind])) if (s[k] !== undefined) o[k] = clampN(s[k], range, range[0]);
      out.push(o);
    }
  }
  // l'autotune / le changement de voix d'abord (ils repartent de la voix sèche), un seul des deux
  const pitchStep = out.find(s => s.t === 'tune') || out.find(s => s.t === 'shift');
  return [...(pitchStep ? [pitchStep] : []), ...out.filter(s => s.t !== 'tune' && s.t !== 'shift')];
}
export function sanitizeVoice(v) {
  if (!v || typeof v !== 'object') return null;
  const R = { highpass: [40, 200, 90], low: [-6, 6, 0], presence: [-4, 8, 3], air: [-4, 8, 2], deess: [0, 10, 3], comp: [0, 1, 0.6], reverb: [0, 0.5, 0.1] };
  const o = {}; for (const [k, [a, b, d]] of Object.entries(R)) o[k] = clampN(v[k], [a, b], d);
  return o;
}
function describeChain(p) {
  const parts = p.chain.map(s => s.t === 'tune' ? `autotune ${s.speed <= 10 ? 'fort' : s.speed <= 40 ? 'moyen' : 'léger'}` : s.t === 'shift' ? `voix ${s.semi > 0 ? '+' : ''}${s.semi} demi-tons` : s.t === 'double' ? 'doublage' : s.t === 'harmony' ? 'harmonies' : ({ reverb: 'réverbe', delay: 'écho', pingpong: 'écho ping-pong', chorus: 'chorus', flanger: 'flanger', warm: 'chaleur', tube: 'lampe', tape: 'bande', exciter: 'brillance', air: 'air', peak: 'égaliseur', distort: 'saturation', band: 'filtre radio', lofi: 'lo-fi' }[s.kind] || s.kind));
  if (p.voice) parts.push(`voix : présence ${p.voice.presence} dB, brillance ${p.voice.air} dB, compression ${p.voice.comp}`);
  return parts.join(' · ');
}
const VFX_AI_PROMPT = `Tu es ingénieur du son spécialisé rap/RnB (FR et US). L'artiste décrit en français le rendu de voix qu'il veut. Tu proposes 3 réglages proches mais différents (du plus discret au plus marqué), construits avec ces briques uniquement :
- {"t":"tune","strength":0-1,"speed":0-200} autotune (speed en ms : 0 = robot T-Pain, 10-25 = rap mélodique type Drake/Travis, 35-60 = pop propre, 120-200 = naturel)
- {"t":"shift","semi":-12..12,"formant":-4..4} hauteur/timbre (n'utilise pas avec tune)
- {"t":"double","steps":[0,0],"gain":0.2-0.8} doublage (steps -12 = octave grave, 12 = octave aiguë)
- {"t":"harmony","steps":[2],"gain":0.2-0.7} harmonies (2 = tierce, 4 = quinte)
- {"t":"fx","kind":K,...} avec K parmi : reverb(size 0.3-5, mix 0-0.6), delay(time 0.05-0.8, fb 0-0.6, mix 0-0.5), pingpong(time, mix), chorus(mix), flanger(mix), warm, tube(amt 1-3), tape(amt 1-3), exciter(mix), air(gain 0-6), peak(f Hz, q 0.4-4, gain -8..8), distort(amt 1-10, tone Hz), band(lo, hi, drive), lofi(bits 4-10, hi)
Et une chaîne voix "voix" (EQ + compression, appliquée en dernier) : {"highpass":40-200,"low":-6..6,"presence":-4..8,"air":-4..8,"deess":0-10,"comp":0-1,"reverb":0-0.5}.
Reste subtil : peu d'effets bien dosés, pas de grosse réverbe sauf si demandé. Si l'artiste cite un rappeur, traduis son rendu typique (justesse, brillance, ampleur, écho) sans prétendre copier sa voix.
Réponds UNIQUEMENT avec ce JSON : {"propositions":[{"nom":"court","pourquoi":"1 phrase","chaine":[...],"voix":{...}}]}`;

export async function render(el, { params }) {
  const tracks = [];       // {name, buffer, original, gainDb, pan, offset, mute, kind}
  let selected = -1;
  let sel = null;          // [début, fin] en secondes sur la piste sélectionnée
  let masterResult = null;
  let recorder = null, beatSrc = null, recLatency = null, timeline = null, recFrom = 0, recMinOff = 0, knobSel;

  const list = h('div.stack');
  const editBox = h('div.stack');
  const prompter = h('div.lyrics.small', { style: { maxHeight: '220px', overflow: 'auto', padding: '8px', background: 'var(--bg)', borderRadius: '10px' } });
  const pText = localStorage.getItem('studio.prompter');
  if (pText) prompter.textContent = pText; else prompter.style.display = 'none';

  const player = bufferPlayer((t, ended) => { if (ended) playSelBtn.textContent = '▶ Piste'; });
  const posLbl = h('span.small.muted', '0:00');

  // ---------- Sauvegarde automatique (survit au rafraîchissement, à la batterie vide, à la fermeture) ----------
  const SKEY = `rec:${state.projectId || 'perso'}`, PKEY = `recpending:${state.projectId || 'perso'}`;
  let saveT = null, restoring = true;
  const saveLbl = h('span.tiny.muted', '');
  function saveSoon(now = false) {
    if (restoring) return;
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      try {
        await putItem(SKEY, { v: 1, at: Date.now(), selected, tracks: tracks.map(t => ({ name: t.name, kind: t.kind, gainDb: t.gainDb, pan: t.pan, offset: t.offset, mute: t.mute, solo: !!t.solo, armed: !!t.armed, empty: !!t.empty, fxDone: t.fxDone || [], fx: t.fx || null, fileId: t.fileId,
          buf: packBuffer(t.buffer), orig: t.original === t.buffer ? null : packBuffer(t.original) })) });
        saveLbl.textContent = `💾 Sauvegardé automatiquement à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      } catch (e) { saveLbl.textContent = '⚠️ Sauvegarde auto impossible (mémoire du navigateur pleine ?)'; }
    }, now === true ? 0 : 400);
  }
  el.addEventListener('input', saveSoon); el.addEventListener('change', saveSoon);
  async function restoreSession() {
    try {
      const s = await getItem(SKEY);
      for (const t of s?.tracks || []) {
        const buffer = unpackBuffer(t.buf); if (!buffer) continue;
        tracks.push({ ...t, buf: undefined, orig: undefined, buffer, original: unpackBuffer(t.orig) || buffer });
      }
      if (tracks.length) { selected = Math.min(tracks.length - 1, Math.max(0, s.selected ?? 0)); toast(`Projet restauré : ${tracks.length} piste(s) ✓`, 'ok'); }
      // prise coupée en plein enregistrement (rafraîchissement, batterie…) : on la récupère
      const pend = await getItem(PKEY);
      if (pend?.chunks?.length) {
        try { const b = await decodeBlob(new Blob(pend.chunks, { type: pend.type || 'audio/webm' })); tracks.push({ name: 'Prise récupérée', kind: 'voix', buffer: b, original: b, gainDb: 0, pan: 0, offset: pend.offset || 0, mute: false }); selected = tracks.length - 1; toast('Une prise interrompue a été récupérée ✓', 'ok'); }
        catch {}
        await delItem(PKEY);
      }
    } catch {}
    restoring = false;
    if (tracks.length) saveSoon();
  }
  async function newProject() {
    if (tracks.length && !(await confirmBox('Vider le projet en cours ? Les pistes non enregistrées dans Fichiers seront supprimées.', 'Vider', true))) return;
    tracks.length = 0; selected = -1; masterResult = null; await delItem(SKEY).catch(() => {}); drawList(); drawEdit(); saveLbl.textContent = 'Nouveau projet';
  }

  async function addTrack(buffer, name, kind = 'voix', fileId, offset = 0) {
    tracks.push({ name, buffer, original: buffer, gainDb: kind === 'instru' ? -4 : 0, pan: 0, offset, mute: false, kind, fileId });
    selected = tracks.length - 1; sel = null; masterResult = null;
    drawList(); drawEdit();
  }
  async function addBlob(blob, name, kind, fileId, offset = 0) {
    try {
      toast(`Décodage de « ${name} »…`);
      await addTrack(await decodeBlob(blob), name, kind || (/instru|beat|\.wav$/i.test(name) && tracks.length === 0 ? 'instru' : 'voix'), fileId, offset);
    } catch (e) { toast(`Format audio non lisible par ce navigateur : ${name}`, 'bad'); }
  }

  // ---------- Enregistrement ----------
  const meter = h('div.meter', h('i'));
  const recTime = h('span.kpi', '0:00');
  const rawMode = h('input', { type: 'checkbox' });
  const withBeat = h('input', { type: 'checkbox', checked: true });
  const recBtn = h('button.btn.rec', '⏺ Enregistrer');

  // ---------- Ingé son IA : préférences, session (tonalité + BPM de l'instru), éléments ----------
  const ingePrefs = mergePrefs((() => { try { return JSON.parse(localStorage.getItem('studio_inge')); } catch { return null; } })());
  if (typeof ingePrefs.expert !== 'boolean') ingePrefs.expert = false;
  if (!STYLES[ingePrefs.style]) ingePrefs.style = 'rap';
  const saveIngePrefs = () => { try { localStorage.setItem('studio_inge', JSON.stringify(ingePrefs)); } catch {} };
  const ingeSession = { key: null, keyLabel: null, bpm: null };
  const ingeOn = h('input', { type: 'checkbox', checked: ingePrefs.enabled });
  const ingeAuto = h('input', { type: 'checkbox', checked: ingePrefs.autoProcess });
  const ingeExpert = h('input', { type: 'checkbox', checked: ingePrefs.expert });
  const ingeStyle = h('select', STYLE_ORDER.map(s => h('option', { value: s, selected: s === ingePrefs.style }, STYLES[s].label)));
  ingeOn.onchange = () => { ingePrefs.enabled = ingeOn.checked; saveIngePrefs(); drawInge(); };
  ingeAuto.onchange = () => { ingePrefs.autoProcess = ingeAuto.checked; saveIngePrefs(); };
  ingeExpert.onchange = () => { ingePrefs.expert = ingeExpert.checked; saveIngePrefs(); const track = tracks[selected]; if (track?.kind === 'voix') processTake(track); else drawInge(); };
  ingeStyle.onchange = () => { ingePrefs.style = ingeStyle.value; saveIngePrefs(); };
  const micInfo = h('div.small.muted');
  const instruInfo = h('div.small.muted');
  const ingeReport = h('div.stack');
  const ingeAudio = h('audio', { controls: true, style: { width: '100%' } });
  rawMode.checked = ingePrefs.rawMic;
  rawMode.addEventListener('change', () => { ingePrefs.rawMic = rawMode.checked; saveIngePrefs(); });
  // Volumes rapides : instru dans le casque (et dans le mix) · niveau de la voix enregistrée
  let beatGainNode = null, micDb = Number(localStorage.getItem('studio.micDb') || 0);
  const instruLbl = h('b', '');
  const instruVol = h('input', { type: 'range', min: -30, max: 6, step: 0.5, value: -4 });
  const syncVoice = () => { const has = tracks.some(t => t.kind !== 'instru'); micVol.disabled = !has; if (!has) micLbl.textContent = '(pas encore de voix enregistrée)'; else if (micLbl.textContent.startsWith('(')) micLbl.textContent = `${voiceBusDb > 0 ? '+' : ''}${voiceBusDb} dB`; };
  const syncInstru = () => { syncVoice(); const b = tracks.find(t => t.kind === 'instru'); instruVol.disabled = !b; if (b) { instruVol.value = b.gainDb; instruLbl.textContent = `${b.gainDb} dB`; } else instruLbl.textContent = '(pas d’instru)'; };
  instruVol.oninput = () => { const b = tracks.find(t => t.kind === 'instru'); if (!b) return; b.gainDb = Number(instruVol.value); instruLbl.textContent = `${b.gainDb} dB`; if (beatGainNode) beatGainNode.gain.value = 10 ** (b.gainDb / 20); liveGain(b); masterResult = null; drawList(); };
  // ---------- Vumètres en direct (on voit quand ça sature) ----------
  function makeMeter(label) {
    const bar = h('i', { style: { display: 'block', height: '100%', width: '0%', background: 'linear-gradient(90deg,#22c55e 0%,#22c55e 70%,#eab308 85%,#ef4444 100%)', backgroundSize: '100% 100%', transition: 'width 60ms linear' } });
    const peakMark = h('i', { style: { position: 'absolute', top: 0, bottom: 0, width: '2px', background: '#fff', left: '0%' } });
    const val = h('b.small', '—');
    const clip = h('span.small', { style: { fontWeight: 700, color: '#ef4444', visibility: 'hidden' } }, '● SATURE');
    const track = h('div', { style: { position: 'relative', height: '12px', borderRadius: '6px', overflow: 'hidden', background: 'rgba(127,127,127,.25)' } }, bar, peakMark);
    const el = h('div.stack', { style: { gap: '2px' } }, h('div.row', h('span.small.grow', label), val, clip), track);
    let an = null, srcNode = null, raf = 0, hold = -90, holdT = 0, clipT = 0, ema = null;
    // Jauge « distance au micro » : trop loin ← bonne distance → trop près (calculée sur le niveau moyen de la voix)
    const needle = h('i', { style: { position: 'absolute', top: '-3px', bottom: '-3px', width: '4px', borderRadius: '2px', background: 'var(--text, #111)', left: '50%', transition: 'left 120ms linear', boxShadow: '0 0 0 2px var(--bg)' } });
    const proxTxt = h('b.small', 'Parle pour mesurer…');
    const proxEl = h('div.stack', { style: { gap: '4px' } },
      h('div.row', h('span.small.grow', '📏 Distance au micro'), proxTxt),
      h('div', { style: { position: 'relative', height: '14px', borderRadius: '7px', background: 'linear-gradient(90deg,#60a5fa 0%,#60a5fa 22%,#22c55e 35%,#22c55e 68%,#f97316 80%,#ef4444 100%)' } }, needle),
      h('div.row.tiny.muted', h('span.grow', '← trop loin'), h('span.grow', { style: { textAlign: 'center' } }, 'bonne distance'), h('span', 'trop près →')));
    const pct = (db) => Math.max(0, Math.min(100, (db + 60) / 60 * 100)); // échelle −60 → 0 dBFS
    function loop() {
      if (!an) return;
      const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
      let pk = 0, sum = 0; for (const x of d) { const a = Math.abs(x); if (a > pk) pk = a; sum += x * x; }
      const db = 20 * Math.log10(pk + 1e-9), rms = 20 * Math.log10(Math.sqrt(sum / d.length) + 1e-9), now = performance.now();
      if (db > hold || now - holdT > 1500) { hold = db; holdT = now; }
      if (db >= -0.5) clipT = now;
      bar.style.width = pct(db) + '%'; peakMark.style.left = `calc(${pct(hold)}% - 2px)`;
      val.textContent = `${db < -59 ? '−∞' : db.toFixed(1)} dB`;
      val.style.color = db >= -0.5 ? '#ef4444' : db > -6 ? '#eab308' : '';
      clip.style.visibility = now - clipT < 1500 ? 'visible' : 'hidden';
      if (rms > -50) {
        ema = ema === null ? rms : ema * 0.9 + rms * 0.1;
        const v = now - clipT < 800 ? 0 : ema; // une saturation = trop près
        needle.style.left = `calc(${Math.max(0, Math.min(100, (v + 42) / 38 * 100))}% - 2px)`;
        const [txt, col] = now - clipT < 800 || v > -8 ? ['📢 Trop près / trop fort : recule un peu', '#ef4444'] : v > -13 ? ['Un peu près', '#f97316'] : v > -30 ? ['✅ Bonne distance', '#16a34a'] : v > -36 ? ['Un peu loin', '#3b82f6'] : ['🔈 Trop loin : rapproche-toi', '#3b82f6'];
        proxTxt.textContent = txt; proxTxt.style.color = col;
      }
      raf = requestAnimationFrame(loop);
    }
    return {
      el, proxEl,
      attachNode(node) { this.detach(); const ctx = audioCtx(); an = ctx.createAnalyser(); an.fftSize = 2048; node.connect(an); srcNode = node; loop(); },
      attachStream(stream) { this.detach(); const ctx = audioCtx(); const src = ctx.createMediaStreamSource(stream); an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an); srcNode = src; loop(); },
      detach() { cancelAnimationFrame(raf); try { srcNode?.disconnect(an); } catch {} an = null; srcNode = null; bar.style.width = '0%'; val.textContent = '—'; clip.style.visibility = 'hidden'; hold = -90; ema = null; proxTxt.textContent = 'Parle pour mesurer…'; proxTxt.style.color = ''; needle.style.left = '50%'; },
    };
  }
  const micMeter = makeMeter('🎤 Micro (ce qui est enregistré)');
  const outMeter = makeMeter('🔊 Sortie (instru + voix)');

  // ---------- Réglages EN DIRECT par piste (non destructifs) : on tourne une molette, on entend tout de suite ----------
  const FX_DEF = { low: 0, mid: 0, pres: 0, air: 0, comp: 0, reverb: 0, echo: 0, tune: 0 };
  const fxOf = (t) => Object.assign({}, FX_DEF, t.fx || {});
  const fxActive = (t) => !!t.fx && Object.keys(FX_DEF).some(k => Number(t.fx[k] || 0) !== FX_DEF[k]);
  let tuneModule = null;
  const loadTune = (ctx) => { try { return ctx.audioWorklet.addModule('/js/lib/livetune-worklet.js'); } catch { return Promise.reject(); } };
  try { tuneModule = loadTune(audioCtx()).then(() => true, () => false); } catch {}
  let tuneReady = false; tuneModule?.then(ok => { tuneReady = ok; });
  const bpmNow = () => Number(localStorage.getItem('studio.bpm')) || 90;

  // ---------- Transport pro : BPM, tonalité, métronome, décompte ----------
  const transport = Object.assign({ bpm: bpmNow(), countIn: 1, metro: false, metroVol: 0.6, bpb: 4, loop: false },
    (() => { try { return JSON.parse(localStorage.getItem('studio.transport')) || {}; } catch { return {}; } })());
  transport.bpm = clampBpm(transport.bpm);
  const saveTransport = () => { try { localStorage.setItem('studio.transport', JSON.stringify(transport)); localStorage.setItem('studio.bpm', String(transport.bpm)); } catch {} };
  function clickAt(ctx, t, accent) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, transport.metroVol), t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.06);
  }
  const metro = {
    timer: null, i: 0,
    start() { this.stop(); const ctx = audioCtx(); const spb = 60 / transport.bpm; const t0 = ctx.currentTime + 0.1; let i = 0;
      const sched = () => { const ahead = ctx.currentTime + 0.3; while (t0 + i * spb < ahead) { clickAt(ctx, t0 + i * spb, (i % transport.bpb) === 0); i++; } this.timer = setTimeout(sched, 100); }; sched(); },
    stop() { clearTimeout(this.timer); this.timer = null; },
  };
  async function playCountIn() {
    const n = transport.countIn; if (!(n > 0) || !(transport.bpm > 0)) return;
    const ctx = audioCtx(); const dur = countInDuration(n, transport.bpm, transport.bpb); const t0 = ctx.currentTime + 0.12;
    for (const c of beatClickTimes(dur, transport.bpm, transport.bpb)) clickAt(ctx, t0 + c.t, c.accent);
    await new Promise(r => setTimeout(r, (t0 - ctx.currentTime + dur) * 1000));
  }

  function revIR(ctx, sec = 1.8) { const len = Math.floor(ctx.sampleRate * sec), ir = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3; } return ir; }
  function buildFx(ctx, input, fx, withTune) {
    const f = (type, freq, gain, q = 0.8) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.gain.value = gain; n.Q.value = q; return n; };
    let head = input, tune = null;
    if (withTune && fx.tune > 0) { tune = new AudioWorkletNode(ctx, 'live-tune', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }); tune.port.postMessage({ strength: Math.min(1, fx.tune), speed: fx.tune > 0.85 ? 1 : 0.1 + fx.tune * 0.3, scale: liveScale() }); head = input.connect(tune); }
    const low = f('lowshelf', 180, fx.low), mid = f('peaking', 700, fx.mid, 0.8), pres = f('peaking', 3200, fx.pres, 0.9), air = f('highshelf', 10000, fx.air);
    const comp = ctx.createDynamicsCompressor(); comp.attack.value = 0.005; comp.release.value = 0.12; comp.knee.value = 6;
    const make = ctx.createGain();
    const setComp = (c) => { comp.threshold.value = -6 - c * 26; comp.ratio.value = 1 + c * 5; make.gain.value = 10 ** (c * 7 / 20); };
    setComp(fx.comp);
    const sum = ctx.createGain();
    head.connect(low).connect(mid).connect(pres).connect(air).connect(comp).connect(make).connect(sum);
    const cv = ctx.createConvolver(); cv.buffer = revIR(ctx); const revG = ctx.createGain(); revG.gain.value = fx.reverb;
    make.connect(cv).connect(revG).connect(sum);
    const dl = ctx.createDelay(2); dl.delayTime.value = Math.min(1.5, 60 / bpmNow() / 2); const fb = ctx.createGain(); fb.gain.value = 0.3; const echoG = ctx.createGain(); echoG.gain.value = fx.echo;
    make.connect(dl); dl.connect(fb).connect(dl); dl.connect(echoG).connect(sum);
    return { out: sum, low, mid, pres, air, setComp, revG, echoG, tune };
  }
  // pour le mix/master : on « grave » les réglages en direct dans une copie de la piste (l'original n'est pas touché)
  async function renderFx(t) {
    if (!fxActive(t)) return t.buffer;
    const fx = fxOf(t), tail = (fx.reverb > 0 || fx.echo > 0) ? 2 : 0;
    const off = new OfflineAudioContext(2, Math.ceil((t.buffer.duration + tail) * t.buffer.sampleRate), t.buffer.sampleRate);
    let withTune = false; if (fx.tune > 0) { try { await off.audioWorklet.addModule('/js/lib/livetune-worklet.js'); withTune = true; } catch {} }
    const src = off.createBufferSource(); src.buffer = t.buffer;
    const g = buildFx(off, src, fx, withTune); g.out.connect(off.destination); src.start();
    return off.startRendering();
  }
  async function mixInput(minOff) {
    const out = [];
    for (const t of tracks) { if (t.empty) continue; out.push({ ...t, buffer: await renderFx(t), mute: effMute(t), offset: t.offset - minOff }); }
    return out;
  }

  // ---------- Écoute du mix EN DIRECT : chaque curseur de volume agit pendant la lecture ----------
  const live = { srcs: [], gains: new Map(), fx: new Map(), an: new Map(), bus: null, busAn: null, timer: null, ctxStart: 0, from: 0, end: 0 };
  let seekPos = 0; // tête de lecture (secondes depuis le début de la ligne de temps)
  const liveBtn = h('button.btn.small.primary', '▶ Écouter tout (volumes en direct)');
  const effMute = (t) => t.mute || (tracks.some(x => x.solo) && !t.solo);
  const gainOf = (t) => effMute(t) ? 0 : 10 ** (t.gainDb / 20);
  function liveGain() { const now = audioCtx().currentTime; for (const [t, g] of live.gains) g.gain.setTargetAtTime(gainOf(t), now, 0.02); }
  function livePos() { return live.srcs.length ? Math.min(live.end, audioCtx().currentTime - live.ctxStart + live.from) : seekPos; }
  function stopLive(keepPos = true) { if (live.srcs.length && keepPos) seekPos = livePos(); outMeter.detach(); live.srcs.forEach(s => { try { s.stop(); } catch {} }); live.srcs = []; live.gains.clear(); live.fx.clear(); live.an.clear(); live.bus = null; live.busAn = null; clearTimeout(live.timer); liveBtn.textContent = '▶ Écouter tout (volumes en direct)'; playBtn.textContent = '▶ Lecture'; }
  function playLive(from = seekPos, until = null, onEnd = null) {
    stopLive(false); player.stop();
    if (!tracks.length) return toast('Aucune piste à écouter.');
    const ctx = audioCtx(), minOff = Math.min(0, ...tracks.map(t => t.offset || 0)), t0 = ctx.currentTime + 0.05;
    const bus = ctx.createGain(); bus.connect(ctx.destination); outMeter.attachNode(bus);
    live.bus = bus; live.busAn = ctx.createAnalyser(); live.busAn.fftSize = 1024; live.busAn.smoothingTimeConstant = 0.82; bus.connect(live.busAn);
    let end = 0;
    for (const t of tracks) end = Math.max(end, (t.offset || 0) - minOff + t.buffer.duration);
    if (from >= end - 0.05) from = 0;
    for (const t of tracks) {
      if (t.empty) continue;
      const src = ctx.createBufferSource(); src.buffer = t.buffer;
      const g = ctx.createGain(); g.gain.value = gainOf(t);
      const pan = ctx.createStereoPanner(); pan.pan.value = t.pan || 0;
      const fxn = buildFx(ctx, src, fxOf(t), tuneReady);
      fxn.out.connect(g).connect(pan).connect(bus); live.fx.set(t, fxn);
      const an = ctx.createAnalyser(); an.fftSize = 256; pan.connect(an); live.an.set(t, an);
      const off = (t.offset || 0) - minOff - from;
      if (off >= 0) src.start(t0 + off); else if (-off < t.buffer.duration) src.start(t0, -off); else continue;
      if (until !== null) src.stop(t0 + (until - from));
      live.srcs.push(src); live.gains.set(t, g);
    }
    live.ctxStart = t0; live.from = from; live.end = until ?? end;
    liveBtn.textContent = '⏹ Arrêter l’écoute'; playBtn.textContent = '⏸ Pause';
    live.timer = setTimeout(() => { if (transport.loop && !onEnd && !recorder) { playLive(from, until); return; } stopLive(false); seekPos = from; onEnd?.(); }, ((until ?? end) - from) * 1000 + 300);
  }
  const playBtn = h('button.btn.primary', { onclick: () => (live.srcs.length ? stopLive() : playLive()) }, '▶ Lecture');
  liveBtn.onclick = () => (live.srcs.length ? stopLive() : playLive());
  // Gain d'entrée du micro (ce qui part dans l'enregistrement), réglable en direct
  let inGainDb = Number(localStorage.getItem('studio.inGainDb') || 0);
  const inGainLbl = h('b', `${inGainDb > 0 ? '+' : ''}${inGainDb} dB`);
  const inGain = h('input', { type: 'range', min: -24, max: 12, step: 0.5, value: inGainDb, oninput: () => {
    inGainDb = Number(inGain.value); inGainLbl.textContent = `${inGainDb > 0 ? '+' : ''}${inGainDb} dB`; localStorage.setItem('studio.inGainDb', inGainDb);
    recorder?.setGainDb?.(inGainDb);
    if (monitor?.inG && !(recorder && monitor.stream === recorder.stream)) monitor.inG.gain.setTargetAtTime(10 ** (inGainDb / 20), audioCtx().currentTime, 0.02);
  } });
  const micLbl = h('b', '0 dB');
  // Volume de TOUTES mes voix d'un coup (décale chaque piste voix du même nombre de dB) : plus simple que piste par piste
  let voiceBusDb = 0;
  const micVol = h('input', { type: 'range', min: -20, max: 12, step: 0.5, value: 0, oninput: () => {
    const nv = Number(micVol.value), d = nv - voiceBusDb; voiceBusDb = nv;
    micLbl.textContent = `${nv > 0 ? '+' : ''}${nv} dB`;
    for (const t of tracks) if (t.kind !== 'instru') t.gainDb = Math.max(-40, Math.min(12, Math.round((t.gainDb + d) * 2) / 2));
    liveGain(); masterResult = null; saveSoon(); timeline?.render();
  } });
  // ---------- Retour casque en direct (s'entendre pendant qu'on enregistre) ----------
  const monOn = h('input', { type: 'checkbox', checked: localStorage.getItem('studio.mon') === '1' });
  const MON_STYLES = { propre: 'Voix propre', rap: 'Voix rap (présence)', reverb: 'Voix + réverbe', echo: 'Voix + écho' };
  const monStyle = h('select', Object.entries(MON_STYLES).map(([k, l]) => h('option', { value: k, selected: localStorage.getItem('studio.mon.style') === k }, l)));
  const monVol = h('input', { type: 'range', min: 0, max: 2, step: 0.05, value: localStorage.getItem('studio.mon.vol') || 1 });
  let monitor = null, monTestStream = null;
  // Cocher = on s'entend tout de suite dans le casque (même sans enregistrer) ; décocher = on coupe
  monOn.onchange = () => { localStorage.setItem('studio.mon', monOn.checked ? '1' : '0'); if (!monOn.checked) stopMonitor(); else if (recorder) startMonitor(recorder.stream); else openLiveMonitor(); };
  async function openLiveMonitor() {
    if (monTestStream || recorder) return;
    try {
      monTestStream = await navigator.mediaDevices.getUserMedia({ audio: { ...micConstraints(), echoCancellation: false } });
      await startMonitor(monTestStream); micMeter.attachNode(monitor.inG); monTestBtn.textContent = '⏹ Arrêter le test';
      toast('🎧 Tu t’entends dans le casque. Règle « Ma voix dans le casque ». (Casque filaire conseillé.)');
    } catch (e) { monOn.checked = false; toast('Micro inaccessible : ' + e.message, 'bad'); }
  }
  monVol.oninput = () => { localStorage.setItem('studio.mon.vol', monVol.value); if (monitor) monitor.out.gain.value = Number(monVol.value); };
  // Réglages du retour casque, tous modifiables EN DIRECT pendant qu'on chante
  const MF = Object.assign({ bright: 3, reverb: 0.12, echo: 0, tune: 'off' }, (() => { try { return JSON.parse(localStorage.getItem('studio.monfx')) || {}; } catch { return {}; } })());
  const saveMF = () => { try { localStorage.setItem('studio.monfx', JSON.stringify(MF)); } catch {} };
  let workletReady = null;
  async function startMonitor(stream) {
    stopMonitor(true);
    const ctx = audioCtx();
    const src0 = ctx.createMediaStreamSource(stream);
    // le flux de la prise a déjà le gain micro ; le flux de test non : on l'applique ici
    const inG = ctx.createGain(); inG.gain.value = recorder && stream === recorder.stream ? 1 : 10 ** (inGainDb / 20);
    src0.connect(inG);
    const f = (type, freq, gain = 0, q = 0.8) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.gain.value = gain; n.Q.value = q; return n; };
    const hp = f('highpass', 90), pres = f('peaking', 3200, MF.bright, 0.9), air = f('highshelf', 10000, MF.bright * 0.7);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -22; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.12;
    const out = ctx.createGain(); out.gain.value = Number(monVol.value);
    let head = inG;
    let tune = null;
    if (MF.tune !== 'off' && ctx.audioWorklet) {
      try {
        workletReady ||= ctx.audioWorklet.addModule('/js/lib/livetune-worklet.js');
        await workletReady;
        tune = new AudioWorkletNode(ctx, 'live-tune', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        tune.port.postMessage({ strength: MF.tune === 'fort' ? 1 : 0.8, speed: MF.tune === 'fort' ? 1 : 0.12, scale: liveScale() });
        head = inG.connect(tune);
        computeLiveKey().then(() => tune.port.postMessage({ scale: liveScale() }));
      } catch (e) { tune = null; toast('Autotune en direct indisponible sur ce navigateur.', 'bad'); }
    }
    const dry = head.connect(hp).connect(pres).connect(air).connect(comp);
    dry.connect(out);
    const cv = ctx.createConvolver(); const len = Math.floor(ctx.sampleRate * 1.6); const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3; }
    cv.buffer = ir; const revG = ctx.createGain(); revG.gain.value = MF.reverb; dry.connect(cv).connect(revG).connect(out);
    const dl = ctx.createDelay(1); dl.delayTime.value = Math.min(0.9, 60 / (Number(localStorage.getItem('studio.bpm')) || 90) / 2); const fb = ctx.createGain(); fb.gain.value = 0.28; const echoG = ctx.createGain(); echoG.gain.value = MF.echo;
    dry.connect(dl); dl.connect(fb).connect(dl); dl.connect(echoG).connect(out);
    out.connect(ctx.destination);
    monitor = { src: src0, inG, out, stream, pres, air, revG, echoG, tune };
    showLatency();
  }
  // gamme pour l'autotune en direct : celle de l'instru si on la connaît, sinon chromatique
  function liveScale() {
    try {
      const k = fxKeyOpt() || liveKey; if (!k) return null;
      const steps = k.mode === 'majeur' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
      const sc = new Array(12).fill(false); steps.forEach(st => { sc[(k.root + st) % 12] = true; }); return sc;
    } catch { return null; }
  }
  let liveKey = null;
  let liveKeyBuf = null;
  async function computeLiveKey() { try { const b = tracks.find(t => t.kind === 'instru'); if (b && b.buffer !== liveKeyBuf) { liveKeyBuf = b.buffer; liveKey = keyFromChords(await detectChords(b.buffer)); } } catch {} }
  const latLbl = h('span.tiny.muted', '');
  function showLatency() {
    const ctx = audioCtx(), ms = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000 + (MF.tune !== 'off' ? 22 : 0) + 10);
    latLbl.textContent = `Retard estimé du retour : ~${ms} ms${ms > 60 ? ' (élevé : casque filaire et « Mode studio » conseillés)' : ' ✓'}`;
  }
  const mfSlider = (label, key, min, max, step, apply, fmt) => {
    const lbl = h('b', fmt(MF[key]));
    return h('label', h('span', label + ' ', lbl), h('input', { type: 'range', min, max, step, value: MF[key], oninput: (e) => { MF[key] = Number(e.target.value); lbl.textContent = fmt(MF[key]); saveMF(); if (monitor) apply(monitor); } }));
  };
  const tuneSel = h('select', { onchange: () => { MF.tune = tuneSel.value; saveMF(); if (monitor) startMonitor(monitor.stream); else showLatency(); } },
    ...[['off', 'Autotune casque : non'], ['leger', 'Autotune casque : léger (naturel)'], ['fort', 'Autotune casque : fort (effet)']].map(([v, l]) => h('option', { value: v, selected: MF.tune === v }, l)));
  const monFxBox = h('div.stack', { style: { gap: '4px' } },
    h('div.sliders',
      mfSlider('✨ Brillance', 'bright', -4, 8, 0.5, (m) => { const t = audioCtx().currentTime; m.pres.gain.setTargetAtTime(MF.bright, t, 0.03); m.air.gain.setTargetAtTime(MF.bright * 0.7, t, 0.03); }, (v) => `${v} dB`),
      mfSlider('🌫️ Réverbe', 'reverb', 0, 0.6, 0.02, (m) => m.revG.gain.setTargetAtTime(MF.reverb, audioCtx().currentTime, 0.03), (v) => `${Math.round(v / 0.6 * 100)} %`),
      mfSlider('🔁 Écho', 'echo', 0, 0.5, 0.02, (m) => m.echoG.gain.setTargetAtTime(MF.echo, audioCtx().currentTime, 0.03), (v) => v ? `${Math.round(v / 0.5 * 100)} %` : 'aucun')),
    h('div.row', h('div.grow', tuneSel), latLbl),
    h('p.tiny.muted', 'Ces réglages changent ce que tu entends dans le casque, en direct. La prise, elle, reste propre (tu appliques les vrais effets ensuite). L’autotune casque est un modèle rapide : il ajoute ~20 ms.'));

  function stopMonitor(keepTest = false) {
    try { monitor?.src.disconnect(); monitor?.out.disconnect(); } catch {}
    monitor = null;
    if (!keepTest && monTestStream) { micMeter.detach(); monTestStream.getTracks().forEach(t => t.stop()); monTestStream = null; monTestBtn.textContent = '🎧 Tester le retour'; }
  }
  const micConstraints = () => {
    const base = rawMode.checked ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    // Avec le retour casque, l'annulation d'écho coupe ou déforme sa propre voix : on la désactive (casque obligatoire)
    return monOn.checked ? { ...base, echoCancellation: false, latency: 0 } : base;
  };
  const monTestBtn = h('button.btn.small.ghost', '🎧 Tester le retour');
  monTestBtn.onclick = async () => {
    if (monTestStream) { stopMonitor(); return; }
    try {
      monTestStream = await navigator.mediaDevices.getUserMedia({ audio: { ...micConstraints(), echoCancellation: false } });
      await startMonitor(monTestStream); micMeter.attachNode(monitor.inG); monTestBtn.textContent = '⏹ Arrêter le test';
      toast('Parle : tu t’entends dans le casque. Casque filaire conseillé (le Bluetooth ajoute du retard).');
    } catch (e) { toast('Micro inaccessible : ' + e.message, 'bad'); }
  };
  let timer;
  let ast = null, recAuto = null;
  const stopping = { p: null };
  recBtn.onclick = () => (recorder ? stopRec() : startRec().catch(() => {}));
  async function stopRec() {
    if (!recorder) return stopping.p;
    stopping.p = (async () => {
      recAuto = null;
      clearInterval(timer);
      stopMonitor(); metro.stop();
      const r = recorder; recorder = null;
      try { beatSrc?.stop(); } catch {} beatSrc = null; stopLive(false); seekPos = recFrom; outMeter.detach();
      recBtn.textContent = '⏺ Enregistrer'; meter.firstChild.style.width = '0';
      micMeter.detach();
      const blob = await r.stop();
      delItem(PKEY).catch(() => {});
      // Punch-in : on ne crée pas de nouvelle piste, on remplace le passage sélectionné (prise d'avant gardée).
      if (punch) {
        const p = punch; punch = null;
        try {
          const rec = await decodeBlob(blob); const tk = p.track, sr = tk.buffer.sampleRate;
          const base = tk.buffer.getChannelData(0); const inS = Math.floor(p.in * sr), outS = Math.floor(p.out * sr);
          const patch = new Float32Array(base.length), rc = rec.getChannelData(0);
          for (let i = 0; i < rc.length && inS + i < patch.length; i++) patch[inS + i] = rc[i];
          const out = punchInMono(base, patch, inS, outS, Math.floor(0.01 * sr));
          addTake(tk, tk.buffer, 'Avant punch'); pushUndo(tk, { buffer: tk.buffer, fxDone: (tk.fxDone || []).slice(), label: 'Punch-in' });
          tk.buffer = monoToBuffer(out, sr); tk.original = tk.buffer; masterResult = null;
          selected = tracks.indexOf(tk); drawList(); drawEdit(); updUndo();
          toast('Punch appliqué : passage réenregistré (fondu de 10 ms) ✓', 'ok');
        } catch (e) { toastErr(e); }
        if (monOn.checked) openLiveMonitor();
        stopping.p = null; ast?.onRecordStopped(); return;
      }
      // Calage automatique : la prise commence avant l'instru (temps de démarrage) et arrive en retard
      // (latence du casque + du micro). On replace la voix sur l'instru, puis on affine sur le beat.
      const lat = recLatency; recLatency = null;
      const armed = tracks.find(t => t.armed);
      await addBlob(blob, armed ? armed.name : `Prise ${tracks.filter(t => t.kind === 'voix').length + 1}`, 'voix', null, recFrom - (lat || 0) + recMinOff);
      const take = tracks[tracks.length - 1];
      if (take && armed && take !== armed) {
        tracks.pop();
        if (armed.empty) { Object.assign(armed, { buffer: take.buffer, original: take.buffer, offset: take.offset, empty: false }); selected = tracks.indexOf(armed); }
        else { // piste déjà enregistrée et armée : on EMPILE une nouvelle prise (comping)
          ensureTakes(armed); armed.takes.push({ name: `Prise ${armed.takes.length + 1}`, buffer: take.buffer });
          armed.activeTake = armed.takes.length - 1; armed.buffer = take.buffer; armed.original = take.buffer;
          selected = tracks.indexOf(armed);
        }
        drawList(); drawEdit();
      }
      if (tracks[selected]?.kind === 'voix' && !armed) tracks[selected].gainDb = voiceBusDb;
      beatGainNode = null; saveSoon(true);
      if (monOn.checked) openLiveMonitor();
      if (lat && tracks.some(t => t.kind === 'instru')) await alignSelected(true);
      // Ingé son IA : traitement automatique de la prise (en local), si activé.
      const ingeTake = tracks[selected];
      if (ingePrefs.enabled && ingePrefs.autoProcess && ingeTake && ingeTake.kind === 'voix') { try { await processTake(ingeTake); } catch (e) { toastErr(e); } }
      stopping.p = null;
      ast?.onRecordStopped();
    })();
    return stopping.p;
  }
  async function startRec({ autoStopSilence = 0, autoStopBeat = false, seconds = 0 } = {}) {
    if (recorder) return;
    try {
      stopMonitor();
      if (transport.countIn > 0) { recBtn.textContent = '① Décompte…'; await playCountIn(); }
      const constraints = micConstraints();
      const beat = tracks.find(t => t.kind === 'instru' && !t.mute);
      recAuto = { sil: autoStopSilence, spoke: false, last: performance.now() };
      let lastPend = 0;
      const pendOffset = 0;
      recorder = await startRecorder({ constraints, gainDb: inGainDb, onChunk: (chunks) => {
        const now = performance.now(); if (now - lastPend < 2000) return; lastPend = now;
        putItem(PKEY, { chunks: chunks.slice(), type: chunks[0]?.type, offset: pendOffset }).catch((e) => console.warn('prise en cours non sauvegardée', String(e)));
      }, onLevel: (l) => {
        meter.firstChild.style.width = Math.min(100, l * 300) + '%';
        // arrêt automatique après X s de silence (mode mains libres), une fois que la voix a commencé
        const a = recAuto; if (!a?.sil || !recorder) return;
        const now = performance.now();
        if (l > 0.025) { a.spoke = true; a.last = now; }
        else if (a.spoke && now - a.last > a.sil * 1000) { recAuto = null; toast(`Silence de ${a.sil} s : prise arrêtée.`); stopRec(); }
      } });
      if (monOn.checked) startMonitor(recorder.stream);
      micMeter.attachStream(recorder.stream);
      const recT0 = performance.now();
      recLatency = null;
      recFrom = seekPos; recMinOff = minOffNow();
      if (withBeat.checked && tracks.some(t => !t.empty && !effMute(t))) {
        // on joue TOUT le projet (instru + autres voix) depuis la tête de lecture : on peut poser des backs sur sa voix
        const ctx = audioCtx();
        playLive(seekPos, null, autoStopBeat && beat ? () => { if (recorder) { toast('Fin du morceau : prise arrêtée.'); stopRec(); } } : null);
        const beatT0 = performance.now() + (live.ctxStart - ctx.currentTime) * 1000;
        const outLat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
        const inLat = Number((recorder.raw || recorder.stream).getAudioTracks()[0]?.getSettings?.().latency) || 0.02;
        recFrom = live.from;
        recLatency = (beatT0 - recT0) / 1000 + outLat + inLat;
        if (beat) toast('Instru lancée : casque conseillé pour qu’elle ne s’entende pas dans la prise.');
      }
      recBtn.textContent = '⏹ Arrêter';
      if (transport.metro) metro.start();
      timer = setInterval(() => { recTime.textContent = fmtTime(recorder?.duration); }, 200);
      if (seconds > 0) { const r0 = recorder; setTimeout(() => { if (recorder === r0) { toast(`${seconds} s enregistrées : prise arrêtée.`); stopRec(); } }, seconds * 1000); }
      ast?.onRecordStarted();
    } catch (e) { recorder = null; recAuto = null; toast('Micro inaccessible : ' + e.message, 'bad'); throw e; }
  }

  // ---------- Liste des pistes ----------
  function drawList() {
    saveSoon(); syncInstru?.();
    timeline?.render(); if (typeof renderKnobs === 'function' && knobSel !== tracks[selected]) { knobSel = tracks[selected]; renderKnobs(); }
    if (typeof renderMixer === 'function') renderMixer();
  }

  // ---------- Édition de la piste sélectionnée ----------
  function redrawSelected() { timeline?.render(); }
  const playSelBtn = h('button.btn.small', '▶ Piste');
  playSelBtn.onclick = () => {
    const t = tracks[selected]; if (!t) return;
    if (player.playing) { player.pause(); playSelBtn.textContent = '▶ Piste'; return; }
    stopLive(); player.load(t.buffer); player.play(sel && timeline?.selTrack() === t ? sel[0] : 0); playSelBtn.textContent = '⏸';
  };
  const busy = h('span.small.muted');
  async function work(label, fn) {
    const t = tracks[selected]; if (!t) return;
    busy.innerHTML = `<span class="spinner"></span> ${label}`;
    player.stop();
    try {
      const before = { buffer: t.buffer, fxDone: (t.fxDone || []).slice(), label: label.replace('…', '') };
      // Effet sur le seul passage sélectionné (avec un fondu enchaîné aux bords pour ne pas « claquer »)
      const region = onlySel.checked && sel && timeline?.selTrack() === t && !/Suppression|Rognage|Silence|Retour|Coupe|Fondus|Restauration|Enlever/.test(label);
      const out = region ? await processRegion(t.buffer, sel, (part) => fn(part, t)) : await fn(t.buffer, t);
      if (out && out !== t.buffer) { pushUndo(t, before); t.buffer = out; }
      masterResult = null; drawList(); redrawSelected(); updUndo();
      busy.textContent = `✓ ${label.replace('…', '')} terminé · « ↩ Annuler » pour revenir en arrière`;
    }
    catch (e) { busy.textContent = ''; toastErr(e); }
  }
  const onlySel = h('input', { type: 'checkbox', checked: true });
  async function processRegion(b, [s0, s1], fn) {
    const sr = b.sampleRate, ctxPad = 0.3;
    const p0 = Math.max(0, s0 - ctxPad), p1 = Math.min(b.duration, s1 + ctxPad);
    const pr = await fn(sliceBuffer(b, p0, p1));
    const nch = Math.max(b.numberOfChannels, pr.numberOfChannels), out = makeBuffer(nch, b.length, sr);
    const a = Math.floor(s0 * sr), z = Math.min(b.length, Math.floor(s1 * sr)), off = Math.floor(p0 * sr), fade = Math.max(1, Math.floor(0.015 * sr));
    for (let c = 0; c < nch; c++) {
      const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1)), fx = pr.getChannelData(Math.min(c, pr.numberOfChannels - 1)), d = out.getChannelData(c);
      d.set(src);
      for (let i = Math.max(0, a - fade); i < Math.min(b.length, z + fade); i++) {
        const k = Math.min(1, (i - (a - fade)) / fade, ((z + fade) - i) / fade), v = fx[i - off] ?? src[i];
        d[i] = src[i] * (1 - k) + v * k;
      }
    }
    return out;
  }
  // ---------- Historique : annuler / rétablir à chaque étape ----------
  const UNDO_MAX = 8;
  function pushUndo(t, snap) {
    (t.undo ||= []).push(snap); if (t.undo.length > UNDO_MAX) t.undo.shift();
    t.redo = [];
  }
  const undoBtn = h('button.btn.small', '↩ Annuler');
  const redoBtn = h('button.btn.small.ghost', '↪ Rétablir');
  function updUndo() {
    const t = tracks[selected];
    const u = t?.undo?.length || 0, r = t?.redo?.length || 0;
    undoBtn.disabled = !u; redoBtn.disabled = !r;
    undoBtn.textContent = u ? `↩ Annuler « ${t.undo[u - 1].label} »` : '↩ Annuler';
    redoBtn.textContent = r ? `↪ Rétablir « ${t.redo[r - 1].label} »` : '↪ Rétablir';
  }
  function stepHistory(fromKey, toKey) {
    const t = tracks[selected]; const snap = t?.[fromKey]?.pop(); if (!snap) return;
    player.stop();
    (t[toKey] ||= []).push({ buffer: t.buffer, fxDone: (t.fxDone || []).slice(), label: snap.label });
    t.buffer = snap.buffer; t.fxDone = snap.fxDone; masterResult = null;
    drawList(); redrawSelected(); updUndo();
    busy.textContent = fromKey === 'undo' ? `↩ « ${snap.label} » annulé` : `↪ « ${snap.label} » rétabli`;
  }
  undoBtn.onclick = () => stepHistory('undo', 'redo');
  redoBtn.onclick = () => stepHistory('redo', 'undo');

  // ---------- Aperçu : écouter 15 s avant d'appliquer à toute la piste ----------
  function voiceStart(t) {
    const d = t.buffer.getChannelData(0);
    for (let i = 0; i < d.length; i += 512) if (Math.abs(d[i]) > 0.02) return Math.max(0, i / t.buffer.sampleRate - 0.2);
    return 0;
  }
  const previewLen = h('select', { onchange: () => localStorage.setItem('studio.prevLen', previewLen.value) },
    ...[['15', 'Écouter 15 s'], ['30', 'Écouter 30 s'], ['60', 'Écouter 1 min'], ['0', 'Écouter toute la piste']].map(([v, l]) => h('option', { value: v, selected: (localStorage.getItem('studio.prevLen') || '30') === v }, l)));
  function makePreview() {
    const info = h('span.small.muted');
    const audio = h('audio', { controls: true, style: { width: '100%', display: 'none' } });
    let urls = null, applyFn = null;
    const ab = (which) => { if (!urls) return; const ti = audio.currentTime; audio.src = urls[which]; audio.currentTime = ti; audio.play().catch(() => {}); };
    const applyBtn = h('button.btn.small.primary', { onclick: () => applyFn?.() }, '✅ Appliquer à toute la piste');
    const bar = h('div.row', { style: { display: 'none' } },
      h('button.btn.small', { onclick: () => ab('a') }, 'A · avant'),
      h('button.btn.small', { onclick: () => ab('b') }, 'B · après'),
      applyBtn);
    const box = h('div.stack', info, audio, bar);
    async function run(label, process, onApply) {
      const t = tracks[selected]; if (!t) return toast('Sélectionne une piste de voix.');
      const say = (m) => { info.innerHTML = `<span class="spinner"></span> ${m}`; };
      say('Préparation de l’extrait de 15 s…'); player.stop();
      try {
        // passage sélectionné sur cette piste ? on écoute exactement celui-là ; sinon la durée choisie
        const useSel = sel && timeline?.selTrack() === t && sel[1] - sel[0] > 0.3;
        const len = Number(previewLen.value) || t.buffer.duration;
        const st = useSel ? sel[0] : len >= t.buffer.duration ? 0 : voiceStart(t);
        const part = sliceBuffer(t.buffer, st, useSel ? sel[1] : Math.min(t.buffer.duration, st + len));
        const r = await process(part, t, st, say);
        if (urls) Object.values(urls).forEach(u => URL.revokeObjectURL(u));
        urls = { a: URL.createObjectURL(encodeWav(part)), b: URL.createObjectURL(encodeWav(r.buffer || r)) };
        audio.src = urls.b; audio.style.display = ''; bar.style.display = ''; audio.play().catch(() => {});
        applyFn = onApply; applyBtn.style.display = onApply ? '' : 'none';
        info.textContent = `▶ Aperçu « ${label} » (${fmtTime(part.duration)})${r.note ? ' · ' + r.note : ''} — compare A/B puis applique si ça te plaît.`;
        return r;
      } catch (e) { info.textContent = ''; toastErr(e); }
    }
    return { box, run, info, audio, bar };
  }
  // ---------- Effets voix & autotune ----------
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const FAV = '⭐ Mes favoris', MINE = '💾 Mes réglages';
  const fxCat = h('select');
  const fillCats = () => {
    const fav = lsGet('studio_vfx_fav', []), mine = lsGet('studio_vfx_mine', []), cur = fxCat.value;
    fxCat.innerHTML = '';
    if (mine.length) fxCat.append(h('option', { value: MINE }, `${MINE} (${mine.length})`));
    if (fav.length) fxCat.append(h('option', { value: FAV }, `${FAV} (${fav.length})`));
    VFX_CATS.forEach(c => fxCat.append(h('option', { value: c }, `${c} (${VFX.filter(p => p.cat === c).length})`)));
    if ([...fxCat.options].some(o => o.value === cur)) fxCat.value = cur; else fxCat.value = VFX_CATS[0];
  };
  const fxSel = h('select');
  const fxKey = h('select', KEY_CHOICES.map(k => h('option', { value: k.v }, k.label)));
  // une entrée = { name, steps: [noms de préréglages appliqués l'un après l'autre] }
  const resolve = (val) => {
    if (String(val).startsWith('mine:')) {
      const m = lsGet('studio_vfx_mine', [])[+val.slice(5)]; if (!m) return null;
      if (m.custom) return { name: m.name, list: [{ name: m.name, chain: sanitizeChain(m.custom.chain), voice: sanitizeVoice(m.custom.voice) }] };
      return { name: m.name, list: m.steps.map(n => VFX.find(p => p.name === n)).filter(Boolean) };
    }
    const p = VFX[+val]; return p && { name: p.name, list: [p] };
  };
  const fillFx = () => {
    fxSel.innerHTML = '';
    if (fxCat.value === MINE) lsGet('studio_vfx_mine', []).forEach((m, i) => fxSel.append(h('option', { value: `mine:${i}` }, m.custom ? `${m.name} (sur mesure)` : `${m.name} (${m.steps.length} effets)`)));
    else if (fxCat.value === FAV) { const fav = lsGet('studio_vfx_fav', []); VFX.forEach((p, i) => { if (fav.includes(p.name)) fxSel.append(h('option', { value: i }, p.name)); }); }
    else VFX.forEach((p, i) => { if (p.cat === fxCat.value) fxSel.append(h('option', { value: i }, p.name)); });
  };
  fxCat.onchange = fillFx; fillCats(); fillFx();
  const fxKeyOpt = () => { if (!fxKey.value) return null; const [root, mode] = fxKey.value.split('|'); return { root: +root, mode }; };
  const chordCache = new WeakMap();
  async function chordsFor(t, startInTrack, say) {
    const beat = tracks.find(x => x.kind === 'instru' && x !== t);
    if (!beat) return null;
    let ch = chordCache.get(beat.buffer);
    if (!ch) { say('Lecture des accords de l’instru…'); ch = await detectChords(beat.buffer); chordCache.set(beat.buffer, ch); }
    // temps de l'instru → temps local de l'extrait de voix
    const shift = startInTrack + (t.offset || 0) - (beat.offset || 0);
    return ch.map(c => ({ ...c, t: c.t - shift }));
  }
  async function runList(buf, list, t, startInTrack, say) {
    let key = fxKeyOpt(), cur = buf;
    for (const p of list) {
      if (p.chain?.length) {
        // l'instru donne la tonalité et les accords : l'autotune vise les bonnes notes même si la voix est fausse
        const chords = (p.chords || p.chain.some(s => s.t === 'tune' || s.t === 'harmony')) ? await chordsFor(t, startInTrack, say) : null;
        if (!key && chords?.length) key = keyFromChords(chords);
        const r = await applyChain(cur, p.chain, { key, chords, onProgress: say });
        cur = r.buffer; key = key || r.key;
      }
      // EQ / compression / réverbe de la voix après l'autotune (la justesse est analysée sur la voix sèche)
      if (p.voice) { say('Traitement voix…'); cur = await voiceChain(cur, p.voice); }
    }
    return { buffer: cur, key };
  }
  const fxPrev = makePreview();
  async function fxPreview(btn, next = false) {
    if (next && fxSel.options.length) fxSel.selectedIndex = (fxSel.selectedIndex + 1) % fxSel.options.length;
    const item = resolve(fxSel.value); if (!item) return;
    btn.disabled = true;
    await fxPrev.run(item.name, async (part, t, st, say) => {
      const r = await runList(part, item.list, t, st, say);
      const noInstru = item.list.some(p => p.chords) && !tracks.some(x => x.kind === 'instru' && x !== t);
      return { buffer: r.buffer, note: `${r.key ? `tonalité ${keyName(r.key)}` : ''}${noInstru ? ' · sans instru : harmonies sur la gamme' : ''}` };
    }, () => applyItem(item));
    btn.disabled = false;
  }
  const applyItem = (item) => work(`Effet « ${item.name} »…`, async (b, tr) => {
    const r = await runList(b, item.list, tr, 0, (m) => { busy.innerHTML = `<span class="spinner"></span> ${m}`; });
    tr.fxDone = [...(tr.fxDone || []), ...item.list.map(p => p.name)];
    return r.buffer;
  });
  const fxApply = () => { const item = resolve(fxSel.value); if (item) applyItem(item); };
  const QUICK_TUNE = [['🎯 Juste parfait', 'Justesse parfaite (note par note)'], ['🎤 Léger', 'Justesse naturelle (note par note)'], ['🎤 Moyen (Drake)', 'Rap mélodique note par note'], ['🤖 Fort (T-Pain)', 'Hard-tune note par note'], ['✨ Belle voix chantée', 'Belle voix chantée (juste + douce)']];
  const tunePrev = makePreview();
  const noteEd = createNoteEditor({
    track: () => tracks[selected],
    chords: async (t) => { try { return await chordsFor(t, 0, () => {}); } catch { return null; } },
    keyOpt: () => fxKeyOpt(),
    apply: (t, b, label) => { selected = tracks.indexOf(t); return work(label + '…', async () => b); },
    preview: (b) => { const t = tracks[selected]; if (!t) return; const old = t.buffer; t.buffer = b; playLive(seekPos); t.buffer = old; },
  });
  // ---------- Mon autotune sur mesure : je règle moi-même et je garde mes réglages ----------
  const MT = Object.assign({ ...DEFAULT_PRO }, (() => { try { return JSON.parse(localStorage.getItem('studio.mytune')) || {}; } catch { return {}; } })());
  const saveMT = () => { try { localStorage.setItem('studio.mytune', JSON.stringify(MT)); } catch {} };
  const myTuneItem = () => ({ name: proName(MT), list: [{ name: 'Autotune Pro', chain: [buildTuneStep(MT)] }] });
  const mtRefs = {};
  const mtSlider = (label, key, min, max, step, fmt, help) => {
    const b = h('b', fmt(MT[key]));
    const inp = h('input', { type: 'range', min, max, step, value: MT[key], oninput: (e) => { MT[key] = Number(e.target.value); b.textContent = fmt(MT[key]); saveMT(); } });
    mtRefs[key] = { inp, b, fmt };
    return h('label', { title: help }, h('span', label + ' ', b), inp);
  };
  const tuneKeyLbl = h('span.tiny.muted', 'Tonalité : auto');
  async function detectTuneKey(btn) {
    const t = tracks[selected];
    const src = (t && t.kind === 'voix') ? t : tracks.find(x => x.kind === 'instru');
    if (!src) return toast('Sélectionne une voix, ou importe l’instru, puis réessaie.');
    const old = btn.textContent; btn.disabled = true; btn.textContent = '… analyse';
    try {
      const key = detectKey(await detectPitch(src.buffer));
      const val = `${key.root}|${key.mode}`;
      if ([...fxKey.options].some(o => o.value === val)) fxKey.value = val;
      tuneKeyLbl.textContent = `Tonalité : ${keyName(key)}`;
      toast(`Tonalité détectée : ${keyName(key)}`, 'ok');
    } catch (e) { toastErr(e); } finally { btn.textContent = old; btn.disabled = false; }
  }
  const voiceSel = h('select', VOICE_TYPE_ORDER.map(v => h('option', { value: v, selected: v === MT.voice }, VOICE_TYPES[v].label)));
  voiceSel.onchange = () => { MT.voice = voiceSel.value; MT.formant = formantForVoice(MT.voice); if (mtRefs.formant) { mtRefs.formant.inp.value = MT.formant; mtRefs.formant.b.textContent = mtRefs.formant.fmt(MT.formant); } saveMT(); };
  const syncMT = () => { for (const k in mtRefs) { mtRefs[k].inp.value = MT[k]; mtRefs[k].b.textContent = mtRefs[k].fmt(MT[k]); } voiceSel.value = VOICE_TYPES[MT.voice] ? MT.voice : 'naturel'; saveMT(); };
  const fmtSemi = (v) => v ? `${v > 0 ? '+' : ''}${v}` : '0';
  const myTuneBox = h('div.stack',
    h('div.row', h('span.small.grow', '🎚️ Autotune Pro — mode Auto'), h('button.btn.small', { onclick: (e) => detectTuneKey(e.target) }, '🎯 Détecter la tonalité'), tuneKeyLbl),
    h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } }, PRO_PRESET_ORDER.map(k => h('button.btn.small.ghost', { onclick: () => { Object.assign(MT, applyPreset(k, MT)); syncMT(); toast(`Préset « ${PRO_PRESETS[k].label} » chargé`, 'ok'); } }, PRO_PRESETS[k].label))),
    h('div.sliders',
      mtSlider('⚡ Vitesse de correction', 'glide', 0, 400, 1, (v) => v <= 5 ? `${v} ms (robot)` : v < 25 ? `${v} ms (rap mélodique)` : v < 70 ? `${v} ms (naturel)` : v <= 150 ? `${v} ms (doux)` : `${v} ms (très doux)`, 'Plus c’est bas, plus la note est collée tout de suite (effet robot à 0). Jusqu’à 400 ms pour un rendu très naturel.'),
      mtSlider('🌿 Naturel (garde ton vibrato)', 'keep', 0, 0.7, 0.05, (v) => `${Math.round(v * 100)} %`, '0 % = notes parfaitement plates ; plus haut = on garde tes glissés et ton vibrato'),
      mtSlider('🎯 Force', 'strength', 0, 1, 0.05, (v) => `${Math.round(v * 100)} %`, 'À quel point la note est ramenée vers la note juste'),
      mtSlider('🎲 Humanize', 'humanize', 0, 1, 0.05, (v) => v ? `${Math.round(v * 100)} %` : 'non', 'Laisse un petit écart naturel par note : évite le rendu trop robotique'),
      mtSlider('🎛️ Transpose', 'transpose', -12, 12, 1, (v) => v ? `${fmtSemi(v)} demi-tons` : '0', 'Monte ou descend toutes les notes (ex. +12 = une octave plus haut)'),
      mtSlider('🧑 Formant (timbre)', 'formant', -6, 6, 0.5, fmtSemi, 'Change le timbre (plus grave/aigu) sans changer la note')),
    h('div.row', h('span.small', '🗣️ Type de voix :'), h('div.grow', voiceSel)),
    h('div.row',
      h('button.btn.small', { onclick: () => { const it = myTuneItem(); tunePrev.run(it.name, async (part, t, st, say) => { const r = await runList(part, it.list, t, st, say); return { buffer: r.buffer, note: r.key ? `tonalité ${keyName(r.key)}` : '' }; }, () => applyItem(it)); } }, '▶ Écouter (A/B)'),
      h('button.btn.small.primary', { onclick: () => applyItem(myTuneItem()) }, '✅ Appliquer'),
      h('button.btn.small.ghost', { onclick: async () => {
        const name = await promptBox('Nom de ton réglage d’autotune', proName(MT)); if (!name) return;
        const mine = lsGet('studio_vfx_mine', []); mine.push({ name, steps: [], custom: { chain: [buildTuneStep(MT)], voice: null } }); lsSet('studio_vfx_mine', mine);
        fillCats(); toast(`« ${name} » gardé dans 💾 Mes réglages (menu Effets voix)`, 'ok');
      } }, '💾 Garder ce réglage')),
    h('p.tiny.muted', 'Mode Auto : charge un préset ou règle à la main, écoute en A/B, puis applique. La tonalité vient de ton instru, du bouton « Détecter », ou du menu « Tonalité » plus bas. Pour corriger note par note (mode Graphique), utilise l’éditeur de notes ci-dessus. Tes réglages gardés se retrouvent dans « 🎛️ Effets voix & autotune » → « 💾 Mes réglages ».'));
  const quickTune = (label, name) => {
    const p = VFX.find(x => x.name === name); if (!p) return toast('Préréglage introuvable : ' + name, 'bad');
    const item = { name: `Autotune ${label.replace(/^\S+ /, '')}`, list: [p] };
    tunePrev.run(item.name, async (part, t, st, say) => {
      const r = await runList(part, item.list, t, st, say);
      return { buffer: r.buffer, note: r.key ? `tonalité ${keyName(r.key)}` : '' };
    }, () => applyItem(item));
  };
  const fxFav = () => {
    const item = resolve(fxSel.value); if (!item || String(fxSel.value).startsWith('mine:')) return;
    const fav = lsGet('studio_vfx_fav', []); const i = fav.indexOf(item.name);
    if (i >= 0) { fav.splice(i, 1); toast('Retiré des favoris'); } else { fav.push(item.name); toast('Ajouté aux favoris ⭐', 'ok'); }
    lsSet('studio_vfx_fav', fav); fillCats(); if (fxCat.value === FAV) fillFx();
  };
  const fxSave = () => {
    const t = tracks[selected];
    if (!t?.fxDone?.length) return toast('Applique d’abord un ou plusieurs effets sur la piste : je mémorise la combinaison.');
    const name = prompt('Nom de ton réglage :', t.fxDone.join(' + ').slice(0, 60)); if (!name) return;
    const mine = lsGet('studio_vfx_mine', []); mine.push({ name, steps: t.fxDone.slice() }); lsSet('studio_vfx_mine', mine);
    fillCats(); fxCat.value = MINE; fillFx(); toast(`Réglage « ${name} » enregistré (${mine.length}/250)`, 'ok');
  };

  const nrAmount = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: 0.6 });
  const presetSel = h('select', Object.entries(VOICE_PRESETS).map(([k, p]) => h('option', { value: k }, p.label)));
  const vc = { ...VOICE_PRESETS.rap };
  const vcBox = h('div.sliders');
  const drawVc = () => {
    vcBox.innerHTML = '';
    for (const [k, l, min, max, step] of [['highpass', 'Coupe-bas (Hz)', 40, 200, 5], ['low', 'Graves (dB)', -6, 6, 0.5], ['presence', 'Présence (dB)', -4, 8, 0.5], ['air', 'Brillance (dB)', -4, 8, 0.5], ['deess', 'Anti-sifflantes (dB)', 0, 10, 0.5], ['comp', 'Compression', 0, 1, 0.05], ['reverb', 'Réverbération', 0, 0.6, 0.02]]) {
      const b = h('b', vc[k]);
      vcBox.append(h('label', h('span', l, ' ', b), h('input', { type: 'range', min, max, step, value: vc[k], oninput: (e) => { vc[k] = Number(e.target.value); b.textContent = vc[k]; } })));
    }
  };
  presetSel.onchange = () => { Object.assign(vc, VOICE_PRESETS[presetSel.value]); drawVc(); };
  drawVc();
  const vcPrev = makePreview();
  const vcItem = () => ({ name: presetSel.options[presetSel.selectedIndex]?.text || 'Voix', list: [{ name: 'Traitement voix', voice: { ...vc } }] });

  // ---------- 🪄 Décris ta voix : l'IA propose des réglages à écouter ----------
  const aiDesc = h('textarea', { rows: 3, placeholder: 'Ex. : voix Drake chaude et posée, autotune léger, un peu d’écho · ou : voix de JUL bien aiguë et brillante · ou : refrain mélodique avec harmonies' });
  aiDesc.value = localStorage.getItem('studio.vfx.desc') || '';
  const aiInfo = h('span.small.muted');
  const aiList = h('div.stack');
  const aiPrev = makePreview();
  async function aiPropose(btn) {
    const desc = aiDesc.value.trim();
    if (!desc) return toast('Décris d’abord le son que tu veux.');
    localStorage.setItem('studio.vfx.desc', desc);
    btn.disabled = true; aiInfo.innerHTML = '<span class="spinner"></span> L’IA prépare 3 réglages…'; aiList.innerHTML = '';
    try {
      const r = await api('/api/complete', { method: 'POST', body: { src: 'musique', projectId: state.projectId, temperature: 0.7, json: true, system: VFX_AI_PROMPT, prompt: `Son voulu : ${desc}` } });
      const j = parseJsonLoose(r.content);
      const props = (j?.propositions || []).map(p => ({ name: String(p.nom || 'Réglage').slice(0, 60), why: String(p.pourquoi || '').slice(0, 200), chain: sanitizeChain(p.chaine), voice: sanitizeVoice(p.voix) }))
        .filter(p => p.chain.length || p.voice).slice(0, 4);
      if (!props.length) throw new Error('L’IA n’a pas renvoyé de réglage utilisable. Réessaie (ou reformule).');
      aiInfo.textContent = `${props.length} réglages proposés (via ${r.routedVia || 'IA'}). Écoute-les sur ta voix, applique celui que tu préfères.`;
      for (const p of props) {
        const item = { name: p.name, list: [{ name: p.name, chain: p.chain, voice: p.voice }] };
        aiList.append(h('div.card.stack', { style: { padding: '10px' } },
          h('strong', '🪄 ' + p.name), p.why ? h('span.small.muted', p.why) : '',
          h('span.tiny.muted', describeChain(p)),
          h('div.row',
            h('button.btn.small', { onclick: () => aiPrev.run(p.name, async (part, t, st, say) => { const x = await runList(part, item.list, t, st, say); return { buffer: x.buffer, note: x.key ? `tonalité ${keyName(x.key)}` : '' }; }, () => applyItem(item)) }, '▶ Écouter'),
            h('button.btn.small.primary', { onclick: () => applyItem(item) }, '✅ Appliquer'),
            h('button.btn.small.ghost', { onclick: () => {
              const mine = lsGet('studio_vfx_mine', []); mine.push({ name: p.name, steps: [], custom: { chain: p.chain, voice: p.voice }, desc }); lsSet('studio_vfx_mine', mine);
              fillCats(); toast(`« ${p.name} » ajouté à 💾 Mes réglages`, 'ok');
            } }, '💾 Garder'))));
      }
    } catch (e) { aiInfo.textContent = ''; toastErr(e); }
    btn.disabled = false;
  }

  function drawEdit() {
    editBox.innerHTML = '';
    const t = tracks[selected];
    if (!t) { editBox.append(h('p.muted.small', 'Sélectionnez une piste pour l’éditer.')); return; }
    editBox.append(
      h('div.row', h('h3.grow', `🎛️ Effets sur : ${t.kind === 'instru' ? '🥁' : '🎤'} ${t.name}`), playSelBtn),
      h('p.tiny.muted', 'Choisis la piste en cliquant dessus dans « Mes pistes ». Pour couper un passage : outil ⬚ Sélectionner, glisse sur la prise, puis « Supprimer ce passage ».'),
      h('div.row.undo-bar', { style: { position: 'sticky', bottom: '0', zIndex: 5, background: 'var(--card, var(--bg))', padding: '6px 0' } }, undoBtn, redoBtn, h('div.grow', busy)),
      h('label.chk.small', onlySel, 'Si un passage est sélectionné (⬚), n’appliquer les effets qu’à ce passage'),
      h('div.row',
        h('button.btn.small', { onclick: () => work('Fondus…', async (b) => { const o = cloneBuffer(b); const n = Math.min(o.length / 2, Math.floor(0.03 * o.sampleRate)); for (let c = 0; c < o.numberOfChannels; c++) { const d = o.getChannelData(c); for (let i = 0; i < n; i++) { d[i] *= i / n; d[d.length - 1 - i] *= i / n; } } return o; }) }, 'Fondus début/fin'),
        h('button.btn.small', { onclick: () => work('Normalisation…', async (b) => normalize(cloneBuffer(b), -1)) }, 'Normaliser'),
        h('button.btn.small.ghost', { onclick: () => work('Retour à l’original…', async (b, tr) => tr.original) }, '↺ Revenir à l’original')),
      ...(t.kind === 'voix' ? takesSection(t) : []),
      h('h3', '🎯 Caler sur le beat'),
      h('div.row', h('button.btn.small', { onclick: () => alignSelected() }, '🎯 Caler cette voix sur l’instru'), alignInfo),
      h('p.tiny.muted', 'Les prises enregistrées ici sur l’instru sont recalées automatiquement (latence du casque et du micro). Ce bouton affine au milliseconde près en alignant tes attaques sur les frappes de l’instru ; le curseur « Décalage » permet de corriger à la main.'),
      h('h3', '🧹 Nettoyer'),
      h('div.row', h('label.f.grow', 'Intensité du débruitage', nrAmount),
        h('button.btn.small', { onclick: () => work('Débruitage…', (b) => denoise(b, Number(nrAmount.value), (p) => { busy.innerHTML = `<span class="spinner"></span> Débruitage ${Math.round(p * 100)} %`; })) }, '🧹 Réduire le bruit de fond'),
        h('button.btn.small', { onclick: () => work('Anti-pop…', async (b) => antipop(b, 0.8)) }, '💨 Anti-pop (P, B, souffles)'),
        h('button.btn.small', { onclick: () => work('Porte de bruit…', async (b) => gate(b, -45, -30)) }, '🚪 Couper les blancs')),
      h('p.tiny.muted', 'Le débruitage apprend le bruit sur les passages les plus calmes : laissez 1 à 2 secondes de silence au début de la prise.'),
      h('h3', '✨ Améliorer la voix'),
      h('div.row', h('div.grow', presetSel),
        h('button.btn.small', { onclick: () => { const it = vcItem(); vcPrev.run(it.name, async (part) => voiceChain(part, it.list[0].voice), () => work('Traitement voix…', (b) => voiceChain(b, it.list[0].voice))); } }, '▶ Écouter'),
        h('button.btn.small.primary', { onclick: () => work('Traitement voix…', (b) => voiceChain(b, { ...vc })) }, '✨ Appliquer')),
      vcBox, vcPrev.box,
      h('p.tiny.muted', 'Si tu as déjà fait « ⚡ Tout faire », la voix est déjà traitée : réappliquer en rajoute une couche. Écoute d’abord, et « ↩ Annuler » si ce n’est pas mieux.'),
      h('h3', '🎤 Autotune chanté en 1 clic'),
      h('div.row', ...QUICK_TUNE.map(([label, name]) => h('button.btn.small', { onclick: () => quickTune(label, name) }, label))),
      tunePrev.box,
      h('h3', '🎼 Mes notes (correction note par note)'),
      noteEd.el,
      h('h3', '🎚️ Autotune Pro'),
      myTuneBox,
      h('div.row', h('span.small', 'Durée des écoutes :'), previewLen),
      h('p.tiny.muted', 'Touche un bouton : tu écoutes d’abord 15 s de ta voix (A = avant, B = après). Rien n’est modifié tant que tu ne touches pas « ✅ Appliquer à toute la piste ». Corrigé note par note, dans la tonalité de ton instru (importe-la d’abord) : « Juste parfait » = toutes les notes justes en gardant ta voix · Léger = naturel · Moyen = façon Drake · Fort = robot T-Pain · Belle voix = juste, doublée, douce.'),
      h('h3', '🪄 Décris le son que tu veux'),
      aiDesc,
      h('div.row', h('button.btn.small.primary', { onclick: (e) => aiPropose(e.target) }, '🪄 Proposer 3 réglages'), aiInfo),
      aiList, aiPrev.box,
      h('p.tiny.muted', 'L’IA traduit ta description en réglages (autotune, EQ, écho, réverbe…). Écoute, applique, ou « 💾 Garder » pour le retrouver dans « Mes réglages ». Plus tu es précis (rappeur, ambiance, refrain ou couplet), plus c’est proche.'),
      h('h3', '🎛️ Effets voix & autotune'),
      h('div.row', h('div.grow', fxCat), h('div.grow', fxKey)),
      h('div.row', h('div.grow', fxSel),
        h('button.btn.small', { onclick: (e) => fxPreview(e.target) }, '▶ Écouter'),
        h('button.btn.small', { onclick: (e) => fxPreview(e.target, true) }, '⏭ Suivant'),
        h('button.btn.small.primary', { onclick: fxApply }, '✅ Appliquer')),
      h('div.row', h('button.btn.small.ghost', { onclick: fxFav }, '⭐ Favori'), h('button.btn.small.ghost', { onclick: fxSave }, '💾 Sauver ma combinaison')),
      fxPrev.box,
      h('p.tiny.muted', 'Écoute chaque effet sur 15 s de ta voix (A/B pour comparer), puis applique-le. Tu peux en enchaîner plusieurs puis « Sauver ma combinaison ». La tonalité est détectée toute seule ; les harmonies suivent les accords de l’instru si elle est dans tes pistes. « ↩ Annuler » revient d’une étape, « Revenir à l’original » repart de la prise brute.'),
      h('h3', '📝 Transcrire'),
      h('div.row', h('button.btn.small', { onclick: async (e) => {
        e.target.disabled = true;
        try {
          const blob = encodeWav(t.buffer.duration > 600 ? sliceBuffer(t.buffer, 0, 600) : t.buffer);
          const text = await transcribe(blob);
          modal('Transcription', h('div.stack', h('textarea', { rows: 10, value: text }), h('div.row',
            h('button.btn.small', { onclick: () => uploadFile(new Blob([text], { type: 'text/plain' }), { name: `${t.name}-transcription.txt`, source: 'transcription' }).then(() => toast('Enregistré', 'ok')) }, '💾 Enregistrer'),
            h('button.btn.small', { onclick: () => navigator.clipboard?.writeText(text) }, 'Copier'))));
        } catch (err) { toastErr(err); }
        e.target.disabled = false;
      } }, '📝 Transcrire cette piste')),
    );
    updUndo();
    drawInge();
  }

  // ---------- Calage automatique sur le beat ----------
  const alignInfo = h('span.small.muted');
  const beatCache = new WeakMap();
  async function alignTrack(t, beat) {
    let bp = beatCache.get(beat.buffer);
    if (!bp) { bp = onsetPeaks(await onsetStrength(beat.buffer, { low: 60, high: 12000 }), 1.2).map(p => ({ t: p.t + (beat.offset || 0), w: p.w })); beatCache.set(beat.buffer, bp); }
    const vp = onsetPeaks(await onsetStrength(t.buffer), 1.5);
    if (vp.length < 4) return null;
    const r = bestAlignShift(vp, bp, t.offset || 0);
    if (r.gain < 1.03) return { shift: 0, gain: r.gain };
    t.offset = (t.offset || 0) + r.shift;
    return r;
  }
  async function alignSelected(quiet = false) {
    const t = tracks[selected];
    const beat = tracks.find(x => x.kind === 'instru' && x !== t);
    if (!t || t.kind === 'instru') { if (!quiet) toast('Sélectionnez une piste de voix.'); return; }
    if (!beat) { if (!quiet) toast('Ajoutez d’abord l’instru (piste de type « Instru »).'); return; }
    alignInfo.innerHTML = '<span class="spinner"></span> Calage sur le beat…';
    try {
      const r = await alignTrack(t, beat);
      masterResult = null; drawList();
      alignInfo.textContent = !r ? 'Pas assez d’attaques dans la voix pour caler automatiquement.'
        : r.shift === 0 ? `✓ Déjà calé (décalage ${Math.round(t.offset * 1000)} ms).`
        : `✓ Calé : ${r.shift > 0 ? '+' : ''}${Math.round(r.shift * 1000)} ms (décalage total ${Math.round(t.offset * 1000)} ms).`;
    } catch (e) { alignInfo.textContent = ''; toastErr(e); }
  }
  async function doEverything(btn) {
    const voices = tracks.filter(t => t.kind === 'voix' && !t.mute);
    const beat = tracks.find(t => t.kind === 'instru' && !t.mute);
    if (!voices.length) return toast('Enregistrez ou importez au moins une voix.');
    btn.disabled = true;
    const say = (m) => { masterInfo.innerHTML = `<span class="spinner"></span> ${m}`; };
    try {
      player.stop();
      for (const [i, t] of voices.entries()) {
        const n = voices.length > 1 ? ` (voix ${i + 1}/${voices.length})` : '';
        pushUndo(t, { buffer: t.buffer, fxDone: (t.fxDone || []).slice(), label: 'Tout faire' });
        t.buffer = t.original; t.fxDone = [];
        say(`Débruitage${n}…`);
        t.buffer = await denoise(t.buffer, 0.55, (p) => say(`Débruitage ${Math.round(p * 100)} %${n}`));
        say(`Anti-pop${n}…`); t.buffer = antipop(t.buffer, 0.8);
        say(`Coupe des blancs${n}…`); t.buffer = gate(t.buffer, -45, -30);
        say(`Traitement voix rap${n}…`); t.buffer = await voiceChain(t.buffer, VOICE_PRESETS.rap);
        if (beat) { say(`Calage sur le beat${n}…`); await alignTrack(t, beat); }
        t.gainDb = 0;
      }
      if (beat) beat.gainDb = Math.min(beat.gainDb, -4);
      drawList(); drawEdit();
      await doMaster();
      toast('Morceau nettoyé, calé, mixé et masterisé ✓', 'ok');
    } catch (e) { masterInfo.textContent = ''; toastErr(e); }
    btn.disabled = false;
  }

  // ---------- Mix & master ----------
  const masterSel = h('select', Object.entries(MASTER_PRESETS).map(([k, p]) => h('option', { value: k }, p.label)));
  if (MASTER_PRESETS[ingePrefs.masterPreset]) masterSel.value = ingePrefs.masterPreset;
  masterSel.addEventListener('change', () => { ingePrefs.masterPreset = masterSel.value; saveIngePrefs(); });
  const masterInfo = h('div.small');
  const mixPlayerEl = h('div');
  const masterMeters = h('div.stack');
  const refBox = h('div.stack');
  let lastMasterMeasures = null;
  const bitSel = h('select', h('option', { value: 16 }, 'WAV 16 bits'), h('option', { value: 24 }, 'WAV 24 bits'));
  const bandBar = (label, v) => h('div', { style: { flex: 1, minWidth: '72px' } }, h('div.tiny.muted', `${label} ${Math.round(v * 100)} %`), h('div.bar', h('i', { style: { width: (v * 100) + '%' } })));
  const meterCell = (label, val, good) => h('div', { style: { minWidth: '92px' } }, h('div.tiny.muted', label), h('b.small', { style: { color: good === false ? 'var(--bad)' : good === true ? 'var(--ok)' : '' } }, val));
  function renderMasterMeters(buf, lufs) {
    masterMeters.innerHTML = '';
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const a = analyzeMaster(L, R, buf.sampleRate);
    lastMasterMeasures = { lufs, peakDb: a.peakDb, truePeakDb: a.truePeakDb, crestDb: a.crestDb, phase: a.phase, width: a.width, bands: a.bands };
    masterMeters.append(
      h('div.row', { style: { gap: '14px', flexWrap: 'wrap' } },
        meterCell('Sonie intégrée', `${lufs.toFixed(1)} LUFS`),
        meterCell('True Peak', `${a.truePeakDb.toFixed(1)} dBTP`, a.truePeakDb <= -1),
        meterCell('Crête', `${a.peakDb.toFixed(1)} dBFS`),
        meterCell('Dynamique', `${a.crestDb.toFixed(1)} dB`),
        meterCell('Phase', `${a.phase.toFixed(2)}`, a.phase >= 0),
        meterCell('Largeur', `${a.width} %`)),
      h('div.row', { style: { gap: '8px', alignItems: 'flex-end' } }, h('span.tiny.muted', 'Balance'), bandBar('Grave', a.bands.low), bandBar('Médium', a.bands.mid), bandBar('Aigu', a.bands.high)),
      a.truePeakDb > -1 ? h('p.tiny', { style: { color: 'var(--warn)' } }, `⚠️ True Peak ${a.truePeakDb.toFixed(1)} dBTP > −1 : risque d’écrêtage à l’encodage (vise −1 dBTP).`) : '');
  }
  async function analyzeReference(btn) {
    const files = await pickLocalFiles('audio/*,video/*', false); if (!files.length) return;
    btn.disabled = true; refBox.innerHTML = '<span class="spinner"></span> Analyse de la référence…';
    try {
      const buf = await decodeBlob(files[0]), L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
      const a = analyzeMaster(L, R, buf.sampleRate), lufs = Math.round((await loudness(buf)) * 10) / 10;
      const ref = { lufs, peakDb: a.peakDb, truePeakDb: a.truePeakDb, crestDb: a.crestDb, phase: a.phase, width: a.width, bands: a.bands };
      refBox.innerHTML = '';
      refBox.append(h('div.small', `Référence « ${files[0].name} » : ${lufs} LUFS · TP ${a.truePeakDb} dBTP · dynamique ${a.crestDb} dB · largeur ${a.width} % · balance ${Math.round(a.bands.low * 100)}/${Math.round(a.bands.mid * 100)}/${Math.round(a.bands.high * 100)} (grave/médium/aigu)`));
      if (lastMasterMeasures) refBox.append(h('div.card.stack', { style: { padding: '8px' } }, h('strong.small', '🎯 Pour rapprocher ton mix de la référence :'), ...compareToRef(lastMasterMeasures, ref).map(t => h('div.small', '• ' + t))));
      else refBox.append(h('p.tiny.muted', 'Fais d’abord « Mixer + masteriser » pour comparer ton mix à cette référence.'));
    } catch (e) { refBox.innerHTML = ''; toastErr(e); }
    btn.disabled = false;
  }
  async function doMaster() {
    if (!tracks.length) return toast('Ajoutez au moins une piste.');
    masterInfo.innerHTML = '<span class="spinner"></span> Mixage…';
    try {
      const minOff = Math.min(0, ...tracks.map(t => t.offset));
      const mixed = await mix(await mixInput(minOff));
      const r = await master(mixed, masterSel.value, (s) => { masterInfo.innerHTML = `<span class="spinner"></span> ${s}`; });
      masterResult = r;
      masterInfo.innerHTML = '';
      masterInfo.append(h('div', `Sonie : ${r.before.toFixed(1)} → ${r.after.toFixed(1)} LUFS (cible ${r.target}) · crête ${r.peakDb.toFixed(1)} dBFS${r.truePeakGainDb < 0 ? ` · sécurité True Peak : ${r.truePeakGainDb.toFixed(1)} dB` : ''} · durée ${fmtTime(r.buffer.duration)}`));
      mixPlayerEl.innerHTML = '';
      mixPlayerEl.append(h('audio', { controls: true, src: URL.createObjectURL(encodeWav(r.buffer)) }));
      renderMasterMeters(r.buffer, r.after);
    } catch (e) { masterInfo.textContent = ''; toastErr(e); }
  }
  const compareBox = h('div.stack');
  async function compareMasters(btn) {
    if (!tracks.length) return toast('Ajoute ton morceau (ou tes pistes) d’abord.');
    btn.disabled = true; compareBox.innerHTML = '';
    try {
      const minOff = Math.min(0, ...tracks.map(t => t.offset));
      const mixed = await mix(await mixInput(minOff));
      for (const [k, preset] of Object.entries(MASTER_PRESETS)) {
        masterInfo.innerHTML = `<span class="spinner"></span> Version « ${preset.label} »…`;
        const r = await master(mixed, k, () => {});
        const url = URL.createObjectURL(encodeWav(r.buffer));
        compareBox.append(h('div.card.stack', { style: { padding: '10px' } },
          h('div.row', h('strong.grow', preset.label), h('span.tiny.muted', `${r.after.toFixed(1)} LUFS`)),
          h('audio', { controls: true, src: url, style: { width: '100%' } }),
          h('button.btn.small', { onclick: (ev) => {
            masterResult = r; masterSel.value = k;
            masterInfo.textContent = `✓ Version choisie : ${preset.label}. Tu peux la télécharger ou l’enregistrer ci-dessous.`;
            compareBox.querySelectorAll('.card').forEach(c => { c.style.outline = ''; });
            ev.target.closest('.card').style.outline = '2px solid var(--accent)';
          } }, '✅ Je prends celle-là')));
      }
      masterInfo.textContent = 'Écoute les versions et choisis celle qui te plaît.';
    } catch (e) { masterInfo.textContent = ''; toastErr(e); }
    btn.disabled = false;
  }
  // ---------- Commandes de l'assistant vocal ----------
  const voiceTrack = () => { const t = tracks[selected]; if (t && t.kind !== 'instru') return t; const i = tracks.map(x => x.kind).lastIndexOf('voix'); if (i < 0) throw new Error('aucune voix enregistrée pour l’instant'); selected = i; drawList(); drawEdit(); return tracks[i]; };
  const trackAt = (n) => { const i = n === -1 || n === undefined ? tracks.length - 1 : Number(n) - 1; if (!tracks[i]) throw new Error(`il n’y a pas de piste ${n}`); return i; };
  const secs = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, n) : d; };
  function removeRange(b, a, c) {
    const x = sliceBuffer(b, 0, a), y = sliceBuffer(b, c, b.duration);
    const out = makeBuffer(b.numberOfChannels, x.length + y.length, b.sampleRate);
    for (let ch = 0; ch < b.numberOfChannels; ch++) { out.copyToChannel(x.getChannelData(ch), ch, 0); out.copyToChannel(y.getChannelData(ch), ch, x.length); }
    return out;
  }
  function trimSilence(b) {
    const d = b.getChannelData(0), th = 0.01, pad = Math.floor(0.15 * b.sampleRate);
    let a = 0, z = d.length - 1; while (a < d.length && Math.abs(d[a]) < th) a++; while (z > a && Math.abs(d[z]) < th) z--;
    return sliceBuffer(b, Math.max(0, a - pad) / b.sampleRate, Math.min(d.length, z + pad) / b.sampleRate);
  }
  const masterKey = (p) => { const keys = Object.keys(MASTER_PRESETS); const n = norm2(p); return keys.find(k => k === p) || keys.find(k => norm2(MASTER_PRESETS[k].label).includes(n)) || (/(rap|trap|punch)/.test(n) ? keys.find(k => /rap/i.test(MASTER_PRESETS[k].label)) : /club|fort/.test(n) ? keys.find(k => /club/i.test(MASTER_PRESETS[k].label)) : /doux|acous/.test(n) ? keys.find(k => /doux/i.test(MASTER_PRESETS[k].label)) : keys[0]); };
  const norm2 = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const fakeBtn = () => ({ disabled: false });
  // ---------- Panneau de molettes (piste sélectionnée) ----------
  const knobBox = h('div.card.stack', { style: { padding: '10px', background: 'var(--bg)' } });
  const KN = [
    ['low', '🔈 Grave', -12, 12, 0.5, (v) => `${v > 0 ? '+' : ''}${v} dB`],
    ['mid', '🎚️ Médium', -12, 12, 0.5, (v) => `${v > 0 ? '+' : ''}${v} dB`],
    ['pres', '🗣️ Présence', -12, 12, 0.5, (v) => `${v > 0 ? '+' : ''}${v} dB`],
    ['air', '✨ Brillance', -12, 12, 0.5, (v) => `${v > 0 ? '+' : ''}${v} dB`],
    ['comp', '🗜️ Compression', 0, 1, 0.02, (v) => `${Math.round(v * 100)} %`],
    ['reverb', '🌫️ Réverbe', 0, 0.7, 0.01, (v) => `${Math.round(v / 0.7 * 100)} %`],
    ['echo', '🔁 Écho', 0, 0.6, 0.01, (v) => `${Math.round(v / 0.6 * 100)} %`],
    ['tune', '🎤 Autotune', 0, 1, 0.05, (v) => v ? `${Math.round(v * 100)} %` : 'non'],
  ];
  function applyLiveFx(t, k) {
    const n = live.fx.get(t); if (!n) return;
    const fx = fxOf(t), now = audioCtx().currentTime;
    if (k === 'tune') { if (!!n.tune !== fx.tune > 0) { playLive(livePos()); } else n.tune?.port.postMessage({ strength: Math.min(1, fx.tune), speed: fx.tune > 0.85 ? 1 : 0.1 + fx.tune * 0.3 }); return; }
    if (k === 'comp') return n.setComp(fx.comp);
    if (k === 'reverb') return n.revG.gain.setTargetAtTime(fx.reverb, now, 0.03);
    if (k === 'echo') return n.echoG.gain.setTargetAtTime(fx.echo, now, 0.03);
    n[k]?.gain.setTargetAtTime(fx[k], now, 0.03);
  }
  function renderKnobs() {
    knobBox.innerHTML = '';
    const t = tracks[selected];
    if (!t || t.empty) { knobBox.append(h('p.small.muted', 'Clique sur une piste pour la régler en direct avec les molettes.')); return; }
    const row = h('div.row', { style: { flexWrap: 'wrap', gap: '10px', justifyContent: 'space-around' } });
    const knobs = KN.map(([k, label, min, max, step, fmt]) => knob({ label, min, max, step, value: fxOf(t)[k], def: FX_DEF[k], fmt, onInput: (v) => { t.fx = { ...fxOf(t), [k]: v }; masterResult = null; applyLiveFx(t, k); saveSoon(); } }));
    knobs.forEach(kn => row.append(kn.el));
    knobBox.append(
      h('div.row', h('strong.grow', `🎛️ Réglages en direct : ${t.kind === 'instru' ? '🥁' : '🎤'} ${t.name}`),
        h('button.btn.small', { onclick: () => (live.srcs.length ? stopLive() : playLive()) }, '▶ / ⏸ Écouter'),
        h('button.btn.small.ghost', { onclick: () => { t.fx = null; masterResult = null; renderKnobs(); if (live.srcs.length) playLive(livePos()); saveSoon(); } }, '↺ Molettes à zéro'),
        h('button.btn.small', { title: 'Enlève les molettes ET tous les effets appliqués (autotune, nettoyage…) : retour à la prise brute. Annulable avec Ctrl+Z.', onclick: async () => { t.fx = null; renderKnobs(); await work('Enlever tous les effets…', async (b, tr) => tr.original); if (live.srcs.length) playLive(livePos()); } }, '🧽 Enlever tous les effets')),
      row,
      h('p.tiny.muted', 'Lance la lecture (Espace) puis tourne les molettes : glisse vers le haut / le bas, ou molette de la souris (double-clic = zéro). Tu entends le changement tout de suite. Rien n’est abîmé : ta prise reste intacte, les réglages sont appliqués au moment du mix / master.'));
  }

  // ---------- Console de mixage (P4) ----------
  const mixerStrips = h('div.mixer');
  const mixerSpectrum = h('canvas.spectrum', { width: 460, height: 120, style: { width: '100%', height: '120px' } });
  const masterLufsLbl = h('div.tiny.muted', { style: { textAlign: 'center' } }, 'LUFS : —');
  let mixerVUs = [];
  function renderMixer() {
    mixerStrips.innerHTML = ''; mixerVUs = [];
    const list = tracks.filter(t => !t.empty);
    if (!list.length) mixerStrips.append(h('p.small.muted', { style: { padding: '10px' } }, 'Aucune piste. Enregistre ou importe une instru pour voir la console.'));
    for (const [i, t] of list.entries()) {
      const col = colorForTrack(t, i);
      const vu = h('canvas.vu', { width: 12, height: 120 }); mixerVUs.push({ t, vu });
      const dbl = h('b.tiny', `${t.gainDb} dB`);
      const fader = h('input.fader', { type: 'range', min: -30, max: 12, step: 0.5, value: t.gainDb, oninput: (e) => { t.gainDb = Number(e.target.value); dbl.textContent = `${t.gainDb} dB`; liveGain(); masterResult = null; timeline?.render(); saveSoon(); } });
      const pan = h('input', { type: 'range', min: -1, max: 1, step: 0.05, value: t.pan || 0, title: 'Panoramique', oninput: (e) => { t.pan = Number(e.target.value); masterResult = null; timeline?.render(); saveSoon(); } });
      const mBtn = h('button.btn.small' + (t.mute ? '.danger' : '.ghost'), { style: { padding: '2px 8px' }, onclick: () => { t.mute = !t.mute; liveGain(); renderMixer(); timeline?.render(); } }, 'M');
      const sBtn = h('button.btn.small' + (t.solo ? '.primary' : '.ghost'), { style: { padding: '2px 8px' }, onclick: () => { t.solo = !t.solo; liveGain(); renderMixer(); timeline?.render(); } }, 'S');
      const ins = h('button.btn.small.ghost', { title: 'Inserts : molettes EQ / compression / réverbe / écho / autotune', onclick: () => { selected = tracks.indexOf(t); knobSel = t; drawEdit(); renderKnobs(); knobBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, '⚙︎ Inserts');
      mixerStrips.append(h('div.strip', { style: { borderTopColor: col } },
        h('div.strip-name', { title: t.name }, (t.kind === 'instru' ? '🥁 ' : '🎤 ') + t.name),
        h('div.strip-body', vu, h('div.col', fader, dbl)),
        h('div.row', { style: { gap: '4px', justifyContent: 'center' } }, mBtn, sBtn),
        h('span.tiny.muted', { style: { textAlign: 'center' } }, 'Pan'), pan, ins));
    }
    masterLufsLbl.textContent = masterResult ? `LUFS ${masterResult.after.toFixed(1)} · crête ${masterResult.peakDb.toFixed(1)} dB` : 'LUFS : — (mixe pour mesurer)';
    mixerStrips.append(h('div.strip.master', { style: { borderTopColor: 'var(--accent)' } },
      h('div.strip-name', '🎚️ MASTER'),
      mixerSpectrum,
      h('div.row', { style: { gap: '4px' } }, h('div.grow', masterSel), h('button.btn.small.primary', { title: 'Mixer + masteriser', onclick: () => doMaster().then(renderMixer) }, '🎛️')),
      masterLufsLbl));
  }
  let mixerRAF = 0; const _vuBuf = new Float32Array(256);
  function mixerLoop() {
    for (const { t, vu } of mixerVUs) {
      const an = live.an.get(t), c = vu.getContext('2d'); c.clearRect(0, 0, vu.width, vu.height);
      let db = -90; if (an) { an.getFloatTimeDomainData(_vuBuf); let pk = 0; for (const x of _vuBuf) { const a = Math.abs(x); if (a > pk) pk = a; } db = 20 * Math.log10(pk + 1e-9); }
      const hh = vu.height * dbToMeterPct(db) / 100; const g = c.createLinearGradient(0, vu.height, 0, 0);
      g.addColorStop(0, '#22c55e'); g.addColorStop(.7, '#22c55e'); g.addColorStop(.85, '#eab308'); g.addColorStop(1, '#ef4444');
      c.fillStyle = g; c.fillRect(0, vu.height - hh, vu.width, hh);
    }
    const c = mixerSpectrum.getContext('2d'), W = mixerSpectrum.width, H = mixerSpectrum.height; c.clearRect(0, 0, W, H);
    if (live.busAn) { const n = live.busAn.frequencyBinCount, d = new Uint8Array(n); live.busAn.getByteFrequencyData(d); const bars = 64; for (let i = 0; i < bars; i++) { const idx = Math.min(n - 1, Math.floor(Math.pow(i / bars, 2) * n)); const v = d[idx] / 255; const x = i / bars * W, bw = W / bars - 1, bh = v * H; c.fillStyle = `hsl(${250 - v * 90},90%,${40 + v * 25}%)`; c.fillRect(x, H - bh, bw, bh); } }
    mixerRAF = requestAnimationFrame(mixerLoop);
  }

  // ---------- Ligne de temps (toutes les pistes au même endroit) ----------
  const minOffNow = () => Math.min(0, ...tracks.map(t => t.offset || 0));
  // Marqueurs nommés (par projet)
  const MKEY = `studio.markers:${state.projectId || 'perso'}`;
  let markers = (() => { try { return JSON.parse(localStorage.getItem(MKEY)) || []; } catch { return []; } })();
  const saveMarkers = () => { try { localStorage.setItem(MKEY, JSON.stringify(markers)); } catch {} };
  const markerPos = () => live.srcs.length ? livePos() : (player.playing && tracks[selected] ? (tracks[selected].offset || 0) - minOffNow() + player.position : seekPos);
  function addMarker() { markers.push({ t: Math.max(0, markerPos()), name: `M${markers.length + 1}` }); markers.sort((a, b) => a.t - b.t); saveMarkers(); timeline?.render(); toast('Marqueur ajouté 🚩'); }
  async function editMarker(i) { const m = markers[i]; if (!m) return; const name = await promptBox('Nom du marqueur (laisse vide pour supprimer)', m.name); if (name === null) return; if (!name.trim()) markers.splice(i, 1); else m.name = name.trim(); saveMarkers(); timeline?.render(); }
  let timelineRemove = () => {};
  timeline = createTimeline({
    tracks, effMute,
    bpm: () => transport.bpm,
    markers: () => markers,
    editMarker: (i) => editMarker(i),
    getSelected: () => selected,
    select: (i, quiet) => { if (selected !== i) { selected = i; drawEdit(); knobSel = tracks[i]; renderKnobs(); } if (!quiet) timeline.render(); },
    changed: (kind, t) => {
      masterResult = null;
      if (kind === 'gain') { liveGain(); syncInstru(); saveSoon(); return; }
      if (kind === 'pan') { saveSoon(); return; }
      if (kind === 'mute' || kind === 'solo') liveGain();
      if (kind === 'kind' || kind === 'name') drawEdit();
      drawList();
    },
    getSel: () => sel, setSel: (v) => { sel = v; },
    seek: (g) => { seekPos = Math.max(0, g); if (live.srcs.length) playLive(seekPos); },
    position: () => live.srcs.length ? livePos() : player.playing && tracks[selected] ? (tracks[selected].offset || 0) - minOffNow() + player.position : seekPos,
    isPlaying: () => !!live.srcs.length || player.playing,
    remove: timelineRemove = async (i) => { if (!(await confirmBox(`Supprimer la piste « ${tracks[i].name} » ? (tu pourras la récupérer avec ♻️)`, 'Supprimer', true))) return; trash.push(tracks.splice(i, 1)[0]); updTrash(); if (selected >= tracks.length) selected = tracks.length - 1; masterResult = null; drawList(); drawEdit(); },
    edit: async (kind) => {
      const t = timeline.selTrack(), r = sel; if (!t || !r) return;
      selected = tracks.indexOf(t); drawEdit();
      if (kind === 'play') { const g0 = (t.offset || 0) - minOffNow(); return playLive(g0 + r[0], g0 + r[1]); }
      const label = { delete: 'Suppression du passage…', keep: 'Rognage…', silence: 'Silence…' }[kind];
      await work(label, async (b) => {
        if (kind === 'keep') return sliceBuffer(b, r[0], r[1]);
        if (kind === 'delete') return removeRange(b, r[0], r[1]);
        const o2 = cloneBuffer(b), a = Math.floor(r[0] * b.sampleRate), z = Math.min(b.length, Math.floor(r[1] * b.sampleRate)), f = Math.floor(0.01 * b.sampleRate);
        for (let c = 0; c < o2.numberOfChannels; c++) { const d = o2.getChannelData(c); for (let i = a; i < z; i++) { const k = Math.min(1, (i - a) / f, (z - i) / f); d[i] *= 1 - k; } }
        return o2;
      });
      if (kind === 'keep') t.offset = (t.offset || 0) + r[0];
      timeline.clearSel(); drawList();
    },
  });

  // Console de volumes toujours sous la main, dans la carte de l'assistant (réglable pendant qu'on lui parle / qu'on enregistre)
  const monVolLbl = h('b', `${Math.round(Number(monVol.value) * 100)} %`);
  monVol.addEventListener('input', () => { monVolLbl.textContent = `${Math.round(Number(monVol.value) * 100)} %`; });
  const mixer = h('div.stack', { style: { background: 'var(--bg)', borderRadius: '10px', padding: '8px 10px' } },
    h('div.row', h('strong.small.grow', '🎚️ Volumes du casque (en direct)'), liveBtn),
    h('div.sliders',
      h('label', h('span', '🎙️ Gain du micro (enregistrement) ', inGainLbl), inGain),
      h('label', h('span', '🥁 Instru ', instruLbl), instruVol),
      h('label', h('span', '🎤 Toutes mes voix enregistrées ', micLbl), micVol),
      h('label', h('span', '🎧 Ma voix en direct dans le casque ', monVolLbl), monVol)),
    h('label.chk.small', monOn, 'M’entendre en direct dans le casque pendant que j’enregistre'),
    monFxBox,
    h('p.tiny.muted', '🎙️ Gain du micro : baisse-le si le vumètre micro est souvent dans le rouge. Si « SATURE » reste allumé même à −20 dB, c’est le micro lui-même qui sature : baisse son niveau dans Windows (Paramètres → Son → Entrée → Volume) ou décoche le réglage automatique, puis recule un peu.'),
    micMeter.el, outMeter.el,
    h('p.tiny.muted', 'Micro : vise le jaune (−12 à −6 dB) quand tu rappes fort. Si « ● SATURE » s’allume, recule du micro ou baisse le gain du micro dans Windows (Paramètres → Son → Entrée). Le micro s’affiche quand tu enregistres ou quand « M’entendre en direct » est coché.'));
  const S = {
    mixer,
    isRecording: () => !!recorder,
    record: (o) => startRec({ autoStopSilence: o?.seconds ? 0 : (o?.autoStopSilence || 0), autoStopBeat: !o?.seconds, seconds: Math.min(600, Math.max(0, Number(o?.seconds) || 0)) }),
    snapshot: () => ({
      enregistrement_en_cours: !!recorder,
      pistes: tracks.map((t, i) => ({ n: i + 1, nom: t.name, type: t.kind, duree_s: Math.round(t.buffer.duration * 10) / 10, volume_db: t.gainDb, muet: t.mute, effets_appliques: t.fxDone || [], etapes_annulables: (t.undo || []).map(u => u.label) })),
      piste_selectionnee: selected + 1, master_pret: !!masterResult, instru_presente: tracks.some(t => t.kind === 'instru'),
    }),
    do: {
      stop: async () => { if (recorder) return stopRec(); stopLive(); player.stop(); el.querySelectorAll('audio').forEach(a => a.pause()); },
      pause: async () => { stopLive(); player.pause(); el.querySelectorAll('audio').forEach(a => a.pause()); },
      play: async (x) => {
        if (x.what !== 'master' && x.what !== 'voix') { playLive(0); return; }
        if (x.what === 'master' || (!tracks[selected] && masterResult)) { if (!masterResult) await doMaster(); const a = mixPlayerEl.querySelector('audio'); a?.play(); a?.scrollIntoView({ block: 'center' }); return; }
        if (x.what === 'voix') { const t = voiceTrack(); stopLive(); player.load(t.buffer); player.play(0); playSelBtn.textContent = '⏸'; return; }
        playLive();
      },
      select: async (x) => { selected = trackAt(x.track); sel = null; drawList(); drawEdit(); },
      clean: async (x) => { voiceTrack(); const lv = Math.min(0.9, Math.max(0.2, Number(x.level) || 0.55)); await work('Nettoyage…', async (b) => gate(antipop(await denoise(b, lv), 0.8), -45, -30)); },
      align: async () => { voiceTrack(); if (!tracks.some(t => t.kind === 'instru')) throw new Error('il faut d’abord une instru'); await alignSelected(); },
      voice: async (x) => { voiceTrack(); const v = x.params ? sanitizeVoice(x.params) : { ...(VOICE_PRESETS[x.preset] || VOICE_PRESETS.rap) }; await work('Traitement voix…', (b) => voiceChain(b, v)); },
      tune: async (x) => { voiceTrack(); const k = norm2(x.level); const [label, name] = QUICK_TUNE[/fort|robot|t.?pain/.test(k) ? 3 : /moyen|drake|melod/.test(k) ? 2 : /leger|naturel/.test(k) ? 1 : /belle|chant|douce/.test(k) ? 4 : 0]; const p = VFX.find(y => y.name === name); await applyItem({ name: `Autotune ${label.replace(/^\S+ /, '')}`, list: [p] }); },
      effect: async (x) => { voiceTrack(); const chain = sanitizeChain(x.chain), voice = x.voice ? sanitizeVoice(x.voice) : null; if (!chain.length && !voice) throw new Error('effet non reconnu'); const name = String(x.name || 'Effet').slice(0, 40); await applyItem({ name, list: [{ name, chain, voice }] }); },
      cut: async (x) => { const t = voiceTrack(); const a = secs(x.from, 0), c = Math.min(t.buffer.duration, secs(x.to, t.buffer.duration)); if (c <= a) throw new Error('passage invalide'); await work(`Coupe ${a}-${c} s…`, async (b) => removeRange(b, a, c)); },
      keep: async (x) => { const t = voiceTrack(); const a = secs(x.from, 0), c = Math.min(t.buffer.duration, secs(x.to, t.buffer.duration)); if (c <= a) throw new Error('passage invalide'); await work('Rognage…', async (b) => sliceBuffer(b, a, c)); },
      trim: async () => { voiceTrack(); await work('Coupe des silences…', async (b) => trimSilence(b)); },
      fades: async () => { voiceTrack(); await work('Fondus…', async (b) => { const o = cloneBuffer(b); const n = Math.min(o.length / 2, Math.floor(0.03 * o.sampleRate)); for (let c = 0; c < o.numberOfChannels; c++) { const d = o.getChannelData(c); for (let i = 0; i < n; i++) { d[i] *= i / n; d[d.length - 1 - i] *= i / n; } } return o; }); },
      normalize: async () => { voiceTrack(); await work('Normalisation…', async (b) => normalize(cloneBuffer(b), -1)); },
      undo: async () => { if (!tracks[selected]?.undo?.length) throw new Error('rien à annuler'); stepHistory('undo', 'redo'); },
      redo: async () => { if (!tracks[selected]?.redo?.length) throw new Error('rien à rétablir'); stepHistory('redo', 'undo'); },
      original: async () => { voiceTrack(); await work('Retour à l’original…', async (b, tr) => tr.original); },
      volume: async (x) => {
        const i = x.track === 'instru' ? tracks.findIndex(t => t.kind === 'instru') : x.track === 'voix' ? tracks.map(t => t.kind).lastIndexOf('voix') : trackAt(x.track ?? selected + 1);
        if (i < 0) throw new Error(`pas de piste ${x.track}`);
        const g = x.delta !== undefined ? tracks[i].gainDb + Number(x.delta) : Number(x.db) || 0;
        tracks[i].gainDb = Math.max(-30, Math.min(12, g)); liveGain(tracks[i]); masterResult = null; drawList();
      },
      mute: async (x) => { const i = trackAt(x.track ?? selected + 1); tracks[i].mute = x.on !== false; masterResult = null; drawList(); },
      delete: async (x) => { const i = trackAt(x.track ?? selected + 1); if (!(await confirmBox(`Supprimer la piste « ${tracks[i].name} » ?`, 'Supprimer', true))) throw new Error('suppression annulée'); trash.push(tracks.splice(i, 1)[0]); updTrash(); if (selected >= tracks.length) selected = tracks.length - 1; masterResult = null; drawList(); drawEdit(); },
      all: async () => doEverything(fakeBtn()),
      importInstru: async () => { for (const f of await pickLocalFiles('audio/*,video/*', false)) await addBlob(f, f.name, 'instru'); },
      // « on refait » : l'ancienne prise n'est JAMAIS effacée, elle est juste coupée (M) et renommée
      dropLastVoice: async () => { const i = tracks.map(t => t.kind).lastIndexOf('voix'); if (i >= 0) { const t = tracks[i]; t.mute = true; if (!/ancienne/.test(t.name)) t.name += ' (ancienne)'; masterResult = null; liveGain(); drawList(); } },
      master: async (x) => { if (x.preset) masterSel.value = masterKey(x.preset); await doMaster(); mixPlayerEl.querySelector('audio')?.play(); },
      versions: async () => compareMasters(fakeBtn()),
      save: async () => { if (!masterResult) await doMaster(); await uploadFile(encodeWav(masterResult.buffer, Number(bitSel.value)), { name: `${exportName()}-master.wav`, source: 'master' }); toast('Master enregistré dans tes fichiers', 'ok'); },
      download: async () => { if (!masterResult) await doMaster(); downloadBlob(encodeWav(masterResult.buffer, Number(bitSel.value)), `${exportName()}-master.wav`); },
    },
  };
  ast = mountAssistant(S);

  const exportName = () => (tracks.find(t => t.kind === 'voix')?.name || 'morceau').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');

  const trash = [];
  const trashBtn = h('button.btn.small.ghost', { style: { display: 'none' }, onclick: () => { const t = trash.pop(); if (!t) return; tracks.push(t); selected = tracks.length - 1; updTrash(); drawList(); drawEdit(); toast(`« ${t.name} » récupérée ✓`, 'ok'); } }, '♻️ Récupérer la piste supprimée');
  function updTrash() { trashBtn.style.display = trash.length ? '' : 'none'; trashBtn.textContent = `♻️ Récupérer « ${trash[trash.length - 1]?.name || ''} »`; }
  async function addEmptyTrack(name) {
    name = name || (await promptBox('Nom de la nouvelle piste (ex. : Backs, Refrain, Ad-libs, Chœurs)', `Piste ${tracks.length + 1}`));
    if (!name) return;
    tracks.forEach(t => { t.armed = false; });
    tracks.push({ name, kind: 'voix', buffer: makeBuffer(1, 4410, 44100), original: null, gainDb: 0, pan: 0, offset: seekPos + minOffNow(), mute: false, empty: true, armed: true });
    tracks[tracks.length - 1].original = tracks[tracks.length - 1].buffer;
    selected = tracks.length - 1; drawList(); drawEdit();
    toast(`Piste « ${name} » ajoutée et armée (●) : la prochaine prise ira dedans.`, 'ok');
  }

  // ======================= Ingé son IA =======================
  // Test micro 5 s : mesure niveau + bruit de fond, puis conseils.
  async function micTest(btn) {
    btn.disabled = true;
    micInfo.innerHTML = '<span class="spinner"></span> Test du micro (5 s)… parle normalement.';
    try {
      const rec = await startRecorder({ constraints: micConstraints() });
      micMeter.attachStream(rec.stream);
      await new Promise(r => setTimeout(r, 5000));
      const buf = await decodeBlob(await rec.stop());
      micMeter.detach();
      const ch = buf.getChannelData(0);
      const peakDb = peakDbOf(ch), rmsDb = rmsDbOf(ch), noiseDb = noiseFloorDb(ch, buf.sampleRate);
      const a = micAdvice({ peakDb, rmsDb, noiseDb });
      micInfo.innerHTML = '';
      micInfo.append(
        h('div', `Niveau crête ${peakDb.toFixed(1)} dBFS · voix ${rmsDb.toFixed(1)} dBFS · bruit de fond ${noiseDb.toFixed(1)} dBFS${a.snrDb != null ? ` · signal/bruit ${a.snrDb} dB` : ''}`),
        ...a.tips.map(t => h('div', '• ' + t)));
    } catch (e) { micInfo.textContent = ''; toast('Micro inaccessible : ' + e.message, 'bad'); }
    btn.disabled = false;
  }

  // Analyse de l'instru : tonalité + BPM, mémorisés pour l'autotune et le delay.
  async function analyzeInstru(btn) {
    const beat = tracks.find(t => t.kind === 'instru');
    if (!beat) return toast('Ajoute d’abord l’instru (piste de type « Instru »).');
    btn.disabled = true;
    instruInfo.innerHTML = '<span class="spinner"></span> Analyse de l’instru (tonalité et tempo)…';
    try {
      const { bpm } = await detectBeats(beat.buffer);
      const key = detectKey(await detectPitch(beat.buffer));
      ingeSession.bpm = bpm; ingeSession.key = key; ingeSession.keyLabel = keyName(key);
      instruInfo.textContent = `🎵 Tonalité ${ingeSession.keyLabel} · tempo ${bpm} BPM (mémorisés pour l’autotune et le delay).`;
      drawInge();
    } catch (e) { instruInfo.textContent = ''; toastErr(e); }
    btn.disabled = false;
  }

  // Traitement automatique d'une prise selon les mesures (chaîne + rapport).
  async function processTake(track) {
    if (!track || track.kind !== 'voix') return;
    const t0 = performance.now();
    const say = (m) => { ingeReport.innerHTML = ''; ingeReport.append(h('div.small', h('span.spinner'), ' ' + m)); };
    player.stop();
    track.original = track.original || track.buffer;
    const raw = track.original, ch = raw.getChannelData(0);
    const levelDb = peakDbOf(ch), noiseDb = noiseFloorDb(ch, raw.sampleRate), rmsDb = rmsDbOf(ch);
    const voiceIdx = tracks.filter(x => x.kind === 'voix').indexOf(track);
    const role = track.role || proposeRole(voiceIdx);
    if (role === 'adlib') track.adlibIndex = tracks.filter(x => x.kind === 'voix' && x.role === 'adlib' && x !== track).length;
    track.role = role;
    const plan = roleChain(role, { noiseDb, bpm: ingeSession.bpm });
    const expert = ingePrefs.expert;
    let ex = null, analysis = null, dspAnalysis = null;
    if (expert) {
      say('Analyse experte (dynamique + spectre)…');
      analysis = analyzeSamples(ch, raw.sampleRate);
      dspAnalysis = analyzeVoiceDsp(ch, raw.sampleRate);
      ex = expertChain(plan.voice, ingePrefs.style, analysis);
    }
    say('Analyse de la voix…');
    const pitchBefore = await detectPitch(raw);
    const key = ingeSession.key || detectKey(pitchBefore);
    const jBefore = justesse(pitchBefore.f0, key);
    // on repart de la prise brute ; chaque étape est annulable (historique partagé)
    track.buffer = raw; track.fxDone = [];
    const stepBuf = async (label, fn) => { say(label + '…'); pushUndo(track, { buffer: track.buffer, fxDone: (track.fxDone || []).slice(), label }); track.buffer = await fn(track.buffer); track.fxDone = [...(track.fxDone || []), label]; };
    await stepBuf(`Débruitage ${Math.round(plan.denoise * 100)} %`, (b) => denoise(b, plan.denoise, (p) => say(`Débruitage ${Math.round(p * 100)} %`)));
    await stepBuf('Anti-pop', (b) => antipop(b, expert ? ex.steps.antipop : 0.8));
    await stepBuf('Coupe des blancs', (b) => gate(b, plan.gate.threshold, plan.gate.floor));
    let alignMs = 0;
    const beat = tracks.find(x => x.kind === 'instru' && x !== track);
    if (beat) { const before = track.offset || 0; say('Calage sur l’instru'); await alignTrack(track, beat); alignMs = ((track.offset || 0) - before) * 1000; }
    const tune = expert ? ex.tune : plan.autotune;
    await stepBuf(`Autotune (${keyName(key)})`, async (b) => (await applyChain(b, [{ t: 'tune', strength: tune.strength, speed: tune.speed }], { key })).buffer);
    await stepBuf('Chaîne voix', (b) => voiceChain(b, expert ? ex.voice : plan.voice));
    if (expert && ex.steps.notchHz) await stepBuf(`EQ anti-résonance ${ex.steps.notchHz} Hz`, async (b) => (await applyChain(b, [{ t: 'fx', kind: 'peak', f: ex.steps.notchHz, q: 2.5, gain: ex.steps.notchGain }])).buffer);
    if (plan.sends.delay) await stepBuf('Écho au tempo', async (b) => (await applyChain(b, [{ t: 'fx', ...plan.sends.delay }])).buffer);
    track.gainDb = plan.gainDb;
    track.pan = role === 'adlib' ? adlibPan(track.adlibIndex || 0) : plan.pan;
    track._abUrls && track._abUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} }); track._abUrls = null;
    masterResult = null;
    say('Mesure de la justesse après traitement…');
    const jAfter = justesse((await detectPitch(track.buffer)).f0, key);
    track.inge = {
      role, key: keyName(key), bpm: ingeSession.bpm, levelDb, noiseDb, peakDb: levelDb,
      snrDb: Math.round((rmsDb - noiseDb) * 10) / 10,
      denoise: plan.denoise, alignMs, gainDb: track.gainDb,
      justesseBefore: jBefore.pct, justesseAfter: jAfter.pct,
      seconds: Math.round((performance.now() - t0) / 100) / 10, tips: null, tipsSource: null,
      expert: false, reportText: null, em: null,
    };
    if (expert) {
      say('Sonie et équilibre voix/instru…');
      let lufs = null, instruDuck = 0;
      try { lufs = Math.round((await loudness(track.buffer)) * 10) / 10; } catch {}
      if (beat) { try { const il = Math.round((await loudness(beat.buffer)) * 10) / 10; instruDuck = instruDuckDb(lufs, il); if (instruDuck < 0) { beat.gainDb = Math.max(-30, beat.gainDb + instruDuck); } } catch {} }
      if (STYLES[ingePrefs.style]) masterSel.value = STYLES[ingePrefs.style].master;
      const em = { style: ingePrefs.style, peakDb: analysis.peakDb, rmsDb: analysis.rmsDb, crestDb: analysis.crestDb, clipPct: analysis.clipPct, lufs, brightness: analysis.brightness, resonanceHz: analysis.resonanceHz, breathPct: analysis.breathPct, deess: ex.voice.deess, notchHz: ex.steps.notchHz, instruDuck, justesseBefore: jBefore.pct, justesseAfter: jAfter.pct,
        dsp: dspAnalysis?.valid ? { peakDbfs: dspAnalysis.peakDbfs, rmsDbfs: dspAnalysis.rmsDbfs, noiseFloorEstimateDbfs: dspAnalysis.noiseFloorEstimateDbfs, crestDb: dspAnalysis.crestDb, spectralCentroidHz: dspAnalysis.spectralCentroidHz, bandEnergy: dspAnalysis.bandEnergy, sibilanceRatio: dspAnalysis.sibilanceRatio, lowRatio: dspAnalysis.lowRatio, highRatio: dspAnalysis.highRatio, confidence: dspAnalysis.confidence } : null,
        dspRecommendations: voiceDspRecommendations(dspAnalysis || {}) };
      track.inge.expert = true; track.inge.em = em; track.inge.reportText = expertReport(em);
    }
    drawList(); drawEdit(); updUndo();
    fetchTips(track);     // conseils du LLM à partir des SEULES mesures (aucun audio envoyé)
  }

  async function generateVoiceProposals(track) {
    if (!track?.original || !track.inge?.em) return toast('Lance d’abord l’analyse experte de cette prise.');
    const btn = document.querySelector('[data-head-engineer-generate]');
    if (btn) btn.disabled = true;
    try {
      const plans = buildVoiceProposals(track.inge.em, track.inge.style || ingePrefs.style);
      const rendered = [];
      for (const plan of plans) {
        const buffer = await voiceChain(track.original, plan.settings);
        rendered.push({ ...plan, buffer });
      }
      track.inge.proposals = rendered;
      track.inge.proposalSelected = null;
      drawInge();
      toast('4 versions vocales calculées depuis les mesures de ta prise. Écoute-les avant validation.', 'ok');
    } catch (e) { toastErr(e); }
    finally { if (btn) btn.disabled = false; }
  }

  function previewVoiceProposal(track, id) {
    const proposal = track?.inge?.proposals?.find(p => p.id === id);
    if (!proposal) return;
    try {
      const url = URL.createObjectURL(encodeWav(proposal.buffer));
      track._proposalUrls ||= [];
      track._proposalUrls.push(url);
      ingeAudio.src = url;
      ingeAudio.play().catch(() => {});
      track.inge.proposalSelected = id;
      drawInge();
    } catch (e) { toastErr(e); }
  }

  function applyVoiceProposal(track, id) {
    const proposal = track?.inge?.proposals?.find(p => p.id === id);
    if (!proposal) return;
    pushUndo(track, { buffer: track.buffer, fxDone: (track.fxDone || []).slice(), label: 'Avant proposition Head Engineer' });
    track.buffer = cloneBuffer(proposal.buffer);
    track.fxDone = [...(track.fxDone || []), 'Head Engineer · ' + proposal.name];
    track.inge.appliedProposal = id;
    masterResult = null;
    drawList(); drawEdit(); updUndo(); drawInge();
    toast('Proposition appliquée. La prise originale reste conservée.', 'ok');
  }

  async function fetchTips(track) {
    const { system, prompt } = track.inge.expert ? expertTipsPrompt(track.inge.em) : tipsPrompt(track.inge);
    try {
      const r = await api('/api/complete', { method: 'POST', body: { system, prompt, src: 'inge-son', model: 'auto:fast', temperature: 0.3 } });
      const lines = String(r.content || '').split('\n').map(s => s.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 3);
      track.inge.tips = lines.length ? lines : fallbackTips(track.inge);
      track.inge.tipsSource = lines.length ? 'IA' : 'règles';
    } catch { track.inge.tips = fallbackTips(track.inge); track.inge.tipsSource = 'règles'; }
    drawInge();
  }

  function openConsult() {
    const csel = h('select', CONSULTATIONS.map(c => h('option', { value: c.id }, c.label)));
    const fieldsBox = h('div.stack');
    const inputs = {};
    const answer = h('div.small', { style: { whiteSpace: 'pre-wrap', maxHeight: '42vh', overflow: 'auto', background: 'var(--bg)', padding: '8px', borderRadius: '10px' } });
    const info = h('span.small.muted');
    const buildFields = () => {
      fieldsBox.innerHTML = ''; for (const k in inputs) delete inputs[k];
      const c = CONSULTATIONS.find(x => x.id === csel.value); if (!c) return;
      for (const f of c.fields) {
        const inp = f.type === 'select' ? h('select', (f.options || []).map(o => h('option', { value: o }, o))) : h('input', { type: 'text', placeholder: f.placeholder || '', value: f.value || '' });
        inputs[f.name] = inp;
        fieldsBox.append(h('label.f', { style: { display: 'block' } }, h('span.small', f.label + ' '), inp));
      }
    };
    csel.onchange = buildFields; buildFields();
    const askBtn = h('button.btn.small.primary', { onclick: async (e) => {
      const values = {}; for (const k in inputs) values[k] = inputs[k].value;
      const q = buildConsult(csel.value, values); if (!q) return;
      e.target.disabled = true; info.innerHTML = '<span class="spinner"></span> L’ingé son réfléchit…'; answer.textContent = '';
      try { const r = await api('/api/complete', { method: 'POST', body: { system: q.system, prompt: q.prompt, src: 'inge-expert', model: 'auto:smart', temperature: 0.4 } }); answer.textContent = String(r.content || '').trim() || 'Pas de réponse.'; info.textContent = `via ${r.routedVia || 'IA'}`; }
      catch (err) { info.textContent = ''; toastErr(err); }
      e.target.disabled = false;
    } }, '🎛️ Demander à l’ingé son');
    modal('💬 Consultation — ingé son expert', h('div.stack',
      h('p.small.muted', 'Choisis un sujet, remplis les cases, reçois une réponse chiffrée (chaîne, fréquences, ratios, LUFS…). Conseils à partir de ta description — aucun audio n’est envoyé.'),
      csel, fieldsBox, h('div.row', askBtn, info), answer));
  }
  function abIng(track, which) {
    try { track._abUrls && track._abUrls.forEach(u => URL.revokeObjectURL(u)); } catch {}
    const a = URL.createObjectURL(encodeWav(track.original)), b = URL.createObjectURL(encodeWav(track.buffer));
    track._abUrls = [a, b];
    ingeAudio.src = which === 'a' ? a : b; ingeAudio.play().catch(() => {});
  }

  async function balanceAndMaster(btn) {
    if (!tracks.length) return toast('Ajoute au moins une piste.');
    btn.disabled = true;
    try {
      const beat = tracks.find(t => t.kind === 'instru'); if (beat) beat.gainDb = Math.min(beat.gainDb, -4);
      if (MASTER_PRESETS[ingePrefs.masterPreset]) masterSel.value = ingePrefs.masterPreset;
      drawList();
      await doMaster();
      toast('Toutes les pistes équilibrées et masterisées ✓', 'ok');
    } catch (e) { toastErr(e); }
    btn.disabled = false;
  }

  function drawInge() {
    if (!ingeReport) return;
    ingeReport.innerHTML = '';
    if (!ingePrefs.enabled) { ingeReport.append(h('p.small.muted', 'Mode Ingé son désactivé. Active-le pour le test micro, l’analyse de l’instru, l’autotune et le rapport automatiques.')); return; }
    const t = tracks[selected];
    if (!t || t.kind !== 'voix' || !t.inge) { ingeReport.append(h('p.small.muted', 'Enregistre une prise (ou sélectionne une voix déjà traitée) : le rôle, la chaîne et le rapport s’affichent ici.')); return; }
    const g = t.inge;
    const roleSel = h('select', ROLE_ORDER.map(r => h('option', { value: r, selected: r === g.role }, ROLES[r].label)));
    roleSel.onchange = async () => { t.role = roleSel.value; if (t.role === 'adlib') t.adlibIndex = tracks.filter(x => x.kind === 'voix' && x.role === 'adlib' && x !== t).length; try { await processTake(t); } catch (e) { toastErr(e); } };
    ingeReport.append(
      h('div.row', h('span.small', 'Rôle :'), h('div.grow', roleSel), h('span.tiny.muted', g.seconds != null ? `traité en ${g.seconds} s` : '')),
      h('pre.small', { style: { whiteSpace: 'pre-wrap', background: 'var(--bg)', padding: '8px', borderRadius: '10px', margin: 0 } }, g.reportText || buildReport(g)),
      h('div.row', h('button.btn.small', { onclick: () => abIng(t, 'a') }, 'A · prise brute'), h('button.btn.small.primary', { onclick: () => abIng(t, 'b') }, 'B · traitée')),
      ...(g.expert ? [h('div.card.stack', { style: { padding: '10px' } },
        h('strong.small', '🧠 HEAD AUDIO ENGINEER AI · propositions vocales'),
        h('p.tiny.muted', 'Quatre rendus hors-ligne calculés à partir des mesures de cette prise. Écoute chaque version puis applique celle que tu préfères.'),
        h('button.btn.small.primary', { 'data-head-engineer-generate': '1', onclick: () => generateVoiceProposals(t) }, g.proposals?.length ? '↻ Recalculer les 4 propositions' : '✨ Générer 4 propositions audio'),
        ...(g.proposals || []).map(p => h('div.row', { style: { alignItems: 'center', gap: '6px' } },
          h('div.grow', h('strong.small', p.name), h('div.tiny.muted', p.objective)),
          h('button.btn.small', { onclick: () => previewVoiceProposal(t, p.id) }, g.proposalSelected === p.id ? '▶ Écoutée' : '▶ Écouter'),
          h('button.btn.small.primary', { onclick: () => applyVoiceProposal(t, p.id), disabled: g.appliedProposal === p.id }, g.appliedProposal === p.id ? '✓ Appliquée' : 'Appliquer')
        ))
      )] : []),
      ingeAudio,
      h('p.tiny.muted', 'La prise brute est conservée. « ↩ Annuler » (en haut des effets) revient étape par étape ; « ↺ Revenir à l’original » repart de la prise brute.'));
    if (g.tips === null) ingeReport.append(h('div.small.muted', h('span.spinner'), ' Conseils de l’ingé son…'));
    else if (g.tips?.length) ingeReport.append(h('div.card.stack', { style: { padding: '8px' } }, h('strong.small', `💡 Conseils pour la prochaine prise${g.tipsSource === 'règles' ? ' (hors ligne)' : ''}`), ...g.tips.map(x => h('div.small', '• ' + x))));
  }

  // ======================= Prises, comping, punch-in, boucle =======================
  let punch = null;
  const monoToBuffer = (arr, sr) => { const b = makeBuffer(1, arr.length, sr); b.copyToChannel(arr, 0, 0); return b; };
  function ensureTakes(t) { if (!t.takes) { t.takes = [{ name: 'Prise 1', buffer: t.original || t.buffer }]; t.activeTake = 0; } return t.takes; }
  function addTake(t, buf, name) { ensureTakes(t); t.takes.push({ name: name || `Prise ${t.takes.length + 1}`, buffer: buf }); }
  function setActiveTake(t, i) { ensureTakes(t); if (!t.takes[i]) return; pushUndo(t, { buffer: t.buffer, fxDone: (t.fxDone || []).slice(), label: 'Changer de prise' }); t.activeTake = i; t.buffer = t.takes[i].buffer; t.original = t.takes[i].buffer; masterResult = null; drawList(); drawEdit(); updUndo(); }
  function splitIntoTakes(t) {
    const sr = t.buffer.sampleRate;
    const loopSec = (sel && timeline.selTrack() === t && sel[1] - sel[0] > 0.3) ? sel[1] - sel[0] : t.buffer.duration;
    const pieces = splitLoopTakes(t.buffer.length, Math.floor(loopSec * sr));
    if (pieces.length < 2) return toast('Pour découper en prises : sélectionne d’abord la longueur d’un tour de boucle sur la piste.');
    t.takes = pieces.map((p, i) => ({ name: `Tour ${i + 1}`, buffer: sliceBuffer(t.buffer, p.a / sr, p.b / sr) }));
    t.activeTake = 0; setActiveTake(t, 0);
    toast(`Enregistrement découpé en ${pieces.length} prises (un tour chacune) ✓`, 'ok');
  }
  function addCompChoice(t) {
    if (!sel || timeline.selTrack() !== t) return toast('Sélectionne d’abord un passage sur cette piste (outil ⬚).');
    ensureTakes(t); (t.compChoices ||= []).push({ a: sel[0], b: sel[1], take: t.activeTake || 0 });
    toast(`Passage ${fmtTime(sel[0])}–${fmtTime(sel[1])} → ${t.takes[t.activeTake || 0].name}`); drawEdit();
  }
  function doComp(t) {
    const takes = ensureTakes(t); if (takes.length < 2) return toast('Il faut au moins 2 prises pour comper.');
    const sr = t.buffer.sampleRate, total = Math.max(...takes.map(k => k.buffer.length));
    const mono = takes.map(k => { const d = k.buffer.getChannelData(0); if (d.length === total) return d; const e = new Float32Array(total); e.set(d.subarray(0, total)); return e; });
    const segs = planComp(total, (t.compChoices || []).map(c => ({ a: c.a * sr, b: c.b * sr, take: c.take })), t.activeTake || 0);
    const out = stitchMono(mono, segs, total, Math.floor(0.01 * sr));
    work('Comping (fusion)…', async () => monoToBuffer(out, sr));
    toast('Prises fusionnées en une piste ✓ (annulable)', 'ok');
  }
  async function startPunch() {
    const t = tracks[selected];
    if (!t || t.kind !== 'voix') return toast('Sélectionne une piste de voix.');
    if (!sel || timeline.selTrack() !== t || sel[1] - sel[0] < 0.1) return toast('Sélectionne d’abord le passage à refaire (outil ⬚).');
    punch = { track: t, in: sel[0], out: sel[1] };
    toast('🎯 Punch : re-chante le passage sélectionné…');
    await startRec().catch(() => { punch = null; });
  }
  function takesSection(t) {
    const takes = t.takes || [];
    const nodes = [
      h('h3', '🎚️ Prises & comping'),
      h('p.tiny.muted', 'Enregistre plusieurs fois dans la MÊME piste (arme-la ●) pour empiler des prises, ou enregistre un long passage en boucle (🔁) puis « Découper ». Choisis ensuite le meilleur bout de chaque prise (comping, fondus de 10 ms).'),
      h('div.row',
        h('button.btn.small', { onclick: () => splitIntoTakes(t) }, '✂️ Découper l’enregistrement en prises'),
        h('button.btn.small', { onclick: () => startPunch() }, '🎯 Punch-in (refaire le passage)')),
    ];
    if (takes.length) {
      nodes.push(h('div.stack', { style: { gap: '4px' } }, takes.map((k, i) => h('div.row', { style: { gap: '6px', alignItems: 'center' } },
        h('button.btn.small' + (i === (t.activeTake || 0) ? '.primary' : '.ghost'), { onclick: () => setActiveTake(t, i) }, (i === (t.activeTake || 0) ? '✓ ' : '') + k.name),
        h('span.tiny.muted', fmtTime(k.buffer.duration)),
        h('button.btn.small.ghost', { title: 'Écouter cette prise', onclick: () => { player.stop(); player.load(k.buffer); player.play(0); } }, '▶'),
        h('button.btn.small.ghost', { title: 'Supprimer cette prise', onclick: () => { if (takes.length <= 1) return toast('Il faut garder au moins une prise.'); takes.splice(i, 1); if ((t.activeTake || 0) >= takes.length) t.activeTake = takes.length - 1; setActiveTake(t, t.activeTake || 0); } }, '✕')))));
      nodes.push(h('div.row',
        h('button.btn.small', { onclick: () => addCompChoice(t) }, '➕ Mettre la prise active sur le passage'),
        h('button.btn.small.primary', { onclick: () => doComp(t) }, '🧩 Fusionner en une piste'),
        h('button.btn.small.ghost', { onclick: () => { t.compChoices = []; drawEdit(); } }, 'Vider les choix')));
      if (t.compChoices?.length) nodes.push(h('div.small.muted', 'Choix de comping : ' + t.compChoices.map(c => `${fmtTime(c.a)}–${fmtTime(c.b)} → ${(t.takes[c.take] || {}).name || '?'}`).join(' · ')));
    }
    return nodes;
  }
  const stopBtn = h('button.btn', { title: 'Stop (revient là où tu avais lancé la lecture)', onclick: () => { if (recorder) return stopRec(); const back = live.srcs.length ? live.from : seekPos; stopLive(false); player.stop(); seekPos = back; } }, '⏹');
  const homeBtn = h('button.btn', { title: 'Revenir au début', onclick: () => { seekPos = 0; if (live.srcs.length) playLive(0); } }, '⏮');
  // ---------- Barre de transport : mesures:temps, BPM, tonalité, métronome, décompte, boucle ----------
  const barsLbl = h('span.kpi', fmtBarsBeats(0, transport.bpm, transport.bpb));
  const bpmInput = h('input', { type: 'number', min: 40, max: 300, value: transport.bpm, style: { width: '68px' }, title: 'Tempo (BPM)', onchange: (e) => { transport.bpm = clampBpm(e.target.value); e.target.value = transport.bpm; saveTransport(); } });
  const keyLbl = h('span.small.muted', '');
  const metroBtn = h('button.btn.small' + (transport.metro ? '.primary' : ''), { title: 'Métronome', onclick: (e) => { transport.metro = !transport.metro; e.currentTarget.classList.toggle('primary', transport.metro); saveTransport(); if (transport.metro && recorder) metro.start(); if (!transport.metro) metro.stop(); } }, '🥁 Métronome');
  const metroVol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: transport.metroVol, style: { width: '68px' }, title: 'Volume du métronome', oninput: (e) => { transport.metroVol = Number(e.target.value); saveTransport(); } });
  const countSel = h('select', { title: 'Décompte avant la prise' }, [0, 1, 2].map(n => h('option', { value: n, selected: n === transport.countIn }, n === 0 ? 'Décompte : non' : `Décompte : ${n} mesure${n > 1 ? 's' : ''}`)));
  countSel.onchange = () => { transport.countIn = Number(countSel.value); saveTransport(); };
  const loopBtn = h('button.btn.small' + (transport.loop ? '.primary' : ''), { title: 'Boucle de lecture', onclick: (e) => { transport.loop = !transport.loop; e.currentTarget.classList.toggle('primary', transport.loop); saveTransport(); } }, '🔁 Boucle');
  const barsTimer = setInterval(() => { try { const pos = live.srcs.length ? livePos() : (player.playing && tracks[selected] ? (tracks[selected].offset || 0) - minOffNow() + player.position : seekPos); barsLbl.textContent = fmtBarsBeats(pos, transport.bpm, transport.bpb); keyLbl.textContent = ingeSession.keyLabel ? `🎵 ${ingeSession.keyLabel}` : ''; } catch {} }, 150);
  const transportRow = h('div.row', { style: { flexWrap: 'wrap', gap: '8px', alignItems: 'center' } },
    loopBtn, h('span.small.muted', 'Mesure'), barsLbl,
    h('span.small.muted', 'BPM'), bpmInput, keyLbl,
    metroBtn, h('span.small.muted', '🔊'), metroVol, countSel,
    h('button.btn.small.ghost', { title: 'Poser un marqueur à la tête de lecture (double-clic sur le drapeau pour renommer/supprimer)', onclick: addMarker }, '🚩 Marqueur'));
  el.append(
    h('div.card.stack', { style: { marginBottom: '14px' } },
      h('div.row', { style: { flexWrap: 'wrap', gap: '8px', alignItems: 'center' } },
        h('h3', { style: { margin: 0 } }, '🎚️ Mes pistes'), homeBtn, playBtn, stopBtn, recBtn, recTime, timeline.posLbl, h('div.grow', { style: { minWidth: '120px' } }, meter)),
      transportRow,
      h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } }, timeline.tools,
        h('button.btn.small.primary', { onclick: () => addEmptyTrack() }, '➕ Ajouter une piste'),
        h('button.btn.small', { onclick: async () => { for (const f of await pickLocalFiles('audio/*,video/*')) await addBlob(f, f.name); } }, '📥 Importer (instru, voix…)'),
        h('button.btn.small', { onclick: async () => { for (const f of await pickFromLibrary({ kinds: ['audio', 'video'] })) await addBlob(await fetchFileBlob(f.id), f.name, null, f.id); } }, '📚 Mes fichiers'),
        trashBtn, h('button.btn.small.ghost', { onclick: newProject }, '🗑️ Nouveau projet'), saveLbl),
      micMeter.proxEl,
      timeline.el, timeline.selBar, knobBox,
      h('p.tiny.muted', '⌨️ Raccourcis : Espace = lecture / pause (stop pendant une prise) · R = enregistrer · E ou Suppr = effacer le passage sélectionné (sinon la piste) · Ctrl+Z = annuler · Ctrl+Y = rétablir · M = muet · S = solo · A = armer ● · N = nouvelle piste · ↑ ↓ = changer de piste · ← → = reculer / avancer de 5 s · Maj + ← → = décaler la piste de 10 ms pour la caler · F = tout voir · Entrée = début · Échap = stop.'),
      h('p.tiny.muted', '➕ Ajouter une piste (backs, refrain…) puis ⏺ : la prise va dans la piste armée ● et l’enregistrement démarre là où est la tête de lecture, en jouant tout le reste. Clique sur la ligne de temps pour placer la lecture · ⬚ Sélectionner : glisse sur une prise pour choisir un passage à couper · ✋ Déplacer : glisse une prise pour la caler · M = muet, S = solo, Vol = volume, G/D = gauche/droite.')),
    h('div.card.stack', { style: { marginBottom: '14px' } },
      h('div.row', h('h3', { style: { margin: 0 } }, '🎚️ Console de mixage'), h('span.tiny.muted', 'Faders, panoramique, M/S, inserts par piste · master avec analyseur de spectre et sonie. Lance la lecture (▶) pour voir les vu-mètres bouger.')),
      mixerStrips),
    h('div.grid.two',
    h('div.stack',
      ast.card,
      h('div.card.stack',
        h('h3', '⚙️ Réglages d’enregistrement'),
        h('label.chk.small', withBeat, 'Lancer l’instru pendant l’enregistrement (casque conseillé)'),
        h('label.chk.small', rawMode, 'Mode studio : désactiver les filtres automatiques du micro (meilleur son, à nettoyer ensuite)'),
        h('div.row', h('span.small', '🎧 Retour casque :'), monTestBtn),
        h('p.tiny.muted', 'Retour en direct : casque filaire conseillé (en Bluetooth ta voix arrive en retard). L’autotune ne s’entend pas en direct : il se calcule après.'),
        prompter,
        h('button.btn.small.ghost', { onclick: () => { localStorage.removeItem('studio.prompter'); prompter.style.display = 'none'; } }, 'Masquer le texte'),
      ),
    ),
    h('div.stack',
      h('div.card.stack',
        h('h3', '🎚️ Ingé son IA'),
        h('label.chk.small', ingeOn, 'Activer — analyse, autotune et mix automatiques (100 % en local, gratuit)'),
        h('label.chk.small', ingeAuto, 'Traiter chaque prise automatiquement dès la fin de l’enregistrement'),
        h('label.chk.small', ingeExpert, '🎓 Mode expert : analyse poussée (dynamique, sifflantes, résonance, clipping, LUFS), de-esser + EQ anti-résonance, voix calée au-dessus de l’instru, conseils d’ingé pro'),
        h('div.row', h('span.small', '🎚️ Style :'), h('div.grow', ingeStyle)),
        h('div.row', h('button.btn.small', { onclick: () => openConsult() }, '💬 Consulter l’ingé son (voix, basses, mastering, référence)')),
        h('div.row', h('button.btn.small', { onclick: (e) => micTest(e.target) }, '🎤 Test micro (5 s)'), h('button.btn.small', { onclick: (e) => analyzeInstru(e.target) }, '🎵 Analyser l’instru (tonalité + BPM)')),
        micInfo, instruInfo,
        h('p.tiny.muted', 'Après chaque prise : rôle proposé (Lead, Double, Backs, Ad-lib), chaîne selon les mesures (débruitage dosé, anti-pop, gate, calage, autotune dans la tonalité, chaîne voix et volume/panoramique du rôle, écho au tempo), rapport chiffré, conseils (mesures seules, aucun audio envoyé), A/B. Vu-mètre et alerte « SATURE » dans « Mes pistes ».'),
        ingeReport),
      h('div.card.stack', editBox),
      h('div.card.stack',
        h('h3', '🎛️ Mixage et mastering'),
        h('p.small.muted', 'Toutes les pistes non muettes sont mixées (volume, panoramique, décalage), puis masterisées : égalisation, compression de bus, largeur stéréo, sonie cible et limiteur à −1 dBFS.'),
        h('button.btn.primary', { onclick: (e) => doEverything(e.target) }, '⚡ Tout faire : nettoyer, caler, mixer, masteriser'),
        h('p.tiny.muted', 'En un clic : débruitage, coupe des blancs, voix rap claire, calage sur le beat, volumes, mix et master. Tu peux ensuite retoucher piste par piste.'),
        h('button.btn.primary', { onclick: (e) => balanceAndMaster(e.target) }, '🎚️ Mixer et masteriser tout (Ingé son)'),
        h('p.tiny.muted', 'Équilibre toutes les pistes selon leur rôle (volumes et panoramiques déjà posés) puis masterise avec ton preset préféré (mémorisé).'),
        h('div.row', h('div.grow', masterSel), h('button.btn', { onclick: doMaster }, '🎛️ Mixer + masteriser')),
        h('div.row', h('button.btn', { onclick: (e) => compareMasters(e.target) }, '🎧 Faire plusieurs versions et choisir'),
          h('span.tiny.muted', 'Un morceau déjà fini ? Importe-le seul : il sera remasterisé en plusieurs styles.')),
        masterInfo, masterMeters, mixPlayerEl,
        h('div.row', h('button.btn.small', { onclick: (e) => analyzeReference(e.target) }, '📊 Analyser une référence (comparer mon mix)'), h('span.tiny.muted', 'Importe un morceau pro : je compare sonie, balance et stéréo et je te dis quoi ajuster.')),
        refBox, compareBox,
        h('div.row', bitSel,
          h('button.btn.small', { onclick: async () => { if (!masterResult) await doMaster(); if (masterResult) downloadBlob(encodeWav(masterResult.buffer, Number(bitSel.value)), `${exportName()}-master.wav`); } }, '⬇️ Télécharger le master'),
          h('button.btn.small', { onclick: async () => { if (!masterResult) await doMaster(); if (masterResult) uploadFile(encodeWav(masterResult.buffer, Number(bitSel.value)), { name: `${exportName()}-master.wav`, source: 'master' }).then(() => toast('Master enregistré dans Fichiers', 'ok')).catch(toastErr); } }, '💾 Enregistrer le master'),
          h('button.btn.small', { onclick: () => tracks.forEach((t, i) => downloadBlob(encodeWav(t.buffer, Number(bitSel.value)), `${String(i + 1).padStart(2, '0')}-${t.name.replace(/[^\w\- ]+/g, '')}.wav`)) }, '⬇️ Pistes séparées'),
          h('button.btn.small', { onclick: async () => { for (const t of tracks.filter(x => x.kind === 'voix')) await uploadFile(encodeWav(t.buffer), { name: `${t.name.replace(/[^\w\- ]+/g, '')}-voix-traitee.wav`, source: 'voix' }); toast('Voix enregistrées', 'ok'); } }, '💾 Enregistrer les voix traitées')),
      ),
    ),
  ));
  // Tableau de bord professionnel : accès direct aux zones de travail déjà présentes.
  const studioSections = [
    ['🎙️ Enregistrement', 'Réglages d’enregistrement'],
    ['🎚️ Console', 'Console de mixage'],
    ['🧠 Ingénieur son IA', 'Ingé son IA'],
    ['🎛️ Mix & mastering', 'Mixage et mastering'],
  ];
  const studioHeader = h('section.card.stack', { style: { marginBottom: '14px', padding: '16px', border: '1px solid var(--accent)', background: 'linear-gradient(120deg, color-mix(in srgb, var(--accent) 13%, var(--panel)), var(--panel))' } },
    h('div.row', { style: { alignItems: 'center', justifyContent: 'space-between' } },
      h('div.stack', { style: { gap: '3px' } },
        h('span.tiny', { style: { color: 'var(--accent)', fontWeight: 800, letterSpacing: '.12em' } }, 'STUDIO AUDIO PROFESSIONNEL'),
        h('h2', { style: { margin: 0 } }, 'Poste de production'),
        h('p.small.muted', { style: { margin: 0 } }, 'Enregistre ta voix, travaille le son, mixe et prépare ton master depuis un seul espace.')),
      h('span.badge.ok', 'Traitement local')),
    h('div.row', { style: { gap: '7px' } }, ...studioSections.map(([label, target]) =>
      h('button.btn.small', { onclick: () => {
        const heading = [...el.querySelectorAll('h3')].find(x => x.textContent.includes(target));
        const card = heading?.closest('.card');
        if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); card.style.outline = '2px solid var(--accent)'; setTimeout(() => { card.style.outline = ''; }, 1200); }
      } }, label))),
    h('p.tiny.muted', { style: { margin: 0 } }, 'Parcours conseillé : 1. préparer le micro et enregistrer · 2. corriger/nettoyer la voix · 3. équilibrer les pistes · 4. masteriser et exporter. Les commandes ci-dessous pilotent les outils existants du projet.')
  );
  el.prepend(studioHeader);

  await restoreSession();
  drawList(); drawEdit(); ast?.refresh();

  // Chargements depuis d'autres sections
  for (const [key, kind] of [['beat', 'instru'], ['file', null]]) {
    const id = params.get(key);
    if (id) {
      try {
        const meta = (await api('/api/files')).files.find(f => f.id === id);
        await addBlob(await fetchFileBlob(id), meta?.name || 'audio', kind, id);
      } catch (e) { toastErr(e); }
    }
  }
  // ---------- Raccourcis clavier (comme dans un logiciel de studio) ----------
  // Espace = lecture / pause (ou stop pendant une prise) · R = enregistrer · Entrée/Début = revenir au début · Échap = stop
  const onKey = (e) => {
    if (e.altKey || e.repeat) return;
    const k = (e.key || '').toLowerCase();
    const tg = e.target, tag = (tg?.tagName || '').toLowerCase();
    const typing = tg?.isContentEditable || tag === 'textarea' || (tag === 'input' && !['range', 'checkbox', 'radio', 'button'].includes(tg.type)) || tag === 'select';
    if (typing || document.querySelector('.modal, dialog[open]')) return;
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoBtn.click(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redoBtn.click(); }
      return;
    }
    const cur = tracks[selected];
    if (k === 'e' || e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      if (sel && timeline?.selTrack()) timeline.edit?.('delete');
      else if (cur) timelineRemove(selected);
      return;
    }
    if (k === 'm' && cur) { cur.mute = !cur.mute; liveGain(); drawList(); return; }
    if (k === 's' && cur) { cur.solo = !cur.solo; liveGain(); drawList(); return; }
    if (k === 'a' && cur) { const on = !cur.armed; tracks.forEach(x => { x.armed = false; }); cur.armed = on; drawList(); return; }
    if (k === 'n') { e.preventDefault(); addEmptyTrack(); return; }
    if (k === 'f') { timeline?.fit(); return; }
    if (k === 'l') { loopBtn.click(); return; }
    if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && e.shiftKey && cur) {
      // Maj + ← → : décaler la piste de 10 ms pour la caler au poil
      e.preventDefault(); const d = (e.code === 'ArrowRight' ? 1 : -1) * 0.01;
      cur.offset = (cur.offset || 0) + d; masterResult = null; drawList(); toast(`« ${cur.name} » décalée : ${Math.round(cur.offset * 1000)} ms`); return;
    }
    if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') { e.preventDefault(); seekPos = Math.max(0, (live.srcs.length ? livePos() : seekPos) + (e.code === 'ArrowRight' ? 5 : -5)); if (live.srcs.length) playLive(seekPos); return; }
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { if (!tracks.length) return; e.preventDefault(); selected = Math.max(0, Math.min(tracks.length - 1, selected + (e.code === 'ArrowDown' ? 1 : -1))); drawList(); drawEdit(); return; }
    if (e.code === 'Space') { e.preventDefault(); tg?.blur?.(); if (recorder) stopRec(); else if (live.srcs.length) stopLive(); else playLive(); }
    else if (k === 'r') { e.preventDefault(); recorder ? stopRec() : startRec().catch(() => {}); }
    else if (e.code === 'Home' || e.code === 'Enter' && tag !== 'button') { e.preventDefault(); seekPos = 0; if (live.srcs.length) playLive(0); }
    else if (e.code === 'Escape') { if (recorder) stopRec(); else { const back = live.srcs.length ? live.from : seekPos; stopLive(false); player.stop(); seekPos = back; } }
  };
  document.addEventListener('keydown', onKey);
  renderMixer(); mixerLoop();

  return () => { document.removeEventListener('keydown', onKey); ast?.destroy(); stopLive(); player.stop(); stopMonitor(); metro.stop(); clearInterval(barsTimer); cancelAnimationFrame(mixerRAF); try { beatSrc?.stop(); } catch {} recorder?.stop(); clearInterval(timer); };
}

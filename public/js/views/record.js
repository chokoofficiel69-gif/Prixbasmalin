import { api, h, state, toast, toastErr, uploadFile, downloadBlob, pickLocalFiles, pickFromLibrary, fetchFileBlob, fmtTime, startRecorder, audioCtx, transcribe, fileUrl, modal, parseJsonLoose, confirmBox } from '../lib/core.js';
import { mountAssistant } from './assistant.js';
import { putItem, getItem, delItem, packBuffer, unpackBuffer } from '../lib/session.js';
import { PRESETS as VFX, PRESET_CATS as VFX_CATS, KEY_CHOICES, applyChain, keyName, detectChords, keyFromChords } from '../lib/voicefx.js';
import { decodeBlob, encodeWav, denoise, antipop, gate, voiceChain, mix, master, MASTER_PRESETS, drawWave, bufferPlayer, sliceBuffer, cloneBuffer, normalize, loudness, makeBuffer, onsetStrength, onsetPeaks, bestAlignShift } from '../lib/audio.js';

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
    if (s.t === 'tune') out.push({ t: 'tune', strength: clampN(s.strength, [0, 1], 1), speed: clampN(s.speed, [0, 200], 30) });
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
  let recorder = null, beatSrc = null, recLatency = null;

  const list = h('div.stack');
  const editBox = h('div.stack');
  const prompter = h('div.lyrics.small', { style: { maxHeight: '220px', overflow: 'auto', padding: '8px', background: 'var(--bg)', borderRadius: '10px' } });
  const pText = localStorage.getItem('studio.prompter');
  if (pText) prompter.textContent = pText; else prompter.style.display = 'none';

  const player = bufferPlayer((t, ended) => { posLbl.textContent = fmtTime(t); redrawSelected(t); if (ended) playSelBtn.textContent = '▶ Piste'; });
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
        await putItem(SKEY, { v: 1, at: Date.now(), selected, tracks: tracks.map(t => ({ name: t.name, kind: t.kind, gainDb: t.gainDb, pan: t.pan, offset: t.offset, mute: t.mute, fxDone: t.fxDone || [], fileId: t.fileId,
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
  // Volumes rapides : instru dans le casque (et dans le mix) · niveau de la voix enregistrée
  let beatGainNode = null, micDb = Number(localStorage.getItem('studio.micDb') || 0);
  const instruLbl = h('b', '');
  const instruVol = h('input', { type: 'range', min: -30, max: 6, step: 0.5, value: -4 });
  const syncVoice = () => { const has = tracks.some(t => t.kind === 'voix'); micVol.disabled = !has; micLbl.textContent = has ? `${micDb} dB` : '(pas encore de voix enregistrée)'; };
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
    let an = null, srcNode = null, raf = 0, hold = -90, holdT = 0, clipT = 0;
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
      raf = requestAnimationFrame(loop);
    }
    return {
      el,
      attachNode(node) { this.detach(); const ctx = audioCtx(); an = ctx.createAnalyser(); an.fftSize = 2048; node.connect(an); srcNode = node; loop(); },
      attachStream(stream) { this.detach(); const ctx = audioCtx(); const src = ctx.createMediaStreamSource(stream); an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an); srcNode = src; loop(); },
      detach() { cancelAnimationFrame(raf); try { srcNode?.disconnect(an); } catch {} an = null; srcNode = null; bar.style.width = '0%'; val.textContent = '—'; clip.style.visibility = 'hidden'; hold = -90; },
    };
  }
  const micMeter = makeMeter('🎤 Micro (ce qui est enregistré)');
  const outMeter = makeMeter('🔊 Sortie (instru + voix)');

  // ---------- Écoute du mix EN DIRECT : chaque curseur de volume agit pendant la lecture ----------
  const live = { srcs: [], gains: new Map(), timer: null };
  const liveBtn = h('button.btn.small.primary', '▶ Écouter tout (volumes en direct)');
  function liveGain(t) { const g = live.gains.get(t); if (g) g.gain.setTargetAtTime(t.mute ? 0 : 10 ** (t.gainDb / 20), audioCtx().currentTime, 0.02); }
  function stopLive() { outMeter.detach(); live.srcs.forEach(s => { try { s.stop(); } catch {} }); live.srcs = []; live.gains.clear(); clearTimeout(live.timer); liveBtn.textContent = '▶ Écouter tout (volumes en direct)'; }
  function playLive() {
    stopLive(); player.stop();
    if (!tracks.length) return toast('Aucune piste à écouter.');
    const ctx = audioCtx(), minOff = Math.min(0, ...tracks.map(t => t.offset || 0)), t0 = ctx.currentTime + 0.05;
    const bus = ctx.createGain(); bus.connect(ctx.destination); outMeter.attachNode(bus);
    let end = 0;
    for (const t of tracks) {
      const src = ctx.createBufferSource(); src.buffer = t.buffer;
      const g = ctx.createGain(); g.gain.value = t.mute ? 0 : 10 ** (t.gainDb / 20);
      const pan = ctx.createStereoPanner(); pan.pan.value = t.pan || 0;
      src.connect(g).connect(pan).connect(bus);
      const off = (t.offset || 0) - minOff; src.start(t0 + off);
      live.srcs.push(src); live.gains.set(t, g); end = Math.max(end, off + t.buffer.duration);
    }
    liveBtn.textContent = '⏹ Arrêter l’écoute';
    live.timer = setTimeout(stopLive, end * 1000 + 300);
  }
  liveBtn.onclick = () => (live.srcs.length ? stopLive() : playLive());
  const micLbl = h('b', `${micDb} dB`);
  const micVol = h('input', { type: 'range', min: -20, max: 12, step: 0.5, value: micDb, oninput: () => { micDb = Number(micVol.value); micLbl.textContent = `${micDb} dB`; localStorage.setItem('studio.micDb', micDb); const v = tracks[selected] && tracks[selected].kind !== 'instru' ? tracks[selected] : tracks[tracks.map(t => t.kind).lastIndexOf('voix')]; if (v) { v.gainDb = micDb; liveGain(v); masterResult = null; drawList(); } } });
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
      startMonitor(monTestStream); micMeter.attachStream(monTestStream); monTestBtn.textContent = '⏹ Arrêter le test';
      toast('🎧 Tu t’entends dans le casque. Règle « Ma voix dans le casque ». (Casque filaire conseillé.)');
    } catch (e) { monOn.checked = false; toast('Micro inaccessible : ' + e.message, 'bad'); }
  }
  monStyle.onchange = () => { localStorage.setItem('studio.mon.style', monStyle.value); const st = monitor?.stream; if (st) { stopMonitor(true); startMonitor(st); } };
  monVol.oninput = () => { localStorage.setItem('studio.mon.vol', monVol.value); if (monitor) monitor.out.gain.value = Number(monVol.value); };
  function startMonitor(stream) {
    stopMonitor(true);
    const ctx = audioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const f = (type, freq, gain = 0, q = 0.8) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.gain.value = gain; n.Q.value = q; return n; };
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -22; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.12;
    const out = ctx.createGain(); out.gain.value = Number(monVol.value);
    const st = monStyle.value;
    let last = src.connect(f('highpass', 90));
    if (st !== 'propre') last = last.connect(f('peaking', 3200, 4)).connect(f('highshelf', 10000, 3));
    last = last.connect(comp);
    last.connect(out);
    if (st === 'reverb') {
      const cv = ctx.createConvolver(); const len = Math.floor(ctx.sampleRate * 1.6); const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3; }
      cv.buffer = ir; const wet = ctx.createGain(); wet.gain.value = 0.3; last.connect(cv).connect(wet).connect(out);
    }
    if (st === 'echo') {
      const d = ctx.createDelay(1); d.delayTime.value = 0.3; const fb = ctx.createGain(); fb.gain.value = 0.3; const wet = ctx.createGain(); wet.gain.value = 0.3;
      last.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(out);
    }
    out.connect(ctx.destination);
    monitor = { src, out, stream };
  }
  function stopMonitor(keepTest = false) {
    try { monitor?.src.disconnect(); monitor?.out.disconnect(); } catch {}
    monitor = null;
    if (!keepTest && monTestStream) { micMeter.detach(); monTestStream.getTracks().forEach(t => t.stop()); monTestStream = null; monTestBtn.textContent = '🎧 Tester le retour'; }
  }
  const micConstraints = () => {
    const base = rawMode.checked ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    // Avec le retour casque, l'annulation d'écho coupe ou déforme sa propre voix : on la désactive (casque obligatoire)
    return monOn.checked ? { ...base, echoCancellation: false } : base;
  };
  const monTestBtn = h('button.btn.small.ghost', '🎧 Tester le retour');
  monTestBtn.onclick = async () => {
    if (monTestStream) { stopMonitor(); return; }
    try {
      monTestStream = await navigator.mediaDevices.getUserMedia({ audio: { ...micConstraints(), echoCancellation: false } });
      startMonitor(monTestStream); micMeter.attachStream(monTestStream); monTestBtn.textContent = '⏹ Arrêter le test';
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
      stopMonitor();
      const r = recorder; recorder = null;
      try { beatSrc?.stop(); } catch {} beatSrc = null; outMeter.detach();
      recBtn.textContent = '⏺ Enregistrer'; meter.firstChild.style.width = '0';
      micMeter.detach();
      const blob = await r.stop();
      delItem(PKEY).catch(() => {});
      // Calage automatique : la prise commence avant l'instru (temps de démarrage) et arrive en retard
      // (latence du casque + du micro). On replace la voix sur l'instru, puis on affine sur le beat.
      const lat = recLatency; recLatency = null;
      await addBlob(blob, `Prise ${tracks.filter(t => t.kind === 'voix').length + 1}`, 'voix', null, lat ? -lat : 0);
      if (tracks[selected]?.kind === 'voix') tracks[selected].gainDb = micDb;
      beatGainNode = null; saveSoon(true);
      if (monOn.checked) openLiveMonitor();
      if (lat && tracks.some(t => t.kind === 'instru')) await alignSelected(true);
      stopping.p = null;
      ast?.onRecordStopped();
    })();
    return stopping.p;
  }
  async function startRec({ autoStopSilence = 0, autoStopBeat = false, seconds = 0 } = {}) {
    if (recorder) return;
    try {
      stopMonitor();
      const constraints = micConstraints();
      const beat = tracks.find(t => t.kind === 'instru' && !t.mute);
      recAuto = { sil: autoStopSilence, spoke: false, last: performance.now() };
      let lastPend = 0;
      const pendOffset = 0;
      recorder = await startRecorder({ constraints, onChunk: (chunks) => {
        const now = performance.now(); if (now - lastPend < 2000) return; lastPend = now;
        putItem(PKEY, { chunks: chunks.slice(), type: chunks[0]?.type, offset: pendOffset }).catch(() => {});
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
      if (withBeat.checked && beat) {
        const ctx = audioCtx();
        beatSrc = ctx.createBufferSource(); beatSrc.buffer = beat.buffer;
        const g = ctx.createGain(); g.gain.value = 10 ** (beat.gainDb / 20); beatGainNode = g;
        beatSrc.connect(g).connect(ctx.destination); outMeter.attachNode(g); beatSrc.start();
        if (autoStopBeat) beatSrc.onended = () => { if (recorder) { toast('Fin de l’instru : prise arrêtée.'); stopRec(); } };
        const beatT0 = performance.now();
        const outLat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
        const inLat = Number(recorder.stream.getAudioTracks()[0]?.getSettings?.().latency) || 0.02;
        // + décalage de l'instru elle-même sur la timeline
        recLatency = (beatT0 - recT0) / 1000 + outLat + inLat - (beat.offset || 0);
        toast('Instru lancée : utilisez un casque pour qu’elle ne s’entende pas dans la prise.');
      }
      recBtn.textContent = '⏹ Arrêter';
      timer = setInterval(() => { recTime.textContent = fmtTime(recorder?.duration); }, 200);
      if (seconds > 0) { const r0 = recorder; setTimeout(() => { if (recorder === r0) { toast(`${seconds} s enregistrées : prise arrêtée.`); stopRec(); } }, seconds * 1000); }
      ast?.onRecordStarted();
    } catch (e) { recorder = null; recAuto = null; toast('Micro inaccessible : ' + e.message, 'bad'); throw e; }
  }

  // ---------- Liste des pistes ----------
  function drawList() {
    saveSoon(); syncInstru?.();
    list.innerHTML = '';
    if (!tracks.length) list.append(h('p.muted.small', 'Aucune piste. Enregistrez votre voix ou importez un fichier (instru, voix, son).'));
    tracks.forEach((t, i) => {
      const c = h('canvas.wave', { style: { height: '46px', cursor: 'pointer' }, onclick: () => { selected = i; sel = null; player.stop(); drawList(); drawEdit(); } });
      const gl = h('b', t.gainDb);
      list.append(h('div.card' + (i === selected ? '.sel' : ''), { style: { padding: '10px', outline: i === selected ? '2px solid var(--accent)' : '' } },
        h('div.row', h('strong', (t.kind === 'instru' ? '🥁 ' : '🎤 ') + t.name), h('span.small.muted', fmtTime(t.buffer.duration)),
          h('select', { onchange: (e) => { t.kind = e.target.value; drawList(); } }, h('option', { value: 'voix', selected: t.kind === 'voix' }, 'Voix'), h('option', { value: 'instru', selected: t.kind === 'instru' }, 'Instru'), h('option', { value: 'autre', selected: t.kind === 'autre' }, 'Autre')),
          h('label.chk.small', h('input', { type: 'checkbox', checked: t.mute, onchange: (e) => { t.mute = e.target.checked; liveGain(t); masterResult = null; } }), 'Muet'),
          h('span.grow'),
          h('button.btn.ghost.small', { onclick: () => { tracks.splice(i, 1); if (selected >= tracks.length) selected = tracks.length - 1; masterResult = null; drawList(); drawEdit(); } }, '✕')),
        c,
        h('div.sliders',
          h('label', h('span', 'Volume (dB) ', gl), h('input', { type: 'range', min: -30, max: 12, step: 0.5, value: t.gainDb, oninput: (e) => { t.gainDb = Number(e.target.value); gl.textContent = t.gainDb; liveGain(t); syncInstru(); masterResult = null; } })),
          h('label', h('span', 'Panoramique'), h('input', { type: 'range', min: -1, max: 1, step: 0.05, value: t.pan, oninput: (e) => { t.pan = Number(e.target.value); masterResult = null; } })),
          h('label', h('span', 'Décalage (ms) ', h('b', Math.round(t.offset * 1000))), h('input', { type: 'range', min: -500, max: 3000, step: 5, value: t.offset * 1000, oninput: (e) => { t.offset = Number(e.target.value) / 1000; e.target.previousSibling.lastChild.textContent = e.target.value; masterResult = null; } })))));
      requestAnimationFrame(() => drawWave(c, t.buffer));
    });
  }

  // ---------- Édition de la piste sélectionnée ----------
  const wave = h('canvas.wave', { style: { height: '110px', touchAction: 'none' } });
  let dragFrom = null;
  const tAt = (e) => { const r = wave.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (tracks[selected]?.buffer.duration || 0); };
  wave.addEventListener('pointerdown', (e) => { if (selected < 0) return; dragFrom = tAt(e); sel = null; wave.setPointerCapture(e.pointerId); });
  wave.addEventListener('pointermove', (e) => { if (dragFrom === null) return; const t = tAt(e); sel = [Math.min(dragFrom, t), Math.max(dragFrom, t)]; redrawSelected(); });
  wave.addEventListener('pointerup', (e) => { const t = tAt(e); if (dragFrom !== null && Math.abs(t - dragFrom) < 0.05) { sel = null; player.seek(t); } dragFrom = null; redrawSelected(); selLbl.textContent = sel ? `Sélection : ${fmtTime(sel[0])} → ${fmtTime(sel[1])} (${(sel[1] - sel[0]).toFixed(1)} s)` : 'Glissez sur la forme d’onde pour sélectionner un passage.'; });
  const selLbl = h('span.small.muted', 'Glissez sur la forme d’onde pour sélectionner un passage.');
  function redrawSelected(playhead) { const t = tracks[selected]; if (t) drawWave(wave, t.buffer, { sel, playhead: playhead ?? player.position }); }
  const playSelBtn = h('button.btn.small', '▶ Piste');
  playSelBtn.onclick = () => {
    const t = tracks[selected]; if (!t) return;
    if (player.playing) { player.pause(); playSelBtn.textContent = '▶ Piste'; return; }
    player.load(t.buffer); player.play(sel ? sel[0] : 0); playSelBtn.textContent = '⏸';
  };
  const busy = h('span.small.muted');
  async function work(label, fn) {
    const t = tracks[selected]; if (!t) return;
    busy.innerHTML = `<span class="spinner"></span> ${label}`;
    player.stop();
    try {
      const before = { buffer: t.buffer, fxDone: (t.fxDone || []).slice(), label: label.replace('…', '') };
      const out = await fn(t.buffer, t);
      if (out && out !== t.buffer) { pushUndo(t, before); t.buffer = out; }
      masterResult = null; drawList(); redrawSelected(); updUndo();
      busy.textContent = `✓ ${label.replace('…', '')} terminé · « ↩ Annuler » pour revenir en arrière`;
    }
    catch (e) { busy.textContent = ''; toastErr(e); }
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
        const st = voiceStart(t);
        const part = sliceBuffer(t.buffer, st, Math.min(t.buffer.duration, st + 15));
        const r = await process(part, t, st, say);
        if (urls) Object.values(urls).forEach(u => URL.revokeObjectURL(u));
        urls = { a: URL.createObjectURL(encodeWav(part)), b: URL.createObjectURL(encodeWav(r.buffer || r)) };
        audio.src = urls.b; audio.style.display = ''; bar.style.display = ''; audio.play().catch(() => {});
        applyFn = onApply; applyBtn.style.display = onApply ? '' : 'none';
        info.textContent = `▶ Aperçu « ${label} »${r.note ? ' · ' + r.note : ''} — compare A/B puis applique si ça te plaît.`;
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
      h('div.row', h('h3.grow', `✂️ Éditer : ${t.name}`), playSelBtn, posLbl),
      wave, selLbl,
      h('div.row.undo-bar', { style: { position: 'sticky', bottom: '0', zIndex: 5, background: 'var(--card, var(--bg))', padding: '6px 0' } }, undoBtn, redoBtn, h('div.grow', busy)),
      h('div.row',
        h('button.btn.small', { onclick: () => sel ? work('Rognage…', async (b) => sliceBuffer(b, sel[0], sel[1])).then(() => (sel = null)) : toast('Sélectionnez d’abord un passage.') }, 'Garder la sélection'),
        h('button.btn.small', { onclick: () => sel ? work('Suppression…', async (b) => {
          const a = sliceBuffer(b, 0, sel[0]), c = sliceBuffer(b, sel[1], b.duration);
          const out = makeBuffer(b.numberOfChannels, a.length + c.length, b.sampleRate);
          for (let ch = 0; ch < b.numberOfChannels; ch++) { out.copyToChannel(a.getChannelData(ch), ch, 0); out.copyToChannel(c.getChannelData(ch), ch, a.length); }
          return out;
        }).then(() => (sel = null)) : toast('Sélectionnez d’abord un passage.') }, 'Supprimer la sélection'),
        h('button.btn.small', { onclick: () => work('Fondus…', async (b) => { const o = cloneBuffer(b); const n = Math.min(o.length / 2, Math.floor(0.03 * o.sampleRate)); for (let c = 0; c < o.numberOfChannels; c++) { const d = o.getChannelData(c); for (let i = 0; i < n; i++) { d[i] *= i / n; d[d.length - 1 - i] *= i / n; } } return o; }) }, 'Fondus début/fin'),
        h('button.btn.small', { onclick: () => work('Normalisation…', async (b) => normalize(cloneBuffer(b), -1)) }, 'Normaliser'),
        h('button.btn.small.ghost', { onclick: () => work('Retour à l’original…', async (b, tr) => tr.original) }, '↺ Revenir à l’original')),
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
    requestAnimationFrame(() => redrawSelected());
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
  const masterInfo = h('div.small');
  const mixPlayerEl = h('div');
  const bitSel = h('select', h('option', { value: 16 }, 'WAV 16 bits'), h('option', { value: 24 }, 'WAV 24 bits'));
  async function doMaster() {
    if (!tracks.length) return toast('Ajoutez au moins une piste.');
    masterInfo.innerHTML = '<span class="spinner"></span> Mixage…';
    try {
      const minOff = Math.min(0, ...tracks.map(t => t.offset));
      const mixed = await mix(tracks.map(t => ({ ...t, offset: t.offset - minOff })));
      const r = await master(mixed, masterSel.value, (s) => { masterInfo.innerHTML = `<span class="spinner"></span> ${s}`; });
      masterResult = r;
      masterInfo.innerHTML = '';
      masterInfo.append(h('div', `Sonie : ${r.before.toFixed(1)} → ${r.after.toFixed(1)} LUFS (cible ${r.target}) · crête ${r.peakDb.toFixed(1)} dBFS · durée ${fmtTime(r.buffer.duration)}`));
      mixPlayerEl.innerHTML = '';
      mixPlayerEl.append(h('audio', { controls: true, src: URL.createObjectURL(encodeWav(r.buffer)) }));
    } catch (e) { masterInfo.textContent = ''; toastErr(e); }
  }
  const compareBox = h('div.stack');
  async function compareMasters(btn) {
    if (!tracks.length) return toast('Ajoute ton morceau (ou tes pistes) d’abord.');
    btn.disabled = true; compareBox.innerHTML = '';
    try {
      const minOff = Math.min(0, ...tracks.map(t => t.offset));
      const mixed = await mix(tracks.map(t => ({ ...t, offset: t.offset - minOff })));
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
  // Console de volumes toujours sous la main, dans la carte de l'assistant (réglable pendant qu'on lui parle / qu'on enregistre)
  const monVolLbl = h('b', `${Math.round(Number(monVol.value) * 100)} %`);
  monVol.addEventListener('input', () => { monVolLbl.textContent = `${Math.round(Number(monVol.value) * 100)} %`; });
  const mixer = h('div.stack', { style: { background: 'var(--bg)', borderRadius: '10px', padding: '8px 10px' } },
    h('div.row', h('strong.small.grow', '🎚️ Volumes du casque (en direct)'), liveBtn),
    h('div.sliders',
      h('label', h('span', '🥁 Instru ', instruLbl), instruVol),
      h('label', h('span', '🎤 Ma voix enregistrée ', micLbl), micVol),
      h('label', h('span', '🎧 Ma voix en direct dans le casque ', monVolLbl), monVol)),
    h('label.chk.small', monOn, 'M’entendre en direct dans le casque pendant que j’enregistre'),
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
      delete: async (x) => { const i = trackAt(x.track ?? selected + 1); tracks.splice(i, 1); if (selected >= tracks.length) selected = tracks.length - 1; masterResult = null; drawList(); drawEdit(); },
      all: async () => doEverything(fakeBtn()),
      importInstru: async () => { for (const f of await pickLocalFiles('audio/*,video/*', false)) await addBlob(f, f.name, 'instru'); },
      dropLastVoice: async () => { const i = tracks.map(t => t.kind).lastIndexOf('voix'); if (i >= 0) { tracks.splice(i, 1); selected = tracks.length - 1; masterResult = null; drawList(); drawEdit(); } },
      master: async (x) => { if (x.preset) masterSel.value = masterKey(x.preset); await doMaster(); mixPlayerEl.querySelector('audio')?.play(); },
      versions: async () => compareMasters(fakeBtn()),
      save: async () => { if (!masterResult) await doMaster(); await uploadFile(encodeWav(masterResult.buffer, Number(bitSel.value)), { name: `${exportName()}-master.wav`, source: 'master' }); toast('Master enregistré dans tes fichiers', 'ok'); },
      download: async () => { if (!masterResult) await doMaster(); downloadBlob(encodeWav(masterResult.buffer, Number(bitSel.value)), `${exportName()}-master.wav`); },
    },
  };
  ast = mountAssistant(S);

  const exportName = () => (tracks.find(t => t.kind === 'voix')?.name || 'morceau').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');

  el.append(h('div.grid.two',
    h('div.stack',
      ast.card,
      h('div.card.stack',
        h('h3', '🎙️ Enregistrer'),
        h('div.row', recBtn, recTime, h('div.grow', meter)),
        h('label.chk.small', withBeat, 'Lancer l’instru pendant l’enregistrement (casque conseillé)'),
        h('label.chk.small', rawMode, 'Mode studio : désactiver les filtres automatiques du téléphone (meilleur son, à nettoyer ensuite)'),
        h('div.row', h('span.small', '🎧 Retour casque :'), h('div.grow', monStyle), monTestBtn),
        h('p.tiny.muted', 'Retour en direct : casque filaire conseillé (en Bluetooth ta voix arrive en retard). L’autotune ne s’entend pas en direct : il se calcule après, écoute-le avec « ▶ Écouter ».'),
        prompter,
        h('div.row',
          h('button.btn.small', { onclick: async () => { for (const f of await pickLocalFiles('audio/*,video/*')) await addBlob(f, f.name); } }, '📱 Importer'),
          h('button.btn.small', { onclick: async () => { for (const f of await pickFromLibrary({ kinds: ['audio', 'video'] })) await addBlob(await fetchFileBlob(f.id), f.name, null, f.id); } }, '📚 Depuis mes fichiers'),
          h('button.btn.small.ghost', { onclick: () => { localStorage.removeItem('studio.prompter'); prompter.style.display = 'none'; } }, 'Masquer le texte')),
      ),
      h('div.card.stack', h('div.row', h('h3.grow', '🎚️ Pistes'), h('button.btn.small.ghost', { onclick: newProject }, '🗑️ Nouveau projet')), saveLbl, list),
    ),
    h('div.stack',
      h('div.card.stack', editBox),
      h('div.card.stack',
        h('h3', '🎛️ Mixage et mastering'),
        h('p.small.muted', 'Toutes les pistes non muettes sont mixées (volume, panoramique, décalage), puis masterisées : égalisation, compression de bus, largeur stéréo, sonie cible et limiteur à −1 dBFS.'),
        h('button.btn.primary', { onclick: (e) => doEverything(e.target) }, '⚡ Tout faire : nettoyer, caler, mixer, masteriser'),
        h('p.tiny.muted', 'En un clic : débruitage, coupe des blancs, voix rap claire, calage sur le beat, volumes, mix et master. Tu peux ensuite retoucher piste par piste.'),
        h('div.row', h('div.grow', masterSel), h('button.btn', { onclick: doMaster }, '🎛️ Mixer + masteriser')),
        h('div.row', h('button.btn', { onclick: (e) => compareMasters(e.target) }, '🎧 Faire plusieurs versions et choisir'),
          h('span.tiny.muted', 'Un morceau déjà fini ? Importe-le seul : il sera remasterisé en plusieurs styles.')),
        masterInfo, mixPlayerEl, compareBox,
        h('div.row', bitSel,
          h('button.btn.small', { onclick: async () => { if (!masterResult) await doMaster(); if (masterResult) downloadBlob(encodeWav(masterResult.buffer, Number(bitSel.value)), `${exportName()}-master.wav`); } }, '⬇️ Télécharger le master'),
          h('button.btn.small', { onclick: async () => { if (!masterResult) await doMaster(); if (masterResult) uploadFile(encodeWav(masterResult.buffer, Number(bitSel.value)), { name: `${exportName()}-master.wav`, source: 'master' }).then(() => toast('Master enregistré dans Fichiers', 'ok')).catch(toastErr); } }, '💾 Enregistrer le master'),
          h('button.btn.small', { onclick: () => tracks.forEach((t, i) => downloadBlob(encodeWav(t.buffer, Number(bitSel.value)), `${String(i + 1).padStart(2, '0')}-${t.name.replace(/[^\w\- ]+/g, '')}.wav`)) }, '⬇️ Pistes séparées'),
          h('button.btn.small', { onclick: async () => { for (const t of tracks.filter(x => x.kind === 'voix')) await uploadFile(encodeWav(t.buffer), { name: `${t.name.replace(/[^\w\- ]+/g, '')}-voix-traitee.wav`, source: 'voix' }); toast('Voix enregistrées', 'ok'); } }, '💾 Enregistrer les voix traitées')),
      ),
    ),
  ));
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
  return () => { ast?.destroy(); stopLive(); player.stop(); stopMonitor(); try { beatSrc?.stop(); } catch {} recorder?.stop(); clearInterval(timer); };
}

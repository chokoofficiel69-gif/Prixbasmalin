import { api, h, state, toast, toastErr, uploadFile, downloadBlob, pickLocalFiles, pickFromLibrary, fetchFileBlob, fmtTime, audioCtx, fileUrl, parseJsonLoose, kindOf } from '../lib/core.js';
import { decodeBlob, detectBeats, encodeWav, sliceBuffer } from '../lib/audio.js';

const FORMATS = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [960, 960], '4:5': [864, 1080] };
const TRANSITIONS = [['fondu', 'Fondu'], ['glisse', 'Glissement'], ['zoom', 'Zoom'], ['flash', 'Flash blanc'], ['noir', 'Fondu au noir'], ['aucune', 'Coupe sèche']];
const EFFECTS = [['zoomin', 'Zoom avant lent'], ['zoomout', 'Zoom arrière lent'], ['panG', 'Travelling gauche'], ['panD', 'Travelling droite'], ['fixe', 'Fixe']];
const LOOKS = { naturel: 'none', cinema: 'contrast(1.15) saturate(0.85) sepia(0.12)', nb: 'grayscale(1) contrast(1.25)', vintage: 'sepia(0.45) contrast(0.9) saturate(0.8)', neon: 'saturate(1.7) contrast(1.2) hue-rotate(-20deg)', chaud: 'saturate(1.2) sepia(0.2) brightness(1.05)' };
const LOOK_LABELS = { naturel: 'Naturel', cinema: 'Cinéma', nb: 'Noir & blanc', vintage: 'Vintage', neon: 'Néon', chaud: 'Chaud' };

export async function render(el) {
  const P = { format: '9:16', look: 'cinema', vignette: true, bars: false, pulse: true, title: '', titleDur: 2.5, td: 0.5,
    textStyle: { font: 'Impact, sans-serif', color: '#ffffff', size: 54, pos: 'bas', box: false } };
  const items = []; // {type, name, src(objectURL), el (img|video), dur, trimIn, transition, effect, caption, fileId}
  let music = null; // {buffer, name, offset, beats, bpm, gainDb}
  let subtitles = []; // {start, end, text}
  let playing = null; // état de lecture
  const canvas = h('canvas.preview-canvas');
  const ctx2d = canvas.getContext('2d');
  const tl = h('div.timeline');
  const timeLbl = h('span.small.muted', '0:00 / 0:00');
  const exportInfo = h('div.small');

  const setCanvasSize = () => { const [w, hh] = FORMATS[P.format]; canvas.width = w; canvas.height = hh; };
  setCanvasSize();

  // ---------- Médias ----------
  async function addMedia(blob, name, fileId) {
    const k = kindOf(blob.type);
    const src = URL.createObjectURL(blob);
    if (k === 'image') {
      const img = new Image(); img.src = src;
      await img.decode().catch(() => {});
      items.push({ type: 'image', name, src, el: img, dur: 3, trimIn: 0, transition: 'fondu', effect: EFFECTS[items.length % 4][0], caption: '', fileId });
    } else if (k === 'video') {
      const v = document.createElement('video');
      v.src = src; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
      await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; });
      items.push({ type: 'video', name, src, el: v, dur: Math.min(6, v.duration || 4), trimIn: 0, maxDur: v.duration || 4, transition: 'fondu', effect: 'fixe', caption: '', fileId });
    } else return toast(`« ${name} » n’est ni une image ni une vidéo.`, 'bad');
    drawTimeline(); drawFrame(0);
  }
  async function setMusic(blob, name) {
    try {
      const buffer = await decodeBlob(blob);
      music = { buffer, name, offset: 0, beats: null, bpm: null, gainDb: 0, blob };
      if (autoMusicLbl) autoMusicLbl.textContent = `🎵 ${name} (${fmtTime(buffer.duration)})`;
      musicLbl.textContent = `🎵 ${name} (${fmtTime(buffer.duration)})`;
      drawTimeline();
    } catch { toast('Audio illisible par ce navigateur.', 'bad'); }
  }

  // ---------- Montage : calcul du temps ----------
  const titleOffset = () => (P.title ? P.titleDur : 0);
  function totalDuration() { return titleOffset() + items.reduce((s, i) => s + i.dur, 0); }
  function itemAt(t) {
    let s = titleOffset();
    for (let i = 0; i < items.length; i++) {
      if (t < s + items[i].dur) return { i, local: t - s, start: s };
      s += items[i].dur;
    }
    return items.length ? { i: items.length - 1, local: items[items.length - 1].dur, start: s - items[items.length - 1].dur } : null;
  }

  function drawCover(source, sw, sh, scale = 1, dx = 0, dy = 0) {
    const W = canvas.width, H = canvas.height;
    if (!sw || !sh) return;
    const r = Math.max(W / sw, H / sh) * scale;
    const w = sw * r, hh = sh * r;
    ctx2d.drawImage(source, (W - w) / 2 + dx * W, (H - hh) / 2 + dy * H, w, hh);
  }
  function drawItem(it, local) {
    const p = Math.min(1, Math.max(0, local / it.dur));
    let scale = 1, dx = 0;
    if (it.effect === 'zoomin') scale = 1 + 0.15 * p;
    else if (it.effect === 'zoomout') scale = 1.15 - 0.15 * p;
    else if (it.effect === 'panG') { scale = 1.15; dx = 0.05 - 0.1 * p; }
    else if (it.effect === 'panD') { scale = 1.15; dx = -0.05 + 0.1 * p; }
    if (it.type === 'image') drawCover(it.el, it.el.naturalWidth, it.el.naturalHeight, scale, dx);
    else drawCover(it.el, it.el.videoWidth, it.el.videoHeight, scale, dx);
  }
  function wrap(text, maxW) {
    const words = text.split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx2d.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  function drawText(text, { pos = P.textStyle.pos, size = P.textStyle.size, alpha = 1 } = {}) {
    if (!text) return;
    const W = canvas.width, H = canvas.height, s = P.textStyle;
    const fs = size * (W / 1080) * (P.format === '16:9' ? 1.3 : 1);
    ctx2d.save();
    ctx2d.globalAlpha = alpha;
    ctx2d.font = `800 ${fs}px ${s.font}`;
    ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
    const lines = text.split('\n').flatMap(l => wrap(l, W * 0.86));
    const lh = fs * 1.18;
    const y0 = pos === 'haut' ? H * 0.14 : pos === 'centre' ? H / 2 - ((lines.length - 1) * lh) / 2 : H * 0.84 - (lines.length - 1) * lh;
    lines.forEach((ln, i) => {
      const y = y0 + i * lh;
      if (s.box) { const w = ctx2d.measureText(ln).width + fs * 0.6; ctx2d.fillStyle = 'rgba(0,0,0,.55)'; ctx2d.fillRect(W / 2 - w / 2, y - lh / 2, w, lh); }
      ctx2d.lineJoin = 'round'; ctx2d.lineWidth = fs * 0.14; ctx2d.strokeStyle = 'rgba(0,0,0,.85)';
      if (!s.box) ctx2d.strokeText(ln, W / 2, y);
      ctx2d.fillStyle = s.color; ctx2d.fillText(ln, W / 2, y);
    });
    ctx2d.restore();
  }

  /** Dessine l'image du clip à l'instant t (secondes). */
  function drawFrame(t) {
    const W = canvas.width, H = canvas.height;
    ctx2d.save();
    ctx2d.fillStyle = '#000'; ctx2d.fillRect(0, 0, W, H);
    ctx2d.filter = LOOKS[P.look] || 'none';
    // Pulsation sur le temps fort
    if (P.pulse && music?.beats) {
      const mt = t + music.offset;
      const near = music.beats.reduce((m, b) => Math.min(m, Math.abs(mt - b)), 9);
      if (near < 0.12) { const k = 1 + 0.025 * (1 - near / 0.12); ctx2d.translate(W / 2, H / 2); ctx2d.scale(k, k); ctx2d.translate(-W / 2, -H / 2); }
    }
    if (t < titleOffset()) {
      const it = items[0];
      if (it) { ctx2d.globalAlpha = 0.35; drawItem(it, 0); ctx2d.globalAlpha = 1; }
    } else {
      const at = itemAt(t);
      if (at) {
        const it = items[at.i];
        const prev = items[at.i - 1];
        const td = Math.min(P.td, it.dur / 2);
        if (prev && at.local < td && it.transition !== 'aucune') {
          const k = at.local / td;
          if (it.transition === 'fondu') { drawItem(prev, prev.dur); ctx2d.globalAlpha = k; drawItem(it, at.local); }
          else if (it.transition === 'glisse') { ctx2d.save(); ctx2d.translate(-W * k, 0); drawItem(prev, prev.dur); ctx2d.restore(); ctx2d.save(); ctx2d.translate(W * (1 - k), 0); drawItem(it, at.local); ctx2d.restore(); }
          else if (it.transition === 'zoom') { ctx2d.save(); ctx2d.globalAlpha = 1 - k; ctx2d.translate(W / 2, H / 2); ctx2d.scale(1 + k * 0.6, 1 + k * 0.6); ctx2d.translate(-W / 2, -H / 2); drawItem(prev, prev.dur); ctx2d.restore(); ctx2d.globalAlpha = k; drawItem(it, at.local); }
          else if (it.transition === 'flash') { drawItem(it, at.local); ctx2d.globalAlpha = 1 - k; ctx2d.fillStyle = '#fff'; ctx2d.fillRect(0, 0, W, H); }
          else if (it.transition === 'noir') { if (k < 0.5) { drawItem(prev, prev.dur); ctx2d.globalAlpha = k * 2; } else { drawItem(it, at.local); ctx2d.globalAlpha = (1 - k) * 2; } ctx2d.fillStyle = '#000'; ctx2d.fillRect(0, 0, W, H); }
          ctx2d.globalAlpha = 1;
        } else drawItem(it, at.local);
      }
    }
    ctx2d.restore();
    ctx2d.save();
    if (P.vignette) {
      const g = ctx2d.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
      ctx2d.fillStyle = g; ctx2d.fillRect(0, 0, W, H);
    }
    if (P.bars) { const b = H * 0.1; ctx2d.fillStyle = '#000'; ctx2d.fillRect(0, 0, W, b); ctx2d.fillRect(0, H - b, W, b); }
    ctx2d.restore();
    // Textes : titre, légendes, sous-titres
    if (t < titleOffset()) drawText(P.title, { pos: 'centre', size: P.textStyle.size * 1.5, alpha: Math.min(1, t / 0.4, (titleOffset() - t) / 0.4) });
    else {
      const sub = subtitles.find(s => t >= s.start && t < s.end);
      if (sub) drawText(sub.text);
      else {
        const at = itemAt(t);
        const it = at && items[at.i];
        if (it?.caption) drawText(it.caption, { alpha: Math.min(1, at.local / 0.3, (it.dur - at.local) / 0.3) });
      }
    }
  }

  // ---------- Lecture / export (même moteur) ----------
  function syncVideos(t, forExport) {
    const at = t >= titleOffset() ? itemAt(t) : null;
    items.forEach((it, i) => {
      if (it.type !== 'video') return;
      const active = at && (i === at.i || (i === at.i - 1 && at.local < P.td));
      if (active && i === at.i) {
        const want = it.trimIn + at.local;
        if (Math.abs(it.el.currentTime - want) > (forExport ? 0.25 : 0.3)) it.el.currentTime = want;
        if (it.el.paused) it.el.play().catch(() => {});
      } else if (!it.el.paused) it.el.pause();
    });
  }
  function startPlayback({ exportMode = false } = {}) {
    stopPlayback();
    const ac = audioCtx();
    const total = totalDuration();
    let src = null, dest = null, gain = null;
    if (music) {
      src = ac.createBufferSource(); src.buffer = music.buffer;
      gain = ac.createGain(); gain.gain.value = 10 ** (music.gainDb / 20);
      const endFade = ac.currentTime + 0.15 + total;
      gain.gain.setValueAtTime(gain.gain.value, Math.max(ac.currentTime, endFade - 1.5));
      gain.gain.linearRampToValueAtTime(0.0001, endFade);
      src.connect(gain);
      if (exportMode) { dest = ac.createMediaStreamDestination(); gain.connect(dest); }
      gain.connect(ac.destination);
    }
    const t0 = ac.currentTime + 0.15;
    if (src) src.start(t0, music.offset);
    const st = { src, dest, t0, raf: 0, total, exportMode };
    const loop = () => {
      const t = ac.currentTime - st.t0;
      if (t >= 0) {
        syncVideos(t, exportMode);
        drawFrame(Math.min(t, total - 0.001));
        timeLbl.textContent = `${fmtTime(t)} / ${fmtTime(total)}`;
        if (exportMode) exportInfo.textContent = `Export en cours : ${Math.min(100, Math.round((t / total) * 100))} % (le rendu se fait en temps réel, gardez cet onglet ouvert)`;
      }
      if (t >= total) { st.onEnd?.(); stopPlayback(); return; }
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
    playing = st;
    return st;
  }
  function stopPlayback() {
    if (!playing) return;
    cancelAnimationFrame(playing.raf);
    try { playing.src?.stop(); } catch {}
    items.forEach(it => it.type === 'video' && it.el.pause());
    const p = playing; playing = null;
    p.onStop?.();
  }

  async function exportVideo() {
    if (!items.length) return toast('Ajoutez des photos ou des vidéos.');
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mime = types.find(t => window.MediaRecorder?.isTypeSupported?.(t));
    if (!mime || !canvas.captureStream) return toast('Ce navigateur ne sait pas exporter de vidéo. Utilisez Chrome, Edge ou Safari récent.', 'bad');
    const stream = canvas.captureStream(30);
    const st = startPlayback({ exportMode: true });
    if (st.dest) st.dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(500);
    exportBtn.disabled = true;
    st.onStop = () => rec.state !== 'inactive' && rec.stop();
    await new Promise((r) => { rec.onstop = r; });
    exportBtn.disabled = false;
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const name = `${(P.title || 'clip').replace(/[^\w\-À-ÿ ]+/g, '').trim().replace(/\s+/g, '-') || 'clip'}.${ext}`;
    exportInfo.innerHTML = '';
    const url = URL.createObjectURL(blob);
    exportInfo.append(h('div.stack', h('div.ok-t', `✓ Clip prêt : ${name} (${(blob.size / 1048576).toFixed(1)} Mo)`), h('video', { src: url, controls: true, playsInline: true, style: { maxHeight: '50dvh' } }),
      h('div.row', h('button.btn.small', { onclick: () => downloadBlob(blob, name) }, '⬇️ Télécharger'),
        h('button.btn.small', { onclick: () => uploadFile(blob, { name, source: 'clip' }).then(() => toast('Clip enregistré dans Fichiers', 'ok')).catch(toastErr) }, '💾 Enregistrer dans Fichiers')),
      ext === 'webm' ? h('p.tiny.muted', 'Format WebM : lisible partout sur ordinateur et Android. Pour Instagram/TikTok sur iPhone, ouvrez le Studio dans Safari ou Chrome récent qui exportent en MP4.') : null));
  }

  // ---------- IA ----------
  async function aiScenario(btn) {
    if (!items.length) return toast('Ajoutez d’abord vos photos/vidéos.');
    const idea = ideaInput.value.trim() || 'un clip dynamique et émouvant';
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> L’IA monte le clip…';
    try {
      // Description visuelle rapide des photos (modèle vision) pour un montage cohérent
      const thumbs = [];
      for (const it of items.slice(0, 8)) {
        const c = document.createElement('canvas'); c.width = 256; c.height = 256;
        const g = c.getContext('2d');
        const sw = it.type === 'image' ? it.el.naturalWidth : it.el.videoWidth, sh = it.type === 'image' ? it.el.naturalHeight : it.el.videoHeight;
        if (sw) { const r = Math.max(256 / sw, 256 / sh); g.drawImage(it.el, (256 - sw * r) / 2, (256 - sh * r) / 2, sw * r, sh * r); }
        thumbs.push(c.toDataURL('image/jpeg', 0.7));
      }
      let descriptions = '';
      try {
        const v = await api('/api/complete', { method: 'POST', body: { src: 'clips', messages: [{ role: 'user', content: [{ type: 'text', text: `Décris en une courte phrase chacune de ces ${thumbs.length} images, numérotées 1 à ${thumbs.length}.` }, ...thumbs.map(u => ({ type: 'image_url', image_url: { url: u } }))] }] } });
        descriptions = v.content;
      } catch { descriptions = items.map((it, i) => `${i + 1}. ${it.name}`).join('\n'); }
      const beatInfo = music?.bpm ? `La musique est à ${music.bpm} BPM (un temps = ${(60 / music.bpm).toFixed(2)} s), durée ${music.buffer.duration.toFixed(0)} s.` : 'Pas de musique calée.';
      const r = await api('/api/complete', { method: 'POST', body: { src: 'clips', projectId: state.projectId, temperature: 0.7,
        system: 'Tu es monteur de clips. Tu réponds UNIQUEMENT avec du JSON valide.',
        prompt: `Idée du clip : ${idea}\n${beatInfo}\nMédias disponibles (index à partir de 0) :\n${items.map((it, i) => `${i}: ${it.type}`).join(', ')}\nDescriptions :\n${descriptions}\n\nPropose le montage. JSON attendu :\n{"titre":"titre court affiché au début (ou vide)","plans":[{"media":index,"duree_secondes":nombre,"transition":"fondu|glisse|zoom|flash|noir|aucune","effet":"zoomin|zoomout|panG|panD|fixe","texte":"légende courte en français ou vide"}],"look":"naturel|cinema|nb|vintage|neon|chaud"}\nUtilise chaque média au moins une fois, des durées multiples du temps musical si possible, et des légendes percutantes mais rares.` } });
      const j = parseJsonLoose(r.content);
      if (!j?.plans?.length) throw new Error('Le scénario proposé n’était pas exploitable. Réessayez.');
      const src = [...items];
      const next = [];
      for (const p of j.plans.slice(0, 60)) {
        const base = src[Number(p.media)];
        if (!base) continue;
        const copy = next.includes(base) ? { ...base } : base;
        copy.dur = Math.max(0.5, Math.min(base.type === 'video' ? (base.maxDur || 10) : 15, Number(p.duree_secondes) || base.dur));
        copy.transition = TRANSITIONS.some(t => t[0] === p.transition) ? p.transition : 'fondu';
        copy.effect = EFFECTS.some(t => t[0] === p.effet) ? p.effet : copy.effect;
        copy.caption = String(p.texte || '').slice(0, 120);
        next.push(copy);
      }
      if (next.length) { items.splice(0, items.length, ...next); }
      if (j.titre !== undefined) { P.title = String(j.titre).slice(0, 80); titleInput.value = P.title; }
      if (LOOKS[j.look]) { P.look = j.look; lookSel.value = j.look; }
      drawTimeline(); drawFrame(0);
      toast(`Montage proposé via ${r.routedVia}`, 'ok');
    } catch (e) { toastErr(e); }
    btn.disabled = false; btn.textContent = '🤖 Monter avec l’IA';
  }

  async function syncToBeat(beatsPer) {
    if (!music) return toast('Ajoutez d’abord une musique.');
    if (!music.beats) {
      beatInfo.innerHTML = '<span class="spinner"></span> Analyse du rythme…';
      const r = await detectBeats(music.buffer);
      music.beats = r.beats; music.bpm = r.bpm;
      // Démarrer la musique sur un temps fort
      music.offset = r.beats.find(b => b >= music.offset) ?? 0;
    }
    const beat = 60 / music.bpm;
    for (const it of items) it.dur = Math.max(beat, beat * beatsPer - (it.type === 'video' ? 0 : 0));
    P.td = Math.min(0.5, beat / 2);
    beatInfo.textContent = `≈ ${music.bpm} BPM · changement de plan toutes les ${beatsPer} temps (${(beat * beatsPer).toFixed(2)} s). Si le tempo est faux, corrigez-le ci-dessous.`;
    bpmInput.value = music.bpm;
    drawTimeline();
  }
  function fitToMusic() {
    if (!music || !items.length) return;
    const avail = music.buffer.duration - music.offset - titleOffset();
    const per = avail / items.length;
    items.forEach(it => { it.dur = Math.max(0.5, Math.min(it.type === 'video' ? it.maxDur - it.trimIn : 30, per)); });
    drawTimeline();
  }
  async function subtitlesFromAudio(btn) {
    if (!music) return toast('Ajoutez une musique ou une voix.');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Transcription…';
    try {
      const part = sliceBuffer(music.buffer, music.offset, Math.min(music.buffer.duration, music.offset + totalDuration(), music.offset + 600));
      const wav = encodeWav(part);
      const r = await api('/api/transcribe?lang=fr&format=verbose_json', { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav' } });
      if (r.segments?.length) subtitles = r.segments.map(s => ({ start: s.start, end: s.end, text: String(s.text).trim() })).filter(s => s.text);
      else {
        const lines = (r.text || '').split(/(?<=[.!?])\s+/).filter(Boolean);
        const d = totalDuration() / Math.max(1, lines.length);
        subtitles = lines.map((t, i) => ({ start: i * d, end: (i + 1) * d, text: t }));
        toast('Le fournisseur n’a pas donné les minutages : sous-titres répartis uniformément.');
      }
      subsArea.value = subtitles.map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)} ${s.text}`).join('\n');
    } catch (e) { toastErr(e); }
    btn.disabled = false; btn.textContent = '📝 Sous-titres depuis l’audio';
  }
  function parseSubs() {
    const lines = subsArea.value.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { subtitles = []; return; }
    const timed = lines.map(l => /^(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s+(.*)$/.exec(l));
    if (timed.every(Boolean)) subtitles = timed.map(m => ({ start: parseFloat(m[1].replace(',', '.')), end: parseFloat(m[2].replace(',', '.')), text: m[3] }));
    else {
      const d = (totalDuration() - titleOffset()) / lines.length;
      subtitles = lines.map((t, i) => ({ start: titleOffset() + i * d, end: titleOffset() + (i + 1) * d, text: t.replace(/^\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s+/, '') }));
    }
  }
  async function aiVideoShot(btn) {
    const prompt = aiVidPrompt.value.trim();
    if (!prompt) return toast('Décrivez le plan vidéo à générer.');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Génération (1 à 5 min)…';
    try {
      let imageFileId = null;
      if (aiVidFromPhoto.checked) {
        const [f] = await pickFromLibrary({ kinds: ['image'], multiple: false, title: 'Photo de départ (stockée dans Fichiers)' });
        imageFileId = f?.id || null;
      }
      const r = await api('/api/videos', { method: 'POST', body: { prompt, duration: 5, aspect_ratio: P.format === '16:9' ? '16:9' : '9:16', imageFileId, projectId: state.projectId } });
      await addMedia(await fetchFileBlob(r.file.id), r.file.name, r.file.id);
      toast(`Plan vidéo IA ajouté (${r.provider || '?'})`, 'ok');
    } catch (e) { toastErr(e); }
    btn.disabled = false; btn.textContent = '🎥 Générer le plan';
  }


  // ---------- Clip automatique : musique → paroles exactes → scénario plan par plan ----------
  const AUTO_STYLES = {
    realiste: ['🎬 Réaliste (vraie vidéo)', 'photorealistic, cinematic 35mm film look, natural light, shallow depth of field, like real filmed footage'],
    anime: ['🌸 Anime', 'Japanese anime style, vivid colors, clean line art, dynamic shading'],
    cartoon3d: ['🧸 Dessin animé 3D', '3D animated film style, expressive characters, soft global illumination, Pixar-like render'],
    bd: ['💥 BD / Comics', 'comic book style, bold ink outlines, flat colors, halftone shading'],
  };
  let autoMusicLbl = null; let autoPlan = null; let autoDuration = 0;
  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const fmtT = (x) => { x = Math.max(0, +x || 0); const m = Math.floor(x / 60); return `${m}:${(x - m * 60).toFixed(1).padStart(4, '0')}`; };
  const unT = (x) => { const [m, sec] = String(x).split(':'); return sec === undefined ? +m : (+m) * 60 + (+sec); };
  function parseTimedLyrics(txt) {
    return txt.split('\n').map(l => /^\s*\[\s*([\d:.]+)\s*(?:→|->|-)\s*([\d:.]+)\s*\]\s*(.*)$/.exec(l)).filter(Boolean)
      .map(m => ({ start: unT(m[1]), end: unT(m[2]), text: m[3].trim() })).filter(x => x.text);
  }

  async function autoListen(btn) {
    if (!music?.blob) return toast('Choisis d’abord ta musique (bouton 🎵 juste au-dessus).');
    if (music.blob.size > 24 * 1024 * 1024) return toast('Musique trop lourde pour la transcription (24 Mo max). Exporte-la en MP3.', 'bad');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> J’écoute ta musique et je note les paroles…';
    try {
      const hint = autoLyrics.value.split(/\s+/).filter(Boolean).slice(0, 120).join(' ');
      const type = music.blob.type || 'audio/mpeg';
      const r = await api(`/api/transcribe?lang=fr&format=verbose_json&exact=1${hint ? '&prompt=' + encodeURIComponent(hint) : ''}`,
        { method: 'POST', body: music.blob, headers: { 'Content-Type': type } });
      autoDuration = music.buffer.duration;
      const segs = (r.segments?.length ? r.segments : [{ start: 0, end: autoDuration, text: r.text || '' }])
        .map(x => ({ start: +x.start, end: +x.end, text: String(x.text || '').trim() })).filter(x => x.text);
      if (!segs.length) throw new Error('Aucune parole entendue. Si c’est une instru, décris l’ambiance dans « Idée » plus bas.');
      autoTimed.value = segs.map(x => `[${fmtT(x.start)} → ${fmtT(x.end)}] ${x.text}`).join('\n');
      autoCheck.hidden = false;
      // Les paroles deviennent aussi les sous-titres du montage
      subsArea.value = segs.map(x => `${x.start.toFixed(1)}-${x.end.toFixed(1)} ${x.text}`).join('\n'); parseSubs();
      await autoWrite(btn);
    } catch (e) { toastErr(e); }
    btn.disabled = false; btn.textContent = '🎬 Écouter ma musique et écrire le clip';
  }

  async function autoWrite(btn) {
    const segs = parseTimedLyrics(autoTimed.value);
    if (!segs.length) return toast('Je ne trouve aucune ligne « [0:00.0 → 0:04.0] paroles ».');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> J’écris le scénario du clip, plan par plan…';
    try {
      const [, styleEn] = AUTO_STYLES[autoStyle.value];
      const written = autoLyrics.value.trim();
      const look = autoLook.value.trim();
      const total = autoDuration || segs[segs.length - 1].end;
      const r = await api('/api/complete', { method: 'POST', body: { src: 'clips', projectId: state.projectId, temperature: 0.6, json: true,
        system: 'Tu es réalisateur de clips de rap. Tu découpes une chanson en plans calés sur les paroles et le rythme. Tu réponds UNIQUEMENT avec un objet JSON valide.',
        prompt: `Artiste : ${autoArtist.value.trim() || 'le rappeur'}.
Apparence de l'artiste (même visage dans tout le clip) : ${look || 'non précisée : invente une description précise et garde-la identique partout'}.
Style visuel imposé (en anglais, à répéter dans chaque prompt) : ${styleEn}.
Idées de l'artiste : ${ideaInput.value.trim() || 'libre, colle au sens des paroles'}.
Format : ${P.format}. Durée du son : ${Math.round(total)} s.
Paroles horodatées (vérifiées) :
${segs.map(x => `[${x.start.toFixed(1)}s → ${x.end.toFixed(1)}s] ${x.text}`).join('\n')}
${written ? `\nPAROLES OFFICIELLES écrites par l'artiste (elles font foi mot pour mot ; les horodatages ci-dessus servent seulement au minutage) :\n${written}\n` : ''}
Règles :
- un plan toutes les 4 à 8 secondes, de 0 à ${Math.round(total)} s, sans trou ;
- "paroles" = les mots EXACTS rappés pendant le plan, recopiés sans rien changer ni corriger${written ? ' (pris dans les PAROLES OFFICIELLES)' : ''} ; vide pendant l'instru ;
- chaque plan montre ce que disent les paroles à ce moment (« moto » → on le voit sur une moto ; « bateau » → sur un bateau) ;
- alterne "performance" (il rappe face caméra) et "histoire" (scène, décor) ;
- "image_prompt" et "video_prompt" en ANGLAIS, 30 à 60 mots, qui reprennent toujours la description physique de l'artiste et le style imposé ;
- "scene" en français, une phrase courte.
JSON : {"titre":"...","personnage":"description physique en anglais","plans":[{"debut":0,"fin":6,"paroles":"...","type":"performance|histoire","scene":"...","camera":"plan + mouvement","image_prompt":"...","video_prompt":"..."}]}` } });
      const j = parseJsonLoose(r.content);
      if (!j?.plans?.length) throw new Error('Le scénario n’était pas lisible. Réessaie (une autre IA sera essayée).');
      autoPlan = j;
      if (j.personnage && !look) { autoLook.value = j.personnage; lsSet('studio_auto_look', j.personnage); }
      if (j.titre && !P.title) { P.title = String(j.titre).slice(0, 80); titleInput.value = P.title; }
      renderAutoPlan();
      toast(`Scénario écrit via ${r.routedVia} : ${j.plans.length} plans`, 'ok');
    } catch (e) { toastErr(e); }
    btn.disabled = false; btn.textContent = '🎬 Écouter ma musique et écrire le clip';
  }

  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => { const o = btn.textContent; btn.textContent = '✅ Copié'; setTimeout(() => { btn.textContent = o; }, 1500); }, () => toast('Copie impossible'));
  }
  async function shotImage(p, btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const size = P.format === '16:9' ? '1280x720' : P.format === '1:1' ? '1024x1024' : '720x1280';
      const r = await api('/api/images', { method: 'POST', body: { prompt: p.image_prompt, size, projectId: state.projectId } });
      const f = r.files?.[0]; if (!f) throw new Error('Aucune image reçue.');
      await addMedia(await fetchFileBlob(f.id), f.name, f.id);
      items[items.length - 1].dur = Math.max(1, (+p.fin || 0) - (+p.debut || 0)) || 4;
      items[items.length - 1].caption = '';
      drawTimeline();
      p.fileId = f.id; btn.textContent = '✅ Image ajoutée';
    } catch (e) { toastErr(e); btn.disabled = false; btn.textContent = '🖼️ Image'; }
  }
  async function shotVideo(p, btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 1 à 5 min';
    try {
      const r = await api('/api/videos', { method: 'POST', body: { prompt: p.video_prompt, duration: Math.min(10, Math.max(2, Math.round((+p.fin || 0) - (+p.debut || 0)) || 5)),
        aspect_ratio: P.format === '16:9' ? '16:9' : '9:16', imageFileId: p.fileId || null, projectId: state.projectId } });
      await addMedia(await fetchFileBlob(r.file.id), r.file.name, r.file.id);
      btn.textContent = '✅ Vidéo ajoutée';
    } catch (e) { toastErr(e); btn.disabled = false; btn.textContent = '🎥 Vidéo'; }
  }
  async function allImages(btn) {
    if (!autoPlan) return;
    btn.disabled = true;
    const btns = [...autoShots.querySelectorAll('button[data-img]')];
    for (const [i, b] of btns.entries()) {
      if (b.disabled) continue;
      btn.innerHTML = `<span class="spinner"></span> Image ${i + 1}/${btns.length}…`;
      await shotImage(autoPlan.plans[+b.dataset.img], b);
    }
    btn.disabled = false; btn.textContent = '🖼️ Créer toutes les images';
  }
  function renderAutoPlan() {
    const j = autoPlan; autoShots.innerHTML = '';
    autoResult.hidden = false;
    autoShots.append(...j.plans.map((p, i) => h('div.card.stack', { style: { padding: '10px' } },
      h('div.row', h('b', `Plan ${i + 1}`), h('span.small.muted', `${fmtTime(+p.debut)} → ${fmtTime(+p.fin)}`), h('span.grow'),
        h('span.tiny', p.type === 'performance' ? '🎤 il rappe' : '🎞️ histoire')),
      p.paroles ? h('div.small', { style: { fontStyle: 'italic' } }, `« ${p.paroles} »`) : null,
      h('div.small', p.scene || ''),
      h('div.tiny.muted', `📷 ${p.camera || ''}`),
      h('div.row',
        h('button.btn.small.ghost', { onclick: (e) => copyText(p.image_prompt || '', e.target) }, '📋 Prompt image'),
        h('button.btn.small.ghost', { onclick: (e) => copyText(p.video_prompt || '', e.target) }, '📋 Prompt vidéo'),
        h('button.btn.small', { 'data-img': i, onclick: (e) => shotImage(p, e.target) }, '🖼️ Image'),
        h('button.btn.small', { onclick: (e) => shotVideo(p, e.target) }, '🎥 Vidéo')))));
  }
  function copyAllPlan(btn) {
    if (!autoPlan) return;
    copyText(`${autoPlan.titre || 'Clip'}\nPersonnage : ${autoPlan.personnage || autoLook.value}\n\n` + autoPlan.plans.map((p, i) =>
      `PLAN ${i + 1} (${fmtTime(+p.debut)}-${fmtTime(+p.fin)}) ${p.type}\nParoles : ${p.paroles || ''}\nScène : ${p.scene || ''}\nCaméra : ${p.camera || ''}\nIMAGE : ${p.image_prompt}\nVIDÉO : ${p.video_prompt}`).join('\n\n'), btn);
  }

  const autoStyle = h('select', Object.entries(AUTO_STYLES).map(([k, [label]]) => h('option', { value: k }, label)));
  autoStyle.value = lsGet('studio_auto_style') || 'realiste';
  autoStyle.onchange = () => lsSet('studio_auto_style', autoStyle.value);
  const autoArtist = h('input', { placeholder: 'Nom d’artiste', value: lsGet('studio_auto_artist') || 'Chok Chokan', oninput: (e) => lsSet('studio_auto_artist', e.target.value) });
  const autoLook = h('input', { placeholder: 'Ton apparence : « homme 30 ans, barbe courte, cheveux noirs, survêt noir »', value: lsGet('studio_auto_look'), oninput: (e) => lsSet('studio_auto_look', e.target.value) });
  const autoLyrics = h('textarea', { rows: 4, placeholder: 'Colle tes paroles si tu les as : elles font foi mot pour mot et guident l’écoute.' });
  const autoTimed = h('textarea', { rows: 8, style: { fontFamily: 'ui-monospace, monospace', fontSize: '13px' } });
  const autoCheck = h('div.stack',
    h('h4', '📝 Paroles entendues'),
    h('p.tiny.muted', 'Un mot mal compris ? Corrige-le ici (sans toucher aux temps entre crochets), puis appuie sur « Refaire ».'),
    autoTimed,
    h('button.btn.small', { onclick: (e) => autoWrite(e.target) }, '🔁 Refaire le scénario avec mes corrections'));
  autoCheck.hidden = true;
  const autoShots = h('div.stack');
  const autoResult = h('div.stack',
    h('div.row', h('h4', '🎬 Ton clip, plan par plan'), h('span.grow'),
      h('button.btn.small', { onclick: (e) => allImages(e.target) }, '🖼️ Créer toutes les images'),
      h('button.btn.small.ghost', { onclick: (e) => copyAllPlan(e.target) }, '📋 Tout copier')),
    h('p.tiny.muted', 'Les images créées s’ajoutent à la timeline avec la bonne durée ; le bouton 🎥 anime le plan (à partir de son image si tu l’as créée avant). Ensuite : Aperçu puis Exporter.'),
    autoShots);
  autoResult.hidden = true;
  autoMusicLbl = h('span.small', 'Aucune musique');
  const autoCard = () => h('div.card.stack',
    h('h3', '⚡ Clip automatique : mets ta musique, l’IA fait le reste'),
    h('div.row',
      h('button.btn.small', { onclick: async () => { const [f] = await pickLocalFiles('audio/*', false); if (f) setMusic(f, f.name); } }, '🎵 Ma musique'),
      h('button.btn.small', { onclick: async () => { const [f] = await pickFromLibrary({ kinds: ['audio'], multiple: false }); if (f) setMusic(await fetchFileBlob(f.id), f.name); } }, '📚 Mes fichiers'),
      autoMusicLbl, h('span.grow'), autoStyle),
    h('button.btn.primary', { onclick: (e) => autoListen(e.target) }, '🎬 Écouter ma musique et écrire le clip'),
    h('details', h('summary.small', 'Options (remplies une fois, gardées pour la suite)'),
      h('div.stack', autoArtist, autoLook, autoLyrics)),
    autoCheck, autoResult);

  // ---------- Interface ----------
  function drawTimeline() {
    tl.innerHTML = '';
    if (!items.length) tl.append(h('div.drop', { style: { width: '100%' } }, 'Ajoutez des photos et des vidéos pour commencer.'));
    items.forEach((it, i) => {
      const thumb = it.type === 'image' ? h('img', { src: it.src, alt: '' }) : h('video', { src: it.src, muted: true, playsInline: true });
      const durIn = h('input', { type: 'number', min: 0.5, max: 60, step: 0.1, value: it.dur.toFixed(1), title: 'Durée (s)', onchange: (e) => { it.dur = Math.max(0.5, Number(e.target.value) || 3); totLbl.textContent = fmtTime(totalDuration()); } });
      const tr = h('select', { title: 'Transition d’entrée', onchange: (e) => (it.transition = e.target.value) }, TRANSITIONS.map(([v, l]) => h('option', { value: v, selected: it.transition === v }, l)));
      const fx = h('select', { title: 'Mouvement', onchange: (e) => (it.effect = e.target.value) }, EFFECTS.map(([v, l]) => h('option', { value: v, selected: it.effect === v }, l)));
      const cap = h('input', { placeholder: 'Texte à l’écran', value: it.caption, oninput: (e) => (it.caption = e.target.value) });
      const trim = it.type === 'video' ? h('input', { type: 'number', min: 0, max: it.maxDur, step: 0.1, value: it.trimIn, title: 'Début dans la vidéo (s)', onchange: (e) => (it.trimIn = Math.max(0, Number(e.target.value) || 0)) }) : null;
      tl.append(h('div.clip-item', thumb, h('div.ctl',
        h('div.row', h('b', `#${i + 1}`), h('span.grow'),
          h('button.btn.ghost.small', { title: 'Avancer', onclick: () => { if (i) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; drawTimeline(); } } }, '◀'),
          h('button.btn.ghost.small', { title: 'Reculer', onclick: () => { if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; drawTimeline(); } } }, '▶'),
          h('button.btn.ghost.small', { title: 'Retirer', onclick: () => { items.splice(i, 1); drawTimeline(); drawFrame(0); } }, '✕')),
        h('div.row', h('span', '⏱'), durIn, trim ? h('span', '✂') : null, trim), tr, fx, cap)));
    });
    totLbl.textContent = fmtTime(totalDuration());
  }

  const totLbl = h('b', '0:00');
  const musicLbl = h('span.small', 'Aucune musique');
  const beatInfo = h('span.small.muted');
  const bpmInput = h('input', { type: 'number', min: 50, max: 220, step: 0.1, placeholder: 'auto', style: { width: '100px' }, onchange: (e) => {
    if (!music) return;
    const bpm = Number(e.target.value);
    if (!(bpm >= 50 && bpm <= 220)) return;
    const first = music.beats?.[0] ?? music.offset;
    music.bpm = bpm;
    music.beats = [];
    for (let t = first; t < music.buffer.duration; t += 60 / bpm) music.beats.push(t);
    beatInfo.textContent = `${bpm} BPM réglés à la main : relancez « Caler » pour appliquer.`;
  } });
  const ideaInput = h('input', { placeholder: 'Idée / ambiance du clip : « souvenirs d’été, nostalgique puis joyeux »' });
  const titleInput = h('input', { placeholder: 'Titre affiché au début (optionnel)', oninput: (e) => { P.title = e.target.value; totLbl.textContent = fmtTime(totalDuration()); } });
  const lookSel = h('select', { onchange: (e) => { P.look = e.target.value; drawFrame(0); } }, Object.keys(LOOKS).map(k => h('option', { value: k }, LOOK_LABELS[k])));
  lookSel.value = P.look;
  const fmtSel = h('select', { onchange: (e) => { P.format = e.target.value; setCanvasSize(); drawFrame(0); } }, Object.keys(FORMATS).map(k => h('option', { value: k }, { '16:9': '16:9 YouTube', '9:16': '9:16 TikTok / Reels / Shorts', '1:1': '1:1 carré', '4:5': '4:5 Instagram' }[k])));
  fmtSel.value = P.format;
  const subsArea = h('textarea', { rows: 5, placeholder: 'Sous-titres / paroles : une ligne par phrase (réparties automatiquement), ou « 12.5-15 texte » pour un minutage précis.', onchange: () => parseSubs() });
  const aiVidPrompt = h('input', { placeholder: 'Plan vidéo IA : « vue aérienne d’une ville au coucher du soleil, cinématique »' });
  const aiVidFromPhoto = h('input', { type: 'checkbox' });
  const exportBtn = h('button.btn.primary', { onclick: exportVideo }, '🎬 Exporter la vidéo');
  const playBtn = h('button.btn', '▶ Aperçu');
  playBtn.onclick = () => {
    if (playing) { stopPlayback(); return; }
    if (!items.length) return toast('Ajoutez des médias.');
    parseSubs();
    const st = startPlayback();
    playBtn.textContent = '⏹ Stop';
    st.onStop = () => { playBtn.textContent = '▶ Aperçu'; };
  };
  const chk = (key, label) => h('label.chk.small', h('input', { type: 'checkbox', checked: P[key], onchange: (e) => { P[key] = e.target.checked; drawFrame(0); } }), label);
  const ts = P.textStyle;
  const fontSel = h('select', { onchange: (e) => { ts.font = e.target.value; drawFrame(0); } }, ['Impact, sans-serif', 'system-ui, sans-serif', 'Georgia, serif', '"Courier New", monospace'].map(f => h('option', { value: f }, f.split(',')[0].replace(/"/g, ''))));
  const posSel = h('select', { onchange: (e) => { ts.pos = e.target.value; drawFrame(0); } }, ['bas', 'centre', 'haut'].map(p => h('option', { value: p }, `Texte en ${p}`)));

  el.append(autoCard(), h('div.grid.two',
    h('div.stack',
      h('div.card.stack',
        h('h3', '1. Médias'),
        h('div.row',
          h('button.btn.small', { onclick: async () => { for (const f of await pickLocalFiles('image/*,video/*')) await addMedia(f, f.name); } }, '📱 Photos / vidéos'),
          h('button.btn.small', { onclick: async () => { for (const f of await pickFromLibrary({ kinds: ['image', 'video'] })) await addMedia(await fetchFileBlob(f.id), f.name, f.id); } }, '📚 Mes fichiers')),
        tl,
        h('div.row', h('span.small', 'Durée totale : ', totLbl)),
      ),
      h('div.card.stack',
        h('h3', '2. Musique et rythme'),
        h('div.row',
          h('button.btn.small', { onclick: async () => { const [f] = await pickLocalFiles('audio/*', false); if (f) setMusic(f, f.name); } }, '📱 Musique'),
          h('button.btn.small', { onclick: async () => { const [f] = await pickFromLibrary({ kinds: ['audio'], multiple: false }); if (f) setMusic(await fetchFileBlob(f.id), f.name); } }, '📚 Mes fichiers'),
          musicLbl),
        h('div.row',
          h('button.btn.small', { onclick: () => syncToBeat(2).catch(toastErr) }, '🥁 Caler : 2 temps / plan'),
          h('button.btn.small', { onclick: () => syncToBeat(4).catch(toastErr) }, '4 temps'),
          h('button.btn.small', { onclick: () => syncToBeat(8).catch(toastErr) }, '8 temps'),
          h('button.btn.small', { onclick: fitToMusic }, '↔️ Remplir toute la musique')),
        beatInfo,
        h('div.row',
          h('label.f', 'Tempo (BPM)', bpmInput),
          h('label.f.grow', 'Début de la musique (s)', h('input', { type: 'number', min: 0, step: 0.1, value: 0, onchange: (e) => { if (music) music.offset = Math.max(0, Number(e.target.value) || 0); } }))),
      ),
      h('div.card.stack',
        h('h3', '3. IA'),
        ideaInput,
        h('div.row', h('button.btn.primary.small', { onclick: (e) => aiScenario(e.target) }, '🤖 Monter avec l’IA'), h('span.tiny.muted', 'Analyse vos photos, choisit l’ordre, les durées, transitions et légendes.')),
        aiVidPrompt,
        h('div.row', h('label.chk.small', aiVidFromPhoto, 'Animer une de mes photos'), h('button.btn.small', { onclick: (e) => aiVideoShot(e.target) }, '🎥 Générer le plan')),
        h('p.tiny.muted', 'La génération vidéo IA passe par les fournisseurs vidéo gratuits de FreeLLMAPI (Pollinations, Hugging Face…). Elle est lente et parfois indisponible ; tout le reste du montage fonctionne sans elle.'),
      ),
    ),
    h('div.stack',
      h('div.card.stack',
        canvas,
        h('div.row', playBtn, timeLbl, h('span.grow'), exportBtn),
        exportInfo,
      ),
      h('div.card.stack',
        h('h3', '4. Style et textes'),
        h('div.row', h('div.grow', fmtSel), lookSel),
        h('div.row', chk('vignette', 'Vignettage'), chk('bars', 'Bandes cinéma'), chk('pulse', 'Pulsation sur le rythme')),
        titleInput,
        h('div.row', fontSel, posSel, h('input', { type: 'color', value: ts.color, style: { width: '60px' }, oninput: (e) => { ts.color = e.target.value; drawFrame(0); } }),
          h('label.chk.small', h('input', { type: 'checkbox', onchange: (e) => { ts.box = e.target.checked; drawFrame(0); } }), 'Fond derrière le texte')),
        h('label.f', 'Taille du texte', h('input', { type: 'range', min: 24, max: 110, value: ts.size, oninput: (e) => { ts.size = Number(e.target.value); drawFrame(titleOffset() + 0.5); } })),
        subsArea,
        h('div.row', h('button.btn.small', { onclick: (e) => subtitlesFromAudio(e.target) }, '📝 Sous-titres depuis l’audio'), h('button.btn.small.ghost', { onclick: () => { subsArea.value = ''; subtitles = []; } }, 'Effacer')),
      ),
    ),
  ));
  drawTimeline(); drawFrame(0);
  return () => { stopPlayback(); items.forEach(it => URL.revokeObjectURL(it.src)); };
}

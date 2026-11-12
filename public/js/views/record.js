import { api, h, state, toast, toastErr, uploadFile, downloadBlob, pickLocalFiles, pickFromLibrary, fetchFileBlob, fmtTime, startRecorder, audioCtx, transcribe, fileUrl, modal } from '../lib/core.js';
import { PRESETS as VFX, PRESET_CATS as VFX_CATS, KEY_CHOICES, applyChain, keyName, detectChords } from '../lib/voicefx.js';
import { decodeBlob, encodeWav, denoise, antipop, gate, voiceChain, mix, master, MASTER_PRESETS, drawWave, bufferPlayer, sliceBuffer, cloneBuffer, normalize, loudness, makeBuffer, onsetStrength, onsetPeaks, bestAlignShift } from '../lib/audio.js';

const VOICE_PRESETS = {
  rap: { label: 'Voix rap claire et présente', highpass: 90, low: -1, presence: 4, air: 3, deess: 4, comp: 0.75, reverb: 0.08 },
  chant: { label: 'Voix chantée douce', highpass: 80, low: 1, presence: 2.5, air: 3, deess: 3, comp: 0.5, reverb: 0.22 },
  podcast: { label: 'Parole / podcast', highpass: 85, low: 1.5, presence: 3, air: 1, deess: 3, comp: 0.7, reverb: 0 },
  brut: { label: 'Neutre (juste compresser)', highpass: 60, low: 0, presence: 0, air: 0, deess: 0, comp: 0.4, reverb: 0 },
};

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
  let timer;
  recBtn.onclick = async () => {
    if (recorder) {
      clearInterval(timer);
      const r = recorder; recorder = null;
      try { beatSrc?.stop(); } catch {} beatSrc = null;
      recBtn.textContent = '⏺ Enregistrer'; meter.firstChild.style.width = '0';
      const blob = await r.stop();
      // Calage automatique : la prise commence avant l'instru (temps de démarrage) et arrive en retard
      // (latence du casque + du micro). On replace la voix sur l'instru, puis on affine sur le beat.
      const lat = recLatency; recLatency = null;
      await addBlob(blob, `Prise ${tracks.filter(t => t.kind === 'voix').length + 1}`, 'voix', null, lat ? -lat : 0);
      if (lat && tracks.some(t => t.kind === 'instru')) await alignSelected(true);
      return;
    }
    try {
      const constraints = rawMode.checked ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      const beat = tracks.find(t => t.kind === 'instru' && !t.mute);
      recorder = await startRecorder({ constraints, onLevel: (l) => { meter.firstChild.style.width = Math.min(100, l * 300) + '%'; } });
      const recT0 = performance.now();
      recLatency = null;
      if (withBeat.checked && beat) {
        const ctx = audioCtx();
        beatSrc = ctx.createBufferSource(); beatSrc.buffer = beat.buffer;
        const g = ctx.createGain(); g.gain.value = 10 ** (beat.gainDb / 20);
        beatSrc.connect(g).connect(ctx.destination); beatSrc.start();
        const beatT0 = performance.now();
        const outLat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
        const inLat = Number(recorder.stream.getAudioTracks()[0]?.getSettings?.().latency) || 0.02;
        // + décalage de l'instru elle-même sur la timeline
        recLatency = (beatT0 - recT0) / 1000 + outLat + inLat - (beat.offset || 0);
        toast('Instru lancée : utilisez un casque pour qu’elle ne s’entende pas dans la prise.');
      }
      recBtn.textContent = '⏹ Arrêter';
      timer = setInterval(() => { recTime.textContent = fmtTime(recorder?.duration); }, 200);
    } catch (e) { recorder = null; toast('Micro inaccessible : ' + e.message, 'bad'); }
  };

  // ---------- Liste des pistes ----------
  function drawList() {
    list.innerHTML = '';
    if (!tracks.length) list.append(h('p.muted.small', 'Aucune piste. Enregistrez votre voix ou importez un fichier (instru, voix, son).'));
    tracks.forEach((t, i) => {
      const c = h('canvas.wave', { style: { height: '46px', cursor: 'pointer' }, onclick: () => { selected = i; sel = null; player.stop(); drawList(); drawEdit(); } });
      const gl = h('b', t.gainDb);
      list.append(h('div.card' + (i === selected ? '.sel' : ''), { style: { padding: '10px', outline: i === selected ? '2px solid var(--accent)' : '' } },
        h('div.row', h('strong', (t.kind === 'instru' ? '🥁 ' : '🎤 ') + t.name), h('span.small.muted', fmtTime(t.buffer.duration)),
          h('select', { onchange: (e) => { t.kind = e.target.value; drawList(); } }, h('option', { value: 'voix', selected: t.kind === 'voix' }, 'Voix'), h('option', { value: 'instru', selected: t.kind === 'instru' }, 'Instru'), h('option', { value: 'autre', selected: t.kind === 'autre' }, 'Autre')),
          h('label.chk.small', h('input', { type: 'checkbox', checked: t.mute, onchange: (e) => { t.mute = e.target.checked; masterResult = null; } }), 'Muet'),
          h('span.grow'),
          h('button.btn.ghost.small', { onclick: () => { tracks.splice(i, 1); if (selected >= tracks.length) selected = tracks.length - 1; masterResult = null; drawList(); drawEdit(); } }, '✕')),
        c,
        h('div.sliders',
          h('label', h('span', 'Volume (dB) ', gl), h('input', { type: 'range', min: -30, max: 12, step: 0.5, value: t.gainDb, oninput: (e) => { t.gainDb = Number(e.target.value); gl.textContent = t.gainDb; masterResult = null; } })),
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
    try { t.buffer = await fn(t.buffer, t); masterResult = null; drawList(); redrawSelected(); busy.textContent = `✓ ${label.replace('…', '')} terminé`; }
    catch (e) { busy.textContent = ''; toastErr(e); }
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
  const fxInfo = h('span.small.muted');
  const fxAudio = h('audio', { controls: true, style: { width: '100%', display: 'none' } });
  let abUrls = null;
  const fxAB = h('div.row', { style: { display: 'none' } },
    h('button.btn.small', { onclick: () => abPlay('a') }, 'A · sans effet'),
    h('button.btn.small.primary', { onclick: () => abPlay('b') }, 'B · avec effet'));
  function abPlay(which) { if (!abUrls) return; const t = fxAudio.currentTime; fxAudio.src = abUrls[which]; fxAudio.currentTime = t; fxAudio.play().catch(() => {}); }
  // une entrée = { name, steps: [noms de préréglages appliqués l'un après l'autre] }
  const resolve = (val) => {
    if (String(val).startsWith('mine:')) { const m = lsGet('studio_vfx_mine', [])[+val.slice(5)]; return m && { name: m.name, list: m.steps.map(n => VFX.find(p => p.name === n)).filter(Boolean) }; }
    const p = VFX[+val]; return p && { name: p.name, list: [p] };
  };
  const fillFx = () => {
    fxSel.innerHTML = '';
    if (fxCat.value === MINE) lsGet('studio_vfx_mine', []).forEach((m, i) => fxSel.append(h('option', { value: `mine:${i}` }, `${m.name} (${m.steps.length} effets)`)));
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
      const chords = p.chords ? await chordsFor(t, startInTrack, say) : null;
      const r = await applyChain(cur, p.chain, { key, chords, onProgress: say });
      cur = r.buffer; key = key || r.key;
    }
    return { buffer: cur, key };
  }
  async function fxPreview(btn, next = false) {
    const t = tracks[selected]; if (!t) return toast('Sélectionne une piste de voix.');
    if (next && fxSel.options.length) fxSel.selectedIndex = (fxSel.selectedIndex + 1) % fxSel.options.length;
    const item = resolve(fxSel.value); if (!item) return;
    btn.disabled = true; const say = (m) => { fxInfo.innerHTML = `<span class="spinner"></span> ${m}`; }; say('Préparation de l’extrait…');
    try {
      // extrait de 15 s qui commence là où la voix démarre
      const d = t.buffer.getChannelData(0); let st = 0; for (let i = 0; i < d.length; i += 512) if (Math.abs(d[i]) > 0.02) { st = Math.max(0, i / t.buffer.sampleRate - 0.2); break; }
      const part = sliceBuffer(t.buffer, st, Math.min(t.buffer.duration, st + 15));
      const r = await runList(part, item.list, t, st, say);
      if (abUrls) Object.values(abUrls).forEach(u => URL.revokeObjectURL(u));
      abUrls = { a: URL.createObjectURL(encodeWav(part)), b: URL.createObjectURL(encodeWav(r.buffer)) };
      fxAudio.src = abUrls.b; fxAudio.style.display = ''; fxAB.style.display = ''; fxAudio.play().catch(() => {});
      const noInstru = item.list.some(p => p.chords) && !tracks.some(x => x.kind === 'instru' && x !== t);
      fxInfo.textContent = `▶ « ${item.name} »${r.key ? ` · tonalité ${keyName(r.key)}` : ''}${noInstru ? ' · sans instru : harmonies sur la gamme' : ''}`;
    } catch (e) { fxInfo.textContent = ''; toastErr(e); }
    btn.disabled = false;
  }
  const fxApply = () => {
    const item = resolve(fxSel.value); if (!item) return;
    work(`Effet « ${item.name} »…`, async (b, tr) => {
      const r = await runList(b, item.list, tr, 0, (m) => { busy.innerHTML = `<span class="spinner"></span> ${m}`; });
      tr.fxDone = [...(tr.fxDone || []), ...item.list.map(p => p.name)];
      return r.buffer;
    });
  };
  const QUICK_TUNE = [['🎤 Léger', 'Naturel'], ['🎤 Moyen (Drake)', 'Rap mélodique (autotune 15-25 + chaleur)'], ['🤖 Fort (T-Pain)', 'Trap autotune à 0 (effet assumé)']];
  const quickTune = (label, name) => {
    const p = VFX.find(x => x.name === name); if (!p) return toast('Préréglage introuvable : ' + name, 'bad');
    work(`Autotune ${label.replace(/^\S+ /, '')}…`, async (b, tr) => {
      const r = await runList(b, [p], tr, 0, (m) => { busy.innerHTML = `<span class="spinner"></span> ${m}`; });
      tr.fxDone = [...(tr.fxDone || []), p.name];
      return r.buffer;
    });
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

  function drawEdit() {
    editBox.innerHTML = '';
    const t = tracks[selected];
    if (!t) { editBox.append(h('p.muted.small', 'Sélectionnez une piste pour l’éditer.')); return; }
    editBox.append(
      h('div.row', h('h3.grow', `✂️ Éditer : ${t.name}`), playSelBtn, posLbl),
      wave, selLbl,
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
        h('button.btn.small.ghost', { onclick: () => work('Restauration…', async (b, tr) => tr.original) }, '↺ Revenir à l’original')),
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
      h('div.row', h('div.grow', presetSel), h('button.btn.small.primary', { onclick: () => work('Traitement voix…', (b) => voiceChain(b, vc)) }, '✨ Appliquer')),
      vcBox,
      h('h3', '🎤 Autotune chanté en 1 clic'),
      h('div.row', ...QUICK_TUNE.map(([label, name]) => h('button.btn.small', { onclick: () => quickTune(label, name) }, label))),
      h('p.tiny.muted', 'Léger = voix juste et naturelle · Moyen = rap mélodique façon Drake · Fort = effet robot T-Pain. La tonalité est trouvée toute seule (ou choisie ci-dessous). « Revenir à l’original » annule.'),
      h('h3', '🎛️ Effets voix & autotune'),
      h('div.row', h('div.grow', fxCat), h('div.grow', fxKey)),
      h('div.row', h('div.grow', fxSel),
        h('button.btn.small', { onclick: (e) => fxPreview(e.target) }, '▶ Écouter'),
        h('button.btn.small', { onclick: (e) => fxPreview(e.target, true) }, '⏭ Suivant'),
        h('button.btn.small.primary', { onclick: fxApply }, '✅ Appliquer')),
      h('div.row', h('button.btn.small.ghost', { onclick: fxFav }, '⭐ Favori'), h('button.btn.small.ghost', { onclick: fxSave }, '💾 Sauver ma combinaison')),
      fxInfo, fxAudio, fxAB,
      h('p.tiny.muted', 'Écoute chaque effet sur 15 s de ta voix (A/B pour comparer), puis applique-le. Tu peux en enchaîner plusieurs puis « Sauver ma combinaison ». La tonalité est détectée toute seule ; les harmonies suivent les accords de l’instru si elle est dans tes pistes. « Revenir à l’original » annule tout.'),
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
      busy,
    );
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
        t.buffer = t.original;
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
  const exportName = () => (tracks.find(t => t.kind === 'voix')?.name || 'morceau').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');

  el.append(h('div.grid.two',
    h('div.stack',
      h('div.card.stack',
        h('h3', '🎙️ Enregistrer'),
        h('div.row', recBtn, recTime, h('div.grow', meter)),
        h('label.chk.small', withBeat, 'Lancer l’instru pendant l’enregistrement (casque conseillé)'),
        h('label.chk.small', rawMode, 'Mode studio : désactiver les filtres automatiques du téléphone (meilleur son, à nettoyer ensuite)'),
        prompter,
        h('div.row',
          h('button.btn.small', { onclick: async () => { for (const f of await pickLocalFiles('audio/*,video/*')) await addBlob(f, f.name); } }, '📱 Importer'),
          h('button.btn.small', { onclick: async () => { for (const f of await pickFromLibrary({ kinds: ['audio', 'video'] })) await addBlob(await fetchFileBlob(f.id), f.name, null, f.id); } }, '📚 Depuis mes fichiers'),
          h('button.btn.small.ghost', { onclick: () => { localStorage.removeItem('studio.prompter'); prompter.style.display = 'none'; } }, 'Masquer le texte')),
      ),
      h('div.card.stack', h('h3', '🎚️ Pistes'), list),
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
  drawList(); drawEdit();

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
  return () => { player.stop(); try { beatSrc?.stop(); } catch {} recorder?.stop(); clearInterval(timer); };
}

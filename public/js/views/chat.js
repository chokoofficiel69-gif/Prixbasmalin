import {
  api, sse, h, state, md, toast, toastErr, confirmBox, promptBox, modelSelect, fmtDate, uploadFile,
  pickLocalFiles, pickFromLibrary, fetchFileBlob, kindOf, startRecorder, transcribe, speak, stopSpeaking, fmtNum, downloadBlob,
} from '../lib/core.js';

const newId = () => 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|js|mjs|ts|tsx|jsx|py|php|html|htm|css|scss|sql|xml|yml|yaml|ini|env\.example|sh|bat|java|c|cpp|h|cs|go|rs|rb|kt|swift|log|srt|vtt)$/i;

// ---------- Préparation des pièces jointes ----------
async function imageToDataUrl(blob, max = 1280) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
let pdfjsPromise;
async function pdfText(blob) {
  pdfjsPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; resolve(window.pdfjsLib); };
    s.onerror = () => reject(new Error('Lecteur PDF indisponible'));
    document.head.append(s);
  });
  const pdfjs = await pdfjsPromise;
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  let out = '';
  for (let i = 1; i <= Math.min(doc.numPages, 60); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out += `\n--- Page ${i} ---\n` + tc.items.map(it => it.str).join(' ');
  }
  return out;
}

/** Transforme un fichier en pièce jointe exploitable par l'IA. */
async function prepareAttachment(blob, name, fileId) {
  const type = blob.type || '';
  const kind = kindOf(type);
  if (kind === 'image') return { name, kind, fileId, dataUrl: await imageToDataUrl(blob) };
  if (kind === 'text' || TEXT_EXT.test(name)) {
    const t = (await blob.text()).slice(0, 80000);
    return { name, kind: 'text', fileId, inline: `Fichier joint « ${name} » :\n\`\`\`\n${t}\n\`\`\`` };
  }
  if (kind === 'pdf' || /\.pdf$/i.test(name)) {
    const t = (await pdfText(blob)).slice(0, 80000);
    return { name, kind: 'pdf', fileId, inline: `Contenu texte du PDF « ${name} » :\n${t}` };
  }
  if (kind === 'audio' || kind === 'video') {
    toast(`Transcription de « ${name} »…`);
    const text = await transcribe(blob);
    return { name, kind, fileId, inline: `Transcription de « ${name} » :\n${text}` };
  }
  throw new Error(`Type de fichier non lisible par l'IA : ${name}. Il reste disponible dans Fichiers.`);
}

function apiMessages(messages, maxChars = 120000) {
  const out = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.error) continue;
    let text = m.content || '';
    if (m.role === 'user') {
      const inl = (m.atts || []).filter(a => a.inline).map(a => a.inline).join('\n\n');
      if (inl) text += '\n\n' + inl;
      const imgs = (m.atts || []).filter(a => a.dataUrl);
      const isLast = i === messages.length - 1;
      if (imgs.length && isLast) {
        out.unshift({ role: 'user', content: [{ type: 'text', text: text || 'Que vois-tu ?' }, ...imgs.map(a => ({ type: 'image_url', image_url: { url: a.dataUrl } }))] });
        total += text.length;
        continue;
      }
      if (imgs.length) text += '\n' + imgs.map(a => `[image jointe : ${a.name}]`).join(' ');
    }
    total += text.length;
    if (total > maxChars && out.length) break;
    out.unshift({ role: m.role, content: text });
  }
  return out;
}

function stripForSave(messages) {
  return messages.map(m => ({ ...m, atts: (m.atts || []).map(({ dataUrl, ...a }) => ({ ...a, hadImage: !!dataUrl })) }));
}

// ---------- Vue ----------
export async function render(el, { params }) {
  let conv = null;          // conversation courante
  let mode = 'chat';        // chat | compare | voice
  let pending = [];         // pièces jointes en attente
  let controller = null;
  let voiceLoop = null;

  const listEl = h('div.conv-list');
  const main = h('div.chat-main');
  el.append(h('div.chat-layout', listEl, main));

  const modelSel = modelSelect(localStorage.getItem('studio.model') || 'auto');
  modelSel.addEventListener('change', () => localStorage.setItem('studio.model', modelSel.value));

  async function loadList() {
    const list = await api(`/api/conversations?project=${state.projectId}`).catch(() => []);
    listEl.innerHTML = '';
    listEl.append(h('button.btn.primary', { onclick: () => { newConv(); listEl.classList.remove('open'); } }, '＋ Nouvelle conversation'));
    const items = list.filter(c => c.mode !== 'agents');
    if (!items.length) listEl.append(h('p.muted.small', { style: { padding: '8px' } }, 'Aucune conversation dans ce projet.'));
    for (const c of items) {
      listEl.append(h('div.item' + (conv?.id === c.id ? '.active' : ''), { onclick: () => { openConv(c.id); listEl.classList.remove('open'); } },
        h('span', c.mode === 'compare' ? '⚖️' : c.mode === 'voice' ? '🎙️' : '💬'), h('span.t', c.title), h('span.tiny.muted', fmtDate(c.updatedAt).split(' ')[0])));
    }
  }

  function newConv(m = mode) {
    stopAll();
    conv = { id: newId(), projectId: state.projectId, title: 'Nouvelle conversation', mode: m, messages: [], columns: null };
    if (m === 'compare') conv.columns = [{ model: 'auto:smart', messages: [] }, { model: 'auto:fast', messages: [] }];
    mode = m;
    pending = [];
    draw();
    loadList();
  }
  async function openConv(id) {
    stopAll();
    try {
      conv = await api(`/api/conversations/${id}`);
      mode = conv.mode === 'compare' ? 'compare' : conv.mode === 'voice' ? 'voice' : 'chat';
      if (conv.model) modelSel.value = conv.model;
      draw();
      loadList();
    } catch (e) { toastErr(e); newConv('chat'); }
  }
  async function save() {
    if (!conv) return;
    const firstUser = (conv.columns ? conv.columns[0].messages : conv.messages).find(m => m.role === 'user');
    if (conv.title === 'Nouvelle conversation' && firstUser) conv.title = (firstUser.content || firstUser.atts?.[0]?.name || 'Conversation').slice(0, 60);
    const body = { ...conv, model: modelSel.value, messages: stripForSave(conv.messages || []), columns: conv.columns?.map(c => ({ ...c, messages: stripForSave(c.messages) })) };
    try { await api(`/api/conversations/${conv.id}`, { method: 'PUT', body }); loadList(); } catch (e) { toastErr(e); }
  }
  function stopAll() {
    controller?.abort(); controller = null;
    voiceLoop?.stop(); voiceLoop = null;
    stopSpeaking();
  }

  // ----- Rendu d'un message -----
  function msgEl(m, onRemember) {
    const bubble = h('div.bubble.md');
    const think = h('details.think', { open: false }, h('summary', 'Réflexion du modèle'), h('div'));
    const meta = h('div.meta');
    const wrap = h('div.msg.' + m.role, think, bubble, meta);
    const update = () => {
      if (m.role === 'user') {
        bubble.classList.remove('md');
        bubble.textContent = m.content || '';
        for (const a of m.atts || []) {
          if (a.dataUrl) bubble.append(h('img.att', { src: a.dataUrl, alt: a.name }));
          else bubble.append(h('div.tiny.muted', `📎 ${a.name}${a.hadImage ? ' (image)' : ''}`));
        }
      } else {
        bubble.innerHTML = m.error ? `<span class="bad-t">⚠️ ${m.error.replace(/</g, '&lt;')}</span>` : (md(m.content) || '<span class="spinner"></span>');
      }
      think.style.display = m.reasoning ? '' : 'none';
      if (m.reasoning) think.lastChild.textContent = m.reasoning;
      meta.innerHTML = '';
      if (m.role === 'assistant' && !m.streaming && !m.error) {
        meta.append(
          m.redirectedFrom ? h('span.warn-t', `Réponse fournie par ${m.model || m.routedVia} (${m.redirectedFrom} était saturé)`) : h('span', m.routedVia ? `via ${m.routedVia}` : ''),
          m.usage ? h('span', { title: m.estimated ? 'Le fournisseur n’a pas donné la mesure : estimation prudente' : 'Mesure exacte renvoyée par le fournisseur' }, `${fmtNum(m.usage.total)} tokens ${m.estimated ? '(estimés)' : '(réels)'}`) : '',
          m.ms ? h('span', `${(m.ms / 1000).toFixed(1)} s`) : '',
          h('button.btn.ghost', { onclick: () => navigator.clipboard?.writeText(m.content).then(() => toast('Copié')) }, 'Copier'),
          h('button.btn.ghost', { onclick: () => speak(m.content) }, '🔊 Lire'),
          h('button.btn.ghost', { onclick: () => onRemember?.(m) }, '🧠 Mémoriser'),
          h('button.btn.ghost', { onclick: () => saveAsFile(m) }, '💾 Fichier'),
        );
      }
    };
    update();
    return { el: wrap, update };
  }
  async function remember(m) {
    const note = await promptBox('Ajouter à la mémoire du projet (résumé à retenir)', m.content.slice(0, 600), true);
    if (!note) return;
    await api(`/api/projects/${state.projectId}/memory`, { method: 'POST', body: { note } }).then(() => toast('Ajouté à la mémoire du projet', 'ok')).catch(toastErr);
  }
  async function saveAsFile(m) {
    const name = await promptBox('Nom du fichier', `reponse-${new Date().toISOString().slice(0, 10)}.md`);
    if (!name) return;
    await uploadFile(new Blob([m.content], { type: 'text/markdown' }), { name, source: 'chat' }).then(() => toast('Enregistré dans Fichiers', 'ok')).catch(toastErr);
  }

  // ----- Envoi -----
  async function streamInto(messages, model, target, list) {
    const view = msgEl(target, remember);
    list.append(view.el);
    list.scrollTop = list.scrollHeight;
    let raf = 0;
    const paint = () => { raf = 0; view.update(); if (list.scrollHeight - list.scrollTop - list.clientHeight < 160) list.scrollTop = list.scrollHeight; };
    target.streaming = true;
    try {
      await sse('/api/chat', { projectId: state.projectId, model, messages: apiMessages(messages) }, (ev) => {
        if (ev.type === 'meta') { target.routedVia = ev.routedVia; target.redirectedFrom = ev.redirectedFrom || null; target.model = ev.model; }
        if (ev.type === 'delta') {
          if (ev.content) target.content += ev.content;
          if (ev.reasoning) target.reasoning = (target.reasoning || '') + ev.reasoning;
          raf ||= requestAnimationFrame(paint);
        }
        if (ev.type === 'done') Object.assign(target, { routedVia: ev.routedVia, redirectedFrom: ev.redirectedFrom || target.redirectedFrom || null, usage: ev.usage, estimated: ev.estimated, ms: ev.ms, model: ev.model });
        if (ev.type === 'error') target.error = ev.error;
      }, controller?.signal);
    } catch (e) {
      if (e.name === 'AbortError') target.content += target.content ? '\n\n*(interrompu)*' : '*(interrompu)*';
      else target.error = e.message;
    }
    target.streaming = false;
    if (!target.content && !target.error) target.error = 'Réponse vide du modèle.';
    view.update();
    return target;
  }

  // ----- Composer commun -----
  function composer(onSend) {
    const ta = h('textarea', { placeholder: 'Écrivez votre message… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)', rows: 1 });
    const atts = h('div.atts');
    const sendBtn = h('button.btn.primary', { title: 'Envoyer' }, '➤');
    const micBtn = h('button.btn', { title: 'Message vocal (transcription)' }, '🎤');
    const drawAtts = () => {
      atts.innerHTML = '';
      pending.forEach((a, i) => atts.append(h('span.att-chip', a.kind === 'image' ? '🖼️' : '📎', a.name, h('button', { onclick: () => { pending.splice(i, 1); drawAtts(); } }, '✕'))));
    };
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; };
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.innerWidth > 700) { e.preventDefault(); sendBtn.click(); }
    });
    ta.addEventListener('paste', async (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); for (const f of files) await addBlob(f, f.name || 'collage.png'); }
    });
    async function addBlob(blob, name, fileId) {
      try { pending.push(await prepareAttachment(blob, name, fileId)); drawAtts(); } catch (e) { toastErr(e); }
    }
    let rec = null;
    micBtn.onclick = async () => {
      if (rec) {
        const r = rec; rec = null;
        micBtn.classList.remove('rec'); micBtn.textContent = '⏳';
        try {
          const blob = await r.stop();
          const text = await transcribe(blob);
          ta.value = (ta.value ? ta.value + ' ' : '') + text;
          autosize(); ta.focus();
        } catch (e) { toastErr(e); }
        micBtn.textContent = '🎤';
        return;
      }
      try { rec = await startRecorder(); micBtn.classList.add('rec'); micBtn.textContent = '⏹'; } catch (e) { toast('Micro inaccessible : ' + e.message, 'bad'); }
    };
    sendBtn.onclick = async () => {
      if (controller) { controller.abort(); return; }
      const text = ta.value.trim();
      if (!text && !pending.length) return;
      const atts0 = pending; pending = []; drawAtts();
      ta.value = ''; autosize();
      controller = new AbortController();
      sendBtn.textContent = '■'; sendBtn.title = 'Arrêter';
      try { await onSend(text, atts0); } finally {
        controller = null; sendBtn.textContent = '➤'; sendBtn.title = 'Envoyer';
      }
    };
    const box = h('div.composer', atts, h('div.line',
      h('button.btn', { title: 'Joindre depuis l’appareil (images, textes, PDF, audio)', onclick: async () => { for (const f of await pickLocalFiles('image/*,audio/*,video/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.py,.php,.html,.css,.sql')) await addBlob(f, f.name); } }, '📎'),
      h('button.btn', { title: 'Joindre depuis mes fichiers', onclick: async () => { for (const f of await pickFromLibrary()) await addBlob(await fetchFileBlob(f.id), f.name, f.id); } }, '📚'),
      micBtn, ta, sendBtn));
    setTimeout(() => ta.focus(), 50);
    return box;
  }

  // ----- Modes -----
  function drawChat(body) {
    const list = h('div.messages');
    const intro = h('div.empty', h('div', { style: { fontSize: '34px' } }, '💬'), h('p', 'Posez votre question. Vous pouvez joindre des images, des PDF, des textes ou des sons.'), h('p.small', 'Le modèle « Auto » choisit une IA gratuite dont le fournisseur est vérifié avant l’appel. Chaque réponse est décomptée de votre quota mensuel.'));
    if (!conv.messages.length) list.append(intro);
    for (const m of conv.messages) list.append(msgEl(m, remember).el);
    body.append(list, composer(async (text, atts) => {
      intro.remove();
      const um = { role: 'user', content: text, atts, at: new Date().toISOString() };
      conv.messages.push(um);
      list.append(msgEl(um).el);
      const am = { role: 'assistant', content: '', at: new Date().toISOString() };
      conv.messages.push(am);
      await streamInto(conv.messages.slice(0, -1), modelSel.value, am, list);
      await save();
    }));
    requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
  }

  function drawCompare(body) {
    const grid = h('div.compare-grid');
    const cols = [];
    const layout = () => { grid.style.gridTemplateColumns = window.innerWidth > 860 ? `repeat(${conv.columns.length}, 1fr)` : '1fr'; };
    const buildCols = () => {
      grid.innerHTML = ''; cols.length = 0;
      conv.columns.forEach((c, i) => {
        const sel = modelSelect(c.model);
        sel.onchange = () => { c.model = sel.value; };
        const list = h('div.messages');
        for (const m of c.messages) list.append(msgEl(m, remember).el);
        const head = h('header.row', sel, conv.columns.length > 2 ? h('button.btn.ghost.small', { onclick: () => { conv.columns.splice(i, 1); buildCols(); } }, '✕') : null);
        grid.append(h('div.compare-col', head, list));
        cols.push({ c, list });
      });
      layout();
    };
    buildCols();
    const addBtn = h('button.btn.small', { onclick: () => { if (conv.columns.length >= 4) return toast('4 modèles maximum'); conv.columns.push({ model: 'auto', messages: [] }); buildCols(); } }, '＋ Ajouter un modèle');
    body.append(h('div.chat-toolbar', h('span.small.muted', 'La même question est envoyée à chaque modèle en parallèle.'), addBtn), grid, composer(async (text, atts) => {
      await Promise.all(cols.map(async ({ c, list }) => {
        const um = { role: 'user', content: text, atts, at: new Date().toISOString() };
        c.messages.push(um);
        list.append(msgEl(um).el);
        const am = { role: 'assistant', content: '', at: new Date().toISOString() };
        c.messages.push(am);
        await streamInto(c.messages.slice(0, -1), c.model, am, list);
      }));
      await save();
    }));
    window.addEventListener('resize', layout);
  }

  function drawVoice(body) {
    const orb = h('div.voice-orb', 'Touchez pour parler');
    const status = h('p.muted.small', { style: { textAlign: 'center' } }, 'Parlez naturellement : le silence envoie votre phrase. Touchez le cercle pour envoyer tout de suite, ou pour couper la parole à l’IA.');
    const stopBtn = h('button.btn.small', { style: { display: 'none' } }, '⏹ Terminer la conversation');
    const list = h('div.messages', { style: { maxHeight: '45dvh' } });
    for (const m of conv.messages) list.append(msgEl(m, remember).el);
    const browserVoice = h('input', { type: 'checkbox' });
    const opts = h('div.row', { style: { justifyContent: 'center' } }, h('label.chk', browserVoice, 'Voix du navigateur (plus rapide, hors quota)'), stopBtn);
    let active = false, phase = 'idle', sendNow = false;
    const setOrb = (cls, text) => { orb.className = 'voice-orb' + (cls ? ' ' + cls : ''); orb.textContent = text; };

    async function listenOnce() {
      let spoke = false, silentFor = 0, last = performance.now();
      sendNow = false;
      const rec = await startRecorder({
        onLevel: (lvl) => {
          const now = performance.now(); const dt = now - last; last = now;
          orb.style.transform = `scale(${1 + Math.min(lvl * 4, 0.25)})`;
          if (lvl > 0.025) { spoke = true; silentFor = 0; } else if (spoke) silentFor += dt;
        },
      });
      return new Promise((resolve) => {
        const iv = setInterval(async () => {
          if (!active || sendNow || (spoke && silentFor > 1300) || rec.duration > 90) {
            clearInterval(iv);
            const blob = await rec.stop();
            orb.style.transform = '';
            resolve(active && (spoke || sendNow) && rec.duration > 0.4 ? blob : null);
          }
        }, 100);
      });
    }
    const stop = () => { active = false; phase = 'idle'; stopSpeaking(); controller?.abort(); stopBtn.style.display = 'none'; setOrb('', 'Touchez pour parler'); };
    voiceLoop = { stop };
    stopBtn.onclick = stop;
    orb.onclick = async () => {
      if (active) {
        if (phase === 'listen') sendNow = true;          // j'ai fini de parler
        else if (phase === 'speak') stopSpeaking();      // couper la parole à l'IA
        return;
      }
      active = true;
      stopBtn.style.display = '';
      while (active) {
        phase = 'listen';
        setOrb('listen', 'Je vous écoute… (touchez pour envoyer)');
        let blob;
        try { blob = await listenOnce(); } catch (e) { toast('Micro inaccessible : ' + e.message, 'bad'); break; }
        if (!active) break;
        if (!blob) continue;
        phase = 'think';
        setOrb('', 'Transcription…');
        let text = '';
        try { text = (await transcribe(blob)).trim(); } catch (e) { toastErr(e); break; }
        if (!text) continue;
        const um = { role: 'user', content: text, at: new Date().toISOString() };
        conv.messages.push(um); list.append(msgEl(um).el);
        setOrb('', 'Réflexion…');
        const am = { role: 'assistant', content: '', at: new Date().toISOString() };
        conv.messages.push(am);
        controller = new AbortController();
        await streamInto(conv.messages.slice(0, -1), modelSel.value, am, list);
        controller = null;
        save();
        if (!active) break;
        phase = 'speak';
        setOrb('speak', 'Je réponds… (touchez pour couper)');
        await speak(am.content, { preferBrowser: browserVoice.checked });
      }
      stop();
    };
    body.append(h('div', { style: { padding: '12px', overflowY: 'auto', flex: 1 } }, orb, status, opts, list));
  }

  function draw() {
    main.innerHTML = '';
    const tabs = h('div.tabs', { style: { margin: 0 } }, [['chat', '💬 Discussion'], ['compare', '⚖️ Comparer'], ['voice', '🎙️ Vocal']].map(([m, l]) =>
      h('button.btn.small' + (mode === m ? '.active' : ''), { onclick: () => { if (mode === m) return; if (conv.messages.length || conv.columns?.some(c => c.messages.length)) newConv(m); else { conv.mode = m; mode = m; if (m === 'compare') conv.columns = [{ model: 'auto:smart', messages: [] }, { model: 'auto:fast', messages: [] }]; draw(); } } }, l)));
    const toolbar = h('div.chat-toolbar',
      h('button.btn.small', { onclick: () => listEl.classList.toggle('open'), title: 'Conversations', class: 'btn small conv-toggle' }, '☰'),
      tabs,
      mode !== 'compare' ? modelSel : null,
      h('span', { style: { flex: 1 } }),
      h('button.btn.ghost.small', { title: 'Renommer', onclick: async () => { const t = await promptBox('Titre de la conversation', conv.title); if (t) { conv.title = t; save(); } } }, '✏️'),
      h('button.btn.ghost.small', { title: 'Exporter en Markdown', onclick: () => exportMd() }, '⬇️'),
      h('button.btn.ghost.small', { title: 'Supprimer', onclick: async () => {
        if (!(await confirmBox('Supprimer définitivement cette conversation ?', 'Supprimer', true))) return;
        await api(`/api/conversations/${conv.id}`, { method: 'DELETE' }).catch(() => {});
        newConv('chat');
      } }, '🗑️'),
    );
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } });
    main.append(toolbar, body);
    if (mode === 'compare') drawCompare(body); else if (mode === 'voice') drawVoice(body); else drawChat(body);
  }

  function exportMd() {
    const parts = [`# ${conv.title}\n`];
    const dump = (msgs, label = '') => { if (label) parts.push(`\n## ${label}\n`); for (const m of msgs) parts.push(`\n**${m.role === 'user' ? 'Moi' : 'IA' + (m.routedVia ? ` (${m.routedVia})` : '')}** :\n\n${m.content}\n`); };
    if (conv.columns) conv.columns.forEach(c => dump(c.messages, c.model)); else dump(conv.messages);
    downloadBlob(new Blob([parts.join('')], { type: 'text/markdown' }), `${conv.title.replace(/[^\w\- ]+/g, '').slice(0, 40) || 'conversation'}.md`);
  }

  const cid = params.get('c');
  if (cid) await openConv(cid); else newConv('chat');
  return () => stopAll();
}

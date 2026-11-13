// Outils partagés : appels API, flux SSE, création d'éléments, notifications, Markdown.

export const state = {
  projectId: localStorage.getItem('studio.project') || 'perso',
  projects: [],
  models: null,
};

export function currentProject() {
  return state.projects.find(p => p.id === state.projectId) || state.projects[0] || { id: 'perso', name: 'Projet' };
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw, headers = {}, signal } = {}) {
  const opts = { method, headers: { 'X-Studio': '1', ...headers }, signal, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  const res = await fetch(path, opts);
  if (res.status === 401 && path !== '/api/login') {
    window.dispatchEvent(new Event('studio:logout'));
  }
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new ApiError(msg, res.status);
  }
  if (raw) return res;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

/** POST + lecture d'un flux SSE ({type:...}). */
export async function sse(path, body, onEvent, signal) {
  const res = await fetch(path, {
    method: 'POST', signal, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Studio': '1' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try { onEvent(JSON.parse(line.slice(6))); } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
        }
      }
    }
  }
}

/** Petite fabrique d'éléments : h('div.card#id', {onclick}, enfants...) */
export function h(sel, attrs, ...children) {
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  const [tagPart, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tagPart || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(msg, kind = '') {
  const t = h('div.toast' + (kind ? '.' + kind : ''), msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}
export const toastErr = (e) => toast(e?.message || String(e), 'bad');

export function modal(title, content, actions = []) {
  return new Promise((resolve) => {
    const close = (v) => { back.remove(); resolve(v); };
    const back = h('div.modal-back', { onclick: (e) => { if (e.target === back) close(null); } },
      h('div.modal',
        h('div.row', h('h3.grow', title), h('button.btn.ghost.small', { onclick: () => close(null) }, '✕')),
        content,
        actions.length ? h('div.row', { style: { justifyContent: 'flex-end' } }, actions.map(a =>
          h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), { onclick: () => close(typeof a.value === 'function' ? a.value() : (a.value ?? true)) }, a.label))) : null,
      ));
    document.body.append(back);
    back.querySelector('input,textarea,select')?.focus();
  });
}
export async function confirmBox(message, okLabel = 'Confirmer', danger = false) {
  return !!(await modal('Confirmation', h('p', message), [{ label: 'Annuler', value: false }, { label: okLabel, value: true, primary: !danger, danger }]));
}
export async function promptBox(title, value = '', multiline = false) {
  const input = multiline ? h('textarea', { rows: 6 }) : h('input');
  input.value = value;
  const r = await modal(title, input, [{ label: 'Annuler', value: false }, { label: 'Valider', primary: true, value: () => input.value }]);
  return r === false || r === null ? null : r;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtNum = (n) => Number(n || 0).toLocaleString('fr-FR');
export function fmtBytes(b) {
  if (!b) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.min(3, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
export const fmtDate = (s) => s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
export const fmtTime = (sec) => { sec = Math.max(0, sec || 0); return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`; };

/** Markdown minimal et sûr (tout est échappé avant mise en forme). */
export function md(src) {
  const blocks = [];
  let text = String(src || '').replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<pre><button class="btn small copy" data-copy>Copier</button><code data-lang="${esc(lang)}">${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  text = esc(text);
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = text.split('\n');
  const out = [];
  let list = null, para = [], table = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join('<br>'))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; } };
  const flushTable = () => {
    if (table) {
      const rows = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r)).map(r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|'));
      out.push(`<div class="table-wrap"><table>${rows.map((r, i) => `<tr>${r.map(c => `<${i ? 'td' : 'th'}>${inline(c.trim())}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</table></div>`);
      table = null;
    }
  };
  for (const line of lines) {
    const block = line.match(/^\u0000(\d+)\u0000$/);
    if (block) { flushPara(); flushList(); flushTable(); out.push(blocks[+block[1]]); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); flushList(); (table ||= []).push(line); continue; } else flushTable();
    const hd = line.match(/^(#{1,4})\s+(.*)/);
    if (hd) { flushPara(); flushList(); out.push(`<h${hd[1].length + 1}>${inline(hd[2])}</h${hd[1].length + 1}>`); continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      flushPara();
      const t = ul ? 'ul' : 'ol';
      if (!list || list.t !== t) { flushList(); list = { t, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (/^&gt;\s?/.test(line)) { flushPara(); flushList(); out.push(`<blockquote>${inline(line.replace(/^&gt;\s?/, ''))}</blockquote>`); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList(); flushTable();
  return out.join('\n').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard?.writeText(b.parentElement.querySelector('code').textContent).then(() => { b.textContent = 'Copié ✓'; setTimeout(() => (b.textContent = 'Copier'), 1500); });
});

// ---------- Fichiers ----------
export async function uploadFile(file, { projectId = state.projectId, name, source = 'import', note } = {}) {
  const q = new URLSearchParams({ project: projectId, name: name || file.name || 'fichier', source });
  if (note) q.set('note', note);
  return api(`/api/files?${q}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
}
export const fileUrl = (id, download = false) => `/api/files/${id}${download ? '?download' : ''}`;
export async function fetchFileBlob(id) {
  const res = await fetch(fileUrl(id), { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Impossible de lire le fichier');
  return res.blob();
}
export function pickLocalFiles(accept = '*/*', multiple = true, capture) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    if (capture) inp.setAttribute('capture', capture);
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    document.body.append(inp);
    inp.click();
  });
}
export const kindOf = (type = '') => type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio'
  : /text|json|csv|xml|javascript|markdown/.test(type) ? 'text' : type === 'application/pdf' ? 'pdf' : 'autre';
export const kindIcon = (k) => ({ image: '🖼️', video: '🎞️', audio: '🎧', text: '📄', pdf: '📕' }[k] || '📦');

/** Fenêtre de sélection dans la bibliothèque de fichiers du projet. */
export async function pickFromLibrary({ kinds = null, multiple = true, title = 'Choisir dans mes fichiers' } = {}) {
  const { files } = await api(`/api/files?project=${encodeURIComponent(state.projectId)}`);
  const all = await api('/api/files');
  let scope = 'projet';
  const selected = new Set();
  const grid = h('div.file-grid');
  const render = () => {
    grid.innerHTML = '';
    const list = (scope === 'projet' ? files : all.files).filter(f => !kinds || kinds.includes(kindOf(f.type)));
    if (!list.length) grid.append(h('p.empty', 'Aucun fichier compatible. Importez-en depuis votre appareil.'));
    for (const f of list) {
      const k = kindOf(f.type);
      const card = h('div.file-card' + (selected.has(f.id) ? '.sel' : ''), { onclick: () => {
        if (!multiple) selected.clear();
        selected.has(f.id) ? selected.delete(f.id) : selected.add(f.id);
        render();
      } },
      h('div.thumb', k === 'image' ? h('img', { src: fileUrl(f.id), loading: 'lazy', alt: '' }) : kindIcon(k)),
      h('div.info', h('div.name', f.name), h('span.muted', fmtBytes(f.size))));
      grid.append(card);
    }
  };
  const scopeSel = h('select', { onchange: (e) => { scope = e.target.value; render(); } },
    h('option', { value: 'projet' }, 'Ce projet'), h('option', { value: 'tous' }, 'Tous les projets'));
  render();
  const r = await modal(title, h('div.stack', scopeSel, grid), [
    { label: 'Annuler', value: false },
    { label: 'Utiliser', primary: true, value: () => [...selected] },
  ]);
  if (!r) return [];
  return all.files.filter(f => r.includes(f.id));
}

// ---------- Audio commun ----------
let _ctx;
export function audioCtx() {
  _ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

/** Lecture vocale : synthèse serveur (FreeLLMAPI) puis repli sur la voix du navigateur. */
let currentAudio = null;
let speakDone = null;
export function stopSpeaking() {
  try { currentAudio?.pause(); } catch {}
  currentAudio = null;
  try { speechSynthesis.cancel(); } catch {}
  const d = speakDone; speakDone = null; d?.();
}
export async function speak(text, { preferBrowser = false } = {}) {
  stopSpeaking();
  const clean = String(text).replace(/```[\s\S]*?```/g, ' (code) ').replace(/[#*_`>|]/g, '').slice(0, 3000);
  if (!clean.trim()) return;
  if (!preferBrowser) {
    try {
      const res = await api('/api/speech', { method: 'POST', body: { input: clean }, raw: true });
      const blob = await res.blob();
      const a = new Audio(URL.createObjectURL(blob));
      currentAudio = a;
      await new Promise((resolve) => { speakDone = resolve; a.onended = resolve; a.onerror = resolve; a.play().catch(resolve); });
      return;
    } catch (e) { /* repli navigateur */ }
  }
  if (!('speechSynthesis' in window)) return;
  await new Promise((resolve) => {
    speakDone = resolve;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'fr-FR';
    const v = speechSynthesis.getVoices().find(v => v.lang?.startsWith('fr'));
    if (v) u.voice = v;
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

/** Enregistreur micro simple. */
export async function startRecorder({ onLevel, constraints, onChunk } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints || { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) { chunks.push(e.data); onChunk?.(chunks); } };
  let raf, analyser;
  if (onLevel) {
    const ctx = audioCtx();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let s = 0; for (const x of data) s += x * x;
      onLevel(Math.sqrt(s / data.length));
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  rec.start(250);
  const started = Date.now();
  return {
    stream, rec,
    get duration() { return (Date.now() - started) / 1000; },
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach(t => t.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.state !== 'inactive' ? rec.stop() : rec.onstop();
    }),
  };
}

export async function transcribe(blob, lang = 'fr') {
  const r = await api(`/api/transcribe?lang=${lang}`, { method: 'POST', body: blob, headers: { 'Content-Type': (blob.type || 'audio/webm').split(';')[0] } });
  return r.text || '';
}

export function downloadBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/** Extraction du premier objet JSON d'une réponse d'IA. */
export function parseJsonLoose(text) {
  const m = String(text).match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = m ? m[1] : String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1);
  try { return JSON.parse(raw); } catch { return null; }
}

export async function loadModels(force = false) {
  if (state.models && !force) return state.models;
  try { state.models = (await api('/api/models' + (force ? '?refresh=1' : ''))).models; }
  catch (e) { state.models = []; throw e; }
  return state.models;
}

/** <select> de modèles : routage automatique, OVH direct, passerelle vérifiée ; les modèles bloqués sont grisés. */
export function modelSelect(value = 'auto') {
  const sel = h('select', { title: 'Choix du modèle' });
  const fill = (models) => {
    sel.innerHTML = '';
    const routers = models.filter(m => m.router);
    sel.append(h('optgroup', { label: 'Routage automatique (fournisseurs gratuits vérifiés)' },
      (routers.length ? routers : [{ id: 'auto', name: 'Auto' }]).map(m => h('option', { value: m.id }, `✨ ${m.name}`))));
    const ovh = models.filter(m => m.provider === 'ovh');
    if (ovh.length) sel.append(h('optgroup', { label: 'OVH AI Endpoints — gratuit (accès anonyme), 2 requêtes/min par modèle' },
      ovh.map(m => h('option', { value: m.id, disabled: !m.allowed }, `${m.name}${m.status === 'busy' ? ` (occupé ${m.retryIn} s)` : ''}`))));
    const gw = models.filter(m => m.provider === 'freellmapi');
    const gwOk = gw.filter(m => m.allowed), gwNo = gw.filter(m => !m.allowed);
    if (gwOk.length) sel.append(h('optgroup', { label: 'FreeLLMAPI — fournisseurs vérifiés avant l’appel' }, gwOk.map(m => h('option', { value: m.id }, `${m.name} (${(m.platforms || []).join(', ') || '?'})`))));
    if (gwNo.length) sel.append(h('optgroup', { label: 'Bloqués par le mode gratuit' }, gwNo.slice(0, 40).map(m => h('option', { value: m.id, disabled: true, title: m.reason || '' }, `⛔ ${m.name}`))));
    if (![...sel.options].some(o => o.value === value && !o.disabled)) value = 'auto';
    sel.value = value;
  };
  fill([]);
  loadModels().then(fill).catch(() => {});
  return sel;
}

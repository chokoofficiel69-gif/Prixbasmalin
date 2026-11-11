// Studio IA — serveur principal (Node 22, aucune dépendance externe).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import {
  DATA_DIR, ensureDirs, newId, readJson, writeJson, getSettings, saveSettings, DEFAULT_SETTINGS,
  getProjects, saveProjects, getProject, listConversations, getConversation, saveConversation, deleteConversation,
  listFiles, getFileMeta, filePath, addFileMeta, updateFileMeta, removeFile, storageUsed,
} from './store.js';
import { loadUsage, record, guard, summary } from './usage.js';
import { API_BASE, isConfigured, upstream, errorText, listModels, chat, UpstreamError } from './llm.js';
import { runAgents } from './agents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 8080);
const MAX_UPLOAD = 300 * 1024 * 1024;

ensureDirs();
loadUsage();
getProjects();

// ---------------------------------------------------------------------------
// Sécurité : mot de passe, sessions, limitation des tentatives
// ---------------------------------------------------------------------------
const SECRET = (() => {
  const f = path.join(DATA_DIR, 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw) {
  const stored = readJson('auth.json', {}).passwordHash;
  if (stored) {
    const [salt, h] = stored.split(':');
    const test = crypto.scryptSync(pw, salt, 32);
    return crypto.timingSafeEqual(test, Buffer.from(h, 'hex'));
  }
  const env = process.env.STUDIO_PASSWORD || '';
  if (!env) return false;
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(env).digest();
  return crypto.timingSafeEqual(a, b);
}
const passwordConfigured = () => !!(readJson('auth.json', {}).passwordHash || process.env.STUDIO_PASSWORD);

let sessions = readJson('sessions.json', {});
function saveSessions() { writeJson('sessions.json', sessions); }
function createSession() {
  const id = crypto.randomBytes(32).toString('base64url');
  sessions[id] = { created: Date.now(), exp: Date.now() + 30 * 86400_000 };
  for (const [k, v] of Object.entries(sessions)) if (v.exp < Date.now()) delete sessions[k];
  saveSessions();
  return id;
}
function getCookie(req, name) {
  const c = req.headers.cookie || '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function authed(req) {
  const sid = getCookie(req, 'studio_sid');
  const s = sid && sessions[sid];
  return !!(s && s.exp > Date.now());
}
const loginAttempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60_000);
  loginAttempts.set(ip, list);
  return list.length >= 10;
}

// Liens publics temporaires et signés (pour qu'un fournisseur vidéo puisse lire une photo).
function signLink(id, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${id}.${exp}`).digest('base64url').slice(0, 32);
}
function publicLink(req, id, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/pub/${id}/${exp}/${signLink(id, exp)}`;
}

// ---------------------------------------------------------------------------
// Utilitaires HTTP
// ---------------------------------------------------------------------------
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(payload);
}
const ok = (res, body) => send(res, 200, body);
const fail = (res, status, message) => send(res, status, { error: message });

async function readBody(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Requête trop volumineuse'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function readJsonBody(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
}

function sseStart(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': ok\n\n');
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
  res.on('close', () => clearInterval(ping));
  return (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, 'Interdit');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA : toute route inconnue renvoie l'application
      return serveStatic(req, res, '/index.html');
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

function streamFile(req, res, meta, download = false) {
  const fp = filePath(meta.id);
  let st;
  try { st = fs.statSync(fp); } catch { return fail(res, 404, 'Fichier introuvable'); }
  const headers = {
    'Content-Type': meta.type || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
  };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    if (!range[1]) end = st.size - 1;
    if (start >= st.size || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(fp, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  fs.createReadStream(fp).pipe(res);
}

function cleanName(name) {
  return String(name || 'fichier').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'fichier';
}

async function saveBuffer({ buffer, name, type, projectId, source }) {
  const quota = getSettings().storageQuotaMB * 1024 * 1024;
  if (storageUsed() + buffer.length > quota) throw Object.assign(new Error('Quota de stockage du Studio atteint. Supprimez des fichiers ou augmentez le quota.'), { status: 507 });
  const id = newId('f');
  fs.writeFileSync(filePath(id), buffer);
  const meta = { id, projectId: projectId || 'perso', name: cleanName(name), type: type || 'application/octet-stream', size: buffer.length, source: source || 'import', createdAt: new Date().toISOString() };
  addFileMeta(meta);
  return meta;
}

function projectContext(projectId) {
  const p = getProject(projectId);
  if (!p) return '';
  const parts = [`Projet : ${p.name}`];
  if (p.instructions) parts.push(`Consignes du projet :\n${p.instructions}`);
  if (p.memory) parts.push(`Mémoire de travail du projet (faits importants à retenir) :\n${p.memory.slice(-5000)}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Routes API
// ---------------------------------------------------------------------------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, public: !!opts.public });
};

route('GET', '/api/health', (req, res) => ok(res, { ok: true }), { public: true });

route('GET', '/api/me', (req, res) => ok(res, {
  authenticated: authed(req), passwordConfigured: passwordConfigured(), freellmapiConfigured: isConfigured(),
}), { public: true });

route('POST', '/api/login', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (tooManyAttempts(ip)) return fail(res, 429, 'Trop de tentatives. Réessayez dans 15 minutes.');
  const { password } = await readJsonBody(req);
  if (!passwordConfigured()) return fail(res, 503, "Aucun mot de passe n'est configuré sur le serveur (variable STUDIO_PASSWORD).");
  if (!password || !checkPassword(String(password))) {
    loginAttempts.get(ip).push(Date.now());
    return fail(res, 401, 'Mot de passe incorrect.');
  }
  const sid = createSession();
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  send(res, 200, { ok: true }, undefined, {
    'Set-Cookie': `studio_sid=${sid}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${30 * 86400}${secure}`,
  });
}, { public: true });

route('POST', '/api/logout', (req, res) => {
  const sid = getCookie(req, 'studio_sid');
  if (sid) { delete sessions[sid]; saveSessions(); }
  send(res, 200, { ok: true }, undefined, { 'Set-Cookie': 'studio_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict' });
});

route('POST', '/api/password', async (req, res) => {
  const { current, next } = await readJsonBody(req);
  if (!checkPassword(String(current || ''))) return fail(res, 401, 'Mot de passe actuel incorrect.');
  if (!next || String(next).length < 10) return fail(res, 400, 'Le nouveau mot de passe doit faire au moins 10 caractères.');
  writeJson('auth.json', { passwordHash: hashPassword(String(next)) });
  const sid = getCookie(req, 'studio_sid');
  sessions = sid && sessions[sid] ? { [sid]: sessions[sid] } : {};
  saveSessions();
  ok(res, { ok: true });
});

// --- État général ---
route('GET', '/api/status', async (req, res) => {
  const out = { freellmapi: { url: API_BASE, configured: isConfigured(), reachable: false }, storage: { used: storageUsed(), quota: getSettings().storageQuotaMB * 1024 * 1024 } };
  if (isConfigured()) {
    try {
      const models = await listModels(req.url.includes('refresh'));
      const real = models.filter(m => m.owned_by !== 'freellmapi');
      out.freellmapi.reachable = true;
      out.freellmapi.models = {
        total: real.length,
        ready: real.filter(m => m.execution_status === 'ready').length,
        exhausted: real.filter(m => m.execution_status === 'exhausted').length,
        needsKey: real.filter(m => m.execution_status === 'needsKey' || m.available === false).length,
      };
      const plats = {};
      for (const m of real) {
        const p = m.owned_by || '?';
        plats[p] ||= { platform: p, ready: 0, exhausted: 0, needsKey: 0 };
        const st = m.execution_status || (m.available ? 'ready' : 'needsKey');
        plats[p][st] = (plats[p][st] || 0) + 1;
      }
      out.freellmapi.platforms = Object.values(plats).sort((a, b) => b.ready - a.ready || a.platform.localeCompare(b.platform));
    } catch (err) {
      out.freellmapi.error = err.message;
    }
  }
  ok(res, out);
});

route('GET', '/api/models', async (req, res) => {
  try {
    const models = await listModels(req.url.includes('refresh'));
    const s = getSettings();
    ok(res, models.map(m => ({
      id: m.id, name: m.name || m.id, platform: m.owned_by, status: m.execution_status || (m.available ? 'ready' : 'needsKey'),
      context: m.context_window || null, router: m.owned_by === 'freellmapi',
      paid: s.paidPlatforms.includes(String(m.owned_by || '').toLowerCase()),
      tools: (m.supported_parameters || []).includes('tools'),
    })));
  } catch (err) {
    fail(res, err.status || 502, err.message);
  }
});

// --- Chat (flux SSE simplifié) ---
route('POST', '/api/chat', async (req, res) => {
  const body = await readJsonBody(req, 40 * 1024 * 1024);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return fail(res, 400, 'Message vide.');
  const ctx = projectContext(body.projectId);
  const sys = [
    'Tu es une IA du Studio IA personnel de son propriétaire. Réponds toujours en français sauf demande contraire. Utilise le Markdown (titres, listes, blocs de code).',
    ctx,
    body.system || '',
  ].filter(Boolean).join('\n\n');
  const full = [{ role: 'system', content: sys }, ...messages.filter(m => m.role !== 'system')];
  const emit = sseStart(res);
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(new Error('client parti')); });
  try {
    const r = await chat({
      model: body.model || getSettings().defaultModel || 'auto',
      messages: full,
      temperature: body.temperature,
      signal: ctrl.signal,
      onMeta: (m) => emit({ type: 'meta', ...m }),
      onDelta: (d) => emit({ type: 'delta', ...d }),
    });
    emit({ type: 'done', routedVia: r.routedVia, model: r.model, platform: r.platform, usage: r.usage, estimated: r.estimated, ms: r.ms });
  } catch (err) {
    emit({ type: 'error', error: err.message, status: err.status || 502 });
  }
  res.end();
});

// Réponse simple non streamée (utilisée par les outils : scénarios, compositions, prompts…)
route('POST', '/api/complete', async (req, res) => {
  const body = await readJsonBody(req, 20 * 1024 * 1024);
  try {
    const ctx = projectContext(body.projectId);
    const messages = [
      { role: 'system', content: [body.system || 'Tu es un assistant expert. Réponds en français.', ctx].filter(Boolean).join('\n\n') },
      ...(body.messages || [{ role: 'user', content: String(body.prompt || '') }]),
    ];
    const r = await chat({ model: body.model || 'auto', messages, temperature: body.temperature, src: body.src || 'outil', extra: body.json ? { response_format: { type: 'json_object' } } : {} });
    ok(res, { content: r.content, routedVia: r.routedVia, usage: r.usage });
  } catch (err) {
    fail(res, err.status || 502, err.message);
  }
});

// --- Agents ---
route('POST', '/api/agents/run', async (req, res) => {
  const body = await readJsonBody(req);
  if (!body.task) return fail(res, 400, 'Décrivez la tâche à confier aux agents.');
  const emit = sseStart(res);
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(new Error('client parti')); });
  try {
    await runAgents({
      task: String(body.task), agents: body.agents || [], mode: body.mode, rounds: Number(body.rounds) || 2,
      synthModel: body.synthModel || 'auto', projectContext: projectContext(body.projectId), emit, signal: ctrl.signal,
    });
  } catch (err) {
    emit({ type: 'error', error: err.message });
  }
  emit({ type: 'end' });
  res.end();
});

// --- Médias via FreeLLMAPI ---
function mediaGuard(res, kind) {
  const g = guard({ kind });
  if (g) { fail(res, 402, g); return false; }
  return true;
}

route('POST', '/api/images', async (req, res) => {
  if (!mediaGuard(res, 'image')) return;
  const body = await readJsonBody(req);
  if (!body.prompt) return fail(res, 400, 'Décrivez l’image à créer.');
  const t0 = Date.now();
  try {
    const r = await upstream('/v1/images/generations', {
      method: 'POST', timeoutMs: 180000,
      json: { model: body.model || 'auto', prompt: String(body.prompt), n: Math.min(Number(body.n) || 1, 4), size: body.size || '1024x1024', response_format: 'b64_json' },
    });
    if (!r.ok) throw new UpstreamError(await errorText(r), r.status);
    const j = await r.json();
    const saved = [];
    for (const [i, img] of (j.data || []).entries()) {
      let buf;
      if (img.b64_json) buf = Buffer.from(img.b64_json, 'base64');
      else if (img.url) {
        const ir = await fetch(img.url);
        if (!ir.ok) continue;
        buf = Buffer.from(await ir.arrayBuffer());
      }
      if (!buf) continue;
      const type = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : buf.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png';
      const ext = type.split('/')[1].replace('jpeg', 'jpg');
      saved.push(await saveBuffer({ buffer: buf, name: `image-ia-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${i + 1}.${ext}`, type, projectId: body.projectId, source: 'image-ia' }));
    }
    if (body.prompt) for (const f of saved) updateFileMeta(f.id, { prompt: String(body.prompt).slice(0, 500), model: `${j.provider || ''}/${j.model || ''}` });
    record({ kind: 'image', model: j.model, platform: j.provider, ms: Date.now() - t0 });
    ok(res, { files: saved, provider: j.provider, model: j.model });
  } catch (err) {
    record({ kind: 'image', model: body.model || 'auto', ok: false, err: err.message, ms: Date.now() - t0 });
    fail(res, err.status || 502, err.message);
  }
});

route('POST', '/api/videos', async (req, res) => {
  if (!mediaGuard(res, 'video')) return;
  const body = await readJsonBody(req);
  if (!body.prompt) return fail(res, 400, 'Décrivez la vidéo à créer.');
  const t0 = Date.now();
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(new Error('client parti')); });
  try {
    const json = { model: body.model || 'auto', prompt: String(body.prompt) };
    if (body.duration) json.duration = Math.max(1, Math.min(Number(body.duration), 10));
    if (body.aspect_ratio === '9:16' || body.aspect_ratio === '16:9') json.aspect_ratio = body.aspect_ratio;
    if (body.imageFileId) {
      const meta = getFileMeta(body.imageFileId);
      if (meta) json.image = publicLink(req, meta.id, 1800);
    }
    const r = await upstream('/v1/videos/generations', { method: 'POST', json, timeoutMs: 330000, signal: ctrl.signal });
    if (!r.ok) throw new UpstreamError(await errorText(r), r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const provider = r.headers.get('x-provider') || '';
    const model = r.headers.get('x-model') || '';
    const vtype = (r.headers.get('content-type') || 'video/mp4').split(';')[0];
    const vext = vtype.includes('webm') ? 'webm' : vtype.includes('quicktime') ? 'mov' : 'mp4';
    const meta = await saveBuffer({ buffer: buf, name: `video-ia-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${vext}`, type: vtype, projectId: body.projectId, source: 'video-ia' });
    updateFileMeta(meta.id, { prompt: String(body.prompt).slice(0, 500), model: `${provider}/${model}` });
    record({ kind: 'video', model, platform: provider, ms: Date.now() - t0 });
    ok(res, { file: meta, provider, model });
  } catch (err) {
    record({ kind: 'video', model: body.model || 'auto', ok: false, err: err.message, ms: Date.now() - t0 });
    if (!res.writableEnded && !res.destroyed) fail(res, err.status || 502, err.message);
  }
});

route('POST', '/api/speech', async (req, res) => {
  if (!mediaGuard(res, 'speech')) return;
  const body = await readJsonBody(req);
  if (!body.input) return fail(res, 400, 'Texte vide.');
  const t0 = Date.now();
  try {
    const r = await upstream('/v1/audio/speech', {
      method: 'POST', timeoutMs: 120000,
      json: { model: body.model || 'auto', input: String(body.input).slice(0, 4000), voice: body.voice || getSettings().ttsVoice, response_format: 'mp3' },
    });
    if (!r.ok) throw new UpstreamError(await errorText(r), r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const provider = r.headers.get('x-provider') || '';
    record({ kind: 'speech', model: body.model || 'auto', platform: provider, ms: Date.now() - t0 });
    if (body.save) {
      const meta = await saveBuffer({ buffer: buf, name: `voix-ia-${Date.now()}.${(r.headers.get('content-type') || '').includes('wav') ? 'wav' : 'mp3'}`, type: r.headers.get('content-type') || 'audio/mpeg', projectId: body.projectId, source: 'voix-ia' });
      return ok(res, { file: meta, provider });
    }
    send(res, 200, buf, r.headers.get('content-type') || 'audio/mpeg', { 'X-Provider': provider });
  } catch (err) {
    record({ kind: 'speech', model: body.model || 'auto', ok: false, err: err.message, ms: Date.now() - t0 });
    fail(res, err.status || 502, err.message);
  }
});

route('POST', '/api/transcribe', async (req, res) => {
  if (!mediaGuard(res, 'transcription')) return;
  const t0 = Date.now();
  try {
    const u = new URL(req.url, 'http://x');
    let audio, type, name;
    const fileId = u.searchParams.get('fileId');
    if (fileId) {
      const meta = getFileMeta(fileId);
      if (!meta) return fail(res, 404, 'Fichier introuvable');
      if (meta.size > 24 * 1024 * 1024) return fail(res, 413, 'Fichier trop long pour la transcription (24 Mo max). Découpez-le dans Enregistrement audio.');
      audio = fs.readFileSync(filePath(fileId)); type = meta.type; name = meta.name;
    } else {
      audio = await readBody(req, 24 * 1024 * 1024);
      type = (req.headers['content-type'] || 'audio/webm').split(';')[0];
      name = `audio.${type.split('/')[1] || 'webm'}`.replace('mpeg', 'mp3').replace('x-wav', 'wav');
    }
    if (!audio.length) return fail(res, 400, 'Audio vide.');
    const boundary = '----studio' + crypto.randomBytes(8).toString('hex');
    const field = (k, v) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    let head = field('model', 'auto');
    const lang = u.searchParams.get('lang');
    if (lang) head += field('language', lang);
    const fmt = u.searchParams.get('format') === 'verbose_json' ? 'verbose_json' : 'json';
    head += field('response_format', fmt);
    head += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name.replace(/"/g, '')}"\r\nContent-Type: ${type}\r\n\r\n`;
    const multipart = Buffer.concat([Buffer.from(head), audio, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const r = await upstream('/v1/audio/transcriptions', {
      method: 'POST', body: multipart, timeoutMs: 180000,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    });
    if (!r.ok) throw new UpstreamError(await errorText(r), r.status);
    const j = await r.json();
    const provider = r.headers.get('x-provider') || '';
    record({ kind: 'transcription', model: r.headers.get('x-model') || 'auto', platform: provider, ms: Date.now() - t0 });
    ok(res, { text: j.text || '', segments: j.segments || null, language: j.language || null, provider });
  } catch (err) {
    record({ kind: 'transcription', model: 'auto', ok: false, err: err.message, ms: Date.now() - t0 });
    fail(res, err.status || 502, err.message);
  }
});

// --- Projets ---
route('GET', '/api/projects', (req, res) => ok(res, getProjects()));
route('POST', '/api/projects', async (req, res) => {
  const b = await readJsonBody(req);
  if (!b.name) return fail(res, 400, 'Nom requis.');
  const list = getProjects();
  const now = new Date().toISOString();
  const p = { id: newId('p'), name: String(b.name).slice(0, 60), icon: b.icon || '📁', color: b.color || '#475569', instructions: String(b.instructions || ''), memory: '', createdAt: now, updatedAt: now };
  list.push(p); saveProjects(list); ok(res, p);
});
route('PUT', '/api/projects/:id', async (req, res, { id }) => {
  const b = await readJsonBody(req);
  const list = getProjects();
  const p = list.find(x => x.id === id);
  if (!p) return fail(res, 404, 'Projet introuvable');
  for (const k of ['name', 'icon', 'color', 'instructions', 'memory']) if (typeof b[k] === 'string') p[k] = b[k].slice(0, k === 'memory' || k === 'instructions' ? 20000 : 80);
  p.updatedAt = new Date().toISOString();
  saveProjects(list); ok(res, p);
});
route('POST', '/api/projects/:id/memory', async (req, res, { id }) => {
  const { note } = await readJsonBody(req);
  const list = getProjects();
  const p = list.find(x => x.id === id);
  if (!p) return fail(res, 404, 'Projet introuvable');
  const line = `- [${new Date().toLocaleDateString('fr-FR')}] ${String(note || '').trim().slice(0, 2000)}`;
  p.memory = (p.memory ? p.memory + '\n' : '') + line;
  p.updatedAt = new Date().toISOString();
  saveProjects(list); ok(res, p);
});
route('DELETE', '/api/projects/:id', (req, res, { id }) => {
  const list = getProjects();
  if (list.length <= 1) return fail(res, 400, 'Gardez au moins un projet.');
  const hasData = listConversations(id).length || listFiles(id).length;
  if (hasData) return fail(res, 409, 'Ce projet contient des conversations ou des fichiers : supprimez-les d’abord (aucune donnée n’est effacée automatiquement).');
  saveProjects(list.filter(p => p.id !== id)); ok(res, { ok: true });
});

// --- Conversations ---
route('GET', '/api/conversations', (req, res) => {
  const u = new URL(req.url, 'http://x');
  ok(res, listConversations(u.searchParams.get('project')));
});
route('GET', '/api/conversations/:id', (req, res, { id }) => {
  const c = getConversation(id);
  c ? ok(res, c) : fail(res, 404, 'Conversation introuvable');
});
route('PUT', '/api/conversations/:id', async (req, res, { id }) => {
  const b = await readJsonBody(req, 40 * 1024 * 1024);
  const prev = getConversation(id);
  const conv = { ...(prev || { createdAt: new Date().toISOString() }), ...b, id };
  ok(res, saveConversation(conv));
});
route('DELETE', '/api/conversations/:id', (req, res, { id }) => { deleteConversation(id); ok(res, { ok: true }); });

// --- Fichiers ---
route('GET', '/api/files', (req, res) => {
  const u = new URL(req.url, 'http://x');
  ok(res, { files: listFiles(u.searchParams.get('project')), used: storageUsed(), quota: getSettings().storageQuotaMB * 1024 * 1024 });
});
route('POST', '/api/files', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const name = cleanName(u.searchParams.get('name'));
  const type = (req.headers['content-type'] || 'application/octet-stream').split(';')[0];
  const declared = Number(req.headers['content-length'] || 0);
  const quota = getSettings().storageQuotaMB * 1024 * 1024;
  if (declared > MAX_UPLOAD) return fail(res, 413, 'Fichier trop volumineux (300 Mo max).');
  if (storageUsed() + declared > quota) return fail(res, 507, 'Quota de stockage du Studio atteint.');
  const id = newId('f');
  const fp = filePath(id);
  let size = 0;
  try {
    await pipeline(req, async function* (src) {
      for await (const chunk of src) {
        size += chunk.length;
        if (size > MAX_UPLOAD) throw Object.assign(new Error('Fichier trop volumineux (300 Mo max).'), { status: 413 });
        yield chunk;
      }
    }, fs.createWriteStream(fp));
  } catch (err) {
    try { fs.unlinkSync(fp); } catch {}
    return fail(res, err.status || 500, err.message);
  }
  const meta = { id, projectId: u.searchParams.get('project') || 'perso', name, type, size, source: u.searchParams.get('source') || 'import', createdAt: new Date().toISOString() };
  if (u.searchParams.get('note')) meta.note = String(u.searchParams.get('note')).slice(0, 300);
  addFileMeta(meta);
  ok(res, meta);
});
route('GET', '/api/files/:id', (req, res, { id }) => {
  const meta = getFileMeta(id);
  if (!meta) return fail(res, 404, 'Fichier introuvable');
  streamFile(req, res, meta, new URL(req.url, 'http://x').searchParams.has('download'));
});
route('PUT', '/api/files/:id', async (req, res, { id }) => {
  const b = await readJsonBody(req);
  const patch = {};
  if (b.name) patch.name = cleanName(b.name);
  if (b.projectId && getProject(b.projectId)) patch.projectId = b.projectId;
  if (typeof b.note === 'string') patch.note = b.note.slice(0, 300);
  const f = updateFileMeta(id, patch);
  f ? ok(res, f) : fail(res, 404, 'Fichier introuvable');
});
route('DELETE', '/api/files/:id', (req, res, { id }) => {
  if (!getFileMeta(id)) return fail(res, 404, 'Fichier introuvable');
  removeFile(id); ok(res, { ok: true });
});

// --- Suivi et réglages ---
let upstreamUsageCache = { t: 0, data: null };
route('GET', '/api/usage', async (req, res) => {
  const out = summary();
  out.settings = getSettings();
  if (isConfigured()) {
    if (Date.now() - upstreamUsageCache.t > 60_000) {
      try {
        const r = await upstream('/v1/usage', { timeoutMs: 15000 });
        upstreamUsageCache = { t: Date.now(), data: r.ok ? await r.json() : { error: await errorText(r) } };
      } catch (err) { upstreamUsageCache = { t: Date.now(), data: { error: err.message } }; }
    }
    out.freellmapi = upstreamUsageCache.data;
  }
  ok(res, out);
});
route('GET', '/api/settings', (req, res) => ok(res, getSettings()));
route('PUT', '/api/settings', async (req, res) => {
  const b = await readJsonBody(req);
  const patch = {};
  for (const k of ['freeOnly', 'allowPaid']) if (typeof b[k] === 'boolean') patch[k] = b[k];
  for (const k of ['dailyTokenCap', 'monthlyTokenCap', 'dailyMediaCap', 'storageQuotaMB']) {
    if (b[k] !== undefined) { const n = Math.max(0, Math.floor(Number(b[k]) || 0)); patch[k] = k === 'storageQuotaMB' ? Math.min(Math.max(n, 50), 9000) : n; }
  }
  if (Array.isArray(b.paidPlatforms)) patch.paidPlatforms = b.paidPlatforms.map(s => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 50);
  if (typeof b.defaultModel === 'string') patch.defaultModel = b.defaultModel.slice(0, 120);
  if (typeof b.ttsVoice === 'string') patch.ttsVoice = b.ttsVoice.slice(0, 40);
  if (b.prices && typeof b.prices === 'object') patch.prices = Object.fromEntries(Object.entries(b.prices).map(([k, v]) => [String(k).toLowerCase(), Math.max(0, Number(v) || 0)]));
  if (patch.freeOnly === true) patch.allowPaid = false;
  ok(res, saveSettings(patch));
});
route('POST', '/api/settings/reset', (req, res) => ok(res, saveSettings({ ...DEFAULT_SETTINGS })));

// Export de sauvegarde (projets, conversations, index des fichiers)
route('GET', '/api/export', (req, res) => {
  const conversations = listConversations().map(c => getConversation(c.id)).filter(Boolean);
  send(res, 200, JSON.stringify({ exportedAt: new Date().toISOString(), projects: getProjects(), conversations, files: listFiles(), settings: getSettings() }, null, 1),
    'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="studio-ia-sauvegarde-${new Date().toISOString().slice(0, 10)}.json"` });
});

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self)');
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // Liens publics signés
  if (req.method === 'GET' && pathname.startsWith('/pub/')) {
    const [, , id, exp, sig] = pathname.split('/');
    const meta = id && getFileMeta(id);
    if (!meta || !exp || Number(exp) < Date.now() / 1000 || !sig || sig.length !== 32 ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(signLink(id, exp)))) return fail(res, 403, 'Lien expiré ou invalide');
    return streamFile(req, res, meta);
  }

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    if (!r.public && !authed(req)) return fail(res, 401, 'Connexion requise.');
    // Protection CSRF : en-tête personnalisé obligatoire pour toute écriture.
    if (req.method !== 'GET' && req.headers['x-studio'] !== '1') return fail(res, 403, 'Requête refusée.');
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      await r.handler(req, res, params);
    } catch (err) {
      if (!res.headersSent) fail(res, err.status || 500, err.message || 'Erreur interne');
      else try { res.end(); } catch {}
    }
    return;
  }
  fail(res, 404, 'Route inconnue');
});
server.requestTimeout = 0;
server.headersTimeout = 60000;
server.listen(PORT, () => {
  console.log(`Studio IA prêt sur le port ${PORT} — FreeLLMAPI : ${API_BASE} (${isConfigured() ? 'clé présente' : 'CLÉ MANQUANTE'}) — données : ${DATA_DIR}`);
  if (!passwordConfigured()) console.log('ATTENTION : aucun mot de passe (STUDIO_PASSWORD) — la connexion est impossible tant qu’il n’est pas défini.');
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); process.exit(0); });

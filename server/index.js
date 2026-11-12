// Studio IA — serveur principal (Node 22, aucune dépendance externe), multi-comptes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import {
  DATA_DIR, ensureDirs, ensureUserDirs, newId, readJson, writeJson, getSettings, saveSettings, DEFAULT_SETTINGS,
  getUsers, saveUsers, getUser, findUserByName, publicUser, DEFAULT_USER_LIMITS, migrateLegacy, migrateQuotas, allocatedTokens,
  getProjects, saveProjects, getProject, listConversations, getConversation, saveConversation, deleteConversation,
  listFiles, getFileMeta, filePath, addFileMeta, updateFileMeta, removeFile, storageUsed, storageUsedAll,
} from './store.js';
import { loadUsage, record, guard, summary, perUser, costOf } from './usage.js';
import { API_BASE, isConfigured, upstream, errorText, listModels, chat, UpstreamError, setLedger } from './llm.js';
import { Ledger } from './quota.js';
import {
  PROVIDER_FACTS, OVH_BASE, listOvhModels, ovhChatModels, ovhExcludedModels, ovhRealCapacity, ovhCapacityNow, ovhSlot, ovhTake, ovhCooldown,
  verifyGateway, gatewayState, gatewayMediaAllowed, platformAllowed,
} from './providers.js';
import { runAgents } from './agents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 8080);
const MAX_UPLOAD = 300 * 1024 * 1024;

ensureDirs();

// ---------------------------------------------------------------------------
// Comptes : création de l'administrateur au premier démarrage
// ---------------------------------------------------------------------------
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
function verifyHash(pw, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(pw, salt, 32), Buffer.from(h, 'hex'));
}
function envPasswordMatches(pw) {
  const env = process.env.STUDIO_PASSWORD || '';
  if (!env) return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(pw).digest(), crypto.createHash('sha256').update(env).digest());
}
(function bootstrap() {
  let users = getUsers();
  if (!users.length) {
    const legacyHash = readJson('auth.json', {}).passwordHash || null;
    users = [{ id: 'admin', username: process.env.STUDIO_ADMIN || 'admin', name: 'Administrateur', role: 'admin', passwordHash: legacyHash, createdAt: new Date().toISOString() }];
    saveUsers(users);
  }
  const admin = users.find(u => u.role === 'admin');
  if (admin) migrateLegacy(admin.id);
  for (const u of users) getProjects(u.id);
})();
loadUsage();
migrateQuotas(getSettings().poolMonthlyTokens);

// Registre des tokens (pool mensuel global + quotas individuels + réservations)
const clockFile = process.env.STUDIO_CLOCK_FILE; // tests uniquement : date simulée
const ledger = new Ledger({
  dir: path.join(DATA_DIR, 'ledger'),
  now: () => { if (clockFile) { try { return new Date(fs.readFileSync(clockFile, 'utf8').trim()); } catch {} } return new Date(); },
  limits: () => ({ pool: getSettings().poolMonthlyTokens, globalDaily: getSettings().dailyTokenCap }),
  userLimits: (uid) => {
    const u = getUser(uid);
    if (!u || u.disabled) return { quota: 0, daily: 0 };
    return { quota: u.monthlyTokenQuota || 0, daily: u.dailyTokenCap || 0 };
  },
});
setLedger(ledger);
{
  // Reprise de la consommation du mois enregistrée avant le registre (une seule fois).
  const m = new Date().toISOString().slice(0, 7);
  try {
    const legacy = fs.readFileSync(path.join(DATA_DIR, 'usage', `${m}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(x => x && x.ok !== false && (x.kind === 'chat' || !x.kind) && x.tokens > 0);
    const n = ledger.importLegacy(legacy.map(x => ({ ...x, u: x.u || getUsers().find(u => u.role === 'admin')?.id })));
    if (n) console.log(`Registre : ${n} consommation(s) antérieure(s) du mois reprise(s).`);
  } catch {}
}

function checkLogin(username, password) {
  const u = findUserByName(username);
  if (!u || u.disabled) return null;
  if (u.passwordHash) return verifyHash(password, u.passwordHash) ? u : null;
  // L'administrateur sans mot de passe enregistré utilise STUDIO_PASSWORD.
  return u.role === 'admin' && envPasswordMatches(password) ? u : null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
const SECRET = (() => {
  const f = path.join(DATA_DIR, 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();
let sessions = readJson('sessions.json', {});
// Anciennes sessions (version mono-utilisateur) → rattachées à l'administrateur
for (const s of Object.values(sessions)) if (!s.uid) s.uid = getUsers().find(u => u.role === 'admin')?.id;
function saveSessions() { writeJson('sessions.json', sessions); }
function createSession(uid) {
  const id = crypto.randomBytes(32).toString('base64url');
  sessions[id] = { uid, created: Date.now(), exp: Date.now() + 30 * 86400_000 };
  for (const [k, v] of Object.entries(sessions)) if (v.exp < Date.now()) delete sessions[k];
  saveSessions();
  return id;
}
function dropSessionsOf(uid, keep) {
  for (const [k, v] of Object.entries(sessions)) if (v.uid === uid && k !== keep) delete sessions[k];
  saveSessions();
}
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function currentUser(req) {
  const sid = getCookie(req, 'studio_sid');
  const s = sid && sessions[sid];
  if (!s || s.exp < Date.now()) return null;
  const u = getUser(s.uid);
  return u && !u.disabled ? u : null;
}
const loginAttempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60_000);
  loginAttempts.set(ip, list);
  return list.length >= 10;
}

// Liens publics temporaires et signés (pour qu'un fournisseur vidéo puisse lire une photo).
function signLink(uid, id, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${uid}.${id}.${exp}`).digest('base64url').slice(0, 32);
}
function publicLink(req, uid, id, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/pub/${uid}/${id}/${exp}/${signLink(uid, id, exp)}`;
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
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
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
    if (err || !st.isFile()) return serveStatic(req, res, '/index.html');
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300', 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

function streamFile(req, res, uid, meta, download = false) {
  const fp = filePath(uid, meta.id);
  let st;
  try { st = fs.statSync(fp); } catch { return fail(res, 404, 'Fichier introuvable'); }
  const headers = {
    'Content-Type': meta.type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
  };
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    if (start >= st.size || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(fp, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  fs.createReadStream(fp).pipe(res);
}

const cleanName = (name) => String(name || 'fichier').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'fichier';

function quotaCheck(user, extraBytes) {
  const s = getSettings();
  if (storageUsedAll() + extraBytes > s.storageQuotaMB * 1048576) return 'L’espace de stockage du Studio est plein. Supprimez des fichiers.';
  if (user.role !== 'admin') {
    const q = (user.storageQuotaMB ?? DEFAULT_USER_LIMITS.storageQuotaMB) * 1048576;
    if (storageUsed(user.id) + extraBytes > q) return `Votre espace de fichiers est plein (${Math.round(q / 1048576)} Mo). Supprimez des fichiers.`;
  }
  return null;
}
function userQuotaBytes(user) {
  return user.role === 'admin' ? getSettings().storageQuotaMB * 1048576 : (user.storageQuotaMB ?? DEFAULT_USER_LIMITS.storageQuotaMB) * 1048576;
}

async function saveBuffer(user, { buffer, name, type, projectId, source }) {
  const q = quotaCheck(user, buffer.length);
  if (q) throw Object.assign(new Error(q), { status: 507 });
  const id = newId('f');
  fs.writeFileSync(filePath(user.id, id), buffer);
  const meta = { id, projectId: projectId && getProject(user.id, projectId) ? projectId : getProjects(user.id)[0].id, name: cleanName(name), type: type || 'application/octet-stream', size: buffer.length, source: source || 'import', createdAt: new Date().toISOString() };
  addFileMeta(user.id, meta);
  return meta;
}

function projectContext(user, projectId) {
  const p = getProject(user.id, projectId);
  const parts = [`L’utilisateur s’appelle ${user.name || user.username}.`];
  if (p) {
    parts.push(`Projet : ${p.name}`);
    if (p.instructions) parts.push(`Consignes du projet :\n${p.instructions}`);
    if (p.memory) parts.push(`Mémoire de travail du projet (faits importants à retenir) :\n${p.memory.slice(-5000)}`);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, public: !!opts.public, admin: !!opts.admin });
};

route('GET', '/api/health', (req, res) => ok(res, { ok: true }), { public: true });

route('GET', '/api/me', (req, res) => {
  const u = currentUser(req);
  ok(res, { authenticated: !!u, user: publicUser(u), freellmapiConfigured: isConfigured() });
}, { public: true });

route('POST', '/api/login', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (tooManyAttempts(ip)) return fail(res, 429, 'Trop de tentatives. Réessayez dans 15 minutes.');
  const { username, password } = await readJsonBody(req);
  const u = checkLogin(String(username || '').trim() || 'admin', String(password || ''));
  if (!u) {
    loginAttempts.get(ip).push(Date.now());
    return fail(res, 401, 'Identifiant ou mot de passe incorrect.');
  }
  const users = getUsers();
  const me = users.find(x => x.id === u.id);
  me.lastLoginAt = new Date().toISOString();
  saveUsers(users);
  const sid = createSession(u.id);
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : '';
  send(res, 200, { ok: true, user: publicUser(me) }, undefined, { 'Set-Cookie': `studio_sid=${sid}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${30 * 86400}${secure}` });
}, { public: true });

route('POST', '/api/logout', (req, res) => {
  const sid = getCookie(req, 'studio_sid');
  if (sid) { delete sessions[sid]; saveSessions(); }
  send(res, 200, { ok: true }, undefined, { 'Set-Cookie': 'studio_sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict' });
});

route('POST', '/api/password', async (req, res, p, user) => {
  const { current, next } = await readJsonBody(req);
  if (!checkLogin(user.username, String(current || ''))) return fail(res, 401, 'Mot de passe actuel incorrect.');
  if (!next || String(next).length < 8) return fail(res, 400, 'Le nouveau mot de passe doit faire au moins 8 caractères.');
  const users = getUsers();
  const me = users.find(u => u.id === user.id);
  me.passwordHash = hashPassword(String(next));
  me.mustChangePassword = false;
  saveUsers(users);
  dropSessionsOf(user.id, getCookie(req, 'studio_sid'));
  ok(res, { ok: true });
});

// --- Gestion des comptes (administrateur) ---
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;
route('GET', '/api/users', (req, res) => {
  const usage = perUser();
  const snap = ledger.snapshot(getUsers().map(u => u.id));
  ok(res, getUsers().map(u => ({ ...publicUser(u), usage: usage[u.id] || { today: 0, todayMedia: 0, month: 0, requests: 0 }, tokens: snap.users[u.id], storage: storageUsed(u.id) })));
}, { admin: true });
route('POST', '/api/users', async (req, res) => {
  const b = await readJsonBody(req);
  const username = String(b.username || '').trim();
  if (!USERNAME_RE.test(username)) return fail(res, 400, 'Identifiant : 3 à 30 caractères (lettres, chiffres, point, tiret).');
  if (findUserByName(username)) return fail(res, 409, 'Cet identifiant existe déjà.');
  if (!b.password || String(b.password).length < 8) return fail(res, 400, 'Mot de passe provisoire : 8 caractères minimum.');
  const users = getUsers();
  if (users.length >= 30) return fail(res, 400, '30 comptes maximum.');
  const quota = Math.max(0, Math.floor(Number(b.monthlyTokenQuota ?? DEFAULT_USER_LIMITS.monthlyTokenQuota) || 0));
  const free = getSettings().poolMonthlyTokens - allocatedTokens(users);
  if (quota > free) return fail(res, 400, `Quota impossible : il ne reste que ${free.toLocaleString('fr-FR')} tokens non attribués dans le pool mensuel.`);
  const u = {
    id: newId('u'), username, name: String(b.name || username).slice(0, 40), role: 'member', passwordHash: hashPassword(String(b.password)),
    mustChangePassword: true, monthlyTokenQuota: quota, dailyTokenCap: Math.max(0, Number(b.dailyTokenCap ?? DEFAULT_USER_LIMITS.dailyTokenCap) || 0),
    dailyMediaCap: Math.max(0, Number(b.dailyMediaCap ?? DEFAULT_USER_LIMITS.dailyMediaCap) || 0),
    storageQuotaMB: Math.max(10, Number(b.storageQuotaMB ?? DEFAULT_USER_LIMITS.storageQuotaMB) || 10), createdAt: new Date().toISOString(),
  };
  users.push(u); saveUsers(users); getProjects(u.id);
  ok(res, publicUser(u));
}, { admin: true });
route('PUT', '/api/users/:id', async (req, res, { id }, admin) => {
  const b = await readJsonBody(req);
  const users = getUsers();
  const u = users.find(x => x.id === id);
  if (!u) return fail(res, 404, 'Compte introuvable');
  if (typeof b.name === 'string') u.name = b.name.slice(0, 40);
  for (const k of ['dailyTokenCap', 'dailyMediaCap', 'storageQuotaMB']) if (b[k] !== undefined && u.role !== 'admin') u[k] = Math.max(0, Math.floor(Number(b[k]) || 0));
  if (typeof b.disabled === 'boolean') {
    if (u.id === admin.id) return fail(res, 400, 'Vous ne pouvez pas désactiver votre propre compte.');
    if (!b.disabled && u.disabled) {
      const free = getSettings().poolMonthlyTokens - allocatedTokens(users, u.id);
      if ((u.monthlyTokenQuota || 0) > free) return fail(res, 400, `Réactivation impossible : son quota (${(u.monthlyTokenQuota || 0).toLocaleString('fr-FR')}) dépasse les ${free.toLocaleString('fr-FR')} tokens non attribués. Réduisez d’abord son quota.`);
    }
    u.disabled = b.disabled;
    if (u.disabled) dropSessionsOf(u.id);
  }
  if (b.monthlyTokenQuota !== undefined) {
    const q = Math.max(0, Math.floor(Number(b.monthlyTokenQuota) || 0));
    const free = getSettings().poolMonthlyTokens - allocatedTokens(users, u.id);
    if (!u.disabled && q > free) return fail(res, 400, `Quota impossible : la somme des quotas dépasserait le pool. Maximum possible pour ce compte : ${free.toLocaleString('fr-FR')} tokens.`);
    u.monthlyTokenQuota = q;
  }
  if (b.password) {
    if (String(b.password).length < 8) return fail(res, 400, 'Mot de passe : 8 caractères minimum.');
    u.passwordHash = hashPassword(String(b.password));
    u.mustChangePassword = u.id !== admin.id;
    dropSessionsOf(u.id, u.id === admin.id ? getCookie(req, 'studio_sid') : null);
  }
  saveUsers(users);
  ok(res, publicUser(u));
}, { admin: true });

// --- État général ---
route('GET', '/api/status', async (req, res, p, user) => {
  const out = { freellmapi: { configured: isConfigured(), reachable: false }, storage: { used: storageUsed(user.id), quota: userQuotaBytes(user) } };
  if (user.role === 'admin') out.freellmapi.url = API_BASE;
  if (isConfigured()) {
    try {
      const models = await listModels(req.url.includes('refresh'));
      const real = models.filter(m => m.owned_by !== 'freellmapi');
      out.freellmapi.reachable = true;
      out.freellmapi.models = {
        total: real.length,
        ready: real.filter(m => m.execution_status === 'ready').length,
        exhausted: real.filter(m => m.execution_status === 'exhausted').length,
        needsKey: real.filter(m => m.execution_status === 'needsKey' || (!m.execution_status && m.available === false)).length,
      };
      const plats = {};
      for (const m of real) {
        const pf = m.owned_by || '?';
        plats[pf] ||= { platform: pf, ready: 0, exhausted: 0, needsKey: 0 };
        const st = m.execution_status || (m.available ? 'ready' : 'needsKey');
        plats[pf][st] = (plats[pf][st] || 0) + 1;
      }
      out.freellmapi.platforms = Object.values(plats).sort((a, b) => b.ready - a.ready || a.platform.localeCompare(b.platform));
    } catch (err) { out.freellmapi.error = err.message; }
  }
  ok(res, out);
});

route('GET', '/api/models', async (req, res) => {
  const st = getSettings();
  const out = [
    { id: 'auto', name: 'Auto (meilleur modèle gratuit vérifié)', provider: 'routeur', router: true, allowed: true },
    { id: 'auto:smart', name: 'Auto : le plus intelligent', provider: 'routeur', router: true, allowed: true },
    { id: 'auto:fast', name: 'Auto : le plus rapide', provider: 'routeur', router: true, allowed: true },
  ];
  const ovh = await listOvhModels(req.url.includes('refresh'));
  for (const m of ovhChatModels(ovh.list || [])) {
    const slot = ovhSlot(m);
    out.push({ id: `ovh/${m}`, name: m, provider: 'ovh', platforms: ['ovh'], verified: true, allowed: platformAllowed('ovh'), status: slot.ok ? 'ready' : 'busy', retryIn: slot.retryIn || 0 });
  }
  if (isConfigured()) {
    const g = await verifyGateway();
    if (g.ok) {
      for (const [id, m] of Object.entries(g.models)) {
        const allowed = !st.freeOnly || (m.platforms.length > 0 && m.platforms.every(p => platformAllowed(p)));
        out.push({ id: `freellmapi/${id}`, name: m.name, provider: 'freellmapi', platforms: m.platforms, verified: true, allowed, status: 'ready',
          reason: allowed ? '' : `Peut être servi par : ${m.platforms.join(', ')} (hors liste blanche)` });
      }
    } else {
      try {
        for (const m of (await listModels()).filter(x => x.owned_by === 'freellmapi' && x.id !== 'auto' && x.id !== 'fusion' && !x.id.startsWith('auto:'))) {
          out.push({ id: `freellmapi/${m.id}`, name: m.name || m.id, provider: 'freellmapi', platforms: [], verified: false, allowed: !st.freeOnly,
            status: m.execution_status || 'unknown', reason: 'Fournisseur réel inconnu avant l’appel (MCP FreeLLMAPI désactivé) : bloqué en mode gratuit' });
        }
      } catch {}
    }
  }
  ok(res, { models: out, ovhError: ovh.error, gateway: { verified: gatewayState().ok, error: gatewayState().error } });
});

// --- Chat ---
route('POST', '/api/chat', async (req, res, p, user) => {
  const body = await readJsonBody(req, 40 * 1024 * 1024);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return fail(res, 400, 'Message vide.');
  const sys = [
    'Tu es une IA du Studio IA, un espace personnel. Réponds toujours en français sauf demande contraire. Utilise le Markdown (titres, listes, blocs de code).',
    projectContext(user, body.projectId), body.system || '',
  ].filter(Boolean).join('\n\n');
  const full = [{ role: 'system', content: sys }, ...messages.filter(m => m.role !== 'system')];
  const emit = sseStart(res);
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(new Error('client parti')); });
  try {
    const r = await chat({
      uid: user.id, model: body.model || getSettings().defaultModel || 'auto', messages: full, temperature: body.temperature, signal: ctrl.signal,
      onMeta: (m) => emit({ type: 'meta', ...m }), onDelta: (d) => emit({ type: 'delta', ...d }),
    });
    emit({ type: 'done', routedVia: r.routedVia, model: r.model, redirectedFrom: r.redirectedFrom || null, platform: r.platform, usage: r.usage, estimated: r.estimated, ms: r.ms });
  } catch (err) { emit({ type: 'error', error: err.message, status: err.status || 502 }); }
  res.end();
});

route('POST', '/api/complete', async (req, res, p, user) => {
  const body = await readJsonBody(req, 20 * 1024 * 1024);
  try {
    const messages = [
      { role: 'system', content: [body.system || 'Tu es un assistant expert. Réponds en français.', projectContext(user, body.projectId)].filter(Boolean).join('\n\n') },
      ...(body.messages || [{ role: 'user', content: String(body.prompt || '') }]),
    ];
    const r = await chat({ uid: user.id, model: body.model || 'auto', messages, temperature: body.temperature, src: body.src || 'outil', extra: body.json ? { response_format: { type: 'json_object' } } : {} });
    ok(res, { content: r.content, routedVia: r.routedVia, redirectedFrom: r.redirectedFrom || null, usage: r.usage });
  } catch (err) { fail(res, err.status || 502, err.message); }
});

route('POST', '/api/agents/run', async (req, res, p, user) => {
  const body = await readJsonBody(req);
  if (!body.task) return fail(res, 400, 'Décrivez la tâche à confier aux agents.');
  const emit = sseStart(res);
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(new Error('client parti')); });
  try {
    await runAgents({
      uid: user.id, task: String(body.task), agents: body.agents || [], mode: body.mode, rounds: Number(body.rounds) || 2,
      synthModel: body.synthModel || 'auto', projectContext: projectContext(user, body.projectId), emit, signal: ctrl.signal,
    });
  } catch (err) { emit({ type: 'error', error: err.message }); }
  emit({ type: 'end' });
  res.end();
});

// --- Médias ---
function mediaGuard(res, kind, user, viaGateway = true) {
  if (viaGateway && !gatewayMediaAllowed()) {
    fail(res, 403, 'Bloqué par le mode gratuit : les images, vidéos et voix passent par FreeLLMAPI dont le fournisseur réel n’est connu qu’après l’appel. L’administrateur peut les autoriser explicitement dans Suivi des tokens → Garde-fous.');
    return false;
  }
  const g = guard({ kind, uid: user.id });
  if (g) { fail(res, 402, g); return false; }
  return true;
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

route('POST', '/api/images', async (req, res, p, user) => {
  if (!mediaGuard(res, 'image', user)) return;
  const body = await readJsonBody(req);
  if (!body.prompt) return fail(res, 400, 'Décrivez l’image à créer.');
  const t0 = Date.now();
  try {
    const r = await upstream('/v1/images/generations', { method: 'POST', timeoutMs: 180000,
      json: { model: body.model || 'auto', prompt: String(body.prompt), n: Math.min(Number(body.n) || 1, 4), size: body.size || '1024x1024', response_format: 'b64_json' } });
    if (!r.ok) throw new UpstreamError(await errorText(r), r.status);
    const j = await r.json();
    const saved = [];
    for (const [i, img] of (j.data || []).entries()) {
      let buf;
      if (img.b64_json) buf = Buffer.from(img.b64_json, 'base64');
      else if (img.url) { const ir = await fetch(img.url); if (ir.ok) buf = Buffer.from(await ir.arrayBuffer()); }
      if (!buf) continue;
      const type = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : buf.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : 'image/png';
      const f = await saveBuffer(user, { buffer: buf, name: `image-ia-${stamp()}-${i + 1}.${type.split('/')[1].replace('jpeg', 'jpg')}`, type, projectId: body.projectId, source: 'image-ia' });
      saved.push(updateFileMeta(user.id, f.id, { prompt: String(body.prompt).slice(0, 500), model: `${j.provider || ''}/${j.model || ''}` }));
    }
    record({ uid: user.id, kind: 'image', model: j.model, platform: j.provider, ms: Date.now() - t0 });
    ok(res, { files: saved, provider: j.provider, model: j.model });
  } catch (err) {
    record({ uid: user.id, kind: 'image', model: body.model || 'auto', ok: false, err: err.message, ms: Date.now() - t0 });
    fail(res, err.status || 502, err.message);
  }
});

route('POST', '/api/videos', async (req, res, p, user) => {
  if (!mediaGuard(res, 'video', user)) return;
  const body = await readJsonBody(req);
  if (!body.prompt) return fail(res, 400, 'Décrivez la vidéo à créer.');
  const t0 = Date.now();
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(new Error('client parti')); });
  try {
    const json = { model: body.model || 'auto', prompt: String(body.prompt) };
    if (body.duration) json.duration = Math.max(1, Math.min(Number(body.duration), 10));
    if (body.aspect_ratio === '9:16' || body.aspect_ratio === '16:9') json.aspect_ratio = body.aspect_ratio;
    if (body.imageFileId && getFileMeta(user.id, body.imageFileId)) json.image = publicLink(req, user.id, body.imageFileId, 1800);
    const r = await upstream('/v1/videos/generations', { method: 'POST', json, timeoutMs: 330000, signal: ctrl.signal });
    if (!r.ok) throw new UpstreamError(await errorText(r), r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const provider = r.headers.get('x-provider') || '', model = r.headers.get('x-model') || '';
    const vtype = (r.headers.get('content-type') || 'video/mp4').split(';')[0];
    const vext = vtype.includes('webm') ? 'webm' : vtype.includes('quicktime') ? 'mov' : 'mp4';
    const meta = await saveBuffer(user, { buffer: buf, name: `video-ia-${stamp()}.${vext}`, type: vtype, projectId: body.projectId, source: 'video-ia' });
    updateFileMeta(user.id, meta.id, { prompt: String(body.prompt).slice(0, 500), model: `${provider}/${model}` });
    record({ uid: user.id, kind: 'video', model, platform: provider, ms: Date.now() - t0 });
    ok(res, { file: meta, provider, model });
  } catch (err) {
    record({ uid: user.id, kind: 'video', model: body.model || 'auto', ok: false, err: err.message, ms: Date.now() - t0 });
    if (!res.writableEnded && !res.destroyed) fail(res, err.status || 502, err.message);
  }
});

route('POST', '/api/speech', async (req, res, p, user) => {
  if (!mediaGuard(res, 'speech', user)) return;
  const body = await readJsonBody(req);
  if (!body.input) return fail(res, 400, 'Texte vide.');
  const t0 = Date.now();
  try {
    const r = await upstream('/v1/audio/speech', { method: 'POST', timeoutMs: 120000,
      json: { model: body.model || 'auto', input: String(body.input).slice(0, 4000), voice: body.voice || getSettings().ttsVoice, response_format: 'mp3' } });
    if (!r.ok) throw new UpstreamError(await errorText(r), r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const provider = r.headers.get('x-provider') || '';
    const ctype = r.headers.get('content-type') || 'audio/mpeg';
    record({ uid: user.id, kind: 'speech', model: body.model || 'auto', platform: provider, ms: Date.now() - t0 });
    if (body.save) {
      const meta = await saveBuffer(user, { buffer: buf, name: `voix-ia-${stamp()}.${ctype.includes('wav') ? 'wav' : 'mp3'}`, type: ctype, projectId: body.projectId, source: 'voix-ia' });
      return ok(res, { file: meta, provider });
    }
    send(res, 200, buf, ctype, { 'X-Provider': provider });
  } catch (err) {
    record({ uid: user.id, kind: 'speech', model: body.model || 'auto', ok: false, err: err.message, ms: Date.now() - t0 });
    fail(res, err.status || 502, err.message);
  }
});

route('POST', '/api/transcribe', async (req, res, p, user) => {
  // Transcription : OVH en direct (Whisper, accès anonyme) si disponible, sinon passerelle (si autorisée).
  const ovhList = (await listOvhModels()).list || [];
  const exact = new URL(req.url, 'http://x').searchParams.get('exact') === '1';
  // Mode « exact » : le Whisper le plus précis (large-v3 complet, pas la version turbo).
  const whisper = platformAllowed('ovh')
    ? ((exact && ovhList.find(m => /whisper-large-v3$/i.test(m))) || ovhList.find(m => /whisper/i.test(m)))
    : null;
  if (!mediaGuard(res, 'transcription', user, !whisper)) return;
  const t0 = Date.now();
  try {
    const u = new URL(req.url, 'http://x');
    let audio, type, name;
    const fileId = u.searchParams.get('fileId');
    if (fileId) {
      const meta = getFileMeta(user.id, fileId);
      if (!meta) return fail(res, 404, 'Fichier introuvable');
      if (meta.size > 24 * 1024 * 1024) return fail(res, 413, 'Fichier trop long pour la transcription (24 Mo max). Découpez-le dans Enregistrement audio.');
      audio = fs.readFileSync(filePath(user.id, fileId)); type = meta.type; name = meta.name;
    } else {
      audio = await readBody(req, 24 * 1024 * 1024);
      type = (req.headers['content-type'] || 'audio/webm').split(';')[0];
      name = `audio.${type.split('/')[1] || 'webm'}`.replace('mpeg', 'mp3').replace('x-wav', 'wav').replace('x-m4a', 'm4a').replace('mp4', 'm4a').replace('x-flac', 'flac');
    }
    if (!audio.length) return fail(res, 400, 'Audio vide.');
    const boundary = '----studio' + crypto.randomBytes(8).toString('hex');
    const field = (k, v) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    let head = field('model', exact ? 'whisper-large-v3' : 'auto');
    const lang = u.searchParams.get('lang');
    if (lang && /^[a-z]{2}$/.test(lang)) head += field('language', lang);
    if (exact) head += field('temperature', '0');
    // Paroles connues : elles guident Whisper vers les bons mots.
    const hint = String(u.searchParams.get('prompt') || '').replace(/[\r\n]+/g, ' ').slice(0, 900);
    if (hint) head += field('prompt', hint);
    head += field('response_format', u.searchParams.get('format') === 'verbose_json' ? 'verbose_json' : 'json');
    head += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name.replace(/["\r\n]/g, '')}"\r\nContent-Type: ${type}\r\n\r\n`;
    const multipart = Buffer.concat([Buffer.from(head), audio, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    let r;
    if (whisper) {
      const slot = ovhSlot(whisper);
      if (!slot.ok) return fail(res, 429, `Capacité gratuite d’OVH pour la transcription momentanément atteinte. Réessayez dans ${slot.retryIn} s.`);
      ovhTake(whisper);
      const mp = Buffer.from(multipart.toString('latin1').replace(/name="model"\r\n\r\n[^\r]*/, `name="model"\r\n\r\n${whisper}`), 'latin1');
      r = await fetch(`${OVH_BASE}/audio/transcriptions`, { method: 'POST', body: mp, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, signal: AbortSignal.timeout(180000) });
      if (r.status === 429) ovhCooldown(whisper, 60);
    } else {
      r = await upstream('/v1/audio/transcriptions', { method: 'POST', body: multipart, timeoutMs: 180000, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
    }
    if (!r.ok) throw new UpstreamError(await errorText(r), r.status);
    const j = await r.json();
    const provider = whisper ? 'ovh' : (r.headers.get('x-provider') || '');
    record({ uid: user.id, kind: 'transcription', model: whisper || r.headers.get('x-model') || 'auto', platform: provider, ms: Date.now() - t0 });
    ok(res, { text: j.text || '', segments: j.segments || null, language: j.language || null, provider });
  } catch (err) {
    record({ uid: user.id, kind: 'transcription', model: 'auto', ok: false, err: err.message, ms: Date.now() - t0 });
    fail(res, err.status || 502, err.message);
  }
});

// --- Projets ---
route('GET', '/api/projects', (req, res, p, user) => ok(res, getProjects(user.id)));
route('POST', '/api/projects', async (req, res, p, user) => {
  const b = await readJsonBody(req);
  if (!b.name) return fail(res, 400, 'Nom requis.');
  const list = getProjects(user.id);
  if (list.length >= 50) return fail(res, 400, '50 projets maximum.');
  const now = new Date().toISOString();
  const pr = { id: newId('p'), name: String(b.name).slice(0, 60), icon: String(b.icon || '📁').slice(0, 8), color: String(b.color || '#475569').slice(0, 20), instructions: String(b.instructions || '').slice(0, 20000), memory: '', createdAt: now, updatedAt: now };
  list.push(pr); saveProjects(user.id, list); ok(res, pr);
});
route('PUT', '/api/projects/:id', async (req, res, { id }, user) => {
  const b = await readJsonBody(req);
  const list = getProjects(user.id);
  const pr = list.find(x => x.id === id);
  if (!pr) return fail(res, 404, 'Projet introuvable');
  for (const k of ['name', 'icon', 'color', 'instructions', 'memory']) if (typeof b[k] === 'string') pr[k] = b[k].slice(0, k === 'memory' || k === 'instructions' ? 20000 : 80);
  pr.updatedAt = new Date().toISOString();
  saveProjects(user.id, list); ok(res, pr);
});
route('POST', '/api/projects/:id/memory', async (req, res, { id }, user) => {
  const { note } = await readJsonBody(req);
  const list = getProjects(user.id);
  const pr = list.find(x => x.id === id);
  if (!pr) return fail(res, 404, 'Projet introuvable');
  pr.memory = ((pr.memory ? pr.memory + '\n' : '') + `- [${new Date().toLocaleDateString('fr-FR')}] ${String(note || '').trim().slice(0, 2000)}`).slice(-20000);
  pr.updatedAt = new Date().toISOString();
  saveProjects(user.id, list); ok(res, pr);
});
route('DELETE', '/api/projects/:id', (req, res, { id }, user) => {
  const list = getProjects(user.id);
  if (list.length <= 1) return fail(res, 400, 'Gardez au moins un projet.');
  if (listConversations(user.id, id).length || listFiles(user.id, id).length) return fail(res, 409, 'Ce projet contient des conversations ou des fichiers : supprimez-les d’abord (aucune donnée n’est effacée automatiquement).');
  saveProjects(user.id, list.filter(x => x.id !== id)); ok(res, { ok: true });
});

// --- Conversations ---
route('GET', '/api/conversations', (req, res, p, user) => ok(res, listConversations(user.id, new URL(req.url, 'http://x').searchParams.get('project'))));
route('GET', '/api/conversations/:id', (req, res, { id }, user) => { const c = getConversation(user.id, id); c ? ok(res, c) : fail(res, 404, 'Conversation introuvable'); });
route('PUT', '/api/conversations/:id', async (req, res, { id }, user) => {
  const b = await readJsonBody(req, 40 * 1024 * 1024);
  const prev = getConversation(user.id, id);
  ok(res, saveConversation(user.id, { ...(prev || { createdAt: new Date().toISOString() }), ...b, id }));
});
route('DELETE', '/api/conversations/:id', (req, res, { id }, user) => { deleteConversation(user.id, id); ok(res, { ok: true }); });

// --- Fichiers ---
route('GET', '/api/files', (req, res, p, user) => {
  ok(res, { files: listFiles(user.id, new URL(req.url, 'http://x').searchParams.get('project')), used: storageUsed(user.id), quota: userQuotaBytes(user) });
});
route('POST', '/api/files', async (req, res, p, user) => {
  const u = new URL(req.url, 'http://x');
  const name = cleanName(u.searchParams.get('name'));
  const type = (req.headers['content-type'] || 'application/octet-stream').split(';')[0];
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_UPLOAD) return fail(res, 413, 'Fichier trop volumineux (300 Mo max).');
  const q = quotaCheck(user, declared);
  if (q) return fail(res, 507, q);
  const id = newId('f');
  const fp = filePath(user.id, id);
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
  const pid = u.searchParams.get('project');
  const meta = { id, projectId: pid && getProject(user.id, pid) ? pid : getProjects(user.id)[0].id, name, type, size, source: u.searchParams.get('source') || 'import', createdAt: new Date().toISOString() };
  if (u.searchParams.get('note')) meta.note = String(u.searchParams.get('note')).slice(0, 300);
  addFileMeta(user.id, meta);
  ok(res, meta);
});
route('GET', '/api/files/:id', (req, res, { id }, user) => {
  const meta = getFileMeta(user.id, id);
  if (!meta) return fail(res, 404, 'Fichier introuvable');
  streamFile(req, res, user.id, meta, new URL(req.url, 'http://x').searchParams.has('download'));
});
route('PUT', '/api/files/:id', async (req, res, { id }, user) => {
  const b = await readJsonBody(req);
  const patch = {};
  if (b.name) patch.name = cleanName(b.name);
  if (b.projectId && getProject(user.id, b.projectId)) patch.projectId = b.projectId;
  if (typeof b.note === 'string') patch.note = b.note.slice(0, 300);
  const f = updateFileMeta(user.id, id, patch);
  f ? ok(res, f) : fail(res, 404, 'Fichier introuvable');
});
route('DELETE', '/api/files/:id', (req, res, { id }, user) => {
  if (!getFileMeta(user.id, id)) return fail(res, 404, 'Fichier introuvable');
  removeFile(user.id, id); ok(res, { ok: true });
});

// --- Suivi et réglages ---
let upstreamUsageCache = { t: 0, data: null };
async function gatewayUsage(force = false) {
  if (!isConfigured()) return null;
  if (force || Date.now() - upstreamUsageCache.t > 60_000) {
    try {
      const r = await upstream('/v1/usage', { timeoutMs: 15000 });
      upstreamUsageCache = { t: Date.now(), data: r.ok ? await r.json() : { error: await errorText(r) } };
    } catch (err) { upstreamUsageCache = { t: Date.now(), data: { error: err.message } }; }
  }
  return upstreamUsageCache.data;
}

function poolAlerts(snap) {
  const out = [];
  const used = snap.consumed + snap.reserved;
  const pct = snap.pool ? (used / snap.pool) * 100 : 100;
  if (pct >= 100) out.push({ level: 'danger', message: 'Pool mensuel épuisé : toutes les requêtes de chat sont bloquées jusqu’au 1er du mois.' });
  else if (pct >= 90) out.push({ level: 'danger', message: `Pool mensuel utilisé à ${pct.toFixed(1)} % : épuisement imminent.` });
  else if (pct >= 80) out.push({ level: 'warning', message: `Pool mensuel utilisé à ${pct.toFixed(1)} %.` });
  for (const [uid, u] of Object.entries(snap.users)) {
    if (u.quota && u.consumed + u.reserved >= u.quota * 0.9) {
      const usr = getUser(uid);
      out.push({ level: u.consumed >= u.quota ? 'danger' : 'warning', message: `${usr?.name || uid} a utilisé ${Math.round(((u.consumed + u.reserved) / u.quota) * 100)} % de son quota mensuel.` });
    }
  }
  return out;
}

function costBreakdown(history) {
  const by = {};
  for (const h of history) {
    if (!h.tok) continue;
    const key = h.platform || h.provider || 'inconnu';
    by[key] ||= { platform: key, tokens: 0 };
    by[key].tokens += h.tok;
  }
  return Object.values(by).map(x => { const eur = costOf(x.platform, x.tokens); return { ...x, eur, tariff: eur === null ? 'tarif non renseigné' : x.platform === 'ovh' ? 'gratuit (accès anonyme, aucune facturation possible)' : 'tarif renseigné' }; });
}

route('GET', '/api/usage', async (req, res, p, user) => {
  const isAdmin = user.role === 'admin';
  const users = getUsers();
  const snap = ledger.snapshot(users.map(u => u.id));
  const ops = summary(isAdmin ? 'all' : user.id);
  const st = getSettings();
  const names = Object.fromEntries(users.map(u => [u.id, u.name || u.username]));
  const monthHistory = snap.history.filter(h => (h.rm || h.t.slice(0, 7)) === snap.month);
  if (isAdmin) {
    ok(res, {
      role: 'admin',
      internal: {
        month: snap.month, resetsAt: snap.resetsAt, pool: snap.pool, exact: snap.exact, estimated: snap.estimated, consumed: snap.consumed,
        reserved: snap.reserved, remaining: snap.remaining, allocated: allocatedTokens(users), unallocated: Math.max(0, snap.pool - allocatedTokens(users)),
        today: snap.today, days: snap.days, openReservations: snap.openReservations,
      },
      users: users.map(u => ({ id: u.id, name: names[u.id], username: u.username, role: u.role, disabled: !!u.disabled, ...snap.users[u.id] })),
      history: snap.history.slice(0, 100).map(h => ({ ...h, name: names[h.u] || h.u })),
      costs: costBreakdown(monthHistory),
      alerts: [...poolAlerts(snap), ...ops.alerts],
      ops: { models: ops.models, errors: ops.errors, today: ops.today, month: ops.month },
      settings: st,
    });
  } else {
    const me = snap.users[user.id] || { quota: user.monthlyTokenQuota || 0, exact: 0, estimated: 0, consumed: 0, reserved: 0, remaining: user.monthlyTokenQuota || 0, today: 0 };
    ok(res, {
      role: 'member', month: snap.month, resetsAt: snap.resetsAt, me, days: snap.days,
      history: snap.history.filter(h => h.u === user.id).slice(0, 50),
      ops: { models: ops.models, errors: ops.errors },
      settings: { freeOnly: st.freeOnly },
    });
  }
});

// Capacité réellement confirmée chez les fournisseurs (séparée du quota interne)
route('GET', '/api/providers', async (req, res) => {
  const force = req.url.includes('refresh');
  const ovh = await listOvhModels(force);
  const g = await verifyGateway(force);
  const ops = summary('all');
  const recent429 = ops.errors.filter(e => /429/.test(e.err || '') || e.status === 429);
  let gatewayModels = null;
  try {
    const list = await listModels(force);
    gatewayModels = { total: list.filter(m => m.owned_by === 'freellmapi' && !m.id.startsWith('auto') && m.id !== 'fusion').length,
      ready: list.filter(m => m.execution_status === 'ready').length, exhausted: list.filter(m => m.execution_status === 'exhausted').length,
      needsKey: list.filter(m => m.execution_status === 'needsKey').length };
  } catch (err) { gatewayModels = { error: err.message }; }
  const chatModels = ovhChatModels(ovh.list || []);
  ok(res, {
    ovh: {
      facts: PROVIDER_FACTS.ovh, allowed: platformAllowed('ovh'),
      models: ovh.list || [], chatModels, listError: ovh.error, verifiedAt: ovh.verifiedAt || null,
      capacityNow: ovhCapacityNow(chatModels),
      excluded: ovhExcludedModels(ovh.list || []),
      real: (() => { const st = getSettings(); const snap = ledger.snapshot(getUsers().map(u => u.id));
        return ovhRealCapacity(chatModels, ops.models, { rpm: st.ovhRpmPerModel || 2, pool: st.poolMonthlyTokens, remaining: snap.remaining, dailyCap: st.dailyTokenCap || 0 }); })(),
      theoretical: {
        requestsPerMinute: chatModels.length * (getSettings().ovhRpmPerModel || 2),
        note: 'Maximum théorique (modèles de chat texte uniquement, Guard et VL exclus) pour TOUT le Studio (une seule adresse IP de serveur), si chaque modèle est utilisé au maximum. Non garanti : OVH indique pouvoir appliquer des limites plus strictes.',
      },
      monthlyQuota: 'quota fournisseur non communiqué',
      recent429: recent429.filter(e => e.platform === 'ovh').length,
    },
    freellmapi: {
      facts: PROVIDER_FACTS.freellmapi, configured: isConfigured(),
      verification: { ok: g.ok, error: g.error, verifiedAt: g.verifiedAt || null, models: g.ok ? Object.entries(g.models).map(([id, m]) => ({ id, platforms: m.platforms, allowed: m.platforms.every(p2 => platformAllowed(p2)) })) : [] },
      catalog: gatewayModels, usage: await gatewayUsage(force),
      monthlyQuota: 'quota fournisseur non communiqué',
    },
  });
}, { admin: true });

// Vérification réelle : appel OVH direct + appel via FreeLLMAPI comparé à /v1/usage
route('POST', '/api/verify-real', async (req, res, p, user) => {
  const b = await readJsonBody(req);
  const report = { at: new Date().toISOString(), steps: [] };
  const step = (name, data) => report.steps.push({ name, ...data });
  const question = [{ role: 'user', content: 'Réponds uniquement par le mot : bonjour' }];
  // 1) OVH direct (via le même chemin que les utilisateurs : réservation + débit)
  try {
    const before = ledger.snapshot([user.id]).users[user.id];
    const r = await chat({ uid: user.id, model: 'auto', messages: question, maxTokens: 300, src: 'verification' });
    const after = ledger.snapshot([user.id]).users[user.id];
    step('OVH direct', { ok: true, model: r.model, provider: r.provider, usageFournisseur: r.exact ? r.usage : null, exact: r.exact,
      debitRegistre: after.consumed - before.consumed, coherent: after.consumed - before.consumed === r.usage.total, reponse: r.content.slice(0, 80) });
  } catch (err) { step('OVH direct', { ok: false, error: err.message, status: err.status }); }
  // 2) Passerelle FreeLLMAPI : delta de /v1/usage comparé au champ usage de la réponse
  const g = await verifyGateway(true);
  const target = b.gatewayModel || 'gpt-oss-120b';
  const verified = g.ok && g.models[target]?.platforms?.every(x => platformAllowed(x));
  if (!isConfigured()) step('FreeLLMAPI', { ok: false, error: 'clé absente' });
  else if (!verified && b.confirmUnverified !== true) {
    step('FreeLLMAPI', { ok: false, skipped: true, error: `Non exécuté : fournisseurs de « ${target} » non vérifiables avant l’appel (${g.error || 'hors liste blanche'}). Relancez en confirmant explicitement.` });
  } else {
    try {
      const u0 = await gatewayUsage(true);
      const r = await upstream('/v1/chat/completions', { method: 'POST', timeoutMs: 120000, json: { model: target, messages: question, max_tokens: 300 } });
      const routed = decodeURIComponent(r.headers.get('x-routed-via') || '');
      const j = await r.json();
      await new Promise(x => setTimeout(x, 2500));
      const u1 = await gatewayUsage(true);
      const delta = u1 && u0 && !u0.error && !u1.error ? { requests: u1.requests - u0.requests, tokens: u1.tokens - u0.tokens } : null;
      step('FreeLLMAPI', { ok: r.ok, status: r.status, routedVia: routed, usageReponse: j.usage || null, deltaV1Usage: delta,
        coherent: delta && j.usage ? delta.tokens === j.usage.total_tokens : null, verifiedBeforeCall: !!verified, reponse: (j.choices?.[0]?.message?.content || j.error?.message || '').slice(0, 80) });
      record({ uid: user.id, kind: 'chat', model: target, platform: routed.split('/')[0], pt: j.usage?.prompt_tokens || 0, ct: j.usage?.completion_tokens || 0, src: 'verification-passerelle' });
    } catch (err) { step('FreeLLMAPI', { ok: false, error: err.message }); }
  }
  // 3) Faits fournisseur
  const ovh = await listOvhModels(true);
  step('Capacité OVH', { modeles: ovh.list, erreur: ovh.error, limites: PROVIDER_FACTS.ovh.limits.map(l => l.text), quotaMensuel: 'quota fournisseur non communiqué' });
  try { fs.appendFileSync(path.join(DATA_DIR, 'verifications.jsonl'), JSON.stringify(report) + '\n'); } catch {}
  ok(res, report);
}, { admin: true });

route('GET', '/api/settings', (req, res) => ok(res, getSettings()), { admin: true });
route('PUT', '/api/settings', async (req, res) => {
  const b = await readJsonBody(req);
  const patch = {};
  for (const k of ['freeOnly', 'allowPaid']) if (typeof b[k] === 'boolean') patch[k] = b[k];
  for (const k of ['dailyTokenCap', 'dailyMediaCap', 'storageQuotaMB', 'maxOutputTokens', 'ovhRpmPerModel']) {
    if (b[k] !== undefined) { const n = Math.max(0, Math.floor(Number(b[k]) || 0)); patch[k] = k === 'storageQuotaMB' ? Math.min(Math.max(n, 50), 9000) : k === 'maxOutputTokens' ? Math.min(Math.max(n, 256), 32000) : k === 'ovhRpmPerModel' ? Math.min(Math.max(n, 1), 400) : n; }
  }
  if (b.poolMonthlyTokens !== undefined) {
    const n = Math.max(0, Math.floor(Number(b.poolMonthlyTokens) || 0));
    const alloc = allocatedTokens();
    if (n < alloc) return fail(res, 400, `Le pool ne peut pas être inférieur à la somme des quotas déjà attribués (${alloc.toLocaleString('fr-FR')}). Réduisez d’abord des quotas.`);
    patch.poolMonthlyTokens = n;
  }
  if (typeof b.gatewayMediaAllowed === 'boolean') patch.gatewayMediaAllowed = b.gatewayMediaAllowed;
  if (Array.isArray(b.allowedPlatforms)) patch.allowedPlatforms = b.allowedPlatforms.map(x => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 50);
  if (Array.isArray(b.paidPlatforms)) patch.paidPlatforms = b.paidPlatforms.map(x => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 50);
  if (typeof b.defaultModel === 'string') patch.defaultModel = b.defaultModel.slice(0, 120);
  if (typeof b.ttsVoice === 'string') patch.ttsVoice = b.ttsVoice.slice(0, 40);
  if (b.prices && typeof b.prices === 'object') patch.prices = Object.fromEntries(Object.entries(b.prices).filter(([, v]) => v !== '' && v !== null && Number.isFinite(Number(v))).map(([k, v]) => [String(k).toLowerCase(), Math.max(0, Number(v))]));
  if (patch.freeOnly === true) patch.allowPaid = false;
  ok(res, saveSettings(patch));
}, { admin: true });
route('POST', '/api/settings/reset', (req, res) => {
  if (allocatedTokens() > DEFAULT_SETTINGS.poolMonthlyTokens) return fail(res, 400, 'Réduisez d’abord les quotas attribués : ils dépassent le pool par défaut.');
  ok(res, saveSettings({ ...DEFAULT_SETTINGS }));
}, { admin: true });

route('GET', '/api/export', (req, res, p, user) => {
  const conversations = listConversations(user.id).map(c => getConversation(user.id, c.id)).filter(Boolean);
  send(res, 200, JSON.stringify({ exportedAt: new Date().toISOString(), user: publicUser(user), projects: getProjects(user.id), conversations, files: listFiles(user.id) }, null, 1),
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
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (req.method === 'GET' && pathname.startsWith('/pub/')) {
    const [, , uid, id, exp, sig] = pathname.split('/');
    let meta = null;
    try { meta = uid && id && getFileMeta(uid, id); } catch {}
    if (!meta || !exp || Number(exp) < Date.now() / 1000 || !sig || sig.length !== 32 ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(signLink(uid, id, exp)))) return fail(res, 403, 'Lien expiré ou invalide');
    return streamFile(req, res, uid, meta);
  }
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const user = currentUser(req);
    if (!r.public && !user) return fail(res, 401, 'Connexion requise.');
    if (r.admin && user.role !== 'admin') return fail(res, 403, 'Réservé à l’administrateur.');
    if (req.method !== 'GET' && req.headers['x-studio'] !== '1') return fail(res, 403, 'Requête refusée.');
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try { await r.handler(req, res, params, user); }
    catch (err) {
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
  const admin = getUsers().find(u => u.role === 'admin');
  console.log(`Studio IA prêt sur le port ${PORT} — FreeLLMAPI : ${API_BASE} (${isConfigured() ? 'clé présente' : 'CLÉ MANQUANTE'}) — ${getUsers().length} compte(s), administrateur « ${admin?.username} »`);
  if (admin && !admin.passwordHash && !process.env.STUDIO_PASSWORD) console.log('ATTENTION : aucun mot de passe administrateur (STUDIO_PASSWORD).');
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); process.exit(0); });

// Stockage sur disque (fichiers JSON écrits de façon atomique), séparé par utilisateur :
// data/users.json (comptes) et data/users/<id>/ (projets, conversations, fichiers de chacun).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

export function readJson(rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), 'utf8'));
  } catch {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

export function writeJson(rel, value) {
  const file = path.join(DATA_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

function safeId(id) {
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(id))) throw Object.assign(new Error('Identifiant invalide'), { status: 400 });
  return id;
}
const U = (uid) => `users/${safeId(uid)}`;

export function ensureDirs() {
  fs.mkdirSync(path.join(DATA_DIR, 'usage'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'users'), { recursive: true });
}
export function ensureUserDirs(uid) {
  for (const d of ['conversations', 'files']) fs.mkdirSync(path.join(DATA_DIR, U(uid), d), { recursive: true });
}

// ---------- Réglages globaux (administrateur) ----------
export const DEFAULT_SETTINGS = {
  freeOnly: true,               // mode gratuit : seuls les fournisseurs de la liste blanche, vérifiés AVANT l'appel
  allowPaid: false,             // aucun fournisseur payant, jamais automatiquement
  allowedPlatforms: ['ovh'],    // liste blanche (OVH AI Endpoints en accès anonyme)
  paidPlatforms: ['openai', 'anthropic', 'deepseek', 'custom', 'together', 'fireworks', 'deepinfra', 'replicate', 'xai'],
  poolMonthlyTokens: 10000000,  // pool INTERNE du Studio, partagé par tous les comptes (≠ quota fournisseur)
  dailyTokenCap: 500000,        // limite interne globale par jour (0 = aucune)
  maxOutputTokens: 4096,        // plafond de sortie envoyé au fournisseur (max_tokens) = base de la réservation
  ovhRpmPerModel: 2,            // limite OVH anonyme documentée : 2 requêtes/min, par IP et par modèle
  gatewayMediaAllowed: false,   // images/vidéos/voix via FreeLLMAPI : fournisseur inconnu avant l'appel → bloqué par défaut
  dailyMediaCap: 40,            // plafond global de générations média par jour
  storageQuotaMB: 800,          // quota global des fichiers
  defaultModel: 'auto',
  ttsVoice: 'alloy',
  // Tarifs en € par million de tokens, saisis par l'administrateur. Absent = « tarif non renseigné »
  // (jamais interprété comme gratuit). Seul OVH anonyme est gratuit par construction (aucun compte).
  prices: {},
};
let settingsCache = null;
export function getSettings() {
  if (!settingsCache) settingsCache = { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) };
  return settingsCache;
}
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  settingsCache = next;
  writeJson('settings.json', next);
  return next;
}

// ---------- Comptes ----------
export const DEFAULT_USER_LIMITS = { monthlyTokenQuota: 500000, dailyTokenCap: 0, dailyMediaCap: 10, storageQuotaMB: 200 };
export const ADMIN_DEFAULT_QUOTA = 2000000;
export function getUsers() { return readJson('users.json', []); }
export const allocatedTokens = (users = getUsers(), exceptId = null) => users.filter(u => !u.disabled && u.id !== exceptId).reduce((s, u) => s + (u.monthlyTokenQuota || 0), 0);
/** Attribue un quota mensuel aux comptes qui n'en ont pas encore, sans jamais dépasser le pool. */
export function migrateQuotas(pool) {
  const users = getUsers();
  let changed = false;
  const ordered = [...users].sort((a, b) => (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1));
  for (const u of ordered) {
    if (u.monthlyTokenQuota !== undefined) continue;
    const free = Math.max(0, pool - allocatedTokens(users, u.id));
    u.monthlyTokenQuota = Math.min(u.role === 'admin' ? ADMIN_DEFAULT_QUOTA : DEFAULT_USER_LIMITS.monthlyTokenQuota, free);
    changed = true;
  }
  if (changed) saveUsers(users);
}
export function saveUsers(list) { writeJson('users.json', list); }
export function getUser(id) { return getUsers().find(u => u.id === id) || null; }
export function findUserByName(name) {
  const n = String(name || '').trim().toLowerCase();
  return getUsers().find(u => u.username.toLowerCase() === n) || null;
}
export const publicUser = (u) => u && ({
  id: u.id, username: u.username, name: u.name || u.username, role: u.role, disabled: !!u.disabled,
  dailyTokenCap: u.dailyTokenCap ?? null, dailyMediaCap: u.dailyMediaCap ?? null, storageQuotaMB: u.storageQuotaMB ?? null,
  createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, mustChangePassword: !!u.mustChangePassword, monthlyTokenQuota: u.monthlyTokenQuota ?? 0,
});

// ---------- Projets ----------
const DEFAULT_PROJECTS = [
  { id: 'discussions', name: 'Discussions', icon: '💬', color: '#2563eb',
    instructions: 'Tu es un assistant personnel polyvalent, sympathique et direct. Réponds en français, clairement et simplement, avec des exemples concrets.' },
  { id: 'musique', name: 'Musique', icon: '🎵', color: '#db2777',
    instructions: "Tu es un directeur artistique et parolier francophone (rap, refrains, toplines). Tu aides à écrire des paroles, structurer des morceaux (intro, couplets, refrain, pont), choisir BPM, tonalité et ambiance, et préparer l'enregistrement et le mixage. Réponds en français." },
  { id: 'clips', name: 'Clips', icon: '🎬', color: '#7c3aed',
    instructions: 'Tu es un réalisateur et monteur de clips. Tu aides à écrire des scénarios, des découpages plan par plan, des sous-titres, et à organiser les photos et vidéos pour un montage rythmé sur la musique. Réponds en français.' },
  { id: 'perso', name: 'Idées & perso', icon: '📁', color: '#059669',
    instructions: 'Tu aides à organiser des idées, des recherches et des documents personnels. Réponds en français, de façon claire et structurée.' },
];

export function getProjects(uid) {
  let list = readJson(`${U(uid)}/projects.json`, null);
  if (!list) {
    const now = new Date().toISOString();
    list = DEFAULT_PROJECTS.map(p => ({ ...p, memory: '', createdAt: now, updatedAt: now }));
    ensureUserDirs(uid);
    writeJson(`${U(uid)}/projects.json`, list);
  }
  return list;
}
export function saveProjects(uid, list) { writeJson(`${U(uid)}/projects.json`, list); }
export function getProject(uid, id) { return getProjects(uid).find(p => p.id === id) || null; }

// ---------- Conversations ----------
export function listConversations(uid, projectId) {
  return readJson(`${U(uid)}/conversations/index.json`, [])
    .filter(c => !projectId || c.projectId === projectId)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
export function getConversation(uid, id) {
  return readJson(`${U(uid)}/conversations/${safeId(id)}.json`, null);
}
export function saveConversation(uid, conv) {
  safeId(conv.id);
  conv.updatedAt = new Date().toISOString();
  writeJson(`${U(uid)}/conversations/${conv.id}.json`, conv);
  const idx = readJson(`${U(uid)}/conversations/index.json`, []).filter(c => c.id !== conv.id);
  idx.push({
    id: conv.id, projectId: conv.projectId, title: conv.title || 'Sans titre', mode: conv.mode || 'chat',
    model: conv.model || '', messages: (conv.messages || []).length, updatedAt: conv.updatedAt,
  });
  writeJson(`${U(uid)}/conversations/index.json`, idx);
  return conv;
}
export function deleteConversation(uid, id) {
  safeId(id);
  try { fs.unlinkSync(path.join(DATA_DIR, U(uid), 'conversations', `${id}.json`)); } catch {}
  writeJson(`${U(uid)}/conversations/index.json`, readJson(`${U(uid)}/conversations/index.json`, []).filter(c => c.id !== id));
}

// ---------- Fichiers ----------
export function listFiles(uid, projectId) {
  return readJson(`${U(uid)}/files/index.json`, [])
    .filter(f => !projectId || f.projectId === projectId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export function getFileMeta(uid, id) {
  safeId(id);
  return readJson(`${U(uid)}/files/index.json`, []).find(f => f.id === id) || null;
}
export function filePath(uid, id) { return path.join(DATA_DIR, U(uid), 'files', safeId(id)); }
export function addFileMeta(uid, meta) {
  const idx = readJson(`${U(uid)}/files/index.json`, []);
  idx.push(meta);
  writeJson(`${U(uid)}/files/index.json`, idx);
}
export function updateFileMeta(uid, id, patch) {
  const idx = readJson(`${U(uid)}/files/index.json`, []);
  const f = idx.find(x => x.id === id);
  if (!f) return null;
  Object.assign(f, patch);
  writeJson(`${U(uid)}/files/index.json`, idx);
  return f;
}
export function removeFile(uid, id) {
  try { fs.unlinkSync(filePath(uid, id)); } catch {}
  writeJson(`${U(uid)}/files/index.json`, readJson(`${U(uid)}/files/index.json`, []).filter(f => f.id !== id));
}
export function storageUsed(uid) {
  return readJson(`${U(uid)}/files/index.json`, []).reduce((s, f) => s + (f.size || 0), 0);
}
export function storageUsedAll() {
  return getUsers().reduce((s, u) => s + storageUsed(u.id), 0);
}

/** Reprise des données de la version mono-utilisateur + retrait du projet « Prix Malin » s'il est vide. */
export function migrateLegacy(adminId) {
  const root = DATA_DIR;
  const dest = path.join(root, U(adminId));
  if (fs.existsSync(path.join(root, 'projects.json')) && !fs.existsSync(path.join(dest, 'projects.json'))) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of ['projects.json', 'conversations', 'files']) {
      const from = path.join(root, name);
      if (fs.existsSync(from)) fs.renameSync(from, path.join(dest, name));
    }
    console.log('Données existantes rattachées au compte administrateur.');
  }
  ensureUserDirs(adminId);
  const list = readJson(`${U(adminId)}/projects.json`, null);
  if (list?.some(p => p.id === 'prix-malin')) {
    const used = listConversations(adminId, 'prix-malin').length || listFiles(adminId, 'prix-malin').length;
    if (!used) {
      const next = list.filter(p => p.id !== 'prix-malin');
      if (!next.some(p => p.id === 'discussions')) next.unshift({ ...DEFAULT_PROJECTS[0], memory: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      saveProjects(adminId, next);
    }
  }
}

// Stockage simple sur disque (fichiers JSON écrits de façon atomique).
// Un seul utilisateur : pas besoin de base de données, et zéro dépendance.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');

export function ensureDirs() {
  for (const d of ['', 'conversations', 'files', 'usage']) {
    fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });
  }
}

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
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

// ---------- Réglages ----------
export const DEFAULT_SETTINGS = {
  freeOnly: true,               // mode gratuit : bloque tout fournisseur marqué payant
  allowPaid: false,             // autorisation explicite des services payants
  paidPlatforms: ['openai', 'anthropic', 'deepseek', 'custom', 'together', 'fireworks', 'deepinfra', 'replicate', 'xai'],
  dailyTokenCap: 500000,        // plafond de tokens par jour (0 = pas de plafond)
  monthlyTokenCap: 10000000,    // plafond de tokens par mois
  dailyMediaCap: 40,            // plafond de générations média (image/vidéo/voix) par jour
  storageQuotaMB: 800,          // quota des fichiers du Studio
  defaultModel: 'auto',
  ttsVoice: 'alloy',
  prices: {},                   // { "plateforme": prix € par million de tokens } — vide = gratuit
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

// ---------- Projets ----------
const DEFAULT_PROJECTS = [
  {
    id: 'prix-malin', name: 'Prix Malin', icon: '💼', color: '#2563eb',
    instructions: "Tu es l'équipe technique et stratégique de Prix Malin : développement, recherche, programmation, analyse et automatisation. Réponds en français, de façon concrète, avec du code complet quand c'est utile. RÈGLE ABSOLUE : ne jamais proposer de modifier ou déployer quoi que ce soit en production sans l'accord explicite du propriétaire ; propose toujours un plan et attends sa validation.",
  },
  {
    id: 'musique', name: 'Musique', icon: '🎵', color: '#db2777',
    instructions: "Tu es un directeur artistique et parolier francophone (rap, refrains, toplines). Tu aides à écrire des paroles, structurer des morceaux (intro, couplets, refrain, pont), choisir BPM, tonalité et ambiance, et préparer l'enregistrement et le mixage. Réponds en français.",
  },
  {
    id: 'clips', name: 'Clips', icon: '🎬', color: '#7c3aed',
    instructions: "Tu es un réalisateur et monteur de clips. Tu aides à écrire des scénarios, des découpages plan par plan, des sous-titres, et à organiser les photos et vidéos pour un montage rythmé sur la musique. Réponds en français.",
  },
  {
    id: 'perso', name: 'Projets personnels', icon: '📁', color: '#059669',
    instructions: 'Tu es un assistant personnel polyvalent : documents, recherches, idées, organisation. Réponds en français, clairement et simplement.',
  },
];

export function getProjects() {
  let list = readJson('projects.json', null);
  if (!list) {
    const now = new Date().toISOString();
    list = DEFAULT_PROJECTS.map(p => ({ ...p, memory: '', createdAt: now, updatedAt: now }));
    writeJson('projects.json', list);
  }
  return list;
}
export function saveProjects(list) { writeJson('projects.json', list); }
export function getProject(id) { return getProjects().find(p => p.id === id) || null; }

// ---------- Conversations ----------
export function listConversations(projectId) {
  const idx = readJson('conversations/index.json', []);
  return idx
    .filter(c => !projectId || c.projectId === projectId)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
function safeId(id) {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw Object.assign(new Error('Identifiant invalide'), { status: 400 });
  return id;
}
export function getConversation(id) {
  return readJson(`conversations/${safeId(id)}.json`, null);
}
export function saveConversation(conv) {
  safeId(conv.id);
  conv.updatedAt = new Date().toISOString();
  writeJson(`conversations/${conv.id}.json`, conv);
  const idx = readJson('conversations/index.json', []).filter(c => c.id !== conv.id);
  idx.push({
    id: conv.id, projectId: conv.projectId, title: conv.title || 'Sans titre', mode: conv.mode || 'chat',
    model: conv.model || '', messages: (conv.messages || []).length, updatedAt: conv.updatedAt,
  });
  writeJson('conversations/index.json', idx);
  return conv;
}
export function deleteConversation(id) {
  safeId(id);
  try { fs.unlinkSync(path.join(DATA_DIR, 'conversations', `${id}.json`)); } catch {}
  writeJson('conversations/index.json', readJson('conversations/index.json', []).filter(c => c.id !== id));
}

// ---------- Fichiers ----------
export function listFiles(projectId) {
  const idx = readJson('files/index.json', []);
  return idx
    .filter(f => !projectId || f.projectId === projectId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export function getFileMeta(id) {
  safeId(id);
  return readJson('files/index.json', []).find(f => f.id === id) || null;
}
export function filePath(id) { return path.join(DATA_DIR, 'files', safeId(id)); }
export function addFileMeta(meta) {
  const idx = readJson('files/index.json', []);
  idx.push(meta);
  writeJson('files/index.json', idx);
}
export function updateFileMeta(id, patch) {
  const idx = readJson('files/index.json', []);
  const f = idx.find(x => x.id === id);
  if (!f) return null;
  Object.assign(f, patch);
  writeJson('files/index.json', idx);
  return f;
}
export function removeFile(id) {
  try { fs.unlinkSync(filePath(id)); } catch {}
  writeJson('files/index.json', readJson('files/index.json', []).filter(f => f.id !== id));
}
export function storageUsed() {
  return readJson('files/index.json', []).reduce((s, f) => s + (f.size || 0), 0);
}

import { api, state, h, toastErr, currentProject } from './lib/core.js';

const VIEWS = [
  { id: 'accueil', label: 'ACCUEIL', title: 'Accueil', icon: '🏠', load: () => import('./views/home.js') },
  { id: 'parler', label: 'PARLER AUX IA', title: 'Parler aux IA', icon: '💬', load: () => import('./views/chat.js'), full: true },
  { id: 'agents', label: 'AGENTS', title: 'Agents', icon: '🤖', load: () => import('./views/agents.js') },
  { id: 'images', label: 'IMAGES', title: 'Images', icon: '🎨', load: () => import('./views/images.js') },
  { id: 'clips', label: 'VIDÉOS ET CLIPS', title: 'Vidéos et clips', icon: '🎬', load: () => import('./views/clips.js') },
  { id: 'musique', label: 'STUDIO MUSIQUE', title: 'Studio musique', icon: '🎹', load: () => import('./views/music.js') },
  { id: 'enregistrement', label: 'ENREGISTREMENT AUDIO', title: 'Enregistrement audio', icon: '🎙️', load: () => import('./views/record.js') },
  { id: 'projets', label: 'MES PROJETS', title: 'Mes projets', icon: '🗂️', load: () => import('./views/projects.js') },
  { id: 'fichiers', label: 'FICHIERS', title: 'Fichiers', icon: '📁', load: () => import('./views/files.js') },
  { id: 'tokens', label: 'SUIVI DES TOKENS', title: 'Suivi des tokens', icon: '📊', load: () => import('./views/usage.js') },
];

const $ = (id) => document.getElementById(id);
let cleanup = null;
let renderToken = 0;

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('studio.theme', t);
}
applyTheme(localStorage.getItem('studio.theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

function buildNav() {
  const nav = $('nav');
  nav.innerHTML = '';
  for (const v of VIEWS) nav.append(h('a', { href: `#/${v.id}`, 'data-id': v.id }, h('span.ic', v.icon), v.label));
}

export async function refreshProjects() {
  state.projects = await api('/api/projects');
  if (!state.projects.some(p => p.id === state.projectId)) state.projectId = state.projects[0]?.id;
  const sel = $('project-select');
  sel.innerHTML = '';
  for (const p of state.projects) sel.append(h('option', { value: p.id }, `${p.icon} ${p.name}`));
  sel.value = state.projectId;
  const p = currentProject();
  $('project-pill').textContent = `${p.icon || ''} ${p.name}`;
}

async function render() {
  const id = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'accueil';
  const view = VIEWS.find(v => v.id === id) || VIEWS[0];
  const token = ++renderToken;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.id === view.id));
  $('view-title').textContent = view.title;
  $('sidebar').classList.remove('open'); $('scrim').classList.remove('open');
  try { cleanup?.(); } catch {}
  cleanup = null;
  const el = $('view');
  el.className = 'view' + (view.full ? ' full' : '');
  el.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  try {
    const mod = await view.load();
    if (token !== renderToken) return;
    el.innerHTML = '';
    cleanup = (await mod.render(el, { params: new URLSearchParams(location.hash.split('?')[1] || '') })) || null;
  } catch (e) {
    console.error(e);
    el.innerHTML = '';
    el.append(h('div.notice.bad', `Impossible d'afficher cette section : ${e.message}`));
  }
}

async function showApp() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  buildNav();
  try { await refreshProjects(); } catch (e) { toastErr(e); }
  render();
}

function showLogin(msg = '') {
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('login-err').textContent = msg;
  $('login-pass').focus();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: { password: $('login-pass').value } });
    $('login-pass').value = '';
    showApp();
  } catch (err) { $('login-err').textContent = err.message; }
});
$('logout-btn').onclick = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); showLogin(); };
$('theme-btn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
$('menu-btn').onclick = () => { $('sidebar').classList.toggle('open'); $('scrim').classList.toggle('open'); };
$('scrim').onclick = () => { $('sidebar').classList.remove('open'); $('scrim').classList.remove('open'); };
$('project-select').onchange = (e) => {
  state.projectId = e.target.value;
  localStorage.setItem('studio.project', state.projectId);
  const p = currentProject();
  $('project-pill').textContent = `${p.icon || ''} ${p.name}`;
  window.dispatchEvent(new Event('studio:project'));
  render();
};
window.addEventListener('hashchange', render);
window.addEventListener('studio:logout', () => showLogin('Session expirée, reconnectez-vous.'));

(async () => {
  try {
    const me = await api('/api/me');
    if (me.authenticated) return showApp();
    showLogin(me.passwordConfigured ? '' : "Aucun mot de passe n'est configuré sur le serveur (STUDIO_PASSWORD).");
  } catch (e) { showLogin('Serveur injoignable : ' + e.message); }
})();

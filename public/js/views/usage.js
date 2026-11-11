import { api, h, state, toast, toastErr, fmtNum, fmtDate, fmtBytes, confirmBox, modal } from '../lib/core.js';

export async function render(el) {
  const [u, status] = await Promise.all([api('/api/usage'), api('/api/status').catch(() => null)]);
  const isAdmin = u.role === 'admin';
  const s = u.settings;
  const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const barCls = (p) => 'div.bar' + (p > 90 ? '.bad' : p > 70 ? '.warn' : '');
  const dPct = pct(u.today.tokens, s.dailyTokenCap), mPct = pct(u.month.tokens, s.monthlyTokenCap), medPct = pct(u.today.media, s.dailyMediaCap);
  const maxDay = Math.max(1, ...u.days.map(d => d.tokens));
  const table = (cols, rows) => h('div.table-wrap', h('table', h('tr', cols.map(c => h('th', c))), rows));

  const kpis = h('div.grid',
    h('div.card', h('h3', isAdmin ? '📅 Aujourd’hui (tout le monde)' : '📅 Ma consommation du jour'), h('div.kpi', fmtNum(u.today.tokens)),
      h('p.small.muted', `tokens · ${isAdmin ? 'plafond global' : 'ma limite'} ${s.dailyTokenCap ? fmtNum(s.dailyTokenCap) : 'aucune'}`), h(barCls(dPct), h('i', { style: { width: dPct + '%' } })),
      h('p.small.muted', `${u.today.requests} requêtes · ${u.today.errors} erreurs`)),
    h('div.card', h('h3', '🗓️ Ce mois'), h('div.kpi', fmtNum(u.month.tokens)),
      h('p.small.muted', isAdmin ? `tokens · plafond ${s.monthlyTokenCap ? fmtNum(s.monthlyTokenCap) : 'aucun'}` : 'tokens'), isAdmin ? h(barCls(mPct), h('i', { style: { width: mPct + '%' } })) : null,
      h('p.small.muted', `${u.month.requests} requêtes · ${u.month.errors} erreurs`)),
    h('div.card', h('h3', '🎨 Médias du jour'), h('div.kpi', u.today.media), h('p.small.muted', `images, vidéos, voix, transcriptions · limite ${s.dailyMediaCap || 'aucune'}`), h(barCls(medPct), h('i', { style: { width: medPct + '%' } }))),
    h('div.card', h('h3', '💶 Coût'), h('div.kpi', `${u.month.eur.toFixed(2)} €`), h('p.small.muted', 'ce mois-ci'),
      h('p.small', s.freeOnly ? h('span.ok-t', '🛡️ Mode gratuit actif : rien de payant.') : h('span.warn-t', '⚠️ Mode gratuit désactivé.'))),
  );
  const alerts = u.alerts?.length ? h('div.stack', u.alerts.map(a => h('div.notice' + (a.level === 'danger' ? '.bad' : '.warn'), `${fmtDate(a.t)} — ${a.message}`))) : null;
  const chart = h('div.card', h('h3', '📈 30 derniers jours (tokens)'),
    h('div.chart', u.days.map(d => h('div', { style: { height: Math.max(2, (d.tokens / maxDay) * 100) + '%', opacity: d.tokens ? 1 : 0.25 }, 'data-tip': `${d.day} : ${fmtNum(d.tokens)} tokens, ${d.requests} req.` }))),
    h('div.row.tiny.muted', h('span', u.days[0].day), h('span.grow'), h('span', u.days[u.days.length - 1].day)));
  const models = h('div.card', h('h3', '🧠 Modèles utilisés ce mois'), u.models.length ? table(['Modèle', 'Fournisseur', 'Type', 'Requêtes', 'Tokens', 'Erreurs', 'Latence moy.'],
    u.models.map(m => h('tr', h('td', m.model), h('td', m.platform), h('td', m.kind || 'chat'), h('td', m.requests), h('td', fmtNum(m.tokens)), h('td', m.errors ? h('span.bad-t', m.errors) : '0'), h('td', m.requests ? `${(m.ms / m.requests / 1000).toFixed(1)} s` : '—')))) : h('p.muted.small', 'Rien encore ce mois-ci.'));

  const fl = status?.freellmapi;
  const providers = h('div.card', h('h3', '🔌 Intelligences disponibles'),
    !fl ? h('p.muted', 'Statut indisponible.') : !fl.reachable ? h('p.bad-t', `Service IA injoignable : ${fl.error || 'clé manquante'}`) :
      h('div.stack',
        h('p.small.muted', `${fl.models.ready} modèles prêts · ${fl.models.exhausted} en pause (quota gratuit momentanément atteint) · ${fl.models.needsKey} sans clé`),
        table(['Fournisseur', 'Prêts', 'En pause'], fl.platforms.filter(p => p.ready || p.exhausted).map(p => h('tr',
          h('td', p.platform, s.paidPlatforms?.includes(p.platform) ? h('span.badge.bad', ' payant ?') : null), h('td', h('span.ok-t', p.ready || 0)), h('td', p.exhausted ? h('span.warn-t', p.exhausted) : '0')))),
        isAdmin ? h('details', h('summary.small', `Fournisseurs sans clé (${fl.platforms.filter(p => !p.ready && !p.exhausted).length})`),
          h('p.small.muted', fl.platforms.filter(p => !p.ready && !p.exhausted).map(p => p.platform).join(', ') || '—'),
          h('p.tiny.muted', 'Pour en ajouter : tableau de bord FreeLLMAPI → Keys, avec une clé GRATUITE (compte sans carte bancaire).')) : null));

  const errors = h('div.card', h('h3', '⚠️ Dernières erreurs'), u.errors.length ? table(['Quand', 'Type', 'Modèle', 'Fournisseur', 'Message'],
    u.errors.map(e => h('tr', h('td', fmtDate(e.t)), h('td', e.kind), h('td', e.model), h('td', e.platform || '—'), h('td.small', e.err || '')))) : h('p.muted.small', 'Aucune erreur récente. 👍'));

  const security = h('div.card.stack', h('h3', '🔑 Mon compte'), h('p.small.muted', `Connecté en tant que « ${state.me?.username} »${isAdmin ? ' (administrateur)' : ''}.`),
    h('div', h('button.btn.small', { onclick: changePassword }, 'Changer mon mot de passe')));

  const blocks = [kpis, alerts, chart, h('div.grid.two', providers, models), errors];
  if (isAdmin) {
    const fu = u.freellmapi;
    blocks.push(h('div.card', h('h3', '📦 Consommation enregistrée par FreeLLMAPI (toutes applications)'),
      !fu ? h('p.muted.small', 'Indisponible.') : fu.error ? h('p.small.muted', `Non disponible : ${fu.error}`) :
        h('div.stack', h('p.small', `Mois ${fu.month} : ${fmtNum(fu.requests)} requêtes, ${fmtNum(fu.tokens)} tokens. Remise à zéro : ${fmtDate(fu.resetsAt)}.`),
          table(['Clé', 'Fournisseur', 'Requêtes', 'Tokens'], (fu.byKey || []).map(k => h('tr', h('td', k.label || `#${k.keyId}`), h('td', k.platform), h('td', fmtNum(k.requests)), h('td', fmtNum(k.tokens))))),
          h('p.tiny.muted', 'Les quotas gratuits restants ne sont affichés que lorsque les fournisseurs les communiquent. Aucun chiffre n’est inventé.'))));
    blocks.push(await friendsPanel(el));
    blocks.push(settingsPanel(s, el));
  }
  blocks.push(security);
  el.append(h('div.stack', ...blocks.filter(Boolean),
    h('div.row', h('button.btn.small', { onclick: async () => { await api('/api/status?refresh=1').catch(() => {}); el.innerHTML = ''; render(el); } }, '🔄 Actualiser'))));
}

// ---------- Amis et accès (administrateur) ----------
async function friendsPanel(el) {
  const users = await api('/api/users');
  const rerender = () => { el.innerHTML = ''; render(el); };
  const rows = users.map(u => h('tr',
    h('td', h('b', u.name), h('div.tiny.muted', u.username + (u.role === 'admin' ? ' · administrateur' : ''))),
    h('td', u.disabled ? h('span.badge.bad', 'désactivé') : u.mustChangePassword ? h('span.badge.warn', 'jamais connecté') : h('span.badge.ok', 'actif'),
      h('div.tiny.muted', u.lastLoginAt ? `vu ${fmtDate(u.lastLoginAt)}` : '')),
    h('td', `${fmtNum(u.usage.today)}`, h('div.tiny.muted', u.role === 'admin' ? 'sans limite' : `limite ${u.dailyTokenCap ? fmtNum(u.dailyTokenCap) : 'aucune'}`)),
    h('td', fmtNum(u.usage.month)),
    h('td', fmtBytes(u.storage), h('div.tiny.muted', u.role === 'admin' ? '' : `sur ${u.storageQuotaMB} Mo`)),
    h('td', u.role === 'admin' ? '' : h('div.row', { style: { gap: '4px' } },
      h('button.btn.small', { onclick: () => editFriend(u).then(r => r && rerender()) }, '⚙️'),
      h('button.btn.small', { title: 'Nouveau mot de passe', onclick: async () => {
        const pw = genPassword();
        if (!(await confirmBox(`Donner un nouveau mot de passe provisoire à ${u.name} ?`, 'Oui'))) return;
        try { await api(`/api/users/${u.id}`, { method: 'PUT', body: { password: pw } }); await showCredentials(u.username, pw); rerender(); } catch (e) { toastErr(e); }
      } }, '🔑'),
      h('button.btn.small' + (u.disabled ? '' : '.danger'), { onclick: async () => {
        if (!u.disabled && !(await confirmBox(`Désactiver le compte de ${u.name} ? Ses données sont conservées ; vous pourrez le réactiver.`, 'Désactiver', true))) return;
        try { await api(`/api/users/${u.id}`, { method: 'PUT', body: { disabled: !u.disabled } }); rerender(); } catch (e) { toastErr(e); }
      } }, u.disabled ? 'Réactiver' : 'Désactiver')))));
  return h('div.card.stack',
    h('div.row', h('h3.grow', '👥 Amis et accès'), h('button.btn.primary.small', { onclick: () => addFriend().then(r => r && rerender()) }, '＋ Inviter un ami')),
    h('p.small.muted', 'Chaque ami a son propre compte : ses conversations, projets et fichiers sont privés (vous ne les voyez pas, il ne voit pas les vôtres). Tout le monde partage les mêmes quotas gratuits : fixez une limite par personne.'),
    h('div.table-wrap', h('table', h('tr', ['Personne', 'État', 'Tokens aujourd’hui', 'Tokens ce mois', 'Fichiers', ''].map(c => h('th', c))), rows)));
}

function genPassword() {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(12));
  const s = [...b].map(x => c[x % c.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
async function showCredentials(username, pw) {
  const text = `Voici ton accès au Studio IA :\n${location.origin}\nIdentifiant : ${username}\nMot de passe provisoire : ${pw}\n(tu choisiras ton propre mot de passe à la première connexion)`;
  await modal('À envoyer à votre ami', h('div.stack',
    h('pre', { style: { whiteSpace: 'pre-wrap', background: 'var(--bg)', padding: '10px', borderRadius: '10px' } }, text),
    h('p.small.muted', 'Ce mot de passe ne sera plus affiché. Envoyez-le par message privé.'),
    h('div.row', h('button.btn.small.primary', { onclick: () => navigator.clipboard?.writeText(text).then(() => toast('Copié', 'ok')) }, '📋 Copier le message'),
      navigator.share ? h('button.btn.small', { onclick: () => navigator.share({ title: 'Studio IA', text }).catch(() => {}) }, '📤 Partager') : null)));
}
async function addFriend() {
  const name = h('input', { placeholder: 'Prénom ou pseudo' });
  const username = h('input', { placeholder: 'ex : yanis', autocapitalize: 'none' });
  name.oninput = () => { if (!username.dataset.touched) username.value = name.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]+/g, '').slice(0, 30); };
  username.oninput = () => (username.dataset.touched = '1');
  const tok = h('input', { type: 'number', min: 0, step: 10000, value: 100000 });
  const med = h('input', { type: 'number', min: 0, value: 10 });
  const sto = h('input', { type: 'number', min: 10, value: 200 });
  const r = await modal('Inviter un ami', h('div.stack',
    h('div.row', h('label.f.grow', 'Nom affiché', name), h('label.f.grow', 'Identifiant de connexion', username)),
    h('div.row', h('label.f.grow', 'Tokens par jour (0 = sans limite)', tok), h('label.f.grow', 'Images/vidéos/voix par jour', med), h('label.f.grow', 'Espace fichiers (Mo)', sto)),
    h('p.tiny.muted', 'Un mot de passe provisoire est créé automatiquement ; votre ami le changera à sa première connexion.')),
    [{ label: 'Annuler', value: false }, { label: 'Créer le compte', primary: true, value: true }]);
  if (!r) return false;
  const pw = genPassword();
  try {
    await api('/api/users', { method: 'POST', body: { name: name.value || username.value, username: username.value, password: pw, dailyTokenCap: tok.value, dailyMediaCap: med.value, storageQuotaMB: sto.value } });
    await showCredentials(username.value, pw);
    return true;
  } catch (e) { toastErr(e); return false; }
}
async function editFriend(u) {
  const name = h('input', { value: u.name });
  const tok = h('input', { type: 'number', min: 0, step: 10000, value: u.dailyTokenCap ?? 100000 });
  const med = h('input', { type: 'number', min: 0, value: u.dailyMediaCap ?? 10 });
  const sto = h('input', { type: 'number', min: 10, value: u.storageQuotaMB ?? 200 });
  const r = await modal(`Compte de ${u.name}`, h('div.stack', h('label.f', 'Nom affiché', name),
    h('div.row', h('label.f.grow', 'Tokens par jour (0 = sans limite)', tok), h('label.f.grow', 'Médias par jour', med), h('label.f.grow', 'Espace fichiers (Mo)', sto))),
    [{ label: 'Annuler', value: false }, { label: 'Enregistrer', primary: true, value: true }]);
  if (!r) return false;
  try { await api(`/api/users/${u.id}`, { method: 'PUT', body: { name: name.value, dailyTokenCap: tok.value, dailyMediaCap: med.value, storageQuotaMB: sto.value } }); toast('Enregistré', 'ok'); return true; }
  catch (e) { toastErr(e); return false; }
}

// ---------- Réglages globaux (administrateur) ----------
function settingsPanel(s, el) {
  const f = {
    freeOnly: h('input', { type: 'checkbox', checked: s.freeOnly }),
    dailyTokenCap: h('input', { type: 'number', min: 0, step: 10000, value: s.dailyTokenCap }),
    monthlyTokenCap: h('input', { type: 'number', min: 0, step: 100000, value: s.monthlyTokenCap }),
    dailyMediaCap: h('input', { type: 'number', min: 0, value: s.dailyMediaCap }),
    storageQuotaMB: h('input', { type: 'number', min: 50, max: 9000, value: s.storageQuotaMB }),
    paidPlatforms: h('input', { value: s.paidPlatforms.join(', ') }),
  };
  return h('div.card.stack',
    h('h3', '🛡️ Garde-fous du Studio (pour tout le monde)'),
    h('label.chk', f.freeOnly, h('b', 'Mode gratuit (recommandé)'), h('span.small.muted', ' — bloque tout fournisseur marqué payant')),
    h('div.row',
      h('label.f.grow', 'Plafond tokens / jour (tous)', f.dailyTokenCap),
      h('label.f.grow', 'Plafond tokens / mois (tous)', f.monthlyTokenCap),
      h('label.f.grow', 'Médias / jour (tous)', f.dailyMediaCap),
      h('label.f.grow', 'Stockage total (Mo)', f.storageQuotaMB)),
    h('label.f', 'Fournisseurs considérés comme potentiellement payants', f.paidPlatforms),
    h('div.row',
      h('button.btn.primary', { onclick: async () => {
        if (!f.freeOnly.checked && !(await confirmBox('Désactiver le mode gratuit autorise les fournisseurs marqués payants. Des frais pourraient apparaître si une clé avec facturation est configurée dans FreeLLMAPI. Continuer ?', 'Je comprends, désactiver', true))) { f.freeOnly.checked = true; return; }
        try {
          await api('/api/settings', { method: 'PUT', body: { freeOnly: f.freeOnly.checked, allowPaid: !f.freeOnly.checked, dailyTokenCap: f.dailyTokenCap.value, monthlyTokenCap: f.monthlyTokenCap.value,
            dailyMediaCap: f.dailyMediaCap.value, storageQuotaMB: f.storageQuotaMB.value, paidPlatforms: f.paidPlatforms.value.split(',') } });
          toast('Réglages enregistrés', 'ok');
        } catch (e) { toastErr(e); }
      } }, 'Enregistrer'),
      h('button.btn.ghost', { onclick: async () => { if (await confirmBox('Revenir aux réglages par défaut ?')) { await api('/api/settings/reset', { method: 'POST' }); el.innerHTML = ''; render(el); } } }, 'Réglages par défaut')),
    h('div.notice', 'Gratuité garantie par : 1) FreeLLMAPI qui ne route que vers des offres gratuites ; 2) le blocage des fournisseurs marqués payants ; 3) les plafonds globaux et par ami. Règle d’or : jamais de clé liée à un compte avec carte bancaire dans FreeLLMAPI.'));
}

async function changePassword() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const nxt = h('input', { type: 'password', autocomplete: 'new-password' });
  const r = await modal('Changer mon mot de passe', h('div.stack', h('label.f', 'Mot de passe actuel', cur), h('label.f', 'Nouveau mot de passe (8 caractères min.)', nxt)), [{ label: 'Annuler', value: false }, { label: 'Changer', primary: true, value: true }]);
  if (!r) return;
  try { await api('/api/password', { method: 'POST', body: { current: cur.value, next: nxt.value } }); toast('Mot de passe changé', 'ok'); } catch (e) { toastErr(e); }
}

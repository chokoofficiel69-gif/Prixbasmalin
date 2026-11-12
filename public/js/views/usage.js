import { api, h, state, toast, toastErr, fmtNum, fmtDate, fmtBytes, confirmBox, modal } from '../lib/core.js';

const pctOf = (a, b) => (b ? Math.min(100, (a / b) * 100) : 0);
const barCls = (p) => 'div.bar' + (p > 90 ? '.bad' : p > 75 ? '.warn' : '');
const table = (cols, rows) => h('div.table-wrap', h('table', h('tr', cols.map(c => h('th', c))), rows));
const tok = (n) => n === null || n === undefined ? '—' : fmtNum(n);
const OUTCOMES = { ok: 'réponse complète', 'interrompu-client': 'interrompu par l’utilisateur', 'interrompu-erreur': 'coupé par une erreur', 'interruption-serveur': 'serveur redémarré pendant la requête',
  'refusé-avant-appel': 'refusé avant l’appel', 'échec-avant-réponse': 'échec avant réponse', 'annulé-avant-réponse': 'annulé avant réponse' };
const outcome = (o) => OUTCOMES[o] || (o?.startsWith('échec-http-') ? `refus fournisseur (HTTP ${o.slice(11)})` : o);

export async function render(el) {
  const u = await api('/api/usage');
  if (u.role !== 'admin') return renderMember(el, u);
  const prov = await api('/api/providers').catch((e) => ({ error: e.message }));
  const I = u.internal;
  const usedPct = pctOf(I.consumed + I.reserved, I.pool);
  const maxDay = Math.max(1, ...I.days.map(d => d.exact + d.estimated));
  const rerender = () => { el.innerHTML = ''; render(el); };

  const poolCard = h('div.card.stack',
    h('h3', '🏦 Pool interne du Studio — ', I.month, h('span.badge', `remise à zéro ${fmtDate(I.resetsAt)}`)),
    h('p.small.muted', 'Quota INTERNE fixé par le Studio et partagé par tous les comptes. Ce n’est pas un quota accordé par un fournisseur (voir plus bas).'),
    h('div.grid',
      kpi('Pool mensuel', tok(I.pool)),
      kpi('Consommés', tok(I.consumed), `dont ${tok(I.exact)} réels (mesurés par le fournisseur) et ${tok(I.estimated)} estimés`),
      kpi('Réservés (requêtes en cours)', tok(I.reserved), `${I.openReservations} réservation(s) ouverte(s)`),
      kpi('Restants', tok(I.remaining), `${(100 - usedPct).toFixed(1)} % du pool`),
    ),
    h(barCls(usedPct), h('i', { style: { width: usedPct + '%' } })),
    h('div.grid',
      kpi('Aujourd’hui', tok(I.today.consumed), `${tok(I.today.exact)} réels · ${tok(I.today.estimated)} estimés${I.today.cap ? ` · limite ${tok(I.today.cap)}/jour` : ''}`),
      kpi('Attribués aux comptes', tok(I.allocated), `non attribués : ${tok(I.unallocated)}`),
    ),
    realCapacityStrip(prov, I.pool),
  );
  const alerts = u.alerts.length ? h('div.stack', u.alerts.map(a => h('div.notice' + (a.level === 'danger' ? '.bad' : '.warn'), a.t ? `${fmtDate(a.t)} — ${a.message}` : a.message))) : null;

  const chart = h('div.card', h('h3', '📈 Consommation des 30 derniers jours (registre)'),
    h('div.chart', I.days.map(d => h('div', { style: { height: Math.max(2, ((d.exact + d.estimated) / maxDay) * 100) + '%', opacity: d.exact + d.estimated ? 1 : 0.25, background: d.estimated > d.exact ? 'var(--warn)' : '' },
      'data-tip': `${d.day} : ${fmtNum(d.exact)} réels + ${fmtNum(d.estimated)} estimés` }))),
    h('div.row.tiny.muted', h('span', I.days[0].day), h('span.grow'), h('span', 'orange = majorité estimée'), h('span.grow'), h('span', I.days[I.days.length - 1].day)));

  const usersCard = await friendsPanel(u, rerender);

  const costs = h('div.card', h('h3', '💶 Coûts du mois'),
    u.costs.length ? table(['Fournisseur', 'Tokens', 'Coût'], u.costs.map(c => h('tr', h('td', c.platform), h('td', fmtNum(c.tokens)),
      h('td', c.eur === null ? h('span.warn-t', 'tarif non renseigné') : c.platform === 'ovh' ? h('span.ok-t', '0 € — accès anonyme, aucune facturation possible') : `${c.eur.toFixed(4)} €`))))
      : h('p.small.muted', 'Aucune consommation ce mois-ci.'),
    h('p.tiny.muted', 'Un tarif absent n’est jamais affiché comme 0 €. Seul l’accès anonyme OVH est gratuit par construction (aucun compte, aucune carte).'));

  const history = h('div.card', h('h3', '🧾 Historique des consommations (registre)'),
    u.history.length ? table(['Quand', 'Compte', 'Modèle', 'Fournisseur', 'Tokens', 'Mesure', 'Réservé', 'Issue'], u.history.slice(0, 60).map(x => h('tr',
      h('td', fmtDate(x.t)), h('td', x.name), h('td', x.model || '—'), h('td', x.platform || x.provider || '—'), h('td', fmtNum(x.tok)),
      h('td', x.tok ? (x.exact ? h('span.badge.ok', 'réelle') : h('span.badge.warn', 'estimée')) : '—'), h('td.tiny.muted', fmtNum(x.reserved)), h('td.small', outcome(x.outcome)))))
      : h('p.small.muted', 'Aucune requête enregistrée.'));

  el.append(h('div.stack', poolCard, alerts, chart, usersCard, providersPanel(prov, rerender), costs, history, opsPanel(u.ops), settingsPanel(u.settings, I, rerender), accountCard()));
}

function kpi(label, value, sub) {
  return h('div', h('div.small.muted', label), h('div.kpi', value), sub ? h('div.tiny.muted', sub) : null);
}

// ---------------- Vue d'un membre ----------------
function renderMember(el, u) {
  const m = u.me;
  const p = pctOf(m.consumed + m.reserved, m.quota);
  el.append(h('div.stack',
    h('div.card.stack', h('h3', '🎟️ Mon quota de tokens — ', u.month),
      h('div.grid', kpi('Quota mensuel', tok(m.quota)), kpi('Consommés', tok(m.consumed), `${tok(m.exact)} réels · ${tok(m.estimated)} estimés`),
        kpi('En cours', tok(m.reserved)), kpi('Restants', tok(m.remaining))),
      h(barCls(p), h('i', { style: { width: p + '%' } })),
      h('p.small.muted', `Remise à zéro le ${fmtDate(u.resetsAt)}. « Réels » = mesurés par le fournisseur ; « estimés » = le fournisseur n’a pas donné la mesure, une estimation prudente est décomptée.`)),
    h('div.card', h('h3', '🧾 Mes dernières requêtes'), u.history.length ? table(['Quand', 'Modèle', 'Tokens', 'Mesure', 'Issue'], u.history.map(x => h('tr',
      h('td', fmtDate(x.t)), h('td', x.model || '—'), h('td', fmtNum(x.tok)), h('td', x.tok ? (x.exact ? 'réelle' : 'estimée') : '—'), h('td.small', outcome(x.outcome))))) : h('p.small.muted', 'Rien pour l’instant.')),
    accountCard()));
}

// ---------------- Comptes et quotas ----------------
async function friendsPanel(u, rerender) {
  const I = u.internal;
  const rows = u.users.map(x => {
    const p = pctOf((x.consumed || 0) + (x.reserved || 0), x.quota);
    return h('tr',
      h('td', h('b', x.name), h('div.tiny.muted', x.username + (x.role === 'admin' ? ' · administrateur' : ''))),
      h('td', x.disabled ? h('span.badge.bad', 'désactivé') : h('span.badge.ok', 'actif')),
      h('td', tok(x.quota)),
      h('td', tok(x.consumed), h('div.tiny.muted', `${tok(x.exact)} réels · ${tok(x.estimated)} estimés`)),
      h('td', tok(x.reserved)),
      h('td', tok(x.remaining), h('div', { class: barCls(p).slice(4).replace(/\./g, ' '), style: { marginTop: '4px' } }, h('i', { style: { width: p + '%' } }))),
      h('td', tok(x.today)),
      h('td', h('div.row', { style: { gap: '4px' } },
        h('button.btn.small', { title: 'Quota et limites', onclick: () => editQuota(x, I).then(r => r && rerender()) }, '⚙️'),
        x.role === 'admin' ? null : h('button.btn.small', { title: 'Nouveau mot de passe', onclick: async () => {
          const pw = genPassword();
          if (!(await confirmBox(`Donner un nouveau mot de passe provisoire à ${x.name} ?`, 'Oui'))) return;
          try { await api(`/api/users/${x.id}`, { method: 'PUT', body: { password: pw } }); await showCredentials(x.username, pw); } catch (e) { toastErr(e); }
        } }, '🔑'),
        x.role === 'admin' ? null : h('button.btn.small' + (x.disabled ? '' : '.danger'), { onclick: async () => {
          if (!x.disabled && !(await confirmBox(`Désactiver ${x.name} ? Son quota redevient disponible ; ses données sont conservées.`, 'Désactiver', true))) return;
          try { await api(`/api/users/${x.id}`, { method: 'PUT', body: { disabled: !x.disabled } }); rerender(); } catch (e) { toastErr(e); }
        } }, x.disabled ? 'Réactiver' : 'Désactiver'))));
  });
  return h('div.card.stack',
    h('div.row', h('h3.grow', '👥 Comptes et quotas individuels'), h('button.btn.primary.small', { onclick: () => addFriend(I).then(r => r && rerender()) }, '＋ Créer un compte')),
    h('p.small.muted', `Somme des quotas attribués : ${tok(I.allocated)} / ${tok(I.pool)} (pool). Le Studio refuse toute attribution qui dépasserait le pool.`),
    table(['Compte', 'État', 'Quota mensuel', 'Consommés', 'Réservés', 'Restants', 'Aujourd’hui', ''], rows));
}

function genPassword() {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(12));
  const s = [...b].map(x => c[x % c.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
async function showCredentials(username, pw) {
  const text = `Voici ton accès au Studio IA :\n${location.origin}\nIdentifiant : ${username}\nMot de passe provisoire : ${pw}\n(tu choisiras ton propre mot de passe à la première connexion)`;
  await modal('À envoyer à la personne', h('div.stack',
    h('pre', { style: { whiteSpace: 'pre-wrap', background: 'var(--bg)', padding: '10px', borderRadius: '10px' } }, text),
    h('p.small.muted', 'Ce mot de passe ne sera plus affiché.'),
    h('div.row', h('button.btn.small.primary', { onclick: () => navigator.clipboard?.writeText(text).then(() => toast('Copié', 'ok')) }, '📋 Copier'),
      navigator.share ? h('button.btn.small', { onclick: () => navigator.share({ title: 'Studio IA', text }).catch(() => {}) }, '📤 Partager') : null)));
}
async function addFriend(I) {
  const name = h('input', { placeholder: 'Prénom, pseudo ou nom du client' });
  const username = h('input', { placeholder: 'ex : yanis', autocapitalize: 'none' });
  name.oninput = () => { if (!username.dataset.touched) username.value = name.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]+/g, '').slice(0, 30); };
  username.oninput = () => (username.dataset.touched = '1');
  const quota = h('input', { type: 'number', min: 0, step: 50000, value: Math.min(500000, I.unallocated) });
  const med = h('input', { type: 'number', min: 0, value: 10 });
  const sto = h('input', { type: 'number', min: 10, value: 200 });
  const r = await modal('Créer un compte', h('div.stack',
    h('div.row', h('label.f.grow', 'Nom affiché', name), h('label.f.grow', 'Identifiant', username)),
    h('label.f', `Quota mensuel de tokens (non attribués : ${fmtNum(I.unallocated)})`, quota),
    h('div.row', h('label.f.grow', 'Images/vidéos/voix par jour', med), h('label.f.grow', 'Espace fichiers (Mo)', sto))),
    [{ label: 'Annuler', value: false }, { label: 'Créer', primary: true, value: true }]);
  if (!r) return false;
  const pw = genPassword();
  try {
    await api('/api/users', { method: 'POST', body: { name: name.value || username.value, username: username.value, password: pw, monthlyTokenQuota: quota.value, dailyMediaCap: med.value, storageQuotaMB: sto.value } });
    await showCredentials(username.value, pw);
    return true;
  } catch (e) { toastErr(e); return false; }
}
async function editQuota(x, I) {
  const maxFor = I.unallocated + (x.disabled ? 0 : (x.quota || 0));
  const quota = h('input', { type: 'number', min: 0, step: 50000, value: x.quota || 0 });
  const daily = h('input', { type: 'number', min: 0, step: 10000, value: x.daily || 0 });
  const r = await modal(`Quota de ${x.name}`, h('div.stack',
    h('label.f', `Quota mensuel de tokens (maximum possible : ${fmtNum(maxFor)})`, quota),
    x.role === 'admin' ? null : h('label.f', 'Limite par jour (0 = aucune)', daily),
    h('p.tiny.muted', `Déjà consommés ce mois : ${fmtNum(x.consumed || 0)}. Baisser le quota sous ce chiffre bloque immédiatement le compte jusqu’au mois prochain.`)),
    [{ label: 'Annuler', value: false }, { label: 'Enregistrer', primary: true, value: true }]);
  if (!r) return false;
  try {
    const body = { monthlyTokenQuota: quota.value };
    if (x.role !== 'admin') body.dailyTokenCap = daily.value;
    await api(`/api/users/${x.id}`, { method: 'PUT', body });
    toast('Quota enregistré', 'ok'); return true;
  } catch (e) { toastErr(e); return false; }
}

// ---------------- Capacité réelle estimée (à côté du pool interne) ----------------
const n1 = (x) => (Math.round(x * 10) / 10).toLocaleString('fr-FR');
function realCapacityStrip(prov, pool) {
  const r = prov?.ovh?.real;
  if (!r) return h('div.notice.warn', 'Capacité réelle des fournisseurs indisponible pour l’instant.');
  const m30 = r.month30;
  const estimated = r.models.some(m => m.tokensStatus === 'estimé');
  return h('div.stack',
    h('div.notice.warn', h('b', '⚠️ Le pool de ', tok(pool), ' est un plafond INTERNE, pas une capacité réelle. '),
      'Ce que les fournisseurs peuvent réellement servir est estimé ci-dessous.'),
    h('div.grid',
      kpi('Capacité réelle estimée', `${n1(r.realRpm)} req/min`, `${r.models.length} modèles × ${r.models[0]?.limitRpm ?? 2} req/min × (1 − erreurs) · théorique ${r.theoreticalRpm} · non garanti`),
      kpi('Débit réel estimé', r.tokensPerMin != null ? `${fmtNum(Math.round(r.tokensPerMin))} tokens/min` : 'non mesuré',
        r.tokensPerMin != null ? `${r.measuredModels}/${r.models.length} modèles mesurés${estimated ? ' · une partie estimée' : ''}` : 'faites quelques requêtes pour mesurer'),
      kpi('Équivalent 30 jours', m30 ? tok(m30.tokens) : '—', m30 ? `bloque en premier : ${m30.blockedBy.label}` : ''),
    ),
    m30 ? h('div.tiny.muted', 'Équivalent 30 jours = la plus petite de : ', m30.limits.map(l => `${l.label} ${tok(l.tokens)}`).join(' · ')) : null,
    h('div.tiny.muted', r.note, ' ', r.parallel));
}

// ---------------- Capacité réelle des fournisseurs ----------------
function providersPanel(p, rerender) {
  if (p.error) return h('div.card.notice.bad', `Capacité fournisseurs indisponible : ${p.error}`);
  const o = p.ovh, f = p.freellmapi;
  return h('div.card.stack',
    h('h3', '🔌 Capacité et limites confirmées chez les fournisseurs'),
    h('p.small.muted', 'Ceci n’est PAS le quota interne : ce sont les limites des fournisseurs eux-mêmes, avec leur source. Aucun chiffre n’est inventé.'),
    h('div.grid.two',
      h('div.stack',
        h('h3', 'OVH AI Endpoints', o.allowed ? h('span.badge.ok', 'autorisé') : h('span.badge.bad', 'non autorisé')),
        h('div.small', h('b', 'Quota mensuel : '), o.monthlyQuota),
        h('div.small', h('b', 'Facturation : '), o.facts.billing.note),
        h('ul.small', o.facts.limits.map(l => h('li', l.text, h('div.tiny.muted', `Source : ${l.source}`)))),
        h('div.notice.bad', h('b', '⚠️ Usage commercial non vérifié : '), 'l’accès anonyme OVH (sans clé) n’a pas été validé pour un service commercial ou payant. ', o.facts.commercialUse),
        h('div.small', h('b', 'Débit théorique maximal (tout le Studio) : '), `${o.theoretical.requestsPerMinute} requêtes/min`, h('div.tiny.muted', o.theoretical.note)),
        o.listError ? h('div.notice.warn', o.listError) : h('div.small', h('b', `Modèles de chat disponibles (${o.chatModels.length}) : `), o.chatModels.join(', ') || '—', h('div.tiny.muted', o.verifiedAt ? `liste vérifiée en direct le ${fmtDate(o.verifiedAt)}` : '')),
        table(['Modèle', 'Requêtes (60 s)', 'Disponible'], o.capacityNow.map(c => h('tr', h('td', c.model), h('td', `${c.usedLastMinute}`), h('td', c.ok ? h('span.ok-t', 'oui') : h('span.warn-t', `dans ${c.retryIn} s`))))),
        h('div.small', `Refus 429 récents : ${o.recent429}`),
        h('div.small', h('b', 'Répartition automatique : '), 'charge comptée sur 60 s (requêtes lancées, en cours incluses) ; on prend le moins chargé du niveau. Un modèle saturé ou en pause (60 s après un 429) bascule d’abord vers un modèle du même niveau (haut / moyen / bas), puis du niveau inférieur. La conversation l’indique.'),
        o.real ? table(['Modèle', 'Niveau', 'Mesures (n)', 'Latence moy. (info)', 'Tokens/réponse', 'Erreurs', 'Req/min réelle', 'Tokens/min'], o.real.models.map(m => h('tr',
          h('td', m.model),
          h('td', m.tier),
          h('td', `${m.n}`, m.reliability === 'faible' ? h('div.tiny.warn-t', 'fiabilité faible') : null),
          h('td', m.latencyS != null ? `${Math.round(m.latencyS)} s` : '—'),
          h('td', m.tokPerReply != null ? fmtNum(Math.round(m.tokPerReply)) : 'non mesuré'),
          h('td', m.errorRate != null ? `${Math.round(m.errorRate * 100)} %` : '—'),
          h('td', `${n1(m.realRpm)}`),
          h('td', m.tokensPerMin != null ? fmtNum(Math.round(m.tokensPerMin)) : 'non mesuré', m.tokensStatus === 'estimé' ? h('div.tiny.warn-t', 'estimé (moyenne des modèles mesurés)') : null)))) : null,
        o.excluded?.length ? h('div.small', h('b', 'Exclus du chat texte : '), o.excluded.map(x => `${x.id} (${x.reason})`).join(' · ')) : null),
      h('div.stack',
        h('h3', 'FreeLLMAPI (passerelle)', f.verification.ok ? h('span.badge.ok', 'fournisseurs vérifiables') : h('span.badge.bad', 'non vérifiable')),
        h('div.small', h('b', 'Quota mensuel : '), f.monthlyQuota),
        f.verification.ok ? table(['Modèle', 'Fournisseurs possibles', 'Mode gratuit'], f.verification.models.slice(0, 30).map(m => h('tr', h('td', m.id), h('td', m.platforms.join(', ')), h('td', m.allowed ? h('span.ok-t', 'autorisé') : h('span.bad-t', 'bloqué')))))
          : h('div.notice.warn', `${f.verification.error}. En mode gratuit, la passerelle est donc bloquée pour le chat. Pour l’autoriser de façon vérifiable : tableau de bord FreeLLMAPI → Keys → Agent compatibility → activer le serveur MCP.`),
        f.catalog?.error ? h('div.small.muted', f.catalog.error) : h('div.small', `Catalogue : ${f.catalog?.ready ?? '?'} modèles prêts, ${f.catalog?.exhausted ?? '?'} en pause (quota fournisseur atteint), ${f.catalog?.needsKey ?? '?'} sans clé.`),
        f.usage && !f.usage.error ? h('div.small', `Compteur FreeLLMAPI /v1/usage (${f.usage.month}) : ${fmtNum(f.usage.requests)} requêtes, ${fmtNum(f.usage.tokens)} tokens — toutes applications confondues (Open WebUI inclus).`) : h('div.small.muted', `/v1/usage : ${f.usage?.error || 'indisponible'}`)),
    ),
    h('div.row',
      h('button.btn.small', { onclick: async () => { await api('/api/providers?refresh=1').catch(() => {}); rerender(); } }, '🔄 Revérifier les fournisseurs'),
      h('button.btn.small.primary', { onclick: (e) => runVerification(e.target) }, '🧪 Lancer le test réel (OVH + comparaison /v1/usage)')));
}

async function runVerification(btn, confirmUnverified = false) {
  btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span> Test en cours (≈ 10 s)…';
  try {
    const r = await api('/api/verify-real', { method: 'POST', body: { confirmUnverified } });
    const gw = r.steps.find(s => s.name === 'FreeLLMAPI');
    await modal('Résultat du test réel', h('div.stack',
      h('p.small.muted', `Exécuté le ${fmtDate(r.at)} — enregistré dans le journal des vérifications du serveur.`),
      ...r.steps.map(s => h('div.card', h('h3', s.ok ? '✅ ' : s.skipped ? '⏭️ ' : '❌ ', s.name), h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', margin: 0 } }, JSON.stringify(s, null, 1)))),
      gw?.skipped ? h('button.btn.small', { onclick: async (e) => {
        if (!(await confirmBox('Le fournisseur réel de FreeLLMAPI ne peut pas être vérifié avant l’appel. Lancer quand même UN appel de test (≈ 30 tokens) pour comparer les compteurs ?', 'Lancer le test'))) return;
        document.querySelector('.modal-back')?.remove(); runVerification(btn, true);
      } }, 'Tester aussi FreeLLMAPI (confirmation explicite)') : null));
  } catch (e) { toastErr(e); }
  btn.disabled = false; btn.textContent = old;
}

function opsPanel(ops) {
  return h('div.card', h('h3', '⚙️ Exploitation : modèles, latence, erreurs (ce mois)'),
    ops.models.length ? table(['Modèle', 'Fournisseur', 'Type', 'Requêtes', 'Erreurs', 'Latence moy.'], ops.models.map(m => h('tr', h('td', m.model), h('td', m.platform), h('td', m.kind || 'chat'), h('td', m.requests),
      h('td', m.errors ? h('span.bad-t', m.errors) : '0'), h('td', m.requests ? `${(m.ms / m.requests / 1000).toFixed(1)} s` : '—')))) : h('p.small.muted', 'Rien ce mois-ci.'),
    ops.errors.length ? h('details', h('summary.small', `Dernières erreurs (${ops.errors.length})`), table(['Quand', 'Type', 'Modèle', 'Message'], ops.errors.map(e => h('tr', h('td', fmtDate(e.t)), h('td', e.kind), h('td', e.model), h('td.small', e.err || ''))))) : null);
}

// ---------------- Garde-fous ----------------
function settingsPanel(s, I, rerender) {
  const f = {
    freeOnly: h('input', { type: 'checkbox', checked: s.freeOnly }),
    pool: h('input', { type: 'number', min: 0, step: 100000, value: s.poolMonthlyTokens }),
    daily: h('input', { type: 'number', min: 0, step: 10000, value: s.dailyTokenCap }),
    maxOut: h('input', { type: 'number', min: 256, max: 32000, step: 256, value: s.maxOutputTokens }),
    media: h('input', { type: 'number', min: 0, value: s.dailyMediaCap }),
    storage: h('input', { type: 'number', min: 50, max: 9000, value: s.storageQuotaMB }),
    allowed: h('input', { value: (s.allowedPlatforms || []).join(', ') }),
    paid: h('input', { value: s.paidPlatforms.join(', ') }),
    gwMedia: h('input', { type: 'checkbox', checked: !!s.gatewayMediaAllowed }),
    prices: h('textarea', { rows: 3, placeholder: 'une ligne par fournisseur : groq = 0.59' }),
  };
  f.prices.value = Object.entries(s.prices || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
  return h('div.card.stack',
    h('h3', '🛡️ Garde-fous'),
    h('label.chk', f.freeOnly, h('b', 'Mode gratuit (recommandé)'), h('span.small.muted', ' — seuls les fournisseurs de la liste blanche, identifiés AVANT l’appel')),
    h('div.row',
      h('label.f.grow', `Pool mensuel de tokens (≥ ${fmtNum(I.allocated)} attribués)`, f.pool),
      h('label.f.grow', 'Limite interne par jour (0 = aucune)', f.daily),
      h('label.f.grow', 'Plafond de sortie par réponse (max_tokens)', f.maxOut)),
    h('div.row', h('label.f.grow', 'Médias / jour (tous)', f.media), h('label.f.grow', 'Stockage total (Mo)', f.storage)),
    h('label.f', 'Liste blanche des fournisseurs autorisés en mode gratuit', f.allowed),
    h('label.f', 'Fournisseurs considérés comme payants (jamais appelés en mode gratuit)', f.paid),
    h('label.chk.small', f.gwMedia, 'Autoriser images, vidéos et voix via FreeLLMAPI (fournisseur connu seulement APRÈS l’appel)'),
    h('label.f', 'Tarifs connus (€ par million de tokens) — absent = « tarif non renseigné »', f.prices),
    h('div.row',
      h('button.btn.primary', { onclick: async () => {
        if (!f.freeOnly.checked && !(await confirmBox('Désactiver le mode gratuit permet d’appeler des fournisseurs non vérifiés ou payants. Des frais pourraient apparaître. Continuer ?', 'Je comprends', true))) { f.freeOnly.checked = true; return; }
        if (f.gwMedia.checked && !s.gatewayMediaAllowed && !(await confirmBox('Les médias passeront par FreeLLMAPI dont le fournisseur réel n’est connu qu’après l’appel. Ne l’activez que si TOUTES les clés de FreeLLMAPI sont gratuites (sans carte). Continuer ?', 'Autoriser', true))) { f.gwMedia.checked = false; return; }
        const prices = {};
        for (const line of f.prices.value.split('\n')) { const m = /^\s*([\w.-]+)\s*[=:]\s*([\d.,]+)\s*$/.exec(line); if (m) prices[m[1].toLowerCase()] = Number(m[2].replace(',', '.')); }
        try {
          await api('/api/settings', { method: 'PUT', body: {
            freeOnly: f.freeOnly.checked, allowPaid: !f.freeOnly.checked, poolMonthlyTokens: f.pool.value, dailyTokenCap: f.daily.value, maxOutputTokens: f.maxOut.value,
            dailyMediaCap: f.media.value, storageQuotaMB: f.storage.value, allowedPlatforms: f.allowed.value.split(','), paidPlatforms: f.paid.value.split(','),
            gatewayMediaAllowed: f.gwMedia.checked, prices } });
          toast('Réglages enregistrés', 'ok'); rerender();
        } catch (e) { toastErr(e); }
      } }, 'Enregistrer')),
    h('div.notice', 'Le pool est un plafond INTERNE : il ne crée aucune capacité chez les fournisseurs. Avant de vendre un volume, comparez-le à la capacité confirmée ci-dessus.'));
}

function accountCard() {
  return h('div.card.stack', h('h3', '🔑 Mon compte'), h('p.small.muted', `Connecté en tant que « ${state.me?.username} ».`),
    h('div', h('button.btn.small', { onclick: changePassword }, 'Changer mon mot de passe')));
}
async function changePassword() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const nxt = h('input', { type: 'password', autocomplete: 'new-password' });
  const r = await modal('Changer mon mot de passe', h('div.stack', h('label.f', 'Mot de passe actuel', cur), h('label.f', 'Nouveau mot de passe (8 caractères min.)', nxt)), [{ label: 'Annuler', value: false }, { label: 'Changer', primary: true, value: true }]);
  if (!r) return;
  try { await api('/api/password', { method: 'POST', body: { current: cur.value, next: nxt.value } }); toast('Mot de passe changé', 'ok'); } catch (e) { toastErr(e); }
}

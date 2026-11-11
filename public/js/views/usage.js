import { api, h, toast, toastErr, fmtNum, fmtDate, confirmBox, modal } from '../lib/core.js';

export async function render(el) {
  const [u, status] = await Promise.all([api('/api/usage'), api('/api/status').catch(() => null)]);
  const s = u.settings;
  const pct = (a, b) => (b ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const barCls = (p) => 'div.bar' + (p > 90 ? '.bad' : p > 70 ? '.warn' : '');
  const dPct = pct(u.today.tokens, s.dailyTokenCap), mPct = pct(u.month.tokens, s.monthlyTokenCap), medPct = pct(u.today.media, s.dailyMediaCap);
  const maxDay = Math.max(1, ...u.days.map(d => d.tokens));

  const kpis = h('div.grid',
    h('div.card', h('h3', '📅 Aujourd’hui'), h('div.kpi', fmtNum(u.today.tokens)), h('p.small.muted', `tokens · plafond ${s.dailyTokenCap ? fmtNum(s.dailyTokenCap) : 'aucun'}`), h(barCls(dPct), h('i', { style: { width: dPct + '%' } })),
      h('p.small.muted', `${u.today.requests} requêtes · ${u.today.errors} erreurs`)),
    h('div.card', h('h3', '🗓️ Ce mois'), h('div.kpi', fmtNum(u.month.tokens)), h('p.small.muted', `tokens · plafond ${s.monthlyTokenCap ? fmtNum(s.monthlyTokenCap) : 'aucun'}`), h(barCls(mPct), h('i', { style: { width: mPct + '%' } })),
      h('p.small.muted', `${u.month.requests} requêtes · ${u.month.errors} erreurs`)),
    h('div.card', h('h3', '🎨 Médias du jour'), h('div.kpi', u.today.media), h('p.small.muted', `images, vidéos, voix, transcriptions · plafond ${s.dailyMediaCap || 'aucun'}`), h(barCls(medPct), h('i', { style: { width: medPct + '%' } }))),
    h('div.card', h('h3', '💶 Coût'), h('div.kpi', `${u.month.eur.toFixed(2)} €`), h('p.small.muted', 'ce mois-ci'),
      h('p.small', s.freeOnly ? h('span.ok-t', '🛡️ Mode gratuit actif : fournisseurs marqués payants bloqués.') : h('span.warn-t', '⚠️ Mode gratuit désactivé.'))),
  );

  const alerts = u.alerts.length ? h('div.stack', u.alerts.map(a => h('div.notice' + (a.level === 'danger' ? '.bad' : '.warn'), `${fmtDate(a.t)} — ${a.message}`))) : null;

  const chart = h('div.card', h('h3', '📈 30 derniers jours (tokens)'),
    h('div.chart', u.days.map(d => h('div', { style: { height: Math.max(2, (d.tokens / maxDay) * 100) + '%', opacity: d.tokens ? 1 : 0.25 }, 'data-tip': `${d.day} : ${fmtNum(d.tokens)} tokens, ${d.requests} req.` }))),
    h('div.row.tiny.muted', h('span', u.days[0].day), h('span.grow'), h('span', u.days[u.days.length - 1].day)));

  const table = (cols, rows) => h('div.table-wrap', h('table', h('tr', cols.map(c => h('th', c))), rows));
  const models = h('div.card', h('h3', '🧠 Modèles utilisés ce mois'), u.models.length ? table(['Modèle', 'Fournisseur', 'Type', 'Requêtes', 'Tokens', 'Erreurs', 'Latence moy.', 'Coût'],
    u.models.map(m => h('tr', h('td', m.model), h('td', m.platform), h('td', m.kind || 'chat'), h('td', m.requests), h('td', fmtNum(m.tokens)), h('td', m.errors ? h('span.bad-t', m.errors) : '0'), h('td', m.requests ? `${(m.ms / m.requests / 1000).toFixed(1)} s` : '—'), h('td', `${m.eur.toFixed(2)} €`)))) : h('p.muted.small', 'Rien encore ce mois-ci.'));

  const fl = status?.freellmapi;
  const providers = h('div.card', h('h3', '🔌 Fournisseurs connectés (FreeLLMAPI)'),
    !fl ? h('p.muted', 'Statut indisponible.') : !fl.reachable ? h('p.bad-t', `FreeLLMAPI injoignable : ${fl.error || 'clé manquante'}`) :
      h('div.stack',
        h('p.small.muted', `${fl.models.ready} modèles prêts · ${fl.models.exhausted} en pause (quota momentanément épuisé) · ${fl.models.needsKey} sans clé`),
        table(['Fournisseur', 'Prêts', 'En pause', 'Sans clé', 'Utilisé ce mois (Studio)', 'Dernière erreur'], fl.platforms.filter(p => p.ready || p.exhausted).concat(fl.platforms.filter(p => !p.ready && !p.exhausted).slice(0, 0)).map(p => {
          const mine = u.platforms.find(x => x.platform === p.platform);
          const paid = s.paidPlatforms.includes(p.platform);
          return h('tr', h('td', p.platform, paid ? h('span.badge.bad', ' payant ?') : null), h('td', h('span.ok-t', p.ready || 0)), h('td', p.exhausted ? h('span.warn-t', p.exhausted) : '0'), h('td', p.needsKey || 0),
            h('td', mine ? `${fmtNum(mine.tokens)} tokens / ${mine.requests} req.` : '—'), h('td', mine?.lastError ? fmtDate(mine.lastError) : '—'));
        })),
        h('details', h('summary.small', `Fournisseurs sans clé configurée (${fl.platforms.filter(p => !p.ready && !p.exhausted).length})`),
          h('p.small.muted', fl.platforms.filter(p => !p.ready && !p.exhausted).map(p => p.platform).join(', ') || '—'),
          h('p.tiny.muted', 'Pour en ajouter : ouvrez le tableau de bord FreeLLMAPI → Keys, créez une clé GRATUITE sur le site du fournisseur (sans carte bancaire) et collez-la. Elle reste chiffrée sur le serveur.')),
      ));

  const fu = u.freellmapi;
  const upstream = h('div.card', h('h3', '📦 Consommation enregistrée par FreeLLMAPI (toutes applications)'),
    !fu ? h('p.muted.small', 'Indisponible.') : fu.error ? h('p.small.muted', `Non disponible : ${fu.error}`) :
      h('div.stack',
        h('p.small', `Mois ${fu.month} : ${fmtNum(fu.requests)} requêtes, ${fmtNum(fu.tokens)} tokens. Remise à zéro : ${fmtDate(fu.resetsAt)}.`),
        table(['Clé', 'Fournisseur', 'Requêtes', 'Tokens', 'Plafond requêtes', 'Plafond tokens'], (fu.byKey || []).map(k => h('tr', h('td', k.label || `#${k.keyId}`), h('td', k.platform), h('td', fmtNum(k.requests)), h('td', fmtNum(k.tokens)),
          h('td', k.requestCap ?? 'aucun'), h('td', k.tokenCap ? fmtNum(k.tokenCap) : 'aucun')))),
        h('p.tiny.muted', 'Les quotas gratuits restants ne sont affichés que lorsque les fournisseurs les communiquent. Aucun chiffre n’est inventé : « en pause » signifie que le fournisseur a répondu « limite atteinte ».')));

  const errors = h('div.card', h('h3', '⚠️ Dernières erreurs'), u.errors.length ? table(['Quand', 'Type', 'Modèle', 'Fournisseur', 'Message'],
    u.errors.map(e => h('tr', h('td', fmtDate(e.t)), h('td', e.kind), h('td', e.model), h('td', e.platform || '—'), h('td.small', e.err || '')))) : h('p.muted.small', 'Aucune erreur récente. 👍'));

  // Réglages
  const f = {
    freeOnly: h('input', { type: 'checkbox', checked: s.freeOnly }),
    dailyTokenCap: h('input', { type: 'number', min: 0, step: 10000, value: s.dailyTokenCap }),
    monthlyTokenCap: h('input', { type: 'number', min: 0, step: 100000, value: s.monthlyTokenCap }),
    dailyMediaCap: h('input', { type: 'number', min: 0, value: s.dailyMediaCap }),
    storageQuotaMB: h('input', { type: 'number', min: 50, max: 9000, value: s.storageQuotaMB }),
    paidPlatforms: h('input', { value: s.paidPlatforms.join(', ') }),
  };
  const settings = h('div.card.stack',
    h('h3', '🛡️ Garde-fous et plafonds'),
    h('label.chk', f.freeOnly, h('b', 'Mode gratuit (recommandé)'), h('span.small.muted', ' — bloque tout modèle d’un fournisseur marqué payant')),
    h('div.row',
      h('label.f.grow', 'Plafond tokens / jour (0 = aucun)', f.dailyTokenCap),
      h('label.f.grow', 'Plafond tokens / mois', f.monthlyTokenCap),
      h('label.f.grow', 'Plafond médias / jour', f.dailyMediaCap),
      h('label.f.grow', 'Quota fichiers (Mo)', f.storageQuotaMB)),
    h('label.f', 'Fournisseurs considérés comme potentiellement payants (séparés par des virgules)', f.paidPlatforms),
    h('div.row',
      h('button.btn.primary', { onclick: async () => {
        if (!f.freeOnly.checked && !(await confirmBox('Désactiver le mode gratuit autorise les fournisseurs marqués payants. Des frais pourraient apparaître si une clé avec facturation est configurée dans FreeLLMAPI. Continuer ?', 'Je comprends, désactiver', true))) { f.freeOnly.checked = true; return; }
        try {
          await api('/api/settings', { method: 'PUT', body: {
            freeOnly: f.freeOnly.checked, allowPaid: !f.freeOnly.checked, dailyTokenCap: f.dailyTokenCap.value, monthlyTokenCap: f.monthlyTokenCap.value,
            dailyMediaCap: f.dailyMediaCap.value, storageQuotaMB: f.storageQuotaMB.value, paidPlatforms: f.paidPlatforms.value.split(','),
          } });
          toast('Réglages enregistrés', 'ok');
        } catch (e) { toastErr(e); }
      } }, 'Enregistrer'),
      h('button.btn.ghost', { onclick: async () => { if (await confirmBox('Revenir aux réglages par défaut ?')) { await api('/api/settings/reset', { method: 'POST' }); el.innerHTML = ''; render(el); } } }, 'Réglages par défaut')),
    h('div.notice', 'Comment la gratuité est garantie : 1) FreeLLMAPI ne route que vers des offres gratuites ; 2) le Studio bloque les fournisseurs marqués payants et alerte si l’un d’eux répond ; 3) les plafonds coupent toute consommation anormale. Règle d’or : n’ajoutez jamais dans FreeLLMAPI une clé liée à un compte avec carte bancaire et facturation activée.'),
    h('h3', '🔑 Sécurité'),
    h('div', h('button.btn.small', { onclick: changePassword }, 'Changer le mot de passe du Studio')),
  );

  el.append(h('div.stack', kpis, alerts, chart, h('div.grid.two', providers, upstream), models, errors, settings,
    h('div.row', h('button.btn.small', { onclick: async () => { await api('/api/status?refresh=1').catch(() => {}); el.innerHTML = ''; render(el); } }, '🔄 Actualiser'))));
}

async function changePassword() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const nxt = h('input', { type: 'password', autocomplete: 'new-password' });
  const r = await modal('Changer le mot de passe', h('div.stack', h('label.f', 'Mot de passe actuel', cur), h('label.f', 'Nouveau mot de passe (10 caractères min.)', nxt)), [{ label: 'Annuler', value: false }, { label: 'Changer', primary: true, value: true }]);
  if (!r) return;
  try { await api('/api/password', { method: 'POST', body: { current: cur.value, next: nxt.value } }); toast('Mot de passe changé', 'ok'); } catch (e) { toastErr(e); }
}

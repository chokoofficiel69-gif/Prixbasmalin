import { api, h, state, currentProject, fmtNum, fmtBytes, fmtDate } from '../lib/core.js';

const QUICK = [
  ['#/parler', '💬', 'Parler aux IA', 'Discuter, comparer plusieurs modèles, conversation vocale.'],
  ['#/agents', '🤖', 'Agents', 'Une équipe d’IA travaille ensemble sur votre tâche.'],
  ['#/images', '🎨', 'Images', 'Créer une image, retoucher une photo.'],
  ['#/clips', '🎬', 'Vidéos et clips', 'Photos + musique → clip monté, sous-titré, exporté.'],
  ['#/musique', '🎹', 'Studio musique', 'Paroles, refrains, instrumentales exportables.'],
  ['#/enregistrement', '🎙️', 'Enregistrement audio', 'Enregistrer, nettoyer, mixer, masteriser.'],
];

export async function render(el) {
  const p = currentProject();
  const hour = new Date().getHours();
  el.append(
    h('div.stack',
      h('div', h('h1', `${hour < 18 ? 'Bonjour' : 'Bonsoir'} ${state.me?.name || ''} 👋`), h('p.muted', `Projet actif : ${p.icon} ${p.name}. Tout ce que vous créez est rangé dans ce projet.`)),
      h('div.grid#home-status', h('div.card', h('span.spinner'), ' Vérification des services…')),
      h('h3', 'Que voulez-vous faire ?'),
      h('div.grid', QUICK.map(([href, ic, t, d]) => h('a.card.link', { href, style: { textDecoration: 'none', color: 'inherit' } }, h('h3', ic, ' ', t), h('p.muted.small', d)))),
      h('div.grid.two',
        h('div.card#home-convs', h('h3', '🕘 Conversations récentes'), h('span.spinner')),
        h('div.card#home-files', h('h3', '📁 Derniers fichiers'), h('span.spinner')),
      ),
    ),
  );

  const [status, usage, convs, files] = await Promise.allSettled([
    api('/api/status'), api('/api/usage'), api(`/api/conversations?project=${state.projectId}`), api(`/api/files?project=${state.projectId}`),
  ]);
  const box = el.querySelector('#home-status');
  box.innerHTML = '';
  if (status.status === 'fulfilled') {
    const s = status.value.freellmapi;
    const st = status.value.storage;
    box.append(h('div.card',
      h('h3', '🔌 Intelligences artificielles'),
      !s.configured ? h('p.bad-t', 'FreeLLMAPI n’est pas relié (clé manquante côté serveur).')
        : !s.reachable ? h('p.small.muted', `Passerelle FreeLLMAPI injoignable (${s.error || ''}) — OVH reste utilisable en direct.`)
          : h('div',
            h('div.kpi', s.models.ready, h('span.muted.small', ` modèles prêts`)),
            h('p.small.muted', `${s.models.exhausted} en pause (quota), ${s.models.needsKey} nécessitent une clé · ${s.platforms.filter(x => x.ready).length} fournisseur(s) actifs`),
            h('div.row', s.platforms.filter(x => x.ready).slice(0, 8).map(x => h('span.badge.ok', `${x.platform} · ${x.ready}`)))),
    ));
    const pct = st.quota ? Math.round((st.used / st.quota) * 100) : 0;
    box.append(h('div.card', h('h3', '💾 Votre espace fichiers'), h('div.kpi', fmtBytes(st.used)), h('p.small.muted', `sur ${fmtBytes(st.quota)} autorisés`),
      h('div.bar' + (pct > 85 ? '.bad' : pct > 65 ? '.warn' : ''), h('i', { style: { width: pct + '%' } }))));
  } else box.append(h('div.card.notice.bad', status.reason.message));
  if (usage.status === 'fulfilled') {
    const u = usage.value;
    const q = u.role === 'admin' ? u.internal : u.me;
    const total = u.role === 'admin' ? q.pool : q.quota;
    const used = (q.consumed || 0) + (q.reserved || 0);
    const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 100;
    box.append(h('a.card.link', { href: '#/tokens', style: { textDecoration: 'none', color: 'inherit' } },
      h('h3', u.role === 'admin' ? '📊 Pool du mois (tous les comptes)' : '🎟️ Mon quota du mois'),
      h('div.kpi', fmtNum(q.remaining ?? 0), h('span.muted.small', ' tokens restants')),
      h('p.small.muted', `${fmtNum(q.consumed)} consommés (${fmtNum(q.exact)} réels, ${fmtNum(q.estimated)} estimés) sur ${fmtNum(total)}`),
      h('div.bar' + (pct > 90 ? '.bad' : pct > 70 ? '.warn' : ''), h('i', { style: { width: pct + '%' } })),
      h('p.tiny.muted', u.settings?.freeOnly ? '🛡️ Mode gratuit : seuls des fournisseurs gratuits vérifiés avant l’appel.' : '⚠️ Mode gratuit désactivé.'),
    ));
  }
  const cBox = el.querySelector('#home-convs');
  cBox.querySelector('.spinner')?.remove();
  const cl = convs.status === 'fulfilled' ? convs.value.slice(0, 6) : [];
  cBox.append(cl.length ? h('div.stack', cl.map(c => h('a', { href: `#/${c.mode === 'agents' ? 'agents' : 'parler'}?c=${c.id}` }, `${c.mode === 'agents' ? '🤖' : '💬'} ${c.title}`, h('span.muted.tiny', ` · ${fmtDate(c.updatedAt)}`))))
    : h('p.muted.small', 'Aucune conversation dans ce projet pour l’instant.'));
  const fBox = el.querySelector('#home-files');
  fBox.querySelector('.spinner')?.remove();
  const fl = files.status === 'fulfilled' ? files.value.files.slice(0, 6) : [];
  fBox.append(fl.length ? h('div.stack', fl.map(f => h('a', { href: `/api/files/${f.id}`, target: '_blank' }, f.name, h('span.muted.tiny', ` · ${fmtBytes(f.size)}`))))
    : h('p.muted.small', 'Aucun fichier dans ce projet.'));
}

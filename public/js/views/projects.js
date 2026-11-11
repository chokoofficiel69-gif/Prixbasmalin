import { api, h, state, toast, toastErr, confirmBox, fmtDate, fmtBytes, modal } from '../lib/core.js';
import { refreshProjects } from '../app.js';

export async function render(el) {
  const [projects, convs, files] = await Promise.all([api('/api/projects'), api('/api/conversations'), api('/api/files')]);
  const grid = h('div.grid');
  for (const p of projects) {
    const pc = convs.filter(c => c.projectId === p.id);
    const pf = files.files.filter(f => f.projectId === p.id);
    grid.append(h('div.card.stack', { style: { borderTop: `4px solid ${p.color}` } },
      h('h3', p.icon, ' ', p.name, p.id === state.projectId ? h('span.badge.ok', 'actif') : null),
      h('p.small.muted', `${pc.length} conversation(s) · ${pf.length} fichier(s) · ${fmtBytes(pf.reduce((s, f) => s + f.size, 0))}`),
      h('p.small', (p.instructions || '').slice(0, 160) + ((p.instructions || '').length > 160 ? '…' : '')),
      p.memory ? h('p.tiny.muted', `🧠 Mémoire : ${p.memory.split('\n').length} élément(s)`) : null,
      h('div.row',
        h('button.btn.small.primary', { onclick: () => { state.projectId = p.id; localStorage.setItem('studio.project', p.id); refreshProjects().then(() => { location.hash = '#/parler'; }); } }, 'Ouvrir'),
        h('button.btn.small', { onclick: () => edit(p) }, '⚙️ Consignes & mémoire'),
        h('button.btn.small.ghost', { onclick: () => history(p, pc) }, '🕘 Historique')),
    ));
  }
  grid.append(h('div.card.link.stack', { onclick: () => edit(null), style: { placeItems: 'center', textAlign: 'center', borderStyle: 'dashed' } }, h('div', { style: { fontSize: '30px' } }, '＋'), h('b', 'Nouveau projet')));
  el.append(h('div.stack',
    h('p.muted', 'Chaque projet a ses propres consignes (le « rôle » donné aux IA), sa mémoire de travail (faits retenus d’une conversation à l’autre), ses conversations et ses fichiers.'),
    grid,
    h('div.card.stack', h('h3', '💾 Sauvegarde'), h('p.small.muted', 'Téléchargez une copie de tous vos projets, conversations et réglages (les fichiers eux-mêmes restent dans « Fichiers »).'),
      h('div', h('a.btn.small', { href: '/api/export' }, '⬇️ Télécharger la sauvegarde (JSON)'))),
  ));

  async function edit(p) {
    const name = h('input', { value: p?.name || '' });
    const icon = h('input', { value: p?.icon || '📁', style: { width: '70px' } });
    const color = h('input', { type: 'color', value: p?.color || '#6d5dfc', style: { width: '70px' } });
    const instr = h('textarea', { rows: 6, placeholder: 'Ex : « Tu es mon associé pour Prix Malin. Réponds en français, avec du code complet… »' });
    instr.value = p?.instructions || '';
    const mem = h('textarea', { rows: 8, placeholder: 'Faits à retenir : objectifs, décisions prises, préférences, noms, chiffres clés…' });
    mem.value = p?.memory || '';
    const r = await modal(p ? `Projet : ${p.name}` : 'Nouveau projet', h('div.stack',
      h('div.row', h('label.f.grow', 'Nom', name), h('label.f', 'Icône', icon), h('label.f', 'Couleur', color)),
      h('label.f', 'Consignes données aux IA dans ce projet', instr),
      p ? h('label.f', 'Mémoire de travail (envoyée aux IA à chaque échange)', mem) : null,
      p ? h('p.tiny.muted', `Créé le ${fmtDate(p.createdAt)} · modifié le ${fmtDate(p.updatedAt)}`) : null,
    ), [
      ...(p ? [{ label: '🗑️ Supprimer', danger: true, value: 'delete' }] : []),
      { label: 'Annuler', value: false },
      { label: 'Enregistrer', primary: true, value: 'save' },
    ]);
    try {
      if (r === 'save') {
        if (!name.value.trim()) return toast('Nom requis');
        const body = { name: name.value.trim(), icon: icon.value || '📁', color: color.value, instructions: instr.value, memory: mem.value };
        if (p) await api(`/api/projects/${p.id}`, { method: 'PUT', body });
        else await api('/api/projects', { method: 'POST', body });
        toast('Projet enregistré', 'ok');
      } else if (r === 'delete') {
        if (!(await confirmBox(`Supprimer le projet « ${p.name} » ? (impossible s’il contient encore des conversations ou fichiers)`, 'Supprimer', true))) return;
        await api(`/api/projects/${p.id}`, { method: 'DELETE' });
        toast('Projet supprimé', 'ok');
      } else return;
      await refreshProjects();
      el.innerHTML = ''; render(el);
    } catch (e) { toastErr(e); }
  }
  async function history(p, list) {
    await modal(`Historique — ${p.name}`, list.length ? h('div.stack', list.map(c => h('a', { href: `#/${c.mode === 'agents' ? 'agents' : 'parler'}?c=${c.id}`, onclick: () => { state.projectId = p.id; localStorage.setItem('studio.project', p.id); refreshProjects(); document.querySelector('.modal-back')?.remove(); } },
      `${c.mode === 'agents' ? '🤖' : c.mode === 'compare' ? '⚖️' : c.mode === 'voice' ? '🎙️' : '💬'} ${c.title}`, h('span.tiny.muted', ` · ${c.messages} messages · ${fmtDate(c.updatedAt)}`))))
      : h('p.muted', 'Aucune conversation.'));
  }
}

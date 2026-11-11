import { api, h, state, toast, toastErr, confirmBox, promptBox, fmtBytes, fmtDate, uploadFile, fileUrl, kindOf, kindIcon, modal, pickLocalFiles } from '../lib/core.js';

export async function render(el) {
  let scope = 'projet', filter = 'tous';
  const grid = h('div.file-grid');
  const usage = h('div.small.muted');
  const bar = h('div.bar', h('i'));
  const progress = h('div.small');
  const drop = h('div.drop', '📥 Glissez vos fichiers ici, ou touchez pour choisir (photos, vidéos, sons, documents — 300 Mo max par fichier)');

  async function load() {
    const r = await api(`/api/files${scope === 'projet' ? `?project=${state.projectId}` : ''}`);
    const pct = r.quota ? Math.round((r.used / r.quota) * 100) : 0;
    usage.textContent = `Stockage utilisé : ${fmtBytes(r.used)} sur ${fmtBytes(r.quota)} (${pct} %)`;
    bar.className = 'bar' + (pct > 85 ? ' bad' : pct > 65 ? ' warn' : '');
    bar.firstChild.style.width = pct + '%';
    grid.innerHTML = '';
    const list = r.files.filter(f => filter === 'tous' || kindOf(f.type) === filter);
    if (!list.length) grid.append(h('p.empty', 'Aucun fichier ici.'));
    for (const f of list) grid.append(card(f));
  }
  function card(f) {
    const k = kindOf(f.type);
    const thumb = k === 'image' ? h('img', { src: fileUrl(f.id), loading: 'lazy', alt: '' }) : k === 'video' ? h('video', { src: fileUrl(f.id) + '#t=0.5', muted: true, preload: 'metadata', playsInline: true }) : kindIcon(k);
    const proj = state.projects.find(p => p.id === f.projectId);
    return h('div.file-card',
      h('div.thumb', { onclick: () => preview(f) }, thumb),
      h('div.info',
        h('div.name', { title: f.name }, f.name),
        h('span.muted', `${fmtBytes(f.size)} · ${fmtDate(f.createdAt)}`),
        scope !== 'projet' && proj ? h('span.tiny', `${proj.icon} ${proj.name}`) : null,
        h('div.acts',
          h('a.btn.small.ghost', { href: fileUrl(f.id, true), title: 'Télécharger' }, '⬇️'),
          k === 'image' ? h('a.btn.small.ghost', { href: `#/images?edit=${f.id}`, title: 'Retoucher' }, '🖌️') : null,
          k === 'audio' ? h('a.btn.small.ghost', { href: `#/enregistrement?file=${f.id}`, title: 'Ouvrir dans Enregistrement' }, '🎙️') : null,
          h('button.btn.small.ghost', { title: 'Renommer / déplacer', onclick: () => editFile(f) }, '✏️'),
          h('button.btn.small.ghost', { title: 'Supprimer', onclick: async () => {
            if (!(await confirmBox(`Supprimer définitivement « ${f.name} » ?`, 'Supprimer', true))) return;
            await api(`/api/files/${f.id}`, { method: 'DELETE' }).catch(toastErr); load();
          } }, '🗑️'))));
  }
  async function preview(f) {
    const k = kindOf(f.type);
    const url = fileUrl(f.id);
    let content;
    if (k === 'image') content = h('img', { src: url, style: { maxWidth: '100%', borderRadius: '10px' } });
    else if (k === 'video') content = h('video', { src: url, controls: true, playsInline: true, autoplay: true });
    else if (k === 'audio') content = h('audio', { src: url, controls: true, autoplay: true });
    else if (k === 'text' || f.size < 300000 && /json|text|csv|md/.test(f.name)) content = h('pre', { style: { whiteSpace: 'pre-wrap', maxHeight: '60dvh', overflow: 'auto' } }, await (await fetch(url)).text());
    else if (k === 'pdf') content = h('iframe', { src: url, style: { width: '100%', height: '70dvh', border: 0 } });
    else content = h('p', 'Aperçu indisponible : téléchargez le fichier.');
    await modal(f.name, h('div.stack', content, f.prompt ? h('p.small.muted', `Description : ${f.prompt}`) : null, f.model ? h('p.tiny.muted', `Créé par ${f.model}`) : null,
      h('div.row', h('a.btn.small', { href: fileUrl(f.id, true) }, '⬇️ Télécharger'))));
  }
  async function editFile(f) {
    const name = h('input', { value: f.name });
    const proj = h('select', state.projects.map(p => h('option', { value: p.id, selected: p.id === f.projectId }, `${p.icon} ${p.name}`)));
    const r = await modal('Fichier', h('div.stack', h('label.f', 'Nom', name), h('label.f', 'Projet', proj)), [{ label: 'Annuler', value: false }, { label: 'Enregistrer', primary: true, value: true }]);
    if (!r) return;
    await api(`/api/files/${f.id}`, { method: 'PUT', body: { name: name.value, projectId: proj.value } }).catch(toastErr);
    load();
  }
  async function uploadMany(files) {
    let i = 0;
    for (const f of files) {
      i++;
      progress.innerHTML = `<span class="spinner"></span> Envoi ${i}/${files.length} : ${f.name} (${fmtBytes(f.size)})`;
      try { await uploadFile(f); } catch (e) { toastErr(e); }
    }
    progress.textContent = files.length ? `✓ ${files.length} fichier(s) envoyé(s)` : '';
    load();
  }
  drop.onclick = async () => uploadMany(await pickLocalFiles('*/*'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); uploadMany([...e.dataTransfer.files]); });

  const tabs = h('div.tabs');
  const drawTabs = () => {
    tabs.innerHTML = '';
    for (const [k, l] of [['projet', 'Ce projet'], ['tous', 'Tous les projets']]) tabs.append(h('button.btn.small' + (scope === k ? '.active' : ''), { onclick: () => { scope = k; drawTabs(); load(); } }, l));
    tabs.append(h('span', { style: { width: '12px' } }));
    for (const [k, l] of [['tous', 'Tout'], ['image', '🖼️ Images'], ['video', '🎞️ Vidéos'], ['audio', '🎧 Sons'], ['text', '📄 Textes'], ['pdf', '📕 PDF']]) tabs.append(h('button.btn.small' + (filter === k ? '.active' : ''), { onclick: () => { filter = k; drawTabs(); load(); } }, l));
  };
  drawTabs();
  el.append(h('div.stack', drop, progress, h('div.card.stack', usage, bar), tabs, grid));
  await load();
}

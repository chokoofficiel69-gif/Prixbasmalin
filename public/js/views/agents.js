import { api, sse, h, state, md, toast, toastErr, modelSelect, fmtNum, uploadFile, promptBox, downloadBlob } from '../lib/core.js';

const TEAMS = {
  dev: { label: '💼 Équipe dev (Prix Malin)', mode: 'chef', agents: [
    { name: 'Architecte', role: 'architecte logiciel : conçoit la solution, les choix techniques, la structure et les risques', model: 'auto:smart' },
    { name: 'Développeur', role: 'développeur full-stack : écrit le code complet, prêt à l’emploi, avec explications courtes', model: 'auto:smart' },
    { name: 'Testeur', role: 'testeur et relecteur critique : traque les bugs, failles de sécurité et cas limites, propose des tests', model: 'auto' },
  ] },
  recherche: { label: '🔎 Recherche & analyse', mode: 'equipe', agents: [
    { name: 'Chercheur', role: 'chercheur : rassemble les faits, les options et les données utiles (en signalant les incertitudes)', model: 'auto:smart' },
    { name: 'Analyste', role: 'analyste : compare, chiffre, identifie avantages, inconvénients et risques', model: 'auto' },
    { name: 'Rédacteur', role: 'rédacteur : rend le tout clair, structuré et actionnable', model: 'auto:fast' },
  ] },
  musique: { label: '🎵 Équipe musique', mode: 'equipe', agents: [
    { name: 'Parolier', role: 'parolier rap/chanson francophone : écrit couplets et refrains avec rimes riches, images fortes et flow', model: 'auto:smart' },
    { name: 'Directeur artistique', role: 'directeur artistique : propose BPM, tonalité, ambiance, instruments, structure et références', model: 'auto' },
    { name: 'Critique', role: 'critique exigeant : repère les rimes faibles, clichés et longueurs, propose des améliorations précises', model: 'auto' },
  ] },
  clip: { label: '🎬 Équipe clip', mode: 'equipe', agents: [
    { name: 'Scénariste', role: 'scénariste : écrit l’histoire du clip et l’intention visuelle', model: 'auto:smart' },
    { name: 'Réalisateur', role: 'réalisateur : découpe plan par plan (durée, cadrage, mouvement, transition, texte à l’écran)', model: 'auto' },
    { name: 'Monteur', role: 'monteur : rythme, synchronisation sur la musique, ordre des photos/vidéos, effets', model: 'auto' },
  ] },
  debat: { label: '⚖️ Débat contradictoire', mode: 'debat', agents: [
    { name: 'Pour', role: 'défend l’idée avec les meilleurs arguments', model: 'auto:smart' },
    { name: 'Contre', role: 'attaque l’idée avec les meilleurs contre-arguments', model: 'auto' },
  ] },
};
const MODES = [['chef', '👑 Chef de projet (répartit le travail)'], ['equipe', '🔗 À la chaîne (chacun complète)'], ['parallele', '⚡ En parallèle (réponses indépendantes)'], ['debat', '⚖️ Débat (plusieurs tours)']];

export async function render(el, { params }) {
  let team = JSON.parse(localStorage.getItem('studio.agents') || 'null') || structuredClone(TEAMS.dev);
  let controller = null;
  const saveTeam = () => localStorage.setItem('studio.agents', JSON.stringify(team));

  const teamSel = h('select', { onchange: () => { if (teamSel.value) { team = structuredClone(TEAMS[teamSel.value]); saveTeam(); drawAgents(); modeSel.value = team.mode; } } },
    h('option', { value: '' }, 'Charger une équipe type…'), Object.entries(TEAMS).map(([k, t]) => h('option', { value: k }, t.label)));
  const modeSel = h('select', { onchange: () => { team.mode = modeSel.value; saveTeam(); } }, MODES.map(([v, l]) => h('option', { value: v }, l)));
  modeSel.value = team.mode || 'equipe';
  const synthSel = modelSelect('auto:smart', { includeFusion: false });
  const agentsBox = h('div.stack');
  const task = h('textarea', { rows: 5, placeholder: 'Décrivez la tâche. Ex : « Conçois un script qui compare les prix de 3 sites et m’envoie un résumé chaque matin » ou « Écris un rap de 2 couplets + refrain sur la persévérance »' });
  const runBtn = h('button.btn.primary', '▶ Lancer l’équipe');
  const out = h('div.stack');

  function drawAgents() {
    agentsBox.innerHTML = '';
    team.agents.forEach((a, i) => {
      const ms = modelSelect(a.model || 'auto', { includeFusion: false });
      ms.onchange = () => { a.model = ms.value; saveTeam(); };
      const name = h('input', { value: a.name, oninput: (e) => { a.name = e.target.value; saveTeam(); } });
      const role = h('textarea', { rows: 2, oninput: (e) => { a.role = e.target.value; saveTeam(); } });
      role.value = a.role;
      agentsBox.append(h('div.agent-card',
        h('div.row', h('strong', `Agent ${i + 1}`), h('span.grow'), h('button.btn.ghost.small', { onclick: () => { team.agents.splice(i, 1); saveTeam(); drawAgents(); } }, '✕')),
        h('div.row', h('div.grow', name), h('div.grow', ms)), role));
    });
    if (team.agents.length < 6) agentsBox.append(h('button.btn.small', { onclick: () => { team.agents.push({ name: `Agent ${team.agents.length + 1}`, role: 'expert', model: 'auto' }); saveTeam(); drawAgents(); } }, '＋ Ajouter un agent'));
  }
  drawAgents();

  runBtn.onclick = async () => {
    if (controller) { controller.abort(); return; }
    if (!task.value.trim()) return toast('Décrivez la tâche.');
    if (!team.agents.length) return toast('Ajoutez au moins un agent.');
    out.innerHTML = '';
    controller = new AbortController();
    runBtn.textContent = '■ Arrêter';
    const steps = {};
    const transcript = [];
    let finalText = '';
    let tokens = 0;
    try {
      await sse('/api/agents/run', { projectId: state.projectId, task: task.value, agents: team.agents, mode: modeSel.value, rounds: 2, synthModel: synthSel.value }, (ev) => {
        if (ev.type === 'step') {
          const body = h('div.md', h('span.spinner'));
          const meta = h('span.tiny.muted');
          const isFinal = ev.agent === 'Synthèse';
          const box = h('div.step' + (isFinal ? '.final' : ''), h('header', h('span', isFinal ? '🏁' : '🤖'), ev.agent, h('span.badge', ev.title), h('span.grow'), meta), body);
          steps[ev.id] = { box, body, meta, text: '', agent: ev.agent, title: ev.title };
          out.append(box);
          box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (ev.type === 'delta' && steps[ev.id] && ev.content) {
          const s = steps[ev.id]; s.text += ev.content;
          if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; s.body.innerHTML = md(s.text); });
        } else if (ev.type === 'done' && steps[ev.id]) {
          const s = steps[ev.id];
          s.body.innerHTML = ev.error ? `<span class="bad-t">⚠️ ${ev.error.replace(/</g, '&lt;')}</span>` : md(s.text);
          s.meta.textContent = ev.error ? '' : `${ev.routedVia || ''} · ${fmtNum(ev.usage?.total)} tokens · ${((ev.ms || 0) / 1000).toFixed(1)} s`;
          tokens += ev.usage?.total || 0;
          transcript.push({ role: 'assistant', content: `**${s.agent} — ${s.title}**\n\n${s.text || ev.error}`, routedVia: ev.routedVia, usage: ev.usage });
        } else if (ev.type === 'final') finalText = ev.content;
        else if (ev.type === 'error') out.append(h('div.notice.bad', ev.error));
      }, controller.signal);
    } catch (e) { if (e.name !== 'AbortError') toastErr(e); }
    controller = null;
    runBtn.textContent = '▶ Lancer l’équipe';
    if (transcript.length) {
      const id = 'a' + Date.now().toString(36);
      await api(`/api/conversations/${id}`, { method: 'PUT', body: { id, projectId: state.projectId, mode: 'agents', title: '🤖 ' + task.value.slice(0, 55), model: modeSel.value, messages: [{ role: 'user', content: task.value }, ...transcript] } }).catch(toastErr);
      if (finalText) {
        out.append(h('div.row',
          h('span.muted.small', `Total : ${fmtNum(tokens)} tokens · enregistré dans l’historique du projet.`),
          h('button.btn.small', { onclick: async () => { const n = await promptBox('Nom du fichier', 'livrable-agents.md'); if (n) uploadFile(new Blob([finalText], { type: 'text/markdown' }), { name: n, source: 'agents' }).then(() => toast('Enregistré dans Fichiers', 'ok')).catch(toastErr); } }, '💾 Enregistrer le livrable'),
          h('button.btn.small', { onclick: () => downloadBlob(new Blob([finalText], { type: 'text/markdown' }), 'livrable.md') }, '⬇️ Télécharger'),
          h('button.btn.small', { onclick: async () => { await api(`/api/projects/${state.projectId}/memory`, { method: 'POST', body: { note: `Livrable agents : ${task.value.slice(0, 120)} → ${finalText.slice(0, 600)}` } }); toast('Ajouté à la mémoire du projet', 'ok'); } }, '🧠 Mémoriser'),
        ));
      }
    }
  };

  // Ouverture d'un historique d'agents existant
  const cid = params.get('c');
  if (cid) {
    try {
      const c = await api(`/api/conversations/${cid}`);
      task.value = c.messages?.[0]?.content || '';
      for (const m of c.messages.slice(1)) out.append(h('div.step', h('div.md', { html: md(m.content) }), m.routedVia ? h('div.tiny.muted', m.routedVia) : null));
    } catch (e) { toastErr(e); }
  }

  el.append(h('div.grid.two',
    h('div.card.stack',
      h('h3', '👥 Votre équipe d’IA'),
      h('p.small.muted', 'Chaque agent a un rôle et peut utiliser un modèle différent. Ils travaillent ensemble puis une synthèse produit le livrable final.'),
      h('div.row', h('div.grow', teamSel)),
      h('label.f', 'Façon de travailler', modeSel),
      agentsBox,
      h('label.f', 'Modèle de la synthèse finale', synthSel),
    ),
    h('div.card.stack',
      h('h3', '🎯 Tâche'),
      task,
      h('div.row', runBtn, h('span.small.muted', 'Chaque agent consomme des tokens : surveillez « Suivi des tokens ».')),
      out,
    ),
  ));
  return () => controller?.abort();
}

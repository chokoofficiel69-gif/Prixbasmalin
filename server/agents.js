// Orchestration multi-agents : plusieurs IA (rôles + modèles) travaillent sur une même tâche.
import { chat } from './llm.js';

const clip = (s, n = 6000) => (s && s.length > n ? s.slice(0, n) + '\n[…]' : s || '');

function agentSystem(agent, projectContext) {
  return [
    `Tu es « ${agent.name} ». Rôle : ${agent.role}`,
    'Tu fais partie d’une équipe d’IA qui travaille ensemble. Réponds en français, de façon concrète et utile, sans répéter ce que les autres ont déjà dit.',
    projectContext ? `Contexte du projet :\n${projectContext}` : '',
  ].filter(Boolean).join('\n\n');
}

function extractJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/**
 * modes : 'equipe' (chaîne), 'parallele', 'debat', 'chef' (un coordinateur répartit le travail).
 * emit(evt) reçoit : {type:'step', id, agent, title} {type:'delta', id, content|reasoning} {type:'done', id, ...} {type:'final', ...}
 */
export async function runAgents({ task, agents, mode = 'equipe', rounds = 2, synthModel = 'auto', projectContext = '', emit, signal }) {
  if (!agents?.length) throw new Error('Ajoutez au moins un agent.');
  agents = agents.slice(0, 6);
  const transcript = [];
  let stepNo = 0;

  async function runOne(agent, userPrompt, title) {
    const id = `s${++stepNo}`;
    emit({ type: 'step', id, agent: agent.name, model: agent.model || 'auto', title });
    try {
      const r = await chat({
        model: agent.model || 'auto',
        src: 'agents',
        signal,
        messages: [
          { role: 'system', content: agentSystem(agent, projectContext) },
          { role: 'user', content: userPrompt },
        ],
        onDelta: (d) => emit({ type: 'delta', id, ...d }),
      });
      emit({ type: 'done', id, agent: agent.name, routedVia: r.routedVia, usage: r.usage, ms: r.ms });
      transcript.push({ agent: agent.name, title, content: r.content });
      return r.content;
    } catch (err) {
      emit({ type: 'done', id, agent: agent.name, error: err.message });
      transcript.push({ agent: agent.name, title, content: `(échec : ${err.message})` });
      return '';
    }
  }

  const history = () => transcript.map(t => `### ${t.agent} — ${t.title}\n${clip(t.content, 4000)}`).join('\n\n');

  if (mode === 'parallele') {
    await Promise.all(agents.map(a => runOne(a, `Tâche :\n${task}`, 'Proposition indépendante')));
  } else if (mode === 'debat') {
    for (const a of agents) await runOne(a, `Tâche :\n${task}\n\nDonne ta position initiale, argumentée.`, 'Position initiale');
    for (let r = 1; r < Math.max(1, Math.min(rounds, 4)); r++) {
      for (const a of agents) {
        await runOne(a, `Tâche :\n${task}\n\nÉchanges précédents :\n${history()}\n\nRéagis aux autres : ce qui est juste, ce qui est faux, ce qui manque. Améliore ta proposition.`, `Tour ${r + 1}`);
      }
    }
  } else if (mode === 'chef') {
    const lead = { name: 'Coordinateur', role: 'chef de projet qui découpe le travail et le confie aux bons agents', model: synthModel };
    const roster = agents.map(a => `- ${a.name} : ${a.role}`).join('\n');
    const plan = await runOne(lead,
      `Tâche :\n${task}\n\nÉquipe disponible :\n${roster}\n\nDécoupe la tâche en 2 à ${Math.min(6, agents.length * 2)} étapes ordonnées et attribue chacune à un agent de l'équipe. Réponds UNIQUEMENT avec du JSON :\n{"etapes":[{"agent":"Nom exact","consigne":"..."}]}`,
      'Plan de travail');
    const parsed = extractJson(plan);
    const steps = Array.isArray(parsed?.etapes) ? parsed.etapes : agents.map(a => ({ agent: a.name, consigne: task }));
    for (const s of steps.slice(0, 8)) {
      const agent = agents.find(a => a.name.toLowerCase() === String(s.agent || '').toLowerCase()) || agents[0];
      await runOne(agent, `Tâche globale :\n${task}\n\nTravail déjà fait :\n${history() || '(rien)'}\n\nTa mission maintenant : ${s.consigne}`, String(s.consigne || 'Étape').slice(0, 80));
    }
  } else {
    // 'equipe' : chaque agent complète le travail des précédents
    for (const a of agents) {
      await runOne(a, `Tâche :\n${task}\n\nTravail de l'équipe jusqu'ici :\n${history() || '(tu es le premier)'}\n\nApporte ta contribution selon ton rôle.`, 'Contribution');
    }
  }

  // Synthèse finale
  const synth = { name: 'Synthèse', role: 'rédacteur final qui fusionne le travail de l’équipe en un livrable unique, clair et directement utilisable', model: synthModel };
  const final = await runOne(synth, `Tâche :\n${task}\n\nTravail de l'équipe :\n${history()}\n\nProduis le livrable final complet (pas un résumé des échanges).`, 'Livrable final');
  emit({ type: 'final', content: final });
  return { transcript, final };
}

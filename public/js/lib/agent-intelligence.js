// Mémoire conversationnelle courte et validation stricte des actions de l'assistant studio.
const ACTIONS = new Set([
  'record','stop','pause','play','select','clean','align','voice','tune','effect',
  'cut','keep','trim','fades','normalize','undo','redo','original','volume',
  'mute','delete','all','master','versions','save','download','importInstru','dropLastVoice'
]);

export function buildAgentContext(history = [], snapshot = {}) {
  const turns = (Array.isArray(history) ? history : []).slice(-16)
    .filter(x => x && (x.role === 'user' || x.role === 'assistant'))
    .map(x => ({ role: x.role, content: String(x.content || '').slice(0, 1000) }));
  return [
    'CONTEXTE DU STUDIO : ' + JSON.stringify(snapshot),
    'DERNIERS ÉCHANGES : ' + JSON.stringify(turns),
    'RÈGLE : réponds à la dernière demande en tenant compte du contexte, sans faire répéter l’artiste.'
  ].join('\n');
}

export function validateAgentActions(actions, utterance = '') {
  if (!Array.isArray(actions)) return [];
  const explicitDelete = /\b(supprime|supprimer|efface|effacer|retire|retirer)\b/i.test(String(utterance));
  const out = [];
  for (const raw of actions.slice(0, 8)) {
    if (!raw || typeof raw !== 'object' || !ACTIONS.has(raw.a)) continue;
    if (raw.a === 'delete' && !explicitDelete) continue;
    const x = { a: raw.a };
    if (raw.a === 'record') {
      if (raw.seconds !== undefined) x.seconds = Math.max(0, Math.min(600, Number(raw.seconds) || 0));
    } else if (['play'].includes(raw.a)) {
      x.what = ['tout','voix','master'].includes(raw.what) ? raw.what : 'tout';
    } else if (['select','volume','mute','delete'].includes(raw.a)) {
      if (raw.track !== undefined) {
        if (raw.a === 'volume' && ['voix','instru'].includes(raw.track)) x.track = raw.track;
        else x.track = Math.max(-1, Math.min(100, Math.trunc(Number(raw.track) || 1)));
      }
      if (raw.a === 'volume') {
        if (raw.delta !== undefined) x.delta = Math.max(-12, Math.min(12, Number(raw.delta) || 0));
        else x.db = Math.max(-30, Math.min(12, Number(raw.db) || 0));
      }
      if (raw.a === 'mute') x.on = raw.on !== false;
    } else if (raw.a === 'clean') {
      x.level = Math.max(0.2, Math.min(0.9, Number(raw.level) || 0.55));
    } else if (raw.a === 'tune') {
      x.level = ['parfait','leger','moyen','fort','belle'].includes(raw.level) ? raw.level : 'leger';
    } else if (raw.a === 'voice') {
      if (['rap','chant','podcast','brut'].includes(raw.preset)) x.preset = raw.preset;
      else if (raw.params && typeof raw.params === 'object') x.params = raw.params;
      else continue;
    } else if (raw.a === 'effect') {
      if (!Array.isArray(raw.chain)) continue;
      x.name = String(raw.name || 'Effet').slice(0, 40);
      x.chain = raw.chain.slice(0, 6).filter(s => s && typeof s === 'object' && (
        (s.t === 'fx' && ['reverb','delay','pingpong','chorus','flanger','warm','tube','tape','exciter','air','peak','distort','band','lofi'].includes(s.kind)) ||
        (s.t === 'tune') || (s.t === 'shift') || (s.t === 'double') || (s.t === 'harmony')
      ));
      if (!x.chain.length) continue;
      if (raw.voice && typeof raw.voice === 'object') x.voice = raw.voice;
    } else if (raw.a === 'cut' || raw.a === 'keep') {
      x.from = Math.max(0, Number(raw.from) || 0);
      x.to = Math.max(0, Number(raw.to) || 0);
      if (x.to <= x.from) continue;
    } else if (raw.a === 'master') {
      x.preset = ['streaming','rap','club','doux'].includes(raw.preset) ? raw.preset : 'streaming';
    }
    out.push(x);
  }
  return out;
}

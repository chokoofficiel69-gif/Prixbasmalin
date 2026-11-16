import { api, sse, h, state, md, toast, toastErr, speak, stopSpeaking } from '../lib/core.js';
import { expertFace } from '../lib/expertface.js';

const makeId = () => 'c' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
const SYSTEM = [
  'Tu es le compagnon personnel de l’utilisateur dans Studio IA.',
  'Tu es une intelligence unique qui peut parler avec deux identités visuelles : La Rue (masculine) et La Ruse (féminine). Le changement d’avatar ne change ni ton intelligence, ni ta mémoire, ni tes projets, ni tes engagements.',
  'Tu es naturel, chaleureux sans flatterie, direct et fiable. Tu parles français et tu tutoies. Tu ne prétends jamais avoir effectué une action que tu n’as pas réellement effectuée.',
  'Tu aides sur tous les sujets : projets, démarches, organisation, création, musique, recherche et apprentissage. Quand tu ne peux pas agir directement, explique clairement la limite et propose l’étape réalisable.',
  'Pour une action sensible (achat, paiement, publication, envoi, suppression, partage de données ou modification irréversible), demande une confirmation explicite avant exécution.',
  'Ne prétends pas contrôler l’ordinateur ou naviguer sur Internet si aucun outil correspondant n’a été exécuté. Distingue toujours conseil, préparation et action réellement accomplie.'
].join('\n');

export async function render(el) {
  const projectId = state.projects.find(p => p.id === 'perso')?.id || state.projectId || state.projects[0]?.id;
  let profile = await api('/api/companion');
  let avatar = profile.avatar || 'rue';
  let conv = null;
  let controller = null;
  let busy = false;
  let conversations = [];

  const shell = h('div.stack', { style: { gap: '14px', maxWidth: '1100px', margin: '0 auto' } });
  const top = h('div.card.stack', { style: { gap: '12px' } });
  const title = h('div.row', h('div.grow', h('h2', 'Ton compagnon personnel'), h('p.small.muted', 'Deux avatars, une seule intelligence, une mémoire commune.')));
  const avatarRow = h('div.row', { style: { flexWrap: 'wrap', gap: '10px', alignItems: 'center' } });
  const face = expertFace({ name: avatar === 'rue' ? 'La Rue' : 'La Ruse', role: 'Compagnon personnel · IA', avatar });
  const rueBtn = h('button.btn', { onclick: () => chooseAvatar('rue') }, '👨🏻‍💻 La Rue');
  const ruseBtn = h('button.btn', { onclick: () => chooseAvatar('ruse') }, '👩🏻‍💻 La Ruse');
  const status = h('span.small.muted', 'Prêt à discuter.');
  avatarRow.append(rueBtn, ruseBtn, h('span.grow'), status);
  const memory = h('textarea', { rows: 4, placeholder: 'Ce que ton compagnon doit retenir durablement : tes préférences, tes objectifs, les décisions importantes…', value: profile.memory || '' });
  const memorySave = h('button.btn.small', { onclick: saveMemory }, '🧠 Enregistrer la mémoire commune');
  const bridgeInput = h('input', { placeholder: 'Identifiant de l’extension Chrome', value: localStorage.getItem('studio.companion.extensionId') || '' });
  const bridgeSave = h('button.btn.small', { onclick: () => { localStorage.setItem('studio.companion.extensionId', bridgeInput.value.trim()); toast('Relais navigateur enregistré sur cet appareil.', 'ok'); } }, 'Connecter le navigateur');
  const bridgeRow = h('div.row', { style: { gap: '8px', flexWrap: 'wrap' } }, bridgeInput, bridgeSave);
  bridgeInput.style.flex = '1';
  top.append(title, face.el, avatarRow, h('div.small.muted', 'La mémoire ci-dessous est partagée par La Rue et La Ruse et reste enregistrée dans ton espace Studio.'), memory, memorySave,
    h('div.stack', { style: { gap: '6px', marginTop: '8px' } }, h('b', 'Relais navigateur Chrome'), h('p.small.muted', 'Installe le dossier companion-bridge du dépôt en extension non empaquetée, puis colle ici son identifiant Chrome. Les lectures, clics et saisies demanderont une autorisation.'), bridgeRow));

  const layout = h('div.grid', { style: { gridTemplateColumns: 'minmax(190px, 250px) minmax(0, 1fr)', gap: '12px', alignItems: 'stretch' } });
  const side = h('div.card.stack', { style: { gap: '8px' } });
  const list = h('div.stack', { style: { gap: '6px', maxHeight: '520px', overflow: 'auto' } });
  const newBtn = h('button.btn.primary', { onclick: newConversation }, '＋ Nouvelle discussion');
  side.append(newBtn, h('h3', 'Historique'), list);
  const chat = h('div.card.stack', { style: { minHeight: '560px', gap: '10px' } });
  const transcript = h('div.stack', { style: { flex: '1', minHeight: '350px', maxHeight: '560px', overflow: 'auto', gap: '10px' } });
  const composer = h('div.row', { style: { alignItems: 'end', gap: '8px' } });
  const input = h('textarea', { rows: 2, placeholder: 'Parle-lui de tes projets, pose une question ou demande-lui de t’aider…' });
  const send = h('button.btn.primary', { onclick: sendMessage }, 'Envoyer');
  const voice = h('button.btn', { onclick: () => { const last = [...(conv?.messages || [])].reverse().find(m => m.role === 'assistant'); if (last) speak(last.content, { preferBrowser: true, voiceGender: avatar === 'ruse' ? 'female' : 'male' }); } }, '🔊 Écouter');
  input.style.flex = '1';
  composer.append(input, send, voice);
  chat.append(h('div.row', h('h3.grow', 'Conversation'), h('span.small.muted', 'Historique sauvegardé automatiquement')), transcript, composer);
  layout.append(side, chat);
  shell.append(top, layout);
  el.append(shell);

  function drawAvatar() {
    rueBtn.classList.toggle('primary', avatar === 'rue');
    ruseBtn.classList.toggle('primary', avatar === 'ruse');
    status.textContent = avatar === 'rue' ? 'La Rue est avec toi.' : 'La Ruse est avec toi.';
    face.setAvatar(avatar);
  }
  async function chooseAvatar(next) {
    if (next === avatar) return;
    avatar = next;
    drawAvatar();
    face.setAvatar(avatar);
    try { profile = await api('/api/companion', { method: 'PUT', body: { avatar } }); toast('Avatar changé — mémoire et conversation conservées.', 'ok'); }
    catch (e) { toastErr(e); }
  }
  async function saveMemory() {
    try {
      profile = await api('/api/companion', { method: 'PUT', body: { memory: memory.value } });
      memory.value = profile.memory || '';
      toast('Mémoire commune enregistrée.', 'ok');
    } catch (e) { toastErr(e); }
  }
  async function loadList() {
    conversations = await api('/api/conversations?project=' + encodeURIComponent(projectId)).catch(() => []);
    conversations = conversations.filter(c => c.mode === 'companion');
    list.innerHTML = '';
    for (const item of conversations) {
      const b = h('button.btn.ghost', { style: { textAlign: 'left', whiteSpace: 'normal' }, onclick: () => openConversation(item.id) }, (item.title || 'Discussion').slice(0, 48));
      list.append(b);
    }
    if (!conversations.length) list.append(h('p.small.muted', 'Tes discussions apparaîtront ici.'));
  }
  function drawMessages() {
    transcript.innerHTML = '';
    if (!conv?.messages?.length) {
      transcript.append(h('div.card', h('h3', avatar === 'rue' ? 'Salut, moi c’est La Rue.' : 'Salut, moi c’est La Ruse.'), h('p', 'Je suis ton compagnon IA. On garde la même mémoire et les mêmes projets, même si tu changes d’avatar.')));
      return;
    }
    for (const m of conv.messages) {
      const bubble = h('div.card.stack', { style: { maxWidth: '88%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', background: m.role === 'user' ? 'var(--surface-2, #202b3a)' : 'var(--surface, #151d29)' } });
      bubble.append(h('div.small.muted', m.role === 'user' ? 'Toi' : (avatar === 'rue' ? 'La Rue' : 'La Ruse')));
      const body = h('div');
      if (m.role === 'assistant') body.innerHTML = md(m.content || '');
      else body.textContent = m.content || '';
      bubble.append(body);
      transcript.append(bubble);
    }
    transcript.scrollTop = transcript.scrollHeight;
  }
  async function saveConversation() {
    if (!conv) return;
    const first = conv.messages.find(m => m.role === 'user');
    if (conv.title === 'Nouvelle discussion' && first) conv.title = (first.content || 'Discussion').slice(0, 60);
    await api('/api/conversations/' + conv.id, { method: 'PUT', body: conv });
    await loadList();
  }
  function newConversation() {
    controller?.abort();
    conv = { id: makeId(), projectId, title: 'Nouvelle discussion', mode: 'companion', model: 'auto', messages: [] };
    drawMessages();
    input.focus();
  }
  async function openConversation(id) {
    controller?.abort();
    try {
      conv = await api('/api/conversations/' + id);
      drawMessages();
    } catch (e) { toastErr(e); }
  }
  async function handleBrowserRequest(ev) {
    const extensionId = (bridgeInput.value || localStorage.getItem('studio.companion.extensionId') || '').trim();
    let result;
    if (!extensionId) result = { error: 'Relais Chrome non configuré. Installe companion-bridge et renseigne son identifiant dans le panneau du compagnon.' };
    else {
      if (ev.command?.action === 'open' && !window.confirm((ev.command.description || 'Ouvrir une page web') + '\\n\\n' + ev.command.url)) {
        result = { error: 'Ouverture refusée par l’utilisateur.' };
      } else {
        try {
          if (!window.chrome?.runtime?.sendMessage) throw new Error('API Chrome indisponible. Ouvre Studio IA dans Chrome.');
          result = await new Promise((resolve, reject) => {
            window.chrome.runtime.sendMessage(extensionId, { type: 'STUDIO_COMPANION_COMMAND', command: ev.command }, response => {
              const error = window.chrome.runtime.lastError;
              if (error) reject(new Error(error.message));
              else resolve(response || { error: 'Le relais Chrome n’a pas répondu.' });
            });
          });
        } catch (e) { result = { error: 'Relais navigateur indisponible : ' + e.message }; }
      }
    }
    try { await api('/api/companion/browser-result', { method: 'POST', body: { requestId: ev.requestId, result } }); }
    catch (e) { status.textContent = 'Retour navigateur non transmis : ' + e.message; }
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || busy) return;
    if (!conv) newConversation();
    input.value = '';
    conv.messages.push({ role: 'user', content: text });
    drawMessages();
    busy = true; send.disabled = true; status.textContent = 'Je réfléchis…';
    controller = new AbortController();
    const answer = { role: 'assistant', content: '' };
    conv.messages.push(answer);
    try {
      const memoryText = profile.memory ? '\n\nMÉMOIRE PERSONNELLE DURABLE (commune aux deux avatars) :\n' + profile.memory : '';
      await sse('/api/companion/run', {
        projectId,
        model: localStorage.getItem('studio.model') || 'auto',
        system: SYSTEM + memoryText,
        messages: conv.messages.filter(m => m.content).map(m => ({ role: m.role, content: m.content }))
      }, (ev) => {
        if (ev.type === 'tool_start') status.textContent = 'J’utilise : ' + ev.tool;
        if (ev.type === 'browser_request') { status.textContent = 'En attente de ton autorisation navigateur…'; void handleBrowserRequest(ev); }
        if (ev.type === 'tool_result') status.textContent = ev.summary || 'Outil terminé.';
        if (ev.type === 'delta' && ev.content) { answer.content += ev.content; drawMessages(); }
        if (ev.type === 'error') answer.content = 'Je rencontre un problème : ' + ev.error;
      }, controller.signal);
      if (!answer.content) answer.content = 'Je n’ai pas reçu de réponse exploitable. Réessaie.';
    } catch (e) {
      if (e.name !== 'AbortError') answer.content = 'Erreur : ' + e.message;
      else answer.content += '\n\n*(interrompu)*';
    } finally {
      busy = false; controller = null; send.disabled = false; status.textContent = avatar === 'rue' ? 'La Rue est avec toi.' : 'La Ruse est avec toi.';
      drawMessages();
      await saveConversation().catch(toastErr);
    }
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); } });
  drawAvatar();
  await loadList();
  newConversation();
  return () => { controller?.abort(); stopSpeaking(); };
}

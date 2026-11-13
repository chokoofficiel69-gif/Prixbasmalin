// Faux FreeLLMAPI pour les tests locaux (API compatible OpenAI).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const A = path.join(path.dirname(new URL(import.meta.url).pathname), 'assets');
const KEY = 'freellmapi-test';
const calls = [];
const models = [
  { id: 'gpt-oss-120b', owned_by: 'ovh', name: 'GPT-OSS 120B', execution_status: 'ready', available: true },
  { id: 'qwen3-32b', owned_by: 'ovh', name: 'Qwen3 32B', execution_status: 'ready', available: true },
  { id: 'llama-3.3-70b', owned_by: 'groq', name: 'Llama 3.3 70B', execution_status: 'exhausted', available: true },
  { id: 'deepseek-chat', owned_by: 'deepseek', name: 'DeepSeek Chat', execution_status: 'ready', available: true },
  { id: 'gemini-2.5-flash', owned_by: 'google', name: 'Gemini 2.5 Flash', execution_status: 'needsKey', available: false },
];
function reply(messages, model) {
  const last = messages[messages.length - 1];
  const text = typeof last.content === 'string' ? last.content : last.content.map(p => p.text || '[image]').join(' ');
  const sys = messages.find(m => m.role === 'system')?.content || '';
  if (/réalisateur de clips/.test(sys)) return JSON.stringify({ titre: 'Clip test', personnage: 'young man, short beard, black tracksuit', plans: [
    { debut: 0, fin: 1.5, paroles: 'Bonjour le studio.', type: 'performance', scene: 'Il rappe face caméra', camera: 'plan serré, travelling avant', image_prompt: 'young man rapping, photorealistic', video_prompt: 'young man rapping to camera' },
    { debut: 1.5, fin: 3, paroles: 'Deuxième phrase.', type: 'histoire', scene: 'Il roule à moto la nuit', camera: 'plan large', image_prompt: 'young man on a motorbike at night', video_prompt: 'motorbike ride at night' }] });
  if (/assistant d'un studio d'enregistrement/.test(sys)) {
    const said = (text.match(/L'artiste dit : « (.*) »/) || [])[1] || '';
    if (/enregistre/.test(said)) return JSON.stringify({ reponse: 'Vas-y, je lance.', actions: [{ a: 'record' }, { a: 'clean', level: 0.5 }, { a: 'voice', preset: 'rap' }] });
    if (/nettoie/.test(said)) return JSON.stringify({ reponse: 'Je nettoie et je cale.', actions: [{ a: 'clean', level: 0.5 }, { a: 'align' }, { a: 'voice', preset: 'rap' }] });
    if (/réverbe/.test(said)) return JSON.stringify({ reponse: 'Un peu plus de réverbe.', actions: [{ a: 'effect', name: 'Réverbe +', chain: [{ t: 'fx', kind: 'reverb', size: 1.6, mix: 0.15 }] }] });
    if (/coupe/.test(said)) return JSON.stringify({ reponse: 'Je coupe.', actions: [{ a: 'cut', from: 0, to: 0.5 }] });
    if (/masterise/.test(said)) return JSON.stringify({ reponse: 'Master Spotify.', actions: [{ a: 'master', preset: 'streaming' }, { a: 'save' }] });
    return JSON.stringify({ reponse: 'Salut, on enregistre ?', actions: [] });
  }
  if (/ingénieur du son/.test(sys)) return JSON.stringify({ propositions: [
    { nom: 'Drake chaud discret', pourquoi: 'Justesse douce et chaleur.', chaine: [{ t: 'tune', strength: 0.9, speed: 30 }, { t: 'fx', kind: 'warm' }], voix: { highpass: 90, presence: 3, air: 2, comp: 0.6, reverb: 0.08 } },
    { nom: 'Drake écho', pourquoi: 'Plus d’ampleur.', chaine: [{ t: 'tune', strength: 1, speed: 20 }, { t: 'fx', kind: 'delay', time: 0.3, fb: 0.3, mix: 0.2 }, { t: 'fx', kind: 'inconnu' }] },
    { nom: 'Invalide', chaine: [{ t: 'rm -rf' }] }] });
  if (/UNIQUEMENT un objet JSON/.test(sys) || /JSON attendu|Réponds UNIQUEMENT avec du JSON|"etapes"/.test(text)) {
    if (/"etapes"/.test(text)) return '```json\n{"etapes":[{"agent":"Architecte","consigne":"Plan"},{"agent":"Développeur","consigne":"Code"}]}\n```';
    if (/plans/.test(text)) return '{"titre":"Mon été","plans":[{"media":1,"duree_secondes":2,"transition":"zoom","effet":"zoomin","texte":"Souvenirs"},{"media":0,"duree_secondes":2,"transition":"fondu","effet":"panG","texte":""}],"look":"vintage"}';
    return JSON.stringify({ title: 'Nuit test', style: 'trap', bpm: 140, key: 'F', scale: 'minor', progression: ['Fm', 'Db', 'Ab', 'Eb'], drums: { kick: 'x.........x.....', snare: '........x.......', hat: 'xxxxxxxxxxxxxxxx' }, bass: { type: '808', pattern: 'x.........x.....' }, sections: [{ name: 'Intro', bars: 1, layers: ['pad'] }, { name: 'Refrain', bars: 2, layers: ['drums', 'bass', 'pad', 'lead'] }], notes: 'Ambiance sombre de test.' });
  }
  return `**Réponse de ${model}** à : « ${text.slice(0, 80)} »\n\n- point 1\n- point 2\n\n\`\`\`js\nconsole.log("ok");\n\`\`\``;
}
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  calls.push({ method: req.method, url: req.url, auth: req.headers.authorization });
  if (req.url === '/__calls') { res.end(JSON.stringify(calls)); return; }
  // --- Faux OVH AI Endpoints (accès anonyme, sans clé) ---
  if (req.url.startsWith('/ovh/v1/')) {
    const p = req.url.slice(7);
    if (p === '/models') { res.end(JSON.stringify({ data: ['gpt-oss-120b', 'qwen3-32b', 'Qwen2.5-VL-72B-Instruct', 'whisper-large-v3'].map(id => ({ id })) })); return; }
    if (p === '/audio/transcriptions') {
      if (body.includes('verbose_json')) { res.end(JSON.stringify({ text: 'Bonjour le studio. Deuxième phrase.', segments: [{ start: 0, end: 1.5, text: 'Bonjour le studio.' }, { start: 1.5, end: 3, text: 'Deuxième phrase.' }] })); return; }
      res.end(JSON.stringify({ text: `Transcription test (${body.length} octets)` })); return;
    }
    if (p === '/chat/completions') { req.headers.authorization = `Bearer ${KEY}`; }
    else { res.writeHead(404); res.end('{}'); return; }
  }
  if (req.url === '/mcp') { res.writeHead(403); res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'MCP server is disabled.' } })); return; }
  if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401); res.end('{"error":{"message":"bad key"}}'); return; }
  const json = () => JSON.parse(body.toString() || '{}');
  if (req.url.startsWith('/v1/models')) { res.end(JSON.stringify({ data: [{ id: 'auto', owned_by: 'freellmapi', name: 'Auto' }, { id: 'fusion', owned_by: 'freellmapi', name: 'Fusion' }, ...models] })); return; }
  if (req.url === '/v1/usage') { res.end(JSON.stringify({ month: '2026-11', resetsAt: '2026-12-01T00:00:00Z', requests: 5, tokens: 1234, byKey: [{ keyId: 1, platform: 'ovh', label: 'OVH', requests: 5, tokens: 1234, requestCap: null, tokenCap: null }] })); return; }
  if (req.url === '/v1/chat/completions' || req.url === '/ovh/v1/chat/completions') {
    const b = json();
    const model = b.model.startsWith('auto') || b.model === 'fusion' ? 'gpt-oss-120b' : b.model;
    const plat = req.url.startsWith('/ovh') ? 'ovh' : (models.find(m => m.id === model)?.owned_by || 'ovh');
    const content = reply(b.messages, model);
    res.setHeader('X-Routed-Via', `${plat}/${model}`);
    if (!b.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 } })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'Je réfléchis… ' } }] })}\n\n`);
    for (const part of content.match(/[\s\S]{1,12}/g)) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`); await new Promise(r => setTimeout(r, 5)); }
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 } })}\n\ndata: [DONE]\n\n`);
    res.end(); return;
  }
  if (req.url === '/v1/images/generations') { const b = json(); res.end(JSON.stringify({ data: Array.from({ length: b.n || 1 }, () => ({ b64_json: fs.readFileSync(path.join(A, 'photo1.png')).toString('base64') })), model: 'flux', provider: 'pollinations' })); return; }
  if (req.url === '/v1/videos/generations') { res.writeHead(200, { 'Content-Type': 'video/webm', 'X-Provider': 'pollinations', 'X-Model': 'seedance' }); res.end(fs.readFileSync(path.join(A, 'clip.webm'))); return; }
  if (req.url === '/v1/audio/speech') { res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'X-Provider': 'ovh' }); res.end(fs.readFileSync(path.join(A, 'speech.mp3'))); return; }
  if (req.url === '/v1/audio/transcriptions') {
    const ok = body.includes('name="model"') && body.includes('name="file"');
    res.setHeader('X-Provider', 'ovh'); res.setHeader('X-Model', 'whisper-large-v3');
    if (!ok) { res.writeHead(400); res.end('{"error":{"message":"multipart invalide"}}'); return; }
    if (body.includes('verbose_json')) { res.end(JSON.stringify({ text: 'Bonjour le studio. Deuxième phrase.', segments: [{ start: 0, end: 1.5, text: 'Bonjour le studio.' }, { start: 1.5, end: 3, text: 'Deuxième phrase.' }] })); return; }
    res.end(JSON.stringify({ text: `Transcription test (${body.length} octets)` })); return;
  }
  res.writeHead(404); res.end('{"error":{"message":"not found"}}');
});
server.listen(Number(process.env.MOCK_PORT || 9999), () => console.log('mock prêt'));

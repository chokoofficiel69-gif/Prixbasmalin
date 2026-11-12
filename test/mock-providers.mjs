// Faux fournisseurs pilotables pour les tests : OVH (/ovh/v1/...) et FreeLLMAPI (/v1/..., /mcp).
import http from 'node:http';

export function startMock(port = 0) {
  const st = {
    usage: true,              // le fournisseur renvoie-t-il le champ usage ?
    usageOverride: null,      // { prompt_tokens, completion_tokens, total_tokens }
    ovh429: false,            // OVH répond 429
    delayMs: 0,               // latence avant la réponse
    mcpEnabled: false,        // outil MCP list_models disponible ?
    mcpModels: [],            // [{ id, platforms }]
    gatewayRoutedPlatform: 'ovh',
    ovhModels: ['gpt-oss-120b', 'Meta-Llama-3_3-70B-Instruct', 'whisper-large-v3'],
    calls: [],                // journal de tous les appels reçus
    gatewayTokens: 0, gatewayRequests: 0,
  };
  const usageFor = (text) => st.usageOverride || { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    let body = {}; try { body = JSON.parse(raw.toString() || '{}'); } catch {}
    const url = req.url;
    if (url === '/__state') { res.end(JSON.stringify({ ...st, calls: undefined })); return; }
    const isOvh = url.startsWith('/ovh/');
    st.calls.push({ url, provider: isOvh ? 'ovh' : 'freellmapi', model: body.model, max_tokens: body.max_tokens, auth: !!req.headers.authorization, t: Date.now() });
    if (st.delayMs) await new Promise(r => setTimeout(r, st.delayMs));
    const json = (code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };

    if (url === '/ovh/v1/models') return json(200, { data: st.ovhModels.map(id => ({ id })) });
    if (url === '/ovh/v1/audio/transcriptions') return json(200, { text: 'transcription ovh' });
    if (url === '/ovh/v1/chat/completions' || url === '/v1/chat/completions') {
      if (!isOvh && req.headers.authorization !== 'Bearer test-key') return json(401, { error: { message: 'bad key' } });
      if (isOvh && req.headers.authorization) return json(400, { error: { message: 'OVH anonyme : aucune clé attendue' } });
      if (isOvh && st.ovh429) return json(429, { error: { message: 'Rate limit exceeded' } }, { 'Retry-After': '30' });
      const text = `Réponse de ${body.model}`;
      const usage = usageFor(text);
      const headers = isOvh ? {} : { 'X-Routed-Via': `${st.gatewayRoutedPlatform}/${body.model}` };
      if (!isOvh) { st.gatewayRequests++; st.gatewayTokens += usage.total_tokens; }
      if (!body.stream) return json(200, { choices: [{ message: { role: 'assistant', content: text } }], ...(st.usage ? { usage } : {}) }, headers);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers });
      for (const part of text.match(/.{1,5}/g)) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      if (st.usage && body.stream_options?.include_usage) res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    if (url === '/mcp') {
      if (!st.mcpEnabled) return json(403, { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'MCP server is disabled.' } });
      const data = { count: st.mcpModels.length, models: st.mcpModels.map(m => ({ id: m.id, name: m.id, platforms: m.platforms, available: true })) };
      return json(200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data } });
    }
    if (url.startsWith('/v1/models')) return json(200, { data: [{ id: 'auto', owned_by: 'freellmapi' }, { id: 'gpt-oss-120b', owned_by: 'freellmapi', execution_status: 'ready' }] });
    if (url === '/v1/usage') return json(200, { month: new Date().toISOString().slice(0, 7), resetsAt: null, requests: st.gatewayRequests, tokens: st.gatewayTokens, byPlatform: [], byKey: [] });
    if (url === '/v1/images/generations') return json(200, { data: [{ b64_json: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') }], provider: 'pollinations', model: 'flux' });
    return json(404, { error: { message: 'inconnu' } });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, st, port: server.address().port })));
}

// Routage OVH (niveaux, charge sur 60 s, pause après 429) et capacité réelle estimée.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-routing-'));
const MODELS = ['gpt-oss-120b', 'Qwen3.5-397B-A17B', 'Meta-Llama-3_3-70B-Instruct', 'Qwen3.6-27B', 'Qwen3.8-27B',
  'Mistral-Small-3.2-24B-Instruct-2506', 'gpt-oss-20b', 'Qwen3.5-9B', 'Qwen3Guard-8B', 'Qwen3Guard-0.6B', 'Qwen2.5-VL-72B-Instruct', 'whisper-large-v3'];
globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: MODELS.map(id => ({ id })) }) });
const P = await import('../server/providers.js');

// Chaque test repart de compteurs vides : on « vieillit » les fenêtres en avançant l'horloge.
let now = Date.now();
const realNow = Date.now;
Date.now = () => now;
beforeEach(() => { now += 10 * 60_000; });
const fill = (m, k = 2) => { for (let i = 0; i < k; i++) P.ovhTake(m); };

describe('Routage OVH', () => {
  test('8 modèles de chat, Guard et VL exclus', () => {
    const chat = P.ovhChatModels(MODELS);
    assert.equal(chat.length, 8);
    assert.ok(!chat.some(m => /guard|VL/i.test(m)));
    assert.deepEqual(P.ovhVisionModels(MODELS), ['Qwen2.5-VL-72B-Instruct']);
  });

  test('niveaux : haut / moyen / bas', () => {
    assert.equal(P.ovhTierOf('gpt-oss-120b'), 0);
    assert.equal(P.ovhTierOf('Qwen3.5-397B-A17B'), 0);
    assert.equal(P.ovhTierOf('Mistral-Small-3.2-24B-Instruct-2506'), 1);
    assert.equal(P.ovhTierOf('gpt-oss-20b'), 1);
    assert.equal(P.ovhTierOf('Qwen3.5-9B'), 2);
  });

  test('a) la charge compte les requêtes lancées (en cours incluses) sur 60 s', () => {
    P.ovhTake('gpt-oss-120b');                       // lancée, pas encore terminée
    assert.equal(P.ovhLoad('gpt-oss-120b'), 1);
    P.ovhTake('gpt-oss-120b');
    assert.equal(P.ovhSlot('gpt-oss-120b').ok, false); // 2 lancées en 60 s = plein
    now += 61_000;
    assert.equal(P.ovhLoad('gpt-oss-120b'), 0);
    assert.equal(P.ovhSlot('gpt-oss-120b').ok, true);
  });

  test('b) après un 429 : pause de 60 s minimum, même si Retry-After est plus court', () => {
    P.ovhCooldown('gpt-oss-20b', 10);
    now += 30_000; assert.equal(P.ovhSlot('gpt-oss-20b').ok, false);
    now += 31_000; assert.equal(P.ovhSlot('gpt-oss-20b').ok, true);
    P.ovhCooldown('Qwen3.5-9B', 120);
    now += 90_000; assert.equal(P.ovhSlot('Qwen3.5-9B').ok, false);
  });

  test('c) bascule d’abord dans le même niveau (le moins chargé)', async () => {
    fill('gpt-oss-120b');
    P.ovhTake('Qwen3.5-397B-A17B');                  // 1 requête : plus chargé que Llama 70B
    const r = await P.resolveChatRoute('ovh/gpt-oss-120b');
    assert.equal(r.model, 'Meta-Llama-3_3-70B-Instruct');
    assert.equal(r.redirectedFrom, 'gpt-oss-120b');
  });

  test('c) ne descend d’un niveau que si tout le niveau est plein', async () => {
    for (const m of ['gpt-oss-120b', 'Qwen3.5-397B-A17B', 'Meta-Llama-3_3-70B-Instruct']) fill(m);
    const r = await P.resolveChatRoute('ovh/gpt-oss-120b');
    assert.equal(P.ovhTierOf(r.model), 1);
    assert.equal(r.redirectedFrom, 'gpt-oss-120b');
  });

  test('c) un modèle du niveau moyen saturé reste dans le niveau moyen, puis descend au bas', async () => {
    fill('gpt-oss-20b');
    const r1 = await P.resolveChatRoute('ovh/gpt-oss-20b');
    assert.equal(P.ovhTierOf(r1.model), 1);
    for (const m of ['Qwen3.6-27B', 'Qwen3.8-27B', 'Mistral-Small-3.2-24B-Instruct-2506']) fill(m);
    const r2 = await P.resolveChatRoute('ovh/gpt-oss-20b');
    assert.equal(r2.model, 'Qwen3.5-9B');
  });

  test('auto : répartit sur le niveau haut avant de descendre', async () => {
    const seen = [];
    for (let i = 0; i < 6; i++) { const r = await P.resolveChatRoute('auto'); P.ovhTake(r.model); seen.push(r.model); }
    assert.ok(seen.every(m => P.ovhTierOf(m) === 0));
    assert.equal(new Set(seen.slice(0, 3)).size, 3);  // les 3 premières sur 3 modèles différents
    const next = await P.resolveChatRoute('auto');
    assert.equal(P.ovhTierOf(next.model), 1);
    assert.equal(next.redirectedFrom, undefined);      // pas de choix manuel : pas de mention « saturé »
  });

  test('tous pleins : refus local 429, sans appel', async () => {
    for (const m of P.ovhChatModels(MODELS)) fill(m);
    await assert.rejects(P.resolveChatRoute('ovh/gpt-oss-120b'), e => e.status === 429);
  });

  test('modèle libre choisi à la main : pas de bascule', async () => {
    const r = await P.resolveChatRoute('ovh/Qwen3.8-27B');
    assert.equal(r.model, 'Qwen3.8-27B'); assert.equal(r.redirectedFrom, undefined);
  });

  test('Guard refusé pour le chat texte', async () => {
    await assert.rejects(P.resolveChatRoute('Qwen3Guard-8B'), e => e.status === 400);
  });
});

describe('Capacité réelle estimée', () => {
  const chat = P.ovhChatModels(MODELS);
  const ops = [{ model: 'gpt-oss-120b', platform: 'ovh', kind: 'chat', requests: 6, errors: 1, ms: 6 * 63000, tokens: 5 * 4300 }];

  test('1) req/min = 2 × (1 − erreurs), la latence n’intervient pas', () => {
    const r = P.ovhRealCapacity(chat, ops, { rpm: 2 });
    const g = r.models.find(m => m.model === 'gpt-oss-120b');
    assert.ok(Math.abs(g.realRpm - 2 * (5 / 6)) < 1e-9);
    assert.equal(Math.round(g.latencyS), 63);            // affichée pour info seulement
    assert.ok(Math.abs(r.realRpm - (2 * 5 / 6 + 7 * 2)) < 1e-9);
    assert.match(r.parallel, /parallèle/);
  });

  test('2) modèles non mesurés : tokens « estimé » (marqué), n affiché, fiabilité faible sous 10', () => {
    const r = P.ovhRealCapacity(chat, ops, { rpm: 2 });
    const g = r.models.find(m => m.model === 'gpt-oss-120b'), q = r.models.find(m => m.model === 'Qwen3.5-9B');
    assert.equal(g.n, 6); assert.equal(g.reliability, 'faible'); assert.equal(g.tokensStatus, 'mesuré');
    assert.equal(q.n, 0); assert.equal(q.errorRate, null); assert.equal(q.tokPerReply, null);
    assert.equal(q.tokensStatus, 'estimé');
    const none = P.ovhRealCapacity(chat, [], { rpm: 2 });
    assert.equal(none.models[0].tokensStatus, 'non mesuré'); assert.equal(none.tokensPerMin, null);
    const many = P.ovhRealCapacity(chat, [{ ...ops[0], requests: 12, errors: 0, tokens: 12 * 4300 }], { rpm: 2 });
    assert.equal(many.models.find(m => m.model === 'gpt-oss-120b').reliability, 'normale');
  });

  test('3) équivalent 30 jours = plus petite limite, avec celle qui bloque', () => {
    const r = P.ovhRealCapacity(chat, ops, { rpm: 2, pool: 10_000_000, remaining: 9_000_000, dailyCap: 200_000 });
    assert.equal(r.month30.blockedBy.id, 'daily'); assert.equal(r.month30.tokens, 6_000_000);
    const r2 = P.ovhRealCapacity(chat, ops, { rpm: 2, remaining: 1_000_000, dailyCap: 200_000 });
    assert.equal(r2.month30.blockedBy.id, 'pool'); assert.equal(r2.month30.tokens, 1_000_000);
    const r3 = P.ovhRealCapacity(chat, ops, { rpm: 2, remaining: 1e12, dailyCap: 0 });
    assert.equal(r3.month30.blockedBy.id, 'ovh');
  });
});

process.on('exit', () => { Date.now = realNow; });

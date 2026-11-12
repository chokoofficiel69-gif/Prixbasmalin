// Tests obligatoires du quota de tokens (node --test test/quota.test.mjs).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from './mock-providers.mjs';
import { Ledger, QuotaError } from '../server/quota.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PASSWORD = 'mot-de-passe-test';

// ---------------------------------------------------------------- utilitaires
async function startStudio(mockPort, extraEnv = {}, reuseDir = null) {
  const dir = reuseDir || fs.mkdtempSync(path.join(os.tmpdir(), 'studio-quota-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const clockFile = path.join(dir, 'clock.txt');
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: path.join(dir, 'data'), STUDIO_PASSWORD: PASSWORD, FREELLMAPI_KEY: 'test-key',
      FREELLMAPI_URL: `http://127.0.0.1:${mockPort}`, OVH_BASE_URL: `http://127.0.0.1:${mockPort}/ovh/v1`, STUDIO_CLOCK_FILE: clockFile, ...extraEnv },
  });
  let log = '';
  proc.stdout.on('data', d => (log += d)); proc.stderr.on('data', d => (log += d));
  for (let i = 0; i < 100 && !log.includes('prêt'); i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(log.includes('prêt'), 'le serveur n’a pas démarré : ' + log);
  const s = { base: `http://127.0.0.1:${port}`, dir, proc, clockFile, cookies: {}, log: () => log };
  s.stop = () => new Promise(r => { proc.once('exit', r); proc.kill(); });
  s.setClock = (iso) => fs.writeFileSync(clockFile, iso);
  return s;
}
async function call(s, who, method, url, body) {
  const res = await fetch(s.base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Studio': '1', Cookie: s.cookies[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, text };
}
async function login(s, who, username, password) {
  const res = await fetch(s.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio': '1' }, body: JSON.stringify({ username, password }) });
  assert.equal(res.status, 200, `connexion ${username}`);
  s.cookies[who] = res.headers.get('set-cookie').split(';')[0];
}
/** Envoie un message et lit le flux SSE jusqu'au bout. */
async function chat(s, who, content, model = 'auto') {
  const r = await call(s, who, 'POST', '/api/chat', { model, messages: [{ role: 'user', content }] });
  const events = r.text.split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
  return { status: r.status, done: events.find(e => e.type === 'done'), error: events.find(e => e.type === 'error'), events, raw: r };
}
function ledgerEvents(s) {
  const dir = path.join(s.dir, 'data', 'ledger');
  return fs.readdirSync(dir).flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
}
const settles = (s) => ledgerEvents(s).filter(e => e.e === 'S');
const callsTo = (mock, provider, pathPart = 'chat/completions') => mock.st.calls.filter(c => c.provider === provider && c.url.includes(pathPart)).length;
async function setup(mockOpts = {}, settings = {}) {
  const mock = await startMock();
  Object.assign(mock.st, mockOpts);
  const s = await startStudio(mock.port);
  await login(s, 'admin', 'admin', PASSWORD);
  const r = await call(s, 'admin', 'PUT', '/api/settings', { ovhRpmPerModel: 100, ...settings });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { mock, s };
}
async function createUser(s, username, monthlyTokenQuota) {
  const r = await call(s, 'admin', 'POST', '/api/users', { username, name: username, password: 'provisoire-123', monthlyTokenQuota });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await login(s, username, username, 'provisoire-123');
  return r.json;
}
const teardown = async ({ mock, s }) => { await s.stop(); mock.server.close(); };

// ---------------------------------------------------------------- tests unitaires du registre
describe('Registre (unitaire)', () => {
  const mk = (dir, now, pool = 10_000, quota = 5_000) => new Ledger({ dir, now, limits: () => ({ pool, globalDaily: 0 }), userLimits: () => ({ quota, daily: 0 }) });

  test('5bis. 200 réservations simultanées ne dépassent jamais le quota', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    const L = mk(dir, () => new Date('2026-11-15T10:00:00Z'));
    const results = await Promise.allSettled(Array.from({ length: 200 }, () => Promise.resolve().then(() => L.reserveChat('u1', 100, 400, 100))));
    const okRes = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const reserved = okRes.reduce((s, r) => s + r.amount, 0);
    assert.ok(reserved <= 5000, `réservé ${reserved} > quota 5000`);
    assert.equal(okRes.length, 10, '5000 / (100+400) = 10 réservations maximum');
    assert.ok(results.filter(r => r.status === 'rejected').every(r => r.reason instanceof QuotaError));
  });

  test('Règlement idempotent : jamais deux débits pour la même requête', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    const L = mk(dir, () => new Date('2026-11-15T10:00:00Z'));
    const r = L.reserveChat('u1', 100, 400, 100);
    assert.equal(L.settle(r.id, { exact: true, pt: 30, ct: 20 }), true);
    assert.equal(L.settle(r.id, { exact: true, pt: 30, ct: 20 }), false);
    assert.equal(L.snapshot(['u1']).users.u1.consumed, 50);
    const L2 = mk(dir, () => new Date('2026-11-15T10:00:00Z')); // relecture du journal
    assert.equal(L2.snapshot(['u1']).users.u1.consumed, 50);
  });

  test('Réservation ouverte lors d’un arrêt brutal : débit prudent de la totalité, une seule fois', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    const L = mk(dir, () => new Date('2026-11-15T10:00:00Z'));
    L.reserveChat('u1', 100, 400, 100); // jamais réglée (crash simulé)
    const L2 = mk(dir, () => new Date('2026-11-15T10:05:00Z'));
    const u = L2.snapshot(['u1']).users.u1;
    assert.equal(u.estimated, 500); assert.equal(u.exact, 0); assert.equal(u.reserved, 0);
    const L3 = mk(dir, () => new Date('2026-11-15T10:06:00Z'));
    assert.equal(L3.snapshot(['u1']).users.u1.consumed, 500, 'pas de double débit après un 2e redémarrage');
  });

  test('6bis. Remise à zéro au changement de mois UTC', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    let now = new Date('2026-11-30T23:59:00Z');
    const L = mk(dir, () => now);
    const r = L.reserveChat('u1', 100, 400, 100);
    L.settle(r.id, { exact: true, pt: 1000, ct: 2000 });
    assert.equal(L.snapshot(['u1']).users.u1.consumed, 3000);
    now = new Date('2026-12-01T00:00:30Z');
    const snap = L.snapshot(['u1']);
    assert.equal(snap.month, '2026-12'); assert.equal(snap.consumed, 0); assert.equal(snap.users.u1.remaining, 5000);
  });
});

// ---------------------------------------------------------------- tests d'intégration (serveur réel + faux fournisseurs)
describe('Studio (intégration)', () => {
  test('1. Consommation exacte : les tokens renvoyés par le fournisseur sont débités tels quels', async () => {
    const ctx = await setup({ usage: true, usageOverride: { prompt_tokens: 123, completion_tokens: 77, total_tokens: 200 } });
    try {
      const r = await chat(ctx.s, 'admin', 'Bonjour');
      assert.ok(r.done, JSON.stringify(r.error));
      assert.equal(r.done.estimated, false);
      assert.deepEqual(r.done.usage, { prompt: 123, completion: 77, total: 200 });
      const u = (await call(ctx.s, 'admin', 'GET', '/api/usage')).json;
      assert.equal(u.internal.exact, 200); assert.equal(u.internal.estimated, 0); assert.equal(u.internal.reserved, 0);
      const ev = settles(ctx.s).at(-1);
      assert.equal(ev.exact, true); assert.equal(ev.tok, 200); assert.equal(ev.platform, 'ovh');
      assert.ok(ctx.mock.st.calls.find(c => c.provider === 'ovh' && c.url.includes('chat')).max_tokens > 0, 'max_tokens envoyé au fournisseur');
    } finally { await teardown(ctx); }
  });

  test('2. Sans mesure du fournisseur : consommation marquée « estimée », jamais « réelle »', async () => {
    const ctx = await setup({ usage: false });
    try {
      const r = await chat(ctx.s, 'admin', 'Bonjour sans mesure');
      assert.ok(r.done); assert.equal(r.done.estimated, true);
      const u = (await call(ctx.s, 'admin', 'GET', '/api/usage')).json;
      assert.equal(u.internal.exact, 0); assert.ok(u.internal.estimated > 0);
      const ev = settles(ctx.s).at(-1);
      assert.equal(ev.exact, false); assert.ok(ev.tok > 0);
      assert.equal(u.history[0].exact, false);
    } finally { await teardown(ctx); }
  });

  test('3. Un utilisateur au quota épuisé est réellement bloqué (aucun appel au fournisseur)', async () => {
    const ctx = await setup({ usage: true, usageOverride: { prompt_tokens: 100, completion_tokens: 2400, total_tokens: 2500 } });
    try {
      await createUser(ctx.s, 'lina', 2700);
      const first = await chat(ctx.s, 'lina', 'premier message');
      assert.ok(first.done, JSON.stringify(first.error));
      const before = callsTo(ctx.mock, 'ovh');
      const second = await chat(ctx.s, 'lina', 'deuxième message');
      assert.ok(second.error, 'la 2e requête doit être refusée');
      assert.equal(second.error.status, 402);
      assert.match(second.error.error, /quota mensuel de tokens est épuisé/);
      assert.equal(callsTo(ctx.mock, 'ovh'), before, 'aucun appel externe après épuisement');
      const admin = await chat(ctx.s, 'admin', 'l’administrateur a encore du quota');
      assert.ok(admin.done, 'les autres comptes ne sont pas affectés');
    } finally { await teardown(ctx); }
  });

  test('4. Le pool global épuisé bloque les requêtes, même si le compte a encore du quota', async () => {
    const ctx = await setup({ usage: true });
    try {
      const users = (await call(ctx.s, 'admin', 'GET', '/api/users')).json;
      await call(ctx.s, 'admin', 'PUT', `/api/users/${users[0].id}`, { monthlyTokenQuota: 3000 });
      assert.equal((await call(ctx.s, 'admin', 'PUT', '/api/settings', { poolMonthlyTokens: 5000 })).status, 200);
      await createUser(ctx.s, 'bob', 2000);
      // Le fournisseur facture plus que réservé (il a ignoré max_tokens) : le registre débite la réalité.
      ctx.mock.st.usageOverride = { prompt_tokens: 200, completion_tokens: 4500, total_tokens: 4700 };
      const a = await chat(ctx.s, 'admin', 'grosse réponse');
      assert.ok(a.done);
      const u = (await call(ctx.s, 'admin', 'GET', '/api/usage')).json;
      assert.equal(u.internal.consumed, 4700);
      const before = callsTo(ctx.mock, 'ovh');
      const b = await chat(ctx.s, 'bob', 'bob a 2000 tokens de quota');
      assert.ok(b.error); assert.equal(b.error.status, 402);
      assert.match(b.error.error, /pool mensuel de tokens du Studio est épuisé/);
      assert.equal(callsTo(ctx.mock, 'ovh'), before);
      // La somme des quotas ne peut jamais dépasser le pool
      const over = await call(ctx.s, 'admin', 'POST', '/api/users', { username: 'trop', password: 'provisoire-123', monthlyTokenQuota: 1 });
      assert.equal(over.status, 400);
      assert.equal((await call(ctx.s, 'admin', 'PUT', '/api/settings', { poolMonthlyTokens: 4000 })).status, 400, 'pool < quotas attribués refusé');
    } finally { await teardown(ctx); }
  });

  test('5. Deux requêtes simultanées ne permettent pas de dépasser le plafond', async () => {
    const ctx = await setup({ usage: true, delayMs: 400 });
    try {
      await createUser(ctx.s, 'zoe', 4400); // assez pour UNE réservation (prompt estimé + 4096), pas deux
      const [a, b] = await Promise.all([chat(ctx.s, 'zoe', 'A'), chat(ctx.s, 'zoe', 'B')]);
      const okCount = [a, b].filter(x => x.done).length;
      const blocked = [a, b].filter(x => x.error?.status === 402).length;
      assert.equal(okCount, 1); assert.equal(blocked, 1);
      assert.equal(callsTo(ctx.mock, 'ovh'), 1, 'un seul appel externe');
      const zoe = (await call(ctx.s, 'admin', 'GET', '/api/usage')).json.users.find(u => u.username === 'zoe');
      assert.ok(zoe.consumed <= 4400); assert.equal(zoe.reserved, 0);
    } finally { await teardown(ctx); }
  });

  test('6. Le quota mensuel se réinitialise au 1er du mois (et reste exact après redémarrage)', async () => {
    const ctx = await setup({ usage: true });
    try {
      ctx.s.setClock('2026-11-30T23:58:00Z');
      await createUser(ctx.s, 'max', 1000000);
      assert.ok((await chat(ctx.s, 'max', 'fin novembre')).done);
      let u = (await call(ctx.s, 'admin', 'GET', '/api/usage')).json;
      assert.equal(u.internal.month, '2026-11'); assert.equal(u.users.find(x => x.username === 'max').consumed, 60);
      ctx.s.setClock('2026-12-01T00:00:10Z');
      u = (await call(ctx.s, 'admin', 'GET', '/api/usage')).json;
      assert.equal(u.internal.month, '2026-12'); assert.equal(u.internal.consumed, 0);
      assert.equal(u.users.find(x => x.username === 'max').remaining, 1000000);
      assert.ok((await chat(ctx.s, 'max', 'début décembre')).done);
      assert.equal((await call(ctx.s, 'admin', 'GET', '/api/usage')).json.internal.consumed, 60);
      // Redémarrage du serveur sur les mêmes données : les compteurs sont identiques
      await ctx.s.stop();
      ctx.s = await startStudio(ctx.mock.port, {}, ctx.s.dir);
      ctx.s.setClock('2026-12-01T00:05:00Z');
      await login(ctx.s, 'admin', 'admin', PASSWORD);
      u = (await call(ctx.s, 'admin', 'GET', '/api/usage')).json;
      assert.equal(u.internal.month, '2026-12'); assert.equal(u.internal.consumed, 60);
      assert.equal(u.history.filter(h => h.rm === '2026-11').length, 1, 'l’historique de novembre est conservé');
    } finally { await teardown(ctx); }
  });

  test('7. Mode gratuit : aucun fournisseur payant ou non vérifié n’est appelé', async () => {
    const ctx = await setup({ usage: true, mcpEnabled: false });
    try {
      // a) Passerelle non vérifiable (MCP désactivé) : bloquée AVANT l'appel
      let r = await chat(ctx.s, 'admin', 'x', 'freellmapi/gpt-oss-120b');
      assert.ok(r.error); assert.equal(callsTo(ctx.mock, 'freellmapi'), 0);
      // b) Modèle dont un fournisseur possible est payant : bloqué AVANT l'appel
      ctx.mock.st.mcpEnabled = true;
      ctx.mock.st.mcpModels = [{ id: 'mixte', platforms: ['ovh', 'openai'] }, { id: 'ovh-seul', platforms: ['ovh'] }];
      await call(ctx.s, 'admin', 'GET', '/api/providers?refresh=1');
      r = await chat(ctx.s, 'admin', 'x', 'freellmapi/mixte');
      assert.ok(r.error); assert.equal(r.error.status, 403); assert.equal(callsTo(ctx.mock, 'freellmapi'), 0);
      // c) « auto » n'est jamais délégué au routage de la passerelle : OVH saturé → refus propre, 0 appel passerelle
      await call(ctx.s, 'admin', 'PUT', '/api/settings', { ovhRpmPerModel: 1 });
      await chat(ctx.s, 'admin', '1'); await chat(ctx.s, 'admin', '2');
      r = await chat(ctx.s, 'admin', '3');
      assert.ok(r.error); assert.equal(r.error.status, 429); assert.equal(callsTo(ctx.mock, 'freellmapi'), 0);
      // d) Modèle vérifié 100 % liste blanche : autorisé, épinglé (jamais « auto » envoyé à la passerelle)
      r = await chat(ctx.s, 'admin', 'x', 'freellmapi/ovh-seul');
      assert.ok(r.done, JSON.stringify(r.error));
      const gw = ctx.mock.st.calls.filter(c => c.provider === 'freellmapi' && c.url.includes('chat'));
      assert.equal(gw.length, 1); assert.equal(gw[0].model, 'ovh-seul');
      // e) Médias via passerelle (fournisseur inconnu avant l'appel) : bloqués par défaut
      const img = await call(ctx.s, 'admin', 'POST', '/api/images', { prompt: 'chat' });
      assert.equal(img.status, 403); assert.equal(callsTo(ctx.mock, 'freellmapi', 'images'), 0);
      // f) Le mode « fusion » (consommation non mesurable) est refusé
      r = await chat(ctx.s, 'admin', 'x', 'fusion');
      assert.ok(r.error);
      // g) Aucun appel OVH n'a transmis de clé (accès anonyme = aucune facturation possible)
      assert.ok(ctx.mock.st.calls.filter(c => c.provider === 'ovh').every(c => !c.auth));
    } finally { await teardown(ctx); }
  });

  test('8. Une erreur 429 du fournisseur est signalée clairement et ne coûte rien', async () => {
    const ctx = await setup({ ovh429: true });
    try {
      const r = await chat(ctx.s, 'admin', 'x', 'ovh/gpt-oss-120b');
      assert.ok(r.error); assert.equal(r.error.status, 429);
      assert.match(r.error.error, /Limite du fournisseur atteinte \(HTTP 429/);
      const ev = settles(ctx.s).at(-1);
      assert.equal(ev.tok, 0); assert.equal(ev.outcome, 'échec-http-429');
      const u = (await call(ctx.s, 'admin', 'GET', '/api/usage')).json;
      assert.equal(u.internal.reserved, 0); assert.equal(u.internal.consumed, 0);
      // le modèle est mis en pause localement : pas de nouvel appel immédiat chez OVH
      const before = callsTo(ctx.mock, 'ovh');
      const again = await chat(ctx.s, 'admin', 'y', 'ovh/gpt-oss-120b');
      assert.equal(again.error.status, 429); assert.equal(callsTo(ctx.mock, 'ovh'), before);
    } finally { await teardown(ctx); }
  });

  test('9. Le tableau de bord correspond exactement au registre enregistré', async () => {
    const ctx = await setup({ usage: true });
    try {
      await createUser(ctx.s, 'eva', 300000);
      await chat(ctx.s, 'admin', 'a'); await chat(ctx.s, 'eva', 'b');
      ctx.mock.st.usage = false; await chat(ctx.s, 'eva', 'c sans mesure');
      ctx.mock.st.usage = true; ctx.mock.st.usageOverride = { prompt_tokens: 500, completion_tokens: 500, total_tokens: 1000 }; await chat(ctx.s, 'admin', 'd');
      const ev = settles(ctx.s);
      const month = ev[0].rm;
      const sum = (f) => ev.filter(e => e.rm === month && f(e)).reduce((s, e) => s + e.tok, 0);
      const u = (await call(ctx.s, 'admin', 'GET', '/api/usage')).json;
      assert.equal(u.internal.exact, sum(e => e.exact));
      assert.equal(u.internal.estimated, sum(e => !e.exact));
      assert.equal(u.internal.consumed, sum(() => true));
      assert.equal(u.internal.remaining, u.internal.pool - u.internal.consumed - u.internal.reserved);
      for (const usr of u.users) assert.equal(usr.consumed, sum(e => e.u === usr.id), `compteur de ${usr.username}`);
      assert.equal(u.internal.allocated, u.users.filter(x => !x.disabled).reduce((s, x) => s + x.quota, 0));
      assert.equal(u.history.length, ev.length);
      // Le membre voit exactement ses propres chiffres
      const me = (await call(ctx.s, 'eva', 'GET', '/api/usage')).json.me;
      assert.equal(me.consumed, sum(e => e.u === u.users.find(x => x.username === 'eva').id));
      // Les coûts : OVH = 0 € justifié ; jamais « 0 € » pour un tarif absent
      assert.ok(u.costs.every(c => c.platform === 'ovh' ? c.eur === 0 : c.eur === null));
    } finally { await teardown(ctx); }
  });
});

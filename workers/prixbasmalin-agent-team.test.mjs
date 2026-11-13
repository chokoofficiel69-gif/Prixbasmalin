import test from "node:test";
import assert from "node:assert/strict";
import { runAgentTeam } from "./prixbasmalin-agent-team.js";

function fakeFetch(responses, calls) {
  return async (_url, options) => {
    calls.push(options);
    const content = responses.shift();
    return new Response(JSON.stringify({
      choices: [{ message: { content } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

test("exécute les trois rôles dans l'ordre avec une seule clé côté serveur", async () => {
  const calls = [];
  const result = await runAgentTeam({
    message: "Comment améliorer l'assistant ?",
    apiKey: "secret-test-only",
    fetchImpl: fakeFetch(["Analyse", "Point de vigilance", "Synthèse"], calls)
  });
  assert.deepEqual(result.team, ["analyste", "auditeur", "coordinateur"]);
  assert.equal(result.answer, "Synthèse");
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.headers.Authorization === "Bearer secret-test-only"));
  assert.match(JSON.parse(calls[1].body).messages[1].content, /Analyse/);
  assert.match(JSON.parse(calls[2].body).messages[1].content, /Point de vigilance/);
});

test("refuse un message vide, trop long ou une clé absente sans appel réseau", async () => {
  let count = 0;
  const fetchImpl = async () => { count++; throw new Error("ne doit pas être appelé"); };
  await assert.rejects(runAgentTeam({ message: " ", apiKey: "x", fetchImpl }), /message requis/);
  await assert.rejects(runAgentTeam({ message: "x".repeat(4001), apiKey: "x", fetchImpl }), /message requis/);
  await assert.rejects(runAgentTeam({ message: "Bonjour", apiKey: "", fetchImpl }), /non configuré/);
  assert.equal(count, 0);
});

test("ne divulgue pas le corps d'erreur du fournisseur", async () => {
  const fetchImpl = async () => new Response("secret provider detail", { status: 401 });
  await assert.rejects(
    runAgentTeam({ message: "Bonjour", apiKey: "secret-test-only", fetchImpl }),
    error => error.message === "Fournisseur IA indisponible (HTTP 401)" && !error.message.includes("secret")
  );
});

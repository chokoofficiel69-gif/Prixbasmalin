import test from "node:test";
import assert from "node:assert/strict";
import worker from "./prixbasmalin-ai.js";

const env = {};
const endpoint = "https://worker.example/api/ai";
const siteOrigin = "https://prixbasmalin.fr";

test("OPTIONS autorisé renvoie 204 et les en-têtes CORS", async () => {
  const response = await worker.fetch(new Request(endpoint, {
    method: "OPTIONS",
    headers: { Origin: siteOrigin }
  }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), siteOrigin);
  assert.match(response.headers.get("Access-Control-Allow-Headers") || "", /Content-Type/i);
});

test("refuse un Origin non autorisé", async () => {
  const response = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { Origin: "https://example.invalid", "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "agnes", message: "bonjour" })
  }), env);
  assert.equal(response.status, 403);
});

test("415 explicite pour un Content-Type absent", async () => {
  const response = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { Origin: siteOrigin, "User-Agent": "test-agent" },
    body: JSON.stringify({ provider: "agnes", message: "bonjour" })
  }), env);
  assert.equal(response.status, 415);
  const data = await response.json();
  assert.equal(data.requiredContentType, "application/json");
  assert.equal(data.receivedContentType, null);
});

test("415 pour un type ressemblant mais invalide", async () => {
  const response = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { Origin: siteOrigin, "Content-Type": "application/jsonp" },
    body: JSON.stringify({ provider: "agnes", message: "bonjour" })
  }), env);
  assert.equal(response.status, 415);
  const data = await response.json();
  assert.equal(data.receivedContentType, "application/jsonp");
});

test("accepte application/json avec charset", async () => {
  const response = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { Origin: siteOrigin, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ provider: "agnes", message: "bonjour" })
  }), env);
  // The provider key is intentionally absent in this test environment.
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.error, "Provider not configured");
});

test("retourne 400 pour un JSON invalide correctement typé", async () => {
  const response = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { Origin: siteOrigin, "Content-Type": "application/json" },
    body: "{invalid"
  }), env);
  assert.equal(response.status, 400);
});

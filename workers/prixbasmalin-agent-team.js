/**
 * Prix Malin — équipe IA expérimentale.
 *
 * Module isolé : non branché au Worker de production tant que les tests
 * et le branchement front/API ne sont pas validés.
 * Un seul fournisseur configuré (FreeLLMAPI), trois rôles séparés :
 * analyste, contradicteur, coordinateur. Aucun prix/offre n'est inventé.
 */
const ENDPOINT = "https://freellmapi.prixbasmalin.prod.page/v1/chat/completions";
const MAX_MESSAGE_LENGTH = 4000;
const MAX_OUTPUT_TOKENS = 450;

async function callModel({ fetchImpl, apiKey, model, system, message, signal }) {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: message }
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2
    })
  });
  if (!response.ok) {
    // Ne jamais remonter le corps fournisseur : il pourrait contenir des détails sensibles.
    throw new Error(`Fournisseur IA indisponible (HTTP ${response.status})`);
  }
  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("Réponse vide du fournisseur IA");
  }
  return answer.trim().slice(0, 6000);
}

export async function runAgentTeam({
  message,
  apiKey,
  model = "gpt-oss-120b",
  fetchImpl = fetch,
  timeoutMs = 25000
}) {
  if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    throw new TypeError("message requis (4 000 caractères maximum)");
  }
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Fournisseur IA non configuré");
  }
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) {
    throw new Error("Configuration du modèle invalide");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const analyst = await callModel({
      fetchImpl, apiKey, model, signal: controller.signal,
      system: "Tu es l'analyste de Prix Malin. Analyse la demande, identifie les faits nécessaires, les inconnues et les risques. N'invente aucun prix, stock, avis, partenaire ou donnée. Réponds en français, brièvement.",
      message: message.trim()
    });
    const reviewer = await callModel({
      fetchImpl, apiKey, model, signal: controller.signal,
      system: "Tu es l'auditeur contradicteur de Prix Malin. Cherche les erreurs, suppositions non prouvées et informations manquantes dans l'analyse. Ne répète pas inutilement. N'invente aucune donnée. Réponds en français.",
      message: `Demande initiale : ${message.trim()}\n\nAnalyse à contrôler :\n${analyst}`
    });
    const answer = await callModel({
      fetchImpl, apiKey, model, signal: controller.signal,
      system: "Tu es le coordinateur de Prix Malin. Fais la synthèse de l'analyste et de l'auditeur. Donne une réponse utile, distingue faits et incertitudes, et ne présente jamais une hypothèse comme vérifiée. N'invente aucun prix ni disponibilité. Réponds en français.",
      message: `Demande initiale : ${message.trim()}\n\nAnalyse :\n${analyst}\n\nContre-vérification :\n${reviewer}`
    });
    return {
      ok: true,
      team: ["analyste", "auditeur", "coordinateur"],
      provider: "FreeLLMAPI",
      model,
      answer
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Équipe IA : délai maximal dépassé");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

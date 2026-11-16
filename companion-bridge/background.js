const STUDIO_ORIGIN = "https://studio.prixbasmalin.prod.page";

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.origin !== STUDIO_ORIGIN || message?.type !== "STUDIO_COMPANION_COMMAND") {
    sendResponse({ error: "Origine ou commande refusée." });
    return false;
  }
  const command = message.command || {};
  if (command.action === "open") {
    let url;
    try {
      url = new URL(command.url);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("scheme");
      const host = url.hostname.toLowerCase();
      if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) throw new Error("private");
    } catch {
      sendResponse({ error: "Adresse web refusée." });
      return false;
    }
    chrome.tabs.create({ url: url.href, active: true }, tab => {
      if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
      else sendResponse({ ok: true, opened: tab.url || url.href });
    });
    return true;
  }
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
    const tab = tabs?.[0];
    if (!tab?.id) { sendResponse({ error: "Aucun onglet actif." }); return; }
    chrome.tabs.sendMessage(tab.id, { type: "STUDIO_COMPANION_PAGE_ACTION", command }, response => {
      if (chrome.runtime.lastError) sendResponse({ error: "Le relais ne peut pas lire cet onglet. Recharge la page puis réessaie." });
      else sendResponse(response || { error: "Aucune réponse de la page." });
    });
  });
  return true;
});
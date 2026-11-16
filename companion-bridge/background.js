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
      if (url.username || url.password || host === "localhost" || host.endsWith(".local") || host === "::1" || host === "[::1]" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) throw new Error("private");
    } catch {
      sendResponse({ error: "Adresse web refusée." });
      return false;
    }
    chrome.tabs.create({ url: url.href, active: true }, tab => {
      if (chrome.runtime.lastError || !tab?.id) { sendResponse({ error: chrome.runtime.lastError?.message || "Onglet impossible à ouvrir." }); return; }
      const tabId = tab.id;
      let responded = false;
      let timer;
      const finish = result => {
        if (responded) return;
        responded = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        sendResponse(result);
      };
      const listener = (updatedId, changeInfo, updatedTab) => {
        if (updatedId === tabId && changeInfo.status === "complete") finish({ ok: true, opened: updatedTab.url || url.href });
      };
      chrome.tabs.onUpdated.addListener(listener);
      timer = setTimeout(() => {
        chrome.tabs.get(tabId, current => {
          if (chrome.runtime.lastError) finish({ error: "Page ouverte, mais chargement non confirmé." });
          else finish({ ok: true, opened: current?.url || url.href, loading: true });
        });
      }, 20000);
      chrome.tabs.get(tabId, current => {
        if (!chrome.runtime.lastError && current?.status === "complete") finish({ ok: true, opened: current.url || url.href });
      });
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
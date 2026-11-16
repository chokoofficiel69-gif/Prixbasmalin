chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "STUDIO_COMPANION_PAGE_ACTION") return false;
  const command = message.command || {};
  approveAndRun(command).then(sendResponse).catch(error => sendResponse({ error: error.message || "Action impossible." }));
  return true;
});

function approveAndRun(command) {
  return new Promise(resolve => {
    const root = document.createElement("div");
    root.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647";
    const shadow = root.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .veil{position:fixed;inset:0;background:rgba(0,0,0,.48);display:grid;place-items:center;font:14px system-ui,sans-serif}
      .panel{width:min(440px,calc(100vw - 32px));background:#111827;color:#f9fafb;border:1px solid #475569;border-radius:16px;padding:20px;box-shadow:0 18px 60px #0008}
      h2{font-size:18px;margin:0 0 8px}.desc{color:#cbd5e1;line-height:1.45;overflow-wrap:anywhere}
      .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}
      button{border:0;border-radius:9px;padding:10px 14px;font-weight:700;cursor:pointer}
      .no{background:#334155;color:white}.yes{background:#38bdf8;color:#082f49}
    `;
    const veil = document.createElement("div"); veil.className = "veil";
    const panel = document.createElement("section"); panel.className = "panel";
    const heading = document.createElement("h2"); heading.textContent = "La Rue / La Ruse demande ton autorisation";
    const desc = document.createElement("div"); desc.className = "desc"; desc.textContent = command.description || "Action dans le navigateur";
    const actions = document.createElement("div"); actions.className = "actions";
    const no = document.createElement("button"); no.className = "no"; no.textContent = "Refuser";
    const yes = document.createElement("button"); yes.className = "yes"; yes.textContent = "Autoriser cette action";
    actions.append(no, yes); panel.append(heading, desc, actions); veil.append(panel); shadow.append(style, veil);
    document.documentElement.append(root);
    const finish = result => { root.remove(); resolve(result); };
    no.addEventListener("click", () => finish({ error: "Action refusée par l’utilisateur." }));
    yes.addEventListener("click", () => {
      try {
        let result;
        if (command.action === "read") {
          result = { url: location.href, title: document.title, text: (document.body?.innerText || "").slice(0, 18000) };
        } else if (command.action === "click") {
          const wanted = String(command.text || "").trim().toLowerCase();
          if (!wanted) throw new Error("Libellé de bouton manquant.");
          if (/supprimer|effacer|payer|paiement|acheter|commander|publier|envoyer|valider|confirmer|delete|remove|pay|purchase|buy|publish|submit|send|confirm/i.test(wanted)) throw new Error("Action sensible bloquée. La Rue ne peut pas valider cette action automatiquement.");
          const candidates = [...document.querySelectorAll("a,button,[role=button]")];
          const target = candidates.find(el => (el.innerText || el.getAttribute("aria-label") || "").trim().toLowerCase() === wanted);
          if (!target) throw new Error("Aucun bouton ou lien avec ce libellé exact.");
          target.click();
          result = { clicked: (target.innerText || wanted).trim(), url: location.href };
        } else if (command.action === "fill") {
          const field = String(command.field || "").trim().toLowerCase();
          const value = String(command.value || "");
          if (!field) throw new Error("Nom du champ manquant.");
          const candidates = [...document.querySelectorAll("input:not([type=password]):not([type=hidden]):not([type=submit]),textarea")];
          const target = candidates.find(el => {
            const label = el.labels ? [...el.labels].map(x => x.innerText).join(" ") : "";
            return [el.placeholder, el.getAttribute("aria-label"), el.name, el.id, label].some(x => String(x || "").trim().toLowerCase() === field);
          });
          if (!target) throw new Error("Champ texte exact introuvable. Aucun formulaire n’a été envoyé.");
          const setter = Object.getOwnPropertyDescriptor(target.constructor.prototype, "value")?.set;
          if (setter) setter.call(target, value); else target.value = value;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
          result = { filled: field, note: "Champ rempli ; formulaire non envoyé." };
        } else throw new Error("Type d’action non pris en charge.");
        finish({ ok: true, result });
      } catch (error) { finish({ error: error.message }); }
    });
  });
}
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://eulzthypxffmfpaqzqld.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hftSFEGcujYAWgPpMt_MrQ_JrKOO1oR";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const style = document.createElement("style");
style.textContent = `
.pm-auth-overlay{position:fixed;inset:0;z-index:15000;background:#111827aa;display:none;align-items:flex-end;justify-content:center;padding:0}
.pm-auth-overlay.open{display:flex}
.pm-auth-panel{width:100%;max-width:520px;max-height:90vh;overflow:auto;background:#fff;border-radius:22px 22px 0 0;padding:22px 18px max(22px,env(safe-area-inset-bottom));font-family:system-ui,sans-serif;color:#202632}
.pm-auth-panel h2{margin:0 0 8px;font-size:24px}.pm-auth-panel p{font-size:13px;line-height:1.5;color:#667085}
.pm-auth-panel label{display:block;font-size:12px;font-weight:700;margin:12px 0 5px}
.pm-auth-panel input{width:100%;min-height:44px;border:1px solid #d8dce3;border-radius:10px;padding:10px;font:inherit}
.pm-auth-actions{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.pm-auth-actions button{border:0;border-radius:10px;padding:11px 14px;font-weight:800;cursor:pointer}
.pm-auth-primary{background:#ff5a1f;color:white}.pm-auth-secondary{background:#f1f2f5;color:#242936}
.pm-auth-message{min-height:20px;margin-top:10px;font-size:12px;color:#b54708}.pm-auth-close{float:right;border:0;border-radius:50%;width:36px;height:36px;font-size:22px;background:#f0f1f4}
.pm-alert-save{display:block;width:100%;margin-top:12px;border:0;border-radius:10px;padding:13px;background:#ff5a1f;color:white;font-weight:800}
@media(min-width:600px){.pm-auth-overlay{align-items:center;padding:18px}.pm-auth-panel{border-radius:22px;padding:24px}}
`;
document.head.append(style);

const overlay = document.createElement("div");
overlay.className = "pm-auth-overlay";
overlay.innerHTML = `<section class="pm-auth-panel" role="dialog" aria-modal="true" aria-labelledby="pmAuthTitle">
<button class="pm-auth-close" type="button" aria-label="Fermer">×</button>
<h2 id="pmAuthTitle">Mon espace Prix Malin</h2>
<p id="pmAuthIntro">Crée ton compte gratuit pour retrouver tes alertes et tes produits suivis.</p>
<form id="pmAuthForm">
<label for="pmAuthEmail">Adresse e-mail</label><input id="pmAuthEmail" type="email" autocomplete="email" required>
<label for="pmAuthPassword">Mot de passe</label><input id="pmAuthPassword" type="password" minlength="8" autocomplete="current-password" required>
<div class="pm-auth-actions"><button class="pm-auth-primary" type="submit" id="pmAuthSubmit">Se connecter</button><button class="pm-auth-secondary" type="button" id="pmAuthSignup">Créer un compte</button></div>
</form>
<div class="pm-auth-actions"><button class="pm-auth-secondary" type="button" id="pmAuthReset">Mot de passe oublié</button><button class="pm-auth-secondary" type="button" id="pmAuthLogout" hidden>Se déconnecter</button></div>
<div class="pm-auth-message" id="pmAuthMessage" role="status" aria-live="polite"></div>
</section>`;
document.body.append(overlay);
const $ = id => document.getElementById(id);
const authForm = $("pmAuthForm");
let mode = "signin";
let pendingAlert = null;

function message(text, error = false) {
  $("pmAuthMessage").textContent = text;
  $("pmAuthMessage").style.color = error ? "#b42318" : "#167a3b";
}
function openAuth() { overlay.classList.add("open"); document.body.style.overflow = "hidden"; refreshAuthUI(); }
function closeAuth() { overlay.classList.remove("open"); document.body.style.overflow = ""; }
async function refreshAuthUI() {
  const { data: { session } } = await supabase.auth.getSession();
  $("pmAuthLogout").hidden = !session;
  $("pmAuthSignup").hidden = !!session;
  $("pmAuthSubmit").hidden = !!session;
  $("pmAuthReset").hidden = !!session;
  $("pmAuthIntro").textContent = session ? `Connecté : ${session.user.email}. Tes alertes sont associées à ce compte.` : "Crée ton compte gratuit pour retrouver tes alertes et tes produits suivis.";
  $("pmAuthTitle").textContent = session ? "Mon espace Prix Malin" : "Mon espace Prix Malin";
  if (session) {
    authForm.hidden = true;
    $("pmAuthIntro").textContent = `Connecté : ${session.user.email}. Tu peux maintenant enregistrer tes alertes.`;
  } else {
    authForm.hidden = false;
  }
}
overlay.querySelector(".pm-auth-close").addEventListener("click", closeAuth);
overlay.addEventListener("click", e => { if (e.target === overlay) closeAuth(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeAuth(); });

authForm.addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("pmAuthEmail").value.trim();
  const password = $("pmAuthPassword").value;
  $("pmAuthSubmit").disabled = true;
  try {
    const result = mode === "signup"
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (mode === "signup" && !result.data.session) {
      message("Compte demandé. Vérifie ta boîte mail pour confirmer l’adresse avant de te connecter.");
    } else {
      message(mode === "signup" ? "Compte créé et connecté." : "Connexion réussie.");
      await refreshAuthUI();
      if (pendingAlert && result.data.session) {
        closeAuth();
        const next = pendingAlert; pendingAlert = null;
        setTimeout(() => openAlert(next.name, next.id), 100);
      }
    }
  } catch (err) {
    message(err.message || "Connexion impossible. Réessaie.", true);
  } finally {
    $("pmAuthSubmit").disabled = false;
  }
});
$("pmAuthSignup").addEventListener("click", async () => {
  mode = "signup"; $("pmAuthSubmit").textContent = "Créer mon compte";
  $("pmAuthPassword").autocomplete = "new-password";
  authForm.requestSubmit();
});
$("pmAuthReset").addEventListener("click", async () => {
  const email = $("pmAuthEmail").value.trim();
  if (!email) return message("Saisis ton adresse e-mail pour recevoir le lien de réinitialisation.", true);
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  message(error ? error.message : "Si cette adresse correspond à un compte, un e-mail de réinitialisation va être envoyé.", !!error);
});
$("pmAuthLogout").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) return message(error.message, true);
  message("Tu es déconnecté.");
  await refreshAuthUI();
});
$("pmAuthSubmit").addEventListener("click", () => { mode = "signin"; $("pmAuthSubmit").textContent = "Se connecter"; });

const alertOverlay = document.createElement("div");
alertOverlay.className = "pm-auth-overlay";
alertOverlay.innerHTML = `<section class="pm-auth-panel" role="dialog" aria-modal="true" aria-labelledby="pmAlertSaveTitle">
<button class="pm-auth-close" type="button" aria-label="Fermer">×</button>
<h2 id="pmAlertSaveTitle">Créer une alerte prix</h2><p id="pmAlertSaveProduct"></p>
<label for="pmAlertTarget">M’avertir si le prix descend sous (en €)</label>
<input id="pmAlertTarget" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Ex. 249,99" required>
<button class="pm-alert-save" type="button" id="pmAlertSaveButton">Enregistrer l’alerte</button>
<div class="pm-auth-message" id="pmAlertSaveMessage" role="status" aria-live="polite"></div>
<p>Cette étape enregistre ton seuil de prix. L’envoi automatique d’e-mails/SMS n’est pas encore activé.</p>
</section>`;
document.body.append(alertOverlay);
alertOverlay.querySelector(".pm-auth-close").addEventListener("click", () => { alertOverlay.classList.remove("open"); document.body.style.overflow = ""; });
alertOverlay.addEventListener("click", e => { if (e.target === alertOverlay) { alertOverlay.classList.remove("open"); document.body.style.overflow = ""; } });

async function openAlert(name, id) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    pendingAlert = { name, id };
    openAuth();
    message("Connecte-toi ou crée un compte pour enregistrer cette alerte.");
    return;
  }
  $("pmAlertSaveProduct").textContent = name;
  $("pmAlertTarget").value = "";
  $("pmAlertSaveMessage").textContent = "";
  alertOverlay.dataset.productId = id;
  alertOverlay.dataset.productName = name;
  alertOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
}
$("pmAlertSaveButton").addEventListener("click", async () => {
  const target = Number($("pmAlertTarget").value);
  if (!Number.isFinite(target) || target <= 0) { $("pmAlertSaveMessage").textContent = "Entre un prix supérieur à zéro."; return; }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { alertOverlay.classList.remove("open"); openAuth(); return; }
  const payload = { user_id: user.id, product_id: alertOverlay.dataset.productId, product_name: alertOverlay.dataset.productName, target_price_eur: target };
  const { error } = await supabase.from("price_alerts").upsert(payload, { onConflict: "user_id,product_id,target_price_eur" });
  $("pmAlertSaveMessage").textContent = error ? error.message : "Alerte enregistrée sur ton compte.";
  $("pmAlertSaveMessage").style.color = error ? "#b42318" : "#167a3b";
  if (!error) setTimeout(() => { alertOverlay.classList.remove("open"); document.body.style.overflow = ""; }, 1200);
});

function installAlertButtons() {
  const cards = document.querySelectorAll(".product");
  cards.forEach((card, index) => {
    const nameEl = card.querySelector(".name, h3, .verified-name, [data-pm-product-name]");
    const name = (card.dataset.pmProductName || nameEl?.textContent || "").trim();
    if (!name || card.querySelector(".pm-auth-alert-button")) return;
    const id = (card.dataset.pmProductId || card.dataset.productId || name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")).slice(0,120) || `product-${index}`;
    const button = document.createElement("button");
    button.type = "button"; button.className = "pm-alert-btn pm-auth-alert-button";
    button.textContent = "🔔 Créer une alerte prix"; button.setAttribute("aria-label", `Créer une alerte prix pour ${name}`);
    button.addEventListener("click", () => openAlert(name, id));
    card.append(button);
  });
}
document.addEventListener("click", e => {
  const account = e.target.closest('[data-nav="account"]');
  if (account) { e.preventDefault(); e.stopImmediatePropagation(); openAuth(); }
}, true);
installAlertButtons();
new MutationObserver(installAlertButtons).observe(document.body, { childList: true, subtree: true });
supabase.auth.onAuthStateChange(() => { refreshAuthUI(); });

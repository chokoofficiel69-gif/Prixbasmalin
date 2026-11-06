/* Prix Malin — illustrations vectorielles sobres pour les produits sans photo libre de droits.
   Utilisé par l'accueil et les fiches produits. */
(function (global) {
  "use strict";
  var stroke = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
  var icons = {
    smartphone: '<rect x="20" y="6" width="24" height="52" rx="5"/><path d="M29 11h6M30 52h4"/>',
    tablette: '<rect x="12" y="8" width="40" height="48" rx="5"/><path d="M30 51h4"/>',
    laptop: '<rect x="14" y="14" width="36" height="25" rx="2.5"/><path d="M8 46h48l-4-7H12z"/>',
    audio: '<path d="M16 38v-6a16 16 0 0 1 32 0v6"/><rect x="11" y="36" width="10" height="16" rx="4"/><rect x="43" y="36" width="10" height="16" rx="4"/>',
    enceinte: '<rect x="12" y="20" width="40" height="26" rx="13"/><circle cx="24" cy="33" r="5"/><circle cx="40" cy="33" r="5"/><path d="M14 46l-2 6M50 46l2 6"/>',
    montre: '<rect x="20" y="18" width="24" height="28" rx="7"/><path d="M24 18l2-10h12l2 10M24 46l2 10h12l2-10M44 28h3"/><path d="M32 26v6l4 3"/>',
    console: '<path d="M18 22h28a10 10 0 0 1 9.8 8l2 12a6 6 0 0 1-10.6 4.6L42 41H22l-5.2 5.6A6 6 0 0 1 6.2 42l2-12A10 10 0 0 1 18 22z"/><path d="M20 30v6M17 33h6"/><circle cx="43" cy="31" r="1.6"/><circle cx="47" cy="35" r="1.6"/>',
    "accessoire-ps5": '<path d="M18 22h28a10 10 0 0 1 9.8 8l2 12a6 6 0 0 1-10.6 4.6L42 41H22l-5.2 5.6A6 6 0 0 1 6.2 42l2-12A10 10 0 0 1 18 22z"/><path d="M20 30v6M17 33h6"/><circle cx="43" cy="31" r="1.6"/><circle cx="47" cy="35" r="1.6"/>',
    "accessoire-switch": '<rect x="14" y="12" width="14" height="40" rx="7"/><rect x="36" y="12" width="14" height="40" rx="7"/><circle cx="21" cy="24" r="3"/><circle cx="43" cy="36" r="3"/>',
    aspirateur: '<path d="M40 6l-8 40"/><rect x="34" y="4" width="10" height="8" rx="2"/><path d="M18 46h22a4 4 0 0 1 4 4v2H14v-2a4 4 0 0 1 4-4z"/><circle cx="20" cy="56" r="2"/><circle cx="38" cy="56" r="2"/>'
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /** Retourne le HTML d'une illustration : icône de catégorie au trait + nom de marque. */
  global.pmProductArt = function (category, brand) {
    var icon = icons[category] || '<path d="M14 22h36l-4 30H18z"/><path d="M24 22a8 8 0 0 1 16 0"/>';
    return '<div class="pm-art" role="img" aria-label="' + esc((brand || "") + " " + (category || "")) + '">' +
      '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" ' + stroke + '>' + icon + '</svg>' +
      (brand ? '<b>' + esc(brand) + '</b>' : '') + '</div>';
  };
  /** Ligne de crédit obligatoire pour les photos sous licence libre. */
  global.pmImageCredit = function (credit) {
    if (!credit || !credit.license) return "";
    return 'Photo : ' + esc(credit.author || "auteur sur Wikimedia Commons") + ' · ' + esc(credit.license) +
      ' · <a href="' + esc(credit.file_page) + '" target="_blank" rel="noopener">Wikimedia Commons</a>';
  };
  // Photo qui ne se charge pas : remplacer par l'illustration (attributs data-category / data-brand sur l'image).
  document.addEventListener("error", function (event) {
    var img = event.target;
    if (!img || img.tagName !== "IMG" || !img.hasAttribute("data-pm-art")) return;
    var holder = img.parentNode;
    if (holder) holder.insertAdjacentHTML("beforeend", global.pmProductArt(img.getAttribute("data-category"), img.getAttribute("data-brand")));
    img.remove();
  }, true);
})(window);

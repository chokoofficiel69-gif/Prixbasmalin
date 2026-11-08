(function () {
  "use strict";

  var slots = document.querySelectorAll("[data-pm-ad-slot]");
  if (!slots.length) return;

  function safeTarget(value) {
    try {
      var url = new URL(String(value || ""));
      return url.protocol === "https:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function safeLocalImage(value) {
    try {
      var url = new URL(String(value || ""), window.location.origin);
      if (url.origin !== window.location.origin) return "";
      if (!url.pathname.startsWith("/assets/ads/")) return "";
      return url.href;
    } catch (_) {
      return "";
    }
  }

  function isActiveCampaign(campaign, placement, now) {
    if (!campaign || campaign.placement !== placement) return false;
    if (campaign.status !== "active" || campaign.approved !== true) return false;
    var start = Date.parse(campaign.starts_at || "");
    var end = Date.parse(campaign.ends_at || "");
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
  }

  function makeElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function render(slot, campaign) {
    var href = safeTarget(campaign.target_url);
    if (!href || !String(campaign.advertiser || "").trim() || !String(campaign.title || "").trim()) return;

    var card = makeElement("a", "pm-partner-ad-card");
    card.href = href;
    card.target = "_blank";
    card.rel = "sponsored nofollow noopener noreferrer";
    card.setAttribute("aria-label", "Publicité partenaire " + campaign.advertiser + " : " + campaign.title);

    var imagePath = safeLocalImage(campaign.image_path);
    if (imagePath) {
      var media = makeElement("span", "pm-partner-ad-media");
      var image = document.createElement("img");
      image.src = imagePath;
      image.alt = String(campaign.image_alt || campaign.title);
      image.loading = "lazy";
      image.decoding = "async";
      media.appendChild(image);
      card.appendChild(media);
    } else {
      card.classList.add("pm-partner-ad-card--text-only");
    }

    var copy = makeElement("span", "pm-partner-ad-copy");
    copy.appendChild(makeElement("span", "pm-partner-ad-label", "Publicité"));
    copy.appendChild(makeElement("strong", "pm-partner-ad-title", campaign.title));
    if (campaign.description) {
      copy.appendChild(makeElement("span", "pm-partner-ad-description", campaign.description));
    }
    copy.appendChild(makeElement("span", "pm-partner-ad-advertiser", campaign.advertiser));
    card.appendChild(copy);
    card.appendChild(makeElement("span", "pm-partner-ad-cta", campaign.call_to_action || "Découvrir"));

    slot.replaceChildren(card);
    slot.hidden = false;
  }

  fetch("/data/partner-ads.json", { cache: "no-store", credentials: "same-origin" })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (data) {
      if (!data || data.schema_version !== 1 || !Array.isArray(data.campaigns)) return;
      var now = Date.now();
      slots.forEach(function (slot) {
        var placement = slot.getAttribute("data-pm-ad-slot");
        var campaign = data.campaigns.find(function (item) {
          return isActiveCampaign(item, placement, now);
        });
        if (campaign) render(slot, campaign);
      });
    })
    .catch(function () {
      // A feed absent or invalid must never leave an empty advertising block.
    });
})();

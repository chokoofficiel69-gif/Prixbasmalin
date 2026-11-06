/* Prix Malin — optimisation prudente des images et stabilité visuelle.
   Ne modifie que les URL de CDN dont les paramètres de redimensionnement sont documentés
   dans les URL déjà utilisées par le site. Aucun proxy, scraping ou service payant. */
(() => {
  "use strict";
  const dimensionsFor = (img) => {
    if (img.closest(".photo")) return [700, 500];
    if (img.closest(".pm-visual-media")) return [700, 525];
    if (img.closest(".new-arrival-media")) return [700, 450];
    if (img.closest(".pm-discovery-card")) return [480, 480];
    if (img.closest(".cat")) return [400, 300];
    if (img.closest(".hero")) return [768, 284];
    return null;
  };

  const optimizeUrl = (raw) => {
    if (!raw || !/^https?:\/\//i.test(raw)) return raw;
    try {
      const url = new URL(raw, location.href);
      const host = url.hostname.toLowerCase();

      // Amplience : le flux utilise déjà fmt/qlt/w ; réduire uniquement la largeur.
      if (host === "cdn.media.amplience.net" || host.endsWith(".media.amplience.net")) {
        if (url.searchParams.has("w")) url.searchParams.set("w", "640");
        if (url.searchParams.has("qlt")) url.searchParams.set("qlt", "75");
        if (url.searchParams.has("fmt")) url.searchParams.set("fmt", "auto");
      }
      // Lacoste (Demandware) : imwidth est déjà présent dans l'URL d'origine.
      if (host === "image1.lacoste.com" && url.searchParams.has("imwidth")) {
        url.searchParams.set("imwidth", "700");
      }
      // Decathlon : le paramètre f contrôle déjà la largeur dans l'URL source.
      if (host === "contents.mediadecathlon.com" && url.searchParams.has("f")) {
        const value = url.searchParams.get("f") || "";
        if (/^\d+x0$/.test(value)) url.searchParams.set("f", "700x0");
        if (url.searchParams.has("format")) url.searchParams.set("format", "auto");
      }
      return url.href;
    } catch (_) {
      return raw;
    }
  };

  const prepareImage = (img) => {
    if (!(img instanceof HTMLImageElement)) return;
    const reservedSize = dimensionsFor(img);
    if (reservedSize && (!img.hasAttribute("width") || !img.hasAttribute("height"))) {
      const [width, height] = reservedSize;
      if (!img.hasAttribute("width")) img.setAttribute("width", String(width));
      if (!img.hasAttribute("height")) img.setAttribute("height", String(height));
    }
    if (!img.hasAttribute("decoding")) img.decoding = "async";

    const isBrand = img.closest(".brand");
    const isHero = img.closest(".hero") || img.id === "pm-hero-exact";
    if (isHero) {
      img.loading = "eager";
      img.fetchPriority = "high";
    } else if (!isBrand && !img.hasAttribute("loading")) {
      img.loading = "lazy";
    }

    const current = img.getAttribute("src");
    if (current && !img.dataset.pmOptimizedSrc) {
      const optimized = optimizeUrl(current);
      if (optimized && optimized !== current) {
        img.dataset.pmOptimizedSrc = optimized;
        img.setAttribute("src", optimized);
      } else {
        img.dataset.pmOptimizedSrc = current;
      }
    }
  };

  const scan = (root) => {
    if (root instanceof HTMLImageElement) prepareImage(root);
    if (root && root.querySelectorAll) root.querySelectorAll("img").forEach(prepareImage);
  };

  scan(document);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
        const current = record.target.getAttribute("src");
        if (current !== record.target.dataset.pmOptimizedSrc) {
          record.target.dataset.pmOptimizedSrc = "";
          prepareImage(record.target);
        }
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) scan(node);
      }
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src"]
  });
})();

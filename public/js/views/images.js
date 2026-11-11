import { api, h, state, toast, toastErr, fileUrl, uploadFile, pickLocalFiles, pickFromLibrary, fetchFileBlob, downloadBlob, modal, md } from '../lib/core.js';

export async function render(el, { params }) {
  let tab = params.get('edit') ? 'edit' : 'create';
  const tabs = h('div.tabs');
  const body = h('div');
  const drawTabs = () => {
    tabs.innerHTML = '';
    for (const [k, l] of [['create', '✨ Créer une image'], ['edit', '🖌️ Retoucher une image']]) {
      tabs.append(h('button.btn.small' + (tab === k ? '.active' : ''), { onclick: () => { tab = k; drawTabs(); draw(); } }, l));
    }
  };
  const draw = () => { body.innerHTML = ''; tab === 'create' ? drawCreate(body) : drawEditor(body, params.get('edit')); };
  drawTabs(); draw();
  el.append(tabs, body);
}

function drawCreate(root) {
  const prompt = h('textarea', { rows: 4, placeholder: 'Décrivez l’image : sujet, style, lumière, ambiance… Ex : « Pochette d’album rap, ville la nuit sous la pluie, néons violets, style cinéma »' });
  const size = h('select', [['1024x1024', 'Carré 1:1'], ['1344x768', 'Paysage 16:9'], ['768x1344', 'Portrait 9:16 (stories, clips)'], ['896x1152', 'Portrait 4:5 (Instagram)']].map(([v, l]) => h('option', { value: v }, l)));
  const n = h('select', [1, 2, 3, 4].map(v => h('option', { value: v }, `${v} image${v > 1 ? 's' : ''}`)));
  const go = h('button.btn.primary', '🎨 Générer');
  const improve = h('button.btn', '✨ Améliorer la description');
  const results = h('div.file-grid');
  const info = h('p.small.muted');

  improve.onclick = async () => {
    if (!prompt.value.trim()) return toast('Écrivez d’abord une idée.');
    improve.disabled = true;
    try {
      const r = await api('/api/complete', { method: 'POST', body: { src: 'images', prompt: `Transforme cette idée en un prompt détaillé pour un générateur d'images (en anglais, 60 mots max, sujet + style + composition + lumière + couleurs). Réponds uniquement par le prompt.\n\nIdée : ${prompt.value}` } });
      prompt.value = r.content.trim().replace(/^"|"$/g, '');
    } catch (e) { toastErr(e); }
    improve.disabled = false;
  };
  go.onclick = async () => {
    if (!prompt.value.trim()) return toast('Décrivez l’image.');
    go.disabled = true; go.innerHTML = '<span class="spinner"></span> Génération…';
    info.textContent = 'Cela peut prendre de 5 secondes à 1 minute selon le fournisseur.';
    try {
      const r = await api('/api/images', { method: 'POST', body: { prompt: prompt.value, size: size.value, n: Number(n.value), projectId: state.projectId } });
      info.textContent = `Créé par ${r.provider || '?'} / ${r.model || '?'} — enregistré dans vos fichiers.`;
      for (const f of r.files) {
        results.prepend(h('div.file-card',
          h('div.thumb', { onclick: () => window.open(fileUrl(f.id), '_blank') }, h('img', { src: fileUrl(f.id), alt: '' })),
          h('div.info', h('div.name', f.name), h('div.acts',
            h('a.btn.small', { href: `#/images?edit=${f.id}` }, '🖌️ Retoucher'),
            h('a.btn.small', { href: fileUrl(f.id, true) }, '⬇️')))));
      }
    } catch (e) {
      info.textContent = '';
      toastErr(e);
      if (/aucun|no .*model|503|404/i.test(e.message)) info.textContent = 'Astuce : activez un fournisseur d’images dans FreeLLMAPI (onglet Models → Image). Pollinations fonctionne sans clé.';
    }
    go.disabled = false; go.textContent = '🎨 Générer';
  };

  root.append(h('div.card.stack',
    prompt,
    h('div.row', h('div.grow', size), h('div', n), improve, go),
    h('div.notice', 'Les images sont créées par les fournisseurs gratuits reliés à FreeLLMAPI (ex. Pollinations, Cloudflare, NVIDIA selon vos clés). Chaque image compte dans le plafond média journalier.'),
    info, results));
}

// ---------------- Éditeur ----------------
function drawEditor(root, initialId) {
  const S = { img: null, name: 'image', rot: 0, flipH: false, flipV: false, crop: null,
    f: { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, sepia: 0, grayscale: 0, vignette: 0 }, texts: [] };
  const canvas = h('canvas.editor-canvas');
  const ctx = canvas.getContext('2d');
  let mode = 'view'; // view | crop | text
  let ratio = 0;
  let cropRect = null, dragStart = null;

  const empty = h('div.drop', 'Choisissez une image : depuis votre appareil, vos fichiers, ou prenez une photo.');
  const loadBlob = async (blob, name) => {
    S.img = await createImageBitmap(blob);
    S.name = (name || 'image').replace(/\.\w+$/, '');
    S.rot = 0; S.flipH = S.flipV = false; S.crop = null; S.texts = [];
    empty.style.display = 'none'; canvas.style.display = '';
    paint();
  };

  function baseSize() {
    const rotated = S.rot % 180 !== 0;
    return { w: rotated ? S.img.height : S.img.width, h: rotated ? S.img.width : S.img.height };
  }
  function filterStr() {
    const f = S.f;
    return `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) hue-rotate(${f.hue}deg) blur(${f.blur}px) sepia(${f.sepia}%) grayscale(${f.grayscale}%)`;
  }
  /** Dessine l'image transformée dans un canvas (taille finale ou aperçu). */
  function renderTo(c, scale = 1, ignoreCrop = false) {
    const b = baseSize();
    const crop = !ignoreCrop && S.crop ? S.crop : { x: 0, y: 0, w: 1, h: 1 };
    c.width = Math.max(1, Math.round(b.w * crop.w * scale));
    c.height = Math.max(1, Math.round(b.h * crop.h * scale));
    const g = c.getContext('2d');
    g.save();
    g.filter = filterStr();
    g.translate(-crop.x * b.w * scale, -crop.y * b.h * scale);
    g.translate((b.w * scale) / 2, (b.h * scale) / 2);
    g.rotate((S.rot * Math.PI) / 180);
    g.scale(S.flipH ? -1 : 1, S.flipV ? -1 : 1);
    g.drawImage(S.img, (-S.img.width * scale) / 2, (-S.img.height * scale) / 2, S.img.width * scale, S.img.height * scale);
    g.restore();
    if (S.f.vignette > 0) {
      const grd = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.3, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.75);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, `rgba(0,0,0,${S.f.vignette / 100})`);
      g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
    }
    if (!ignoreCrop) for (const t of S.texts) {
      const size = t.size * c.width / 1000;
      g.font = `${t.bold ? '800' : '500'} ${size}px ${t.font}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = size * 0.12; g.strokeStyle = 'rgba(0,0,0,.75)';
      const lines = t.text.split('\n');
      lines.forEach((ln, i) => {
        const y = t.y * c.height + (i - (lines.length - 1) / 2) * size * 1.15;
        if (t.stroke) g.strokeText(ln, t.x * c.width, y);
        g.fillStyle = t.color; g.fillText(ln, t.x * c.width, y);
      });
    }
  }
  function paint() {
    if (!S.img) return;
    const b = baseSize();
    const maxW = Math.min(1400, b.w);
    renderTo(canvas, maxW / b.w, mode === 'crop');
    if (mode === 'crop' && cropRect) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      const r = { x: cropRect.x * canvas.width, y: cropRect.y * canvas.height, w: cropRect.w * canvas.width, h: cropRect.h * canvas.height };
      ctx.fillRect(0, 0, canvas.width, r.y); ctx.fillRect(0, r.y + r.h, canvas.width, canvas.height - r.y - r.h);
      ctx.fillRect(0, r.y, r.x, r.h); ctx.fillRect(r.x + r.w, r.y, canvas.width - r.x - r.w, r.h);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!S.img) return;
    const p = pos(e);
    if (mode === 'crop') { dragStart = p; cropRect = { x: p.x, y: p.y, w: 0, h: 0 }; canvas.setPointerCapture(e.pointerId); }
    if (mode === 'text' && S.texts.length) { const t = S.texts[S.texts.length - 1]; t.x = p.x; t.y = p.y; dragStart = p; canvas.setPointerCapture(e.pointerId); paint(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragStart) return;
    const p = pos(e);
    if (mode === 'crop') {
      let w = p.x - dragStart.x, hh = p.y - dragStart.y;
      if (ratio) {
        const b = baseSize();
        const px = Math.abs(w) * b.w; const py = px / ratio;
        hh = Math.sign(hh || 1) * py / b.h;
      }
      cropRect = { x: Math.min(dragStart.x, dragStart.x + w), y: Math.min(dragStart.y, dragStart.y + hh), w: Math.abs(w), h: Math.abs(hh) };
      cropRect.x = Math.max(0, cropRect.x); cropRect.y = Math.max(0, cropRect.y);
      cropRect.w = Math.min(cropRect.w, 1 - cropRect.x); cropRect.h = Math.min(cropRect.h, 1 - cropRect.y);
    } else if (mode === 'text') { const t = S.texts[S.texts.length - 1]; t.x = p.x; t.y = p.y; }
    paint();
  });
  canvas.addEventListener('pointerup', () => { dragStart = null; });

  // --- Contrôles ---
  const slider = (key, label, min, max, unit = '') => {
    const val = h('b', S.f[key] + unit);
    const inp = h('input', { type: 'range', min, max, value: S.f[key], oninput: (e) => { S.f[key] = Number(e.target.value); val.textContent = S.f[key] + unit; paint(); } });
    return h('label', h('span', label, ' ', val), inp);
  };
  const slidersBox = h('div');
  const buildSliders = () => {
    slidersBox.innerHTML = '';
    slidersBox.append(h('div.sliders',
      slider('brightness', 'Luminosité', 0, 200, ' %'), slider('contrast', 'Contraste', 0, 200, ' %'), slider('saturate', 'Saturation', 0, 300, ' %'),
      slider('hue', 'Teinte', -180, 180, '°'), slider('blur', 'Flou', 0, 20, ' px'), slider('sepia', 'Sépia', 0, 100, ' %'),
      slider('grayscale', 'Noir et blanc', 0, 100, ' %'), slider('vignette', 'Vignettage', 0, 90, ' %')));
  };
  buildSliders();
  const presets = h('div.row', [['Naturel', {}], ['Éclatant', { contrast: 115, saturate: 140, brightness: 105 }], ['Cinéma', { contrast: 120, saturate: 80, sepia: 15, vignette: 45 }],
    ['N&B contrasté', { grayscale: 100, contrast: 140 }], ['Vintage', { sepia: 45, contrast: 90, saturate: 80, vignette: 35 }], ['Nuit néon', { hue: -25, saturate: 170, contrast: 125, brightness: 90 }]].map(([l, p]) =>
    h('button.btn.small', { onclick: () => { Object.assign(S.f, { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, sepia: 0, grayscale: 0, vignette: 0 }, p); buildSliders(); paint(); } }, l)));

  const ratioSel = h('select', { onchange: () => { ratio = Number(ratioSel.value); } }, [['0', 'Libre'], ['1', '1:1'], [String(16 / 9), '16:9'], [String(9 / 16), '9:16'], [String(4 / 5), '4:5'], [String(3 / 2), '3:2']].map(([v, l]) => h('option', { value: v }, l)));
  const cropBtn = h('button.btn.small', '✂️ Recadrer');
  cropBtn.onclick = () => {
    if (mode !== 'crop') { mode = 'crop'; cropRect = null; cropBtn.textContent = '✅ Appliquer le recadrage'; cropBtn.classList.add('on'); paint(); toast('Tracez le cadre sur l’image.'); return; }
    if (cropRect && cropRect.w > 0.02 && cropRect.h > 0.02) S.crop = cropRect;
    mode = 'view'; cropBtn.textContent = '✂️ Recadrer'; cropBtn.classList.remove('on'); paint();
  };
  const txtInput = h('textarea', { rows: 2, placeholder: 'Texte à ajouter (titre, sous-titre…)' });
  const txtColor = h('input', { type: 'color', value: '#ffffff' });
  const txtSize = h('input', { type: 'range', min: 20, max: 200, value: 70 });
  const txtFont = h('select', ['Impact, sans-serif', 'Georgia, serif', 'system-ui, sans-serif', '"Courier New", monospace', '"Brush Script MT", cursive'].map(f => h('option', { value: f }, f.split(',')[0].replace(/"/g, ''))));
  const addText = () => {
    if (!txtInput.value.trim()) return toast('Écrivez le texte.');
    S.texts.push({ text: txtInput.value, x: 0.5, y: 0.85, size: Number(txtSize.value), color: txtColor.value, font: txtFont.value, bold: true, stroke: true });
    mode = 'text'; paint(); toast('Touchez ou glissez sur l’image pour placer le texte.');
  };
  for (const c of [txtColor, txtSize, txtFont]) c.addEventListener('input', () => { const t = S.texts[S.texts.length - 1]; if (t) { t.color = txtColor.value; t.size = Number(txtSize.value); t.font = txtFont.value; paint(); } });

  const fmt = h('select', [['image/png', 'PNG'], ['image/jpeg', 'JPEG'], ['image/webp', 'WebP']].map(([v, l]) => h('option', { value: v }, l)));
  const maxW = h('select', [['0', 'Taille d’origine'], ['3840', '3840 px'], ['1920', '1920 px'], ['1080', '1080 px'], ['720', '720 px']].map(([v, l]) => h('option', { value: v }, l)));
  async function exportBlob() {
    const c = document.createElement('canvas');
    const b = baseSize();
    const cw = b.w * (S.crop?.w || 1);
    const target = Number(maxW.value);
    renderTo(c, target && cw > target ? target / cw : 1);
    return new Promise((r) => c.toBlob(r, fmt.value, 0.92));
  }
  const ext = () => fmt.value.split('/')[1].replace('jpeg', 'jpg');

  root.append(h('div.grid.two',
    h('div.card.stack',
      h('div.row',
        h('button.btn.small', { onclick: async () => { const [f] = await pickLocalFiles('image/*', false); if (f) loadBlob(f, f.name).catch(toastErr); } }, '📱 Depuis l’appareil'),
        h('button.btn.small', { onclick: async () => { const [f] = await pickFromLibrary({ kinds: ['image'], multiple: false }); if (f) loadBlob(await fetchFileBlob(f.id), f.name).catch(toastErr); } }, '📚 Mes fichiers'),
        h('button.btn.small', { onclick: async () => { const [f] = await pickLocalFiles('image/*', false, 'environment'); if (f) loadBlob(f, f.name).catch(toastErr); } }, '📷 Photo')),
      empty, canvas,
    ),
    h('div.card.stack',
      h('h3', 'Transformer'),
      h('div.row',
        h('button.btn.small', { onclick: () => { S.rot = (S.rot + 270) % 360; S.crop = null; paint(); } }, '⟲ 90°'),
        h('button.btn.small', { onclick: () => { S.rot = (S.rot + 90) % 360; S.crop = null; paint(); } }, '⟳ 90°'),
        h('button.btn.small', { onclick: () => { S.flipH = !S.flipH; paint(); } }, '⇋ Miroir'),
        h('button.btn.small', { onclick: () => { S.flipV = !S.flipV; paint(); } }, '⇵ Retourner'),
        ratioSel, cropBtn,
        h('button.btn.small.ghost', { onclick: () => { S.crop = null; paint(); } }, 'Annuler recadrage')),
      h('h3', 'Réglages'), presets, slidersBox,
      h('h3', 'Texte'), txtInput, h('div.row', txtFont, txtColor, h('label.f.grow', 'Taille', txtSize)),
      h('div.row', h('button.btn.small', { onclick: addText }, '＋ Ajouter le texte'), h('button.btn.small.ghost', { onclick: () => { S.texts.pop(); paint(); } }, 'Retirer le dernier texte')),
      h('h3', 'IA'),
      h('div.row', h('button.btn.small', { onclick: async (e) => {
        if (!S.img) return;
        e.target.disabled = true;
        try {
          const c = document.createElement('canvas'); renderTo(c, Math.min(1, 1024 / baseSize().w));
          const r = await api('/api/complete', { method: 'POST', body: { src: 'images', messages: [{ role: 'user', content: [{ type: 'text', text: 'Décris précisément cette image en français, puis propose 3 idées de retouche ou de légende.' }, { type: 'image_url', image_url: { url: c.toDataURL('image/jpeg', 0.85) } }] }] } });
          await modal('Analyse de l’image', h('div.md', { html: md(r.content) }));
        } catch (err) { toastErr(err); }
        e.target.disabled = false;
      } }, '👁️ Décrire / conseiller (IA)')),
      h('p.tiny.muted', 'La retouche générative (remplacer un objet, changer le décor) n’est pas proposée gratuitement de façon fiable par les fournisseurs actuels : utilisez « Créer une image » avec une description.'),
      h('h3', 'Exporter'),
      h('div.row', fmt, maxW,
        h('button.btn.primary.small', { onclick: async () => { if (!S.img) return; const b = await exportBlob(); await uploadFile(b, { name: `${S.name}-retouche.${ext()}`, source: 'retouche' }).then(() => toast('Enregistré dans Fichiers', 'ok')).catch(toastErr); } }, '💾 Enregistrer'),
        h('button.btn.small', { onclick: async () => { if (!S.img) return; downloadBlob(await exportBlob(), `${S.name}-retouche.${ext()}`); } }, '⬇️ Télécharger')),
    ),
  ));
  canvas.style.display = 'none';
  if (initialId) api(`/api/files`).then(({ files }) => { const f = files.find(x => x.id === initialId); return fetchFileBlob(initialId).then(b => loadBlob(b, f?.name)); }).catch(toastErr);
}

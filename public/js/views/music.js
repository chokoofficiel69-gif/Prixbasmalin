import { api, h, state, md, toast, toastErr, uploadFile, downloadBlob, parseJsonLoose, pickFromLibrary, fetchFileBlob, fmtTime, promptBox, fileUrl } from '../lib/core.js';
import { STYLES, defaultSong, sanitizeSong, renderSong, COMPOSER_PROMPT, songDuration } from '../lib/music.js';
import { encodeWav, drawWave, bufferPlayer } from '../lib/audio.js';

const LS = 'studio.song';

export async function render(el, { params }) {
  let tab = params.get('tab') || 'beat';
  const tabs = h('div.tabs');
  const body = h('div');
  let cleanup = null;
  const drawTabs = () => {
    tabs.innerHTML = '';
    for (const [k, l] of [['beat', '🥁 Instrumentale'], ['lyrics', '✍️ Paroles & refrains'], ['voice', '🗣️ Voix IA']]) {
      tabs.append(h('button.btn.small' + (tab === k ? '.active' : ''), { onclick: () => { tab = k; drawTabs(); draw(); } }, l));
    }
  };
  const draw = () => { cleanup?.(); cleanup = null; body.innerHTML = ''; cleanup = tab === 'beat' ? drawBeat(body) : tab === 'lyrics' ? drawLyrics(body) : drawVoice(body); };
  drawTabs(); draw();
  el.append(tabs, body);
  return () => cleanup?.();
}

// ---------------------------------------------------------------- Instrumentale
function drawBeat(root) {
  let song = sanitizeSong(JSON.parse(localStorage.getItem(LS) || 'null') || defaultSong('trap'));
  let rendered = null, dirty = true;
  const persist = () => { localStorage.setItem(LS, JSON.stringify(song)); dirty = true; };
  const wave = h('canvas.wave');
  const timeLbl = h('span.small.muted', '0:00');
  const player = bufferPlayer((t, ended) => { timeLbl.textContent = `${fmtTime(t)} / ${fmtTime(rendered?.full.duration)}`; if (rendered) drawWave(wave, rendered.full, { playhead: t }); if (ended) playBtn.textContent = '▶ Écouter'; });
  wave.addEventListener('click', (e) => { if (!rendered) return; const r = wave.getBoundingClientRect(); player.seek(((e.clientX - r.left) / r.width) * rendered.full.duration); });

  const desc = h('textarea', { rows: 3, placeholder: 'Décrivez l’instru : « trap sombre et mélancolique, piano + 808 qui glisse, 140 BPM, pour un rap introspectif »' });
  const styleSel = h('select', Object.entries(STYLES).map(([k, s]) => h('option', { value: k }, s.label)));
  styleSel.value = song.style;
  const notes = h('p.small.muted');
  const editor = h('div.stack');
  const status = h('span.small.muted');

  async function doRender() {
    status.innerHTML = '<span class="spinner"></span> Calcul de l’audio…';
    try {
      rendered = await renderSong(song, { onProgress: (s) => { status.innerHTML = `<span class="spinner"></span> ${{ drums: 'Batterie', bass: 'Basse', chords: 'Accords', lead: 'Mélodie', mix: 'Mixage' }[s] || s}…`; } });
      dirty = false;
      drawWave(wave, rendered.full);
      status.textContent = `Prêt : ${fmtTime(rendered.full.duration)} · ${song.bpm} BPM · ${song.key} ${song.scale}`;
    } catch (e) { status.textContent = ''; toastErr(e); }
    return rendered;
  }
  const playBtn = h('button.btn.primary', '▶ Écouter');
  playBtn.onclick = async () => {
    if (player.playing) { player.pause(); playBtn.textContent = '▶ Écouter'; return; }
    if (dirty || !rendered) { player.stop(); await doRender(); player.load(rendered.full); }
    player.play(); playBtn.textContent = '⏸ Pause';
  };
  const ensure = async () => (dirty || !rendered ? doRender() : rendered);
  const safeName = () => (song.title || 'morceau').replace(/[^\w\-À-ÿ ]+/g, '').trim().replace(/\s+/g, '-') || 'morceau';

  async function compose() {
    if (!desc.value.trim()) return toast('Décrivez l’instrumentale souhaitée.');
    composeBtn.disabled = true; composeBtn.innerHTML = '<span class="spinner"></span> Composition…';
    try {
      const r = await api('/api/complete', { method: 'POST', body: { src: 'musique', projectId: state.projectId, system: COMPOSER_PROMPT, prompt: `Demande : ${desc.value}\nStyle de départ suggéré : ${styleSel.value}`, temperature: 0.8 } });
      const j = parseJsonLoose(r.content);
      if (!j) throw new Error('La réponse de l’IA n’était pas une partition lisible. Réessayez.');
      song = sanitizeSong({ ...defaultSong(STYLES[j.style] ? j.style : styleSel.value), ...j });
      notes.textContent = j.notes ? `🎼 ${j.notes} (via ${r.routedVia})` : `Composé via ${r.routedVia}`;
      persist(); drawEditor(); player.stop(); await doRender(); player.load(rendered.full); player.play(); playBtn.textContent = '⏸ Pause';
    } catch (e) { toastErr(e); }
    composeBtn.disabled = false; composeBtn.textContent = '🎼 Composer avec l’IA';
  }
  const composeBtn = h('button.btn.primary', { onclick: compose }, '🎼 Composer avec l’IA');

  function stepRow(label, get, set) {
    const row = [h('span', label)];
    for (let i = 0; i < 16; i++) {
      const b = h('button' + (get()[i] === 'x' ? '.on' : '') + (i % 4 === 0 ? '.beat' : ''), { title: `${label} pas ${i + 1}` });
      b.onclick = () => { const p = get().split(''); p[i] = p[i] === 'x' ? '.' : 'x'; set(p.join('')); b.classList.toggle('on'); persist(); };
      row.push(b);
    }
    return row;
  }
  function drawEditor() {
    editor.innerHTML = '';
    const num = (k, min, max, stepv = 1) => h('input', { type: 'number', min, max, step: stepv, value: song[k], onchange: (e) => { song[k] = Number(e.target.value); song = sanitizeSong(song); persist(); } });
    const sel = (k, opts) => { const s = h('select', { onchange: (e) => { song[k] = e.target.value; persist(); } }, opts.map(([v, l]) => h('option', { value: v }, l))); s.value = song[k]; return s; };
    const prog = h('input', { value: song.progression.join(' '), onchange: (e) => { song.progression = e.target.value.split(/[\s,|]+/).filter(Boolean); song = sanitizeSong(song); e.target.value = song.progression.join(' '); persist(); } });
    const bassSel = h('select', { onchange: (e) => { song.bass.type = e.target.value; persist(); } }, h('option', { value: '808' }, 'Basse 808'), h('option', { value: 'synth' }, 'Basse synthé'));
    bassSel.value = song.bass.type;
    editor.append(
      h('div.row',
        h('label.f.grow', 'Titre', h('input', { value: song.title, onchange: (e) => { song.title = e.target.value; persist(); } })),
        h('label.f', 'BPM', num('bpm', 50, 200)),
        h('label.f', 'Tonalité', sel('key', ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].map(x => [x, x]))),
        h('label.f', 'Gamme', sel('scale', [['minor', 'mineure'], ['major', 'majeure'], ['dorian', 'dorienne'], ['phrygian', 'phrygienne'], ['harmonic', 'mineure harmonique']])),
        h('label.f', 'Swing', num('swing', 0, 0.4, 0.02))),
      h('div.row',
        h('label.f.grow', 'Accords (un par mesure)', prog),
        h('label.f', 'Nappe / accords', sel('pad', [['warm', 'Nappe chaude'], ['dark', 'Nappe sombre'], ['strings', 'Cordes'], ['keys', 'Piano électrique'], ['organ', 'Orgue']])),
        h('label.f', 'Mélodie', sel('lead', [['bell', 'Cloche'], ['pluck', 'Pluck'], ['piano', 'Piano'], ['saw', 'Synthé']])),
        h('label.f', 'Basse', bassSel)),
      h('h3', '🥁 Séquenceur (16 pas par mesure)'),
      h('div.steps16',
        stepRow('Kick', () => song.drums.kick, v => (song.drums.kick = v)),
        stepRow('Caisse', () => song.drums.snare, v => (song.drums.snare = v)),
        stepRow('Clap', () => song.drums.clap, v => (song.drums.clap = v)),
        stepRow('Charley', () => song.drums.hat, v => (song.drums.hat = v)),
        stepRow('Ch. ouv.', () => song.drums.openhat, v => (song.drums.openhat = v)),
        stepRow('Basse', () => song.bass.pattern, v => (song.bass.pattern = v)),
        stepRow('Mélodie', () => song.leadPattern, v => { song.leadPattern = v; song.melody = null; })),
      h('h3', '🧱 Structure'),
      sectionsEditor(),
      h('h3', '🎚️ Mixage des pistes (dB)'),
      h('div.sliders', ['drums', 'bass', 'chords', 'lead'].map(k => {
        const v = h('b', song.mixer[k]);
        return h('label', h('span', { drums: 'Batterie', bass: 'Basse', chords: 'Accords', lead: 'Mélodie' }[k], ' ', v),
          h('input', { type: 'range', min: -24, max: 6, value: song.mixer[k], oninput: (e) => { song.mixer[k] = Number(e.target.value); v.textContent = e.target.value; persist(); } }));
      })),
    );
  }
  function sectionsEditor() {
    const box = h('div.stack');
    const LAYERS = [['drums', 'Batterie'], ['kick', 'Kick seul'], ['hat', 'Charley seul'], ['bass', 'Basse'], ['pad', 'Accords'], ['lead', 'Mélodie']];
    song.sections.forEach((s, i) => {
      box.append(h('div.row',
        h('input', { value: s.name, style: { width: '120px' }, onchange: (e) => { s.name = e.target.value; persist(); } }),
        h('input', { type: 'number', min: 1, max: 32, value: s.bars, style: { width: '70px' }, title: 'mesures', onchange: (e) => { s.bars = Math.max(1, Number(e.target.value) || 1); persist(); dur.textContent = fmtTime(songDuration(song)); } }),
        LAYERS.map(([k, l]) => h('label.chk.small', h('input', { type: 'checkbox', checked: s.layers.includes(k), onchange: (e) => { s.layers = e.target.checked ? [...s.layers, k] : s.layers.filter(x => x !== k); persist(); } }), l)),
        h('button.btn.ghost.small', { onclick: () => { song.sections.splice(i, 1); persist(); drawEditor(); } }, '✕')));
    });
    const dur = h('span.small.muted', fmtTime(songDuration(song)));
    box.append(h('div.row', h('button.btn.small', { onclick: () => { song.sections.push({ name: 'Partie', bars: 8, layers: ['drums', 'bass', 'pad'] }); persist(); drawEditor(); } }, '＋ Partie'), h('span.small.muted', 'Durée totale : '), dur));
    return box;
  }
  drawEditor();

  root.append(h('div.stack',
    h('div.card.stack',
      h('h3', '🎹 Créer une instrumentale'),
      desc,
      h('div.row', h('div.grow', styleSel), composeBtn,
        h('button.btn', { onclick: () => { song = defaultSong(styleSel.value); notes.textContent = ''; persist(); drawEditor(); player.stop(); rendered = null; toast(`Modèle « ${STYLES[styleSel.value].label} » chargé`); } }, '🎲 Partir du style (sans IA)')),
      notes,
      h('div.notice', 'L’audio est réellement synthétisé dans votre navigateur (batterie, 808, accords, mélodie) : exportable en WAV et en pistes séparées, sans aucun coût. La composition par IA consomme quelques tokens.'),
    ),
    h('div.card.stack',
      h('div.row', playBtn, h('button.btn', { onclick: () => { player.stop(); playBtn.textContent = '▶ Écouter'; } }, '⏹'), timeLbl, h('span.grow'), status),
      wave,
      h('div.row',
        h('button.btn.small', { onclick: async () => { const r = await ensure(); if (r) downloadBlob(encodeWav(r.full), `${safeName()}.wav`); } }, '⬇️ WAV'),
        h('button.btn.small', { onclick: async () => { const r = await ensure(); if (!r) return; for (const [k, b] of Object.entries(r.stems)) downloadBlob(encodeWav(b), `${safeName()}-${k}.wav`); } }, '⬇️ Pistes séparées (4 WAV)'),
        h('button.btn.small', { onclick: async () => {
          const r = await ensure(); if (!r) return;
          try {
            const f = await uploadFile(encodeWav(r.full), { name: `${safeName()}.wav`, source: 'instru' });
            await uploadFile(new Blob([JSON.stringify(song, null, 1)], { type: 'application/json' }), { name: `${safeName()}.partition.json`, source: 'partition' });
            localStorage.setItem('studio.lastBeat', f.id);
            toast('Instru + partition enregistrées dans Fichiers', 'ok');
          } catch (e) { toastErr(e); }
        } }, '💾 Enregistrer'),
        h('button.btn.small', { onclick: async () => {
          const r = await ensure(); if (!r) return;
          try {
            const f = await uploadFile(encodeWav(r.full), { name: `${safeName()}.wav`, source: 'instru' });
            localStorage.setItem('studio.lastBeat', f.id);
            location.hash = '#/enregistrement?beat=' + f.id;
          } catch (e) { toastErr(e); }
        } }, '🎙️ Poser ma voix dessus'),
        h('button.btn.small.ghost', { onclick: async () => {
          const [f] = await pickFromLibrary({ kinds: ['text', 'autre'], multiple: false, title: 'Ouvrir une partition (.json)' });
          if (!f) return;
          try { song = sanitizeSong(JSON.parse(await (await fetchFileBlob(f.id)).text())); persist(); drawEditor(); rendered = null; toast('Partition chargée'); } catch { toast('Ce fichier n’est pas une partition valide.', 'bad'); }
        } }, '📂 Ouvrir une partition')),
    ),
    h('div.card.stack', editor),
  ));
  return () => player.stop();
}

// ---------------------------------------------------------------- Paroles
const syllables = (line) => (line.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/e\b/g, '').match(/[aeiouy]+/g) || []).length;

function drawLyrics(root) {
  const theme = h('input', { placeholder: 'Thème : la persévérance, mon quartier, une rupture, la réussite…' });
  const style = h('select', ['Rap conscient', 'Trap', 'Drill', 'Rap mélodique', 'R&B', 'Chanson française', 'Afro', 'Pop'].map(x => h('option', x)));
  const mood = h('select', ['Motivant', 'Mélancolique', 'Énervé', 'Joyeux', 'Introspectif', 'Romantique', 'Égotrip'].map(x => h('option', x)));
  const structure = h('select', [['refrain', 'Refrain seul (hook)'], ['couplet', '1 couplet (16 mesures)'], ['complet', 'Morceau : 2 couplets + refrain + pont'], ['toplines', '3 propositions de refrain']].map(([v, l]) => h('option', { value: v }, l)));
  const bpm = h('input', { type: 'number', value: 90, min: 60, max: 180, style: { width: '90px' } });
  const extra = h('textarea', { rows: 2, placeholder: 'Précisions : mots à placer, punchlines, interdits, anecdote personnelle…' });
  const text = h('textarea', { rows: 18, style: { fontSize: '15px', lineHeight: '1.6' } });
  text.value = localStorage.getItem('studio.lyrics') || '';
  const counter = h('div.small.muted');
  const info = h('p.small.muted');
  const updateCount = () => {
    localStorage.setItem('studio.lyrics', text.value);
    const lines = text.value.split('\n').filter(l => l.trim() && !/^\[.*\]$/.test(l.trim()));
    const avg = lines.length ? Math.round(lines.reduce((s, l) => s + syllables(l), 0) / lines.length) : 0;
    counter.textContent = `${lines.length} lignes · ~${avg} syllabes par ligne en moyenne (pour ${bpm.value} BPM, visez ~${Math.round(bpm.value / 7)}–${Math.round(bpm.value / 5.5)} syllabes par mesure en flow rapide)`;
  };
  text.addEventListener('input', updateCount); updateCount();

  const ask = async (prompt, btn) => {
    btn.disabled = true; const old = btn.textContent; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api('/api/complete', { method: 'POST', body: { src: 'musique', projectId: state.projectId, temperature: 0.9,
        system: 'Tu es un parolier francophone de haut niveau. Tu écris des textes ORIGINAUX (jamais de paroles existantes), avec des rimes riches et multisyllabiques, des assonances, des images concrètes, un flow régulier. Indique les parties entre crochets : [Couplet 1], [Refrain], [Pont]. Pas de commentaire avant ou après le texte, sauf si on te le demande.', prompt } });
      info.textContent = `Écrit via ${r.routedVia}`;
      return r.content.trim();
    } catch (e) { toastErr(e); return null; } finally { btn.disabled = false; btn.textContent = old; }
  };
  const writeBtn = h('button.btn.primary', '✍️ Écrire');
  writeBtn.onclick = async () => {
    if (!theme.value.trim()) return toast('Indiquez un thème.');
    const what = { refrain: 'un refrain accrocheur de 4 à 8 lignes, facile à retenir et à chanter', couplet: 'un couplet de 16 mesures', complet: 'un morceau complet : couplet 1 (16 mesures), refrain (8 lignes), couplet 2 (16 mesures), refrain, pont (4 lignes), refrain', toplines: '3 propositions de refrain différentes, numérotées' }[structure.value];
    const out = await ask(`Écris ${what}.\nStyle : ${style.value}. Ambiance : ${mood.value}. Tempo : ${bpm.value} BPM.\nThème : ${theme.value}\n${extra.value ? 'Précisions : ' + extra.value : ''}`, writeBtn);
    if (out) { text.value = out; updateCount(); }
  };
  const improveBtn = h('button.btn', '🔧 Améliorer');
  improveBtn.onclick = async () => {
    if (!text.value.trim()) return;
    const out = await ask(`Améliore ce texte en gardant son sens et sa structure : rimes plus riches, images plus fortes, flow plus régulier, supprime les clichés.\n\n${text.value}`, improveBtn);
    if (out) { text.value = out; updateCount(); }
  };
  const rhymeBtn = h('button.btn', '🔤 Trouver des rimes');
  rhymeBtn.onclick = async () => {
    const w = await promptBox('Rimes pour quel mot ou quelle fin de phrase ?');
    if (!w) return;
    const out = await ask(`Donne 25 rimes et assonances en français pour « ${w} » (rimes simples, riches, multisyllabiques), classées, puis 5 punchlines qui finissent par ces rimes. Format liste.`, rhymeBtn);
    if (out) modalText('Rimes pour « ' + w + ' »', out);
  };
  const critiqueBtn = h('button.btn', '🧐 Critique');
  critiqueBtn.onclick = async () => {
    if (!text.value.trim()) return;
    const out = await ask(`Fais une critique honnête et précise de ce texte (points forts, lignes faibles avec numéros, rimes pauvres, problèmes de métrique) puis 5 suggestions concrètes. Ici tu peux commenter.\n\n${text.value}`, critiqueBtn);
    if (out) modalText('Critique du texte', out);
  };
  async function modalText(title, content) { const { modal } = await import('../lib/core.js'); modal(title, h('div.md', { html: md(content) })); }

  root.append(h('div.grid.two',
    h('div.card.stack',
      h('h3', '🎤 Paramètres'),
      theme, h('div.row', style, mood), h('div.row', h('div.grow', structure), h('label.f', 'BPM', bpm)), extra,
      h('div.row', writeBtn, improveBtn, rhymeBtn, critiqueBtn), info,
      h('p.tiny.muted', 'Les textes générés sont originaux. L’IA n’imite pas les paroles d’artistes existants.'),
    ),
    h('div.card.stack',
      h('h3', '📝 Texte'),
      text, counter,
      h('div.row',
        h('button.btn.small', { onclick: async () => { const n = await promptBox('Nom du fichier', 'paroles.txt'); if (n) uploadFile(new Blob([text.value], { type: 'text/plain' }), { name: n, source: 'paroles' }).then(() => toast('Enregistré', 'ok')).catch(toastErr); } }, '💾 Enregistrer'),
        h('button.btn.small', { onclick: () => { localStorage.setItem('studio.prompter', text.value); location.hash = '#/enregistrement'; } }, '🎙️ Enregistrer ma voix avec ce texte'),
        h('button.btn.small', { onclick: () => { localStorage.setItem('studio.tts', text.value); document.querySelector('.tabs button:nth-child(3)')?.click(); } }, '🗣️ Faire lire par une voix IA')),
    ),
  ));
}

// ---------------------------------------------------------------- Voix IA
function drawVoice(root) {
  const text = h('textarea', { rows: 8, placeholder: 'Texte à faire dire par une voix de synthèse (intro, voix off, maquette de refrain…)' });
  text.value = localStorage.getItem('studio.tts') || '';
  const voice = h('select', ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map(v => h('option', v)));
  const out = h('div.stack');
  const go = h('button.btn.primary', '🗣️ Générer la voix');
  go.onclick = async () => {
    if (!text.value.trim()) return;
    go.disabled = true; go.innerHTML = '<span class="spinner"></span> Synthèse…';
    try {
      const r = await api('/api/speech', { method: 'POST', body: { input: text.value, voice: voice.value, save: true, projectId: state.projectId } });
      out.prepend(h('div.card.stack', h('div.small', `${r.file.name} — via ${r.provider || '?'}`), h('audio', { controls: true, src: fileUrl(r.file.id) }),
        h('div.row', h('a.btn.small', { href: fileUrl(r.file.id, true) }, '⬇️ Télécharger'), h('a.btn.small', { href: `#/enregistrement?file=${r.file.id}` }, '🎙️ Ouvrir dans Enregistrement'))));
    } catch (e) { toastErr(e); }
    go.disabled = false; go.textContent = '🗣️ Générer la voix';
  };
  root.append(h('div.card.stack',
    h('h3', '🗣️ Voix de synthèse'),
    h('div.notice', 'La voix est produite par un fournisseur de synthèse vocale relié à FreeLLMAPI. Elle PARLE le texte (voix off, maquette, intro) : elle ne chante pas. Les noms de voix disponibles dépendent du fournisseur. Pour un chant, enregistrez votre voix dans « Enregistrement audio » puis nettoyez-la et mixez-la.'),
    text, h('div.row', h('label.f', 'Voix', voice), go), out));
}

// Assistant vocal « mains libres » de l'enregistrement : on parle, il agit.
import { api, h, state, toast, stopSpeaking, parseJsonLoose } from '../lib/core.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'-]/g, ' ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
const NUM = { une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };

// Compréhension locale, instantanée (sans IA en ligne) des demandes courantes.
// Une phrase est découpée en étapes (« enregistre une minute puis nettoie et cale ») ; si une étape
// n'est pas reconnue, on passe la main à l'IA.
function parseClause(c) {
  const n = c.replace(/^(ok|bon|allez|alors|stp|s il te plait|steuplait|vas y|maintenant|aussi|et|puis|apres|ensuite|ensuite tu|tu peux|peux tu|est ce que tu peux|je veux que tu|il faut)( |$)/g, '').trim();
  if (!n) return [];
  if (/^(salut|bonjour|hey|wesh|coucou|yo)\b/.test(n) && n.split(' ').length <= 3) return [{ a: 'hello' }];
  let m;
  if (/(enregistre|enregistrer|lance l enregistrement|on enregistre|record|on y va)/.test(n) && !/(fichier|sauvegard|garde|master)/.test(n)) {
    m = n.match(/(\d+|une|un|deux|trois|quatre|cinq|dix|quinze|vingt|trente|quarante|cinquante|soixante)\s*(minutes?|min|secondes?|sec|s)\b/);
    const k = m ? (Number(m[1]) || NUM[m[1]]) * (/^m/.test(m[2]) ? 60 : 1) : 0;
    return [{ a: 'record', seconds: k }];
  }
  if (/(refais la prise|on refait|refaire la prise|recommence la prise|je la refais)/.test(n)) return [{ a: 'dropLastVoice' }, { a: 'record' }];
  if (/(importe|ajoute|charge).*(instru|beat|prod)/.test(n)) return [{ a: 'importInstru' }];
  if (STOP_RE.test(n)) return [{ a: 'stop' }];
  if (/^pause\b/.test(n)) return [{ a: 'pause' }];
  if (/(annule|reviens en arriere|retour arriere|c etait mieux avant|enleve ca|moins de reverb|moins d echo)/.test(n)) return [{ a: 'undo' }];
  if (/(retablis|remets le)/.test(n)) return [{ a: 'redo' }];
  if (/(original|prise brute|recommence a zero)/.test(n)) return [{ a: 'original' }];
  if (/(ecoute|fais moi ecouter|joue|lance la lecture|relis|que je l entende)/.test(n)) return [{ a: 'play', what: /(master|final|masterise)/.test(n) ? 'master' : /(voix seule|ma voix|juste la voix|sans l instru)/.test(n) ? 'voix' : 'tout' }];
  if (/(fais tout|tout faire|tout en un)/.test(n)) return [{ a: 'all' }];
  if (/(nettoie|nettoyer|nettoyage|enleve le bruit|debruit|bruit de fond|souffle)/.test(n)) return [{ a: 'clean', level: /(fort|beaucoup|bien)/.test(n) ? 0.75 : 0.55 }];
  if (/(cale|caler|calage|aligne|sur le beat|dans le temps|en rythme)/.test(n)) return [{ a: 'align' }];
  if (/(fausse|faux|juste|corrige les notes|corrige mes notes|bonnes notes|justesse)/.test(n)) return [{ a: 'tune', level: 'parfait' }];
  if (/(belle voix|plus belle|voix chantee|chant doux)/.test(n)) return [{ a: 'tune', level: 'belle' }];
  if (/(autotune|auto tune)/.test(n)) return [{ a: 'tune', level: /(fort|robot|t pain|tpain|a fond)/.test(n) ? 'fort' : /(drake|moyen|melodique)/.test(n) ? 'moyen' : /(leger|naturel|discret|un peu)/.test(n) ? 'leger' : 'parfait' }];
  if (/(plus de reverb|ajoute de la reverb|mets de la reverb|reverb)/.test(n)) return [{ a: 'effect', name: 'Réverbe +', chain: [{ t: 'fx', kind: 'reverb', size: 1.6, mix: /(beaucoup|grosse|plein)/.test(n) ? 0.3 : 0.16 }] }];
  if (/(echo|delay)/.test(n)) return [{ a: 'effect', name: 'Écho +', chain: [{ t: 'fx', kind: 'delay', time: 0.3, fb: 0.28, mix: /(beaucoup|gros)/.test(n) ? 0.3 : 0.18 }] }];
  if (/(double|doubler|plus large|plus epais)/.test(n)) return [{ a: 'effect', name: 'Doublage', chain: [{ t: 'double', steps: [0, 0], gain: 0.4 }] }];
  if (/(voix rap|style rap|claire|presente|plus de presence)/.test(n)) return [{ a: 'voice', preset: 'rap' }];
  if ((m = n.match(/coupe (?:de |a partir de )?(\d+(?:[.,]\d+)?) ?(?:s|secondes?)? (?:a|jusqu a) (\d+(?:[.,]\d+)?)/))) return [{ a: 'cut', from: +m[1].replace(',', '.'), to: +m[2].replace(',', '.') }];
  if (/(coupe les blancs|coupe les silences|enleve les silences|coupe le debut et la fin)/.test(n)) return [{ a: 'trim' }];
  if (/(masterise|mastering|mixe|mix et master|finalise)/.test(n)) return [{ a: 'master', preset: /(club|fort|boite)/.test(n) ? 'club' : /(rap|trap|punch)/.test(n) ? 'rap' : /(doux|calme)/.test(n) ? 'doux' : 'streaming' }];
  if (/(versions)/.test(n)) return [{ a: 'versions' }];
  if (/(telecharge)/.test(n)) return [{ a: 'download' }];
  if (/(sauvegarde|garde le|mets le dans mes fichiers|enregistre le dans|dans mes fichiers)/.test(n)) return [{ a: 'save' }];
  if (/(baisse|moins fort).*(instru|beat|prod)/.test(n)) return [{ a: 'volume', track: 'instru', delta: -3 }];
  if (/(monte|plus fort).*(instru|beat|prod)/.test(n)) return [{ a: 'volume', track: 'instru', delta: 3 }];
  if (/(baisse|moins fort).*(voix|micro)/.test(n)) return [{ a: 'volume', track: 'voix', delta: -3 }];
  if (/(monte|plus fort).*(voix|micro)/.test(n)) return [{ a: 'volume', track: 'voix', delta: 3 }];
  return null;
}
function parseLocal(text) {
  const n = norm(text);
  const parts = n.split(/\b(?:puis|ensuite|et apres|apres ca|apres|et puis|et)\b/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) { const r = parseClause(p); if (r === null) return null; out.push(...r); }
  return out.length ? out : null;
}
const ACK = { importInstru: 'Choisis ton instru.', dropLastVoice: '', record: '', stop: '', pause: '', play: '', undo: 'Annulé.', redo: 'Rétabli.', original: 'Retour à la prise brute.', all: 'Je fais tout.', clean: 'Je nettoie.', align: 'Je cale.', tune: 'Je corrige les notes.', effect: 'Ok.', voice: 'Ok.', cut: 'Je coupe.', trim: 'Je coupe les blancs.', master: 'Je masterise.', versions: 'Je prépare les versions.', download: 'Je télécharge.', save: 'Je sauvegarde.', volume: 'Ok.' };
const words = (s) => norm(s).split(' ').filter(Boolean).length;
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const STOP_RE = /^(ok |bon |vas y |c est )?(stop|stoppe|arrete|arrete toi|coupe l enregistrement|c est bon|termine|fini|j ai fini)\b/;

const SYSTEM = `Tu es l'assistant d'un studio d'enregistrement de rap sur téléphone. L'artiste te parle à voix haute (transcription parfois approximative) et tu pilotes le studio à sa place.
Tu réponds UNIQUEMENT avec un objet JSON : {"reponse":"phrase courte et naturelle à dire à voix haute (tutoiement)","actions":[...]}
Actions possibles (exécutées dans l'ordre, sur la piste sélectionnée sauf indication) :
{"a":"record","seconds":N} lancer l'enregistrement ; seconds facultatif = durée voulue (« une piste d'1 minute » → 60), sinon il s'arrête quand il dit stop ; les actions suivantes s'exécutent après la prise
{"a":"stop"} arrêter l'enregistrement ou la lecture
{"a":"play","what":"tout|voix|master"} écouter (tout = toutes les pistes avec volumes réglables en direct) · {"a":"pause"}
{"a":"select","track":N} choisir la piste N (1 = première ; -1 = dernière prise)
{"a":"clean","level":0.3-0.9} débruitage + anti-pop + coupe des blancs
{"a":"align"} caler la voix sur le beat de l'instru
{"a":"voice","preset":"rap|chant|podcast|brut"} ou {"a":"voice","params":{"highpass":40-200,"low":-6..6,"presence":-4..8,"air":-4..8,"deess":0-10,"comp":0-1,"reverb":0-0.5}} traitement de la voix (EQ, compression, réverbe)
{"a":"tune","level":"parfait|leger|moyen|fort|belle"} justesse note par note dans la tonalité de l'instru (parfait = toutes les notes justes en gardant la voix naturelle, moyen = rap mélodique façon Drake, fort = robot T-Pain, belle = voix chantée juste, doublée et douce)
{"a":"effect","name":"court","chain":[...]} effets sur mesure ; briques : {"t":"tune","strength":0-1,"speed":0-200}, {"t":"shift","semi":-12..12,"formant":-4..4}, {"t":"double","steps":[0,0],"gain":0.2-0.8}, {"t":"harmony","steps":[2],"gain":0.2-0.7}, {"t":"fx","kind":"reverb","size":0.3-5,"mix":0-0.6}, {"t":"fx","kind":"delay","time":0.05-0.8,"fb":0-0.6,"mix":0-0.5}, {"t":"fx","kind":"pingpong","time":0.1-0.6,"mix":0-0.5}, {"t":"fx","kind":"chorus","mix":0-0.7}, {"t":"fx","kind":"warm"}, {"t":"fx","kind":"tube","amt":1-3}, {"t":"fx","kind":"exciter","mix":0-0.5}, {"t":"fx","kind":"air","gain":0-6}, {"t":"fx","kind":"peak","f":40-12000,"q":0.4-4,"gain":-8..8}, {"t":"fx","kind":"distort","amt":1-10}, {"t":"fx","kind":"band","lo":100-1000,"hi":2000-10000,"drive":0-8}, {"t":"fx","kind":"lofi","bits":4-10}
{"a":"cut","from":s,"to":s} supprimer un passage (secondes) · {"a":"keep","from":s,"to":s} ne garder que ce passage
{"a":"trim"} couper les silences du début et de la fin · {"a":"fades"} fondus · {"a":"normalize"}
{"a":"undo"} annuler la dernière étape · {"a":"redo"} · {"a":"original"} revenir à la prise brute
{"a":"volume","track":N,"db":-30..12} · {"a":"mute","track":N,"on":true|false} · {"a":"delete","track":N}
{"a":"all"} tout faire (nettoyer, caler, voix rap, mix, master)
{"a":"master","preset":"streaming|rap|club|doux"} mixer et masteriser
{"a":"versions"} préparer plusieurs versions du master · {"a":"save"} enregistrer le master dans ses fichiers · {"a":"download"} télécharger le master
Règles : « chante juste / corrige mes fausses notes / la plus belle voix possible » → tune parfait (ou belle si c'est du chant), jamais deux autotunes l'un sur l'autre (undo d'abord si un autotune est déjà appliqué). « moins de réverbe / c'était mieux avant » → undo. « Plus de réverbe » → effect avec une réverbe légère (mix 0.12-0.2). Un style musical (rap, drill, trap, RnB, mélodique, kickage…) → combine voice + tune/effect adaptés, sans exagérer. N'invente jamais une piste qui n'existe pas : si aucune voix n'est enregistrée, propose d'enregistrer. Si la demande n'est pas une commande (bonjour, question), réponds sans action. Phrase de réponse : 1 phrase, 15 mots max.`;

export function mountAssistant(S) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SERVER_VOICES = ['nova', 'shimmer', 'alloy', 'onyx', 'echo', 'fable'];
  const audioCache = new Map(); let serverBlocked = false;
  let on = false, rec = null, speaking = false, busy = false, afterStop = [], silTimer = null;
  const log = h('div.stack.small', { style: { maxHeight: '180px', overflow: 'auto' } });
  const status = h('span.small.muted', R ? 'Touche « Mains libres » puis parle.' : 'La reconnaissance vocale n’est pas disponible dans ce navigateur : écris tes demandes ci-dessous (Chrome conseillé).');
  const voiceOut = h('input', { type: 'checkbox', checked: localStorage.getItem('studio.ast.voice') !== '0', onchange: (e) => localStorage.setItem('studio.ast.voice', e.target.checked ? '1' : '0') });
  const silSel = h('select', [['0', 'Arrêt auto : non'], ['3', 'Arrêt auto après 3 s de silence'], ['5', 'Arrêt auto après 5 s de silence'], ['8', 'Arrêt auto après 8 s de silence']]
    .map(([v, l]) => h('option', { value: v, selected: (localStorage.getItem('studio.ast.sil') || (IS_ANDROID ? '5' : '0')) === v }, l)));
  silSel.onchange = () => localStorage.setItem('studio.ast.sil', silSel.value);
  const input = h('input', { placeholder: 'Ou écris : « nettoie et cale sur le beat », « plus de réverbe »…' });
  const toggle = h('button.btn.primary', '🎙️ Mains libres');

  const add = (who, text) => {
    log.append(h('div', h('b', who === 'moi' ? '🗣️ ' : '🤖 '), text));
    while (log.children.length > 12) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  };
  // Voix de réponse : on prend la plus naturelle disponible (Google / « Natural » / « Online ») plutôt que la voix robot de Windows
  const voiceSel = h('select', { onchange: () => localStorage.setItem('studio.ast.voiceName', voiceSel.value) });
  const frVoices = () => { try { return (window.speechSynthesis?.getVoices() || []).filter(v => /^fr/i.test(v.lang)); } catch { return []; } };
  const rank = (v) => (/natural|neural/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : /online/i.test(v.name) ? 2 : 5) + (/fr-FR/i.test(v.lang) ? 0 : 0.5);
  function fillVoices() {
    const vs = frVoices().sort((a, b) => rank(a) - rank(b));
    const saved = localStorage.getItem('studio.ast.voiceName');
    voiceSel.innerHTML = '';
    SERVER_VOICES.forEach(v => voiceSel.append(h('option', { value: 'srv:' + v, selected: saved === 'srv:' + v }, `✨ Voix IA ${v[0].toUpperCase() + v.slice(1)} (naturelle)`)));
    vs.forEach(v => voiceSel.append(h('option', { value: v.name, selected: v.name === saved }, `🗣️ ${v.name.replace(/Microsoft |Google /, '')} (navigateur)`)));
    if (!saved || ![...voiceSel.options].some(o => o.value === saved)) voiceSel.value = vs.find(v => /natural|neural/i.test(v.name))?.name || 'srv:nova';
  }
  fillVoices(); try { speechSynthesis.onvoiceschanged = fillVoices; } catch {}
  async function talkServer(text, voice) {
    let url = audioCache.get(voice + '|' + text);
    if (!url) {
      const r = await fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio': '1' }, body: JSON.stringify({ input: text, voice }) });
      if (!r.ok) { if (r.status === 403 && !serverBlocked) { serverBlocked = true; toast('Voix IA bloquée par le mode gratuit : autorise « voix » dans Suivi des tokens → Garde-fous. En attendant, voix du navigateur.', 'bad'); } throw new Error('tts'); }
      url = URL.createObjectURL(await r.blob()); audioCache.set(voice + '|' + text, url);
    }
    await new Promise((resolve) => { const a = new Audio(url); a.onended = resolve; a.onerror = resolve; a.play().catch(resolve); });
  }
  async function talk(text) {
    const v = voiceSel.value;
    if (v.startsWith('srv:') && !serverBlocked) { try { return await talkServer(text, v.slice(4)); } catch {} }
    return talkBrowser(text);
  }
  function talkBrowser(text) {
    return new Promise((resolve) => {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text); u.lang = 'fr-FR'; u.rate = 1.12;
        const v = frVoices().find(x => x.name === voiceSel.value); if (v) u.voice = v;
        u.onend = resolve; u.onerror = resolve; speechSynthesis.speak(u);
      } catch { resolve(); }
    });
  }
  async function say(text) {
    add('ia', text);
    if (!voiceOut.checked || !text) return;
    speaking = true; try { rec?.abort(); } catch {}
    // garde-fou : certaines voix ne signalent jamais la fin
    await Promise.race([talk(text), new Promise(r => setTimeout(r, 1500 + text.length * 80))]);
    speaking = false; listen();
  }

  // ---------- Écoute continue ----------
  function listen() {
    if (!on || !R || speaking || rec) return;
    if (S.isRecording() && IS_ANDROID) { status.textContent = '⏺ J’enregistre… (arrêt : fin de l’instru, silence ou bouton ⏹)'; return; }
    rec = new R(); rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript;
        if (e.results[i].isFinal) { clearTimeout(interimT); if (fired && norm(txt).startsWith(fired)) { const rest = norm(txt).slice(fired.length).replace(/^(et|puis|apres|ensuite)\s+/, '').trim(); fired = null; if (rest) heard(rest); continue; } fired = null; heard(txt); }
        else interim(txt);
      }
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') { status.textContent = 'Micro refusé pour la reconnaissance vocale.'; on = false; toggle.textContent = '🎙️ Mains libres'; } };
    rec.onend = () => { rec = null; if (on && !speaking) setTimeout(listen, 250); };
    try { rec.start(); status.textContent = S.isRecording() ? '⏺ J’enregistre… dis « stop » quand tu as fini.' : '👂 Je t’écoute…'; } catch { rec = null; }
  }
  function stopListening() { try { rec?.abort(); } catch {} rec = null; }
  toggle.onclick = () => {
    on = !on;
    toggle.textContent = on ? '⏸ Couper les mains libres' : '🎙️ Mains libres';
    if (on) { listen(); if (!R) toast('Reconnaissance vocale indisponible : utilise le champ texte.', 'bad'); else say('Je t’écoute. Dis-moi quoi faire.'); }
    else { stopListening(); stopSpeaking(); status.textContent = 'Mains libres coupées.'; }
  };

  // Réactivité : un ordre court reconnu est exécuté dès qu'on le comprend (sans attendre la fin de la phrase)
  let interimT = null, fired = null;
  function interim(txt) {
    if (speaking || fired) return;
    const n = norm(txt); clearTimeout(interimT);
    if (S.isRecording()) { if (words(n) <= 3 && STOP_RE.test(n)) { fired = n; heard(txt); } return; }
    if (words(n) > 6) return;
    const cmd = parseLocal(n);
    if (!cmd || cmd[0]?.a === 'record' && /\b(une|un|deux|trois|\d+)$/.test(n)) return; // « enregistre une… » : on attend la durée
    interimT = setTimeout(() => { fired = n; heard(txt); }, 350);
  }
  function heard(text) {
    if (speaking || !text.trim()) return;
    if (S.isRecording()) {
      // pendant la prise, seules les phrases courtes d'arrêt comptent (pas les paroles du morceau)
      if (words(text) <= 4 && STOP_RE.test(norm(text))) { add('moi', text); run([{ a: 'stop' }], 'C’est dans la boîte.'); }
      return;
    }
    handle(text);
  }

  // ---------- Propositions : l'assistant propose la suite sans attendre ----------
  const sugg = h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } });
  function proposals(last) {
    const st = S.snapshot(), voices = st.pistes.filter(p => p.type === 'voix');
    const P = [];
    if (!voices.length) { P.push(['🎙️ Enregistre', 'enregistre']); if (!st.instru_presente) P.push(['📥 Importer mon instru', 'importe l instru']); P.push(['⏱️ Enregistre 1 minute', 'enregistre une minute']); return P; }
    if (last === 'master' || last === 'versions') return [['▶ Écoute le master', 'écoute le master'], ['💾 Sauvegarde', 'sauvegarde'], ['⬇️ Télécharge', 'télécharge'], ['🎧 Plusieurs versions', 'versions'], ['↩ Annule', 'annule']];
    if (last === 'record' || last === 'stop') { P.push(['🧹 Nettoie', 'nettoie']); if (st.instru_presente) P.push(['🎯 Cale sur le beat', 'cale']); P.push(['🎤 Corrige mes notes', 'corrige mes fausses notes'], ['▶ Écoute', 'écoute'], ['🔁 Refais la prise', 'refais la prise']); }
    else { P.push(['▶ Écoute', 'écoute'], ['↩ Annule', 'annule']); const done = voices.flatMap(v => v.effets_appliques).join(' ') + ' ' + voices.flatMap(v => v.etapes_annulables).join(' ');
      if (!/Nettoyage|Tout faire/.test(done)) P.push(['🧹 Nettoie', 'nettoie']);
      if (!/Justesse|Autotune|tune/i.test(done)) P.push(['🎤 Corrige mes notes', 'corrige mes fausses notes'], ['✨ Belle voix', 'belle voix']);
      P.push(['🌫️ Un peu de réverbe', 'plus de reverb'], ['🔁 Un peu d’écho', 'plus d echo'], ['🎛️ Masterise', 'masterise']); }
    if (!st.instru_presente) P.push(['📥 Importer mon instru', 'importe l instru']);
    return P.slice(0, 7);
  }
  function showProposals(last) {
    const P = proposals(last); sugg.innerHTML = '';
    P.forEach(([label, cmd]) => sugg.append(h('button.btn.small', { onclick: () => handle(cmd) }, label)));
    return P;
  }
  const spokenNext = (P) => P.length >= 2 ? ` Je peux ${P[0][0].replace(/^\S+ /, '').toLowerCase()}, ou ${P[1][0].replace(/^\S+ /, '').toLowerCase()}.` : '';

  // ---------- Compréhension ----------
  const queue = [];
  async function handle(text) {
    add('moi', text);
    const local = parseLocal(text);
    if (local) {
      if (local[0]?.a === 'hello') return say('Salut ! Dis-moi : enregistre, nettoie, corrige les notes, masterise…');
      // stop / pause / écoute passent tout de suite, même pendant un traitement
      if (busy && local.every(x => ['stop', 'pause', 'play'].includes(x.a))) return exec(local, true);
      if (busy) { queue.push(local); return say('Ok, juste après.'); }
      const ack = local.length > 1 ? 'Ok, c’est parti.' : ACK[local[0].a];
      return run(local, ack);
    }
    if (busy) { queue.push(text); return say('Ok, juste après.'); }
    busy = true; status.innerHTML = '<span class="spinner"></span> Je réfléchis…';
    try {
      const r = await api('/api/complete', { method: 'POST', body: { src: 'musique', projectId: state.projectId, temperature: 0.3, json: true, max_tokens: 400, system: SYSTEM,
        prompt: `État du studio : ${JSON.stringify(S.snapshot())}\nL'artiste dit : « ${text} »` } });
      const j = parseJsonLoose(r.content);
      if (!j) throw new Error('réponse illisible');
      busy = false;
      await run(Array.isArray(j.actions) ? j.actions.slice(0, 8) : [], j.reponse);
    } catch (e) { busy = false; status.textContent = on ? '👂 Je t’écoute…' : ''; await say(/quota|429|limite|attendre/i.test(e?.message || '') ? 'Les IA gratuites sont saturées, réessaie dans une minute.' : 'Je n’ai pas compris, redis-le plus simplement.'); }
    drain();
  }
  function drain() {
    if (busy || !queue.length) return;
    const next = queue.shift();
    if (typeof next === 'string') { log.lastChild?.remove(); handle(next); } else run(next, '');
  }

  // ---------- Exécution ----------
  async function run(actions, reply) {
    const i = actions.findIndex(x => x?.a === 'record');
    if (i >= 0) {
      afterStop = actions.slice(i + 1);
      const before = actions.slice(0, i);
      if (before.length) await exec(before);
      const sec = Number(actions[i].seconds) || 0;
      await say(reply && reply.length > 2 ? reply : sec ? `J’enregistre ${sec >= 60 && sec % 60 === 0 ? sec / 60 + ' minute' + (sec > 60 ? 's' : '') : sec + ' secondes'}. Vas-y.` : 'J’enregistre, dis stop quand tu as fini.');
      stopListening();
      await S.record({ autoStopSilence: Number(silSel.value), seconds: Number(actions[i].seconds) || 0 });
      listen();
      return;
    }
    if (reply) say(reply);
    await exec(actions);
    const last = [...actions].reverse().find(x => x?.a)?.a;
    const P = showProposals(last);
    if (actions.some(x => !['stop', 'pause', 'play', 'undo', 'redo', 'volume', 'importInstru'].includes(x.a))) say('C’est fait.' + spokenNext(P));
  }
  async function exec(actions, side = false) {
    if (!side) busy = true;
    for (const x of actions) {
      if (!x?.a || !S.do[x.a]) continue;
      status.innerHTML = `<span class="spinner"></span> ${LABELS[x.a] || x.a}…`;
      try { await S.do[x.a](x); }
      catch (e) { if (!side) busy = false; status.textContent = ''; await say(`Problème : ${e.message || e}`.slice(0, 140)); drain(); return; }
    }
    if (side) return;
    busy = false;
    status.textContent = on ? '👂 Je t’écoute…' : '✓ Fait';
    drain();
  }
  // appelé par le studio quand une prise se termine (bouton, « stop », silence ou fin de l'instru)
  async function onRecordStopped() {
    const next = afterStop; afterStop = [];
    if (next.length) { say('Prise terminée, je m’en occupe.'); await exec(next); const P = showProposals(next[next.length - 1]?.a); await say('C’est prêt.' + spokenNext(P)); }
    else { const P = showProposals('record'); if (on) await say('Prise enregistrée.' + spokenNext(P)); }
    listen();
  }

  input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) { const t = input.value; input.value = ''; handle(t); } };
  const card = h('div.card.stack',
    h('div.row', h('h3.grow', '🤖 Assistant vocal'), toggle),
    status,
    h('div.row', h('div.grow', input), h('button.btn.small', { onclick: () => { if (input.value.trim()) { const t = input.value; input.value = ''; handle(t); } } }, 'Envoyer')),
    S.mixer || '',
    h('div.row', h('label.chk.small', voiceOut, 'Réponses à voix haute'), h('div.grow', voiceSel), h('div.grow', silSel)),
    sugg,
    log,
    h('p.tiny.muted', `Exemples : « enregistre » … « stop » · « nettoie et cale sur le beat » · « style rap mélodique » · « un peu plus de réverbe » · « annule » · « coupe de 0 à 3 secondes » · « masterise pour Spotify » · « enregistre-le dans mes fichiers ». ${IS_ANDROID ? 'Sur Android, pendant la prise le micro sert à l’enregistrement : elle s’arrête à la fin de l’instru, après le silence choisi, ou avec le bouton ⏹.' : 'Pendant la prise, dis simplement « stop ».'} Casque conseillé.`));
  setTimeout(() => showProposals(), 0);
  return { card, refresh: () => showProposals(), onRecordStopped, onRecordStarted: () => { if (IS_ANDROID) stopListening(); else listen(); }, destroy: () => { on = false; stopListening(); stopSpeaking(); clearTimeout(silTimer); } };
}

const LABELS = { stop: 'Arrêt', play: 'Lecture', clean: 'Nettoyage', align: 'Calage sur le beat', voice: 'Traitement voix', tune: 'Autotune', effect: 'Effet', cut: 'Coupe', keep: 'Rognage', trim: 'Coupe des silences', fades: 'Fondus', normalize: 'Normalisation', undo: 'Annulation', redo: 'Rétablissement', original: 'Retour à l’original', volume: 'Volume', mute: 'Muet', delete: 'Suppression', all: 'Tout faire', master: 'Mix et master', versions: 'Versions du master', save: 'Enregistrement', download: 'Téléchargement', select: 'Sélection' };

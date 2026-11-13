// Assistant vocal « mains libres » de l'enregistrement : on parle, il agit.
import { api, h, state, toast, speak, stopSpeaking, parseJsonLoose } from '../lib/core.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean).length;
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const STOP_RE = /^(ok |bon |vas y |c est )?(stop|stoppe|arrete|arrete toi|coupe l enregistrement|c est bon|termine|fini|j ai fini)\b/;

const SYSTEM = `Tu es l'assistant d'un studio d'enregistrement de rap sur téléphone. L'artiste te parle à voix haute (transcription parfois approximative) et tu pilotes le studio à sa place.
Tu réponds UNIQUEMENT avec un objet JSON : {"reponse":"phrase courte et naturelle à dire à voix haute (tutoiement)","actions":[...]}
Actions possibles (exécutées dans l'ordre, sur la piste sélectionnée sauf indication) :
{"a":"record","seconds":N} lancer l'enregistrement ; seconds facultatif = durée voulue (« une piste d'1 minute » → 60), sinon il s'arrête quand il dit stop ; les actions suivantes s'exécutent après la prise
{"a":"stop"} arrêter l'enregistrement ou la lecture
{"a":"play","what":"piste|master"} écouter · {"a":"pause"}
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
  async function say(text) {
    add('ia', text);
    if (!voiceOut.checked) return;
    speaking = true; try { rec?.abort(); } catch {}
    // garde-fou : certaines voix du téléphone ne signalent jamais la fin
    await Promise.race([speak(text, { preferBrowser: true }), new Promise(r => setTimeout(r, 2500 + text.length * 90))]);
    speaking = false; listen();
  }

  // ---------- Écoute continue ----------
  function listen() {
    if (!on || !R || speaking || rec) return;
    if (S.isRecording() && IS_ANDROID) { status.textContent = '⏺ J’enregistre… (arrêt : fin de l’instru, silence ou bouton ⏹)'; return; }
    rec = new R(); rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heard(e.results[i][0].transcript);
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

  function heard(text) {
    if (speaking || !text.trim()) return;
    if (S.isRecording()) {
      // pendant la prise, seules les phrases courtes d'arrêt comptent (pas les paroles du morceau)
      if (words(text) <= 4 && STOP_RE.test(norm(text))) { add('moi', text); run([{ a: 'stop' }], 'C’est dans la boîte.'); }
      return;
    }
    handle(text);
  }

  // ---------- Compréhension ----------
  function quick(t) {
    const n = norm(t), w = words(t);
    if (w <= 5 && /^(ok |bon |allez )?(vas y )?(enregistre|on enregistre|lance l enregistrement|go enregistre|record)\b/.test(n) && !/(puis|et |ensuite|apres)/.test(n)) return [{ a: 'record' }];
    if (w <= 4 && STOP_RE.test(n)) return [{ a: 'stop' }];
    if (w <= 4 && /^(annule|reviens en arriere|retour arriere|annuler)\b/.test(n)) return [{ a: 'undo' }];
    if (w <= 4 && /^(retablis|refais)\b/.test(n)) return [{ a: 'redo' }];
    if (w <= 5 && /^(ecoute|fais moi ecouter|joue|lis la piste|relis)\b/.test(n) && !/master|morceau|final/.test(n)) return [{ a: 'play', what: 'piste' }];
    if (w <= 3 && /^pause\b/.test(n)) return [{ a: 'pause' }];
    return null;
  }
  async function handle(text) {
    add('moi', text);
    const q = quick(text);
    if (q) return run(q);
    if (busy) return say('Attends, je termine ce que je fais.');
    busy = true; status.innerHTML = '<span class="spinner"></span> Je réfléchis…';
    try {
      const r = await api('/api/complete', { method: 'POST', body: { src: 'musique', projectId: state.projectId, temperature: 0.3, json: true, system: SYSTEM,
        prompt: `État du studio : ${JSON.stringify(S.snapshot())}\nL'artiste dit : « ${text} »` } });
      const j = parseJsonLoose(r.content);
      if (!j) throw new Error('réponse illisible');
      busy = false;
      await run(Array.isArray(j.actions) ? j.actions.slice(0, 8) : [], j.reponse);
    } catch (e) { busy = false; status.textContent = on ? '👂 Je t’écoute…' : ''; await say(/quota|429|limite|attendre/i.test(e?.message || '') ? 'Les IA gratuites sont saturées, réessaie dans une minute.' : 'Je n’ai pas réussi à comprendre, tu peux répéter autrement ?'); }
  }

  // ---------- Exécution ----------
  async function run(actions, reply) {
    const i = actions.findIndex(x => x?.a === 'record');
    if (i >= 0) {
      afterStop = actions.slice(i + 1);
      const before = actions.slice(0, i);
      if (before.length) await exec(before);
      if (reply) await say(reply); else await say('J’enregistre. Dis stop quand tu as fini.');
      stopListening();
      await S.record({ autoStopSilence: Number(silSel.value), seconds: Number(actions[i].seconds) || 0 });
      listen();
      return;
    }
    if (reply) say(reply);
    await exec(actions);
  }
  async function exec(actions) {
    busy = true;
    for (const x of actions) {
      if (!x?.a || !S.do[x.a]) continue;
      status.innerHTML = `<span class="spinner"></span> ${LABELS[x.a] || x.a}…`;
      try { await S.do[x.a](x); }
      catch (e) { busy = false; status.textContent = ''; await say(`Problème : ${e.message || e}`.slice(0, 140)); return; }
    }
    busy = false;
    status.textContent = on ? '👂 Je t’écoute…' : '✓ Fait';
  }
  // appelé par le studio quand une prise se termine (bouton, « stop », silence ou fin de l'instru)
  async function onRecordStopped() {
    const next = afterStop; afterStop = [];
    if (next.length) { await say('Prise terminée, je m’en occupe.'); await exec(next); await say('C’est prêt, écoute.'); }
    else if (on) await say('Prise enregistrée. Je nettoie, je cale, ou on refait ?');
    listen();
  }

  input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) { const t = input.value; input.value = ''; handle(t); } };
  const card = h('div.card.stack',
    h('div.row', h('h3.grow', '🤖 Assistant vocal'), toggle),
    status,
    h('div.row', h('div.grow', input), h('button.btn.small', { onclick: () => { if (input.value.trim()) { const t = input.value; input.value = ''; handle(t); } } }, 'Envoyer')),
    h('div.row', h('label.chk.small', voiceOut, 'Réponses à voix haute'), h('div.grow', silSel)),
    log,
    h('p.tiny.muted', `Exemples : « enregistre » … « stop » · « nettoie et cale sur le beat » · « style rap mélodique » · « un peu plus de réverbe » · « annule » · « coupe de 0 à 3 secondes » · « masterise pour Spotify » · « enregistre-le dans mes fichiers ». ${IS_ANDROID ? 'Sur Android, pendant la prise le micro sert à l’enregistrement : elle s’arrête à la fin de l’instru, après le silence choisi, ou avec le bouton ⏹.' : 'Pendant la prise, dis simplement « stop ».'} Casque conseillé.`));
  return { card, onRecordStopped, onRecordStarted: () => { if (IS_ANDROID) stopListening(); else listen(); }, destroy: () => { on = false; stopListening(); stopSpeaking(); clearTimeout(silTimer); } };
}

const LABELS = { stop: 'Arrêt', play: 'Lecture', clean: 'Nettoyage', align: 'Calage sur le beat', voice: 'Traitement voix', tune: 'Autotune', effect: 'Effet', cut: 'Coupe', keep: 'Rognage', trim: 'Coupe des silences', fades: 'Fondus', normalize: 'Normalisation', undo: 'Annulation', redo: 'Rétablissement', original: 'Retour à l’original', volume: 'Volume', mute: 'Muet', delete: 'Suppression', all: 'Tout faire', master: 'Mix et master', versions: 'Versions du master', save: 'Enregistrement', download: 'Téléchargement', select: 'Sélection' };

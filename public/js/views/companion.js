import { api, sse, h, state, speak, stopSpeaking, toast, toastErr } from '../lib/core.js';

const STYLE = `
.companion{display:grid;grid-template-columns:minmax(280px,.92fr) minmax(320px,1.08fr);gap:16px;min-height:calc(100dvh - 150px);color:var(--text)}
.companion-panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px;min-width:0}
.companion-stage{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:470px;overflow:hidden;background:radial-gradient(ellipse at 50% 34%,rgba(222,170,166,.22),transparent 48%),linear-gradient(145deg,#171a25,#0b0d15 72%);border:1px solid rgba(226,190,185,.2);border-radius:18px}
.companion-glow{position:absolute;width:280px;height:280px;border-radius:50%;background:rgba(197,147,154,.13);filter:blur(45px)}
.companion-portrait{position:relative;width:min(68%,310px);aspect-ratio:.78;border-radius:48% 48% 34% 34%;background:linear-gradient(155deg,#d6a89e 0%,#9b6b68 42%,#302a35 43%,#171923 100%);box-shadow:0 22px 70px #0009,inset 0 0 35px #fff2;overflow:hidden;animation:comp-breathe 5s ease-in-out infinite}
.companion-portrait:before{content:'';position:absolute;left:16%;right:16%;top:13%;height:57%;border-radius:48% 48% 44% 44%;background:radial-gradient(ellipse at 50% 20%,#f2d4c8,#c58e82 70%,#986b69);box-shadow:0 8px 18px #0004}
.companion-hair{position:absolute;z-index:2;left:12%;right:12%;top:7%;height:42%;border-radius:52% 52% 22% 22%;background:linear-gradient(100deg,#17131b,#49323a 50%,#17131b);clip-path:polygon(0 0,100% 0,100% 100%,82% 74%,76% 28%,50% 20%,24% 28%,18% 74%,0 100%)}
.companion-eyes{position:absolute;z-index:3;left:29%;right:29%;top:38%;display:flex;justify-content:space-between}
.companion-eye{width:18px;height:8px;border-radius:50%;background:#35232a;box-shadow:0 0 0 3px #f0c9bc}
.companion-nose{position:absolute;z-index:3;top:43%;left:49%;width:8px;height:29px;border-right:2px solid #9c625f;border-bottom:2px solid #9c625f;transform:skew(-8deg);opacity:.65}
.companion-mouth{position:absolute;z-index:3;top:59%;left:43%;width:14%;height:5px;border-radius:50%;background:#8e4f58;transition:height .12s}
.companion-portrait.talking .companion-mouth{height:14px;border-radius:45%}
.companion-status{position:relative;z-index:4;margin-top:18px;color:#f2e8e8;font-size:13px}
.companion-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;justify-content:center}
.companion-messages{height:calc(100% - 135px);min-height:280px;max-height:56dvh;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:4px}
.companion-msg{padding:11px 13px;border-radius:14px;max-width:92%;white-space:pre-wrap;line-height:1.45;background:var(--panel2)}
.companion-msg.user{align-self:flex-end;background:var(--accent);color:white}
.companion-compose{display:flex;gap:8px;margin-top:12px}
.companion-compose input{flex:1;min-width:0}
.companion-note{font-size:12px;color:var(--muted);line-height:1.5}
.companion-camera{width:100%;max-height:160px;object-fit:cover;border-radius:12px;background:#080a10;margin-top:10px}
@keyframes comp-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.008)}}
@media(max-width:850px){.companion{grid-template-columns:1fr}.companion-stage{min-height:380px}.companion-messages{max-height:42dvh}}
`;

export async function render(el) {
  if (!document.getElementById('companion-style')) {
    const st = h('style', { id:'companion-style' }, STYLE); document.head.append(st);
  }
  let cameraStream = null, faceTask = null, raf = 0, recognition = null, listening = false, busy = false;
  const history = [];
  const root = h('div.companion');
  const left = h('section.companion-panel');
  const right = h('section.companion-panel');
  const stage = h('div.companion-stage',
    h('div.companion-glow'),
    h('div.companion-portrait#companion-face',
      h('div.companion-hair'),h('div.companion-eyes',h('i.companion-eye'),h('i.companion-eye')),h('i.companion-nose'),h('i.companion-mouth')),
    h('div.companion-status#companion-status','Présente · en attente de ton message'));
  const camera = h('video.companion-camera', { autoplay:true, muted:true, playsInline:true, style:{display:'none'} });
  const camStatus = h('p.companion-note#companion-cam-status','Caméra désactivée. Aucune image n’est analysée.');
  const camBtn = h('button.btn', { onclick: toggleCamera }, 'Activer ma caméra');
  const micBtn = h('button.btn.primary', { onclick: toggleListening }, '🎙️ Parler avec elle');
  const stopBtn = h('button.btn.ghost', { onclick: () => { stopSpeaking(); stage.querySelector('.companion-portrait').classList.remove('talking'); } }, 'Couper la voix');
  left.append(h('h2','Ta compagne IA'),h('p.companion-note','Une présence qui discute avec toi et apprend de ce que tu choisis de lui raconter.'),stage,h('div.companion-actions',micBtn,stopBtn,camBtn),camera,camStatus,
    h('p.companion-note','La caméra reste éteinte tant que tu ne l’actives pas. Quand elle est active, l’analyse du visage est faite sur ton appareil ; aucune photo ni vidéo n’est envoyée au serveur.'));
  const messages = h('div.companion-messages');
  const input = h('input', { placeholder:'Écris-lui quelque chose…', type:'text' });
  const send = h('button.btn.primary', { onclick: () => sendText() }, 'Envoyer');
  right.append(h('h2','Conversation'),h('p.companion-note','Elle utilise le moteur conversationnel existant de Studio IA et le modèle gratuit automatique.'),messages,h('div.companion-compose',input,send));
  root.append(left,right); el.append(root);
  const status = (s) => { const n=stage.querySelector('#companion-status'); if(n)n.textContent=s; };
  const addMessage = (role,text) => { const b=h('div.companion-msg'+(role==='user'?' user':''),text); messages.append(b); messages.scrollTop=messages.scrollHeight; };
  async function answer(text) {
    if (!text.trim() || busy) return;
    busy=true; addMessage('user',text); history.push({role:'user',content:text});
    const bubble=h('div.companion-msg'); messages.append(bubble); status('Elle réfléchit…');
    const system = {role:'system',content:'Tu es une compagne IA féminine, chaleureuse, naturelle, attentive et respectueuse. Tu tutoies. Tu peux être drôle et affectueuse sans prétendre être humaine. Tu ne diagnostiques jamais les émotions à partir du visage. Tu demandes confirmation si tu remarques un signe possible de fatigue ou de tristesse. Tu connais uniquement les informations données dans cette conversation. Réponds en français.'};
    let result='';
    try {
      await sse('/api/chat',{projectId:state.projectId,model:'auto',messages:[system,...history.slice(-20)]},ev=>{
        if(ev.type==='delta'&&ev.content){result+=ev.content;bubble.textContent=result;messages.scrollTop=messages.scrollHeight;}
        if(ev.type==='error') throw new Error(ev.error);
      });
      if(!result.trim()) result='Je suis là. Tu peux me dire ce que tu as en tête.';
      history.push({role:'assistant',content:result});
      status('Je t’écoute.');
      const face=stage.querySelector('.companion-portrait'); face.classList.add('talking');
      await speak(result,{preferBrowser:true}); face.classList.remove('talking');
    } catch(e){bubble.textContent='Je n’ai pas réussi à répondre : '+e.message;status('Connexion interrompue');}
    busy=false;
  }
  function sendText(){const t=input.value.trim();if(!t)return;input.value='';answer(t);}
  input.addEventListener('keydown',e=>{if(e.key==='Enter')sendText();});
  async function toggleCamera(){
    if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;camera.srcObject=null;camera.style.display='none';camBtn.textContent='Activer ma caméra';camStatus.textContent='Caméra désactivée. Aucune image n’est analysée.';status('Présente · caméra coupée');cancelAnimationFrame(raf);faceTask?.close?.();faceTask=null;return;}
    try{
      cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
      camera.srcObject=cameraStream;camera.style.display='block';await camera.play();camBtn.textContent='Désactiver la caméra';
      camStatus.textContent='Caméra active. Initialisation de l’analyse locale…';
      const vision=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm');
      const files=await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
      faceTask=await vision.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true});
      const tick=()=>{
        if(!cameraStream||!faceTask)return;
        if(camera.readyState>=2){
          const r=faceTask.detectForVideo(camera,performance.now());
          const cats=r.faceBlendshapes?.[0]?.categories||[];
          const score=n=>cats.find(x=>x.categoryName===n)?.score||0;
          const present=!!r.faceLandmarks?.length;
          if(present){
            const smile=Math.max(score('mouthSmileLeft'),score('mouthSmileRight'));
            const brow=score('browDownLeft')+score('browDownRight');
            const label=smile>.35?'Je vois un sourire 🙂':brow>.65?'Tu sembles concentré·e.': 'Je te vois. Je reste attentive.';
            camStatus.textContent=label+' (indice visuel, pas une lecture certaine de ton humeur).';
          } else camStatus.textContent='Je ne vois pas de visage dans le cadre.';
        }
        raf=requestAnimationFrame(tick);
      };tick();status('Je peux te voir · analyse locale activée');
    }catch(e){cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;camera.style.display='none';camStatus.textContent='Caméra ou modèle indisponible : '+e.message;toast('Impossible d’activer la caméra : '+e.message,'bad');}
  }
  async function toggleListening(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(listening){recognition?.stop();listening=false;micBtn.textContent='🎙️ Parler avec elle';return;}
    if(!SR){toast('La reconnaissance vocale n’est pas disponible dans ce navigateur. Utilise le champ de texte.','bad');return;}
    recognition=new SR();recognition.lang='fr-FR';recognition.interimResults=true;recognition.continuous=false;
    recognition.onresult=e=>{let final='';for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript;}if(final.trim())answer(final.trim());};
    recognition.onerror=e=>{listening=false;micBtn.textContent='🎙️ Parler avec elle';toast('Micro : '+e.error,'bad');};
    recognition.onend=()=>{listening=false;micBtn.textContent='🎙️ Parler avec elle';};
    try{recognition.start();listening=true;micBtn.textContent='⏹ Arrêter l’écoute';status('Je t’écoute…');}catch(e){toastErr(e);}
  }
  return ()=>{recognition?.stop();stopSpeaking();cameraStream?.getTracks().forEach(t=>t.stop());cancelAnimationFrame(raf);faceTask?.close?.();};
}

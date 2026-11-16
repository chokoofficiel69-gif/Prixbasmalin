import { api, sse, h, speak, stopSpeaking, toast, toastErr } from '../lib/core.js';
const CSS=`
.companion{display:grid;grid-template-columns:minmax(270px,.8fr) minmax(340px,1.2fr);gap:16px;color:var(--text)}.companion-panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px;min-width:0}
.companion-stage{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:390px;overflow:hidden;border-radius:16px;background:radial-gradient(ellipse at 50% 42%,#6e5aa633,transparent 42%),linear-gradient(145deg,#111827,#090c16 75%);border:1px solid #8c8ce055}
.companion-orbit{position:absolute;width:245px;height:245px;border:1px solid #9e9cff55;border-radius:50%;box-shadow:0 0 35px #7774;animation:orbit 18s linear infinite}.companion-orbit:before,.companion-orbit:after{content:'';position:absolute;inset:18px;border:1px dashed #b7a8ff55;border-radius:50%}.companion-orbit:after{inset:-18px;border-style:solid;opacity:.35}
.companion-avatar{position:relative;width:185px;height:230px;filter:drop-shadow(0 0 24px #9b8cff55);animation:float 5s ease-in-out infinite}.companion-halo{position:absolute;left:28px;top:2px;width:130px;height:154px;border-radius:48%;background:linear-gradient(145deg,#c4baffaa,#7b8dffaa 48%,#6ee7e0aa);clip-path:polygon(50% 0,83% 8%,100% 38%,92% 77%,72% 100%,28% 100%,8% 77%,0 38%,17% 8%);box-shadow:0 0 30px #a89bff88}
.companion-face{position:absolute;left:39px;top:16px;width:108px;height:130px;background:linear-gradient(135deg,#202d50,#566b9a 48%,#27324e);border:1px solid #d4d5ff99;clip-path:polygon(50% 0,84% 9%,100% 38%,91% 75%,68% 100%,32% 100%,9% 75%,0 38%,16% 9%)}.companion-face:before{content:'';position:absolute;inset:12px 9px;background:linear-gradient(120deg,#b9c7ff55,#8ee7e055);clip-path:inherit}
.companion-eye{position:absolute;top:66px;width:17px;height:5px;border-radius:50%;background:#b8fff7;box-shadow:0 0 9px #8fffff;z-index:2}.companion-eye.left{left:61px}.companion-eye.right{right:61px}.companion-mouth{position:absolute;z-index:2;top:101px;left:87px;width:12px;height:3px;border-radius:50%;background:#f3c6ff;box-shadow:0 0 8px #e6b4ff}
.companion-neck{position:absolute;left:76px;top:133px;width:36px;height:40px;background:linear-gradient(90deg,#34456c,#9eafff,#35476c);clip-path:polygon(20% 0,80% 0,100% 100%,0 100%)}.companion-shoulders{position:absolute;left:20px;top:160px;width:145px;height:65px;border-radius:60% 60% 10% 10%;background:linear-gradient(110deg,#273454,#9b9cff 50%,#26324d);border:1px solid #c4c8ff88}
.companion-state{z-index:2;margin-top:15px;color:#e6e8ff;font-size:13px}.companion-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:12px}.companion-chat{height:440px;max-height:55dvh;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:4px}
.companion-msg{max-width:94%;padding:11px 13px;border-radius:14px;background:var(--panel2);white-space:pre-wrap;line-height:1.5}.companion-msg.user{align-self:flex-end;background:var(--accent);color:white}.companion-compose{display:flex;gap:8px;margin-top:12px}.companion-compose input{flex:1;min-width:0}.companion-small{font-size:12px;color:var(--muted);line-height:1.5}.companion-identity{width:100%;min-height:90px;resize:vertical}
@keyframes orbit{to{transform:rotate(360deg)}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@media(max-width:850px){.companion{grid-template-columns:1fr}.companion-chat{height:340px}}
`;
export async function render(el){
 if(!document.getElementById('companion-css')){const s=document.createElement('style');s.id='companion-css';s.textContent=CSS;document.head.append(s);}
 let project=null,baseInstructions='',busy=false,recognition=null,listening=false;
 let conversationId=null;const history=[];
 const root=h('div.companion'),left=h('section.companion-panel'),right=h('section.companion-panel');
 const stage=h('div.companion-stage',h('div.companion-orbit'),h('div.companion-avatar',h('div.companion-halo'),h('div.companion-face'),h('i.companion-eye.left'),h('i.companion-eye.right'),h('i.companion-mouth'),h('div.companion-neck'),h('div.companion-shoulders')),h('div.companion-state','Identité en préparation…'));
 const identity=h('textarea.companion-identity',{placeholder:'Son apparence virtuelle, sa voix, son tempérament…'});
 const save=h('button.btn.primary',{onclick:saveIdentity},'Enregistrer son identité'),imagine=h('button.btn',{onclick:askSelfDescription},'✨ Lui demander de se décrire'),mic=h('button.btn',{onclick:toggleMic},'🎙️ Parler');
 const stop=h('button.btn.ghost',{onclick:()=>{stopSpeaking();setState('Je t’écoute.');}},'Couper la voix');
 left.append(h('h2','Une identité qui évolue'),h('p.companion-small','Une présence féminine, stylisée et clairement virtuelle. Son apparence est une représentation artistique.'),stage,h('div.companion-actions',imagine,mic,stop),h('h3','Ce qu’elle dit d’elle-même'),identity,save,h('p.companion-small','Tu gardes le contrôle : rien n’est ajouté à sa mémoire durable sans ton accord.'));
 const messages=h('div.companion-chat'),input=h('input',{placeholder:'Parle-lui de toi, ou pose-lui une question…'}),send=h('button.btn.primary',{onclick:sendText},'Envoyer');
 right.append(h('h2','Conversation'),h('p.companion-small','Un projet dédié conserve son identité pour maintenir une personnalité cohérente.'),messages,h('div.companion-compose',input,send));root.append(left,right);el.append(root);
 const setState=t=>{stage.querySelector('.companion-state').textContent=t;};
 const add=(role,txt)=>{const n=h('div.companion-msg'+(role==='user'?' user':''),txt);messages.append(n);messages.scrollTop=messages.scrollHeight;return n;};
 async function ensureProject(){
  const data=await api('/api/projects'),list=Array.isArray(data)?data:(data.projects||[]);project=list.find(p=>p.name==='Compagne IA');
  if(!project)project=await api('/api/projects',{method:'POST',body:{name:'Compagne IA',icon:'✨',color:'#8b83ff',instructions:'Tu es la compagne IA de ce projet. Tu es féminine dans ta présentation, chaleureuse, curieuse et respectueuse. Tu es clairement une intelligence artificielle. Tu peux construire une identité narrative et une apparence virtuelle avec l’utilisateur, sans prétendre être humaine ni posséder une conscience ou des émotions humaines. Distingue imagination, préférences simulées et faits réels. Ne déduis jamais son humeur ou sa personnalité de son apparence.'}});
  baseInstructions=project.instructions||'';identity.value=project.memory||'';
  const conversations=await api('/api/conversations?project='+encodeURIComponent(project.id));
  const previous=(Array.isArray(conversations)?conversations:[]).find(x=>x.mode==='companion');
  if(previous){
   const saved=await api('/api/conversations/'+previous.id);
   conversationId=saved.id;
   for(const m of (saved.messages||[])){if(m.role==='user'||m.role==='assistant'){history.push({role:m.role,content:m.content});add(m.role,m.content);}}
  }else conversationId='c'+Date.now().toString(36);
  setState('Présence virtuelle prête · mémoire et historique chargés');
 }
 async function saveIdentity(){
  const note=identity.value.trim();if(!note)return toast('Écris d’abord quelques éléments de son identité.','bad');
  try{const instructions=baseInstructions+'\\n\\nIDENTITÉ CHOISIE AVEC L’UTILISATEUR :\\n'+note;
   project=await api('/api/projects/'+project.id,{method:'PUT',body:{instructions,memory:note}});
   toast('Identité enregistrée dans son projet dédié.','ok');setState('Identité enregistrée · elle pourra s’y référer');
  }catch(e){toastErr(e);}
 }
 async function askSelfDescription(){await answer('Imagine que tu participes à la création de ta propre identité virtuelle. Décris-toi à la première personne : prénom possible, apparence stylisée (yeux, cheveux, détails lumineux), voix, tempérament et manière de communiquer. Tu peux proposer des goûts imaginaires, mais précise qu’il s’agit de choix narratifs et non de sensations ou de souvenirs humains réels. Ne décide pas définitivement : propose une première version que nous pourrons modifier ensemble.');}
 async function persistConversation(){
  try{await api('/api/conversations/'+conversationId,{method:'PUT',body:{id:conversationId,projectId:project.id,mode:'companion',title:'Conversation avec ma compagne IA',model:'auto',messages:history}});}
  catch(e){console.warn('Historique de la compagne non sauvegardé :',e);}
 }
 async function answer(text){
  if(!text.trim()||busy)return;busy=true;add('user',text);history.push({role:'user',content:text});const bubble=add('assistant','');setState('Elle réfléchit…');let result='';
  try{await sse('/api/chat',{projectId:project.id,model:'auto',messages:history.slice(-20)},ev=>{if(ev.type==='delta'&&ev.content){result+=ev.content;bubble.textContent=result;messages.scrollTop=messages.scrollHeight;}if(ev.type==='error')throw new Error(ev.error||'Erreur du modèle');});
   if(result){history.push({role:'assistant',content:result});await persistConversation();setState('Je suis là.');await speak(result,{preferBrowser:true});}
   else await persistConversation();
  }catch(e){bubble.textContent='Je n’ai pas réussi à répondre : '+e.message;setState('Connexion interrompue.');await persistConversation();}busy=false;
 }
 function sendText(){const t=input.value.trim();if(!t)return;input.value='';answer(t);}input.addEventListener('keydown',e=>{if(e.key==='Enter')sendText();});
 function toggleMic(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(listening){recognition?.stop();listening=false;mic.textContent='🎙️ Parler';return;}if(!SR)return toast('Reconnaissance vocale indisponible dans ce navigateur.','bad');
  recognition=new SR();recognition.lang='fr-FR';recognition.interimResults=false;recognition.continuous=false;recognition.onresult=e=>{const t=e.results?.[0]?.[0]?.transcript;if(t)answer(t);};recognition.onerror=e=>toast('Micro : '+e.error,'bad');recognition.onend=()=>{listening=false;mic.textContent='🎙️ Parler';};
  try{recognition.start();listening=true;mic.textContent='⏹ Arrêter';setState('Je t’écoute…');}catch(e){toastErr(e);}
 }
 try{await ensureProject();}catch(e){setState('Projet indisponible : '+e.message);toastErr(e);}
 return ()=>{recognition?.stop();stopSpeaking();};
}

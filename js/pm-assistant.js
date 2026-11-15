"use strict";
(function(){
  const API="https://prixbasmalin-ia.chokoofficiel69.workers.dev/api/ai";
  const form=document.getElementById("pm-ai-form");
  const input=document.getElementById("pm-ai-input");
  const send=document.getElementById("pm-ai-send");
  const status=document.getElementById("pm-ai-status");
  const answer=document.getElementById("pm-ai-answer");
  const amazon=document.getElementById("pm-ai-amazon");
  if(!form||!input||!send||!status||!answer||!amazon)return;
  function show(text){answer.textContent=text;answer.dataset.visible="true";}
  document.querySelectorAll("[data-prompt]").forEach(function(button){
    button.addEventListener("click",function(){input.value=button.getAttribute("data-prompt")||"";input.focus();});
  });
  form.addEventListener("submit",async function(event){
    event.preventDefault();
    const message=input.value.trim();
    if(!message)return;
    send.disabled=true;status.textContent="L’assistant réfléchit…";answer.dataset.visible="false";amazon.hidden=true;amazon.removeAttribute("href");
    try{
      const response=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message})});
      let data={};try{data=await response.json();}catch(_){}
      if(!response.ok||!data.ok)throw new Error(data.error||"Le service est momentanément indisponible.");
      show(data.answer||"Je n’ai pas reçu de réponse exploitable.");
      if(typeof data.amazonSearchUrl==="string"&&data.amazonSearchUrl.startsWith("https://www.amazon.fr/")){
        amazon.href=data.amazonSearchUrl;amazon.hidden=false;
      }
      status.textContent=data.provider==="freellmapi"?"Réponse générée par l’IA Prix Malin.":"Recherche Amazon préparée.";
    }catch(error){
      show(error&&error.message?error.message:"Impossible de joindre l’assistant. Réessayez dans un instant.");
      status.textContent="La demande n’a pas abouti.";
    }finally{send.disabled=false;}
  });
})();
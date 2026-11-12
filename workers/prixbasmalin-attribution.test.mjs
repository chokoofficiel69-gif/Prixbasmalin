import test from "node:test";
import assert from "node:assert/strict";
import worker from "./prixbasmalin-attribution.js";

const ORIGIN="https://prixbasmalin.fr";
function makeEnv() {
  const writes=[];
  return {writes,CLICKS:{prepare(sql){return {bind(...values){return {run:async()=>{writes.push({sql,values});return {success:true};}}};}}}};
}
function req({origin=ORIGIN,ip="198.51.100.10",body={page_path:"/",visitor_id:"visitor-12345678"},contentType="application/json"}={}) {
  return new Request("https://worker.example/view",{method:"POST",headers:{Origin:origin,"CF-Connecting-IP":ip,"Content-Type":contentType},body:JSON.stringify(body)});
}

test("refuse les origines non autorisées",async()=>{
  const env=makeEnv();
  const response=await worker.fetch(req({origin:"https://evil.example"}),env);
  assert.equal(response.status,403);
  assert.equal(env.writes.length,0);
});

test("accepte une attribution valide sans enregistrer l'adresse IP",async()=>{
  const env=makeEnv();
  const request=req();
  Object.defineProperty(request,"cf",{value:{country:"FR"}});
  const response=await worker.fetch(request,env);
  assert.equal(response.status,204);
  assert.equal(env.writes.length,1);
  assert.deepEqual(env.writes[0].values,["/","visitor-12345678","direct","","","FR"]);
  assert.equal(JSON.stringify(env.writes).includes("198.51.100.10"),false);
});

test("rejette les Content-Type non JSON",async()=>{
  const env=makeEnv();
  const response=await worker.fetch(req({contentType:"text/plain"}),env);
  assert.equal(response.status,415);
  assert.equal(env.writes.length,0);
});

test("rejette les corps trop volumineux",async()=>{
  const env=makeEnv();
  const response=await worker.fetch(req({body:{page_path:"/",visitor_id:"visitor-12345678",campaign:"x".repeat(5000)}}),env);
  assert.equal(response.status,413);
  assert.equal(env.writes.length,0);
});

test("limite à 60 requêtes par minute et par identifiant visiteur dans un isolate",async()=>{
  const env=makeEnv();
  let accepted=0,limited=0;
  for(let i=0;i<61;i++){
    const response=await worker.fetch(req({ip:"203.0.113.222",body:{page_path:"/",visitor_id:"visitor-12345678",campaign:String(i)}}),env);
    if(response.status===204) accepted++;
    if(response.status===429) limited++;
  }
  assert.equal(accepted,60);
  assert.equal(limited,1);
  assert.equal(env.writes.length,60);
});

test("réponses portent les en-têtes de sécurité",async()=>{
  const env=makeEnv();
  const response=await worker.fetch(req({ip:"203.0.113.223"}),env);
  assert.equal(response.headers.get("X-Content-Type-Options"),"nosniff");
  assert.equal(response.headers.get("X-Frame-Options"),"DENY");
  assert.equal(response.headers.get("Referrer-Policy"),"strict-origin-when-cross-origin");
});

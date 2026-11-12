/**
 * Prix Malin — FreeLLMAPI gateway.
 * Existing /api/ai callers remain compatible; credentials stay in Worker secrets.
 */
const ALLOWED_ORIGINS = new Set(["https://prixbasmalin.fr","https://www.prixbasmalin.fr"]);
const SECURITY_HEADERS = {"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"strict-origin-when-cross-origin"};
const JSON_HEADERS = {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...SECURITY_HEADERS};
const rateBuckets = new Map();
function isRateLimited(key,now=Date.now()){const windowMs=60000,limit=2;let b=rateBuckets.get(key);if(!b||now-b.start>=windowMs)b={start:now,count:0};b.count++;rateBuckets.set(key,b);if(rateBuckets.size>2000)for(const[k,v]of rateBuckets)if(now-v.start>=windowMs)rateBuckets.delete(k);return b.count>limit;}
function json(data,status,cors={}){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...cors}});}
export default {async fetch(request,env){
 const origin=request.headers.get("Origin")||"",allowed=ALLOWED_ORIGINS.has(origin);
 const cors={...(allowed?{"Access-Control-Allow-Origin":origin}:{}),"Access-Control-Allow-Methods":"POST, GET, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"};
 if(request.method==="OPTIONS")return new Response(null,{status:allowed?204:403,headers:{...SECURITY_HEADERS,...cors}});
 const url=new URL(request.url);
 if(url.pathname==="/health"&&request.method==="GET")return json({ok:true,service:"Prix Malin AI gateway",provider:"FreeLLMAPI",configured:Boolean(env.FREELLMAPI_API_KEY),model:env.FREELLMAPI_MODEL||"gpt-oss-120b"},200,cors);
 if(url.pathname!=="/api/ai"||request.method!=="POST")return json({error:"Not found"},404,cors);
 if(!allowed)return json({error:"Origin not allowed"},403);
 const receivedContentType=request.headers.get("Content-Type");
 if((receivedContentType||"").split(";")[0].trim().toLowerCase()!=="application/json")return json({error:"Content-Type must be application/json",requiredContentType:"application/json",receivedContentType:receivedContentType||null},415,cors);
 if(Number(request.headers.get("Content-Length")||0)>12000)return json({error:"Request too large"},413,cors);
 let body;try{body=await request.json();}catch{return json({error:"Invalid JSON"},400,cors);}
 const message=typeof body?.message==="string"?body.message.trim():"";
 if(!message||message.length>4000)return json({error:"message required (max 4000 characters)"},400,cors);
 const normalized=message.toLocaleLowerCase("fr-FR");
 const productIntent=/\b(trouve|chercher|cherche|recherche|recherches|montre|sors|affiche|donne|liste|catalogue|produits?|articles?|casquette|casquettes|chaussures|baskets|veste|vestes|polo|polos|t[- ]?shirt|tee[- ]?shirt|sac|sacs|parfum|parfums|lunettes|pantalon|pantalons|robe|robes|sweat|sweats|montres|lacoste|adidas|nike|puma|gucci|prada|tommy hilfiger|ralph lauren|new balance|reebok|converse|levis|levi's)\b/.test(normalized);
 if(productIntent){let q=message.replace(/^(?:bonjour[,! ]*)?(?:s’il te plaît[, ]*)?/i,"").replace(/\b(?:peux-tu|pourrais-tu|est-ce que tu peux|je veux|je voudrais|j’aimerais|aide-moi à|trouve-moi|cherche-moi|recherche-moi|montre-moi|sors-moi|donne-moi|affiche-moi|liste-moi|sur amazon|chez amazon|sur le site prix ?malin|sur prix ?bas ?malin|stp|s’il te plaît)\b/gi," ").replace(/[?!.,;:]+/g," ").replace(/\s+/g," ").trim();if(!q)q=message;const amazonSearchUrl="https://www.amazon.fr/s?k="+encodeURIComponent(q)+"&tag=prixbasmalin2-21";return json({ok:true,provider:"amazon",mode:"amazon_search",answer:"Je lance une recherche sur Amazon France pour : "+q+". J’affiche les résultats Amazon correspondants ; je ne vais pas inventer des produits ni des prix.",amazonSearchUrl,amazonSearchQuery:q},200,cors);}
 if(!env.FREELLMAPI_API_KEY)return json({error:"Provider not configured"},503,cors);
 const ip=request.headers.get("CF-Connecting-IP")||"unknown";if(isRateLimited(ip))return json({error:"Limite de test atteinte. Réessaie dans une minute."},429,cors);
 const model=env.FREELLMAPI_MODEL||"gpt-oss-120b";if(!/^[a-zA-Z0-9._:-]{1,100}$/.test(model))return json({error:"Invalid server model configuration"},500,cors);
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),35000);let upstream;
 try{upstream=await fetch("https://freellmapi.prixbasmalin.prod.page/v1/chat/completions",{method:"POST",signal:controller.signal,headers:{"Authorization":"Bearer "+env.FREELLMAPI_API_KEY,"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({model,messages:[{role:"system",content:"Tu es l’assistant d’achat de Prix Malin. Réponds en français, de façon courte et utile. N’invente jamais de produit, de prix, de stock, de livraison, de partenariat ou d’avis. Les recherches de produits et les offres vérifiées doivent provenir des données réelles de Prix Malin ; si elles ne sont pas fournies dans le contexte, dis-le clairement. Pour les produits, rappelle que les recherches actuelles sont centrées sur Amazon France."},{role:"user",content:message}],max_tokens:500,temperature:0.2})});}
 catch(e){clearTimeout(timeout);return json({error:e?.name==="AbortError"?"AI provider timed out":"AI provider unreachable"},502,cors);}
 let raw;try{raw=await upstream.text();}catch{clearTimeout(timeout);return json({error:"Could not read FreeLLMAPI response"},502,cors);}clearTimeout(timeout);
 if(!upstream.ok){let msg="";try{const x=JSON.parse(raw),c=x?.error?.message||x?.message||x?.error;if(typeof c==="string")msg=c;else if(c&&typeof c.message==="string")msg=c.message;}catch{}return json({error:"FreeLLMAPI request failed",status:upstream.status,providerMessage:String(msg).replace(/[\r\n\t]+/g," ").slice(0,200)},502,cors);}
 let data;try{data=JSON.parse(raw);}catch{return json({error:"Invalid response from FreeLLMAPI"},502,cors);}
 const answer=data?.choices?.[0]?.message?.content;if(typeof answer!=="string"||!answer.trim())return json({error:"FreeLLMAPI returned no answer"},502,cors);
 return json({ok:true,provider:"freellmapi",model:data.model||model,routedVia:upstream.headers.get("x-routed-via")||null,answer},200,cors);
}};
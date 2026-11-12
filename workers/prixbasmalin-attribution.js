const RATE_LIMIT_PER_MINUTE=60;
const RATE_WINDOW_MS=60000;
const rateBuckets=new Map();

// Limite locale par isolate et identifiant visiteur : l'adresse IP n'est ni lue ni stockée.
// Ce garde-fou peut être contourné en changeant d'identifiant et n'est pas global.
function isRateLimited(key,now=Date.now()) {
  let bucket=rateBuckets.get(key);
  if(!bucket||now-bucket.start>=RATE_WINDOW_MS) bucket={start:now,count:0};
  bucket.count++;
  rateBuckets.set(key,bucket);
  if(rateBuckets.size>2000) for(const [k,v] of rateBuckets) if(now-v.start>=RATE_WINDOW_MS) rateBuckets.delete(k);
  return bucket.count>RATE_LIMIT_PER_MINUTE;
}

async function readJsonLimited(request,maxBytes) {
  if(!request.body) throw new Error("Missing body");
  const reader=request.body.getReader(),chunks=[];
  let total=0;
  while(true) {
    const {done,value}=await reader.read();
    if(done) break;
    total+=value.byteLength;
    if(total>maxBytes) {
      try { await reader.cancel(); } catch {}
      return {tooLarge:true};
    }
    chunks.push(value);
  }
  const bytes=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  return {value:JSON.parse(new TextDecoder().decode(bytes))};
}

export default {
  async fetch(request, env) {
    const allowed=new Set(["https://prixbasmalin.fr","https://www.prixbasmalin.fr"]);
    const origin=request.headers.get("Origin")||"";
    const cors={"Access-Control-Allow-Origin":allowed.has(origin)?origin:"https://prixbasmalin.fr","Access-Control-Allow-Methods":"POST, OPTIONS, GET","Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"86400","Vary":"Origin","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"strict-origin-when-cross-origin"};
    const url=new URL(request.url);
    if(request.method==="OPTIONS") return new Response(null,{status:allowed.has(origin)?204:403,headers:cors});
    if(request.method==="GET"&&url.pathname==="/health") return Response.json({ok:true,service:"prixbasmalin-attribution",country_measurement:true},{headers:{...cors,"Cache-Control":"no-store"}});
    if(request.method!=="POST"||url.pathname!=="/view") return Response.json({error:"Not found"},{status:404,headers:cors});
    if(!allowed.has(origin)) return Response.json({error:"Origin not allowed"},{status:403,headers:cors});
    const contentType=(request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
    if(contentType!=="application/json") return Response.json({error:"Content-Type must be application/json"},{status:415,headers:cors});
    let body;
    try {
      const parsed=await readJsonLimited(request,4096);
      if(parsed.tooLarge) return Response.json({error:"Request too large"},{status:413,headers:cors});
      body=parsed.value;
    } catch { return Response.json({error:"Invalid JSON"},{status:400,headers:cors}); }
    const pagePath=typeof body?.page_path==="string"?body.page_path.slice(0,180):"/";
    const visitorId=typeof body?.visitor_id==="string"?body.visitor_id.slice(0,80):"";
    const clean=(v,max)=>typeof v==="string"?v.toLowerCase().replace(/[^a-z0-9._-]/g,"").slice(0,max):"";
    const source=clean(body?.source,80)||"direct",medium=clean(body?.medium,80),campaign=clean(body?.campaign,100);
    const rawCountry=request.cf?.country;
    const country=typeof rawCountry==="string"&&/^[A-Z]{2}$/.test(rawCountry)?rawCountry:null;
    if(!pagePath.startsWith("/")||pagePath.includes("..")||!/^[a-zA-Z0-9-]{12,80}$/.test(visitorId)) return Response.json({error:"Invalid data"},{status:400,headers:cors});
    if(isRateLimited(visitorId)) return Response.json({error:"Too many requests"},{status:429,headers:{...cors,"Retry-After":"60","Cache-Control":"no-store"}});
    await env.CLICKS.prepare("INSERT INTO traffic_attribution (page_path, visitor_id, source, medium, campaign, country) VALUES (?, ?, ?, ?, ?, ?)").bind(pagePath,visitorId,source,medium,campaign,country).run();
    return new Response(null,{status:204,headers:{...cors,"Cache-Control":"no-store"}});
  }
};

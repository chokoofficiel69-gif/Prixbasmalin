export default {
  async fetch(request, env) {
    const allowed = new Set(["https://prixbasmalin.fr", "https://www.prixbasmalin.fr"]);
    const origin = request.headers.get("Origin") || "";
    const cors = {"Access-Control-Allow-Origin":allowed.has(origin)?origin:"https://prixbasmalin.fr","Access-Control-Allow-Methods":"POST, OPTIONS, GET","Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"86400","Vary":"Origin"};
    const url = new URL(request.url);
    if(request.method==="OPTIONS") return allowed.has(origin)?new Response(null,{status:204,headers:cors}):new Response(null,{status:403});
    if(request.method==="GET"&&url.pathname==="/health") return Response.json({ok:true,service:"prixbasmalin-attribution",country_measurement:true},{headers:{...cors,"Cache-Control":"no-store"}});
    if(request.method!=="POST"||url.pathname!=="/view") return Response.json({error:"Not found"},{status:404,headers:cors});
    if(!allowed.has(origin)) return Response.json({error:"Origin not allowed"},{status:403,headers:cors});
    let body; try{body=await request.json()}catch{return Response.json({error:"Invalid JSON"},{status:400,headers:cors})}
    const pagePath=typeof body.page_path==="string"?body.page_path.slice(0,180):"/";
    const visitorId=typeof body.visitor_id==="string"?body.visitor_id.slice(0,80):"";
    const clean=(v,max)=>typeof v==="string"?v.toLowerCase().replace(/[^a-z0-9._-]/g,"").slice(0,max):"";
    const source=clean(body.source,80)||"direct",medium=clean(body.medium,80),campaign=clean(body.campaign,100);
    if(!pagePath.startsWith("/")||pagePath.includes("..")||!/^[a-zA-Z0-9-]{12,80}$/.test(visitorId)) return Response.json({error:"Invalid data"},{status:400,headers:cors});
    await env.CLICKS.prepare("INSERT INTO traffic_attribution (page_path, visitor_id, source, medium, campaign, country) VALUES (?, ?, ?, ?, ?, ?)").bind(pagePath,visitorId,source,medium,campaign,country).run();
    return new Response(null,{status:204,headers:{...cors,"Cache-Control":"no-store"}});
  }
};

export default {
  async fetch(request, env) {
    const allowed = new Set(["https://prixbasmalin.fr", "https://www.prixbasmalin.fr"]);
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed.has(origin) ? origin : "https://prixbasmalin.fr",
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return allowed.has(origin) ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
    if (request.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, service: "prixbasmalin-analytics" }, { headers: { ...cors, "Cache-Control": "no-store" } });

    if (request.method === "POST" && (url.pathname === "/track" || url.pathname === "/view")) {
      if (!allowed.has(origin)) return Response.json({ error: "Origin not allowed" }, { status: 403, headers: cors });
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > 2048) return Response.json({ error: "Payload too large" }, { status: 413, headers: cors });
      let body;
      try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors }); }
      const pagePath = typeof body.page_path === "string" ? body.page_path.slice(0, 180) : "/";
      const validPath = pagePath.startsWith("/") && !pagePath.includes("..") && [...pagePath].every(ch => /[a-zA-Z0-9/_.-]/.test(ch));
      if (!validPath) return Response.json({ error: "Invalid page path" }, { status: 400, headers: cors });
      if (url.pathname === "/view") {
        const visitorId = typeof body.visitor_id === "string" ? body.visitor_id.slice(0, 80) : "";
        if (!/^[a-zA-Z0-9-]{12,80}$/.test(visitorId)) return Response.json({ error: "Invalid visitor id" }, { status: 400, headers: cors });
        await env.CLICKS.prepare("INSERT INTO page_views (page_path, visitor_id) VALUES (?, ?)").bind(pagePath, visitorId).run();
        return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
      }
      const merchantHost = typeof body.merchant_host === "string" ? body.merchant_host.toLowerCase().slice(0, 120) : "";
      const clickType = body.click_type === "search" ? "search" : "outbound";
      const labels = merchantHost.split(".");
      const validHost = labels.length >= 2 && labels.every(label => label.length > 0 && [...label].every(ch => /[a-z0-9-]/.test(ch)));
      if (!validHost) return Response.json({ error: "Invalid merchant host" }, { status: 400, headers: cors });
      const isAmazon = merchantHost === "amazon.fr" || merchantHost.endsWith(".amazon.fr");
      const affiliateTag = isAmazon && typeof body.affiliate_tag === "string" && /^[a-z0-9-]{1,30}$/i.test(body.affiliate_tag)
        ? body.affiliate_tag.toLowerCase()
        : null;
      await env.CLICKS.prepare("INSERT INTO outbound_clicks (page_path, merchant_host, click_type, affiliate_tag) VALUES (?, ?, ?, ?)").bind(pagePath, merchantHost, clickType, affiliateTag).run();
      return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
    }

    if (request.method === "GET" && url.pathname === "/stats") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.ADMIN_TOKEN || auth !== "Bearer " + env.ADMIN_TOKEN) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { ...cors, "Cache-Control": "no-store" } });
      const today = await env.CLICKS.prepare("SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM page_views WHERE date(created_at, '+2 hours') = date('now', '+2 hours')").first();
      const clicksToday = await env.CLICKS.prepare("SELECT COUNT(*) AS clicks FROM outbound_clicks WHERE date(created_at, '+2 hours') = date('now', '+2 hours')").first();
      const days = await env.CLICKS.prepare("SELECT date(created_at, '+2 hours') AS day, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM page_views WHERE date(created_at, '+2 hours') >= date('now', '+2 hours', '-6 days') GROUP BY day ORDER BY day").all();
      const clicksDays = await env.CLICKS.prepare("SELECT date(created_at, '+2 hours') AS day, COUNT(*) AS clicks FROM outbound_clicks WHERE date(created_at, '+2 hours') >= date('now', '+2 hours', '-6 days') GROUP BY day ORDER BY day").all();
      const pages = await env.CLICKS.prepare("SELECT page_path, COUNT(*) AS views FROM page_views WHERE date(created_at, '+2 hours') = date('now', '+2 hours') GROUP BY page_path ORDER BY views DESC LIMIT 10").all();
      const merchants = await env.CLICKS.prepare("SELECT merchant_host, COUNT(*) AS clicks FROM outbound_clicks WHERE date(created_at, '+2 hours') = date('now', '+2 hours') GROUP BY merchant_host ORDER BY clicks DESC LIMIT 10").all();
      const amazonAffiliateTags = await env.CLICKS.prepare("SELECT affiliate_tag, COUNT(*) AS clicks FROM outbound_clicks WHERE merchant_host LIKE '%amazon.fr' AND affiliate_tag IS NOT NULL GROUP BY affiliate_tag ORDER BY clicks DESC LIMIT 10").all();
      return Response.json({ generated_at: new Date().toISOString(), today: { ...today, clicks: clicksToday?.clicks || 0 }, days: days.results || [], clicks_days: clicksDays.results || [], top_pages: pages.results || [], top_merchants: merchants.results || [], amazon_affiliate_tags: amazonAffiliateTags.results || [] }, { headers: { ...cors, "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  }
};

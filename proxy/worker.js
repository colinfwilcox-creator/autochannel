// AutoChannel ESPN scoreboard proxy (Cloudflare Worker)
//
// GET /scoreboard/{sport}/{league}  →  https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
//
// Not an open proxy: the upstream host is fixed, only the 6 league paths the
// dashboard uses are allowed, and only a few validated query parameters pass through.

const UPSTREAM = "https://site.api.espn.com/apis/site/v2/sports";

const ALLOWED_LEAGUES = new Set([
  "football/nfl",
  "hockey/nhl",
  "baseball/mlb",
  "basketball/nba",
  "football/college-football",
  "basketball/mens-college-basketball"
]);

// ESPN scoreboard parameters the dashboard may need. Anything else is rejected.
//   dates=20261124 or 20261124-20261130, groups=80 (all FBS) / 50 (all D-I), limit=300
const ALLOWED_PARAMS = {
  dates: /^\d{8}(-\d{8})?$/,
  groups: /^\d{1,3}$/,
  limit: /^\d{1,4}$/
};

const CACHE_SECONDS = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Upstream-Cache, X-Upstream-Status",
  "Access-Control-Max-Age": "86400"
};

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extra }
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return json(405, { error: "Method not allowed" }, { Allow: "GET, OPTIONS" });
    }

    const url = new URL(request.url);

    // Health check: lets you confirm the deploy worked.
    if (url.pathname === "/" || url.pathname === "") {
      return json(200, {
        ok: true,
        service: "autochannel-proxy",
        routes: [...ALLOWED_LEAGUES].map(l => `/scoreboard/${l}`)
      });
    }

    const match = url.pathname.match(/^\/scoreboard\/([a-z-]+)\/([a-z-]+)\/?$/);
    const league = match ? `${match[1]}/${match[2]}` : null;
    if (!league || !ALLOWED_LEAGUES.has(league)) {
      return json(404, { error: "Unknown route", allowed: [...ALLOWED_LEAGUES].map(l => `/scoreboard/${l}`) });
    }

    const upstream = new URL(`${UPSTREAM}/${league}/scoreboard`);
    for (const [key, value] of url.searchParams) {
      const pattern = ALLOWED_PARAMS[key];
      if (!pattern || !pattern.test(value)) {
        return json(400, { error: `Query parameter not allowed: ${key}`, allowed: Object.keys(ALLOWED_PARAMS) });
      }
      upstream.searchParams.set(key, value);
    }

    let res;
    try {
      res = await fetch(upstream.toString(), {
        headers: { Accept: "application/json" },
        // Edge cache: identical requests within 30s are served from Cloudflare's cache.
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
      });
    } catch (err) {
      return json(502, { error: "Upstream fetch failed", detail: String(err && err.message || err) });
    }

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
        "X-Upstream-Status": String(res.status),
        "X-Upstream-Cache": res.headers.get("CF-Cache-Status") || "NONE",
        ...CORS_HEADERS
      }
    });
  }
};

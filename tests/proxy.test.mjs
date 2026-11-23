// Unit tests for proxy/worker.js with a stubbed upstream. Run: node tests/proxy.test.mjs
import worker from "../proxy/worker.js";

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures++; };

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  return new Response(JSON.stringify({ events: [{ id: "1" }] }), {
    status: 200, headers: { "Content-Type": "application/json", "CF-Cache-Status": "HIT" }
  });
};
const req = (path, method = "GET") => worker.fetch(new Request(`https://autochannel-proxy.example.workers.dev${path}`, { method }));

const leagues = ["football/nfl", "hockey/nhl", "baseball/mlb", "basketball/nba",
                 "football/college-football", "basketball/mens-college-basketball"];
for (const l of leagues) {
  calls.length = 0;
  const r = await req(`/scoreboard/${l}`);
  check(r.status === 200 && calls[0]?.url === `https://site.api.espn.com/apis/site/v2/sports/${l}/scoreboard`,
    `/scoreboard/${l} → ESPN ${l}`);
}

const r = await req("/scoreboard/football/nfl?dates=20261124");
check(r.headers.get("Access-Control-Allow-Origin") === "*", "CORS header present");
check(r.headers.get("Cache-Control") === "public, max-age=30", "Cache-Control max-age=30");
check(calls.at(-1).init.cf.cacheTtl === 30 && calls.at(-1).init.cf.cacheEverything, "edge cache 30s requested on subrequest");
check(calls.at(-1).url.endsWith("?dates=20261124"), "allowed query param forwarded");
check(r.headers.get("X-Upstream-Cache") === "HIT", "upstream cache status exposed");
check((await r.json()).events.length === 1, "ESPN JSON passed through unchanged");

calls.length = 0;
const rejects = [
  ["/scoreboard/soccer/eng.1", 404],
  ["/scoreboard/football/nfl/../../../../evil", 404],
  ["/scoreboard/football/nfl/summary", 404],
  ["/https://example.com/", 404],
  ["/scoreboard/football/nfl?url=https://evil.com", 400],
  ["/scoreboard/football/nfl?dates=../../x", 400],
  ["/scoreboard/football/nfl?groups=80&foo=1", 400]
];
for (const [path, status] of rejects) {
  const res = await req(path);
  check(res.status === status, `reject ${path} → ${res.status}`);
}
check(calls.length === 0, "no upstream request made for any rejected path");

check((await req("/scoreboard/football/nfl", "POST")).status === 405, "POST → 405");
const pre = await req("/scoreboard/football/nfl", "OPTIONS");
check(pre.status === 204 && pre.headers.get("Access-Control-Allow-Origin") === "*", "OPTIONS preflight → 204 with CORS");
const health = await req("/");
check(health.status === 200 && (await health.json()).routes.length === 6, "health check lists 6 routes");

globalThis.fetch = async () => { throw new Error("network down"); };
const down = await req("/scoreboard/hockey/nhl");
check(down.status === 502 && down.headers.get("Access-Control-Allow-Origin") === "*", "upstream failure → 502 with CORS");

console.log(failures ? `\n${failures} FAILED` : "\nALL PROXY CHECKS PASSED");
process.exit(failures ? 1 : 0);

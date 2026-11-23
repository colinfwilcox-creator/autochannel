// Live data (Phase 4)
// Base URL of the Cloudflare Worker in /proxy. Empty string = mock data only
// (the Live / Mock toggle is disabled).
const PROXY_BASE_URL = "https://autochannel-proxy.colinfwilcox.workers.dev";

// One request per league per refresh. `params` go to ESPN through the proxy's
// allowlist (dates, groups, limit). `datesToday` adds dates=<today, US Eastern>.
const LIVE_LEAGUES = [
  { sport: "NFL", path: "football/nfl" },
  { sport: "NHL", path: "hockey/nhl" },
  { sport: "MLB", path: "baseball/mlb" },
  { sport: "NBA", path: "basketball/nba" },
  // groups=80: all FBS games, not just the Top 25. The default feed is the whole week,
  // so restrict it to today.
  { sport: "CFB", path: "football/college-football", params: { groups: "80", limit: "300" }, datesToday: true },
  // groups=50: all Division I games, not just the Top 25 (picks up Maryland, Georgetown).
  { sport: "CBB", path: "basketball/mens-college-basketball", params: { groups: "50", limit: "300" } }
];

// Which live games reach the dashboard: everything in progress, plus games that
// start within this many hours. Finals, postponed and canceled games are dropped.
const LIVE_UPCOMING_WINDOW_HOURS = 12;
const LIVE_FETCH_TIMEOUT_MS = 15000;

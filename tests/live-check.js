// Phase 4 live-data checks against the deployed Worker.
//   NODE_USE_ENV_PROXY=1 node tests/live-check.js [marketId]   (default washington-dc)
// Uses the real fetcher/normalizer code. Network: only PROXY_BASE_URL.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const marketId = process.argv[2] || "washington-dc";
const ctx = vm.createContext({ console, Date, Math, URL, Intl, fetch, AbortController, setTimeout, clearTimeout });
for (const f of ["config/venue.js", "config/markets.js", "config/national.js", "config/live.js",
                 "modules/fetcher.js", "modules/scorer.js", "modules/venue.js", "modules/display.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);
const h = t => console.log(`\n=== ${t} ===`);

(async () => {
  const now = new Date();
  const base = run("PROXY_BASE_URL");
  console.log(`Proxy: ${base}\nRun at: ${now.toISOString()} (US Eastern day ${run("easternDateStamp()")})`);

  // ---------- 1. Today's games per league ----------
  h("1. Games per league (today)");
  const data = await run("fetchLiveGames()");
  console.table(data.leagues.map(l => ({
    league: l.sport, returned: l.returned, "live/upcoming": l.games.length,
    "dropped (final / >12h out)": l.filteredOut, failed: l.failures.length, warnings: l.warnings.length
  })));
  data.errors.forEach(e => console.log(`  FETCH ERROR ${e.sport}: ${e.message}`));
  const live = data.games.filter(g => g.espnState === "in").length;
  console.log(`  ${data.games.length} games reach the dashboard (${live} in progress, ${data.games.length - live} upcoming)`);

  // ---------- 2. Normalization failures ----------
  h("2. Normalization failures and warnings");
  let nf = 0;
  data.leagues.forEach(l => {
    l.failures.forEach(f => { nf++; console.log(`  FAIL ${l.sport} ${f.id} "${f.name}": ${f.reason}`); });
    l.warnings.forEach(w => console.log(`  warn ${l.sport} ${w.id} "${w.name}": ${w.message}`));
  });
  if (!nf) console.log("  0 failures");

  // ---------- 3. Team names vs the selected market ----------
  const mkt = run(`MARKETS["${marketId}"]`);
  h(`3. Team names in today's feed vs ${mkt.name} table`);
  // Every event ESPN returned today (not just the ones kept), so finals count too.
  const allToday = [];
  for (const league of run("LIVE_LEAGUES")) {
    ctx.__l = league;
    const res = await fetch(run("leagueUrl(__l)"));
    const json = await res.json();
    for (const ev of json.events || []) {
      for (const c of ev.competitions?.[0]?.competitors || []) allToday.push({ sport: league.sport, name: c.team?.displayName });
    }
  }
  const table = run(`buildTeamTable(MARKETS["${marketId}"])`);
  const venue = run(`buildVenue({ marketId: "${marketId}", totalTVs: 13, anchorTVs: [1,2,3] })`);
  const uniq = [...new Map(allToday.map(t => [`${t.sport}|${t.name}`, t])).values()]
    .sort((a, b) => a.sport.localeCompare(b.sport) || a.name.localeCompare(b.name));
  const matched = uniq.filter(t => t.name in table);
  const unmatched = uniq.filter(t => !(t.name in table));
  console.log(`  ${uniq.length} distinct teams today; ${matched.length} in the ${mkt.name} table:`);
  matched.forEach(t => console.log(`    ✓ ${t.sport} ${t.name} → ${table[t.name]}`));
  const tierOf = n => {
    const b = venue.baseTeamScore(n);
    return b === 40 ? "national draw 40" : b === 35 ? "national program 35" : `generic ${b}`;
  };
  console.log(`  ${unmatched.length} not in the ${mkt.name} table:`);
  const bySport = {};
  unmatched.forEach(t => (bySport[t.sport] = bySport[t.sport] || []).push(`${t.name} (${tierOf(t.name)})`));
  Object.entries(bySport).forEach(([s, names]) => console.log(`    ${s} (${names.length}): ${names.join(", ")}`));

  // ---------- 3b. Reverse check: every table name exists in ESPN ----------
  h("3b. Every market + national team name vs ESPN's own names");
  // ESPN no longer accepts date ranges, so sample single days across each season.
  const days = (start, count, step = 1) => Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8) + i * step));
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  });
  const SAMPLES = {
    NFL: { days: [...days("20260913", 10, 7), ...days("20260914", 10, 7)] },          // Sundays + Mondays
    NHL: { days: days("20261109", 14) },
    NBA: { days: days("20261109", 14) },
    MLB: { days: days("20260415", 7) },
    CFB: { days: days("20260905", 12, 7), params: { groups: "80", limit: "300" } },  // Saturdays
    CBB: { days: days("20261110", 13), params: { groups: "50", limit: "300" } }
  };
  const espnNames = {};
  for (const league of run("LIVE_LEAGUES")) {
    const set = new Set();
    let games = 0;
    for (const day of SAMPLES[league.sport].days) {
      const url = new URL(`${base}/scoreboard/${league.path}`);
      Object.entries(SAMPLES[league.sport].params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      url.searchParams.set("dates", day);
      const json = await (await fetch(url)).json();
      (json.events || []).forEach(ev => { games++; (ev.competitions?.[0]?.competitors || []).forEach(c => set.add(c.team?.displayName)); });
    }
    espnNames[league.sport] = set;
    const d = SAMPLES[league.sport].days;
    console.log(`  ${league.sport}: ${set.size} team names from ${games} games on ${d.length} days (${d[0]}…${d[d.length - 1]})`);
  }
  const pro = new Set([...espnNames.NFL, ...espnNames.NHL, ...espnNames.NBA, ...espnNames.MLB]);
  const college = new Set([...espnNames.CFB, ...espnNames.CBB]);
  const markets = run("MARKETS");
  const checks = []; // { where, name, sport, ok }
  const add = (where, name, sport) => {
    let ok = null;
    if (["NFL", "NHL", "NBA", "MLB"].includes(sport)) ok = espnNames[sport].has(name);
    else if (sport === "college") ok = college.has(name);
    else if (sport === "pro") ok = pro.has(name);
    checks.push({ where, name, sport, ok });
  };
  for (const [id, m] of Object.entries(markets)) {
    for (const [sport, teams] of Object.entries(m.home)) teams.forEach(n => add(id, n, sport));
    (m.college || []).forEach(c => add(id, c.name, "college"));
    (m.regional || []).forEach(r => add(id, r.name, r.sport));
  }
  run("NATIONAL_DRAWS").forEach(n => add("national draws", n, "pro"));
  run("NATIONAL_PROGRAMS").forEach(n => add("national programs", n, "college"));
  const distinct = [...new Map(checks.map(c => [`${c.sport}|${c.name}`, c])).values()];
  const ok = distinct.filter(c => c.ok === true);
  const bad = distinct.filter(c => c.ok === false);
  const unverifiable = distinct.filter(c => c.ok === null);
  console.log(`  ${distinct.length} distinct names: ${ok.length} exact match, ${bad.length} NOT FOUND, ${unverifiable.length} unverifiable (MLS/WNBA: no proxy route)`);
  bad.forEach(c => {
    const where = [...new Set(checks.filter(x => x.name === c.name).map(x => x.where))].join(", ");
    console.log(`    ✗ ${c.sport} "${c.name}" (used in: ${where})`);
  });
  const dcNames = checks.filter(c => c.where === marketId || c.where.startsWith("national"));
  const dcBad = dcNames.filter(c => c.ok === false);
  console.log(`  ${mkt.name} table + national lists: ${dcNames.length - dcBad.length}/${dcNames.length} names match ESPN exactly`);
})().catch(err => { console.error("live check failed:", err); process.exit(1); });

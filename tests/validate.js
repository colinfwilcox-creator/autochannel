// Phase 3 validation (Spec §17, checks D1–D4). Run: node tests/validate.js
// Loads the browser scripts into one VM context so tests exercise the real code.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = vm.createContext({ console, Date, Math });
for (const f of ["config/venue.js", "config/markets.js", "config/national.js", "config/live.js", "config/channels.js", "config/programming.js",
                 "modules/fetcher.js", "modules/scorer.js", "modules/venue.js", "modules/eligibility.js", "modules/display.js", "config/zip-markets.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures++; };
const h = t => console.log(`\n=== ${t} ===`);

// ---------- D1 ----------
h("D1  buildTeamTable(MARKETS['washington-dc']) vs Barking Dog table");
const barkingDog = {
  "Washington Commanders": 90, "Washington Capitals": 85, "Washington Nationals": 80,
  "Washington Wizards": 70, "Maryland Terrapins": 65, "Baltimore Ravens": 55, "Baltimore Orioles": 50
};
const dc = run(`buildTeamTable(MARKETS["washington-dc"])`);
console.table(dc);
check(JSON.stringify(dc) === JSON.stringify(barkingDog), "exact match, same 7 teams, values 90/85/80/70/65/55/50");

// ---------- A1: lock runs before scoring, identity only ----------
h("A1  Lock list is identity-based and resolved before scoring");
run(`
  var __bd = buildVenue(VENUE_PRESETS["barking-dog"]);
  var __games = generateMockGames("tuesday").games;
  var __lock = resolveLocks(__games, __bd);   // games are NOT scored yet
`);
check(run(`__games.every(g => g.channelScore === undefined)`), "resolveLocks received unscored games");
check(run(`__lock.primary && __lock.primary.game.homeTeam === "Washington Commanders"`), "Commanders claims the lock");
// Force the Commanders ChannelScore to 10 after scoring: lock, saturation and state must not change.
run(`
  var __low = scoreGames(__games, __bd).map(g => g.homeTeam === "Washington Commanders" ? { ...g, channelScore: 10 } : g);
  var __ba = programTVs(__low, [], __lock, __bd, createAnchorHistory(), new Date(), []);
  var __cmd = __ba.allGames.find(g => g.homeTeam === "Washington Commanders");
`);
console.log(`  forced Commanders ChannelScore = ${run("__cmd.channelScore")}, state = ${run("__cmd.anchorState")}`);
check(run(`countTVsForGame(__ba, __cmd.id).total === 10`), "ChannelScore 10 lock game still gets 3 anchors + 7 secondaries");
check(run(`__cmd.anchorState !== "demoted"`), "lock game below the 35 demotion line is not demoted");
const floor = run(`(() => { const g = scoreGames([{ ...__games.find(x => x.homeTeam === "Washington Commanders"),
  homeScore: 45, awayScore: 3, gamePhase: 0.8, winProbability: 0.99 }], __bd)[0]; return g.channelScore.toFixed(1); })()`);
console.log(`  note: a real 45-3 Commanders blowout still scores ${floor} (relevance floor keeps home NFL above 35)`);

// ---------- D2: saturation table ----------
h("D2  Saturation table (Commanders in mock data)");
const rows = [
  { label: "13 / 3 / 10", N: 13, A: 3, diehard: true,  exp: [7, 6, 9] },
  { label: "8 / 2 / 6",   N: 8,  A: 2, diehard: true,  exp: [4, 4, 5] },
  { label: "4 / 2 / 2",   N: 4,  A: 2, diehard: false, exp: [1, 1, 2] },
  { label: "4 / 1 / 3",   N: 4,  A: 1, diehard: false, exp: [2, 2, 3] }
];
const scenarios = [
  { key: "tuesday",    team: "Washington Commanders", name: "Commanders (0.70)" },
  { key: "dc-playoff", team: "Washington Capitals",   name: "DC playoff (0.60)" },
  { key: "super-bowl", team: "Washington Commanders", name: "Super Bowl (1.0)" }
];
const table = [];
for (const r of rows) {
  const out = { "N / A / S": r.label };
  const anchors = Array.from({ length: r.A }, (_, i) => i + 1);
  const venueExpr = `buildVenue({ marketId: "washington-dc", totalTVs: ${r.N}, anchorTVs: ${JSON.stringify(anchors)} })`;
  const hasDiehard = run(`!!${venueExpr}.diehardId`);
  out["Diehard"] = hasDiehard ? "Yes" : "No";
  check(hasDiehard === r.diehard, `${r.label}: diehard ${r.diehard ? "present" : "absent"}`);
  scenarios.forEach((sc, i) => {
    const res = run(`(() => {
      const v = ${venueExpr};
      const a = runAssignmentCycle(generateMockGames("${sc.key}").games, v);
      const g = a.lockGame;
      const c = countTVsForGame(a, g.id);
      return { team: g.homeTeam, sat: a.lockItem.saturation, anchors: c.anchors, secs: c.secondaries };
    })()`);
    out[sc.name] = `exp ${r.exp[i]} / got ${res.secs}`;
    check(res.team === sc.team && res.anchors === r.A && res.secs === r.exp[i],
      `${r.label} ${sc.name}: ${res.anchors}/${r.A} anchors + ${res.secs} secondaries (expected ${r.exp[i]})`);
  });
  table.push(out);
}
console.table(table);
check(run(`countTVsForGame(runAssignmentCycle(generateMockGames("tuesday").games, __bd), __lock.primary.game.id).total`) === 10,
  "Barking Dog: Commanders on 10 TVs (3 anchors + 7 secondaries)");

// ---------- A3: two lock games live ----------
h("A3  Two lock-list games live (Commanders any_game + Capitals playoff)");
run(`var __two = runAssignmentCycle(generateMockGames("two-locks").games, __bd);`);
const two = run(`(() => {
  const caps = __two.allGames.find(g => g.homeTeam === "Washington Capitals");
  return { lock: __two.lockGame.homeTeam, cmd: countTVsForGame(__two, __two.lockGame.id), caps: countTVsForGame(__two, caps.id) };
})()`);
console.log(`  full lock: ${two.lock} (${two.cmd.anchors}A + ${two.cmd.secondaries}S); Capitals: ${two.caps.secondaries} secondary`);
check(two.lock === "Washington Commanders" && two.cmd.total === 10, "first lockList team gets full lock + saturation");
check(two.caps.secondaries >= 1, "Capitals guaranteed ≥1 secondary");

// ---------- A4: diehard with nothing demoted ----------
h("A4  Diehard screen with nothing demoted is an ordinary TV");
const dh = run(`(() => {
  const a = runAssignmentCycle(generateMockGames("tuesday").games, __bd, createAnchorHistory(), new Date(), { programming: [] });
  const g = a.secondaries[__bd.diehardId];
  return { game: g && g.homeTeam, demoted: a.allGames.filter(x => x.anchorState === "demoted").length, sat: a.saturationMap[__bd.diehardId] };
})()`);
console.log(`  diehard (${run("__bd.diehardId")}) shows ${dh.game}; demoted games: ${dh.demoted}`);
check(dh.demoted === 0 && !!dh.game && !dh.sat, "diehard is filled like any other TV and is never saturated");

h("A4b Demoted game routing (needs anchor history, one-way)");
// Cycle 1: competitive Celtics are the #1 item, so they hold the Main TVs. Cycle 2: blowout → Demoted.
run(`
  var __base = generateMockGames("dc-playoff").games
    .filter(g => ["Boston Celtics", "Georgetown Hoyas"].includes(g.homeTeam)).map(g => ({ ...g, isPlayoff: false }));
  var __blowCeltics = gs => gs.map(g => g.homeTeam === "Boston Celtics"
    ? { ...g, homeScore: 98, awayScore: 60, gamePhase: 0.8, winProbability: 0.99 } : g);
  var __noGrid = { programming: [] };
`);
const dem16 = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 16, anchorTVs: [1,2,3,4] });
  const hist = createAnchorHistory();
  const a1 = runAssignmentCycle(__base, v, hist, new Date(), __noGrid);
  const anchoredFirst = Object.values(a1.anchors).some(g => g && g.homeTeam === "Boston Celtics");
  const a2 = runAssignmentCycle(__blowCeltics(__base), v, hist, new Date(), __noGrid);
  const c2 = a2.allGames.find(g => g.homeTeam === "Boston Celtics");
  const a3 = runAssignmentCycle(__base, v, hist, new Date(), __noGrid); // tightens up again
  const c3 = a3.allGames.find(g => g.homeTeam === "Boston Celtics");
  return { anchoredFirst, state2: c2.anchorState, cs2: c2.channelScore, diehard2: a2.secondaries[v.diehardId]?.homeTeam,
           onAnchor2: Object.values(a2.anchors).some(g => g && g.homeTeam === "Boston Celtics"),
           state3: c3.anchorState, onAnchor3: Object.values(a3.anchors).some(g => g && g.homeTeam === "Boston Celtics") };
})()`);
console.log(`  cycle 1 on Main: ${dem16.anchoredFirst}; cycle 2 CS ${dem16.cs2.toFixed(1)} → ${dem16.state2}, diehard: ${dem16.diehard2}; cycle 3 (close again) → ${dem16.state3}`);
check(dem16.anchoredFirst && dem16.state2 === "demoted" && !dem16.onAnchor2 && dem16.diehard2 === "Boston Celtics",
  "S ≥ 4: a Main-TV game that blows out is Demoted and moves to the diehard screen");
check(dem16.state3 === "demoted" && !dem16.onAnchor3, "demotion is one-way: no return to a Main TV when it tightens up");
const fresh = run(`(() => {
  const a = runAssignmentCycle(__blowCeltics(__base), buildVenue({ marketId: "washington-dc", totalTVs: 16, anchorTVs: [1,2,3,4] }), createAnchorHistory(), new Date(), __noGrid);
  return a.allGames.find(g => g.homeTeam === "Boston Celtics").anchorState;
})()`);
check(fresh !== "demoted", `a sub-35 game that never held a Main TV is not Demoted (got ${fresh})`);
const dem4 = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 4, anchorTVs: [1, 2] });
  const hist = createAnchorHistory();
  const a1 = runAssignmentCycle(__base, v, hist, new Date(), __noGrid);
  const anchoredFirst = Object.values(a1.anchors).some(g => g && g.homeTeam === "Boston Celtics");
  const a = runAssignmentCycle(__blowCeltics(__base), v, hist, new Date(), __noGrid);
  const onAnchor = Object.values(a.anchors).some(g => g && g.homeTeam === "Boston Celtics");
  const onSec = Object.values(a.secondaries).some(g => g && g.homeTeam === "Boston Celtics");
  return { anchoredFirst, onAnchor, onSec };
})()`);
check(dem4.anchoredFirst && !dem4.onAnchor && dem4.onSec, "S < 4: demoted game takes a secondary, never a Main TV");

// ---------- A5: MLB display ----------
h("A5  MLB display");
const mlb = run(`formatGameClock(generateMockGames().games.find(g => g.sport === "MLB"))`);
check(mlb === "Top 7th", `MLB card shows "${mlb}"`);

// ---------- C: Main TVs (Phase 7 replaces the 1-1-1 / 2-1 / NFL-flip anchor rules) ----------
h("C   Main TVs and the distinct-content target");
for (const [n, k] of [[1, 1], [3, 1], [4, 2], [7, 3], [9, 3], [13, 5], [15, 5], [20, 5]]) {
  check(run(`distinctTarget(${n})`) === k, `${n} TVs → about ${k} different things on screen`);
}
run(`var __noLock = generateMockGames("dc-playoff").games.map(g => ({ ...g, isPlayoff: false }));`);
for (const N of [6, 8, 13, 16]) {
  const r = run(`(() => {
    const v = buildVenue({ marketId: "washington-dc", totalTVs: ${N} });
    const a = runAssignmentCycle(__noLock, v, createAnchorHistory(), new Date(), { programming: [] });
    const top = [...a.allGames].sort((x, y) => y.channelScore - x.channelScore)[0];
    const distinct = new Set(v.tvs.map(tv => (tv.role === "anchor" ? a.anchors : a.secondaries)[tv.id]?.id).filter(Boolean)).size;
    return { A: v.anchors.length, main: v.anchors.map(tv => a.anchors[tv.id]?.homeTeam), top: top.homeTeam, distinct, target: distinctTarget(${N}) };
  })()`);
  check(r.distinct <= r.target && r.main[0] === r.top,
    `${N} TVs: Main TV 1 shows #1 (${r.top}); Mains ${r.main.join(" | ")}; ${r.distinct} distinct game(s), target ${r.target}`);
}

// ---------- D3: other markets ----------
function showMarket(id) {
  h(`D3  Market: ${run(`MARKETS["${id}"].name`)} (${id})`);
  console.log("  Team table:");
  console.table(run(`buildTeamTable(MARKETS["${id}"])`));
  console.log("  Lock list (priority order):");
  console.table(run(`generateLockList(MARKETS["${id}"])`).map(i => ({
    entry: i.team || i.event, trigger: i.trigger, anchors: "all", saturation: i.saturation
  })));
}
showMarket("philadelphia");
showMarket("st-louis");

// ---------- Schema sanity across all markets ----------
h("Schema sanity (all markets)");
const sanity = run(`(() => {
  const bad = [];
  for (const [id, m] of Object.entries(MARKETS)) {
    for (const s of Object.keys(m.home)) if (!(s in HOME_BASE)) bad.push(id + ": unknown sport " + s);
    (m.college || []).forEach(c => { if (!(c.tier in COLLEGE_BASE)) bad.push(id + ": bad tier " + c.name); });
    (m.regional || []).forEach(r => { if (!(r.sport in HOME_BASE)) bad.push(id + ": bad regional sport " + r.name); });
    if (!generateLockList(m).some(i => i.trigger === "any_game")) bad.push(id + ": no any_game lock");
  }
  return { count: Object.keys(MARKETS).length, bad };
})()`);
console.log(`  ${sanity.count} markets`);
check(sanity.bad.length === 0, `no schema errors ${sanity.bad.join("; ")}`);

// ---------- D4 ----------
h("D4  Flagged (uncertain) teams");
const flags = run(`Object.entries(MARKETS).flatMap(([id, m]) => (m.flags || []).map(f => ({ market: m.name, team: f.team, issue: f.issue })))`);
flags.forEach(f => console.log(`  [${f.market}] ${f.team}: ${f.issue}`));
console.log(`  total: ${flags.length}`);

// ---------- Phase 5 ----------
h("P5.1 Address → ZIP → market");
const addr = [
  ["4723 Bethesda Ave, Bethesda, MD 20814", "20814", "washington-dc"],
  ["Bethesda MD 20814-1234", "20814", "washington-dc"],
  ["20814", "20814", "washington-dc"],
  ["1 Main St, Baltimore 21201", "21201", "baltimore"],
  ["350 5th Ave New York NY 10118", "10118", "new-york"],
  ["Huntsville AL 35801", "35801", "nashville"],
  ["Kingman AZ 86401", "86401", "las-vegas"],
  ["4723 Bethesda Ave", null, null],
  ["Anchorage AK 99501", "99501", null]
];
for (const [text, zip, market] of addr) {
  ctx.__t = text;
  const r = run("marketFromAddress(__t)");
  check(r.zip === zip && r.marketId === market, `"${text}" → ZIP ${r.zip} → ${r.marketId || r.error}`);
}
const covered = run("new Set(Object.values(ZIP_PREFIX_TO_MARKET))");
const unknown = [...covered].filter(m => !run(`!!MARKETS["${m}"]`));
check(unknown.length === 0, `every ZIP-mapped market exists (${covered.size} markets reachable by ZIP)`);
check(run("Object.keys(MARKETS).every(m => Object.values(ZIP_PREFIX_TO_MARKET).includes(m))"), "every market is reachable from at least one ZIP prefix");

h("P5.2 Eligibility tiers");
run(`var __dc = buildVenue({ marketId: "washington-dc", totalTVs: 5, anchorTVs: [1] });
  var __g = (o) => ({ id: "t" + Math.random(), sport: "CBB", homeTeam: "A", awayTeam: "B", homeScore: 0, awayScore: 0,
    gameStatus: "in_progress", gamePhase: 0.5, period: 1, gameClock: "10:00", winProbability: 0.5,
    nationalChannels: ["ESPN"], regionalChannels: [], streamingChannels: [], ...o });`);
const tiers = [
  ["NHL any", `{ sport: "NHL", homeTeam: "Utah Mammoth", awayTeam: "Winnipeg Jets" }`, "eligible"],
  ["market team", `{ homeTeam: "Maryland Terrapins", awayTeam: "Coppin State Eagles" }`, "eligible"],
  ["ranked", `{ homeTeam: "X", awayTeam: "Y", awayTeamRank: 12 }`, "eligible"],
  ["rank 26 is unranked", `{ homeTeam: "X", awayTeam: "Y", awayTeamRank: 26 }`, "excluded"],
  ["national program", `{ sport: "CFB", homeTeam: "Clemson Tigers", awayTeam: "Furman Paladins" }`, "eligible"],
  ["Power v Power CBB", `{ homeTeam: "Ole Miss Rebels", awayTeam: "Providence Friars", homeConferenceId: "23", awayConferenceId: "4" }`, "filler"],
  ["CFB Big 12 v Big 12 (id 4 = Big 12 in football)", `{ sport: "CFB", homeTeam: "P", awayTeam: "Q", homeConferenceId: "4", awayConferenceId: "4" }`, "filler"],
  ["CBB WCC v WCC", `{ homeTeam: "P", awayTeam: "Q", homeConferenceId: "29", awayConferenceId: "29" }`, "excluded"],
  ["Notre Dame counts as Power", `{ sport: "CFB", homeTeam: "Notre Dame Fighting Irish", awayTeam: "Q", homeConferenceId: "18", awayConferenceId: "5" }`, "eligible"],
  ["Power v Pac-12", `{ homeTeam: "P", awayTeam: "Oregon State Beavers", homeConferenceId: "2", awayConferenceId: "21" }`, "excluded"],
  ["mid-majors", `{ homeTeam: "Akron Zips", awayTeam: "Ball State Cardinals", homeConferenceId: "14", awayConferenceId: "14" }`, "excluded"],
  ["non-D1 opponent", `{ homeTeam: "Grambling Tigers", awayTeam: "Ecclesia Royals", homeConferenceId: "26" }`, "excluded"]
];
for (const [label, obj, want] of tiers) {
  const got = run(`classifyGame(__g(${obj}), __dc)`);
  check(got.tier === want, `${label}: ${got.tier} (${got.tierReason})`);
}
// Notre Dame is a national program, so it is eligible before the Power rule applies. Check the Power rule itself:
check(run(`isPowerTeam("CFB", "Notre Dame Fighting Irish", "18") && !isPowerTeam("CFB", "UConn Huskies", "18")`), "Notre Dame is Power as an independent; UConn is not");

h("P5.3 Watchable now");
const now = Date.now();
const wt = [
  [`{ gameStatus: "in_progress" }`, true, "in progress"],
  [`{ gameStatus: "scheduled", espnState: "pre", scheduledStartTime: new Date(${now} + 29*60000).toISOString() }`, true, "starts in 29 min"],
  [`{ gameStatus: "scheduled", espnState: "pre", scheduledStartTime: new Date(${now} + 31*60000).toISOString() }`, false, "starts in 31 min"],
  [`{ gameStatus: "scheduled", espnState: "pre", scheduledStartTime: new Date(${now} - 5*60000).toISOString() }`, true, "start time passed, not yet live"],
  [`{ gameStatus: "final" }`, false, "final"]
];
for (const [obj, want, label] of wt) check(run(`isWatchableNow(__g(${obj}), new Date(${now}))`) === want, `${label} → ${want ? "watchable" : "not watchable"}`);

// ---------- Phase 6 ----------
h("P6.1 Channels from ESPN broadcasts");
const tv1 = run(`parseBroadcasts({ geoBroadcasts: [
    { type: { shortName: "TV" }, market: { type: "National" }, media: { shortName: "NHL Net" } },
    { type: { shortName: "TV" }, market: { type: "Home" }, media: { shortName: "MSG" } },
    { type: { shortName: "Streaming" }, market: { type: "National" }, media: { shortName: "ESPN+" } },
    { type: { shortName: "Radio" }, market: { type: "Away" }, media: { shortName: "WBNS" } },
    { type: { shortName: "TV" }, market: { type: "Away" }, media: { shortName: "MNMT" } }
  ] }, "New Jersey Devils", "Washington Capitals")`);
check(JSON.stringify(tv1.nationalChannels) === '["NHL Network"]', `national "NHL Net" → NHL Network (${tv1.nationalChannels})`);
check(tv1.regionalChannels.length === 2 && tv1.regionalChannels[0].channel === "MSG" && tv1.regionalChannels[0].team === "New Jersey Devils"
  && tv1.regionalChannels[1].channel === "Monumental Sports Network" && tv1.regionalChannels[1].side === "away",
  `regional channels keep their team's market: ${tv1.regionalChannels.map(r => r.channel + "/" + r.side).join(", ")}`);
check(tv1.streaming.includes("ESPN+") && !tv1.nationalChannels.includes("ESPN+"), "ESPN+ (Streaming) is not a TV channel; radio ignored");
const tv2 = run(`parseBroadcasts({ broadcasts: [{ market: "national", names: ["Fox", "Peacock"] }] }, "H", "A")`);
check(JSON.stringify(tv2.nationalChannels) === '["FOX"]' && tv2.streaming.includes("Peacock"), "falls back to `broadcasts`; Peacock treated as streaming");

h("P6.2 Availability in market");
run(`var __stl = buildVenue({ marketId: "st-louis", totalTVs: 5 });
  var __caps = __g({ sport: "NHL", homeTeam: "Washington Capitals", awayTeam: "Pittsburgh Penguins", nationalChannels: [],
    regionalChannels: [{ channel: "Monumental Sports Network", side: "home", team: "Washington Capitals" }] });`);
const av = [
  ["ESPN game", "__g({ sport: 'NBA', homeTeam: 'Utah Jazz', awayTeam: 'Phoenix Suns' })", "__dc", true, "ESPN"],
  ["Capitals on Monumental, DC", "__caps", "__dc", true, "Monumental Sports Network"],
  ["Capitals on Monumental, St. Louis", "__caps", "__stl", false, null],
  ["Orioles on MASN, DC", "__g({ sport: 'MLB', homeTeam: 'Baltimore Orioles', awayTeam: 'New York Yankees', nationalChannels: [], regionalChannels: [{ channel: 'MASN', side: 'home', team: 'Baltimore Orioles' }] })", "__dc", true, "MASN"],
  ["ESPN+ only", "__g({ sport: 'NHL', homeTeam: 'Calgary Flames', awayTeam: 'Ottawa Senators', nationalChannels: [], streamingChannels: ['ESPN+'] })", "__dc", false, null],
  ["NBCSN (national since its Nov 2025 relaunch)", "__g({ sport: 'NBA', homeTeam: 'Minnesota Timberwolves', awayTeam: 'Brooklyn Nets', nationalChannels: ['NBCSN'] })", "__dc", true, "NBCSN"],
  ["NBC Sports BA (regional, not NBCSN), DC", "__g({ sport: 'NHL', homeTeam: 'San Jose Sharks', awayTeam: 'Minnesota Wild', nationalChannels: [], regionalChannels: [{ channel: 'NBC Sports BA', side: 'home', team: 'San Jose Sharks' }] })", "__dc", false, null],
  ["no TV listed", "__g({ sport: 'NBA', homeTeam: 'X', awayTeam: 'Y', nationalChannels: [] })", "__dc", false, null]
];
for (const [label, g, v, want, ch] of av) {
  const r = run(`classifyGame(${g}, ${v})`);
  check((r.tier !== "unavailable") === want && (r.displayChannel || null) === ch,
    `${label}: ${r.tier === "unavailable" ? r.tierReason : "available on " + r.displayChannel}`);
}

h("P6.3 Share caps");
const caps = [[60, 15, 10], [55, 15, 10], [54.9, 15, 6], [35, 15, 6], [34.9, 15, 4], [20, 7, 2], [20, 3, 1], [60, 5, 3], [40, 5, 2], [60, 2, 1], [60, 1, 1], [40, 1, 1]];
for (const [cs, n, want] of caps) check(run(`shareCap({ channelScore: ${cs} }, ${n})`) === want, `ChannelScore ${cs}, ${n} TVs → at most ${want}`);

h("P7.1 Programming the TVs");
run(`var __at = iso => new Date(iso);
  var __mon430 = __at("2026-11-23T21:30:00Z");   // Mon 4:30 PM ET
  var __layout = (a, v) => v.tvs.map(tv => { const g = (tv.role === "anchor" ? a.anchors : a.secondaries)[tv.id];
    return g ? { kind: "game", id: g.id, channel: g.displayChannel } : a.programming[tv.id] ? { kind: "prog", channel: a.programming[tv.id].channel, show: a.programming[tv.id].show, src: a.programming[tv.id].source } : { kind: "none" }; });`);
check(JSON.stringify(run(`proportionalSplit(7, [70, 45, 20], [2, 1, 1], [99, 99, 99])`)) === "[3,2,2]" ||
      JSON.stringify(run(`proportionalSplit(7, [70, 45, 20], [2, 1, 1], [99, 99, 99])`)) === "[4,2,1]",
  `proportional split of 7 TVs by 70/45/20 → ${JSON.stringify(run(`proportionalSplit(7, [70, 45, 20], [2, 1, 1], [99, 99, 99])`))}`);
check(JSON.stringify(run(`proportionalSplit(10, [60, 30, 10], [1, 1, 1], [99, 99, 99])`)) === "[6,3,1]", "split 10 by 60/30/10 → 6/3/1");
check(JSON.stringify(run(`proportionalSplit(10, [60, 30, 10], [1, 1, 1], [4, 99, 99])`)) === "[4,5,1]", "a cap moves the excess to the others: 4/5/1");

const mix = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 12 });
  const games = [
    __g({ id: "a", sport: "NBA", homeTeam: "Boston Celtics", awayTeam: "Miami Heat", nationalChannels: ["ESPN"] }),
    __g({ id: "b", sport: "NHL", homeTeam: "Dallas Stars", awayTeam: "Seattle Kraken", nationalChannels: ["TNT"], winProbability: 0.9 }),
    __g({ id: "x", homeTeam: "Akron Zips", awayTeam: "Ball State Cardinals", nationalChannels: ["ESPN2"] }),
    __g({ id: "u", sport: "NHL", homeTeam: "Calgary Flames", awayTeam: "Ottawa Senators", nationalChannels: [], streamingChannels: ["ESPN+"] })];
  const grid = [{ channel: "FS1", show: "The Facility", priority: 45 }, { channel: "ESPN", show: "NFL Live", priority: 70 },
                { channel: "NFL Network", show: "Show N", priority: 30 }, { channel: "MLB Network", show: "Show M", priority: 20 }];
  const a = runAssignmentCycle(games, v, createAnchorHistory(), __mon430, { programming: grid });
  const cs = Object.fromEntries(a.allGames.map(g => [g.id, g.channelScore]));
  return { layout: __layout(a, v), cs, tiers: Object.fromEntries(a.catalog.map(g => [g.id, g.tier])), target: a.distinctTarget, items: a.items.map(i => i.channel + ":" + (i.show || i.id) + ":" + i.strength.toFixed(1)) };
})()`);
const cnt = id => mix.layout.filter(l => l.kind === "game" && l.id === id).length;
const things = new Set(mix.layout.map(l => l.kind === "game" ? "g:" + l.id : l.kind === "prog" ? "p:" + l.channel + l.show : "none"));
console.log(`  12 TVs: ${mix.layout.map(l => l.kind === "game" ? l.id + "@" + l.channel : l.kind === "prog" ? "[" + l.channel + " · " + l.show + "]" : "-").join(" ")}`);
console.log(`  items picked: ${mix.items.join(" | ")}`);
check(things.size <= mix.target && things.size >= mix.target - 1, `${things.size} different things on 12 TVs (target ${mix.target})`);
check(!mix.layout.some(l => l.kind === "prog" && l.channel === "ESPN"), "ESPN carries a game, so its grid entry (NFL Live) is not shown");
check(cnt("a") <= run(`shareCap({ channelScore: ${mix.cs.a} }, 12)`) && cnt("b") <= run(`shareCap({ channelScore: ${mix.cs.b} }, 12)`), "share caps still limit games");
check(cnt("x") === 0 && cnt("u") === 0 && mix.tiers.u === "unavailable" && mix.tiers.x === "excluded", "excluded and unavailable games never go on a TV");
const progCh = mix.layout.filter(l => l.kind === "prog").map(l => l.channel);
check(progCh.length > new Set(progCh).size, `programmed channels can repeat (${progCh.join(", ")})`);
check(mix.layout.every(l => l.kind !== "prog" || !!l.show), "every programmed TV has known content (a show), never a bare channel");

const lone = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 5 });
  const g = __g({ id: "c", homeTeam: "Clemson Tigers", awayTeam: "Ole Miss Rebels", homeScore: 51, awayScore: 75, gamePhase: 0.9, winProbability: 0.99, nationalChannels: ["ACC Network"] });
  const a = runAssignmentCycle([g], v, createAnchorHistory(), __mon430, { programming: [{ channel: "ESPN", show: "NFL Live", priority: 70 }] });
  return { layout: __layout(a, v), cs: a.allGames[0].channelScore };
})()`);
console.log(`  lone blowout (CS ${lone.cs.toFixed(1)}) + NFL Live, 5 TVs: ${lone.layout.map(l => l.kind === "game" ? l.id + "@" + l.channel : l.kind === "prog" ? "[" + l.channel + "]" : "-").join(" ")}`);
check(lone.layout.filter(l => l.kind === "game").length === 1, "a ChannelScore < 35 game gets exactly 1 TV");
check(lone.layout[0].kind === "prog" && lone.layout[0].channel === "ESPN", "the stronger item (NFL Live, priority 70) is #1 and takes the Main TV");

const lockRun = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 15 });
  const a = runAssignmentCycle(generateMockGames("tuesday").games, v, createAnchorHistory(), new Date(), { programming: [] });
  return { lock: a.lockGame && a.lockGame.homeTeam, tvs: countTVsForGame(a, a.lockGame.id), sat: a.saturationTarget, A: v.anchors.length };
})()`);
check(lockRun.lock === "Washington Commanders" && lockRun.tvs.anchors === lockRun.A && lockRun.tvs.secondaries === lockRun.sat,
  `lock unchanged: Commanders on ${lockRun.A} main + ${lockRun.sat} saturated = ${lockRun.tvs.total} of 15 TVs`);

const none = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 7 });
  const a = runAssignmentCycle([__g({ id: "x", homeTeam: "Akron Zips", awayTeam: "Ball State Cardinals" })], v, createAnchorHistory(), __mon430, { programming: [] });
  const progs = Object.values(a.programming);
  return { chans: progs.filter(Boolean).map(p => p.channel), srcs: [...new Set(progs.filter(Boolean).map(p => p.source))] };
})()`);
check(none.chans.length === 7 && none.srcs.join() === "always" && new Set(none.chans).size === run("distinctTarget(7)"),
  `nothing known to be on → always-available list (${[...new Set(none.chans)].join(", ")})`);
const capped = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 7 });
  const g = __g({ id: "c", homeTeam: "Clemson Tigers", awayTeam: "Ole Miss Rebels", homeScore: 51, awayScore: 75, gamePhase: 0.9, winProbability: 0.99, nationalChannels: ["ACC Network"] });
  const a = runAssignmentCycle([g], v, createAnchorHistory(), __mon430, { programming: [] });
  return Object.values(a.programming);
})()`);
check(capped.filter(p => p === null).length === 5 && !capped.some(p => p && p.source === "always"),
  "a known game at its cap (30% of 7 = 2 TVs): the rest is left to the venue, never filled with unknown channels");

h("P7.2 Phase 7 decisions: league networks, showWeight, Main-TV modes");
check(run("TUNING.showWeight") === 0.35, "showWeight is 0.35 (provisional)");
check(run(`programItem({ channel: "ESPN", show: "NFL Live", priority: 70 }).strength`) === 70 * 0.35, "programming strength = priority × showWeight");
run(`var __dcv = buildVenue({ marketId: "washington-dc", totalTVs: 7 });`);
const ln = (iso, teams) => run(`leagueNetworksNow(new Date("${iso}"), __dcv.market, new Set(${JSON.stringify(teams)}))`);
const nov = ln("2026-11-23T21:37:00Z", ["Washington Commanders"]);
const byCh = Object.fromEntries(nov.map(e => [e.channel, e.priority]));
check(byCh["NFL Network"] === 65 && byCh["NBA TV"] === 40 && byCh["NHL Network"] === 40 && !("MLB Network" in byCh),
  `Nov 23 with the Commanders playing: ${nov.map(e => e.channel + " " + e.priority).join(", ")} (MLB Network out of season)`);
const noTeam = ln("2026-11-23T21:37:00Z", ["Dallas Cowboys"]);
check(noTeam.find(e => e.channel === "NFL Network").priority === 40, "+25 only for the selected market's own team (Cowboys playing: NFL Network stays 40)");
const july = ln("2026-07-10T21:00:00Z", ["Washington Nationals"]);
check(july.map(e => e.channel).join() === "MLB Network" && july[0].priority === 65, `July with the Nationals playing: only MLB Network, priority ${july[0].priority}`);
check(nov.every(e => e.show === null && e.source === "league"), "league networks need no specific show");
check(run(`knownProgrammingNow([], __dcv, new Date("2026-11-23T21:37:00Z")).filter(e => e.channel === "NFL Network").length`) === 1,
  "one entry per channel when the grid and a league network share it");

const pm = (strengths, A, sports = []) => run(`planMains(${JSON.stringify(strengths.map((x, i) => ({ strength: x, sport: sports[i] || "NBA" })))}, ${A}, __dcv.thresholds)`);
const t1 = pm([24.5, 22.75, 19.2], 2);
check(t1.plan.join() === "0,1", `A=2, lead 1.75 < 15 → 1-1: Mains show #1, #2 (${t1.mode})`);
check(run("__dcv.thresholds.mainTakeoverGap") === 30 && run("__dcv.thresholds.dominanceGap") === 15, "bands: ≥ 30 all #1, 15–30 2-1 + NFL flip, < 15 1-1-1");
const t2 = pm([65, 30, 20], 2);
check(t2.plan.join() === "0,0", `A=2, lead 35 ≥ 30 → every Main shows #1 (${t2.mode})`);
const t2b = pm([60, 40, 30], 2);
check(t2b.plan.join() === "0,1", `A=2, lead 20 (15–30) → 1-1, since 2-1 is disabled with 2 Mains (${t2b.mode})`);
const t2c = pm([60, 40, 30], 3);
check(t2c.plan.join() === "0,1,0", `A=3, lead 20 (15–30) → 2-1, featured on the outer Mains (${t2c.mode})`);
const t2d = pm([60, 40, 30], 3, ["NBA", "NFL", "NHL"]);
check(t2d.plan.join() === "1,0,1", `A=3, lead 20, NBA #1 over NFL #2 → NFL flip (${t2d.mode})`);
const t3 = pm([50, 45, 40, 35], 3);
check(t3.plan.join() === "0,1,2", `A=3, lead 5 → 1-1-1 (${t3.mode})`);
const t4 = pm([70, 40, 30], 3);
check(t4.plan.join() === "0,0,0", `A=3, lead exactly 30 → every Main shows #1 (${t4.mode})`);
check(pm([50], 4).plan.join() === "0,0,0,0", "a single item takes every Main");
run(`var __th2 = { ...__dcv.thresholds, mainTakeoverGap: 30 };`);
const flip = run(`planMains([{ strength: 70, sport: "NBA" }, { strength: 50, sport: "NFL" }, { strength: 40, sport: "NHL" }], 4, __th2)`);
check(flip.plan.join() === "1,0,2,1", `A=4, lead 20: 2-1 + NFL flip (${flip.mode}: ${flip.plan})`);
const two1 = run(`planMains([{ strength: 70, sport: "NBA" }, { strength: 50, sport: "NHL" }, { strength: 40, sport: "NHL" }], 3, __th2)`);
check(two1.plan.join() === "0,1,0", `…and 2-1 without the flip puts the featured item on the outer Mains (${two1.plan})`);

h("P6.5 Programming grid");
const gridBad = run(`PROGRAMMING_GRID.filter(e => !e.channel || !e.show || !e.days.length || e.days.some(d => !ALL_DAYS.includes(d))
  || toMinutes(e.start) >= toMinutes(e.end) || toMinutes(e.end) > 1440 || e.priority < 1 || e.priority > 100 || e.verify !== true).map(e => e.show)`);
check(gridBad.length === 0, `every grid entry is well-formed and marked verify (${run("PROGRAMMING_GRID.length")} entries)${gridBad.length ? ": " + gridBad.join(", ") : ""}`);
const mnf = sports => run(`programmingAiringNow(__at("2026-11-23T23:30:00Z"), new Set(${JSON.stringify(sports)})).map(e => e.show)`);
check(mnf(["NFL"])[0] === "Monday Night Countdown", `Mon 6:30 PM ET with an NFL game: top entry is ${mnf(["NFL"])[0]}`);
check(!mnf([]).includes("Monday Night Countdown"), "gameDayOnly: no Monday Night Countdown without an NFL game");
check(run(`inSeason({ from: "09-01", to: "02-15" }, "01-10") && !inSeason({ from: "09-01", to: "02-15" }, "06-01")`), "seasons that wrap the new year work");
check(run(`easternClock(__at("2026-11-24T01:30:00Z")).day === "Mon" && easternClock(__at("2026-11-24T01:30:00Z")).minutes === 20 * 60 + 30`), "grid clock is US Eastern (01:30Z Tue = Mon 8:30 PM ET)");

const one = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 1 });
  const a = runAssignmentCycle(generateMockGames("tuesday").games, v);
  return { n: v.tvs.length, A: v.anchors.length, g: a.anchors[v.anchors[0].id]?.homeTeam };
})()`);
check(one.n === 1 && one.A === 1 && one.g === "Washington Commanders", `1-TV venue: 1 main TV showing ${one.g}`);
const five = run(`buildVenue({ marketId: "washington-dc", totalTVs: 5 })`);
check(five.anchors.length === 1 && five.secondaries.length === 4, "5 TVs → 1 main + 4 others (clamp(round(5 × 0.25), 1, 4))");

// ---------- National stature floor ----------
h("NF  National stature floor: Relevance = max(local, floor)");
run(`var __nfl = (id, iso, o = {}) => ({ id, sport: "NFL", homeTeam: "Washington Commanders", awayTeam: "Cincinnati Bengals",
    scheduledStartTime: iso, nationalChannels: ["ESPN"], isPlayoff: false, playoffRound: null, eventName: null, ...o });`);
const nf = (g, slate) => run(`nationalFloorOf(${g}, ${slate || "[]"})`);
const mnfG = `__nfl("mnf", "2026-11-24T01:15:00Z")`;
check(nf(mnfG, `[${mnfG}]`).floor === 80, `MNF 8:15 PM ET, only NFL game in its window, on ESPN → 80 (${nf(mnfG, `[${mnfG}]`).reason})`);
const early = `__nfl("e", "2026-11-22T18:00:00Z")`;
check(nf(early, `[${early}, __nfl("e2", "2026-11-22T18:00:00Z")]`).floor === 45, "Sunday 1 PM ET game → 45 (any other NFL game)");
const snfA = `__nfl("a", "2026-11-23T01:20:00Z")`, snfB = `__nfl("b", "2026-11-23T01:20:00Z")`;
check(nf(snfA, `[${snfA}, ${snfB}]`).floor === 45, "two overlapping primetime NFL games → not standalone → 45");
const prime = `__nfl("p", "2026-11-27T01:15:00Z", { nationalChannels: [], streamingChannels: ["Prime Video"] })`;
check(nf(prime, `[${prime}]`).floor === 45, "primetime but streaming-only (no national channel) → 45");
const tday = `__nfl("t", "2026-11-26T17:30:00Z")`;
check(nf(tday, `[${tday}, __nfl("t2", "2026-11-26T21:30:00Z")]`).floor === 80, "Thanksgiving 12:30 PM ET, only game in its window → 80");
check(nf(`__nfl("po", "2027-01-10T21:30:00Z", { isPlayoff: true, playoffRound: "first_round" })`).floor === 85, "NFL playoffs → 85");
check(nf(`__nfl("sb", "2027-02-14T23:30:00Z", { isPlayoff: true, playoffRound: "championship", eventName: "Super Bowl" })`).floor === 95, "Super Bowl → 95");
const og = (sport, round, extra = "") => `({ id: "x", sport: "${sport}", isPlayoff: ${round ? "true" : "false"}, playoffRound: ${round ? `"${round}"` : "null"}, homeTeam: "H", awayTeam: "A"${extra} })`;
check(nf(og("MLB", "championship")).floor === 95 && nf(og("NBA", "championship")).floor === 95 && nf(og("NHL", "championship")).floor === 95, "World Series / NBA Finals / Stanley Cup Final → 95");
check(nf(og("MLB", "conf_finals")).floor === 70 && nf(og("NHL", "conf_semi")).floor === 55 && nf(og("NBA", "first_round")).floor === 55, "conference finals → 70; earlier rounds → 55");
check(nf(og("CFB", "championship")).floor === 95, "CFP Championship → 95");
check(nf(og("CFB", "conf_semi", `, eventName: "College Football Playoff Semifinal at the Rose Bowl"`)).floor === 70, "CFP semifinal → 70");
check(nf(og("CFB", null, ", homeTeamRank: 4, awayTeamRank: 9")).floor === 55 && nf(og("CFB", null, ", homeTeamRank: 4, awayTeamRank: 12")).floor === 0, "top-10 vs top-10 CFB → 55; top-10 vs #12 → no floor");
check(nf(og("CBB", "championship")).floor === 0 && nf(og("NBA", null)).floor === 0, "no floor for events outside the table (e.g. regular-season NBA, CBB final)");
const relNy = run(`(() => { const v = buildVenue({ marketId: "new-york", totalTVs: 9 });
  const g = { ...${mnfG}, gameStatus: "scheduled", espnState: "pre", homeScore: 0, awayScore: 0, gamePhase: 0, nationalFloor: 80 };
  return { withFloor: calculateRelevance(g, v), without: calculateRelevance({ ...g, nationalFloor: 0 }, v) }; })()`);
check(relNy.withFloor === 80 && relNy.without < 20, `New York: MNF relevance ${relNy.without.toFixed(1)} locally → ${relNy.withFloor} with the floor`);
const relDc = run(`(() => { const v = buildVenue({ marketId: "washington-dc", totalTVs: 9 });
  const g = { ...${mnfG}, gameStatus: "scheduled", nationalFloor: 80 }; return calculateRelevance(g, v); })()`);
check(relDc > 80, `DC: local relevance (${relDc.toFixed(1)}) already above the floor, so it wins`);
const clock = run(`(() => { const g = { ...${mnfG}, gameStatus: "scheduled", espnState: "pre", gamePhase: 0 };
  return [getGamePhaseWeight(g, new Date("2026-11-24T00:00:00Z")), getGamePhaseWeight(g, new Date("2026-11-24T01:00:00Z"))]; })()`);
check(clock[0] === 0.4 && clock[1] === 0.6, `pre-game weight uses the cycle's clock, not the wall clock (75 min out ${clock[0]}, 15 min out ${clock[1]})`);

// ---------- National lock + win-probability fallback ----------
h("NL  National lock and win-probability fallback");
const nlVit = run(`(() => {
  const g = { sport: "NHL", gameStatus: "in_progress", gamePhase: 0.5, homeScore: 2, awayScore: 1, winProbability: null };
  return { none: calculateVitality(g), even: calculateVitality({ ...g, winProbability: 0.5 }), p60: calculateVitality({ ...g, winProbability: 0.6 }) };
})()`);
check(nlVit.none === nlVit.p60 && nlVit.none === 80 && nlVit.even === 100, `no win probability → BaseTension 80, same as 0.6 (null ${nlVit.none}, 0.6 ${nlVit.p60}, 0.5 ${nlVit.even})`);

run(`var __slate = JSON.parse(${JSON.stringify(JSON.stringify(JSON.parse(require("fs").readFileSync(path.join(root, "tests/golden/02-mon-mnf-albany-9tv.json"), "utf8")).games))});
  var __at803 = new Date("2026-11-23T20:03:00-05:00");
  var __lockFor = (market, n, games = __slate, at = __at803) => { const v = buildVenue({ marketId: market, totalTVs: n });
    const a = runAssignmentCycle(games, v, createAnchorHistory(), at);
    return { lock: a.lockGame && a.lockGame.homeTeam, trigger: a.lockItem && a.lockItem.trigger, sat: a.saturationTarget, A: v.anchors.length,
             tvs: a.lockGame ? countTVsForGame(a, a.lockGame.id).total : 0,
             others: a.otherLocks.map(g => g.homeTeam + ":" + countTVsForGame(a, g.id).total) }; };`);
const nlNy = run(`__lockFor("new-york", 9)`);
check(nlNy.lock === "Washington Commanders" && nlNy.trigger === "national" && nlNy.tvs === nlNy.A + nlNy.sat && nlNy.sat === 2,
  `New York 8:03 PM, 9 TVs: national lock on MNF → ${nlNy.A} Main + ${nlNy.sat} saturated (0.30) = ${nlNy.tvs} TVs`);
const nlDc = run(`__lockFor("washington-dc", 15)`);
check(nlDc.lock === "Washington Commanders" && nlDc.trigger === "any_game" && nlDc.tvs === 12, `DC 8:03 PM, 15 TVs: the market lock (any_game, 0.70) wins → ${nlDc.tvs} TVs`);
const nlStl = run(`(() => { const blues = { ...__slate.find(g => g.homeTeam === "Toronto Maple Leafs" || g.awayTeam === "Toronto Maple Leafs"),
    id: "blues", homeTeam: "St. Louis Blues", awayTeam: "Chicago Blackhawks", nationalChannels: ["ESPN2"], regionalChannels: [] };
  return __lockFor("st-louis", 9, [...__slate, blues]); })()`);
check(nlStl.lock === "St. Louis Blues" && nlStl.others.some(o => o.startsWith("Washington Commanders:1")),
  `market lock (Blues) + national lock (MNF) at once: Blues take the Mains; MNF guaranteed a TV (${nlStl.others.join(", ")})`);
const nlEarly = run(`__lockFor("new-york", 9, __slate, new Date("2026-11-23T19:30:00-05:00"))`);
check(nlEarly.lock === null, "national lock not active 45 minutes before kickoff (window opens 30 minutes before)");
const nlDem = run(`(() => { const v = buildVenue({ marketId: "new-york", totalTVs: 9 });
  const g = __slate.find(x => x.sport === "NFL");
  const blowout = { ...g, espnState: "in", gameStatus: "in_progress", gamePhase: 0.9, homeScore: 45, awayScore: 3, winProbability: 0.99 };
  const hist = createAnchorHistory(); hist.anchored.add(g.id);
  const a = runAssignmentCycle([blowout], v, hist, __at803);
  return { state: a.lockGame && a.lockGame.anchorState, cs: a.lockGame && a.lockGame.channelScore }; })()`);
check(nlDem.state !== "demoted", `national-lock game is exempt from demotion (blowout CS ${nlDem.cs && nlDem.cs.toFixed(1)}, state ${nlDem.state})`);
check(run(`generateLockList(MARKETS["new-york"]).find(i => i.event === "Super Bowl").saturation`) === 1, "Super Bowl stays on the market lock lists at saturation 1.0");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures ? 1 : 0);

// Phase 3 validation (Spec §17, checks D1–D4). Run: node tests/validate.js
// Loads the browser scripts into one VM context so tests exercise the real code.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = vm.createContext({ console, Date, Math });
for (const f of ["config/venue.js", "config/markets.js", "config/national.js", "config/live.js",
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
  var __ba = createTVAssignments(__low, __lock, __bd);
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
h("A4  Diehard screen with nothing demoted fills by ChannelScore");
const dh = run(`(() => {
  const a = runAssignmentCycle(generateMockGames("tuesday").games, __bd);
  const g = a.secondaries[__bd.diehardId];
  const independent = __bd.secondaries.filter(tv => !a.saturationMap[tv.id]).map(tv => a.secondaries[tv.id]);
  return { game: g && g.homeTeam, score: g && g.channelScore, demoted: a.allGames.filter(x => x.anchorState === "demoted").length,
           top: Math.max(...independent.filter(Boolean).map(x => x.channelScore)) };
})()`);
console.log(`  diehard (${run("__bd.diehardId")}) shows ${dh.game} (${dh.score.toFixed(1)}); demoted games: ${dh.demoted}`);
check(dh.demoted === 0 && dh.score === dh.top, "diehard holds the best non-saturated game");

h("A4b Demoted game routing (needs anchor history, one-way)");
// Cycle 1: competitive Celtics hold an anchor. Cycle 2: Celtics blowout → Demoted.
run(`
  var __base = generateMockGames("dc-playoff").games.map(g => ({ ...g, isPlayoff: false })); // no lock
  var __blowCeltics = gs => gs.map(g => g.homeTeam === "Boston Celtics"
    ? { ...g, homeScore: 98, awayScore: 60, gamePhase: 0.8, winProbability: 0.99 } : g);
`);
const dem16 = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 16, anchorTVs: [1,2,3,4] });
  const hist = createAnchorHistory();
  const a1 = runAssignmentCycle(__base, v, hist);
  const anchoredFirst = Object.values(a1.anchors).some(g => g && g.homeTeam === "Boston Celtics");
  const a2 = runAssignmentCycle(__blowCeltics(__base), v, hist);
  const c2 = a2.allGames.find(g => g.homeTeam === "Boston Celtics");
  const a3 = runAssignmentCycle(__base, v, hist); // tightens up again
  const c3 = a3.allGames.find(g => g.homeTeam === "Boston Celtics");
  return { anchoredFirst, state2: c2.anchorState, cs2: c2.channelScore, diehard2: a2.secondaries[v.diehardId]?.homeTeam,
           onAnchor2: Object.values(a2.anchors).some(g => g && g.homeTeam === "Boston Celtics"),
           state3: c3.anchorState, onAnchor3: Object.values(a3.anchors).some(g => g && g.homeTeam === "Boston Celtics") };
})()`);
console.log(`  cycle 1 anchored: ${dem16.anchoredFirst}; cycle 2 CS ${dem16.cs2.toFixed(1)} → ${dem16.state2}, diehard: ${dem16.diehard2}; cycle 3 (close again) → ${dem16.state3}`);
check(dem16.anchoredFirst && dem16.state2 === "demoted" && !dem16.onAnchor2 && dem16.diehard2 === "Boston Celtics",
  "S ≥ 4: anchored game that blows out is Demoted and moves to the diehard screen");
check(dem16.state3 === "demoted" && !dem16.onAnchor3, "demotion is one-way: no return to an anchor when it tightens up");
const fresh = run(`(() => {
  const a = runAssignmentCycle(__blowCeltics(__base), buildVenue({ marketId: "washington-dc", totalTVs: 16, anchorTVs: [1,2,3,4] }));
  return a.allGames.find(g => g.homeTeam === "Boston Celtics").anchorState;
})()`);
check(fresh !== "demoted", `a sub-35 game that never held an anchor is not Demoted (got ${fresh})`);
const dem4 = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 4, anchorTVs: [1, 2] });
  const only = gs => gs.filter(g => !["Washington Capitals", "Boston Red Sox"].includes(g.homeTeam));
  const hist = createAnchorHistory();
  const a1 = runAssignmentCycle(only(__base), v, hist);
  const anchoredFirst = Object.values(a1.anchors).some(g => g && g.homeTeam === "Boston Celtics");
  const a = runAssignmentCycle(only(__blowCeltics(__base)), v, hist);
  const onAnchor = Object.values(a.anchors).some(g => g && g.homeTeam === "Boston Celtics");
  const onSec = Object.values(a.secondaries).some(g => g && g.homeTeam === "Boston Celtics");
  return { anchoredFirst, onAnchor, onSec };
})()`);
check(dem4.anchoredFirst && !dem4.onAnchor && dem4.onSec, "S < 4: demoted game takes the lowest-scoring secondary, never an anchor");

// ---------- A5: MLB display ----------
h("A5  MLB display");
const mlb = run(`formatGameClock(generateMockGames().games.find(g => g.sport === "MLB"))`);
check(mlb === "Top 7th", `MLB card shows "${mlb}"`);

// ---------- C: anchor rules ----------
h("C   Anchor rules (non-lock)");
run(`var __noLock = generateMockGames("dc-playoff").games.map(g => ({ ...g, isPlayoff: false }));`);
for (const [N, A] of [[6, 1], [8, 2], [13, 3], [16, 4]]) {
  const r = run(`(() => {
    const v = buildVenue({ marketId: "washington-dc", totalTVs: ${N}, anchorTVs: ${JSON.stringify(Array.from({ length: A }, (_, i) => i + 1))} });
    const a = runAssignmentCycle(__noLock, v);
    return { mode: a.anchorMode, anchors: v.anchors.map(tv => a.anchors[tv.id]?.homeTeam || "—") };
  })()`);
  console.log(`  A=${A}: ${r.mode.padEnd(14)} ${r.anchors.join(" | ")}`);
}
const split = run(`(() => {
  const games = [
    { id: "x1", sport: "NBA", channelScore: 90 }, { id: "x2", sport: "NFL", channelScore: 60 },
    { id: "x3", sport: "NHL", channelScore: 55 }, { id: "x4", sport: "MLB", channelScore: 50 }
  ];
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 16, anchorTVs: [1,2,3,4] });
  const r = assignAnchors(games, v);
  return { mode: r.mode, ids: v.anchors.map(tv => r.assignments[tv.id].id) };
})()`);
console.log(`  A=4 synthetic NBA 90 / NFL 60 / NHL 55: ${split.mode} → ${split.ids.join(" | ")}`);
check(split.ids.join() === "x2,x1,x3,x2", "2-1 at A=4 with NFL flip: NFL on anchors 1 and 4, #1 and #3 interior");

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
    gameStatus: "in_progress", gamePhase: 0.5, period: 1, gameClock: "10:00", winProbability: 0.5, ...o });`);
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

h("P5.4 Filling TVs");
run(`var __pro = (id, sport, home, away, wp) => __g({ id, sport, homeTeam: home, awayTeam: away, winProbability: wp });`);
const rep = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 8, anchorTVs: [1, 2] });
  const games = [__pro("a", "NBA", "Boston Celtics", "Miami Heat", 0.5), __pro("b", "NHL", "Dallas Stars", "Seattle Kraken", 0.7),
                 __g({ id: "f", homeTeam: "Ole Miss Rebels", awayTeam: "Providence Friars", homeConferenceId: "23", awayConferenceId: "4" }),
                 __g({ id: "x", homeTeam: "Akron Zips", awayTeam: "Ball State Cardinals" })];
  const a = runAssignmentCycle(games, v);
  const order = v.tvs.map(tv => (tv.role === "anchor" ? a.anchors : a.secondaries)[tv.id]?.id || "-");
  return { order, repeats: Object.keys(a.repeatMap).length, pool: a.poolTier, fb: Object.keys(a.fallbackChannels).length };
})()`);
console.log(`  8 TVs, 2 eligible + 1 filler + 1 excluded → ${rep.order.join(" ")} (repeats ${rep.repeats})`);
check(rep.pool === "eligible" && !rep.order.includes("f") && !rep.order.includes("x"), "filler and excluded unused while eligible games are watchable");
check(rep.order.every(x => x === "a" || x === "b") && rep.fb === 0, "empty TVs repeat eligible games; no fallback channels");
const counts = rep.order.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
check(Math.abs(counts.a - counts.b) <= 1, `repeats are spread (a ${counts.a}, b ${counts.b})`);

const fil = run(`(() => {
  const noon = new Date(); noon.setHours(12, 0, 0, 0);          // fixed clock: "later today" is well defined
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 4, anchorTVs: [1] });
  const at = h => new Date(noon.getTime() + h * 3600000).toISOString();
  const later = (id, h, sport, home, away) => ({ ...__pro(id, sport, home, away, 0.5), gameStatus: "scheduled", espnState: "pre", scheduledStartTime: at(h) });
  const games = [__g({ id: "f", homeTeam: "Ole Miss Rebels", awayTeam: "Providence Friars", homeConferenceId: "23", awayConferenceId: "4" }),
                 __g({ id: "x", homeTeam: "Akron Zips", awayTeam: "Ball State Cardinals" }),
                 later("n3", 3, "NBA", "Boston Celtics", "Miami Heat"), later("n1", 1, "NHL", "Dallas Stars", "Seattle Kraken"),
                 later("n2", 2, "NBA", "Utah Jazz", "LA Clippers"), later("n4", 4, "NFL", "Detroit Lions", "Chicago Bears"),
                 later("n5", 5, "MLB", "Texas Rangers", "Houston Astros"), later("n6", 6, "NHL", "Boston Bruins", "Buffalo Sabres"),
                 later("tomorrow", 14, "NBA", "Phoenix Suns", "Denver Nuggets"),
                 later("cmd", 8, "NFL", "Washington Commanders", "Cincinnati Bengals"),
                 { ...__g({ id: "xl", homeTeam: "Akron Zips", awayTeam: "Kent State Golden Flashes" }), gameStatus: "scheduled", espnState: "pre", scheduledStartTime: at(2) }];
  const a = runAssignmentCycle(games, v, createAnchorHistory(), noon);
  const ids = v.tvs.map(tv => (tv.role === "anchor" ? a.anchors : a.secondaries)[tv.id]?.id || "-");
  return { ids, pool: a.poolTier, upNext: a.upNext.map(g => g.id) };
})()`);
check(fil.pool === "filler" && fil.ids.every(i => i === "f"), `no eligible game watchable → filler fills the TVs (${fil.ids.join(" ")})`);
check(!fil.ids.some(i => /^n|^x/.test(i)), "later eligible games and excluded games stay off the TVs");
check(fil.upNext.length === 5 && fil.upNext.includes("cmd"), `Up next keeps the 5 most relevant later games, incl. the 8h-away Commanders game (${fil.upNext.join(", ")})`);
check(fil.upNext.every(i => /^(n\d|cmd)$/.test(i)), "Up next has no tomorrow, filler or excluded games");
check(fil.upNext.indexOf("cmd") === 4, "Up next is listed in start-time order (Commanders, latest, is last)");

const fb = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 3, anchorTVs: [1] });
  const a = runAssignmentCycle([__g({ id: "x", homeTeam: "Akron Zips", awayTeam: "Ball State Cardinals" })], v);
  return { pool: a.poolTier, fb: Object.values(a.fallbackChannels) };
})()`);
check(fb.pool === "none" && fb.fb.length === 3, `nothing eligible/filler watchable → fallback channels on all TVs (${fb.fb.join(", ")})`);

const one = run(`(() => {
  const v = buildVenue({ marketId: "washington-dc", totalTVs: 1 });
  const a = runAssignmentCycle(generateMockGames("tuesday").games, v);
  return { n: v.tvs.length, A: v.anchors.length, g: a.anchors[v.anchors[0].id]?.homeTeam };
})()`);
check(one.n === 1 && one.A === 1 && one.g === "Washington Commanders", `1-TV venue: 1 main TV showing ${one.g}`);
const five = run(`buildVenue({ marketId: "washington-dc", totalTVs: 5 })`);
check(five.anchors.length === 1 && five.secondaries.length === 4, "5 TVs → 1 main + 4 others (clamp(round(5 × 0.25), 1, 4))");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures ? 1 : 0);

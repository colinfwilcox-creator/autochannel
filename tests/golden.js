// Golden scenarios: run the engine on human-written expectations and report the match.
//   node tests/golden.js            all scenarios in tests/golden/
//   node tests/golden.js 01         scenarios whose file name contains "01"
//
// Scoring: one point per TV whose channel matches. Main TVs are compared by
// position. Other TVs are compared as a group: TV order among them doesn't matter.
// This is a tuning report, not a pass/fail test, so it always exits 0.
//
// Scenario fields beyond the basics:
//   venue.preset      key in VENUE_PRESETS: start from that preset's setup (anchors, diehard, …)
//   "expected": null  PENDING: the engine output is shown but not scored
//   {"tv": 5, "any": true, "exclude": ["Blue Jackets @ Devils"]}
//                     matches any TV showing known content (a game or a grid program)
//                     whose channel or matchup is not in `exclude`
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = vm.createContext({ console, Date, Math, URL, Intl });
for (const f of ["config/venue.js", "config/markets.js", "config/national.js", "config/live.js", "config/channels.js",
                 "config/programming.js", "config/zip-markets.js", "modules/fetcher.js", "modules/scorer.js",
                 "modules/venue.js", "modules/eligibility.js", "modules/display.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);

// Same wording as the default screen (app.js gameLine / programLine).
function lineFor(slot) {
  if (slot.kind === "game") {
    const g = slot.game;
    const m = `${run(`shortTeamName(${JSON.stringify(g)}, "away")`)} @ ${run(`shortTeamName(${JSON.stringify(g)}, "home")`)}`;
    const pre = g.gameStatus === "scheduled" || g.gameStatus === "pre_game" || g.espnState === "pre";
    if (pre) {
      const t = new Date(g.scheduledStartTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
      return `${g.displayChannel} · ${m} · ${t}`;
    }
    return `${g.displayChannel} · ${m} · ${g.awayScore}–${g.homeScore} · ${run(`formatCompactClock(${JSON.stringify(g)})`)}`;
  }
  if (slot.kind === "program") return slot.show && slot.show !== slot.channel ? `${slot.channel} · ${slot.show}` : slot.channel;
  return "Your choice (no unused sports channel)";
}

function runScenario(file) {
  const sc = JSON.parse(fs.readFileSync(file, "utf8"));
  const now = new Date(sc.moment.at);
  const marketId = sc.venue.marketId || run(`marketFromAddress(${JSON.stringify(sc.venue.zip)}).marketId`);
  const preset = sc.venue.preset ? run(`VENUE_PRESETS[${JSON.stringify(sc.venue.preset)}]`) : null;
  if (sc.venue.preset && !preset) throw new Error(`${sc.id}: unknown venue preset ${sc.venue.preset}`);
  const setup = { ...(preset || {}), marketId, totalTVs: sc.venue.tvCount };
  ctx.__sc = { games: sc.games, setup, now, programming: Array.isArray(sc.programming) ? sc.programming : null };
  const out = run(`(() => {
    const v = buildVenue(__sc.setup);
    const opts = __sc.programming ? { programming: __sc.programming } : {};
    const airing = __sc.programming || knownProgrammingNow(__sc.games, v, __sc.now);
    const a = runAssignmentCycle(__sc.games, v, createAnchorHistory(), __sc.now, opts);
    const slots = v.tvs.map(tv => {
      const g = (tv.role === "anchor" ? a.anchors : a.secondaries)[tv.id];
      if (g) return { tv: tv.number, main: tv.role === "anchor", kind: "game", channel: g.displayChannel, game: g,
                      matchup: shortTeamName(g, "away") + " @ " + shortTeamName(g, "home") };
      const p = a.programming[tv.id];
      if (p) return { tv: tv.number, main: tv.role === "anchor", kind: "program", channel: p.channel, show: p.show };
      return { tv: tv.number, main: tv.role === "anchor", kind: "none", channel: null };
    });
    return { slots, items: a.items.map(i => ({ kind: i.kind, channel: i.channel, label: i.kind === "game" ? i.game.awayTeam + " @ " + i.game.homeTeam : (i.show || "league network"), strength: i.strength,
                                                cap: i.kind === "game" ? shareCap(i.game, v.tvs.length) : null })),
             airing: airing.map(e => e.channel + " · " + (e.show || "league network" + (e.teamDay ? ", team plays today" : "")) + " (" + e.priority + " → " + (e.priority * TUNING.showWeight).toFixed(2) + ")"),
             watchable: a.allGames.map(g => g.displayChannel + " · " + g.awayTeam + " @ " + g.homeTeam + " CS " + g.channelScore.toFixed(1) + " (rel " + g.relevance.toFixed(1) + (g.nationalFloor ? ", floor " + g.nationalFloor + " " + g.nationalFloorReason : "") + ", vit " + g.vitality.toFixed(1) + ") cap " + shareCap(g, v.tvs.length)),
             target: a.distinctTarget, marketName: v.marketName, mode: a.anchorMode,
             roles: v.tvs.map(tv => tv.number + (tv.role === "anchor" ? " main" : tv.isDiehard ? " diehard" : "")).join(", ") };
  })()`);

  const act = out.slots;
  console.log(`\n=== ${sc.id}: ${sc.title} ===`);
  console.log(`market ${out.marketName}${sc.venue.preset ? " · preset " + sc.venue.preset : ""} · ${sc.venue.tvCount} TVs (${out.roles}) · distinct-content target ${out.target}`);
  console.log(`grid airing: ${out.airing.join(" | ") || "none"}`);
  console.log(`watchable games: ${out.watchable.join(" | ") || "none"}`);
  console.log(`main-TV mode: ${out.mode}`);
  console.log(`items picked (strength = ChannelScore, or priority × showWeight ${run("TUNING.showWeight")}): ${out.items.map(i => `${i.channel} · ${i.label} [${i.strength.toFixed(1)}${i.cap ? ", cap " + i.cap : ""}]`).join(" | ")}`);
  console.log("\nDefault screen (actual):");
  act.forEach(s => console.log(`  TV ${s.tv}${s.main ? " · Main" : ""} — ${lineFor(s)}`));

  if (sc.expected === null) {
    console.log("\nPENDING: no expected answer yet (not scored).");
    return { id: sc.id, pending: true };
  }

  // An "any" slot matches known content (a game or a grid program) not on its exclude list.
  const fits = (e, a) => e.any
    ? (a.kind === "game" || a.kind === "program") && !(e.exclude || []).some(x => x === a.channel || x === a.matchup)
    : a.channel === e.channel;

  // Score: Main TVs by position, the rest as a multiset. `pair` maps each expected
  // TV to the actual TV it is compared with (matched ones first, then leftovers).
  const exp = sc.expected;
  const mark = new Map(), pair = new Map();
  let points = 0;
  exp.filter(e => e.main).forEach(e => {
    const a = act.find(x => x.tv === e.tv);
    const ok = !!a && a.main && fits(e, a);
    mark.set(e.tv, ok); pair.set(e.tv, a); if (ok) points++;
  });
  const pool = act.filter(x => !x.main);
  const unmatched = [];
  // Exact channels claim their TVs before "any" slots do.
  [...exp.filter(e => !e.main && !e.any), ...exp.filter(e => !e.main && e.any)].forEach(e => {
    const i = pool.findIndex(x => fits(e, x));
    if (i >= 0) { pair.set(e.tv, pool.splice(i, 1)[0]); mark.set(e.tv, true); points++; }
    else { mark.set(e.tv, false); unmatched.push(e); }
  });
  unmatched.forEach(e => pair.set(e.tv, pool.shift()));
  const pct = Math.round((points / exp.length) * 100);

  console.log("\nPer TV (channel match; non-Main TVs compared as a group, so each is paired with the actual TV it matched):");
  console.log("     | expected                                | actual");
  exp.forEach(e => {
    const a = pair.get(e.tv);
    const want = e.any ? `any${e.exclude && e.exclude.length ? " except " + e.exclude.join(", ") : ""}` : e.channel + (e.content ? " · " + e.content : "");
    const expTxt = `TV ${e.tv}${e.main ? " · Main" : ""} — ${want}`;
    console.log(`  ${mark.get(e.tv) ? "✓" : "✗"}  | ${expTxt.padEnd(40)}| ${a ? `TV ${a.tv}${a.main ? " · Main" : ""} — ${lineFor(a)}` : "—"}`);
  });
  console.log(`\nMatch: ${points}/${exp.length} TVs = ${pct}%`);
  return { id: sc.id, points, total: exp.length, pct };
}

const filter = process.argv[2] || "";
const files = fs.readdirSync(path.join(__dirname, "golden")).filter(f => f.endsWith(".json") && f.includes(filter)).sort();
const results = files.map(f => runScenario(path.join(__dirname, "golden", f)));
const scored = results.filter(r => !r.pending);
const pts = scored.reduce((s, r) => s + r.points, 0), tot = scored.reduce((s, r) => s + r.total, 0);
console.log(`\n=== Overall: ${scored.length} scored scenario(s)${results.length > scored.length ? `, ${results.length - scored.length} pending` : ""}, ${pts}/${tot} TVs = ${tot ? Math.round((pts / tot) * 100) : 0}% ===`);
results.forEach(r => console.log(`  ${r.id}: ${r.pending ? "PENDING" : `${r.points}/${r.total} = ${r.pct}%`}`));

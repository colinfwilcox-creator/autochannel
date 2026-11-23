// Phase 3: Venue builder (Spec §17.B–C)
// Turns a setup {marketId, totalTVs, anchorTVs, diehardTV} into the runtime venue
// object used by scoring and TV assignment.

const LOCK_ANY_GAME_SAT = 0.70;
const LOCK_PLAYOFF_SAT = 0.60;
const LOCK_EVENT_SAT = 1.0;
const LOCK_EVENTS = ["Super Bowl", "World Cup Final"];

function clamp(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }

function defaultAnchorCount(totalTVs) {
  return clamp(Math.round(totalTVs * 0.25), 1, 4);
}

// Relevance lookup: market table → national draws → national programs → generic.
// A team's score is the max across every tier it qualifies for, plus optional adjust (±10).
function buildRelevanceLookup(market, adjust = {}) {
  const table = buildTeamTable(market);
  const merged = { ...(market.adjust || {}), ...adjust };
  return function baseTeamScore(teamName) {
    if (!teamName) return GENERIC_BASE;
    let base = GENERIC_BASE;
    if (NATIONAL_PROGRAMS.includes(teamName)) base = Math.max(base, NATIONAL_PROGRAM_BASE);
    if (NATIONAL_DRAWS.includes(teamName)) base = Math.max(base, NATIONAL_DRAW_BASE);
    if (teamName in table) base = Math.max(base, table[teamName]);
    const adj = clamp(merged[teamName] || 0, -ADJUST_LIMIT, ADJUST_LIMIT);
    return base + adj;
  };
}

// Auto-generated lock list (Spec §17.B). Order = priority: when several lock
// games are live, the earliest entry gets the full lock + saturation (§17.A.3).
// Events come first so a Super Bowl involving the home team uses saturation 1.0.
function generateLockList(market) {
  const list = LOCK_EVENTS.map(event => ({
    event, trigger: "event", anchorMode: "all-anchors", saturation: LOCK_EVENT_SAT
  }));

  const homeTeams = [];
  for (const [sport, teams] of Object.entries(market.home)) {
    teams.forEach(name => homeTeams.push({ name, sport, base: HOME_BASE[sport] }));
  }
  const byBase = [...homeTeams].sort((a, b) => b.base - a.base); // stable: keeps listed order on ties

  const nfl = homeTeams.filter(t => t.sport === "NFL");
  const anyGame = nfl.length ? nfl : byBase.slice(0, 1);
  const anyGameNames = new Set(anyGame.map(t => t.name));

  anyGame.forEach(t => list.push({
    team: t.name, sport: t.sport, trigger: "any_game", anchorMode: "all-anchors", saturation: LOCK_ANY_GAME_SAT
  }));
  byBase.filter(t => !anyGameNames.has(t.name)).forEach(t => list.push({
    team: t.name, sport: t.sport, trigger: "playoff_only", anchorMode: "all-anchors", saturation: LOCK_PLAYOFF_SAT
  }));
  return list;
}

function normalizeSetup(setup) {
  const totalTVs = Math.max(2, Math.floor(Number(setup.totalTVs) || 2));
  let anchorTVs = [...new Set((setup.anchorTVs || []).map(Number))]
    .filter(n => n >= 1 && n <= totalTVs)
    .sort((a, b) => a - b);
  if (anchorTVs.length < 1 || anchorTVs.length >= totalTVs) {
    const a = defaultAnchorCount(totalTVs);
    anchorTVs = Array.from({ length: a }, (_, i) => i + 1);
  }
  const secondaryNums = [];
  for (let n = 1; n <= totalTVs; n++) if (!anchorTVs.includes(n)) secondaryNums.push(n);

  // Diehard only when S ≥ 4 (§17.C). Default: last secondary.
  let diehardTV = null;
  if (secondaryNums.length >= 4) {
    diehardTV = secondaryNums.includes(Number(setup.diehardTV))
      ? Number(setup.diehardTV)
      : secondaryNums[secondaryNums.length - 1];
  }
  return { ...setup, totalTVs, anchorTVs, diehardTV, secondaryNums };
}

function buildVenue(rawSetup) {
  const setup = normalizeSetup(rawSetup);
  const market = MARKETS[setup.marketId];
  if (!market) throw new Error(`Unknown market: ${setup.marketId}`);

  const tvs = [];
  let a = 0, s = 0;
  for (let n = 1; n <= setup.totalTVs; n++) {
    const isAnchor = setup.anchorTVs.includes(n);
    const ordinal = isAnchor ? ++a : ++s;
    const isDiehard = n === setup.diehardTV;
    tvs.push({
      id: `tv_${n}`,
      number: n,
      role: isAnchor ? "anchor" : "secondary",
      ordinal,
      label: `${isAnchor ? "Anchor" : "Secondary"} ${ordinal}`,
      isDiehard,
      saturationEligible: !isAnchor && !isDiehard
    });
  }

  return {
    setup,
    venueName: setup.venueName || "Custom venue",
    marketId: setup.marketId,
    marketName: market.name,
    market,
    tvs,
    anchors: tvs.filter(t => t.role === "anchor"),
    secondaries: tvs.filter(t => t.role === "secondary"),
    diehardId: setup.diehardTV ? `tv_${setup.diehardTV}` : null,
    teamTable: buildTeamTable(market),
    baseTeamScore: buildRelevanceLookup(market, setup.adjust || {}),
    lockList: setup.lockListOverride || generateLockList(market),
    thresholds: { ...VENUE_DEFAULTS.thresholds },
    fallbackChannels: [...VENUE_DEFAULTS.fallbackChannels]
  };
}

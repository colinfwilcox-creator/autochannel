// TV assignment engine (Spec §6, §8, §17)
// Pipeline per cycle:
//   1. resolveLocks(games, venue)   — identity only, runs BEFORE scoring (§17.A.1)
//   2. scoreGames(games, venue)     — ChannelScore for everything (modules/scorer.js)
//   3. createTVAssignments(scored, lockResult, venue)

const INACTIVE_STATUSES = new Set(["final", "postponed", "canceled"]);

// ---------- 1. Lock list (identity-based, never reads ChannelScore) ----------

function isLockWindowOpen(game, venue) {
  if (INACTIVE_STATUSES.has(game.gameStatus)) return false; // releases at the final whistle
  if (game.gameStatus === "scheduled" || game.gameStatus === "pre_game") {
    if (!game.scheduledStartTime) return false;
    const minsToStart = (new Date(game.scheduledStartTime).getTime() - Date.now()) / 60000;
    return minsToStart <= venue.thresholds.lockLeadMinutes;
  }
  return true;
}

function isEventGame(game, eventName) {
  if (game.eventName === eventName) return true;
  if (eventName === "Super Bowl") {
    return game.sport === "NFL" && game.isPlayoff && game.playoffRound === "championship";
  }
  return false;
}

function lockItemMatches(item, game) {
  if (item.event) return isEventGame(game, item.event);
  if (item.team && (game.homeTeam === item.team || game.awayTeam === item.team)) {
    if (item.trigger === "any_game") return true;
    if (item.trigger === "playoff_only") return !!game.isPlayoff;
  }
  return false;
}

// Returns { primary: {game, item} | null, others: [{game, item}] }.
// Priority = position in lockList. A game matching several entries takes the earliest.
function resolveLocks(games, venue) {
  const matches = [];
  const claimed = new Set();
  venue.lockList.forEach(item => {
    for (const game of games) {
      if (claimed.has(game.id) || !isLockWindowOpen(game, venue)) continue;
      if (lockItemMatches(item, game)) {
        matches.push({ game, item });
        claimed.add(game.id);
      }
    }
  });
  return { primary: matches[0] || null, others: matches.slice(1) };
}

// ---------- Saturation (§17.A.2) ----------

function computeSaturationCount(S, eligible, sat) {
  let n = Math.min(Math.round(S * sat), eligible);
  if (sat < 1.0) n = Math.min(n, Math.max(eligible - 1, 0)); // keep ≥1 secondary independent
  return n;
}

// ---------- Anchor state ----------

// Anchor history across refresh cycles (§7, §8.5). Only a game that held an anchor
// while Active can be demoted, and demotion is one-way for the rest of that game.
function createAnchorHistory() {
  return { anchored: new Set(), demoted: new Set() };
}

function getAnchorState(game, venue, lockedIds, history) {
  if (!game) return null;
  const t = venue.thresholds;
  if (game.gameStatus === "final") return "finished";
  const isLocked = lockedIds && lockedIds.has(game.id);
  // Blowout demotion overrides completion protection (§7) — but lock games are
  // identity-based and are never demoted by ChannelScore (§6.1, §17.A.1).
  if (!isLocked && history) {
    if (history.demoted.has(game.id)) return "demoted";
    if (history.anchored.has(game.id) && game.channelScore < t.blowoutDemotion) return "demoted";
  }
  if (game.gamePhase > t.completionProtectionPhase && game.channelScore >= t.completionProtectionMinScore) {
    return "protected";
  }
  return "active";
}

// ---------- Share caps (Phase 6 §3, non-lock games) ----------
// ChannelScore ≥ 55: ≤ 70% of TVs; 35–55: ≤ 40%; < 35: 1 TV. Rounded down, minimum 1.
function shareCap(game, totalTVs) {
  if (game.channelScore >= 55) return Math.max(1, Math.floor(totalTVs * 0.7));
  if (game.channelScore >= 35) return Math.max(1, Math.floor(totalTVs * 0.4));
  return 1;
}

// ---------- 3. Assignment ----------

function assignAnchors(candidates, venue) {
  const anchors = venue.anchors;
  const A = anchors.length;
  const out = {};
  anchors.forEach(tv => { out[tv.id] = null; });
  if (!candidates.length) return { assignments: out, mode: "empty" };

  if (A === 1) {
    out[anchors[0].id] = candidates[0];
    return { assignments: out, mode: "single" };
  }

  if (A === 2) { // 2-1 split disabled
    anchors.forEach((tv, i) => { out[tv.id] = candidates[i] || null; });
    return { assignments: out, mode: "1-1" };
  }

  // A ≥ 3
  const gap = candidates.length >= 2 ? candidates[0].channelScore - candidates[1].channelScore : 0;
  if (candidates.length >= 2 && gap >= venue.thresholds.dominanceGap) {
    let featured = candidates[0];
    let rest = candidates.slice(1);
    let mode = "2-1";
    // NFL flip: non-NFL #1 over NFL #2 → NFL takes the outer anchors.
    if (featured.sport !== "NFL" && candidates[1].sport === "NFL") {
      featured = candidates[1];
      rest = [candidates[0], ...candidates.slice(2)];
      mode = "2-1 (NFL flip)";
    }
    // The featured game takes two anchors, so its share cap must allow 2 TVs.
    if (shareCap(featured, venue.tvs.length) < 2) {
      anchors.forEach((tv, i) => { out[tv.id] = candidates[i] || null; });
      return { assignments: out, mode: anchors.map(() => "1").join("-") + " (2-1 capped)" };
    }
    out[anchors[0].id] = featured;
    out[anchors[A - 1].id] = featured;
    for (let i = 1; i <= A - 2; i++) out[anchors[i].id] = rest[i - 1] || null;
    return { assignments: out, mode };
  }

  anchors.forEach((tv, i) => { out[tv.id] = candidates[i] || null; });
  return { assignments: out, mode: anchors.map(() => "1").join("-") };
}

function createTVAssignments(scoredGames, lockResult, venue, history = createAnchorHistory()) {
  const lockedIds = new Set();
  if (lockResult.primary) lockedIds.add(lockResult.primary.game.id);
  lockResult.others.forEach(m => lockedIds.add(m.game.id));

  const games = scoredGames.map(g => ({ ...g, anchorState: getAnchorState(g, venue, lockedIds, history) }));
  games.filter(g => g.anchorState === "demoted").forEach(g => history.demoted.add(g.id));
  const byId = Object.fromEntries(games.map(g => [g.id, g]));
  const byScore = [...games]
    .filter(g => !INACTIVE_STATUSES.has(g.gameStatus))
    .sort((a, b) => b.channelScore - a.channelScore);

  const primary = lockResult.primary ? byId[lockResult.primary.game.id] : null;
  const primaryItem = lockResult.primary ? lockResult.primary.item : null;
  const otherLocks = lockResult.others.map(m => byId[m.game.id]).filter(Boolean);

  // --- Anchors ---
  let anchorResult;
  if (primary) {
    const out = {};
    venue.anchors.forEach(tv => { out[tv.id] = primary; });
    anchorResult = { assignments: out, mode: "lock" };
  } else {
    const candidates = byScore.filter(g => g.anchorState !== "demoted"); // demoted never on an anchor
    anchorResult = assignAnchors(candidates, venue);
  }
  const onAnchor = new Set(Object.values(anchorResult.assignments).filter(Boolean).map(g => g.id));
  // Record games that hold an anchor while Active, so a later blowout can demote them.
  Object.values(anchorResult.assignments).forEach(g => {
    if (g && !lockedIds.has(g.id) && g.channelScore >= venue.thresholds.blowoutDemotion) history.anchored.add(g.id);
  });

  // --- Secondaries ---
  const secs = venue.secondaries;
  const S = secs.length;
  const sec = {};
  const saturationMap = {};
  const guaranteedMap = {};
  secs.forEach(tv => { sec[tv.id] = null; saturationMap[tv.id] = false; guaranteedMap[tv.id] = false; });

  let saturationTarget = 0;
  if (primary) {
    const eligible = secs.filter(tv => tv.saturationEligible);
    saturationTarget = computeSaturationCount(S, eligible.length, primaryItem.saturation);
    eligible.slice(0, saturationTarget).forEach(tv => { sec[tv.id] = primary; saturationMap[tv.id] = true; });
  }

  const placed = new Set(onAnchor);
  const freeSecs = () => secs.filter(tv => sec[tv.id] === null);
  const diehardTV = venue.diehardId ? secs.find(tv => tv.id === venue.diehardId) : null;

  // (a) Other live lock games: guaranteed ≥1 secondary (§17.A.3).
  for (const g of otherLocks) {
    if (placed.has(g.id)) continue;
    let tv = freeSecs().find(t => t !== diehardTV) || freeSecs()[0];
    if (!tv) {
      // Saturation 1.0 with no diehard filled everything: take the last saturated TV.
      tv = [...secs].reverse().find(t => saturationMap[t.id]);
      if (tv) saturationMap[tv.id] = false;
    }
    if (tv) { sec[tv.id] = g; guaranteedMap[tv.id] = true; placed.add(g.id); }
  }

  // (b) Diehard screen holds the top demoted game; with nothing demoted it fills by score (§17.A.4).
  const demoted = byScore.filter(g => g.anchorState === "demoted" && !placed.has(g.id));
  let diehardGame = null;
  if (diehardTV && sec[diehardTV.id] === null && demoted.length) {
    diehardGame = demoted[0];
    sec[diehardTV.id] = diehardGame;
    placed.add(diehardGame.id);
  }

  // (c) Remaining secondaries in TV order, by ChannelScore, no repeats.
  const pool = byScore.filter(g => !placed.has(g.id));
  for (const tv of freeSecs()) {
    const g = pool.shift();
    if (!g) break;
    sec[tv.id] = g;
    placed.add(g.id);
  }

  // (d) No designated diehard (S < 4): the top demoted game, if still unplaced, drops to the
  //     secondary showing the lowest ChannelScore (never an anchor) (§17.C).
  if (!diehardTV && demoted.length && !placed.has(demoted[0].id)) {
    const g = demoted[0];
    const replaceable = secs.filter(tv => sec[tv.id] && !saturationMap[tv.id] && !guaranteedMap[tv.id]);
    if (replaceable.length) {
      const lowest = replaceable.reduce((lo, tv) => (sec[tv.id].channelScore < sec[lo.id].channelScore ? tv : lo));
      sec[lowest.id] = g;
      placed.add(g.id);
      diehardGame = g;
    }
  }

  return {
    anchors: anchorResult.assignments,
    anchorMode: anchorResult.mode,
    secondaries: sec,
    saturationMap,
    guaranteedMap,
    saturationTarget,
    lockGame: primary,
    lockItem: primaryItem,
    otherLocks,
    diehardGame,
    allGames: games
  };
}

function tvMap(a, tv) {
  return tv.role === "anchor" ? a.anchors : a.secondaries;
}

function emptyTVs(a, venue) {
  return venue.tvs.filter(tv => !tvMap(a, tv)[tv.id]);
}

function tvCountsByGame(a) {
  const counts = new Map();
  [...Object.values(a.anchors), ...Object.values(a.secondaries)].forEach(g => {
    if (g) counts.set(g.id, (counts.get(g.id) || 0) + 1);
  });
  return counts;
}

// Fill empty TVs with `ranked` games (best first), round-robin — #1 gets the first
// free TV, then #2, … then #1 again — each game up to its share cap. Anchors never
// take a demoted game. The primary lock game is never added here (saturation sets
// its share). Marks TVs a game already had as repeats.
function fillWithCaps(a, venue, ranked, tier) {
  const N = venue.tvs.length;
  const lockId = a.lockGame ? a.lockGame.id : null;
  const games = ranked.filter(g => g.id !== lockId && !INACTIVE_STATUSES.has(g.gameStatus));
  const counts = tvCountsByGame(a);
  let progress = true;
  while (progress) {
    progress = false;
    for (const g of games) {
      if ((counts.get(g.id) || 0) >= shareCap(g, N)) continue;
      const tv = emptyTVs(a, venue).find(t => !(t.role === "anchor" && g.anchorState === "demoted"));
      if (!tv) return;
      if (counts.get(g.id)) a.repeatMap[tv.id] = true;
      tvMap(a, tv)[tv.id] = g;
      a.tierMap[tv.id] = tier;
      counts.set(g.id, (counts.get(g.id) || 0) + 1);
      progress = true;
    }
  }
}

// Sports with a game on today's (US Eastern) slate, for gameDayOnly grid entries.
function sportsWithGamesToday(games, now) {
  const today = easternDateStamp(now);
  const set = new Set();
  games.forEach(g => {
    if (g.espnState === "in" || (g.scheduledStartTime && easternDateStamp(new Date(g.scheduledStartTime)) === today)) set.add(g.sport);
  });
  return set;
}

// Leftover TVs → programming grid (airing now, by priority), then the always-available
// list. No channel is used twice by non-game TVs, and a channel already carrying a
// game on some TV isn't reused. TVs that still have nothing are left to the venue.
function assignProgramming(a, venue, now, sportsToday) {
  a.programming = {};
  const used = new Set(
    [...Object.values(a.anchors), ...Object.values(a.secondaries)].filter(Boolean).map(g => g.displayChannel).filter(Boolean)
  );
  const options = [
    ...programmingAiringNow(now, sportsToday).map(e => ({ channel: e.channel, show: e.show, source: "grid", priority: e.priority, verify: !!e.verify })),
    ...ALWAYS_AVAILABLE_CHANNELS.map(c => ({ channel: c, show: null, source: "always" }))
  ];
  for (const tv of emptyTVs(a, venue)) {
    const pick = options.find(o => !used.has(o.channel));
    if (!pick) { a.programming[tv.id] = null; continue; }
    used.add(pick.channel);
    a.programming[tv.id] = pick;
  }
}

// Full cycle (Phase 6):
//   availability + tiers → watchable now → lock + saturation → eligible games (caps)
//   → filler games (caps) → programming grid → always-available channels.
// `history` (from createAnchorHistory) carries anchor/demotion state between cycles.
function runAssignmentCycle(games, venue, history = createAnchorHistory(), now = new Date()) {
  const classified = games.map(g => ({ ...g, ...classifyGame(g, venue), watchableNow: isWatchableNow(g, now) }));
  const eligibleNow = classified.filter(g => g.tier === "eligible" && g.watchableNow);
  const fillerNow = classified.filter(g => g.tier === "filler" && g.watchableNow);
  // Locks, anchors and the first pass run on eligible games; filler only leads when nothing eligible is on.
  const pool = eligibleNow.length ? eligibleNow : fillerNow;

  const lockResult = resolveLocks(pool, venue);        // before scoring, by identity
  const scored = scoreGames(pool, venue);
  const a = createTVAssignments(scored, lockResult, venue, history);
  a.repeatMap = {};
  a.tierMap = {};
  venue.tvs.forEach(tv => { const g = tvMap(a, tv)[tv.id]; if (g) a.tierMap[tv.id] = g.tier; });

  // The first pass places each game once; caps also apply to it.
  const N = venue.tvs.length;
  const counts = tvCountsByGame(a);
  const lockId = a.lockGame ? a.lockGame.id : null;
  venue.tvs.forEach(tv => {
    const g = tvMap(a, tv)[tv.id];
    if (!g || g.id === lockId) return;
    if (counts.get(g.id) > shareCap(g, N)) { tvMap(a, tv)[tv.id] = null; delete a.tierMap[tv.id]; counts.set(g.id, counts.get(g.id) - 1); }
  });

  const byScore = list => [...list].sort((x, y) => y.channelScore - x.channelScore);
  fillWithCaps(a, venue, byScore(a.allGames), pool === eligibleNow ? "eligible" : "filler");
  let fillerScored = [];
  if (eligibleNow.length && fillerNow.length) {
    fillerScored = scoreGames(fillerNow, venue).map(g => ({ ...g, anchorState: getAnchorState(g, venue, new Set(), history) }));
    fillWithCaps(a, venue, byScore(fillerScored), "filler");
  }
  assignProgramming(a, venue, now, sportsWithGamesToday(games, now));
  a.poolTier = eligibleNow.length ? "eligible" : fillerNow.length ? "filler" : "none";

  // Everything, for the details view. Unavailable and excluded games are never scored.
  const scoredById = new Map([...a.allGames, ...fillerScored].map(g => [g.id, g]));
  const rest = scoreGames(classified.filter(g => (g.tier === "eligible" || g.tier === "filler") && !scoredById.has(g.id)), venue);
  rest.forEach(g => scoredById.set(g.id, g));
  a.catalog = classified.map(g => scoredById.get(g.id) || g);
  a.tierCounts = { unavailable: 0, eligible: 0, filler: 0, excluded: 0 };
  classified.forEach(g => { a.tierCounts[g.tier]++; });
  // Up next: the 5 most relevant available eligible games later today, shown in start order.
  const byStart = (x, y) => new Date(x.scheduledStartTime) - new Date(y.scheduledStartTime);
  a.upNext = a.catalog
    .filter(g => g.tier === "eligible" && isLaterToday(g, now))
    .sort((x, y) => (y.channelScore - x.channelScore) || byStart(x, y))
    .slice(0, 5)
    .sort(byStart);
  return a;
}

// Count how many TVs a game is on: { anchors, secondaries, total }.
function countTVsForGame(assignments, gameId) {
  const a = Object.values(assignments.anchors).filter(g => g && g.id === gameId).length;
  const s = Object.values(assignments.secondaries).filter(g => g && g.id === gameId).length;
  return { anchors: a, secondaries: s, total: a + s };
}

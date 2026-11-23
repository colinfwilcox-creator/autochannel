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

function getAnchorState(game, venue, lockedIds) {
  if (!game) return null;
  const t = venue.thresholds;
  if (game.gameStatus === "final") return "finished";
  const isLocked = lockedIds && lockedIds.has(game.id);
  // Blowout demotion overrides completion protection (§7) — but lock games are
  // identity-based and are never demoted by ChannelScore (§6.1, §17.A.1).
  if (!isLocked && game.channelScore < t.blowoutDemotion) return "demoted";
  if (game.gamePhase > t.completionProtectionPhase && game.channelScore >= t.completionProtectionMinScore) {
    return "protected";
  }
  return "active";
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
    out[anchors[0].id] = featured;
    out[anchors[A - 1].id] = featured;
    for (let i = 1; i <= A - 2; i++) out[anchors[i].id] = rest[i - 1] || null;
    return { assignments: out, mode };
  }

  anchors.forEach((tv, i) => { out[tv.id] = candidates[i] || null; });
  return { assignments: out, mode: anchors.map(() => "1").join("-") };
}

function createTVAssignments(scoredGames, lockResult, venue) {
  const lockedIds = new Set();
  if (lockResult.primary) lockedIds.add(lockResult.primary.game.id);
  lockResult.others.forEach(m => lockedIds.add(m.game.id));

  const games = scoredGames.map(g => ({ ...g, anchorState: getAnchorState(g, venue, lockedIds) }));
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

// Runs the full cycle for a set of games and a venue.
function runAssignmentCycle(games, venue) {
  const lockResult = resolveLocks(games, venue);        // before scoring, by identity
  const scored = scoreGames(games, venue);
  const assignments = createTVAssignments(scored, lockResult, venue);
  assignments.fallbackChannels = assignFallbackChannels(assignments, venue);
  return assignments;
}

function assignFallbackChannels(assignments, venue) {
  const emptySlots = Object.entries(assignments.secondaries)
    .filter(([, game]) => game === null)
    .map(([tvId]) => tvId);
  const fallbackMap = {};
  emptySlots.forEach((tvId, index) => {
    fallbackMap[tvId] = venue.fallbackChannels[index % venue.fallbackChannels.length];
  });
  return fallbackMap;
}

// Count how many TVs a game is on: { anchors, secondaries, total }.
function countTVsForGame(assignments, gameId) {
  const a = Object.values(assignments.anchors).filter(g => g && g.id === gameId).length;
  const s = Object.values(assignments.secondaries).filter(g => g && g.id === gameId).length;
  return { anchors: a, secondaries: s, total: a + s };
}

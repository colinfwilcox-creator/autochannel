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

// ---------- 3. Programming the TVs (Phase 7) ----------
//
// Items are things a TV can show that we know are on: a game, or a programming
// grid entry airing now. Strength = ChannelScore for games, grid priority for shows.
//
//   1. Lock game: all Main TVs + saturation (unchanged). Other lock games: 1 TV each.
//      A demoted game takes the diehard TV (or the last free one), never a Main TV.
//   2. Distinct-content target K = min(5, ceil(N / 3)) things on screen.
//   3. Pick the top items by strength (eligible games + grid shows; filler games
//      only if that's not enough). Without a lock, Main TVs show the #1 item.
//   4. Share the remaining TVs across the picked items in proportion to strength
//      (largest remainder, each item ≥ 1). Share caps limit games.
//   5. Channels with unknown content are never shown, except the always-available
//      list when nothing at all is known to be on.

const MAX_DISTINCT_ITEMS = 5;

function distinctTarget(totalTVs) {
  return Math.min(MAX_DISTINCT_ITEMS, Math.ceil(totalTVs / 3));
}

function tvMap(a, tv) {
  return tv.role === "anchor" ? a.anchors : a.secondaries;
}

function isTVFree(a, tv) {
  return !tvMap(a, tv)[tv.id] && !a.programming[tv.id];
}

function gameItem(g) {
  return { kind: "game", id: g.id, game: g, channel: g.displayChannel, strength: g.channelScore };
}

function programItem(e) {
  return { kind: "program", id: `prog:${e.channel}:${e.show}`, channel: e.channel, show: e.show,
           strength: e.priority, priority: e.priority, verify: !!e.verify, source: "grid" };
}

function placeItem(a, tv, item) {
  if (item.kind === "game") tvMap(a, tv)[tv.id] = item.game;
  else a.programming[tv.id] = { channel: item.channel, show: item.show, priority: item.priority, verify: item.verify, source: item.source };
}

// Integer split of `total` by weight: each item starts at mins[i] and is never
// above maxes[i]; each further TV goes to the item furthest below its ideal
// (weight-proportional) share. Equivalent to largest remainder with bounds.
function proportionalSplit(total, weights, mins, maxes) {
  const out = mins.map((m, i) => Math.min(m, maxes[i]));
  let left = total - out.reduce((x, y) => x + y, 0);
  const w = weights.map(x => Math.max(x, 0.0001));
  while (left > 0) {
    const open = out.map((_, i) => i).filter(i => out[i] < maxes[i]);
    if (!open.length) break;
    const wSum = open.reduce((s, i) => s + w[i], 0);
    const pool = open.reduce((s, i) => s + out[i], 0) + left;
    const gap = i => (w[i] / wSum) * pool - out[i];
    const best = open.reduce((b, i) => (gap(i) > gap(b) ? i : b), open[0]);
    out[best]++;
    left--;
  }
  return out;
}

// scored: available eligible (+ filler) games, scored, watchable now.
function programTVs(scored, fillerScored, lockResult, venue, history, now, grid) {
  const N = venue.tvs.length;
  const A = venue.anchors.length;
  const K = distinctTarget(N);
  const lockedIds = new Set();
  if (lockResult.primary) lockedIds.add(lockResult.primary.game.id);
  lockResult.others.forEach(m => lockedIds.add(m.game.id));

  const withState = list => list.map(g => ({ ...g, anchorState: getAnchorState(g, venue, lockedIds, history) }));
  const games = withState(scored);
  const filler = withState(fillerScored);
  [...games, ...filler].filter(g => g.anchorState === "demoted").forEach(g => history.demoted.add(g.id));
  const byId = new Map([...games, ...filler].map(g => [g.id, g]));

  const a = {
    anchors: {}, secondaries: {}, programming: {}, saturationMap: {}, guaranteedMap: {}, repeatMap: {},
    lockGame: null, lockItem: null, otherLocks: [], saturationTarget: 0, diehardGame: null,
    items: [], distinctTarget: K, anchorMode: "", allGames: [...games, ...filler]
  };
  venue.anchors.forEach(tv => { a.anchors[tv.id] = null; });
  venue.secondaries.forEach(tv => { a.secondaries[tv.id] = null; a.saturationMap[tv.id] = false; a.guaranteedMap[tv.id] = false; });
  const used = []; // items on screen, in rank order
  const free = () => venue.tvs.filter(tv => isTVFree(a, tv));
  const freeSecondaries = () => venue.secondaries.filter(tv => isTVFree(a, tv));

  // 1. Lock game + saturation.
  if (lockResult.primary) {
    const g = byId.get(lockResult.primary.game.id);
    a.lockGame = g;
    a.lockItem = lockResult.primary.item;
    const eligibleSecs = venue.secondaries.filter(tv => tv.saturationEligible);
    a.saturationTarget = computeSaturationCount(venue.secondaries.length, eligibleSecs.length, a.lockItem.saturation);
    venue.anchors.forEach(tv => { a.anchors[tv.id] = g; });
    eligibleSecs.slice(0, a.saturationTarget).forEach(tv => { a.secondaries[tv.id] = g; a.saturationMap[tv.id] = true; });
    used.push(gameItem(g));
    a.anchorMode = "lock";
  }
  // Other live lock games: guaranteed 1 TV each (§17.A.3).
  for (const m of lockResult.others) {
    const g = byId.get(m.game.id);
    const tv = freeSecondaries().find(t => t.id !== venue.diehardId) || freeSecondaries()[0];
    if (!g || !tv) continue;
    a.secondaries[tv.id] = g; a.guaranteedMap[tv.id] = true;
    a.otherLocks.push(g);
    used.push(gameItem(g));
  }
  // Demoted game → diehard TV (or the last free secondary). Never a Main TV.
  const demoted = [...games, ...filler].filter(g => g.anchorState === "demoted" && !lockedIds.has(g.id))
    .sort((x, y) => y.channelScore - x.channelScore)[0];
  if (demoted) {
    const fs = freeSecondaries();
    const tv = fs.find(t => t.id === venue.diehardId) || fs[fs.length - 1];
    if (tv) { a.secondaries[tv.id] = demoted; a.diehardGame = demoted; used.push(gameItem(demoted)); }
  }

  // 2–3. Candidates: games and grid shows, by strength. A channel carrying a game
  // right now isn't showing its grid entry, so those entries drop out.
  const usedIds = new Set(used.map(i => i.id));
  const gameChannels = new Set([...games, ...filler].map(g => g.displayChannel).filter(Boolean));
  const seenChannels = new Set();
  const gridItems = grid
    .filter(e => !gameChannels.has(e.channel))
    .filter(e => (seenChannels.has(e.channel) ? false : seenChannels.add(e.channel)))
    .map(programItem);
  const byStrength = (x, y) => y.strength - x.strength || (x.kind === "game" ? -1 : 1);
  let candidates = [...games.filter(g => !usedIds.has(g.id) && g.anchorState !== "demoted").map(gameItem), ...gridItems].sort(byStrength);
  const extraFiller = filler.filter(g => !usedIds.has(g.id) && g.anchorState !== "demoted").map(gameItem).sort(byStrength);
  let slots = free().length;
  let kLeft = Math.max(K - used.length, slots > 0 ? 1 : 0);
  if (candidates.length < kLeft) candidates = [...candidates, ...extraFiller];
  let picked = candidates.slice(0, Math.min(kLeft, slots));
  let reserve = candidates.slice(picked.length);
  // Main TVs need a #1 item when there's no lock.
  if (!a.lockGame && picked.length) a.anchorMode = "main = #1";

  // 4. Share TVs: proportional to strength, ≥1 each, Main TVs to #1, caps on games.
  const capOf = it => (it.kind === "game" ? shareCap(it.game, N) : Infinity);
  let counts = [];
  for (let guard = 0; guard < 10 && picked.length; guard++) {
    const mins = picked.map((it, i) => (i === 0 && !a.lockGame ? A : 1)); // Main TVs show #1 (cap permitting)
    const maxes = picked.map(capOf);
    counts = proportionalSplit(slots, picked.map(it => it.strength), mins, maxes);
    if (counts.reduce((x, y) => x + y, 0) >= slots || !reserve.length) break;
    picked = [...picked, reserve.shift()]; // every pick hit its cap: bring in the next known item
  }

  // Place: Main TVs show #1 (no lock), then the rest round-robin from #2 so items spread out.
  const remaining = counts.slice();
  if (!a.lockGame && picked.length) {
    for (const tv of venue.anchors) {
      if (!isTVFree(a, tv) || remaining[0] <= 0) continue;
      placeItem(a, tv, picked[0]); remaining[0]--;
    }
  }
  const order = picked.length > 1 ? [...picked.keys()].slice(1).concat(0) : [0];
  let cursor = 0;
  for (const tv of free()) {
    let tries = 0;
    while (tries < order.length && !(remaining[order[cursor % order.length]] > 0)) { cursor++; tries++; }
    if (tries >= order.length) break;
    const i = order[cursor % order.length];
    placeItem(a, tv, picked[i]); remaining[i]--; cursor++;
  }
  a.items = [...used, ...picked];

  // 5. Nothing at all known to be on: fall back to the always-available channels.
  const known = a.items.length > 0;
  if (!known) {
    free().forEach((tv, i) => {
      const ch = ALWAYS_AVAILABLE_CHANNELS[i % Math.min(K, ALWAYS_AVAILABLE_CHANNELS.length)];
      a.programming[tv.id] = { channel: ch, show: null, source: "always" };
    });
  }
  // Still free (every known item at its cap): left to the venue.
  free().forEach(tv => { if (!a.programming[tv.id]) a.programming[tv.id] = null; });

  // Repeat markers and anchor history.
  const seen = new Set();
  venue.tvs.forEach(tv => {
    const g = tvMap(a, tv)[tv.id];
    if (!g) return;
    if (seen.has(g.id)) a.repeatMap[tv.id] = true;
    seen.add(g.id);
  });
  Object.values(a.anchors).forEach(g => {
    if (g && !lockedIds.has(g.id) && g.channelScore >= venue.thresholds.blowoutDemotion) history.anchored.add(g.id);
  });
  return a;
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

// Full cycle: availability + tiers → watchable now → locks (identity) → score →
// programTVs. `history` carries anchor/demotion state between cycles.
// opts.programming: an explicit list of {channel, show, priority} airing now
// (golden scenarios); default is the grid in config/programming.js.
function runAssignmentCycle(games, venue, history = createAnchorHistory(), now = new Date(), opts = {}) {
  const classified = games.map(g => ({ ...g, ...classifyGame(g, venue), watchableNow: isWatchableNow(g, now) }));
  const eligibleNow = classified.filter(g => g.tier === "eligible" && g.watchableNow);
  const fillerNow = classified.filter(g => g.tier === "filler" && g.watchableNow);
  const lockPool = eligibleNow.length ? eligibleNow : fillerNow;

  const lockResult = resolveLocks(lockPool, venue);        // before scoring, by identity
  const scored = scoreGames(eligibleNow.length ? eligibleNow : fillerNow, venue);
  const fillerScored = eligibleNow.length ? scoreGames(fillerNow, venue) : [];
  const grid = opts.programming || programmingAiringNow(now, sportsWithGamesToday(games, now));
  const a = programTVs(scored, fillerScored, lockResult, venue, history, now, grid);
  a.poolTier = eligibleNow.length ? "eligible" : fillerNow.length ? "filler" : "none";

  // Everything, for the details view. Unavailable and excluded games are never scored.
  const scoredById = new Map(a.allGames.map(g => [g.id, g]));
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

// Scoring logic
// Calculates Relevance, Vitality, and ChannelScore for each game.
// BaseTeamScore comes from the venue's market lookup (Spec §17.B).

function getBaseTeamScore(teamName, venue) {
  return venue.baseTeamScore(teamName);
}

function calculateMarqueeBonus(game) {
  if (game.sport !== "CFB") return 0;
  if (!game.homeTeamRank || !game.awayTeamRank) return 0;

  const homeRank = parseInt(game.homeTeamRank);
  const awayRank = parseInt(game.awayTeamRank);

  if (homeRank <= 5 && awayRank <= 5) return 6;
  if (homeRank <= 10 && awayRank <= 10) return 4;
  return 0;
}

function getPlayoffMultiplier(game) {
  if (!game.isPlayoff) return 1.0;

  const round = game.playoffRound;
  const multipliers = {
    "wildcard": 1.4,
    "first_round": 1.4,
    "conf_semi": 1.55,
    "conf_finals": 1.75,
    "championship": 2.0
  };

  return multipliers[round] || 1.0;
}

function getSportSeasonWeight(sport) {
  // Simplified for now - all sports at standard weight
  // In production, this would check current month
  const weights = {
    "NFL": 1.3,
    "CFB": 1.1,
    "NHL": 1.0,
    "NBA": 0.9,
    "MLB": 0.85,
    "CBB": 0.85
  };
  return weights[sport] || 1.0;
}

function getStakesModifier(sport, gameNumber, totalGames) {
  // For now, default to mid-season modifier
  // In production, this would calculate based on gameNumber / totalGames
  if (!gameNumber || !totalGames) return 0.80;

  const percentComplete = gameNumber / totalGames;
  if (percentComplete >= 0.80) return 0.95;
  if (percentComplete >= 0.30) return 0.80;
  if (percentComplete >= 0.02) return 0.60;
  return 0.45;
}

function calculateBaseScore(game, venue) {
  // A game uses the higher of its two teams.
  return Math.max(
    getBaseTeamScore(game.homeTeam, venue),
    getBaseTeamScore(game.awayTeam, venue)
  );
}

const WIN_PROBABILITY_FALLBACK = 0.6;

// ---------- National stature floor ----------
const FLOOR_LEAGUES = new Set(["MLB", "NBA", "NHL"]);

function isThanksgivingOrChristmasET(date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .formatToParts(date).reduce((o, x) => (o[x.type] = x.value, o), {});
  if (p.month === "12" && p.day === "25") return true;
  const day = Number(p.day);
  return p.month === "11" && p.weekday === "Thu" && day >= 22 && day <= 28; // 4th Thursday
}

// NFL games only: primetime (or a holiday), on a national channel, no other NFL game overlapping.
function isNflPrimetimeStandalone(game, slate) {
  if (game.sport !== "NFL" || !game.scheduledStartTime) return false;
  if (!(game.nationalChannels || []).some(c => NATIONAL_CHANNEL_SET.has(c))) return false;
  const start = new Date(game.scheduledStartTime);
  const primetime = easternClock(start).minutes >= toMinutes(NFL_PRIMETIME_START_ET) || isThanksgivingOrChristmasET(start);
  if (!primetime) return false;
  const win = NFL_GAME_WINDOW_MINUTES * 60000;
  return !slate.some(o => o.id !== game.id && o.sport === "NFL" && o.scheduledStartTime &&
    Math.abs(new Date(o.scheduledStartTime) - start) < win);
}

// → { floor, reason } for the event, regardless of teams or market.
function nationalFloorOf(game, slate = []) {
  const F = NATIONAL_FLOORS;
  const round = game.playoffRound;
  const headline = String(game.eventName || "");
  const out = [];
  if (game.isPlayoff && round === "championship" && (game.sport === "NFL" || game.sport === "CFB" || FLOOR_LEAGUES.has(game.sport))) out.push([F.championship, "championship"]);
  if (game.sport === "NFL" && game.isPlayoff) out.push([F.nflPlayoff, "NFL playoffs"]);
  if (isNflPrimetimeStandalone(game, slate)) out.push([F.nflPrimetime, "NFL primetime standalone"]);
  if (FLOOR_LEAGUES.has(game.sport) && game.isPlayoff && round === "conf_finals") out.push([F.confFinals, "conference finals"]);
  if (game.sport === "CFB" && game.isPlayoff && /semifinal/i.test(headline)) out.push([F.confFinals, "CFP semifinal"]);
  if (FLOOR_LEAGUES.has(game.sport) && game.isPlayoff && round !== "conf_finals" && round !== "championship") out.push([F.earlyPlayoff, "playoffs"]);
  if (game.sport === "CFB" && game.homeTeamRank && game.awayTeamRank && game.homeTeamRank <= 10 && game.awayTeamRank <= 10) out.push([F.earlyPlayoff, "top-10 vs top-10"]);
  if (game.sport === "NFL") out.push([F.nflOther, "NFL game"]);
  if (!out.length) return { floor: 0, reason: null };
  out.sort((a, b) => b[0] - a[0]);
  return { floor: out[0][0], reason: out[0][1] };
}

function calculateRelevance(game, venue) {
  const baseTeamScore = calculateBaseScore(game, venue);

  const marqueeBonus = calculateMarqueeBonus(game);
  const playoffMult = getPlayoffMultiplier(game);
  const seasonWeight = getSportSeasonWeight(game.sport);
  const stakesMod = getStakesModifier(game.sport, game.gameNumber, game.totalGames);

  const localRelevance = Math.min((baseTeamScore + marqueeBonus) * playoffMult * seasonWeight * stakesMod, 100);
  // National stature floor: set per game by runAssignmentCycle (needs the whole slate).
  return Math.max(localRelevance, game.nationalFloor || 0);
}

function getGamePhaseWeight(game, now = new Date()) {
  const phase = game.gamePhase;

  // Check if pre-game
  if (phase === 0) {
    const minutesUntilStart = (game.scheduledStartTime ?
      (new Date(game.scheduledStartTime).getTime() - now.getTime()) / 60000 : 30);

    if (minutesUntilStart > 30) return 0.4;
    if (minutesUntilStart > 0) return 0.6;
  }

  // Final
  if (game.gameStatus === "final") return 0.0;

  // Game phase weights
  if (phase < 0.30) return 0.75;
  if (phase < 0.70) return 1.0;
  if (phase < 0.90) return 1.3;
  return 1.6; // Clutch window
}

function getPointInGameMultiplier(game) {
  const phase = game.gamePhase;
  const scoreDiff = Math.abs(game.homeScore - game.awayScore);

  // Define blowout threshold by sport
  const blowoutThresholds = {
    "NFL": 17,
    "CFB": 17,
    "NBA": 15,
    "NHL": 3,
    "MLB": 4
  };

  const threshold = blowoutThresholds[game.sport] || 15;
  const isBlowout = scoreDiff >= threshold;
  const isCompetitive = scoreDiff <= 5;

  // Early game
  if (phase < 0.30) {
    return isBlowout ? 0.3 : (isCompetitive ? 0.6 : 0.45);
  }

  // Mid game
  if (phase < 0.70) {
    return isBlowout ? 0.65 : (isCompetitive ? 1.0 : 0.75);
  }

  // Late game
  if (phase < 0.90) {
    return isBlowout ? 0.4 : (isCompetitive ? 1.35 : 0.9);
  }

  // Clutch window
  if (scoreDiff === 0) return 1.7;
  if (scoreDiff <= 7) return 1.1;
  return 0.25;
}

function getOvertimeBonus(game) {
  if (game.gameStatus === "overtime" || game.gameStatus === "extra_innings") {
    return 1.4;
  }
  return 1.0;
}

function calculateVitality(game, now = new Date()) {
  // BaseTension from win probability
  // Spec §5.1 fallback: no win probability → treat as 0.6 for the favorite (BaseTension 80),
  // not a 50/50 game.
  let baseTension = 100 - (Math.abs(WIN_PROBABILITY_FALLBACK - 0.5) * 200);
  if (game.winProbability !== null && game.winProbability !== undefined) {
    baseTension = 100 - (Math.abs(game.winProbability - 0.5) * 200);
  }

  const gamePhaseWeight = getGamePhaseWeight(game, now);
  const pointInGameMult = getPointInGameMultiplier(game);
  const overtimeBonus = getOvertimeBonus(game);

  const competitiveTension = baseTension * gamePhaseWeight * pointInGameMult;
  const vitality = competitiveTension * overtimeBonus;

  return Math.min(vitality, 100);
}

function combineChannelScore(relevance, vitality) {
  const score = (relevance * 0.4) + (vitality * 0.4) + ((relevance * vitality / 100) * 0.2);
  return Math.min(Math.max(score, 0), 100);
}

function calculateChannelScore(game, venue, now = new Date()) {
  return combineChannelScore(calculateRelevance(game, venue), calculateVitality(game, now));
}

// `now` = the moment being scored (the cycle's clock), never the wall clock.
function scoreGames(games, venue, now = new Date()) {
  return games.map(game => {
    const relevance = calculateRelevance(game, venue);
    const vitality = calculateVitality(game, now);
    return {
      ...game,
      baseScore: calculateBaseScore(game, venue),
      relevance,
      vitality,
      channelScore: combineChannelScore(relevance, vitality)
    };
  });
}

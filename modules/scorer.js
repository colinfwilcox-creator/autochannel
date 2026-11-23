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

function calculateRelevance(game, venue) {
  const baseTeamScore = calculateBaseScore(game, venue);

  const marqueeBonus = calculateMarqueeBonus(game);
  const playoffMult = getPlayoffMultiplier(game);
  const seasonWeight = getSportSeasonWeight(game.sport);
  const stakesMod = getStakesModifier(game.sport, game.gameNumber, game.totalGames);

  const relevance = (baseTeamScore + marqueeBonus) * playoffMult * seasonWeight * stakesMod;
  return Math.min(relevance, 100);
}

function getGamePhaseWeight(game) {
  const phase = game.gamePhase;

  // Check if pre-game
  if (phase === 0) {
    const minutesUntilStart = (game.scheduledStartTime ?
      (new Date(game.scheduledStartTime).getTime() - Date.now()) / 60000 : 30);

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

function calculateVitality(game) {
  // BaseTension from win probability
  let baseTension = 100;
  if (game.winProbability !== null && game.winProbability !== undefined) {
    baseTension = 100 - (Math.abs(game.winProbability - 0.5) * 200);
  }

  const gamePhaseWeight = getGamePhaseWeight(game);
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

function calculateChannelScore(game, venue) {
  return combineChannelScore(calculateRelevance(game, venue), calculateVitality(game));
}

function scoreGames(games, venue) {
  return games.map(game => {
    const relevance = calculateRelevance(game, venue);
    const vitality = calculateVitality(game);
    return {
      ...game,
      baseScore: calculateBaseScore(game, venue),
      relevance,
      vitality,
      channelScore: combineChannelScore(relevance, vitality)
    };
  });
}

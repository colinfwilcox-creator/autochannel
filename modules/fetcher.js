// Phase 1: Data fetcher
// Fetches live games from ESPN and normalizes to game object shape

const ENDPOINTS = {
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  CFB: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
  CBB: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard"
};

const SPORT_MAP = {
  "football/nfl": "NFL",
  "hockey/nhl": "NHL",
  "baseball/mlb": "MLB",
  "basketball/nba": "NBA",
  "football/college-football": "CFB",
  "basketball/mens-college-basketball": "CBB"
};

function calculateGamePhase(game, sport) {
  if (game.status === "pre" || game.status === "scheduled") {
    return 0;
  }
  if (game.status === "final" || game.status === "completed") {
    return 1.0;
  }

  const clockStr = game.clock || "0:00";
  const period = game.period || 0;

  // Parse MM:SS from clock string
  const [minutes, seconds] = clockStr.split(":").map(Number);
  const totalSecondsRemaining = (minutes || 0) * 60 + (seconds || 0);
  const minutesRemaining = totalSecondsRemaining / 60;

  let gamePhase = 0;

  if (sport === "NFL" || sport === "CFB") {
    // 4 quarters × 15 minutes = 60 minutes total
    gamePhase = ((period - 1) * 15 + (15 - minutesRemaining)) / 60;
  } else if (sport === "NHL") {
    // 3 periods × 20 minutes = 60 minutes total
    gamePhase = ((period - 1) * 20 + (20 - minutesRemaining)) / 60;
  } else if (sport === "NBA") {
    // 4 quarters × 12 minutes = 48 minutes total
    gamePhase = ((period - 1) * 12 + (12 - minutesRemaining)) / 48;
  } else if (sport === "MLB") {
    // 9 innings
    const inning = period || 1;
    gamePhase = (inning - 1) / 9;
  }

  return Math.min(Math.max(gamePhase, 0), 1.0);
}

function normalizeGame(espnGame, sport) {
  const homeTeam = espnGame.competitors?.find(c => c.homeAway === "home");
  const awayTeam = espnGame.competitors?.find(c => c.homeAway === "away");

  const gameStatus = espnGame.status?.type?.name || "unknown";
  const statusMap = {
    "STATUS_SCHEDULED": "scheduled",
    "STATUS_PRE": "pre_game",
    "STATUS_IN_PROGRESS": "in_progress",
    "STATUS_HALFTIME": "halftime",
    "STATUS_END_PERIOD": "end_period",
    "STATUS_FINAL": "final",
    "STATUS_FINAL_CONFIRMED": "final",
    "STATUS_FORFEIT": "final",
    "STATUS_POSTPONED": "postponed",
    "STATUS_CANCELED": "canceled",
    "STATUS_DELAYED": "delayed",
    "STATUS_SUSPENSION": "delayed"
  };

  const normalizedStatus = statusMap[espnGame.status?.type?.name] || "unknown";

  const gameClock = espnGame.status?.displayClock || "0:00";
  const period = espnGame.status?.period || 0;
  const gamePhase = calculateGamePhase(espnGame, sport);

  // Check for playoff status
  const isPlayoff = espnGame.isPlayoff || false;
  const playoffRound = espnGame.playoffRound?.short || null;

  // Determine playoff round name from short code if available
  let playoffRoundName = null;
  if (isPlayoff && playoffRound) {
    const roundMap = {
      "WC": "wildcard",
      "DIV": "first_round",
      "CONF": "conf_semi",
      "CONF_CHAMP": "conf_finals",
      "SB": "championship",
      "WS": "championship"
    };
    playoffRoundName = roundMap[playoffRound] || playoffRound.toLowerCase();
  }

  const game = {
    id: espnGame.id ? `espn_${espnGame.id}` : "unknown",
    sport: sport,
    homeTeam: homeTeam?.team?.name || homeTeam?.displayName || "Unknown",
    awayTeam: awayTeam?.team?.name || awayTeam?.displayName || "Unknown",
    homeTeamRank: homeTeam?.statistics?.find(s => s.name === "rank")?.value || null,
    awayTeamRank: awayTeam?.statistics?.find(s => s.name === "rank")?.value || null,
    homeScore: homeTeam?.score ? parseInt(homeTeam.score) : 0,
    awayScore: awayTeam?.score ? parseInt(awayTeam.score) : 0,
    gameStatus: normalizedStatus,
    period: period,
    gameClock: gameClock,
    gamePhase: gamePhase,
    isPlayoff: isPlayoff,
    playoffRound: playoffRoundName,
    gameNumber: espnGame.gameNumber || null,
    totalGames: espnGame.totalGames || null,
    winProbability: null,
    scheduledStartTime: espnGame.date || null
  };

  return game;
}

async function fetchGames() {
  const allGames = [];
  const errors = [];

  for (const [sport, url] of Object.entries(ENDPOINTS)) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        errors.push(`${sport}: ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      const events = data.events || [];

      for (const event of events) {
        const normalized = normalizeGame(event, sport);
        allGames.push(normalized);
      }
    } catch (err) {
      errors.push(`${sport}: ${err.message}`);
    }
  }

  return {
    games: allGames,
    errors: errors,
    timestamp: new Date().toISOString(),
    count: allGames.length
  };
}

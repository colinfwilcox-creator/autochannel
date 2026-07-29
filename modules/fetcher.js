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

// Mock data for Phase 1 testing (REMOVE after live API integration)
function generateMockGames() {
  const now = new Date();
  const mockGames = [
    // Washington Capitals vs Pittsburgh Penguins (Lock list team, in progress)
    {
      id: "espn_401465001",
      sport: "NHL",
      homeTeam: "Washington Capitals",
      awayTeam: "Pittsburgh Penguins",
      homeTeamRank: null,
      awayTeamRank: null,
      homeScore: 3,
      awayScore: 2,
      gameStatus: "in_progress",
      period: 2,
      gameClock: "8:34",
      gamePhase: 0.48,
      isPlayoff: false,
      playoffRound: null,
      gameNumber: null,
      totalGames: null,
      winProbability: 0.55,
      scheduledStartTime: new Date(now.getTime() - 90 * 60000).toISOString()
    },
    // Washington Commanders vs Dallas Cowboys (Lock list team, in progress)
    {
      id: "espn_401465002",
      sport: "NFL",
      homeTeam: "Washington Commanders",
      awayTeam: "Dallas Cowboys",
      homeTeamRank: null,
      awayTeamRank: null,
      homeScore: 17,
      awayScore: 14,
      gameStatus: "in_progress",
      period: 3,
      gameClock: "4:22",
      gamePhase: 0.62,
      isPlayoff: false,
      playoffRound: null,
      gameNumber: null,
      totalGames: null,
      winProbability: 0.58,
      scheduledStartTime: new Date(now.getTime() - 120 * 60000).toISOString()
    },
    // New York Yankees vs Boston Red Sox (High relevance for premium teams)
    {
      id: "espn_401465003",
      sport: "MLB",
      homeTeam: "Boston Red Sox",
      awayTeam: "New York Yankees",
      homeTeamRank: null,
      awayTeamRank: null,
      homeScore: 4,
      awayScore: 3,
      gameStatus: "in_progress",
      period: 7,
      gameClock: "0:00",
      gamePhase: 0.76,
      isPlayoff: false,
      playoffRound: null,
      gameNumber: 110,
      totalGames: 162,
      winProbability: 0.52,
      scheduledStartTime: new Date(now.getTime() - 180 * 60000).toISOString()
    },
    // Boston Celtics vs Miami Heat (NBA)
    {
      id: "espn_401465004",
      sport: "NBA",
      homeTeam: "Boston Celtics",
      awayTeam: "Miami Heat",
      homeTeamRank: null,
      awayTeamRank: null,
      homeScore: 68,
      awayScore: 65,
      gameStatus: "in_progress",
      period: 2,
      gameClock: "3:45",
      gamePhase: 0.36,
      isPlayoff: false,
      playoffRound: null,
      gameNumber: 42,
      totalGames: 82,
      winProbability: 0.53,
      scheduledStartTime: new Date(now.getTime() - 60 * 60000).toISOString()
    },
    // Ohio State vs Michigan State (College Football)
    {
      id: "espn_401465005",
      sport: "CFB",
      homeTeam: "Ohio State",
      awayTeam: "Michigan State",
      homeTeamRank: 4,
      awayTeamRank: 18,
      homeScore: 28,
      awayScore: 21,
      gameStatus: "in_progress",
      period: 4,
      gameClock: "2:15",
      gamePhase: 0.88,
      isPlayoff: false,
      playoffRound: null,
      gameNumber: null,
      totalGames: null,
      winProbability: 0.72,
      scheduledStartTime: new Date(now.getTime() - 210 * 60000).toISOString()
    },
    // Georgetown vs Villanova (College Basketball)
    {
      id: "espn_401465006",
      sport: "CBB",
      homeTeam: "Georgetown",
      awayTeam: "Villanova",
      homeTeamRank: null,
      awayTeamRank: null,
      homeScore: 52,
      awayScore: 48,
      gameStatus: "in_progress",
      period: 2,
      gameClock: "8:12",
      gamePhase: 0.42,
      isPlayoff: false,
      playoffRound: null,
      gameNumber: null,
      totalGames: null,
      winProbability: 0.54,
      scheduledStartTime: new Date(now.getTime() - 30 * 60000).toISOString()
    }
  ];

  return {
    games: mockGames,
    errors: [],
    timestamp: now.toISOString(),
    count: mockGames.length
  };
}

async function fetchGames() {
  // PHASE 1: Return mock data
  // TODO: Replace with live ESPN API calls after testing
  return generateMockGames();
}

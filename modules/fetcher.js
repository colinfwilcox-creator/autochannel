// Data fetcher
// Live: ESPN scoreboards through the Cloudflare Worker proxy (config/live.js).
// Mock: scenario presets below. Live never falls back to mock silently.

// ---------- Display helpers ----------

function parseInningHalf(detail) {
  if (!detail) return null;
  const d = detail.toLowerCase();
  if (d.startsWith("top")) return "top";
  if (d.startsWith("bot")) return "bottom";
  if (d.startsWith("mid")) return "middle";
  if (d.startsWith("end")) return "end";
  return null;
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
}

// Clock text for the TV card. MLB shows the inning instead of a clock (§17.A.5).
function formatGameClock(game) {
  if (game.gameStatus === "scheduled" || game.gameStatus === "pre_game") {
    if (!game.scheduledStartTime) return "Scheduled";
    return new Date(game.scheduledStartTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (game.statusDetail) return game.statusDetail; // live ESPN text: "4:22 - 3rd", "Halftime", "Top 7th"
  if (game.sport === "MLB") {
    const half = { top: "Top", bottom: "Bot", middle: "Mid", end: "End" }[game.inningHalf] || "Inning";
    return game.period ? `${half} ${ordinal(game.period)}` : "—";
  }
  return game.gameClock;
}

// Short team name for the compact rows ("Commanders", "Ohio State").
function shortTeamName(game, side) {
  const short = side === "home" ? game.homeShort : game.awayShort;
  if (short) return short;
  const full = side === "home" ? game.homeTeam : game.awayTeam;
  const words = String(full).split(" ");
  return words.length > 1 ? words[words.length - 1] : full;
}

// Compact clock for the simple screen: "Q2 4:12", "P3 8:01", "H2 3:41", "Top 7th", "Half".
function formatCompactClock(game) {
  const s = game.gameStatus;
  if (s === "halftime") return "Half";
  if (game.sport === "MLB") {
    const half = { top: "Top", bottom: "Bot", middle: "Mid", end: "End" }[game.inningHalf];
    if (half && game.period) return `${half} ${ordinal(game.period)}`;
    return game.statusDetail || (game.period ? ordinal(game.period) : "");
  }
  const prefix = { NFL: "Q", CFB: "Q", NBA: "Q", CBB: "H", NHL: "P" }[game.sport] || "";
  const reg = { NFL: 4, CFB: 4, NBA: 4, CBB: 2, NHL: 3 }[game.sport];
  const p = game.period;
  if (!p) return game.statusDetail || "";
  const label = reg && p > reg ? (p - reg > 1 ? `${p - reg}OT` : "OT") : `${prefix}${p}`;
  if (s === "end_period") return `End ${label}`;
  return game.gameClock && game.gameClock !== "0:00" ? `${label} ${game.gameClock}` : label;
}

function formatStartTime(game) {
  if (!game.scheduledStartTime) return "";
  return new Date(game.scheduledStartTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ---------- ESPN normalization ----------

// Regulation length per sport: periods and minutes per period.
const REGULATION = {
  NFL: { periods: 4, minutes: 15 },
  CFB: { periods: 4, minutes: 15 },
  NBA: { periods: 4, minutes: 12 },
  CBB: { periods: 2, minutes: 20 },
  NHL: { periods: 3, minutes: 20 },
  MLB: { periods: 9, minutes: null }
};

const ESPN_STATUS_MAP = {
  STATUS_SCHEDULED: "scheduled",
  STATUS_PRE: "pre_game",
  STATUS_IN_PROGRESS: "in_progress",
  STATUS_FIRST_HALF: "in_progress",
  STATUS_SECOND_HALF: "in_progress",
  STATUS_HALFTIME: "halftime",
  STATUS_END_PERIOD: "end_period",
  STATUS_END_OF_PERIOD: "end_period",
  STATUS_OVERTIME: "overtime",
  STATUS_RAIN_DELAY: "delayed",
  STATUS_DELAYED: "delayed",
  STATUS_SUSPENDED: "delayed",
  STATUS_FINAL: "final",
  STATUS_FINAL_OT: "final",
  STATUS_FINAL_PEN: "final",
  STATUS_FULL_TIME: "final",
  STATUS_FORFEIT: "final",
  STATUS_POSTPONED: "postponed",
  STATUS_CANCELED: "canceled"
};

class NormalizationError extends Error {}

function parseClockMinutes(displayClock) {
  if (!displayClock || typeof displayClock !== "string") return null;
  const m = displayClock.match(/^(\d+):(\d{1,2})(?:\.\d+)?$/) || displayClock.match(/^(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  if (m.length === 3) return Number(m[1]) + Number(m[2]) / 60;
  return Number(m[1]) / 60; // "45.3" = seconds remaining
}

// 0 before the start, 1 at the end, otherwise fraction of regulation elapsed (capped at 1 in OT).
function calculateGamePhase(sport, state, period, displayClock) {
  if (state === "pre") return 0;
  if (state === "post") return 1.0;
  const reg = REGULATION[sport];
  if (!reg || !period) return 0;
  if (sport === "MLB") return Math.min(Math.max((period - 1) / 9, 0), 1);
  if (period > reg.periods) return 1.0;
  const remaining = parseClockMinutes(displayClock);
  const minsLeft = remaining === null ? reg.minutes / 2 : remaining;
  const elapsed = (period - 1) * reg.minutes + (reg.minutes - minsLeft);
  return Math.min(Math.max(elapsed / (reg.periods * reg.minutes), 0), 1);
}

function playoffRoundFromHeadline(headline) {
  const h = (headline || "").toLowerCase();
  if (!h) return null;
  if (h.includes("conference final")) return "conf_finals";
  if (/super bowl|world series|stanley cup final|nba finals|national championship/.test(h)) return "championship";
  if (/championship|alcs|nlcs/.test(h)) return "conf_finals";
  if (/divisional|semifinal|second round|division series|alds|nlds/.test(h)) return "conf_semi";
  if (/wild card|wild-card|first round/.test(h)) return "first_round";
  return null;
}

// Broadcasts → { nationalChannels, regionalChannels: [{channel, side, team}], streaming }.
// Prefers geoBroadcasts (typed: TV / Streaming / Radio); falls back to broadcasts.
function parseBroadcasts(comp, homeName, awayName) {
  const national = [], regional = [], streaming = [];
  const teamFor = side => (side === "home" ? homeName : awayName);
  const add = (rawName, marketType, kind) => {
    if (!rawName) return;
    const channel = canonicalChannel(rawName);
    if (kind && kind !== "TV") { if (kind === "Streaming") streaming.push(channel); return; }
    if (isStreamingName(channel)) { streaming.push(channel); return; }
    const m = String(marketType || "").toLowerCase();
    if (m === "home" || m === "away") {
      if (!regional.some(r => r.channel === channel && r.side === m)) regional.push({ channel, side: m, team: teamFor(m) });
    } else if (!national.includes(channel)) {
      national.push(channel);
    }
  };
  if (Array.isArray(comp.geoBroadcasts) && comp.geoBroadcasts.length) {
    comp.geoBroadcasts.forEach(b => add(b.media && b.media.shortName, b.market && b.market.type, b.type && b.type.shortName));
  } else {
    (comp.broadcasts || []).forEach(b => (b.names || []).forEach(n => add(n, b.market, null)));
  }
  return { nationalChannels: national, regionalChannels: regional, streaming };
}

// Returns { game, warnings }. Throws NormalizationError with a reason when a
// required field is missing, so the caller can report it instead of guessing.
function normalizeEspnEvent(event, sport) {
  const warnings = [];
  if (!event || !event.id) throw new NormalizationError("missing event id");
  const comp = event.competitions && event.competitions[0];
  if (!comp) throw new NormalizationError("no competitions[0]");
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === "home");
  const away = competitors.find(c => c.homeAway === "away");
  if (!home || !away) throw new NormalizationError(`expected home and away competitors, got ${competitors.length}`);
  const homeName = home.team && home.team.displayName;
  const awayName = away.team && away.team.displayName;
  if (!homeName || !awayName) throw new NormalizationError("competitor missing team.displayName");

  const status = event.status || comp.status;
  const type = status && status.type;
  if (!type || !type.state) throw new NormalizationError("missing status.type.state");

  let gameStatus = ESPN_STATUS_MAP[type.name];
  if (!gameStatus) {
    gameStatus = { pre: "scheduled", in: "in_progress", post: "final" }[type.state] || "unknown";
    warnings.push(`unmapped status ${type.name}, used state "${type.state}" → ${gameStatus}`);
  }

  const period = Number(status.period) || 0;
  const reg = REGULATION[sport];
  if (type.state === "in" && reg && period > reg.periods) {
    gameStatus = sport === "MLB" ? "extra_innings" : "overtime";
  }

  const parseScore = c => {
    if (type.state === "pre") return 0;
    const n = parseInt(c.score, 10);
    if (Number.isNaN(n)) { warnings.push(`unparseable score "${c.score}" for ${c.team.displayName}`); return 0; }
    return n;
  };
  const rankOf = c => {
    const r = c.curatedRank && c.curatedRank.current;
    return r && r < 99 ? r : null; // ESPN uses 99 for unranked
  };

  const headline = (comp.notes || []).map(n => n.headline).filter(Boolean).join(" · ");
  const isPlayoff = !!(event.season && event.season.type === 3);
  let playoffRound = null;
  if (isPlayoff) {
    playoffRound = playoffRoundFromHeadline(headline);
    if (!playoffRound) warnings.push(`postseason round unknown ("${headline || "no headline"}"), multiplier 1.0`);
  }

  const tv = parseBroadcasts(comp, homeName, awayName);
  const prob = comp.situation && comp.situation.lastPlay && comp.situation.lastPlay.probability;
  const winProbability = prob && typeof prob.homeWinPercentage === "number" ? prob.homeWinPercentage : null;

  return {
    warnings,
    game: {
      id: `espn_${event.id}`,
      sport,
      homeTeam: homeName,
      awayTeam: awayName,
      homeShort: home.team.shortDisplayName || homeName,
      awayShort: away.team.shortDisplayName || awayName,
      homeConferenceId: home.team.conferenceId != null ? String(home.team.conferenceId) : null,
      awayConferenceId: away.team.conferenceId != null ? String(away.team.conferenceId) : null,
      homeTeamRank: rankOf(home),
      awayTeamRank: rankOf(away),
      homeScore: parseScore(home),
      awayScore: parseScore(away),
      gameStatus,
      espnState: type.state,
      period,
      gameClock: status.displayClock || "0:00",
      statusDetail: type.shortDetail || type.detail || "",
      inningHalf: sport === "MLB" ? parseInningHalf(type.shortDetail) : null,
      gamePhase: calculateGamePhase(sport, type.state, period, status.displayClock),
      isPlayoff,
      playoffRound,
      eventName: /super bowl/i.test(headline) ? "Super Bowl" : (headline || null),
      gameNumber: null,
      totalGames: null,
      winProbability,
      scheduledStartTime: event.date || null,
      // Channels. `channel` = first listed national TV channel; `regionalChannel` = first
      // local channel with the team whose market it serves. Availability per market
      // is decided later (modules/eligibility.js).
      nationalChannels: tv.nationalChannels,
      regionalChannels: tv.regionalChannels,
      streamingChannels: tv.streaming,
      channel: tv.nationalChannels[0] || null,
      regionalChannel: tv.regionalChannels[0] || null
    }
  };
}

// Today's US Eastern date as YYYYMMDD (ESPN's scoreboard day).
function easternDateStamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  return `${get("year")}${get("month")}${get("day")}`;
}

function leagueUrl(league, now = new Date()) {
  const url = new URL(`${PROXY_BASE_URL.replace(/\/+$/, "")}/scoreboard/${league.path}`);
  Object.entries(league.params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  if (league.datesToday) url.searchParams.set("dates", easternDateStamp(now));
  return url.toString();
}

// In progress, or starting within the window. Finals / postponed / canceled are dropped.
function isRelevantLiveGame(game, now = new Date()) {
  if (game.espnState === "in") return true;
  if (game.espnState !== "pre") return false;
  if (game.gameStatus === "postponed" || game.gameStatus === "canceled") return false;
  if (!game.scheduledStartTime) return false;
  const hours = (new Date(game.scheduledStartTime).getTime() - now.getTime()) / 3600000;
  return hours <= LIVE_UPCOMING_WINDOW_HOURS;
}

function normalizeLeaguePayload(json, league, now = new Date()) {
  const events = Array.isArray(json && json.events) ? json.events : null;
  if (!events) throw new Error("response has no events array");
  const games = [], failures = [], warnings = [];
  let filteredOut = 0;
  for (const ev of events) {
    try {
      const { game, warnings: w } = normalizeEspnEvent(ev, league.sport);
      w.forEach(msg => warnings.push({ id: ev.id, name: ev.name, message: msg }));
      if (isRelevantLiveGame(game, now)) games.push(game); else filteredOut++;
    } catch (err) {
      if (!(err instanceof NormalizationError)) throw err;
      failures.push({ id: ev && ev.id, name: ev && ev.name, reason: err.message });
    }
  }
  return { sport: league.sport, returned: events.length, games, filteredOut, failures, warnings };
}

async function fetchLeague(league, now) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), LIVE_FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(leagueUrl(league, now), controller ? { signal: controller.signal } : {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeLeaguePayload(await res.json(), league, now);
  } catch (err) {
    throw new Error(err.name === "AbortError" ? `timed out after ${LIVE_FETCH_TIMEOUT_MS / 1000}s` : err.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Last good result per league, so one failing league doesn't blank the others.
const lastGoodLeague = {};

// Never returns mock data. Throws only if every league failed and none has earlier data.
async function fetchLiveGames(now = new Date()) {
  if (!PROXY_BASE_URL) throw new Error("PROXY_BASE_URL is empty in config/live.js");
  const results = await Promise.allSettled(LIVE_LEAGUES.map(l => fetchLeague(l, now)));
  const leagues = [], errors = [];
  let anyFresh = false;
  results.forEach((r, i) => {
    const sport = LIVE_LEAGUES[i].sport;
    if (r.status === "fulfilled") {
      lastGoodLeague[sport] = { ...r.value, fetchedAt: now.toISOString() };
      leagues.push({ ...r.value, stale: false });
      anyFresh = true;
    } else {
      errors.push({ sport, message: r.reason.message });
      if (lastGoodLeague[sport]) leagues.push({ ...lastGoodLeague[sport], stale: true });
    }
  });
  if (!anyFresh && !leagues.length) {
    const err = new Error(`all ${LIVE_LEAGUES.length} leagues failed: ${errors.map(e => `${e.sport} ${e.message}`).join("; ")}`);
    err.leagueErrors = errors;
    throw err;
  }
  return {
    source: "live",
    games: leagues.flatMap(l => l.games),
    leagues,
    errors,
    timestamp: now.toISOString(),
    count: leagues.reduce((n, l) => n + l.games.length, 0)
  };
}

// ---------- Mock data ----------
// Scenarios: "tuesday" (default DC weeknight), "dc-playoff", "two-locks", "super-bowl".
const MOCK_SCENARIOS = {
  "tuesday": "DC Tuesday night",
  "dc-playoff": "Capitals playoff game (no Commanders)",
  "two-locks": "Commanders + Capitals playoff at once",
  "super-bowl": "Commanders in the Super Bowl"
};

function generateMockGames(scenario = "tuesday") {
  const now = new Date();
  const mockGames = [
    // Washington Capitals vs Pittsburgh Penguins (Lock list team, in progress)
    {
      id: "espn_401465001",
      sport: "NHL",
      homeTeam: "Washington Capitals",
      nationalChannels: [],
      regionalChannels: [{ channel: "Monumental Sports Network", side: "home", team: "Washington Capitals" }],
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
      nationalChannels: ["ESPN"],
      regionalChannels: [],
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
      nationalChannels: ["MLB Network"],
      regionalChannels: [{ channel: "NESN", side: "home", team: "Boston Red Sox" }],
      awayTeam: "New York Yankees",
      homeTeamRank: null,
      awayTeamRank: null,
      homeScore: 4,
      awayScore: 3,
      gameStatus: "in_progress",
      period: 7,
      inningHalf: "top",
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
      nationalChannels: ["NBA TV"],
      regionalChannels: [],
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
      homeTeam: "Ohio State Buckeyes",
      nationalChannels: ["FOX"],
      regionalChannels: [],
      awayTeam: "Michigan State Spartans",
      homeShort: "Ohio State",
      awayShort: "Michigan St",
      homeConferenceId: "5",
      awayConferenceId: "5",
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
      homeTeam: "Georgetown Hoyas",
      nationalChannels: ["FS1"],
      regionalChannels: [],
      awayTeam: "Villanova Wildcats",
      homeShort: "Georgetown",
      awayShort: "Villanova",
      homeConferenceId: "4",
      awayConferenceId: "4",
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

  let games = mockGames;
  const caps = games.find(g => g.homeTeam === "Washington Capitals");
  const commanders = games.find(g => g.homeTeam === "Washington Commanders");
  if (scenario === "dc-playoff" || scenario === "two-locks") {
    Object.assign(caps, { isPlayoff: true, playoffRound: "conf_semi" });
  }
  if (scenario === "dc-playoff") {
    games = games.filter(g => g !== commanders);
  }
  if (scenario === "super-bowl") {
    Object.assign(commanders, {
      awayTeam: "Kansas City Chiefs", isPlayoff: true, playoffRound: "championship", eventName: "Super Bowl"
    });
  }

  games = games.map(g => ({ ...g, channel: g.nationalChannels[0] || null, regionalChannel: g.regionalChannels[0] || null }));
  return {
    games,
    errors: [],
    timestamp: now.toISOString(),
    count: games.length
  };
}

// mode: "live" | "mock". Live errors propagate to the caller; there is no mock fallback.
async function fetchGames(scenario, mode = "mock") {
  if (mode === "live") return fetchLiveGames();
  return { source: "mock", ...generateMockGames(scenario) };
}

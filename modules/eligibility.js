// Eligibility + watchability (Phase 5). Runs BEFORE scoring.
//
// Availability runs first (Phase 6): a game a bar can't tune to is tier
// "unavailable" and never reaches the tiers below.
//
// Tiers:
//   eligible — every NFL/NBA/NHL/MLB game; any game with a team in the market's
//              team table; any game with a ranked (top-25) college team; any game
//              with a national program.
//   filler   — unranked college games where BOTH teams are Power-conference
//              (ACC, Big Ten, Big 12, SEC; + Big East in men's basketball;
//              Notre Dame counts as Power). Fills TVs after eligible games reach
//              their share caps (Phase 6 fill order).
//   excluded — everything else. Never scored, never on the default screen.

const PRO_SPORTS = new Set(["NFL", "NBA", "NHL", "MLB"]);
const RANKED_MAX = 25;
const WATCHABLE_LEAD_MINUTES = 30;

// ESPN conference IDs (competitor.team.conferenceId), checked against live payloads.
const POWER_CONFERENCES = {
  CFB: { "1": "ACC", "4": "Big 12", "5": "Big Ten", "8": "SEC" },
  CBB: { "2": "ACC", "4": "Big East", "7": "Big Ten", "8": "Big 12", "23": "SEC" }
};
const POWER_INDEPENDENTS = new Set(["Notre Dame Fighting Irish"]);

function isRanked(rank) {
  return rank != null && Number(rank) >= 1 && Number(rank) <= RANKED_MAX;
}

function isPowerTeam(sport, teamName, conferenceId) {
  if (POWER_INDEPENDENTS.has(teamName)) return true;
  const confs = POWER_CONFERENCES[sport];
  return !!(confs && conferenceId != null && confs[String(conferenceId)]);
}

// → { available, channel, channelSource: "national" | "regional", reason }
function availabilityOf(game, venue) {
  const national = (game.nationalChannels || []).find(c => NATIONAL_CHANNEL_SET.has(c));
  if (national) return { available: true, channel: national, channelSource: "national" };
  const rsns = (venue.market && venue.market.rsns) || [];
  const local = (game.regionalChannels || []).find(r => rsns.includes(r.channel));
  if (local) return { available: true, channel: local.channel, channelSource: "regional" };

  const on = [
    ...(game.nationalChannels || []).map(c => `${c} (not on the national list)`),
    ...(game.regionalChannels || []).map(r => `${r.channel} (${r.team} local)`),
    ...(game.streamingChannels || []).map(c => `${c} (streaming)`)
  ];
  return { available: false, channel: null, channelSource: null, reason: on.length ? `on ${on.join(", ")}` : "no TV listed" };
}

// → { tier: "unavailable" | "eligible" | "filler" | "excluded", tierReason, displayChannel, channelSource }
function classifyGame(game, venue) {
  const a = availabilityOf(game, venue);
  if (!a.available) return { tier: "unavailable", tierReason: `not available in market: ${a.reason}`, displayChannel: null, channelSource: null };
  const t = classifyTier(game, venue);
  return { ...t, displayChannel: a.channel, channelSource: a.channelSource };
}

function classifyTier(game, venue) {
  if (PRO_SPORTS.has(game.sport)) return { tier: "eligible", tierReason: `${game.sport} game` };

  const table = venue.teamTable || {};
  const local = [game.homeTeam, game.awayTeam].find(t => t in table);
  if (local) return { tier: "eligible", tierReason: `${local} is in the ${venue.marketName} table` };

  if (isRanked(game.homeTeamRank) || isRanked(game.awayTeamRank)) {
    const r = isRanked(game.awayTeamRank) ? `${game.awayTeam} #${game.awayTeamRank}` : `${game.homeTeam} #${game.homeTeamRank}`;
    return { tier: "eligible", tierReason: `ranked: ${r}` };
  }

  const national = [game.homeTeam, game.awayTeam].find(t => NATIONAL_PROGRAMS.includes(t));
  if (national) return { tier: "eligible", tierReason: `${national} is a national program` };

  const homePower = isPowerTeam(game.sport, game.homeTeam, game.homeConferenceId);
  const awayPower = isPowerTeam(game.sport, game.awayTeam, game.awayConferenceId);
  if (homePower && awayPower) return { tier: "filler", tierReason: "unranked Power vs Power" };

  return { tier: "excluded", tierReason: homePower || awayPower ? "only one Power team" : "no Power team" };
}

const NOT_ON_TV_STATUSES = new Set(["final", "postponed", "canceled"]);

// In progress, or starting within 30 minutes (including a start that is late).
function isWatchableNow(game, now = new Date()) {
  if (NOT_ON_TV_STATUSES.has(game.gameStatus)) return false;
  const scheduled = game.gameStatus === "scheduled" || game.gameStatus === "pre_game" || game.espnState === "pre";
  if (!scheduled) return true;
  if (!game.scheduledStartTime) return false;
  const mins = (new Date(game.scheduledStartTime).getTime() - now.getTime()) / 60000;
  return mins <= WATCHABLE_LEAD_MINUTES;
}

// Starts later than the watchable window, on the viewer's local calendar day.
function isLaterToday(game, now = new Date()) {
  if (NOT_ON_TV_STATUSES.has(game.gameStatus) || !game.scheduledStartTime) return false;
  if (isWatchableNow(game, now)) return false;
  const start = new Date(game.scheduledStartTime);
  return start > now && start.toDateString() === now.toDateString();
}

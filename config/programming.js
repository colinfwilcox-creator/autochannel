// Programming for TVs that no available game fills (Phase 6).
//
// Times are US Eastern (national TV schedules), 24h "HH:MM". An entry that runs
// to midnight uses end "24:00". Entries never cross midnight.
// priority 1–100: higher wins when more shows are airing than TVs to fill.
// season {from, to} as "MM-DD", may wrap the new year (e.g. 09-01 → 02-15).
// gameDayOnly "NFL" | "CFB" | ...: only when that sport has a game today.
//
// Every entry is verify: true. These are best-knowledge schedules, not a
// listings feed. Correct them here; nothing else needs to change.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NFL_SEASON = { from: "09-01", to: "02-15" };
const CFB_SEASON = { from: "08-23", to: "01-20" };
const NBA_SEASON = { from: "10-20", to: "06-20" };
const NHL_SEASON = { from: "10-05", to: "06-25" };
const MLB_SEASON = { from: "03-20", to: "10-31" };
const MLB_OFFSEASON = { from: "11-01", to: "03-19" };

const PROGRAMMING_GRID = [
  // ---- ESPN ----
  { channel: "ESPN", show: "Get Up", days: WEEKDAYS, start: "08:00", end: "10:00", priority: 60, verify: true },
  { channel: "ESPN", show: "First Take", days: WEEKDAYS, start: "10:00", end: "12:00", priority: 65, verify: true },
  { channel: "ESPN", show: "The Pat McAfee Show", days: WEEKDAYS, start: "12:00", end: "15:00", priority: 60, verify: true },
  { channel: "ESPN", show: "NFL Live", days: WEEKDAYS, start: "16:00", end: "17:00", priority: 70, season: NFL_SEASON, verify: true },
  { channel: "ESPN", show: "Around the Horn", days: WEEKDAYS, start: "17:00", end: "17:30", priority: 70, verify: true },
  { channel: "ESPN", show: "Pardon the Interruption", days: WEEKDAYS, start: "17:30", end: "18:00", priority: 75, verify: true },
  { channel: "ESPN", show: "SportsCenter", days: ["Tue", "Wed", "Thu", "Fri"], start: "18:00", end: "19:00", priority: 65, verify: true },
  { channel: "ESPN", show: "Monday Night Countdown", days: ["Mon"], start: "18:00", end: "20:15", priority: 90, season: NFL_SEASON, gameDayOnly: "NFL", verify: true },
  { channel: "ESPN", show: "SportsCenter", days: ALL_DAYS, start: "23:00", end: "24:00", priority: 55, verify: true },
  { channel: "ESPN", show: "College GameDay", days: ["Sat"], start: "09:00", end: "12:00", priority: 90, season: CFB_SEASON, gameDayOnly: "CFB", verify: true },
  { channel: "ESPN", show: "Sunday NFL Countdown", days: ["Sun"], start: "10:00", end: "13:00", priority: 85, season: NFL_SEASON, gameDayOnly: "NFL", verify: true },

  // ---- FS1 / FOX ----
  { channel: "FS1", show: "Breakfast Ball", days: WEEKDAYS, start: "09:00", end: "10:30", priority: 40, verify: true },
  { channel: "FS1", show: "The Herd with Colin Cowherd", days: WEEKDAYS, start: "12:00", end: "15:00", priority: 55, verify: true },
  { channel: "FS1", show: "Speak", days: WEEKDAYS, start: "15:00", end: "16:00", priority: 45, verify: true },
  { channel: "FS1", show: "The Facility", days: WEEKDAYS, start: "16:00", end: "17:00", priority: 45, verify: true },
  { channel: "FOX", show: "Big Noon Kickoff", days: ["Sat"], start: "10:00", end: "12:00", priority: 80, season: CFB_SEASON, gameDayOnly: "CFB", verify: true },
  { channel: "FOX", show: "FOX NFL Kickoff", days: ["Sun"], start: "11:00", end: "12:00", priority: 70, season: NFL_SEASON, gameDayOnly: "NFL", verify: true },
  { channel: "FOX", show: "FOX NFL Sunday", days: ["Sun"], start: "12:00", end: "13:00", priority: 85, season: NFL_SEASON, gameDayOnly: "NFL", verify: true },

  // ---- CBS / NBC pregame ----
  { channel: "CBS", show: "The NFL Today", days: ["Sun"], start: "12:00", end: "13:00", priority: 85, season: NFL_SEASON, gameDayOnly: "NFL", verify: true },
  { channel: "NBC", show: "Football Night in America", days: ["Sun"], start: "19:00", end: "20:20", priority: 90, season: NFL_SEASON, gameDayOnly: "NFL", verify: true },

  // ---- NFL Network ----
  { channel: "NFL Network", show: "Good Morning Football", days: WEEKDAYS, start: "07:00", end: "10:00", priority: 55, season: NFL_SEASON, verify: true },
  { channel: "NFL Network", show: "NFL Total Access", days: WEEKDAYS, start: "19:00", end: "20:00", priority: 60, season: NFL_SEASON, verify: true },
  { channel: "NFL Network", show: "NFL GameDay Morning", days: ["Sun"], start: "09:00", end: "13:00", priority: 80, season: NFL_SEASON, gameDayOnly: "NFL", verify: true },

  // ---- MLB Network ----
  { channel: "MLB Network", show: "MLB Central", days: WEEKDAYS, start: "10:00", end: "13:00", priority: 45, season: MLB_SEASON, verify: true },
  { channel: "MLB Network", show: "MLB Now", days: WEEKDAYS, start: "14:00", end: "15:00", priority: 45, season: MLB_SEASON, verify: true },
  { channel: "MLB Network", show: "MLB Tonight", days: ALL_DAYS, start: "18:00", end: "24:00", priority: 60, season: MLB_SEASON, verify: true },
  { channel: "MLB Network", show: "MLB Network Hot Stove", days: WEEKDAYS, start: "09:00", end: "11:00", priority: 40, season: MLB_OFFSEASON, verify: true },

  // ---- NBA TV ----
  { channel: "NBA TV", show: "NBA GameTime", days: ALL_DAYS, start: "18:00", end: "19:00", priority: 55, season: NBA_SEASON, verify: true },

  // ---- NHL Network ----
  { channel: "NHL Network", show: "NHL Now", days: WEEKDAYS, start: "15:00", end: "16:00", priority: 45, season: NHL_SEASON, verify: true },
  { channel: "NHL Network", show: "NHL Tonight", days: ALL_DAYS, start: "21:00", end: "24:00", priority: 55, season: NHL_SEASON, verify: true },

  // ---- Golf Channel ----
  { channel: "Golf Channel", show: "Golf Today", days: WEEKDAYS, start: "12:00", end: "14:00", priority: 35, verify: true },
  { channel: "Golf Channel", show: "Golf Central", days: ALL_DAYS, start: "18:00", end: "19:00", priority: 40, verify: true },

  // ---- Network blocks: low priority, so big venues still have distinct channels ----
  { channel: "ESPN2", show: "ESPN2", days: ALL_DAYS, start: "06:00", end: "24:00", priority: 20, verify: true },
  { channel: "CBS Sports Network", show: "CBS Sports Network", days: ALL_DAYS, start: "06:00", end: "24:00", priority: 18, verify: true },
  { channel: "Big Ten Network", show: "Big Ten Network", days: ALL_DAYS, start: "06:00", end: "24:00", priority: 18, verify: true },
  { channel: "SEC Network", show: "SEC Network", days: ALL_DAYS, start: "06:00", end: "24:00", priority: 18, verify: true },
  { channel: "ACC Network", show: "ACC Network", days: ALL_DAYS, start: "06:00", end: "24:00", priority: 18, verify: true },
  { channel: "ESPNU", show: "ESPNU", days: ALL_DAYS, start: "06:00", end: "24:00", priority: 12, verify: true },
  { channel: "Tennis Channel", show: "Tennis Channel", days: ALL_DAYS, start: "06:00", end: "24:00", priority: 10, verify: true }
];

// Last resort, in this order, when no grid entry is airing on an unused channel.
const ALWAYS_AVAILABLE_CHANNELS = ["NFL Network", "MLB Network", "NHL Network", "NBA TV", "Golf Channel", "ESPN News"];

// ---------- Grid evaluation ----------

// Day of week ("Mon"), minutes since midnight, and "MM-DD", all in US Eastern.
function easternClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  return { day: get("weekday"), minutes: Number(get("hour")) * 60 + Number(get("minute")), monthDay: `${get("month")}-${get("day")}` };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function inSeason(season, monthDay) {
  if (!season) return true;
  return season.from <= season.to
    ? monthDay >= season.from && monthDay <= season.to
    : monthDay >= season.from || monthDay <= season.to; // wraps the new year
}

// Entries airing at `now`, highest priority first. sportsWithGamesToday: Set of sport codes.
function programmingAiringNow(now = new Date(), sportsWithGamesToday = new Set()) {
  const c = easternClock(now);
  return PROGRAMMING_GRID
    .filter(e => e.days.includes(c.day))
    .filter(e => toMinutes(e.start) <= c.minutes && c.minutes < toMinutes(e.end))
    .filter(e => inSeason(e.season, c.monthDay))
    .filter(e => !e.gameDayOnly || sportsWithGamesToday.has(e.gameDayOnly))
    .sort((a, b) => b.priority - a.priority);
}

// Phase 3: National relevance lists (Spec §17.B)
// Applied in every market after the market table. Names are ESPN displayNames.

const NATIONAL_DRAW_BASE = 40;
const NATIONAL_PROGRAM_BASE = 35;
const GENERIC_BASE = 15;

const NATIONAL_DRAWS = [
  "New York Yankees",
  "Los Angeles Dodgers",
  "Boston Red Sox",
  "Dallas Cowboys",
  "Kansas City Chiefs",
  "Green Bay Packers",
  "San Francisco 49ers",
  "New England Patriots",
  "Los Angeles Lakers",
  "Boston Celtics",
  "Golden State Warriors"
];

const NATIONAL_PROGRAMS = [
  "Ohio State Buckeyes",
  "Alabama Crimson Tide",
  "Michigan Wolverines",
  "Georgia Bulldogs",
  "Texas Longhorns",
  "Notre Dame Fighting Irish",
  "LSU Tigers",
  "Clemson Tigers"
];

// ---------- National stature floor ----------
// Relevance = max(localRelevance, nationalFloor). The floor comes from the event,
// regardless of teams or market (applied in modules/scorer.js).
const NATIONAL_FLOORS = {
  championship: 95,      // Super Bowl, World Series, NBA Finals, Stanley Cup Final, CFP Championship
  nflPlayoff: 85,        // NFL playoffs (other rounds)
  nflPrimetime: 80,      // NFL primetime standalone: MNF, SNF, TNF, Thanksgiving, Christmas
  confFinals: 70,        // MLB/NBA/NHL conference finals (ALCS/NLCS), CFP semifinals
  earlyPlayoff: 55,      // MLB/NBA/NHL earlier playoff rounds; top-10 vs top-10 college football
  nflOther: 45           // any other NFL game
};

// "Standalone primetime": starts 7 PM ET or later (any time on Thanksgiving or
// Christmas), on a national channel, and no other NFL game overlaps its window.
const NFL_PRIMETIME_START_ET = "19:00";
const NFL_GAME_WINDOW_MINUTES = 210;

// ---------- National lock ----------
// A game with nationalFloor >= NATIONAL_LOCK_MIN_FLOOR (NFL primetime standalone,
// NFL playoffs, championships) is locked in every market: all Main TVs + saturation
// 0.30 of the other TVs, from 30 minutes before start until final. The market lock
// list wins: if a market lock is live too, the national-lock game is handled like
// any other secondary lock game (guaranteed a TV).
const NATIONAL_LOCK_MIN_FLOOR = 80;
const NATIONAL_LOCK_SATURATION = 0.30;

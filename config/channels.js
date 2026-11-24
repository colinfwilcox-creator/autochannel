// Channels (Phase 6)
// A game is "available" in a market if it's on one of these national channels,
// or on a regional channel in that market's `rsns` list (config/markets.js).

// National channels a typical bar has. Streaming services are excluded for V1.
const NATIONAL_CHANNELS = [
  "ESPN", "ESPN2", "ABC", "CBS", "NBC", "FOX", "FS1", "TNT", "TBS", "truTV",
  "NFL Network", "NBA TV", "NHL Network", "MLB Network",
  "Big Ten Network", "SEC Network", "ACC Network", "CBS Sports Network",
  "NBCSN"                                    // NBC Sports Network, relaunched Nov 17, 2025 (Monday NBA, EPL, WNBA, …)
];

// ESPN feed spelling → the name used everywhere in the app.
// Left side checked against ESPN payloads where noted; the rest are best guesses.
const CHANNEL_ALIASES = {
  "Fox": "FOX",                              // seen in NFL/MLB feeds
  "NHL Net": "NHL Network",                  // seen
  "MLB Net": "MLB Network",                  // seen
  "NFL Net": "NFL Network",
  "BTN": "Big Ten Network",                  // seen
  "SECN": "SEC Network",
  "ACCN": "ACC Network",                     // "ACC Network" also seen as-is
  "CBSSN": "CBS Sports Network",
  "NBC Sports Network": "NBCSN",             // ESPN sends "NBCSN" (seen); regional "NBC Sports BA" etc. stay as-is
  "MNMT": "Monumental Sports Network",       // seen on every Capitals/Wizards game
  "MNMT2": "Monumental Sports Network 2"
};

// Never "available" even if ESPN lists them as TV (and anything ESPN tags Streaming/Radio).
const STREAMING_CHANNEL_PATTERNS = [
  /\+$/, /^ESPN\+/, /Peacock/i, /Prime Video/i, /Apple TV/i, /Netflix/i, /YouTube/i,
  /League Pass/i, /MLB\.TV/i, /DAZN/i, /\bApp\b/i, /\.com$/i, /Live$/i, /Vision$/i
];

const NATIONAL_CHANNEL_SET = new Set(NATIONAL_CHANNELS);

function canonicalChannel(name) {
  if (!name) return null;
  const n = String(name).trim();
  return CHANNEL_ALIASES[n] || n;
}

function isStreamingName(name) {
  return STREAMING_CHANNEL_PATTERNS.some(re => re.test(name));
}

// Phase 3: Market relevance templates (Spec §17.B)
//
// Team names must exactly match the fetcher's normalized names (ESPN displayName).
// `flags` lists every team whose tier (home / regional / college) or exact ESPN
// name is uncertain. Flagged entries are included in the table unless the flag
// says "not listed". Review these before relying on a market outside DC.

const HOME_BASE = { NFL: 90, NHL: 85, MLB: 80, NBA: 70, MLS: 60, WNBA: 45 };
const COLLEGE_BASE = { flagship: 65, secondary: 50 };
const REGIONAL_FACTOR = 0.6;
const ADJUST_LIMIT = 10;
const round5 = x => Math.round(x / 5) * 5;

function buildTeamTable(m) {
  const t = {};
  const set = (name, v) => { t[name] = Math.max(t[name] ?? 0, v); };
  for (const [sport, teams] of Object.entries(m.home)) teams.forEach(n => set(n, HOME_BASE[sport]));
  (m.college || []).forEach(c => set(c.name, COLLEGE_BASE[c.tier]));
  (m.regional || []).forEach(r => set(r.name, round5(HOME_BASE[r.sport] * REGIONAL_FACTOR)));
  return t;
}

const MARKETS = {
  "washington-dc": {
    name: "Washington, DC",
    home: {
      NFL: ["Washington Commanders"],
      NHL: ["Washington Capitals"],
      MLB: ["Washington Nationals"],
      NBA: ["Washington Wizards"]
    },
    college: [{ name: "Maryland Terrapins", tier: "flagship" }],
    regional: [
      { name: "Baltimore Ravens", sport: "NFL" },
      { name: "Baltimore Orioles", sport: "MLB" }
    ],
    flags: [
      { team: "D.C. United", issue: "Home MLS (60). Not listed, so the DC table matches the Barking Dog table exactly. Add it?" },
      { team: "Washington Mystics", issue: "Home WNBA (45). Not listed, for the same reason. Add it?" },
      { team: "Georgetown Hoyas", issue: "College tier unknown (secondary?). Not listed, so it currently scores generic 15." },
      { team: "Virginia Cavaliers / Virginia Tech Hokies / Navy Midshipmen", issue: "College tier unknown. Not listed." }
    ]
  },

  "baltimore": {
    name: "Baltimore",
    home: { NFL: ["Baltimore Ravens"], MLB: ["Baltimore Orioles"] },
    college: [{ name: "Maryland Terrapins", tier: "flagship" }],
    regional: [
      { name: "Washington Commanders", sport: "NFL" },
      { name: "Washington Capitals", sport: "NHL" },
      { name: "Washington Wizards", sport: "NBA" }
    ],
    flags: [
      { team: "Washington Wizards", issue: "Listed as regional (Baltimore has no NBA team). The draw may be weaker than that." },
      { team: "Washington Nationals", issue: "Not listed as regional, because of the rivalry with the Orioles. Add it?" },
      { team: "Navy Midshipmen", issue: "College tier unknown. Not listed." }
    ]
  },

  "new-york": {
    name: "New York",
    home: {
      NFL: ["New York Giants", "New York Jets"],
      NHL: ["New York Rangers", "New York Islanders", "New Jersey Devils"],
      MLB: ["New York Yankees", "New York Mets"],
      NBA: ["New York Knicks", "Brooklyn Nets"],
      MLS: ["New York City FC", "New York Red Bulls"],
      WNBA: ["New York Liberty"]
    },
    college: [
      { name: "Rutgers Scarlet Knights", tier: "secondary" },
      { name: "St. John's Red Storm", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "New Jersey Devils", issue: "Listed as home. In Manhattan bars it may draw more like a regional team." },
      { team: "Rutgers Scarlet Knights", issue: "Tier uncertain (secondary vs flagship)." },
      { team: "St. John's Red Storm", issue: "Tier uncertain." },
      { team: "New York Red Bulls", issue: "Exact ESPN displayName unverified." },
      { team: "New York Giants / New York Jets", issue: "Both get any_game locks. If both play at once, the Giants win the full lock because they're listed first." }
    ]
  },

  "boston": {
    name: "Boston",
    home: {
      NFL: ["New England Patriots"],
      NHL: ["Boston Bruins"],
      MLB: ["Boston Red Sox"],
      NBA: ["Boston Celtics"],
      MLS: ["New England Revolution"]
    },
    college: [{ name: "Boston College Eagles", tier: "secondary" }],
    regional: [],
    flags: [
      { team: "Boston College Eagles", issue: "Tier uncertain (secondary vs flagship)." },
      { team: "Connecticut Sun", issue: "Regional WNBA? Not listed because of relocation uncertainty." }
    ]
  },

  "philadelphia": {
    name: "Philadelphia",
    home: {
      NFL: ["Philadelphia Eagles"],
      NHL: ["Philadelphia Flyers"],
      MLB: ["Philadelphia Phillies"],
      NBA: ["Philadelphia 76ers"],
      MLS: ["Philadelphia Union"]
    },
    college: [
      { name: "Penn State Nittany Lions", tier: "flagship" },
      { name: "Villanova Wildcats", tier: "secondary" },
      { name: "Temple Owls", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Penn State Nittany Lions", issue: "Flagship tier uncertain (the campus is in central PA)." },
      { team: "Villanova Wildcats", issue: "Tier uncertain. Basketball-driven." },
      { team: "Temple Owls", issue: "Tier uncertain." }
    ]
  },

  "pittsburgh": {
    name: "Pittsburgh",
    home: { NFL: ["Pittsburgh Steelers"], NHL: ["Pittsburgh Penguins"], MLB: ["Pittsburgh Pirates"] },
    college: [
      { name: "Pittsburgh Panthers", tier: "flagship" },
      { name: "Penn State Nittany Lions", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Pittsburgh Panthers / Penn State Nittany Lions", issue: "Unclear which is the flagship in Pittsburgh." }
    ]
  },

  "cleveland": {
    name: "Cleveland",
    home: { NFL: ["Cleveland Browns"], MLB: ["Cleveland Guardians"], NBA: ["Cleveland Cavaliers"] },
    college: [{ name: "Ohio State Buckeyes", tier: "flagship" }],
    regional: [{ name: "Columbus Blue Jackets", sport: "NHL" }],
    flags: [
      { team: "Columbus Blue Jackets", issue: "Listed as regional (Cleveland has no NHL team). Unsure it's the same media region." }
    ]
  },

  "cincinnati": {
    name: "Cincinnati",
    home: { NFL: ["Cincinnati Bengals"], MLB: ["Cincinnati Reds"], MLS: ["FC Cincinnati"] },
    college: [
      { name: "Cincinnati Bearcats", tier: "flagship" },
      { name: "Xavier Musketeers", tier: "secondary" },
      { name: "Ohio State Buckeyes", tier: "secondary" },
      { name: "Kentucky Wildcats", tier: "secondary" }
    ],
    regional: [{ name: "Columbus Blue Jackets", sport: "NHL" }],
    flags: [
      { team: "Cincinnati Bearcats", issue: "Flagship vs Ohio State uncertain." },
      { team: "Ohio State Buckeyes", issue: "Tier uncertain (secondary here vs flagship)." },
      { team: "Kentucky Wildcats", issue: "Across the river. Tier uncertain." },
      { team: "Columbus Blue Jackets", issue: "Regional? Unsure it's the same media region." }
    ]
  },

  "columbus": {
    name: "Columbus",
    home: { NHL: ["Columbus Blue Jackets"], MLS: ["Columbus Crew"] },
    college: [{ name: "Ohio State Buckeyes", tier: "flagship" }],
    regional: [
      { name: "Cincinnati Bengals", sport: "NFL" },
      { name: "Cleveland Browns", sport: "NFL" },
      { name: "Cincinnati Reds", sport: "MLB" },
      { name: "Cleveland Guardians", sport: "MLB" },
      { name: "Cleveland Cavaliers", sport: "NBA" }
    ],
    flags: [
      { team: "Bengals / Browns / Reds / Guardians / Cavaliers", issue: "Columbus is split between Cincinnati and Cleveland, so all five are listed as regional. Unsure." },
      { team: "Ohio State Buckeyes", issue: "Flagship scores 65, below the Blue Jackets (85). In Columbus OSU is arguably the bigger draw. Consider adjust +10." }
    ]
  },

  "detroit": {
    name: "Detroit",
    home: { NFL: ["Detroit Lions"], NHL: ["Detroit Red Wings"], MLB: ["Detroit Tigers"], NBA: ["Detroit Pistons"] },
    college: [
      { name: "Michigan Wolverines", tier: "flagship" },
      { name: "Michigan State Spartans", tier: "flagship" }
    ],
    regional: [],
    flags: [
      { team: "Michigan State Spartans", issue: "Listed as a second flagship. Could be secondary." }
    ]
  },

  "chicago": {
    name: "Chicago",
    home: {
      NFL: ["Chicago Bears"],
      NHL: ["Chicago Blackhawks"],
      MLB: ["Chicago Cubs", "Chicago White Sox"],
      NBA: ["Chicago Bulls"],
      MLS: ["Chicago Fire FC"],
      WNBA: ["Chicago Sky"]
    },
    college: [
      { name: "Illinois Fighting Illini", tier: "flagship" },
      { name: "Notre Dame Fighting Irish", tier: "secondary" },
      { name: "Northwestern Wildcats", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Illinois Fighting Illini", issue: "Flagship tier uncertain (campus is 2+ hours away)." },
      { team: "Notre Dame Fighting Irish", issue: "Tier uncertain. Big following in Chicago." },
      { team: "Northwestern Wildcats", issue: "Tier uncertain." }
    ]
  },

  "milwaukee": {
    name: "Milwaukee",
    home: { NFL: ["Green Bay Packers"], MLB: ["Milwaukee Brewers"], NBA: ["Milwaukee Bucks"] },
    college: [
      { name: "Wisconsin Badgers", tier: "flagship" },
      { name: "Marquette Golden Eagles", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Green Bay Packers", issue: "Listed as home NFL for Milwaukee (different city, same state market)." }
    ]
  },

  "minneapolis": {
    name: "Minneapolis–St. Paul",
    home: {
      NFL: ["Minnesota Vikings"],
      NHL: ["Minnesota Wild"],
      MLB: ["Minnesota Twins"],
      NBA: ["Minnesota Timberwolves"],
      MLS: ["Minnesota United FC"],
      WNBA: ["Minnesota Lynx"]
    },
    college: [{ name: "Minnesota Golden Gophers", tier: "flagship" }],
    regional: [],
    flags: []
  },

  "kansas-city": {
    name: "Kansas City",
    home: { NFL: ["Kansas City Chiefs"], MLB: ["Kansas City Royals"], MLS: ["Sporting Kansas City"] },
    college: [
      { name: "Kansas Jayhawks", tier: "flagship" },
      { name: "Missouri Tigers", tier: "flagship" },
      { name: "Kansas State Wildcats", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Kansas Jayhawks / Missouri Tigers", issue: "Two-state market. Unsure both are flagship." },
      { team: "Kansas State Wildcats", issue: "Tier uncertain." }
    ]
  },

  "st-louis": {
    name: "St. Louis",
    home: { NHL: ["St. Louis Blues"], MLB: ["St. Louis Cardinals"], MLS: ["St. Louis CITY SC"] },
    college: [
      { name: "Missouri Tigers", tier: "flagship" },
      { name: "Saint Louis Billikens", tier: "secondary" }
    ],
    regional: [{ name: "Kansas City Chiefs", sport: "NFL" }],
    flags: [
      { team: "Kansas City Chiefs", issue: "Listed as regional NFL (St. Louis has no NFL team). Different media market, so unsure." },
      { team: "Saint Louis Billikens", issue: "Tier uncertain." },
      { team: "St. Louis CITY SC", issue: "Exact ESPN displayName unverified." }
    ]
  },

  "dallas": {
    name: "Dallas–Fort Worth",
    home: {
      NFL: ["Dallas Cowboys"],
      NHL: ["Dallas Stars"],
      MLB: ["Texas Rangers"],
      NBA: ["Dallas Mavericks"],
      MLS: ["FC Dallas"],
      WNBA: ["Dallas Wings"]
    },
    college: [
      { name: "Texas Longhorns", tier: "flagship" },
      { name: "Texas A&M Aggies", tier: "flagship" },
      { name: "TCU Horned Frogs", tier: "secondary" },
      { name: "SMU Mustangs", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Texas Longhorns / Texas A&M Aggies", issue: "Neither campus is in DFW. Unsure both are flagship." },
      { team: "TCU Horned Frogs / SMU Mustangs", issue: "Tier uncertain." }
    ]
  },

  "houston": {
    name: "Houston",
    home: { NFL: ["Houston Texans"], MLB: ["Houston Astros"], NBA: ["Houston Rockets"], MLS: ["Houston Dynamo FC"] },
    college: [
      { name: "Texas A&M Aggies", tier: "flagship" },
      { name: "Texas Longhorns", tier: "flagship" },
      { name: "Houston Cougars", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Texas A&M Aggies / Texas Longhorns / Houston Cougars", issue: "Tiers uncertain." },
      { team: "Houston Dynamo FC", issue: "Exact ESPN displayName unverified." }
    ]
  },

  "denver": {
    name: "Denver",
    home: {
      NFL: ["Denver Broncos"],
      NHL: ["Colorado Avalanche"],
      MLB: ["Colorado Rockies"],
      NBA: ["Denver Nuggets"],
      MLS: ["Colorado Rapids"]
    },
    college: [{ name: "Colorado Buffaloes", tier: "flagship" }],
    regional: [],
    flags: []
  },

  "phoenix": {
    name: "Phoenix",
    home: {
      NFL: ["Arizona Cardinals"],
      MLB: ["Arizona Diamondbacks"],
      NBA: ["Phoenix Suns"],
      WNBA: ["Phoenix Mercury"]
    },
    college: [
      { name: "Arizona State Sun Devils", tier: "flagship" },
      { name: "Arizona Wildcats", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Arizona State Sun Devils / Arizona Wildcats", issue: "Tiers uncertain." },
      { team: "Utah Mammoth", issue: "The former Coyotes moved to Utah. Phoenix has no NHL team, and none is listed." }
    ]
  },

  "las-vegas": {
    name: "Las Vegas",
    home: { NFL: ["Las Vegas Raiders"], NHL: ["Vegas Golden Knights"], WNBA: ["Las Vegas Aces"] },
    college: [{ name: "UNLV Rebels", tier: "secondary" }],
    regional: [],
    flags: [
      { team: "Athletics", issue: "Relocating to Las Vegas (in Sacramento for now). Not listed." },
      { team: "UNLV Rebels", issue: "Tier uncertain." }
    ]
  },

  "los-angeles": {
    name: "Los Angeles",
    home: {
      NFL: ["Los Angeles Rams", "Los Angeles Chargers"],
      NHL: ["Los Angeles Kings", "Anaheim Ducks"],
      MLB: ["Los Angeles Dodgers", "Los Angeles Angels"],
      NBA: ["Los Angeles Lakers", "LA Clippers"],
      MLS: ["LA Galaxy", "LAFC"],
      WNBA: ["Los Angeles Sparks"]
    },
    college: [
      { name: "USC Trojans", tier: "flagship" },
      { name: "UCLA Bruins", tier: "flagship" }
    ],
    regional: [],
    flags: [
      { team: "Anaheim Ducks / Los Angeles Angels", issue: "Orange County teams listed as home for all of LA." },
      { team: "LAFC", issue: "Exact ESPN displayName unverified (the proxy has no MLS route)." },
      { team: "Los Angeles Rams / Los Angeles Chargers", issue: "Both get any_game locks. The Rams win if both play at once." }
    ]
  },

  "san-diego": {
    name: "San Diego",
    home: { MLB: ["San Diego Padres"], MLS: ["San Diego FC"] },
    college: [{ name: "San Diego State Aztecs", tier: "secondary" }],
    regional: [{ name: "Los Angeles Chargers", sport: "NFL" }],
    flags: [
      { team: "Los Angeles Chargers", issue: "Listed as regional NFL. A former SD team with mixed sentiment." },
      { team: "San Diego State Aztecs", issue: "Tier uncertain (could be flagship)." },
      { team: "San Diego FC", issue: "Exact ESPN displayName unverified." }
    ]
  },

  "bay-area": {
    name: "San Francisco Bay Area",
    home: {
      NFL: ["San Francisco 49ers"],
      NHL: ["San Jose Sharks"],
      MLB: ["San Francisco Giants"],
      NBA: ["Golden State Warriors"],
      MLS: ["San Jose Earthquakes"],
      WNBA: ["Golden State Valkyries"]
    },
    college: [
      { name: "California Golden Bears", tier: "flagship" },
      { name: "Stanford Cardinal", tier: "flagship" }
    ],
    regional: [],
    flags: [
      { team: "California Golden Bears / Stanford Cardinal", issue: "Unsure either is flagship." },
      { team: "Athletics", issue: "Left Oakland. Not listed." }
    ]
  },

  "seattle": {
    name: "Seattle",
    home: {
      NFL: ["Seattle Seahawks"],
      NHL: ["Seattle Kraken"],
      MLB: ["Seattle Mariners"],
      MLS: ["Seattle Sounders FC"],
      WNBA: ["Seattle Storm"]
    },
    college: [
      { name: "Washington Huskies", tier: "flagship" },
      { name: "Washington State Cougars", tier: "secondary" }
    ],
    regional: [],
    flags: []
  },

  "portland": {
    name: "Portland",
    home: { NBA: ["Portland Trail Blazers"], MLS: ["Portland Timbers"], WNBA: ["Portland Fire"] },
    college: [
      { name: "Oregon Ducks", tier: "flagship" },
      { name: "Oregon State Beavers", tier: "secondary" }
    ],
    regional: [
      { name: "Seattle Seahawks", sport: "NFL" },
      { name: "Seattle Mariners", sport: "MLB" }
    ],
    flags: [
      { team: "Seattle Seahawks / Seattle Mariners", issue: "Listed as regional for Portland. Unsure." },
      { team: "Portland Fire", issue: "WNBA expansion team (2026). ESPN displayName unverified." },
      { team: "Oregon Ducks / Oregon State Beavers", issue: "Tiers uncertain." }
    ]
  },

  "salt-lake-city": {
    name: "Salt Lake City",
    home: { NHL: ["Utah Mammoth"], NBA: ["Utah Jazz"], MLS: ["Real Salt Lake"] },
    college: [
      { name: "Utah Utes", tier: "flagship" },
      { name: "BYU Cougars", tier: "flagship" }
    ],
    regional: [],
    flags: [
      { team: "Utah Mammoth", issue: "As the highest-base home team it gets the any_game lock, though the Jazz may be the bigger draw. (ESPN name verified live.)" },
      { team: "BYU Cougars", issue: "Listed as a second flagship. Unsure." }
    ]
  },

  "atlanta": {
    name: "Atlanta",
    home: {
      NFL: ["Atlanta Falcons"],
      MLB: ["Atlanta Braves"],
      NBA: ["Atlanta Hawks"],
      MLS: ["Atlanta United FC"],
      WNBA: ["Atlanta Dream"]
    },
    college: [
      { name: "Georgia Bulldogs", tier: "flagship" },
      { name: "Georgia Tech Yellow Jackets", tier: "secondary" }
    ],
    regional: [],
    flags: []
  },

  "miami": {
    name: "Miami",
    home: {
      NFL: ["Miami Dolphins"],
      NHL: ["Florida Panthers"],
      MLB: ["Miami Marlins"],
      NBA: ["Miami Heat"],
      MLS: ["Inter Miami CF"]
    },
    college: [
      { name: "Miami Hurricanes", tier: "flagship" },
      { name: "Florida Gators", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Miami Hurricanes / Florida Gators", issue: "Tiers uncertain." }
    ]
  },

  "tampa": {
    name: "Tampa Bay",
    home: { NFL: ["Tampa Bay Buccaneers"], NHL: ["Tampa Bay Lightning"], MLB: ["Tampa Bay Rays"] },
    college: [
      { name: "Florida Gators", tier: "flagship" },
      { name: "South Florida Bulls", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Florida Gators / South Florida Bulls", issue: "Tiers uncertain. Florida State also has a big following and isn't listed." }
    ]
  },

  "jacksonville": {
    name: "Jacksonville",
    home: { NFL: ["Jacksonville Jaguars"] },
    college: [
      { name: "Florida Gators", tier: "flagship" },
      { name: "Florida State Seminoles", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Florida Gators / Florida State Seminoles", issue: "Tiers uncertain." }
    ]
  },

  "charlotte": {
    name: "Charlotte",
    home: { NFL: ["Carolina Panthers"], NBA: ["Charlotte Hornets"], MLS: ["Charlotte FC"] },
    college: [{ name: "North Carolina Tar Heels", tier: "flagship" }],
    regional: [{ name: "Carolina Hurricanes", sport: "NHL" }],
    flags: [
      { team: "Carolina Hurricanes", issue: "Listed as regional NHL (the team plays in Raleigh)." },
      { team: "North Carolina Tar Heels", issue: "Tier uncertain. Duke, NC State and Clemson aren't listed." }
    ]
  },

  "raleigh": {
    name: "Raleigh–Durham",
    home: { NHL: ["Carolina Hurricanes"] },
    college: [
      { name: "NC State Wolfpack", tier: "flagship" },
      { name: "North Carolina Tar Heels", tier: "flagship" },
      { name: "Duke Blue Devils", tier: "flagship" }
    ],
    regional: [{ name: "Carolina Panthers", sport: "NFL" }],
    flags: [
      { team: "Carolina Panthers", issue: "Listed as regional, which gives the Hurricanes the any_game lock. Could arguably be home NFL for the whole state." },
      { team: "NC State / North Carolina / Duke", issue: "Three flagships. Tiers uncertain." }
    ]
  },

  "nashville": {
    name: "Nashville",
    home: { NFL: ["Tennessee Titans"], NHL: ["Nashville Predators"], MLS: ["Nashville SC"] },
    college: [
      { name: "Tennessee Volunteers", tier: "flagship" },
      { name: "Vanderbilt Commodores", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Tennessee Volunteers", issue: "Flagship uncertain (campus is in Knoxville)." }
    ]
  },

  "new-orleans": {
    name: "New Orleans",
    home: { NFL: ["New Orleans Saints"], NBA: ["New Orleans Pelicans"] },
    college: [
      { name: "LSU Tigers", tier: "flagship" },
      { name: "Tulane Green Wave", tier: "secondary" }
    ],
    regional: [],
    flags: []
  },

  "indianapolis": {
    name: "Indianapolis",
    home: { NFL: ["Indianapolis Colts"], NBA: ["Indiana Pacers"], WNBA: ["Indiana Fever"] },
    college: [
      { name: "Indiana Hoosiers", tier: "flagship" },
      { name: "Purdue Boilermakers", tier: "flagship" },
      { name: "Butler Bulldogs", tier: "secondary" }
    ],
    regional: [],
    flags: [
      { team: "Indiana Hoosiers / Purdue Boilermakers", issue: "Unsure both are flagship. Notre Dame isn't listed." },
      { team: "Indiana Fever", issue: "WNBA base is 45. With Caitlin Clark the draw may be far higher. Consider adjust +10." }
    ]
  },

  "buffalo": {
    name: "Buffalo",
    home: { NFL: ["Buffalo Bills"], NHL: ["Buffalo Sabres"] },
    college: [{ name: "Buffalo Bulls", tier: "secondary" }],
    regional: [],
    flags: [
      { team: "Buffalo Bulls", issue: "Tier uncertain. Syracuse isn't listed." }
    ]
  }
};

// Metros with pro teams that are not populated yet: Oklahoma City, Memphis,
// San Antonio, Sacramento, Orlando (NBA-only markets), plus Canadian markets.

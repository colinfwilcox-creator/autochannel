// ZIP prefix → market (Phase 5). No geocoding: the first 3 digits of a ZIP
// (USPS sectional center) map to the nearest supported market.
//
// Core metro prefixes follow the market itself. Surrounding prefixes go to the
// nearest market by rough driving distance. Where two markets were close, the
// same-state market was preferred (e.g. Indiana → Indianapolis, Wisconsin →
// Milwaukee). Border choices are marked "border". Prefixes far from every
// market (Alaska, Hawaii, Montana, territories, etc.) are left out on purpose,
// so the app asks for a ZIP in a supported area instead of guessing.

const ZIP_PREFIX_RANGES = [
  // ---- New England ----
  ["010", "027", "boston"],            // MA (Springfield 010-011 is border with Hartford)
  ["028", "029", "boston"],            // Rhode Island
  ["030", "049", "boston"],            // NH, Maine
  ["050", "059", "boston"],            // Vermont (border)
  ["060", "063", "boston"],            // Hartford area (border: Yankees/Red Sox split)
  ["064", "069", "new-york"],          // New Haven, Bridgeport, Stamford

  // ---- New York / New Jersey ----
  ["070", "079", "new-york"],          // North & central NJ
  ["080", "086", "philadelphia"],      // South NJ, Trenton
  ["087", "087", "new-york"],          // Ocean County
  ["088", "089", "new-york"],          // New Brunswick
  ["100", "119", "new-york"],          // NYC, Westchester, Long Island
  ["120", "129", "new-york"],          // Albany, Hudson Valley (border)
  ["130", "136", "buffalo"],           // Syracuse, Utica, Watertown (border)
  ["137", "139", "new-york"],          // Binghamton (border)
  ["140", "149", "buffalo"],           // Buffalo, Rochester, Jamestown, Elmira

  // ---- Pennsylvania / Delaware ----
  ["150", "168", "pittsburgh"],        // Western PA, Erie, Altoona, State College
  ["169", "172", "philadelphia"],      // Harrisburg, Williamsport (border)
  ["173", "174", "baltimore"],         // York (border)
  ["175", "196", "philadelphia"],      // Lancaster, Lehigh Valley, Scranton, Philadelphia, Reading
  ["197", "199", "philadelphia"],      // Delaware

  // ---- DC / Maryland / Virginia / West Virginia ----
  ["200", "209", "washington-dc"],     // DC, suburban MD (208 = Bethesda), Dulles
  ["210", "212", "baltimore"],
  ["214", "216", "baltimore"],         // Annapolis, Cumberland, Eastern Shore
  ["217", "217", "washington-dc"],     // Frederick
  ["218", "219", "baltimore"],         // Salisbury, Elkton
  ["220", "239", "washington-dc"],     // Northern VA, Richmond, Tidewater (Norfolk is border)
  ["240", "243", "charlotte"],         // Roanoke, Bristol, Pulaski (border)
  ["244", "245", "washington-dc"],     // Staunton, Lynchburg (border)
  ["246", "248", "charlotte"],         // Bluefield (border)
  ["249", "249", "washington-dc"],
  ["250", "253", "columbus"],          // Charleston WV (border)
  ["254", "254", "washington-dc"],     // Martinsburg
  ["255", "259", "columbus"],          // Huntington, Beckley (border)
  ["260", "260", "pittsburgh"],        // Wheeling
  ["261", "261", "columbus"],          // Parkersburg
  ["262", "266", "pittsburgh"],        // Clarksburg, Morgantown
  ["267", "268", "washington-dc"],

  // ---- Carolinas ----
  ["270", "274", "charlotte"],         // Greensboro, Winston-Salem (border)
  ["275", "279", "raleigh"],           // Raleigh, Durham, Rocky Mount
  ["280", "282", "charlotte"],
  ["283", "285", "raleigh"],           // Fayetteville, Wilmington, Kinston
  ["286", "289", "charlotte"],         // Hickory, Asheville
  ["290", "297", "charlotte"],         // South Carolina (most)
  ["298", "298", "atlanta"],           // Aiken / Augusta area
  ["299", "299", "jacksonville"],      // Beaufort / Savannah area (border)

  // ---- Georgia / Florida ----
  ["300", "312", "atlanta"],
  ["313", "316", "jacksonville"],      // Savannah, Waycross, Valdosta
  ["317", "319", "atlanta"],           // Albany, Columbus GA
  ["320", "324", "jacksonville"],      // Jacksonville, Tallahassee, Panama City (border)
  ["325", "325", "new-orleans"],       // Pensacola (border)
  ["326", "326", "jacksonville"],      // Gainesville
  ["327", "329", "tampa"],             // Orlando (no Orlando market yet)
  ["330", "334", "miami"],             // Miami, Fort Lauderdale, West Palm Beach
  ["335", "339", "tampa"],             // Tampa, St. Petersburg, Lakeland, Fort Myers (border)
  ["341", "341", "miami"],             // Naples
  ["342", "342", "tampa"],             // Sarasota, Bradenton
  ["344", "344", "jacksonville"],      // Gainesville
  ["346", "347", "tampa"],             // Brooksville, Orlando
  ["349", "349", "miami"],             // West Palm Beach

  // ---- Alabama / Tennessee / Mississippi ----
  ["350", "363", "atlanta"],           // Birmingham, Tuscaloosa, Montgomery, Dothan (Huntsville below)
  ["356", "358", "nashville"],         // Huntsville (overrides the range above)
  ["364", "366", "new-orleans"],       // Mobile
  ["367", "369", "atlanta"],
  ["370", "372", "nashville"],
  ["373", "374", "atlanta"],           // Chattanooga (border)
  ["375", "385", "nashville"],         // Memphis, Knoxville, Johnson City, Jackson TN
  ["386", "389", "nashville"],         // North Mississippi (border)
  ["390", "396", "new-orleans"],       // Jackson MS, Hattiesburg, Gulfport
  ["397", "397", "atlanta"],

  // ---- Kentucky / Ohio / Indiana / Michigan ----
  ["400", "410", "cincinnati"],        // Louisville, Lexington, Covington
  ["411", "412", "columbus"],          // Ashland (border)
  ["413", "418", "cincinnati"],
  ["420", "424", "nashville"],         // Paducah, Bowling Green, Owensboro (border)
  ["425", "427", "cincinnati"],
  ["430", "433", "columbus"],
  ["434", "436", "detroit"],           // Toledo
  ["437", "438", "columbus"],
  ["439", "439", "pittsburgh"],        // Steubenville
  ["440", "443", "cleveland"],         // Cleveland, Akron
  ["444", "445", "pittsburgh"],        // Youngstown (border with Cleveland)
  ["446", "449", "cleveland"],         // Canton, Mansfield
  ["450", "454", "cincinnati"],        // Cincinnati, Dayton
  ["455", "458", "columbus"],          // Springfield, Chillicothe, Athens, Lima
  ["460", "462", "indianapolis"],
  ["463", "466", "chicago"],           // Gary, South Bend
  ["467", "469", "indianapolis"],      // Fort Wayne, Kokomo
  ["470", "471", "cincinnati"],        // SE Indiana, Louisville suburbs
  ["472", "479", "indianapolis"],      // incl. Evansville (border)
  ["480", "497", "detroit"],           // Lower Peninsula
  ["498", "499", "milwaukee"],         // Upper Peninsula (border)

  // ---- Upper Midwest ----
  ["500", "503", "kansas-city"],       // Des Moines (border)
  ["504", "507", "minneapolis"],       // Mason City, Fort Dodge, Waterloo
  ["508", "508", "kansas-city"],
  ["510", "511", "kansas-city"],       // Sioux City (border)
  ["512", "513", "minneapolis"],
  ["514", "516", "kansas-city"],       // Council Bluffs / Omaha side
  ["520", "520", "milwaukee"],         // Dubuque (border)
  ["521", "521", "minneapolis"],
  ["522", "524", "chicago"],           // Cedar Rapids (border)
  ["525", "525", "kansas-city"],
  ["526", "526", "st-louis"],
  ["527", "528", "chicago"],           // Quad Cities
  ["530", "539", "milwaukee"],         // Milwaukee, Racine, Madison
  ["540", "540", "minneapolis"],       // Hudson / River Falls (Twin Cities side)
  ["541", "546", "milwaukee"],         // Green Bay, Wausau, La Crosse
  ["547", "548", "minneapolis"],       // Eau Claire, Spooner (border)
  ["549", "549", "milwaukee"],         // Oshkosh
  ["550", "567", "minneapolis"],       // Minnesota
  ["570", "576", "minneapolis"],       // South Dakota (east)
  ["577", "577", "denver"],            // Rapid City
  ["580", "588", "minneapolis"],       // North Dakota

  // ---- Illinois / Missouri / Kansas / Nebraska ----
  ["600", "619", "chicago"],           // Chicago area, Rockford, Peoria, Champaign
  ["620", "620", "st-louis"],
  ["622", "629", "st-louis"],          // Metro East, Springfield IL, Carbondale
  ["630", "639", "st-louis"],
  ["640", "649", "kansas-city"],
  ["650", "652", "st-louis"],          // Jefferson City, Columbia (border)
  ["653", "653", "kansas-city"],
  ["654", "655", "st-louis"],
  ["656", "658", "kansas-city"],       // Springfield MO
  ["660", "676", "kansas-city"],       // Kansas (east and central, Wichita)
  ["677", "677", "denver"],            // NW Kansas
  ["678", "679", "kansas-city"],
  ["680", "689", "kansas-city"],       // Omaha, Lincoln (border)
  ["690", "693", "denver"],            // Western Nebraska

  // ---- South Central ----
  ["700", "708", "new-orleans"],       // New Orleans, Baton Rouge, Lafayette
  ["710", "711", "dallas"],            // Shreveport
  ["712", "714", "new-orleans"],
  ["716", "722", "dallas"],            // South & central Arkansas, Little Rock (border)
  ["723", "723", "nashville"],         // West Memphis
  ["724", "726", "dallas"],
  ["727", "727", "kansas-city"],       // Fayetteville AR (border)
  ["728", "729", "dallas"],
  ["730", "739", "dallas"],            // Oklahoma City, western OK
  ["740", "741", "kansas-city"],       // Tulsa (border)
  ["743", "749", "dallas"],
  ["750", "758", "dallas"],
  ["759", "759", "houston"],           // Lufkin
  ["760", "769", "dallas"],            // Fort Worth, Waco, Abilene
  ["770", "789", "houston"],           // Houston, Beaumont, San Antonio, Austin (border), Corpus Christi
  ["790", "797", "dallas"],            // Amarillo, Lubbock, Midland
  ["798", "799", "phoenix"],           // El Paso (border)

  // ---- Mountain ----
  ["800", "816", "denver"],            // Colorado
  ["820", "831", "denver"],            // Wyoming
  ["832", "837", "salt-lake-city"],    // Idaho (south), Boise
  ["838", "838", "seattle"],           // Coeur d'Alene
  ["840", "847", "salt-lake-city"],    // Utah
  ["850", "865", "phoenix"],           // Arizona (Kingman below)
  ["864", "864", "las-vegas"],         // Kingman (overrides the range above)
  ["870", "871", "phoenix"],           // Albuquerque (border)
  ["873", "875", "denver"],            // Santa Fe (border)
  ["877", "878", "denver"],
  ["879", "880", "phoenix"],           // Las Cruces
  ["881", "884", "dallas"],            // Eastern New Mexico (border)
  ["889", "891", "las-vegas"],
  ["893", "893", "salt-lake-city"],
  ["894", "897", "bay-area"],          // Reno, Carson City
  ["898", "898", "salt-lake-city"],    // Elko

  // ---- Pacific ----
  ["900", "918", "los-angeles"],
  ["919", "921", "san-diego"],
  ["922", "935", "los-angeles"],       // Inland Empire, Orange County, Ventura, Bakersfield
  ["936", "961", "bay-area"],          // Fresno, Salinas, SF, East Bay, San Jose, Sacramento, Redding
  ["970", "979", "portland"],          // Oregon
  ["980", "985", "seattle"],
  ["986", "986", "portland"],          // Vancouver WA
  ["988", "994", "seattle"]            // Central & eastern Washington
];

// Later rows win, so the single-prefix overrides above (356-358, 864) take effect.
const ZIP_PREFIX_TO_MARKET = (() => {
  const map = {};
  for (const [from, to, market] of ZIP_PREFIX_RANGES) {
    for (let p = Number(from); p <= Number(to); p++) map[String(p).padStart(3, "0")] = market;
  }
  return map;
})();

// The last 5-digit group wins: house numbers come first in an address, ZIP last.
function extractZip(text) {
  const matches = String(text || "").match(/(?<!\d)\d{5}(?:-\d{4})?(?!\d)/g);
  return matches ? matches[matches.length - 1].slice(0, 5) : null;
}

// → { zip, marketId } | { zip: null, error: "no_zip" } | { zip, marketId: null, error: "no_market" }
function marketFromAddress(text) {
  const zip = extractZip(text);
  if (!zip) return { zip: null, marketId: null, error: "no_zip" };
  const marketId = ZIP_PREFIX_TO_MARKET[zip.slice(0, 3)] || null;
  return marketId ? { zip, marketId } : { zip, marketId: null, error: "no_market" };
}

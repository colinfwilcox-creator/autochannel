// Snapshot today's live slate (through the Worker) for a golden scenario.
//   NODE_USE_ENV_PROXY=1 node tests/golden-snapshot.js <ISO moment> > games.json
// Uses the engine's own fetcher/normalizer. Games that start after the moment
// are forced back to pre-game so the snapshot reflects that moment.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.join(__dirname, "..");
const ctx = vm.createContext({ console, Date, Math, URL, Intl, fetch, AbortController, setTimeout, clearTimeout });
for (const f of ["config/live.js", "config/channels.js", "modules/fetcher.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
const moment = new Date(process.argv[2]);
(async () => {
  ctx.__now = moment;
  const data = await vm.runInContext("fetchLiveGames(__now)", ctx);
  const games = data.games.map(g => {
    if (new Date(g.scheduledStartTime) > moment && g.espnState !== "pre") {
      return { ...g, espnState: "pre", gameStatus: "scheduled", homeScore: 0, awayScore: 0, period: 0, gamePhase: 0, statusDetail: "" };
    }
    return g;
  });
  process.stdout.write(JSON.stringify({ fetchedAt: new Date().toISOString(), errors: data.errors, games }, null, 1));
})();

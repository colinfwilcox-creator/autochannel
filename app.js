// Main app logic (Phase 5: simple mode)
// Default screen: address + TV count in, one row per TV out, plus "Up next".
// Everything else (setup, Live/Mock, scenarios, scores, states) lives behind "Show details".

const SETUP_STORAGE_KEY = "autochannel.setup.v5";
const MODE_STORAGE_KEY = "autochannel.dataMode";
const ADDRESS_STORAGE_KEY = "autochannel.address";
const TVCOUNT_STORAGE_KEY = "autochannel.tvCount";
const DETAILS_STORAGE_KEY = "autochannel.showDetails";
const DEFAULT_TV_COUNT = 5;

let address = loadString(ADDRESS_STORAGE_KEY, "");
let tvCount = clampTvCount(loadString(TVCOUNT_STORAGE_KEY, String(DEFAULT_TV_COUNT)));
let showDetails = loadString(DETAILS_STORAGE_KEY, "0") === "1";
let addressResult = marketFromAddress(address);
let setup = loadSetup();
let venue = setup.marketId ? buildVenue(setup) : null;
let scenario = "tuesday";
let dataMode = loadDataMode();   // "live" | "mock"
let gameData = null;             // last good data for the current mode only
let liveIssue = null;            // set when the latest live fetch failed fully or partly
let anchorHistory = createAnchorHistory(); // anchor / demotion memory across refreshes
let assignments = null;
let lastUpdateTime = null;
let isLoading = false;
let gameToggleState = {}; // details view: games switched off by hand

// ---------- Storage (per-viewer convenience only; every access guarded) ----------

function loadString(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) { return fallback; }
}

function saveString(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
}

function clampTvCount(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : DEFAULT_TV_COUNT;
}

// ---------- Setup: derived from address + TV count ----------

function defaultAnchors(n) {
  return Array.from({ length: defaultAnchorCount(n) }, (_, i) => i + 1);
}

function deriveSetup() {
  return {
    preset: "simple",
    venueName: "Your venue",
    marketSource: "zip",
    marketId: addressResult.marketId || null,
    totalTVs: tvCount,
    anchorTVs: defaultAnchors(tvCount),
    diehardTV: null,
    lockListOverride: null,
    adjust: {}
  };
}

// A stored setup keeps details-view tweaks (anchors, diehard, preset, market)
// as long as it still matches the address and TV count, or its market was set in details.
function loadSetup() {
  try {
    const raw = localStorage.getItem(SETUP_STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const marketOk = s && MARKETS[s.marketId] &&
        (s.marketSource === "details" || s.marketId === addressResult.marketId);
      if (marketOk && s.totalTVs === tvCount) return s;
    }
  } catch (e) { /* storage unavailable or bad JSON */ }
  return deriveSetup();
}

function saveSetup() {
  saveString(SETUP_STORAGE_KEY, JSON.stringify(setup));
}

function rebuildVenue() {
  const prevMarket = venue && venue.marketId;
  venue = setup.marketId ? buildVenue(setup) : null;
  if (venue) {
    // Write back the normalized values (anchors / diehard may have been corrected).
    setup.totalTVs = venue.setup.totalTVs;
    setup.anchorTVs = venue.setup.anchorTVs;
    setup.diehardTV = venue.setup.diehardTV;
  }
  if (!venue || venue.marketId !== prevMarket) anchorHistory = createAnchorHistory();
  saveSetup();
  reAssignWithCurrentGames();
  render();
}

// Details-view edits.
function presetSetup(id) {
  return { preset: id, marketSource: "details", ...JSON.parse(JSON.stringify(VENUE_PRESETS[id])) };
}

function applySetup(changes, keepPreset = false) {
  setup = { ...setup, ...changes };
  if (!keepPreset) setup.preset = "custom";
  if (setup.preset === "custom") setup.venueName = "Custom venue";
  if (changes.totalTVs) {
    tvCount = clampTvCount(changes.totalTVs);
    saveString(TVCOUNT_STORAGE_KEY, String(tvCount));
  }
  rebuildVenue();
}

// Default-screen edits.
function onAddressInput(value) {
  address = value;
  saveString(ADDRESS_STORAGE_KEY, address);
  addressResult = marketFromAddress(address);
  if (addressResult.marketId && (addressResult.marketId !== setup.marketId || setup.marketSource !== "zip")) {
    setup = { ...deriveSetup() };
    rebuildVenue();
  } else if (!addressResult.marketId && setup.marketSource === "zip" && setup.marketId) {
    setup = { ...deriveSetup() };   // no market → nothing to show until a ZIP is entered
    rebuildVenue();
  } else {
    render();
  }
}

function onTvCountChange(value) {
  tvCount = clampTvCount(value);
  saveString(TVCOUNT_STORAGE_KEY, String(tvCount));
  setup = { ...setup, totalTVs: tvCount, anchorTVs: defaultAnchors(tvCount), diehardTV: null };
  rebuildVenue();
}

// ---------- Data mode ----------

function loadDataMode() {
  if (!PROXY_BASE_URL) return "mock";
  const m = loadString(MODE_STORAGE_KEY, "live");
  return m === "mock" ? "mock" : "live";
}

function setDataMode(mode) {
  if (mode === dataMode || (mode === "live" && !PROXY_BASE_URL)) return;
  dataMode = mode;
  saveString(MODE_STORAGE_KEY, mode);
  // Never carry data across modes: switching to live must not leave mock games on screen.
  gameData = null;
  assignments = null;
  liveIssue = null;
  gameToggleState = {};
  anchorHistory = createAnchorHistory();
  render();
  fetchAndUpdate();
}

// ---------- Cycle ----------

async function fetchAndUpdate() {
  if (isLoading) return;
  isLoading = true;
  const mode = dataMode;
  if (!gameData) updateStatus(mode === "live" ? "Fetching live scores…" : "Loading mock data…");
  try {
    const data = await fetchGames(scenario, mode);
    if (mode !== dataMode) return; // mode changed mid-fetch
    gameData = data;
    const stale = (data.leagues || []).filter(l => l.stale);
    liveIssue = data.errors && data.errors.length
      ? {
          message: `Live fetch failed for ${data.errors.map(e => `${e.sport} (${e.message})`).join(", ")}.`,
          partial: stale.length < (data.leagues || []).length,
          staleSince: stale.length ? new Date(Math.min(...stale.map(l => new Date(l.fetchedAt).getTime()))) : null,
          at: new Date()
        }
      : null;
    reAssignWithCurrentGames();
    render();
  } catch (err) {
    console.error("Update error:", err);
    if (mode !== dataMode) return;
    // Keep the last good data on screen (if any) and say so. No mock fallback.
    liveIssue = { message: `Live fetch failed: ${err.message}.`, partial: false, at: new Date() };
    render();
  } finally {
    isLoading = false;
  }
}

function reAssignWithCurrentGames() {
  if (!gameData || !venue) { assignments = null; return; }
  const activeGames = gameData.games.filter(g => gameToggleState[g.id] !== false);
  assignments = runAssignmentCycle(activeGames, venue, anchorHistory);
  lastUpdateTime = new Date();
}

function toggleGame(gameId) {
  gameToggleState[gameId] = gameToggleState[gameId] === false;
  reAssignWithCurrentGames();
  render();
}

// ---------- Rendering ----------

function render() {
  renderBanner();
  renderStatus();
  renderAddressMessage();
  renderSimple();
  renderDetailsToggle();
  if (showDetails) renderDetails();
}

function renderBanner() {
  const banner = document.getElementById("error-banner");
  if (!banner) return;
  if (dataMode !== "live" || !liveIssue) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  const since = liveIssue.staleSince || (gameData && !liveIssue.partial ? new Date(gameData.timestamp) : null);
  let kept;
  if (!gameData) kept = " No live data has loaded yet, so the TVs are empty.";
  else if (since) kept = ` Showing the last good data${liveIssue.partial ? " for those leagues" : ""} from ${since.toLocaleTimeString()}.`;
  else kept = " Those leagues are missing from the TVs until the next good fetch.";
  banner.hidden = false;
  banner.textContent = `⚠ ${liveIssue.message}${kept} Retrying every 60s.`;
}

function renderStatus() {
  const parts = [];
  if (venue) parts.push(venue.marketName);
  if (dataMode === "mock") parts.push(`MOCK DATA (${MOCK_SCENARIOS[scenario]})`);
  else parts.push(liveIssue && !liveIssue.partial ? "Live · fetch failing" : "Live");
  if (lastUpdateTime && assignments) parts.push(`updated ${lastUpdateTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  updateStatus(parts.join(" · "));
  document.body.classList.toggle("is-mock", dataMode === "mock");
}

function renderAddressMessage() {
  const el = document.getElementById("address-message");
  if (!el) return;
  let text = "", kind = "hint";
  if (setup.marketSource === "details" && venue) {
    text = `Market set in details: ${venue.marketName}.`;
  } else if (!address.trim()) {
    text = "Enter your address or ZIP code to see what to put on each TV.";
  } else if (addressResult.error === "no_zip") {
    text = "Add a 5-digit ZIP code to the address so we can find your local teams.";
    kind = "warn";
  } else if (addressResult.error === "no_market") {
    text = `ZIP ${addressResult.zip} isn't near a market we cover yet. Try a ZIP in the nearest big city.`;
    kind = "warn";
  } else if (venue) {
    text = `Local teams: ${venue.marketName}`;
  }
  el.textContent = text;
  el.className = `address-message is-${kind}`;
  el.hidden = !text;
}

function matchupText(game) {
  return `${shortTeamName(game, "away")} @ ${shortTeamName(game, "home")}`;
}

function isPreGame(game) {
  return game.gameStatus === "scheduled" || game.gameStatus === "pre_game" || game.espnState === "pre";
}

// "ESPN · Bengals @ Commanders · 14–10 · Q2 4:12" or "ESPN · Bengals @ Commanders · 8:15 PM"
function gameLine(game) {
  const ch = game.displayChannel ? `${game.displayChannel} · ` : "";
  if (isPreGame(game)) return `${ch}${matchupText(game)} · ${formatStartTime(game)}`;
  const clock = formatCompactClock(game);
  return `${ch}${matchupText(game)} · ${game.awayScore}–${game.homeScore}${clock ? ` · ${clock}` : ""}`;
}

// "ESPN · Pardon the Interruption", "Golf Channel", or the venue's own pick.
function programLine(p) {
  if (!p) return "Your choice (no unused sports channel)";
  return p.show && p.show !== p.channel ? `${p.channel} · ${p.show}` : p.channel;
}

function renderSimple() {
  const list = document.getElementById("tv-list");
  const upNext = document.getElementById("up-next");
  const upList = document.getElementById("up-next-list");
  const empty = document.getElementById("simple-empty");
  list.innerHTML = "";
  upList.innerHTML = "";
  upNext.hidden = true;
  empty.hidden = true;

  // Keep the TV count input in sync with details-view changes (unless it's being edited).
  const countInput = document.getElementById("tv-count");
  if (countInput && document.activeElement !== countInput) countInput.value = String(venue ? venue.tvs.length : tvCount);

  if (!venue) return;
  if (!assignments) {
    empty.hidden = false;
    empty.textContent = dataMode === "live"
      ? (liveIssue ? "No live scores yet." : "Loading live scores…")
      : "Loading…";
    return;
  }

  for (const tv of venue.tvs) {
    const game = (tv.role === "anchor" ? assignments.anchors : assignments.secondaries)[tv.id];
    const program = assignments.programming[tv.id];
    const li = document.createElement("li");
    li.className = `tv-row${tv.role === "anchor" ? " is-main" : ""}`;
    const label = document.createElement("span");
    label.className = "tv-row-label";
    label.textContent = `TV ${tv.number}${tv.role === "anchor" ? " · Main" : ""}`;
    const what = document.createElement("span");
    what.className = "tv-row-game";
    what.textContent = game ? gameLine(game) : programLine(program);
    if (!game) li.classList.add("is-program");
    if (game) li.dataset.gameId = game.id;
    li.append(label, document.createTextNode(" — "), what);
    list.appendChild(li);
  }

  if (assignments.upNext.length) {
    upNext.hidden = false;
    for (const g of assignments.upNext) {
      const li = document.createElement("li");
      li.dataset.gameId = g.id;
      const time = document.createElement("span");
      time.className = "up-next-time";
      time.textContent = formatStartTime(g);
      li.append(time, document.createTextNode(` ${g.displayChannel ? g.displayChannel + " · " : ""}${matchupText(g)}`));
      upList.appendChild(li);
    }
  }
}

function renderDetailsToggle() {
  const btn = document.getElementById("details-toggle");
  const view = document.getElementById("details-view");
  btn.textContent = showDetails ? "Hide details" : "Show details";
  btn.setAttribute("aria-expanded", String(showDetails));
  view.hidden = !showDetails;
}

// ---------- Details view (everything from Phases 2–4) ----------

function renderDetails() {
  const dashboard = document.getElementById("dashboard");
  const wasOpen = document.getElementById("setup-panel")?.open ?? true;
  dashboard.innerHTML = "";

  if (!venue) {
    dashboard.appendChild(createMarketPicker());
    return;
  }
  dashboard.appendChild(createSetupPanel(wasOpen));
  if (!assignments) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = dataMode === "live" ? (liveIssue ? "No live data yet." : "Loading live scoreboards…") : "Loading…";
    dashboard.appendChild(p);
    return;
  }

  const c = assignments.tierCounts;
  const summary = document.createElement("p");
  summary.className = "details-summary";
  summary.textContent = `${venue.venueName} · ${venue.marketName} · ${venue.tvs.length} TVs (${venue.anchors.length} anchor / ${venue.secondaries.length} secondary) · ` +
    `games: ${c.unavailable} not available in market, ${c.eligible} eligible, ${c.filler} filler, ${c.excluded} excluded · TVs filled from: ${assignments.poolTier}`;
  dashboard.appendChild(summary);
  dashboard.appendChild(createTogglePanel());

  // Anchors
  const anchorsSection = document.createElement("div");
  anchorsSection.className = "tv-section anchors-section";
  const lockNote = assignments.lockGame
    ? ` — LOCK: ${escapeHtml(assignments.lockGame.awayTeam)} @ ${escapeHtml(assignments.lockGame.homeTeam)}`
    : ` — ${assignments.anchorMode} split`;
  anchorsSection.innerHTML = `<h2>ANCHOR TVs (Main)${lockNote}</h2>`;
  const anchorsContainer = document.createElement("div");
  anchorsContainer.className = "tvs-container";
  for (const tv of venue.anchors) {
    anchorsContainer.appendChild(createTVCard(tv, assignments.anchors[tv.id], {
      isRepeat: assignments.repeatMap[tv.id],
      program: assignments.programming[tv.id]
    }));
  }
  anchorsSection.appendChild(anchorsContainer);
  dashboard.appendChild(anchorsSection);

  // Secondaries
  if (venue.secondaries.length) {
    const secondariesSection = document.createElement("div");
    secondariesSection.className = "tv-section secondaries-section";
    const satNote = assignments.lockGame
      ? ` — saturation ${assignments.lockItem.saturation.toFixed(2)} → ${assignments.saturationTarget} TVs`
      : "";
    const diehardNote = venue.diehardId ? "" : " — no diehard screen (S < 4)";
    secondariesSection.innerHTML = `<h2>SECONDARY TVs${satNote}${diehardNote}</h2>`;
    const secondariesContainer = document.createElement("div");
    secondariesContainer.className = "tvs-container";
    for (const tv of venue.secondaries) {
      secondariesContainer.appendChild(createTVCard(tv, assignments.secondaries[tv.id], {
        isSaturated: assignments.saturationMap[tv.id],
        isGuaranteed: assignments.guaranteedMap[tv.id],
        isRepeat: assignments.repeatMap[tv.id],
        program: assignments.programming[tv.id]
      }));
    }
    secondariesSection.appendChild(secondariesContainer);
    dashboard.appendChild(secondariesSection);
  }

  dashboard.appendChild(createScoresTable());
}

function createMarketPicker() {
  const box = document.createElement("div");
  box.className = "setup-panel";
  box.innerHTML = `<p class="setup-hint">No market yet. Enter a ZIP above, or pick a venue preset or market here.</p>
    <div class="setup-grid">
      <label>Preset <select id="pick-preset"><option value="">—</option>${Object.entries(VENUE_PRESETS)
        .map(([id, p]) => `<option value="${id}">${escapeHtml(p.venueName)}</option>`).join("")}</select></label>
      <label>Market <select id="pick-market"><option value="">—</option>${Object.entries(MARKETS)
        .sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([id, m]) => `<option value="${id}">${escapeHtml(m.name)}</option>`).join("")}</select></label>
    </div>`;
  box.querySelector("#pick-preset").addEventListener("change", e => {
    if (!e.target.value) return;
    setup = presetSetup(e.target.value);
    applySetup({ totalTVs: setup.totalTVs }, true);
  });
  box.querySelector("#pick-market").addEventListener("change", e => {
    if (!e.target.value) return;
    applySetup({ marketId: e.target.value, marketSource: "details" });
  });
  return box;
}

const TIER_ORDER = { eligible: 0, filler: 1, excluded: 2, unavailable: 3 };
const TIER_LABEL = { eligible: "eligible", filler: "filler", excluded: "excluded", unavailable: "not available in market" };

function channelSummary(g) {
  if (g.displayChannel) return g.displayChannel + (g.channelSource === "regional" ? " (regional)" : "");
  const on = [...(g.nationalChannels || []), ...(g.regionalChannels || []).map(r => r.channel), ...(g.streamingChannels || [])];
  return on.length ? on.join(", ") : "—";
}

function createScoresTable() {
  const scoresSection = document.createElement("div");
  scoresSection.className = "tv-section scores-section";
  scoresSection.innerHTML = "<h2>ALL GAMES: TIERS & CHANNEL SCORES</h2>";
  const scoresContainer = document.createElement("div");
  scoresContainer.className = "scores-table";
  const rows = [...assignments.catalog].sort((a, b) =>
    (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || ((b.channelScore ?? -1) - (a.channelScore ?? -1)));
  const num = (v, d = 1) => (typeof v === "number" ? v.toFixed(d) : "—");
  scoresContainer.innerHTML = "<table>" +
    "<thead><tr><th>Tier</th><th>Channel</th><th>Sport</th><th>Matchup</th><th>Score</th><th>Clock</th><th>Now?</th><th>Base</th><th>Relevance</th><th>Vitality</th><th>Channel Score</th><th>State</th><th>Why</th></tr></thead>" +
    "<tbody>" +
    rows.map(g => `
      <tr class="tier-row tier-${g.tier}">
        <td><span class="tier-label ${g.tier}">${TIER_LABEL[g.tier]}</span></td>
        <td>${escapeHtml(channelSummary(g))}</td>
        <td class="sport-badge ${g.sport.toLowerCase()}">${g.sport}</td>
        <td>${escapeHtml(g.awayTeam)} @ ${escapeHtml(g.homeTeam)}</td>
        <td>${g.awayScore}-${g.homeScore}</td>
        <td>${escapeHtml(formatGameClock(g))}</td>
        <td>${g.watchableNow ? "now" : "later"}</td>
        <td>${g.baseScore ?? "—"}</td>
        <td>${num(g.relevance)}</td>
        <td>${num(g.vitality)}</td>
        <td class="channel-score"><strong>${num(g.channelScore)}</strong></td>
        <td>${g.anchorState ? g.anchorState.toUpperCase() : ""}</td>
        <td class="tier-reason">${escapeHtml(g.tierReason || "")}</td>
      </tr>
    `).join("") +
    "</tbody></table>";
  scoresSection.appendChild(scoresContainer);
  return scoresSection;
}

function createSetupPanel(open) {
  const panel = document.createElement("details");
  panel.id = "setup-panel";
  panel.className = "setup-panel";
  panel.open = open;

  const marketOptions = Object.entries(MARKETS)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, m]) => `<option value="${id}" ${id === venue.marketId ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
    .join("");
  const presetOptions = `<option value="simple" ${setup.preset === "simple" ? "selected" : ""}>From address (default)</option>` +
    Object.entries(VENUE_PRESETS)
      .map(([id, p]) => `<option value="${id}" ${setup.preset === id ? "selected" : ""}>${escapeHtml(p.venueName)}</option>`)
      .join("") + `<option value="custom" ${setup.preset === "custom" ? "selected" : ""}>Custom</option>`;
  const modeDisabled = !PROXY_BASE_URL;
  const modeControl = `
    <div class="mode-toggle" role="group" aria-label="Data source">
      <button type="button" data-mode="live" class="${dataMode === "live" ? "is-on" : ""}" ${modeDisabled ? "disabled" : ""} aria-pressed="${dataMode === "live"}">Live</button>
      <button type="button" data-mode="mock" class="${dataMode === "mock" ? "is-on" : ""}" aria-pressed="${dataMode === "mock"}">Mock</button>
    </div>
    ${modeDisabled ? `<span class="setup-hint">Live needs PROXY_BASE_URL in config/live.js</span>` : ""}`;
  const feedRows = dataMode === "live" && gameData && gameData.leagues
    ? gameData.leagues.map(l => `<li><span>${l.sport}${l.stale ? " (stale)" : ""}</span><span>${l.returned} returned · ${l.games.length} live/upcoming${l.failures.length ? ` · <strong>${l.failures.length} failed</strong>` : ""}</span></li>`).join("") +
      (gameData.errors || []).filter(e => !gameData.leagues.some(l => l.sport === e.sport)).map(e => `<li><span>${e.sport}</span><span><strong>error:</strong> ${escapeHtml(e.message)}</span></li>`).join("")
    : "";
  const scenarioOptions = Object.entries(MOCK_SCENARIOS)
    .map(([id, label]) => `<option value="${id}" ${scenario === id ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");

  const chips = venue.tvs.map(tv => `
    <button type="button" class="tv-chip ${tv.role === "anchor" ? "is-anchor" : ""} ${tv.isDiehard ? "is-diehard" : ""}"
            data-tv="${tv.number}" aria-pressed="${tv.role === "anchor"}">${tv.number}</button>`).join("");

  const diehardControl = venue.secondaries.length >= 4
    ? `<select id="setup-diehard">${venue.secondaries.map(tv =>
        `<option value="${tv.number}" ${tv.isDiehard ? "selected" : ""}>${tv.label} (TV ${tv.number})</option>`).join("")}</select>`
    : `<span class="setup-hint">None: fewer than 4 secondaries. A demoted game drops to the lowest-scoring secondary.</span>`;

  const lockRows = venue.lockList.map((item, i) => `
    <li><span class="lock-rank">${i + 1}</span>
      <span class="lock-name">${escapeHtml(item.team || item.event)}</span>
      <span class="lock-trigger">${item.trigger.replace("_", " ")}</span>
      <span class="lock-sat">sat ${item.saturation.toFixed(2)}</span></li>`).join("");

  const tableRows = Object.entries(venue.teamTable).sort((a, b) => b[1] - a[1])
    .map(([t, v]) => `<li><span>${escapeHtml(t)}</span><span>${v}</span></li>`).join("");
  const flags = (venue.market.flags || [])
    .map(f => `<li><strong>${escapeHtml(f.team)}</strong>: ${escapeHtml(f.issue)}</li>`).join("");

  const A = venue.anchors.length;
  const defaultA = defaultAnchorCount(venue.tvs.length);

  panel.innerHTML = `
    <summary><h2>VENUE SETUP</h2><span class="setup-summary">${escapeHtml(venue.marketName)} · ${venue.tvs.length} TVs · ${A} anchor${A === 1 ? "" : "s"}</span></summary>
    <div class="setup-grid">
      <label>Preset <select id="setup-preset">${presetOptions}</select></label>
      <label>Market <select id="setup-market">${marketOptions}</select></label>
      <label>Total TVs <input id="setup-total" type="number" min="1" max="20" value="${venue.tvs.length}"></label>
      <label>Mock scenario <select id="setup-scenario" ${dataMode === "live" ? "disabled" : ""}>${scenarioOptions}</select></label>
    </div>
    <div class="setup-block">
      <div class="setup-label">Data source</div>
      ${modeControl}
      ${feedRows ? `<ul class="team-table feed-status">${feedRows}</ul>` : ""}
    </div>
    <div class="setup-block">
      <div class="setup-label">Anchor TVs: tap to mark (${A} of ${venue.tvs.length}, default ${defaultA})
        <button type="button" id="setup-default-anchors" class="setup-link">Reset to default</button></div>
      <div class="tv-chips">${chips}</div>
    </div>
    <div class="setup-block">
      <div class="setup-label">Diehard screen</div>
      ${diehardControl}
    </div>
    <div class="setup-columns">
      <div class="setup-block">
        <div class="setup-label">Lock list (priority order, auto-generated)</div>
        <ol class="lock-list">${lockRows}</ol>
      </div>
      <div class="setup-block">
        <div class="setup-label">Market team table</div>
        <ul class="team-table">${tableRows}</ul>
        <div class="setup-hint">National draws 40 · national programs 35 · everyone else 15</div>
      </div>
    </div>
    <div class="setup-block">
      <div class="setup-label">Regional channels in this market (rsns)</div>
      <div class="setup-hint">${venue.market.rsns && venue.market.rsns.length ? venue.market.rsns.map(escapeHtml).join(" · ") : "None listed: only national-channel games are available here."}</div>
    </div>
    ${flags ? `<details class="setup-flags"><summary>${venue.market.flags.length} flagged team${venue.market.flags.length === 1 ? "" : "s"} in this market</summary><ul>${flags}</ul></details>` : ""}
  `;

  panel.querySelector("#setup-preset").addEventListener("change", e => {
    const v = e.target.value;
    if (v === "custom") { applySetup({}, false); return; }
    if (v === "simple") { setup = deriveSetup(); rebuildVenue(); return; }
    setup = presetSetup(v);
    applySetup({ totalTVs: setup.totalTVs }, true);
  });
  panel.querySelector("#setup-market").addEventListener("change", e => applySetup({ marketId: e.target.value, marketSource: "details" }));
  panel.querySelector("#setup-total").addEventListener("change", e => {
    const n = clampTvCount(e.target.value);
    applySetup({ totalTVs: n, anchorTVs: defaultAnchors(n), diehardTV: null });
  });
  panel.querySelectorAll(".mode-toggle button").forEach(b =>
    b.addEventListener("click", () => setDataMode(b.dataset.mode)));
  panel.querySelector("#setup-scenario").addEventListener("change", e => {
    scenario = e.target.value;
    gameToggleState = {};
    anchorHistory = createAnchorHistory();
    gameData = null;
    assignments = null;
    fetchAndUpdate();
  });
  panel.querySelector("#setup-default-anchors").addEventListener("click", () => {
    applySetup({ anchorTVs: defaultAnchors(venue.tvs.length), diehardTV: null });
  });
  panel.querySelectorAll(".tv-chip").forEach(chip => chip.addEventListener("click", () => {
    const n = Number(chip.dataset.tv);
    const current = new Set(venue.setup.anchorTVs);
    if (current.has(n)) current.delete(n); else current.add(n);
    // Keep 1 ≤ A < N.
    if (current.size < 1 || current.size >= venue.tvs.length) return;
    const diehard = venue.setup.diehardTV === n ? null : venue.setup.diehardTV;
    applySetup({ anchorTVs: [...current], diehardTV: diehard });
  }));
  const dh = panel.querySelector("#setup-diehard");
  if (dh) dh.addEventListener("change", e => applySetup({ diehardTV: Number(e.target.value) }));

  return panel;
}

function createTogglePanel() {
  const panel = document.createElement("details");
  panel.className = "toggle-panel";
  panel.innerHTML = `<summary class="toggle-panel-header"><h2>GAME CONTROL PANEL (Click to Toggle)</h2></summary>`;
  const gamesContainer = document.createElement("div");
  gamesContainer.className = "toggle-games-container";

  // Games switched off aren't in the catalog; classify (and score, if not excluded) them for display.
  const byId = new Map(assignments.catalog.map(g => [g.id, g]));
  const all = gameData.games.map(g => {
    if (byId.has(g.id)) return byId.get(g.id);
    const c = { ...g, ...classifyGame(g, venue) };
    return c.tier === "excluded" ? c : scoreGames([c], venue)[0];
  }).sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || ((b.channelScore || 0) - (a.channelScore || 0)));

  for (const game of all) {
    const isActive = gameToggleState[game.id] !== false;
    const item = document.createElement("div");
    item.className = `toggle-item ${isActive ? "active" : "inactive"}`;

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "toggle-switch";
    toggle.checked = isActive;
    toggle.addEventListener("change", () => toggleGame(game.id));

    const label = document.createElement("label");
    label.className = "toggle-label";
    label.innerHTML = `
      <span class="game-info">
        <span class="sport-badge-small ${game.sport.toLowerCase()}">${game.sport}</span>
        <span class="matchup-text">${escapeHtml(game.awayTeam)} @ ${escapeHtml(game.homeTeam)}</span>
        <span class="tier-label ${game.tier}">${TIER_LABEL[game.tier]}</span>
        <span class="score-text">${game.awayScore}-${game.homeScore}</span>
        <span class="channel-score-small">${typeof game.channelScore === "number" ? game.channelScore.toFixed(1) : "—"}</span>
      </span>`;
    item.appendChild(toggle);
    item.appendChild(label);
    gamesContainer.appendChild(item);
  }
  panel.appendChild(gamesContainer);
  return panel;
}

function createTVCard(tv, game, opts) {
  const { isSaturated = false, isGuaranteed = false, isRepeat = false, program = null } = opts;
  const card = document.createElement("div");
  let cardClass = `tv-card tv-${tv.role}`;
  if (tv.isDiehard) cardClass += " tv-diehard";
  if (!game) cardClass += " tv-fallback";
  card.className = cardClass;

  const title = `${tv.label.toUpperCase()}${tv.isDiehard ? " — Diehard" : ""} <span class="tv-number">TV ${tv.number}</span>`;

  if (!game) {
    const fallbackDisplay = program
      ? `<div class="fallback-content"><span class="fallback-label">📺 ${program.source === "grid" ? `grid · priority ${program.priority}${program.verify ? " · verify" : ""}` : "always-available"}</span>
           <span class="fallback-channel">${escapeHtml(program.channel)}</span>${program.show && program.show !== program.channel ? `<span class="program-show">${escapeHtml(program.show)}</span>` : ""}</div>`
      : `<div class="no-content">No unused sports channel — venue's choice</div>`;
    card.innerHTML = `<div class="tv-id">${title}</div>${fallbackDisplay}`;
    return card;
  }

  const isLocked = assignments.lockGame && game.id === assignments.lockGame.id;
  const satBadge = isSaturated ? `<span class="sat-badge">SAT</span>` : "";
  const lockBadge = isLocked ? `<span class="lock-badge">🔒 LOCKED</span>` : "";
  const guaranteeBadge = isGuaranteed ? `<span class="sat-badge">LOCK LIST</span>` : "";
  const repeatBadge = isRepeat ? `<span class="sat-badge">REPEAT</span>` : "";
  const fillerBadge = game.tier === "filler" ? `<span class="tier-label filler">filler</span>` : "";
  const stateLabel = game.anchorState ? `<span class="state-label ${game.anchorState}">${game.anchorState.toUpperCase()}</span>` : "";

  card.innerHTML = `
    <div class="tv-header">
      <div class="tv-id">${title}</div>
      <div class="tv-badges">${satBadge}${guaranteeBadge}${repeatBadge}${lockBadge}${fillerBadge}</div>
    </div>
    <div class="game-content">
      <div class="matchup">
        <div class="team away">${escapeHtml(game.awayTeam)}</div>
        <div class="score">${game.awayScore}</div>
      </div>
      <div class="vs">vs</div>
      <div class="matchup">
        <div class="team home">${escapeHtml(game.homeTeam)}</div>
        <div class="score">${game.homeScore}</div>
      </div>
    </div>
    <div class="game-meta">
      <div class="status">${escapeHtml(game.displayChannel || "")}${game.channelSource === "regional" ? " (regional)" : ""} • ${escapeHtml(game.gameStatus)} • ${escapeHtml(formatGameClock(game))}</div>
      <div class="scores">
        <span class="label">Channel Score:</span>
        <span class="value">${game.channelScore.toFixed(1)}</span>
      </div>
      <div class="scores small">
        <span>Base: ${game.baseScore}</span>
        <span>Rel: ${game.relevance.toFixed(0)}</span>
        <span>Vit: ${game.vitality.toFixed(0)}</span>
      </div>
      ${stateLabel}
    </div>`;
  return card;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function updateStatus(text) {
  const status = document.getElementById("status");
  if (status) status.textContent = text;
}

// ---------- Start ----------

function wireInputs() {
  const addr = document.getElementById("address");
  const count = document.getElementById("tv-count");
  addr.value = address;
  count.value = String(tvCount);
  addr.addEventListener("input", e => onAddressInput(e.target.value));
  count.addEventListener("change", e => onTvCountChange(e.target.value));
  count.addEventListener("input", e => {
    if (e.target.value !== "" && clampTvCount(e.target.value) !== tvCount) onTvCountChange(e.target.value);
  });
  document.getElementById("simple-form").addEventListener("submit", e => e.preventDefault());
  document.getElementById("details-toggle").addEventListener("click", () => {
    showDetails = !showDetails;
    saveString(DETAILS_STORAGE_KEY, showDetails ? "1" : "0");
    render();
  });
}

// Scripts are added by the versioned loader in index.html, so DOMContentLoaded
// may already have fired by the time this runs.
function startApp() {
  wireInputs();
  render();
  fetchAndUpdate();
  setInterval(fetchAndUpdate, 60000);
}
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}

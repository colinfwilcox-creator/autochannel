// Main app logic (Phase 3)
// Venue setup → fetch → resolve locks → score → assign → render.

const SETUP_STORAGE_KEY = "autochannel.setup.v3";

let setup = loadSetup();
let venue = buildVenue(setup);
let scenario = "tuesday";
let gameData = null;
let assignments = null;
let lastUpdateTime = null;
let isLoading = false;
let gameToggleState = {}; // Track which games are toggled on/off

// ---------- Setup persistence (per-viewer convenience only) ----------

function presetSetup(id) {
  return { preset: id, ...JSON.parse(JSON.stringify(VENUE_PRESETS[id])) };
}

function loadSetup() {
  try {
    const raw = localStorage.getItem(SETUP_STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && MARKETS[s.marketId]) return s;
    }
  } catch (e) { /* storage unavailable */ }
  return presetSetup("barking-dog");
}

function saveSetup() {
  try { localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(setup)); } catch (e) { /* ignore */ }
}

function applySetup(changes, keepPreset = false) {
  setup = { ...setup, ...changes };
  if (!keepPreset) setup.preset = "custom";
  if (setup.preset === "custom") setup.venueName = "Custom venue";
  venue = buildVenue(setup);
  // Write back the normalized values (anchors / diehard may have been corrected).
  setup.totalTVs = venue.setup.totalTVs;
  setup.anchorTVs = venue.setup.anchorTVs;
  setup.diehardTV = venue.setup.diehardTV;
  saveSetup();
  reAssignWithCurrentGames();
}

// ---------- Cycle ----------

async function fetchAndUpdate() {
  if (isLoading) return;
  isLoading = true;
  updateStatus("Fetching and scoring...");
  try {
    gameData = await fetchGames(scenario);
    gameData.games.forEach(g => {
      if (!(g.id in gameToggleState)) gameToggleState[g.id] = true;
    });
    reAssignWithCurrentGames();
  } catch (err) {
    console.error("Update error:", err);
    updateStatus(`Error: ${err.message}`);
  } finally {
    isLoading = false;
  }
}

function reAssignWithCurrentGames() {
  if (!gameData) return;
  const activeGames = gameData.games.filter(g => gameToggleState[g.id] !== false);
  assignments = runAssignmentCycle(activeGames, venue);
  // Scores for the toggle panel, including games switched off.
  assignments.allGamesWithToggle = scoreGames(gameData.games, venue);
  lastUpdateTime = new Date();
  displayDashboard();
}

function toggleGame(gameId) {
  gameToggleState[gameId] = !gameToggleState[gameId];
  reAssignWithCurrentGames();
}

// ---------- Rendering ----------

function displayDashboard() {
  const dashboard = document.getElementById("dashboard");
  if (!assignments) {
    dashboard.innerHTML = "<p>No data yet</p>";
    return;
  }

  const activeGameCount = Object.values(gameToggleState).filter(v => v !== false).length;
  updateStatus(`${activeGameCount} active games at ${lastUpdateTime.toLocaleTimeString()}`);
  document.getElementById("venue-name").textContent =
    `${venue.venueName} · ${venue.marketName} · ${venue.tvs.length} TVs (${venue.anchors.length} anchor / ${venue.secondaries.length} secondary)`;

  // Keep the setup panel's open/closed state across re-renders.
  const wasOpen = document.getElementById("setup-panel")?.open || false;
  dashboard.innerHTML = "";
  dashboard.appendChild(createSetupPanel(wasOpen));
  dashboard.appendChild(createTogglePanel());

  // Anchors
  const anchorsSection = document.createElement("div");
  anchorsSection.className = "tv-section anchors-section";
  const lockNote = assignments.lockGame
    ? ` — LOCK: ${escapeHtml(assignments.lockGame.awayTeam)} @ ${escapeHtml(assignments.lockGame.homeTeam)}`
    : ` — ${assignments.anchorMode} split`;
  anchorsSection.innerHTML = `<h2>ANCHOR TVs (Behind Bar)${lockNote}</h2>`;
  const anchorsContainer = document.createElement("div");
  anchorsContainer.className = "tvs-container";
  for (const tv of venue.anchors) {
    anchorsContainer.appendChild(createTVCard(tv, assignments.anchors[tv.id], {}));
  }
  anchorsSection.appendChild(anchorsContainer);
  dashboard.appendChild(anchorsSection);

  // Secondaries
  const secondariesSection = document.createElement("div");
  secondariesSection.className = "tv-section secondaries-section";
  const satNote = assignments.lockGame
    ? ` — saturation ${assignments.lockItem.saturation.toFixed(2)} → ${assignments.saturationTarget} TVs`
    : "";
  const diehardNote = venue.diehardId ? "" : " — no diehard screen (S < 4)";
  secondariesSection.innerHTML = `<h2>SECONDARY TVs (Throughout Venue)${satNote}${diehardNote}</h2>`;
  const secondariesContainer = document.createElement("div");
  secondariesContainer.className = "tvs-container";
  for (const tv of venue.secondaries) {
    secondariesContainer.appendChild(createTVCard(tv, assignments.secondaries[tv.id], {
      isSaturated: assignments.saturationMap[tv.id],
      isGuaranteed: assignments.guaranteedMap[tv.id],
      fallbackChannel: assignments.fallbackChannels[tv.id]
    }));
  }
  secondariesSection.appendChild(secondariesContainer);
  dashboard.appendChild(secondariesSection);

  // Scores table
  const scoresSection = document.createElement("div");
  scoresSection.className = "tv-section scores-section";
  scoresSection.innerHTML = "<h2>GAME SCORES & CHANNEL SCORES</h2>";
  const scoresContainer = document.createElement("div");
  scoresContainer.className = "scores-table";
  const sorted = [...assignments.allGames].sort((a, b) => b.channelScore - a.channelScore);
  scoresContainer.innerHTML = "<table>" +
    "<thead><tr><th>Sport</th><th>Matchup</th><th>Score</th><th>Clock</th><th>Base</th><th>Relevance</th><th>Vitality</th><th>Channel Score</th><th>State</th></tr></thead>" +
    "<tbody>" +
    sorted.map(g => `
      <tr>
        <td class="sport-badge ${g.sport.toLowerCase()}">${g.sport}</td>
        <td>${escapeHtml(g.awayTeam)} @ ${escapeHtml(g.homeTeam)}</td>
        <td>${g.awayScore}-${g.homeScore}</td>
        <td>${escapeHtml(formatGameClock(g))}</td>
        <td>${g.baseScore}</td>
        <td>${g.relevance.toFixed(1)}</td>
        <td>${g.vitality.toFixed(1)}</td>
        <td class="channel-score"><strong>${g.channelScore.toFixed(1)}</strong></td>
        <td>${g.anchorState ? g.anchorState.toUpperCase() : ""}</td>
      </tr>
    `).join("") +
    "</tbody></table>";
  scoresSection.appendChild(scoresContainer);
  dashboard.appendChild(scoresSection);
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
  const presetOptions = Object.entries(VENUE_PRESETS)
    .map(([id, p]) => `<option value="${id}" ${setup.preset === id ? "selected" : ""}>${escapeHtml(p.venueName)}</option>`)
    .join("") + `<option value="custom" ${setup.preset === "custom" ? "selected" : ""}>Custom</option>`;
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

  const table = buildTeamTable(venue.market);
  const tableRows = Object.entries(table).sort((a, b) => b[1] - a[1])
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
      <label>Total TVs <input id="setup-total" type="number" min="2" max="40" value="${venue.tvs.length}"></label>
      <label>Mock data <select id="setup-scenario">${scenarioOptions}</select></label>
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
    ${flags ? `<details class="setup-flags"><summary>${venue.market.flags.length} flagged team${venue.market.flags.length === 1 ? "" : "s"} in this market</summary><ul>${flags}</ul></details>` : ""}
  `;

  panel.querySelector("#setup-preset").addEventListener("change", e => {
    if (e.target.value === "custom") { applySetup({}, false); return; }
    setup = presetSetup(e.target.value);
    applySetup({}, true);
  });
  panel.querySelector("#setup-market").addEventListener("change", e => applySetup({ marketId: e.target.value }));
  panel.querySelector("#setup-total").addEventListener("change", e => {
    const n = Math.max(2, Math.min(40, parseInt(e.target.value, 10) || 2));
    const a = defaultAnchorCount(n);
    applySetup({ totalTVs: n, anchorTVs: Array.from({ length: a }, (_, i) => i + 1), diehardTV: null });
  });
  panel.querySelector("#setup-scenario").addEventListener("change", e => {
    scenario = e.target.value;
    gameToggleState = {};
    fetchAndUpdate();
  });
  panel.querySelector("#setup-default-anchors").addEventListener("click", () => {
    applySetup({ anchorTVs: Array.from({ length: defaultA }, (_, i) => i + 1), diehardTV: null });
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
  const panel = document.createElement("div");
  panel.className = "toggle-panel";
  panel.innerHTML = `<div class="toggle-panel-header"><h2>GAME CONTROL PANEL (Click to Toggle)</h2></div>`;
  const gamesContainer = document.createElement("div");
  gamesContainer.className = "toggle-games-container";

  const sorted = [...assignments.allGamesWithToggle].sort((a, b) => (b.channelScore || 0) - (a.channelScore || 0));
  for (const game of sorted) {
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
        <span class="score-text">${game.awayScore}-${game.homeScore}</span>
        <span class="channel-score-small">${game.channelScore ? game.channelScore.toFixed(1) : "—"}</span>
      </span>`;
    item.appendChild(toggle);
    item.appendChild(label);
    gamesContainer.appendChild(item);
  }
  panel.appendChild(gamesContainer);
  return panel;
}

function createTVCard(tv, game, opts) {
  const { isSaturated = false, isGuaranteed = false, fallbackChannel = null } = opts;
  const card = document.createElement("div");
  let cardClass = `tv-card tv-${tv.role}`;
  if (tv.isDiehard) cardClass += " tv-diehard";
  if (!game && fallbackChannel) cardClass += " tv-fallback";
  card.className = cardClass;

  const title = `${tv.label.toUpperCase()}${tv.isDiehard ? " — Diehard" : ""} <span class="tv-number">TV ${tv.number}</span>`;

  if (!game) {
    const fallbackDisplay = fallbackChannel
      ? `<div class="fallback-content"><span class="fallback-label">📺</span><span class="fallback-channel">${escapeHtml(fallbackChannel)}</span></div>`
      : `<div class="no-content">Empty</div>`;
    card.innerHTML = `<div class="tv-id">${title}</div>${fallbackDisplay}`;
    return card;
  }

  const isLocked = assignments.lockGame && game.id === assignments.lockGame.id;
  const satBadge = isSaturated ? `<span class="sat-badge">SAT</span>` : "";
  const lockBadge = isLocked ? `<span class="lock-badge">🔒 LOCKED</span>` : "";
  const guaranteeBadge = isGuaranteed ? `<span class="sat-badge">LOCK LIST</span>` : "";
  const stateLabel = game.anchorState ? `<span class="state-label ${game.anchorState}">${game.anchorState.toUpperCase()}</span>` : "";

  card.innerHTML = `
    <div class="tv-header">
      <div class="tv-id">${title}</div>
      <div class="tv-badges">${satBadge}${guaranteeBadge}${lockBadge}</div>
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
      <div class="status">${escapeHtml(game.gameStatus)} • ${escapeHtml(formatGameClock(game))}</div>
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

window.addEventListener("DOMContentLoaded", () => {
  fetchAndUpdate();
  setInterval(fetchAndUpdate, 60000);
});

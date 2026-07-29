// Phase 2: Main app logic
// Coordinates fetching, scoring, and TV assignment display

let gameData = null;
let assignments = null;
let lastUpdateTime = null;
let isLoading = false;
let gameToggleState = {}; // Track which games are toggled on/off

function getAnchorState(game) {
  if (!game) return null;
  if (game.gameStatus === "final") return "finished";
  if (game.gamePhase > VENUE_CONFIG.thresholds.completionProtectionPhase &&
      game.channelScore >= VENUE_CONFIG.thresholds.completionProtectionMinScore) {
    return "protected";
  }
  if (game.channelScore < VENUE_CONFIG.thresholds.blowoutDemotion) {
    return "demoted";
  }
  return "active";
}

async function fetchAndUpdate() {
  if (isLoading) return;

  isLoading = true;
  updateStatus("Fetching and scoring...");

  try {
    // Fetch games
    gameData = await fetchGames();

    // Initialize toggle state for new games
    gameData.games.forEach(g => {
      if (!(g.id in gameToggleState)) {
        gameToggleState[g.id] = true; // default: all games on
      }
    });

    // Filter games by toggle state
    const activeGames = gameData.games.filter(g => gameToggleState[g.id] !== false);

    // Score each game
    const scoredGames = scoreGames(activeGames);

    // Add anchor states
    const scoredWithState = scoredGames.map(g => ({
      ...g,
      anchorState: getAnchorState(g)
    }));

    // Create TV assignments
    assignments = createTVAssignments(scoredWithState, VENUE_CONFIG);

    // Store full game data for toggle panel (includes disabled games)
    assignments.allGamesWithToggle = gameData.games;

    lastUpdateTime = new Date();
    displayDashboard();
  } catch (err) {
    console.error("Update error:", err);
    updateStatus(`Error: ${err.message}`);
  } finally {
    isLoading = false;
  }
}

function displayDashboard() {
  if (!assignments) {
    document.getElementById("dashboard").innerHTML = "<p>No data yet</p>";
    return;
  }

  const activeGameCount = Object.values(gameToggleState).filter(v => v !== false).length;
  const statusText = `${activeGameCount} active games at ${lastUpdateTime.toLocaleTimeString()}`;
  document.getElementById("status").textContent = statusText;

  // Render TV layout
  const dashboard = document.getElementById("dashboard");
  dashboard.innerHTML = "";

  // Render toggle panel
  const togglePanel = createTogglePanel();
  dashboard.appendChild(togglePanel);

  // Anchor TVs section
  const anchorsSection = document.createElement("div");
  anchorsSection.className = "tv-section anchors-section";
  anchorsSection.innerHTML = "<h2>ANCHOR TVs (Behind Bar)</h2>";
  const anchorsContainer = document.createElement("div");
  anchorsContainer.className = "tvs-container";

  for (const [tvId, game] of Object.entries(assignments.anchors)) {
    anchorsContainer.appendChild(createTVCard(tvId, game, "anchor", VENUE_CONFIG));
  }

  anchorsSection.appendChild(anchorsContainer);
  dashboard.appendChild(anchorsSection);

  // Secondary TVs section
  const secondariesSection = document.createElement("div");
  secondariesSection.className = "tv-section secondaries-section";
  secondariesSection.innerHTML = "<h2>SECONDARY TVs (Throughout Venue)</h2>";
  const secondariesContainer = document.createElement("div");
  secondariesContainer.className = "tvs-container";

  const diehardId = getDiehardScreenId(VENUE_CONFIG);
  for (const [tvId, game] of Object.entries(assignments.secondaries)) {
    const isSaturated = assignments.saturationMap[tvId];
    const isDiehard = tvId === diehardId;
    secondariesContainer.appendChild(createTVCard(tvId, game, "secondary", VENUE_CONFIG, isSaturated, isDiehard));
  }

  secondariesSection.appendChild(secondariesContainer);
  dashboard.appendChild(secondariesSection);

  // Game scores reference table
  const scoresSection = document.createElement("div");
  scoresSection.className = "tv-section scores-section";
  scoresSection.innerHTML = "<h2>GAME SCORES & CHANNEL SCORES</h2>";
  const scoresContainer = document.createElement("div");
  scoresContainer.className = "scores-table";

  const sorted = [...assignments.allGames].sort((a, b) => b.channelScore - a.channelScore);
  scoresContainer.innerHTML = "<table>" +
    "<thead><tr><th>Sport</th><th>Matchup</th><th>Score</th><th>Status</th><th>Relevance</th><th>Vitality</th><th>Channel Score</th></tr></thead>" +
    "<tbody>" +
    sorted.map(g => `
      <tr>
        <td class="sport-badge ${g.sport.toLowerCase()}">${g.sport}</td>
        <td>${g.awayTeam} @ ${g.homeTeam}</td>
        <td>${g.awayScore}-${g.homeScore}</td>
        <td>${g.gameStatus}</td>
        <td>${g.relevance.toFixed(1)}</td>
        <td>${g.vitality.toFixed(1)}</td>
        <td class="channel-score"><strong>${g.channelScore.toFixed(1)}</strong></td>
      </tr>
    `).join("") +
    "</tbody></table>";

  scoresSection.appendChild(scoresContainer);
  dashboard.appendChild(scoresSection);
}

function createTogglePanel() {
  const panel = document.createElement("div");
  panel.className = "toggle-panel";

  const header = document.createElement("div");
  header.className = "toggle-panel-header";
  header.innerHTML = "<h2>GAME CONTROL PANEL (Click to Toggle)</h2>";
  panel.appendChild(header);

  const gamesContainer = document.createElement("div");
  gamesContainer.className = "toggle-games-container";

  // Sort games by channel score
  const sorted = [...assignments.allGamesWithToggle].sort((a, b) => {
    const aScore = a.channelScore || 0;
    const bScore = b.channelScore || 0;
    return bScore - aScore;
  });

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
        <span class="matchup-text">${game.awayTeam} @ ${game.homeTeam}</span>
        <span class="score-text">${game.awayScore}-${game.homeScore}</span>
        <span class="channel-score-small">${game.channelScore ? game.channelScore.toFixed(1) : "—"}</span>
      </span>
    `;

    item.appendChild(toggle);
    item.appendChild(label);
    gamesContainer.appendChild(item);
  }

  panel.appendChild(gamesContainer);
  return panel;
}

function createTVCard(tvId, game, tvType, venueConfig, isSaturated = false, isDiehard = false) {
  const card = document.createElement("div");
  let cardClass = `tv-card tv-${tvType}`;
  if (isDiehard) cardClass += " tv-diehard";
  card.className = cardClass;

  if (!game) {
    card.innerHTML = `<div class="tv-id">${tvId}${isDiehard ? ' — Diehard Screen' : ''}</div><div class="no-content">Empty</div>`;
    return card;
  }

  const isLocked = assignments.lockGame && game.id === assignments.lockGame.id;
  const satBadge = isSaturated ? `<span class="sat-badge">SAT</span>` : "";
  const lockBadge = isLocked ? `<span class="lock-badge">🔒 LOCKED</span>` : "";
  const stateLabel = game.anchorState ? `<span class="state-label ${game.anchorState}">${game.anchorState.toUpperCase()}</span>` : "";

  card.innerHTML = `
    <div class="tv-header">
      <div class="tv-id">${tvId}${isDiehard ? ' — Diehard' : ''}</div>
      <div class="tv-badges">
        ${satBadge}
        ${lockBadge}
      </div>
    </div>
    <div class="game-content">
      <div class="matchup">
        <div class="team away">${game.awayTeam}</div>
        <div class="score">${game.awayScore}</div>
      </div>
      <div class="vs">vs</div>
      <div class="matchup">
        <div class="team home">${game.homeTeam}</div>
        <div class="score">${game.homeScore}</div>
      </div>
    </div>
    <div class="game-meta">
      <div class="status">${game.gameStatus} • ${game.gameClock}</div>
      <div class="scores">
        <span class="label">Channel Score:</span>
        <span class="value">${game.channelScore.toFixed(1)}</span>
      </div>
      <div class="scores small">
        <span>Rel: ${game.relevance.toFixed(0)}</span>
        <span>Vit: ${game.vitality.toFixed(0)}</span>
      </div>
      ${stateLabel}
    </div>
  `;

  return card;
}

function toggleGame(gameId) {
  gameToggleState[gameId] = !gameToggleState[gameId];
  // Re-run assignment without fetching new data
  reAssignWithCurrentGames();
}

function reAssignWithCurrentGames() {
  if (!gameData) return;

  // Filter games by toggle state
  const activeGames = gameData.games.filter(g => gameToggleState[g.id] !== false);

  // Score each game
  const scoredGames = scoreGames(activeGames);

  // Add anchor states
  const scoredWithState = scoredGames.map(g => ({
    ...g,
    anchorState: getAnchorState(g)
  }));

  // Create TV assignments
  assignments = createTVAssignments(scoredWithState, VENUE_CONFIG);

  // Store full game data for toggle panel
  assignments.allGamesWithToggle = gameData.games;

  lastUpdateTime = new Date();
  displayDashboard();
}

function updateStatus(text) {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = text;
  }
}

// Initialize and set up refresh cycle
window.addEventListener("DOMContentLoaded", () => {
  fetchAndUpdate();
  setInterval(fetchAndUpdate, 60000); // Refresh every 60 seconds
});

// Phase 2: Main app logic
// Coordinates fetching, scoring, and TV assignment display

let gameData = null;
let assignments = null;
let lastUpdateTime = null;
let isLoading = false;

async function fetchAndUpdate() {
  if (isLoading) return;

  isLoading = true;
  updateStatus("Fetching and scoring...");

  try {
    // Fetch games
    gameData = await fetchGames();

    // Score each game
    const scoredGames = scoreGames(gameData.games);

    // Create TV assignments
    assignments = createTVAssignments(scoredGames);

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

  const statusText = `${assignments.allGames.length} games scored at ${lastUpdateTime.toLocaleTimeString()}`;
  document.getElementById("status").textContent = statusText;

  // Render TV layout
  const dashboard = document.getElementById("dashboard");
  dashboard.innerHTML = "";

  // Anchor TVs section
  const anchorsSection = document.createElement("div");
  anchorsSection.className = "tv-section anchors-section";
  anchorsSection.innerHTML = "<h2>ANCHOR TVs (Behind Bar)</h2>";
  const anchorsContainer = document.createElement("div");
  anchorsContainer.className = "tvs-container";

  for (const [tvId, game] of Object.entries(assignments.anchors)) {
    anchorsContainer.appendChild(createTVCard(tvId, game, "anchor"));
  }

  anchorsSection.appendChild(anchorsContainer);
  dashboard.appendChild(anchorsSection);

  // Secondary TVs section
  const secondariesSection = document.createElement("div");
  secondariesSection.className = "tv-section secondaries-section";
  secondariesSection.innerHTML = "<h2>SECONDARY TVs (Throughout Venue)</h2>";
  const secondariesContainer = document.createElement("div");
  secondariesContainer.className = "tvs-container";

  for (const [tvId, game] of Object.entries(assignments.secondaries)) {
    secondariesContainer.appendChild(createTVCard(tvId, game, "secondary"));
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

function createTVCard(tvId, game, tvType) {
  const card = document.createElement("div");
  card.className = `tv-card tv-${tvType}`;

  if (!game) {
    card.innerHTML = `<div class="tv-id">${tvId}</div><div class="no-content">Empty</div>`;
    return card;
  }

  const isLocked = isOnLockList(game);
  const lockBadge = isLocked ? `<span class="lock-badge">🔒 LOCKED</span>` : "";

  card.innerHTML = `
    <div class="tv-header">
      <div class="tv-id">${tvId}</div>
      ${lockBadge}
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
    </div>
  `;

  return card;
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

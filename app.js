// Phase 1: Main app logic
// Coordinates fetching and display refresh

let gameData = null;
let lastUpdateTime = null;
let isLoading = false;

async function fetchAndUpdate() {
  if (isLoading) return;

  isLoading = true;
  updateStatus("Fetching...");

  try {
    gameData = await fetchGames();
    lastUpdateTime = new Date();
    displayGames();
  } catch (err) {
    console.error("Fetch error:", err);
    updateStatus(`Error: ${err.message}`);
  } finally {
    isLoading = false;
  }
}

function displayGames() {
  const container = document.getElementById("games-container");
  const status = document.getElementById("status");

  if (!gameData) {
    container.innerHTML = "<p>No data yet</p>";
    return;
  }

  const statusText = `Loaded ${gameData.count} games at ${lastUpdateTime.toLocaleTimeString()}`;
  if (gameData.errors.length > 0) {
    status.innerHTML = `${statusText} | Errors: ${gameData.errors.join(", ")}`;
  } else {
    status.innerHTML = statusText;
  }

  // Sort by sport and status
  const sorted = gameData.games.sort((a, b) => {
    if (a.sport !== b.sport) return a.sport.localeCompare(b.sport);
    return b.gamePhase - a.gamePhase;
  });

  container.innerHTML = `<pre>${JSON.stringify(sorted, null, 2)}</pre>`;
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

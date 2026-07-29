// Phase 2: Display and assignment logic
// Determines which games go on which TVs

function isOnLockList(game) {
  const { lockListTeams, lockListEvents } = VENUE_CONFIG;

  // Check lock list events
  if (lockListEvents.includes("Super Bowl") &&
      (game.homeTeam.includes("Bowl") || game.awayTeam.includes("Bowl"))) {
    return true;
  }

  // Check if either team is on lock list
  for (const team of lockListTeams) {
    if (game.homeTeam === team || game.awayTeam === team) {
      // For DC teams, only lock on playoff
      if (["Washington Capitals", "Washington Nationals", "Washington Wizards"].includes(team)) {
        return game.isPlayoff;
      }
      // Commanders and Liverpool lock all games
      return true;
    }
  }

  return false;
}

function assignAnchorTVs(scoredGames) {
  const anchors = VENUE_CONFIG.anchorTVs;
  const assignments = {};

  // Initialize all anchors as empty
  anchors.forEach(tv => {
    assignments[tv.id] = null;
  });

  // Sort by channel score (highest first)
  const sorted = [...scoredGames].sort((a, b) => b.channelScore - a.channelScore);

  // Check for lock list games first
  const lockListGames = sorted.filter(g => isOnLockList(g));
  if (lockListGames.length > 0) {
    // Lock list game takes all 3 anchors
    const lockGame = lockListGames[0];
    anchors.forEach(tv => {
      assignments[tv.id] = lockGame;
    });
    return assignments;
  }

  // No lock list - check for 2-1 split (top game leads by 15+)
  if (sorted.length >= 2) {
    const gap = sorted[0].channelScore - sorted[1].channelScore;
    if (gap >= VENUE_CONFIG.thresholds.dominanceGap) {
      // 2-1 split: outer anchors get top game, center gets #2
      assignments[anchors[0].id] = sorted[0]; // left
      assignments[anchors[2].id] = sorted[0]; // right
      assignments[anchors[1].id] = sorted[1]; // center
      return assignments;
    }
  }

  // Default 1-1-1 split: each anchor gets a different game
  for (let i = 0; i < Math.min(anchors.length, sorted.length); i++) {
    assignments[anchors[i].id] = sorted[i];
  }

  return assignments;
}

function assignSecondaryTVs(scoredGames, anchorAssignments) {
  const secondaries = VENUE_CONFIG.secondaryTVs;
  const assignments = {};

  // Initialize all secondaries as empty
  secondaries.forEach(tv => {
    assignments[tv.id] = null;
  });

  // Get games not on anchors
  const anchorGameIds = new Set(
    Object.values(anchorAssignments)
      .filter(g => g !== null)
      .map(g => g.id)
  );

  const availableGames = scoredGames.filter(g => !anchorGameIds.has(g.id))
    .sort((a, b) => b.channelScore - a.channelScore);

  // Assign available games to secondaries in score order
  for (let i = 0; i < secondaries.length; i++) {
    if (i < availableGames.length) {
      assignments[secondaries[i].id] = availableGames[i];
    } else {
      // Repeat top game if we run out
      const topGame = availableGames[0];
      if (topGame) {
        assignments[secondaries[i].id] = topGame;
      }
    }
  }

  return assignments;
}

function createTVAssignments(scoredGames) {
  const anchorAssignments = assignAnchorTVs(scoredGames);
  const secondaryAssignments = assignSecondaryTVs(scoredGames, anchorAssignments);

  return {
    anchors: anchorAssignments,
    secondaries: secondaryAssignments,
    allGames: scoredGames
  };
}

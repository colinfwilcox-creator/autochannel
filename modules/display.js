// Phase 2: Display and assignment logic
// Determines which games go on which TVs

function getActiveLockListGame(scoredGames, venueConfig) {
  // Check if any game matches the lock list
  for (const game of scoredGames) {
    for (const lockItem of venueConfig.lockList) {
      if (lockItem.team) {
        // Check if team matches
        if (game.homeTeam === lockItem.team || game.awayTeam === lockItem.team) {
          // Check trigger condition
          if (lockItem.trigger === "any_game") {
            return { game, lockItem };
          }
          if (lockItem.trigger === "playoff_only" && game.isPlayoff) {
            return { game, lockItem };
          }
        }
      }
      if (lockItem.event) {
        // Check for Super Bowl
        if (lockItem.event === "Super Bowl" &&
            (game.homeTeam.includes("Super") || game.awayTeam.includes("Super"))) {
          return { game, lockItem };
        }
      }
    }
  }
  return null;
}

function assignAnchorTVs(scoredGames, venueConfig) {
  const anchors = venueConfig.anchorTVs;
  const assignments = {};

  // Initialize all anchors as empty
  anchors.forEach(tv => {
    assignments[tv.id] = null;
  });

  // Check for lock list game first
  const lockMatch = getActiveLockListGame(scoredGames, venueConfig);
  if (lockMatch) {
    // Lock list game takes all 3 anchors
    anchors.forEach(tv => {
      assignments[tv.id] = lockMatch.game;
    });
    return { assignments, lockGame: lockMatch.game, lockItem: lockMatch.lockItem };
  }

  // Sort by channel score (highest first)
  const sorted = [...scoredGames].sort((a, b) => b.channelScore - a.channelScore);

  // Check for 2-1 split (top game leads by 15+)
  if (sorted.length >= 2) {
    const gap = sorted[0].channelScore - sorted[1].channelScore;
    if (gap >= venueConfig.thresholds.dominanceGap) {
      // 2-1 split: outer anchors get top game, center gets #2
      assignments[anchors[0].id] = sorted[0]; // left
      assignments[anchors[2].id] = sorted[0]; // right
      assignments[anchors[1].id] = sorted[1]; // center
      return { assignments, lockGame: null, lockItem: null };
    }
  }

  // Default 1-1-1 split: each anchor gets a different game
  for (let i = 0; i < Math.min(anchors.length, sorted.length); i++) {
    assignments[anchors[i].id] = sorted[i];
  }

  return { assignments, lockGame: null, lockItem: null };
}

function assignSecondaryTVs(scoredGames, anchorAssignments, lockGame, lockItem, venueConfig) {
  const secondaries = venueConfig.secondaryTVs;
  const assignments = {};
  const saturationMap = {};

  // Initialize all secondaries as empty, track saturation status
  secondaries.forEach(tv => {
    assignments[tv.id] = null;
    saturationMap[tv.id] = false;
  });

  // Get games not on anchors
  const anchorGameIds = new Set(
    Object.values(anchorAssignments)
      .filter(g => g !== null)
      .map(g => g.id)
  );

  const availableGames = scoredGames.filter(g => !anchorGameIds.has(g.id))
    .sort((a, b) => b.channelScore - a.channelScore);

  // Calculate saturation (lock list privilege only)
  const saturationCount = lockGame && lockItem ?
    Math.floor(
      secondaries.filter(tv => tv.saturationEligible).length * lockItem.saturation
    ) : 0;

  // Fill saturation slots with lock game
  let saturationFilled = 0;
  if (saturationCount > 0) {
    for (const tv of secondaries) {
      if (tv.saturationEligible && saturationFilled < saturationCount) {
        assignments[tv.id] = lockGame;
        saturationMap[tv.id] = true;
        saturationFilled++;
      }
    }
  }

  // Fill remaining secondary TVs with available games (no repetition)
  let gameIndex = 0;
  for (const tv of secondaries) {
    // Skip if already filled by saturation
    if (assignments[tv.id] !== null) continue;

    // Fill with next available game, or leave blank
    if (gameIndex < availableGames.length) {
      assignments[tv.id] = availableGames[gameIndex];
      gameIndex++;
    }
    // If no more games, leave TV blank (fix for repetition bug)
  }

  return { assignments, saturationMap };
}

function createTVAssignments(scoredGames, venueConfig) {
  const anchorResult = assignAnchorTVs(scoredGames, venueConfig);
  const secondaryResult = assignSecondaryTVs(
    scoredGames,
    anchorResult.assignments,
    anchorResult.lockGame,
    anchorResult.lockItem,
    venueConfig
  );

  return {
    anchors: anchorResult.assignments,
    secondaries: secondaryResult.assignments,
    saturationMap: secondaryResult.saturationMap,
    lockGame: anchorResult.lockGame,
    lockItem: anchorResult.lockItem,
    allGames: scoredGames
  };
}

function getDiehardScreenId(venueConfig) {
  const diehard = venueConfig.secondaryTVs.find(tv => tv.isDiehardScreen);
  return diehard ? diehard.id : null;
}

function assignFallbackChannels(assignments, venueConfig) {
  // Collect all empty secondary TV slots
  const emptySlots = Object.entries(assignments.secondaries)
    .filter(([tvId, game]) => game === null)
    .map(([tvId, _]) => tvId);

  // Create fallback map
  const fallbackMap = {};
  emptySlots.forEach((tvId, index) => {
    fallbackMap[tvId] = venueConfig.fallbackChannels[index % venueConfig.fallbackChannels.length];
  });

  return fallbackMap;
}

// Phase 3: Venue presets and shared defaults (Spec §17.B–C)
// A venue = market + TV count + which TVs are anchors + diehard choice.
// The runtime venue object is built by buildVenue() in modules/venue.js.

const VENUE_DEFAULTS = {
  thresholds: {
    dominanceGap: 15,
    // Main-TV modes (no lock), by how far #1 leads #2:
    //   lead ≥ mainTakeoverGap (30)        → every Main TV shows #1
    //   dominanceGap (15) ≤ lead < 30      → 2-1 split (featured on the outer Mains) + NFL flip
    //   lead < 15                          → 1-1-1
    // With 2 Main TVs, 2-1 is disabled (§17.C), so anything below 30 is 1-1.
    mainTakeoverGap: 30,
    blowoutDemotion: 35,
    completionProtectionMinScore: 55,
    completionProtectionPhase: 0.85,
    manualOverrideLockSeconds: 1800,
    lockLeadMinutes: 30
  }
};

const VENUE_PRESETS = {
  "barking-dog": {
    venueName: "Barking Dog, Bethesda MD",
    marketId: "washington-dc",
    totalTVs: 13,
    anchorTVs: [1, 2, 3],   // TV numbers marked as anchors
    diehardTV: 6,           // Secondary 3 (spec §2)
    lockListOverride: null, // null = auto-generated from the market
    adjust: {}              // optional per-team ±10
  }
};

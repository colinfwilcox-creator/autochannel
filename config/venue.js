// Phase 3: Venue presets and shared defaults (Spec §17.B–C)
// A venue = market + TV count + which TVs are anchors + diehard choice.
// The runtime venue object is built by buildVenue() in modules/venue.js.

const VENUE_DEFAULTS = {
  thresholds: {
    dominanceGap: 15,
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

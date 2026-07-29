const VENUE_CONFIG = {
  venueId: "barking-dog-bethesda",
  venueName: "Barking Dog",
  market: "Washington DC",

  anchorTVs: [
    { id: "anchor_1", position: "left" },
    { id: "anchor_2", position: "center" },
    { id: "anchor_3", position: "right" }
  ],

  secondaryTVs: [
    { id: "secondary_1" },
    { id: "secondary_2" },
    { id: "secondary_3", isDiehardScreen: true },
    { id: "secondary_4" },
    { id: "secondary_5" },
    { id: "secondary_6" },
    { id: "secondary_7" },
    { id: "secondary_8" },
    { id: "secondary_9" },
    { id: "secondary_10" }
  ],

  lockListTeams: [
    "Washington Commanders",
    "Washington Capitals",
    "Washington Nationals",
    "Washington Wizards",
    "Liverpool FC"
  ],

  lockListEvents: ["Super Bowl"],

  dcPlayoffAutoLock: true,

  teamRelevanceTable: {
    "Washington Commanders": 90,
    "Washington Capitals": 85,
    "Washington Nationals": 80,
    "Washington Wizards": 70,
    "Maryland Terrapins": 65,
    "Baltimore Ravens": 55,
    "Baltimore Orioles": 50
  },

  thresholds: {
    dominanceGap: 15,
    blowoutDemotion: 35,
    completionProtectionMinScore: 55,
    completionProtectionPhase: 0.85,
    manualOverrideLockSeconds: 1800
  }
};

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
    { id: "secondary_1", saturationEligible: true },
    { id: "secondary_2", saturationEligible: true },
    { id: "secondary_3", saturationEligible: false, isDiehardScreen: true },
    { id: "secondary_4", saturationEligible: true },
    { id: "secondary_5", saturationEligible: true },
    { id: "secondary_6", saturationEligible: true },
    { id: "secondary_7", saturationEligible: true },
    { id: "secondary_8", saturationEligible: true },
    { id: "secondary_9", saturationEligible: true },
    { id: "secondary_10", saturationEligible: true }
  ],

  lockList: [
    {
      team: "Washington Commanders",
      trigger: "any_game",
      anchorMode: "3-anchor-lock",
      saturation: 0.70
    },
    {
      team: "Washington Capitals",
      trigger: "playoff_only",
      anchorMode: "3-anchor-lock",
      saturation: 0.60
    },
    {
      team: "Washington Nationals",
      trigger: "playoff_only",
      anchorMode: "3-anchor-lock",
      saturation: 0.60
    },
    {
      team: "Washington Wizards",
      trigger: "playoff_only",
      anchorMode: "3-anchor-lock",
      saturation: 0.60
    }
  ],

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
  },

  fallbackChannels: [
    "NFL Network",
    "MLB Network",
    "NHL Network",
    "Golf Channel",
    "ESPN News"
  ]
};
